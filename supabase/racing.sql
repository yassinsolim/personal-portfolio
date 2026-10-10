-- Nordschleife racing: lap leaderboard, ghost replays and the drift park's
-- scoreboard.
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
--   - a lap only shows on the board once its ghost shows it drove the whole
--     ring forward from the line (verified, set by a trigger on the ghost)
--   - removed laps are listed with why, so the game can tell the player

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
-- the board reads verified laps only, see nordschleife_verify_lap
alter table public.nordschleife_leaderboard
  add column if not exists verified boolean not null default false;

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
    || 'toyota-crown-platinum|lamborghini-huracan|lamborghini-aventador-s|'
    || 'ferrari-laferrari|mclaren-p1|porsche-918-spyder|bugatti-chiron-super-sport|'
    || 'koenigsegg-jesko|pagani-huayra|mclaren-senna|ferrari-sf90-stradale|'
    || 'aston-martin-valkyrie|toyota-supra-mk4)@v[0-9]{1,3}(~t[0-9a-z]{1,16})?$');
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
    and verified is false
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
    -- a real 10 minute lap is about 1 MB (4879 samples); 5001 samples of 8 long
    -- numbers stay under this, a padded payload doesn't
    and octet_length(samples::text) <= 2000000
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
    and octet_length(samples::text) <= 2000000
    and not jsonb_path_exists(samples, '$[*] ? (@.type() != "object")')
  );

-- ---------------------------------------------------------------- verified laps

-- the ring's checkpoints as x, z pairs in meters: a point on the road about
-- every 100 m, the last one the start line
create or replace function public.nordschleife_lap_checkpoints()
returns integer[]
language sql
immutable
as $$
  select array[
    -- checkpoints:begin
    -904, 2332, -975, 2257, -1050, 2210, -1103, 2299, -1170, 2376, -1263, 2422, -1362, 2404, -1455, 2358, -1557, 2341, -1659, 2349,
    -1749, 2322, -1805, 2236, -1872, 2163, -1957, 2119, -2054, 2099, -2089, 2006, -2168, 1940, -2253, 1881, -2339, 1822, -2418, 1754,
    -2483, 1674, -2549, 1593, -2611, 1510, -2625, 1408, -2595, 1309, -2563, 1211, -2546, 1108, -2545, 1004, -2555, 901, -2576, 799,
    -2612, 702, -2655, 607, -2695, 511, -2733, 415, -2785, 325, -2863, 258, -2957, 213, -3036, 152, -2984, 75, -2888, 35,
    -2793, -7, -2712, -72, -2630, -129, -2558, -204, -2483, -276, -2406, -345, -2350, -432, -2311, -528, -2300, -630, -2272, -724,
    -2212, -802, -2229, -892, -2151, -960, -2069, -1024, -2001, -1103, -1926, -1175, -1853, -1249, -1795, -1335, -1787, -1436, -1812, -1537,
    -1894, -1579, -1988, -1616, -2067, -1682, -2016, -1757, -1925, -1808, -1853, -1881, -1824, -1979, -1764, -2063, -1666, -2086, -1573, -2043,
    -1488, -1983, -1430, -1906, -1356, -1943, -1255, -1964, -1151, -1970, -1048, -1962, -947, -1942, -886, -2021, -881, -2124, -797, -2179,
    -699, -2215, -600, -2244, -498, -2265, -396, -2287, -308, -2341, -225, -2403, -129, -2415, -100, -2318, -108, -2214, -106, -2110,
    -95, -2007, -55, -1911, 15, -1835, 103, -1781, 199, -1741, 297, -1708, 401, -1710, 505, -1708, 608, -1696, 711, -1683,
    808, -1658, 906, -1624, 990, -1562, 1078, -1508, 1173, -1466, 1274, -1477, 1366, -1526, 1450, -1587, 1529, -1654, 1625, -1690,
    1728, -1706, 1829, -1729, 1880, -1662, 1809, -1588, 1730, -1522, 1644, -1464, 1649, -1394, 1711, -1471, 1797, -1527, 1896, -1559,
    1997, -1582, 2091, -1619, 2167, -1689, 2212, -1781, 2215, -1881, 2274, -1966, 2370, -1965, 2467, -1932, 2563, -1903, 2636, -1832,
    2721, -1778, 2812, -1741, 2880, -1662, 2897, -1565, 2856, -1470, 2859, -1373, 2946, -1321, 3024, -1268, 3034, -1165, 3005, -1074,
    2902, -1069, 2798, -1079, 2730, -1017, 2675, -930, 2623, -841, 2611, -740, 2614, -636, 2617, -532, 2555, -451, 2456, -421,
    2376, -358, 2307, -280, 2261, -187, 2205, -100, 2118, -46, 2033, 13, 1932, 37, 1837, 70, 1739, 103, 1636, 108,
    1553, 46, 1458, 29, 1371, 86, 1305, 158, 1368, 238, 1462, 282, 1560, 315, 1636, 380, 1670, 478, 1653, 578,
    1577, 646, 1486, 696, 1396, 748, 1307, 802, 1218, 856, 1129, 909, 1040, 963, 951, 1017, 862, 1071, 773, 1124,
    684, 1179, 596, 1234, 508, 1289, 420, 1344, 332, 1400, 247, 1453, 159, 1509, 71, 1564, -17, 1620, -104, 1675,
    -192, 1731, -272, 1797, -338, 1877, -404, 1958, -470, 2038, -519, 2130, -586, 2209, -654, 2287, -725, 2339, -817, 2378
    -- checkpoints:end
  ]::integer[];
$$;

-- a ghost that drove the whole ring forward: it starts by the line, comes
-- within 50 m of every checkpoint in order (the legit laps pass all of them
-- within 19 m), and its clock runs from 0 to the lap's time. the last sample
-- is the first pose again (GhostReplay.finalizeRecording), so it doesn't count
-- as driving. backing over the line and coming back can't pass it
create or replace function public.nordschleife_replay_drives_lap(p_samples jsonb, p_lap_time_ms integer)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_points constant integer[] := nordschleife_lap_checkpoints();
  v_last constant integer := array_length(v_points, 1) / 2;
  v_count integer;
  v_next integer := 1;
  v_index integer := 0;
  v_sample jsonb;
  v_t double precision;
  v_x double precision;
  v_z double precision;
  v_previous double precision := 0;
begin
  if jsonb_typeof(p_samples) is distinct from 'array' then
    return false;
  end if;
  v_count := jsonb_array_length(p_samples);
  if v_count < 8 then
    return false;
  end if;
  for v_sample in select value from jsonb_array_elements(p_samples) loop
    v_index := v_index + 1;
    if jsonb_typeof(v_sample -> 't') is distinct from 'number'
       or jsonb_typeof(v_sample -> 'x') is distinct from 'number'
       or jsonb_typeof(v_sample -> 'z') is distinct from 'number' then
      return false;
    end if;
    v_t := (v_sample ->> 't')::double precision;
    v_x := (v_sample ->> 'x')::double precision;
    v_z := (v_sample ->> 'z')::double precision;
    if v_index = 1 then
      -- from the grid (up to ~60 m on) or a flying start on the line
      if v_t <> 0 or (v_x - v_points[2 * v_last - 1]) ^ 2 + (v_z - v_points[2 * v_last]) ^ 2 > 150 ^ 2 then
        return false;
      end if;
    elsif v_t < v_previous then
      return false;
    end if;
    v_previous := v_t;
    if v_index < v_count then
      while v_next <= v_last
        and (v_x - v_points[2 * v_next - 1]) ^ 2 + (v_z - v_points[2 * v_next]) ^ 2 <= 50 ^ 2 loop
        v_next := v_next + 1;
      end loop;
    end if;
  end loop;
  return v_next > v_last and abs(v_previous - p_lap_time_ms) <= 50;
end;
$$;

-- the client upserts the ghost right after the lap, so that's when it's checked
create or replace function public.nordschleife_verify_lap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update nordschleife_leaderboard
    set verified = nordschleife_replay_drives_lap(new.samples, lap_time_ms)
    where id = new.lap_id;
  return new;
end;
$$;

drop trigger if exists nordschleife_verify_lap on public.nordschleife_ghost_replays;
create trigger nordschleife_verify_lap
  after insert or update on public.nordschleife_ghost_replays
  for each row execute function public.nordschleife_verify_lap();

-- laps already on the board are checked the same way (and again after the
-- check or the checkpoints change)
update public.nordschleife_leaderboard l
  set verified = public.nordschleife_replay_drives_lap(g.samples, l.lap_time_ms)
  from public.nordschleife_ghost_replays g
  where g.lap_id = l.id
    and l.verified is distinct from public.nordschleife_replay_drives_lap(g.samples, l.lap_time_ms);

-- ---------------------------------------------------------------- removed laps

-- laps taken off the board and why. public, so the game can tell the player
-- whose lap it was (their device keeps its own copy until then). only the sql
-- editor removes laps:
--   select public.nordschleife_remove_lap('<lap id>', '<why, shown to the player>');
create table if not exists public.nordschleife_removed_laps (
  lap_id uuid primary key,
  name text not null,
  lap_time_ms integer not null,
  car_id text not null,
  reason text not null check (char_length(reason) between 1 and 600),
  removed_at timestamptz not null default now()
);

alter table public.nordschleife_removed_laps enable row level security;

drop policy if exists "public read removed laps" on public.nordschleife_removed_laps;
create policy "public read removed laps"
  on public.nordschleife_removed_laps for select
  to anon, authenticated
  using (true);

-- its ghost goes with it (on delete cascade)
create or replace function public.nordschleife_remove_lap(p_lap_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into nordschleife_removed_laps (lap_id, name, lap_time_ms, car_id, reason)
    select id, name, lap_time_ms, car_id, p_reason from nordschleife_leaderboard where id = p_lap_id
    on conflict (lap_id) do update set reason = excluded.reason;
  if not found then
    raise exception 'no lap %', p_lap_id;
  end if;
  delete from nordschleife_leaderboard where id = p_lap_id;
end;
$$;

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

-- ---------------------------------------------------------------- drift park

-- a run is a lap of the drift park: its drift score and lap time. the car id
-- carries the park's own season tag ("bmw-e92-m3@d1", tuned "amg-one@d1~t0a1b2")
create table if not exists public.drift_park_scores (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 16),
  score integer not null check (score between 0 and 3000000),
  lap_time_ms integer not null check (lap_time_ms between 1000 and 7200000),
  car_id text not null check (char_length(car_id) between 1 and 64),
  created_at timestamptz not null default now()
);
create index if not exists idx_drift_park_scores_score
  on public.drift_park_scores (score desc);

create or replace function public.drift_park_valid_car_id(p_car_id text)
returns boolean
language sql
immutable
as $$
  select p_car_id ~ ('^(amg-one|bmw-e92-m3|amg-c63-507|amg-c63s-coupe|bmw-f82-m4|'
    || 'bmw-f90-m5-competition|bmw-m8-competition-coupe|mercedes-gt63s-edition-one|'
    || 'toyota-crown-platinum|lamborghini-huracan|lamborghini-aventador-s|'
    || 'ferrari-laferrari|mclaren-p1|porsche-918-spyder|bugatti-chiron-super-sport|'
    || 'koenigsegg-jesko|pagani-huayra|mclaren-senna|ferrari-sf90-stradale|'
    || 'aston-martin-valkyrie|toyota-supra-mk4)@d[0-9]{1,3}(~t[0-9a-z]{1,16})?$');
$$;

alter table public.drift_park_scores enable row level security;

drop policy if exists "public read drift runs" on public.drift_park_scores;
create policy "public read drift runs"
  on public.drift_park_scores for select
  to anon, authenticated
  using (true);

drop policy if exists "public insert drift runs" on public.drift_park_scores;
create policy "public insert drift runs"
  on public.drift_park_scores for insert
  to anon, authenticated
  with check (
    char_length(name) between 1 and 16
    and btrim(name) <> ''
    and name !~ '[[:cntrl:]]'
    -- the client never counts a park lap under 30 s (DRIFT_MIN_LAP_MS), and
    -- its scoring can't pass 1.3 points a millisecond (DRIFT_MAX_RATE)
    and lap_time_ms between 30000 and 1800000
    and score between 1 and lap_time_ms * 13 / 10
    and public.drift_park_valid_car_id(car_id)
  );

-- runs share the laps' per client and global caps
drop trigger if exists drift_park_limit_inserts on public.drift_park_scores;
create trigger drift_park_limit_inserts
  before insert on public.drift_park_scores
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
revoke all on public.drift_park_scores from anon, authenticated;
grant select, insert on public.drift_park_scores to anon, authenticated;
revoke all on public.nordschleife_removed_laps from anon, authenticated;
grant select on public.nordschleife_removed_laps to anon, authenticated;

revoke all on function public.nordschleife_limit_lap_inserts() from public, anon, authenticated;
revoke all on function public.nordschleife_lap_checkpoints() from public, anon, authenticated;
revoke all on function public.nordschleife_replay_drives_lap(jsonb, integer) from public, anon, authenticated;
revoke all on function public.nordschleife_verify_lap() from public, anon, authenticated;
revoke all on function public.nordschleife_remove_lap(uuid, text) from public, anon, authenticated;
revoke all on function public.nordschleife_ghost_matches_lap(uuid, integer, text) from public;
grant execute on function public.nordschleife_ghost_matches_lap(uuid, integer, text) to anon, authenticated;
revoke all on function public.nordschleife_valid_car_id(text) from public;
grant execute on function public.nordschleife_valid_car_id(text) to anon, authenticated;
revoke all on function public.drift_park_valid_car_id(text) from public;
grant execute on function public.drift_park_valid_car_id(text) to anon, authenticated;
