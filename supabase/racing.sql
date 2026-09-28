-- Nordschleife racing: lap leaderboard and ghost replays.
--
-- Runs in the SQL editor of the racing Supabase project (see docs/RACING_SUPABASE.md).
-- Safe to run again: everything is create-if-missing or create-or-replace.
--
-- The browser only has the publishable key. It reads both tables, inserts laps
-- and upserts ghost replays straight through RLS, so:
--   - anon gets select + insert on laps and select + insert + update on ghosts, nothing else
--   - a ghost has to belong to a real lap with the same car and lap time, and
--     can only be replaced for a few minutes after it's written
--   - laps through the api are 3 minutes or more (the client's floor), from a
--     known car, with a sane name
--   - lap inserts are capped per client ip and globally (a real lap takes 7 to 10 minutes)

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- laps

create table if not exists public.nordschleife_leaderboard (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 16),
  lap_time_ms integer not null check (lap_time_ms between 1000 and 7200000),
  -- car id plus the season tag, e.g. "bmw-e92-m3@v3". the board only reads the current tag
  car_id text not null check (char_length(car_id) between 1 and 64),
  created_at timestamptz not null default now()
);
create index if not exists idx_nordschleife_leaderboard_lap_time_ms
  on public.nordschleife_leaderboard (lap_time_ms);

-- car ids the game can submit: one of its cars, a season tag, and a garage
-- tune code on tuned laps ("bmw-e92-m3@v3", "amg-one@v3~t0a1b2c3d4e").
-- add a car here when carOptions.ts gets one
create or replace function public.nordschleife_valid_car_id(p_car_id text)
returns boolean
language sql
immutable
as $$
  select p_car_id ~ ('^(amg-one|bmw-e92-m3|amg-c63-507|amg-c63s-coupe|bmw-f82-m4|'
    || 'bmw-f90-m5-competition|bmw-m8-competition-coupe|mercedes-gt63s-edition-one|'
    || 'toyota-crown-platinum)@v[0-9]{1,3}(~t[0-9a-z]{1,16})?$');
$$;

alter table public.nordschleife_leaderboard enable row level security;

drop policy if exists "public read laps" on public.nordschleife_leaderboard;
create policy "public read laps"
  on public.nordschleife_leaderboard for select
  to anon, authenticated
  using (true);

drop policy if exists "public insert laps" on public.nordschleife_leaderboard;
create policy "public insert laps"
  on public.nordschleife_leaderboard for insert
  to anon, authenticated
  with check (
    char_length(name) between 1 and 16
    and btrim(name) <> ''
    and name !~ '[[:cntrl:]]'
    -- the client never counts a lap under 3 minutes (LapTimer MIN_LAP_TIME_MS)
    and lap_time_ms between 180000 and 7200000
    and public.nordschleife_valid_car_id(car_id)
  );

-- ---------------------------------------------------------------- ghosts

create table if not exists public.nordschleife_ghost_replays (
  lap_id uuid primary key references public.nordschleife_leaderboard (id) on delete cascade,
  lap_time_ms integer not null check (lap_time_ms between 1000 and 7200000),
  car_id text not null check (char_length(car_id) between 1 and 64),
  -- the client thins a lap to at most 5000 samples (plus the last one)
  samples jsonb not null check (jsonb_typeof(samples) = 'array' and jsonb_array_length(samples) between 8 and 5001),
  created_at timestamptz not null default now()
);

alter table public.nordschleife_ghost_replays enable row level security;

-- a ghost has to describe the lap it's attached to
create or replace function public.nordschleife_ghost_matches_lap(p_lap_id uuid, p_lap_time_ms integer, p_car_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.nordschleife_leaderboard l
    where l.id = p_lap_id
      and l.car_id = p_car_id
      and abs(l.lap_time_ms - p_lap_time_ms) <= 50
  );
$$;

drop policy if exists "public read ghost replays" on public.nordschleife_ghost_replays;
create policy "public read ghost replays"
  on public.nordschleife_ghost_replays for select
  to anon, authenticated
  using (true);

drop policy if exists "public insert ghost replays" on public.nordschleife_ghost_replays;
create policy "public insert ghost replays"
  on public.nordschleife_ghost_replays for insert
  to anon, authenticated
  with check (
    public.nordschleife_ghost_matches_lap(lap_id, lap_time_ms, car_id)
    -- 5001 samples of 8 numbers is well under this; it stops a padded payload
    and octet_length(samples::text) <= 1500000
    and not jsonb_path_exists(samples, '$[*] ? (@.type() != "object")')
  );

-- the client upserts right after the lap lands, so a ghost can only be
-- replaced for a few minutes, not rewritten by anyone later
drop policy if exists "public update ghost replays" on public.nordschleife_ghost_replays;
create policy "public update ghost replays"
  on public.nordschleife_ghost_replays for update
  to anon, authenticated
  using (created_at > now() - interval '15 minutes')
  with check (
    public.nordschleife_ghost_matches_lap(lap_id, lap_time_ms, car_id)
    and octet_length(samples::text) <= 1500000
    and not jsonb_path_exists(samples, '$[*] ? (@.type() != "object")')
  );

-- ---------------------------------------------------------------- rate limit

-- private: no policies and no grants, so the publishable key can't touch it
create table if not exists public.nordschleife_rate_events (
  bucket text not null,
  at timestamptz not null default clock_timestamp()
);
create index if not exists nordschleife_rate_events_idx on public.nordschleife_rate_events (bucket, at);
alter table public.nordschleife_rate_events enable row level security;

create or replace function public.nordschleife_limit_lap_inserts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_headers text := nullif(current_setting('request.headers', true), '');
  v_ip text;
  v_net text;
  v_bucket text;
  v_count integer;
  v_total integer;
begin
  -- only the data api sets request.headers, so the sql editor and migrations skip the limit
  if v_headers is null then
    return new;
  end if;
  -- the client ip as supabase's edge sets it. x-forwarded-for keeps whatever
  -- the client sent as its first entry, so it's not used. sb-forwarded-for is
  -- overwritten with the real address, and cloudflare refuses a request that
  -- sets cf-connecting-ip itself (checked against the live project, sep 2026)
  v_ip := coalesce(
    nullif(trim(v_headers::json ->> 'sb-forwarded-for'), ''),
    nullif(trim(v_headers::json ->> 'cf-connecting-ip'), '')
  );
  -- one client usually holds a whole ipv6 /64, so that's the unit
  begin
    v_net := host(network(set_masklen(v_ip::inet, case when family(v_ip::inet) = 6 then 64 else 32 end)));
  exception when others then
    v_net := 'unknown';
  end;
  v_bucket := md5('nordschleife:' || coalesce(v_net, 'unknown'));
  if random() < 0.02 then
    delete from nordschleife_rate_events where at < clock_timestamp() - interval '1 day';
  end if;
  select count(*) filter (where bucket = v_bucket), count(*) into v_count, v_total
    from nordschleife_rate_events
    where at > clock_timestamp() - interval '10 minutes';
  if v_count >= 30 then
    raise exception 'too many laps from this client, try again later' using errcode = '53400';
  end if;
  -- a backstop if addresses are rotated: the whole game, 300 laps per 10 minutes
  if v_total >= 300 then
    raise exception 'too many laps right now, try again later' using errcode = '53400';
  end if;
  insert into nordschleife_rate_events (bucket) values (v_bucket);
  return new;
end;
$$;

drop trigger if exists nordschleife_limit_lap_inserts on public.nordschleife_leaderboard;
create trigger nordschleife_limit_lap_inserts
  before insert on public.nordschleife_leaderboard
  for each row execute function public.nordschleife_limit_lap_inserts();

-- ---------------------------------------------------------------- realtime

-- the board listens for new laps (postgres changes on insert)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'nordschleife_leaderboard'
     ) then
    alter publication supabase_realtime add table public.nordschleife_leaderboard;
  end if;
end $$;

-- ---------------------------------------------------------------- grants

-- least privilege for the browser roles: only what the game does
revoke all on public.nordschleife_leaderboard, public.nordschleife_ghost_replays, public.nordschleife_rate_events
  from anon, authenticated;
grant select, insert on public.nordschleife_leaderboard to anon, authenticated;
grant select, insert, update on public.nordschleife_ghost_replays to anon, authenticated;

revoke all on function public.nordschleife_limit_lap_inserts() from public, anon, authenticated;
revoke all on function public.nordschleife_ghost_matches_lap(uuid, integer, text) from public;
grant execute on function public.nordschleife_ghost_matches_lap(uuid, integer, text) to anon, authenticated;
revoke all on function public.nordschleife_valid_car_id(text) from public;
grant execute on function public.nordschleife_valid_car_id(text) to anon, authenticated;
