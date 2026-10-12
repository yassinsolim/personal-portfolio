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
--   - a driver's profile is public to read except its key's hash, and only
--     changes through racing_save_player with the device's key. laps and
--     runs sent with that key (x-player-id, x-player-key) are the player's
--   - the boards are each driver's best (nordschleife_board, drift_park_board),
--     read through functions that run as the caller

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
-- what was counted: laps (and drift runs), or profile saves
alter table public.nordschleife_rate_events
  add column if not exists kind text not null default 'lap';
create index if not exists nordschleife_rate_events_kind_idx on public.nordschleife_rate_events (kind, at);

-- the client's network as supabase's edge sets it: its ipv4 address or ipv6
-- /64 (one client usually holds a whole /64). null outside the data api (the
-- sql editor, migrations), which only the api sets request.headers for.
-- x-forwarded-for keeps whatever the client sent as its first entry, so it's
-- not used. sb-forwarded-for is overwritten with the real address, and
-- cloudflare refuses a request that sets cf-connecting-ip itself (checked
-- against the live project, sep 2026)
create or replace function public.racing_client_net()
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v_headers text := nullif(current_setting('request.headers', true), '');
  v_ip text;
begin
  if v_headers is null then
    return null;
  end if;
  v_ip := coalesce(
    nullif(trim(v_headers::json ->> 'sb-forwarded-for'), ''),
    nullif(trim(v_headers::json ->> 'cf-connecting-ip'), '')
  );
  begin
    return coalesce(
      host(network(set_masklen(v_ip::inet, case when family(v_ip::inet) = 6 then 64 else 32 end))),
      'unknown'
    );
  exception when others then
    return 'unknown';
  end;
end;
$$;

-- at most p_per_client of a kind per client and p_total from everyone (a
-- backstop if addresses are rotated) per 10 minutes. 53400 past either
create or replace function public.racing_rate_limit(p_kind text, p_per_client integer, p_total integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_net text := racing_client_net();
  v_bucket text;
  v_count integer;
  v_total integer;
begin
  if v_net is null then
    return;
  end if;
  v_bucket := md5(p_kind || ':' || v_net);
  if random() < 0.02 then
    delete from nordschleife_rate_events where at < clock_timestamp() - interval '1 day';
  end if;
  select count(*) filter (where bucket = v_bucket), count(*) into v_count, v_total
    from nordschleife_rate_events
    where kind = p_kind and at > clock_timestamp() - interval '10 minutes';
  if v_count >= p_per_client then
    raise exception 'too many from this client, try again later' using errcode = '53400';
  end if;
  if v_total >= p_total then
    raise exception 'too many right now, try again later' using errcode = '53400';
  end if;
  insert into nordschleife_rate_events (bucket, kind) values (v_bucket, p_kind);
end;
$$;

-- a real lap takes 7 to 10 minutes: 30 a client and 300 in all per 10 minutes
create or replace function public.nordschleife_limit_lap_inserts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform racing_rate_limit('lap', 30, 300);
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

-- ---------------------------------------------------------------- players

-- a driver's profile: the badge, name, number and bio the board and the pause
-- menu show, the car they show off and how their cars are set up. a device
-- keeps its player id and a secret key, only the key's sha256 is here (and the
-- api can't read it)
create table if not exists public.racing_players (
  id uuid primary key,
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  name text not null check (char_length(name) between 1 and 16),
  avatar text not null default 'helmet' check (avatar ~ '^[a-z0-9-]{1,24}$'),
  color text not null default '#e8b04a' check (color ~ '^#[0-9a-f]{6}$'),
  number smallint check (number between 0 and 99),
  bio text not null default '' check (char_length(bio) <= 140),
  car text check (car ~ '^[a-z0-9-]{1,48}$'),
  -- car id to its look and tune codes (garage.ts encodeLook and tuneCode)
  garage jsonb not null default '{}'::jsonb check (jsonb_typeof(garage) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.racing_players enable row level security;

drop policy if exists "public read players" on public.racing_players;
create policy "public read players"
  on public.racing_players for select
  to anon, authenticated
  using (true);

-- names and bios: no control characters, nor the invisible ones that flip or
-- hide text
create or replace function public.racing_clean_text(p_text text)
returns boolean
language sql
immutable
as $$
  select p_text !~ '[[:cntrl:]\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]';
$$;

-- up to 32 cars, each its look and tune code
create or replace function public.racing_valid_garage(p_garage jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(p_garage) = 'object'
    and octet_length(p_garage::text) <= 8192
    and (select count(*) from jsonb_object_keys(p_garage)) <= 32
    and not exists (
      select 1 from jsonb_each(p_garage) e
      where not public.nordschleife_valid_car_id(e.key || '@v0')
        or jsonb_typeof(e.value) <> 'object'
        or exists (select 1 from jsonb_object_keys(e.value) k where k not in ('look', 'tune'))
        or jsonb_typeof(coalesce(e.value -> 'look', '""')) <> 'string'
        or jsonb_typeof(coalesce(e.value -> 'tune', '""')) <> 'string'
        or coalesce(e.value ->> 'look', '') !~ '^[0-9a-z.-]{0,80}$'
        or coalesce(e.value ->> 'tune', '') !~ '^[0-9a-z]{0,24}$'
    );
$$;

-- makes the profile, or changes it with the key it was made with. a field the
-- game can't make is 22023, another device's player 42501, too many saves 53400
create or replace function public.racing_save_player(p_id uuid, p_key text, p_profile jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_profile ->> 'name', ''));
  v_avatar text := coalesce(p_profile ->> 'avatar', 'helmet');
  v_color text := lower(coalesce(p_profile ->> 'color', '#e8b04a'));
  v_number smallint;
  v_bio text := btrim(coalesce(p_profile ->> 'bio', ''));
  v_car text := nullif(p_profile ->> 'car', '');
  v_garage jsonb := coalesce(p_profile -> 'garage', '{}'::jsonb);
  v_rows integer;
begin
  if p_id is null or coalesce(p_key, '') !~ '^[A-Za-z0-9_-]{32,128}$' then
    raise exception 'a player id and key are needed' using errcode = '22023';
  end if;
  if jsonb_typeof(p_profile) is distinct from 'object' then
    raise exception 'the profile is an object' using errcode = '22023';
  end if;
  if char_length(v_name) not between 1 and 16 or not racing_clean_text(v_name) then
    raise exception 'bad name' using errcode = '22023';
  end if;
  if v_avatar !~ '^[a-z0-9-]{1,24}$' then
    raise exception 'bad avatar' using errcode = '22023';
  end if;
  if v_color !~ '^#[0-9a-f]{6}$' then
    raise exception 'bad color' using errcode = '22023';
  end if;
  if jsonb_typeof(p_profile -> 'number') = 'number' then
    if (p_profile ->> 'number')::numeric not between 0 and 99 or (p_profile ->> 'number')::numeric % 1 <> 0 then
      raise exception 'bad number' using errcode = '22023';
    end if;
    v_number := (p_profile ->> 'number')::smallint;
  elsif coalesce(jsonb_typeof(p_profile -> 'number'), 'null') <> 'null' then
    raise exception 'bad number' using errcode = '22023';
  end if;
  if char_length(v_bio) > 140 or not racing_clean_text(v_bio) then
    raise exception 'bad bio' using errcode = '22023';
  end if;
  if v_car is not null and not nordschleife_valid_car_id(v_car || '@v0') then
    raise exception 'bad car' using errcode = '22023';
  end if;
  if not racing_valid_garage(v_garage) then
    raise exception 'bad garage' using errcode = '22023';
  end if;
  perform racing_rate_limit('player', 60, 1200);
  insert into racing_players as p (id, key_hash, name, avatar, color, number, bio, car, garage)
    values (p_id, encode(sha256(convert_to(p_key, 'UTF8')), 'hex'), v_name, v_avatar, v_color,
      v_number, v_bio, v_car, v_garage)
    on conflict (id) do update set
      name = excluded.name,
      avatar = excluded.avatar,
      color = excluded.color,
      number = excluded.number,
      bio = excluded.bio,
      car = excluded.car,
      garage = excluded.garage,
      updated_at = now()
    where p.key_hash = excluded.key_hash;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'that player belongs to another device' using errcode = '42501';
  end if;
end;
$$;

-- a device's own profile, gone. its laps stay on the board under their names
create or replace function public.racing_delete_player(p_id uuid, p_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform racing_rate_limit('player', 60, 1200);
  delete from racing_players
    where id = p_id and key_hash = encode(sha256(convert_to(coalesce(p_key, ''), 'UTF8')), 'hex');
  if not found then
    raise exception 'no player with that key' using errcode = '42501';
  end if;
end;
$$;

-- whose lap or run it is
alter table public.nordschleife_leaderboard
  add column if not exists player_id uuid references public.racing_players (id) on delete set null;
create index if not exists idx_nordschleife_leaderboard_player
  on public.nordschleife_leaderboard (player_id, lap_time_ms) where player_id is not null;
alter table public.drift_park_scores
  add column if not exists player_id uuid references public.racing_players (id) on delete set null;
create index if not exists idx_drift_park_scores_player
  on public.drift_park_scores (player_id, score desc) where player_id is not null;

-- a lap or run sent with a player's id and key (x-player-id, x-player-key) is
-- theirs, and a device that hasn't saved its profile yet gets one with the
-- lap's name. anything else through the api is nobody's, whatever the row
-- said. the sql editor (no request headers) keeps what it's given
create or replace function public.racing_attribute_player()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_headers json;
  v_id uuid;
  v_hash text;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    v_headers := null;
  end;
  if v_headers is null then
    return new;
  end if;
  new.player_id := null;
  if coalesce(v_headers ->> 'x-player-key', '') !~ '^[A-Za-z0-9_-]{32,128}$' then
    return new;
  end if;
  begin
    v_id := (v_headers ->> 'x-player-id')::uuid;
  exception when others then
    return new;
  end;
  if v_id is null then
    return new;
  end if;
  v_hash := encode(sha256(convert_to(v_headers ->> 'x-player-key', 'UTF8')), 'hex');
  insert into racing_players (id, key_hash, name) values (v_id, v_hash, btrim(new.name))
    on conflict (id) do nothing;
  if exists (select 1 from racing_players where id = v_id and key_hash = v_hash) then
    new.player_id := v_id;
  end if;
  return new;
end;
$$;

-- after the limits (triggers fire by name)
drop trigger if exists racing_attribute_lap on public.nordschleife_leaderboard;
create trigger racing_attribute_lap
  before insert on public.nordschleife_leaderboard
  for each row execute function public.racing_attribute_player();
drop trigger if exists racing_attribute_run on public.drift_park_scores;
create trigger racing_attribute_run
  before insert on public.drift_park_scores
  for each row execute function public.racing_attribute_player();

-- ---------------------------------------------------------------- boards

-- a driver on the boards: their profile's name, or the lap's for laps from
-- before profiles (or without one). the same name in any case is one driver
create or replace function public.racing_driver(p_profile_name text, p_name text)
returns text
language sql
immutable
as $$
  select lower(btrim(coalesce(p_profile_name, p_name)));
$$;

-- a board: each driver's best verified lap of a season ("@v6"), stock or
-- tuned, with any car or one. the api orders and pages it, e.g.
--   /rpc/nordschleife_board?p_season=@v6&p_tuned=true&order=lap_time_ms&limit=50
create or replace function public.nordschleife_board(p_season text, p_tuned boolean default false, p_car text default null)
returns setof public.nordschleife_leaderboard
language sql
stable
as $$
  select distinct on (public.racing_driver(p.name, l.name)) l.*
  from public.nordschleife_leaderboard l
  left join public.racing_players p on p.id = l.player_id
  where l.verified
    and p_season ~ '^@v[0-9]{1,3}$'
    and (p_car is null or public.nordschleife_valid_car_id(p_car || '@v0'))
    and l.car_id like coalesce(p_car, '%') || p_season || case when p_tuned then '~t%' else '' end
  order by public.racing_driver(p.name, l.name), l.lap_time_ms, l.created_at;
$$;

-- how a lap stands, for the game to say once it's in: whether it's verified,
-- its driver's best on its board without it (null for their first there),
-- where their best is now and how many drivers that board has
create or replace function public.nordschleife_lap_standing(p_lap_id uuid)
returns table (verified boolean, previous_ms integer, rank integer, drivers integer)
language sql
stable
as $$
  with lap as (
    select l.id, l.verified, l.lap_time_ms,
      public.racing_driver(p.name, l.name) as driver,
      '%' || substring(l.car_id from '@v[0-9]{1,3}') || case when l.car_id like '%~t%' then '~t%' else '' end as board
    from public.nordschleife_leaderboard l
    left join public.racing_players p on p.id = l.player_id
    where l.id = p_lap_id
  ),
  bests as (
    select public.racing_driver(p.name, b.name) as driver, min(b.lap_time_ms) as best_ms
    from lap
    join public.nordschleife_leaderboard b on b.verified and b.id <> lap.id and b.car_id like lap.board
    left join public.racing_players p on p.id = b.player_id
    group by 1
  ),
  mine as (
    select lap.verified, lap.driver,
      (select best_ms from bests where bests.driver = lap.driver) as previous_ms,
      lap.lap_time_ms
    from lap
  ),
  cur as (
    select mine.*, least(mine.previous_ms, case when mine.verified then mine.lap_time_ms end) as best_ms
    from mine
  )
  select cur.verified, cur.previous_ms,
    case when cur.best_ms is not null then
      1 + (select count(*)::integer from bests where bests.driver <> cur.driver and bests.best_ms < cur.best_ms)
    end,
    (select count(*)::integer from bests where bests.driver <> cur.driver)
      + case when cur.best_ms is not null then 1 else 0 end
  from cur;
$$;

-- the drift park's board: each driver's best run of a season ("@d1"), the
-- quicker lap on a tied score as on the device's own board
create or replace function public.drift_park_board(p_season text)
returns setof public.drift_park_scores
language sql
stable
as $$
  select distinct on (public.racing_driver(p.name, s.name)) s.*
  from public.drift_park_scores s
  left join public.racing_players p on p.id = s.player_id
  where p_season ~ '^@d[0-9]{1,3}$'
    and (s.car_id like '%' || p_season or s.car_id like '%' || p_season || '~t%')
  order by public.racing_driver(p.name, s.name), s.score desc, s.lap_time_ms, s.created_at;
$$;

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
-- everything but the key's hash, so the api has to name the columns it reads
revoke all on public.racing_players from anon, authenticated;
grant select (id, name, avatar, color, number, bio, car, garage, created_at, updated_at)
  on public.racing_players to anon, authenticated;

revoke all on function public.nordschleife_limit_lap_inserts() from public, anon, authenticated;
revoke all on function public.racing_client_net() from public, anon, authenticated;
revoke all on function public.racing_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.racing_attribute_player() from public, anon, authenticated;
revoke all on function public.racing_clean_text(text) from public, anon, authenticated;
revoke all on function public.racing_valid_garage(jsonb) from public, anon, authenticated;
revoke all on function public.racing_save_player(uuid, text, jsonb) from public;
grant execute on function public.racing_save_player(uuid, text, jsonb) to anon, authenticated;
revoke all on function public.racing_delete_player(uuid, text) from public;
grant execute on function public.racing_delete_player(uuid, text) to anon, authenticated;
revoke all on function public.racing_driver(text, text) from public;
grant execute on function public.racing_driver(text, text) to anon, authenticated;
revoke all on function public.nordschleife_board(text, boolean, text) from public;
grant execute on function public.nordschleife_board(text, boolean, text) to anon, authenticated;
revoke all on function public.nordschleife_lap_standing(uuid) from public;
grant execute on function public.nordschleife_lap_standing(uuid) to anon, authenticated;
revoke all on function public.drift_park_board(text) from public;
grant execute on function public.drift_park_board(text) to anon, authenticated;
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
