-- checks for supabase/racing.sql, run by scripts/test-racing-sql.sh against a
-- throwaway local postgres. every block raises on failure.
\set ON_ERROR_STOP on

-- what supabase's edge passes for a client: its own address in
-- sb-forwarded-for and cf-connecting-ip, and x-forwarded-for with whatever the
-- client sent in front
select set_config('request.headers', '{"sb-forwarded-for": "203.0.113.9", "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "203.0.113.9"}', false);

do $$
declare
  lap uuid;
  ok boolean;
  samples jsonb := (select jsonb_agg(jsonb_build_object('t', g * 100, 'x', g, 'y', 0, 'z', 0, 'qx', 0, 'qy', 0, 'qz', 0, 'qw', 1)) from generate_series(0, 9) g);
begin
  set local role anon;
  insert into public.nordschleife_leaderboard (name, lap_time_ms, car_id) values ('QA racer', 480123, 'bmw-e92-m3@v3') returning id into lap;

  -- a matching ghost goes in and can be replaced (the client upserts)
  insert into public.nordschleife_ghost_replays (lap_id, lap_time_ms, car_id, samples) values (lap, 480123, 'bmw-e92-m3@v3', samples);
  insert into public.nordschleife_ghost_replays (lap_id, lap_time_ms, car_id, samples) values (lap, 480140, 'bmw-e92-m3@v3', samples)
    on conflict (lap_id) do update set samples = excluded.samples, lap_time_ms = excluded.lap_time_ms;

  -- a ghost for a different car or time is refused
  begin
    update public.nordschleife_ghost_replays set car_id = 'amg-one@v3' where lap_id = lap;
    ok := true;
  exception when insufficient_privilege then ok := false;
  end;
  if ok then raise exception 'ghost with a different car was accepted'; end if;
  begin
    insert into public.nordschleife_ghost_replays (lap_id, lap_time_ms, car_id, samples)
      values (gen_random_uuid(), 480123, 'bmw-e92-m3@v3', samples);
    ok := true;
  exception when insufficient_privilege or foreign_key_violation then ok := false;
  end;
  if ok then raise exception 'ghost without a lap was accepted'; end if;

  -- anon can't delete, truncate, or see the rate table
  begin delete from public.nordschleife_leaderboard; ok := true; exception when insufficient_privilege then ok := false; end;
  if ok then raise exception 'anon deleted laps'; end if;
  begin truncate public.nordschleife_ghost_replays; ok := true; exception when insufficient_privilege then ok := false; end;
  if ok then raise exception 'anon truncated ghosts'; end if;
  begin perform count(*) from public.nordschleife_rate_events; ok := true; exception when insufficient_privilege then ok := false; end;
  if ok then raise exception 'anon read the rate table'; end if;
  begin update public.nordschleife_leaderboard set lap_time_ms = 1000; ok := true; exception when insufficient_privilege then ok := false; end;
  if ok then raise exception 'anon updated a lap'; end if;
  reset role;
end $$;

-- rows the game can't produce are refused
do $$
declare
  ok boolean;
  lap uuid;
  bad record;
begin
  set local role anon;
  for bad in
    select * from (values
      ('QA', 5, 'bmw-e92-m3@v3', 'a 5 ms lap'),
      ('QA', 179999, 'bmw-e92-m3@v3', 'a lap under 3 minutes'),
      ('QA', 7200001, 'bmw-e92-m3@v3', 'a lap over 2 hours'),
      ('QA', 400000, 'gt3rs@v3', 'an unknown car'),
      ('QA', 400000, 'bmw-e92-m3', 'a car without a season tag'),
      ('QA', 400000, 'bmw-e92-m3@v3~tNOT_ok', 'a bad tune code'),
      ('QA', 400000, 'bmw-e92-m3@v3; drop', 'junk after the car id'),
      ('   ', 400000, 'bmw-e92-m3@v3', 'a blank name'),
      (E'QA\u0007x', 400000, 'bmw-e92-m3@v3', 'a control character in the name'),
      ('seventeen chars!!', 400000, 'bmw-e92-m3@v3', 'a 17 character name')
    ) as t(name, ms, car, what)
  loop
    begin
      insert into public.nordschleife_leaderboard (name, lap_time_ms, car_id) values (bad.name, bad.ms, bad.car);
      ok := true;
    exception when check_violation or insufficient_privilege then ok := false;
    end;
    if ok then raise exception '% was accepted', bad.what; end if;
  end loop;

  -- the edges and a tuned lap are fine
  insert into public.nordschleife_leaderboard (name, lap_time_ms, car_id) values ('QA', 180000, 'toyota-crown-platinum@v3');
  insert into public.nordschleife_leaderboard (name, lap_time_ms, car_id) values ('QA hyper', 180000, 'porsche-918-spyder@v4~t0a1b2c3d4ex4');
  insert into public.nordschleife_leaderboard (name, lap_time_ms, car_id) values ('QA w16', 180000, 'bugatti-chiron-super-sport@v4~t0a1b2c3d4exj21');
  insert into public.nordschleife_leaderboard (name, lap_time_ms, car_id) values ('QA tuned', 400000, 'amg-one@v3~t0a1b2c3d4e') returning id into lap;

  -- ghosts: every sample an object, and a size cap
  begin
    insert into public.nordschleife_ghost_replays (lap_id, lap_time_ms, car_id, samples)
      values (lap, 400000, 'amg-one@v3~t0a1b2c3d4e', (select jsonb_agg(g) from generate_series(1, 10) g));
    ok := true;
  exception when insufficient_privilege then ok := false;
  end;
  if ok then raise exception 'a ghost of plain numbers was accepted'; end if;
  begin
    insert into public.nordschleife_ghost_replays (lap_id, lap_time_ms, car_id, samples)
      values (lap, 400000, 'amg-one@v3~t0a1b2c3d4e',
        (select jsonb_agg(jsonb_build_object('t', g, 'pad', repeat('x', 500))) from generate_series(1, 5000) g));
    ok := true;
  exception when insufficient_privilege then ok := false;
  end;
  if ok then raise exception 'a 2.6 MB ghost was accepted'; end if;
  -- a tuned lap's ghost carries the tuned car id
  insert into public.nordschleife_ghost_replays (lap_id, lap_time_ms, car_id, samples)
    values (lap, 400000, 'amg-one@v3~t0a1b2c3d4e',
      (select jsonb_agg(jsonb_build_object('t', g * 100, 'x', g, 'y', 0, 'z', 0, 'qx', 0, 'qy', 0, 'qz', 0, 'qw', 1)) from generate_series(0, 9) g));
  reset role;
end $$;

-- an old ghost can't be rewritten
update public.nordschleife_ghost_replays set created_at = now() - interval '1 hour';
do $$
declare
  n integer;
begin
  set local role anon;
  update public.nordschleife_ghost_replays set samples = samples where true;
  get diagnostics n = row_count;
  reset role;
  if n > 0 then raise exception 'an hour old ghost was rewritten'; end if;
end $$;

-- per client cap: 30 laps per 10 minutes. a forged x-forwarded-for doesn't
-- give a fresh bucket, the key is the edge's own address
do $$
declare
  i int;
  limited boolean := false;
begin
  delete from public.nordschleife_rate_events;
  for i in 1 .. 31 loop
    perform set_config('request.headers',
      json_build_object('sb-forwarded-for', '203.0.113.9', 'cf-connecting-ip', '203.0.113.9',
        'x-forwarded-for', format('10.0.%s.1, 203.0.113.9', i))::text, true);
    set local role anon;
    begin
      insert into public.nordschleife_leaderboard (name, lap_time_ms, car_id) values ('QA spam', 400000 + i, 'bmw-e92-m3@v3');
    exception when sqlstate '53400' then limited := true;
    end;
    reset role;
    exit when limited;
  end loop;
  if not limited then raise exception 'a forged x-forwarded-for dodged the lap limit'; end if;
end $$;

-- another client still gets in, and an ipv6 /64 counts as one client
do $$
declare
  i int;
  limited boolean := false;
begin
  perform set_config('request.headers', '{"sb-forwarded-for": "198.51.100.7"}', true);
  set local role anon;
  insert into public.nordschleife_leaderboard (name, lap_time_ms, car_id) values ('QA other', 400000, 'bmw-f82-m4@v3');
  reset role;
  for i in 1 .. 31 loop
    perform set_config('request.headers', json_build_object('cf-connecting-ip', format('2001:db8:1:2::%s', to_hex(i)))::text, true);
    set local role anon;
    begin
      insert into public.nordschleife_leaderboard (name, lap_time_ms, car_id) values ('QA v6', 400000 + i, 'bmw-f82-m4@v3');
    exception when sqlstate '53400' then limited := true;
    end;
    reset role;
    exit when limited;
  end loop;
  if not limited then raise exception 'rotating addresses inside one /64 dodged the lap limit'; end if;
end $$;

-- the global backstop: 300 laps per 10 minutes across every client
do $$
declare
  ok boolean;
begin
  delete from public.nordschleife_rate_events;
  insert into public.nordschleife_rate_events (bucket) select md5(g::text) from generate_series(1, 300) g;
  perform set_config('request.headers', '{"sb-forwarded-for": "192.0.2.44"}', true);
  set local role anon;
  begin
    insert into public.nordschleife_leaderboard (name, lap_time_ms, car_id) values ('QA late', 400000, 'bmw-e92-m3@v3');
    ok := true;
  exception when sqlstate '53400' then ok := false;
  end;
  reset role;
  if ok then raise exception 'the global lap cap never kicked in'; end if;
  delete from public.nordschleife_rate_events;
end $$;

-- the drift park's runs: a real one goes in, scores the game can't make don't,
-- and anon can't change or remove them
select set_config('request.headers', '{"sb-forwarded-for": "203.0.113.77"}', false);
do $$
declare
  ok boolean;
  bad record;
begin
  delete from public.nordschleife_rate_events;
  set local role anon;
  insert into public.drift_park_scores (name, score, lap_time_ms, car_id) values ('QA drifter', 42000, 82000, 'bmw-e92-m3@d1');
  insert into public.drift_park_scores (name, score, lap_time_ms, car_id) values ('QA tuned', 60000, 75000, 'amg-one@d1~t0a1b2');
  for bad in
    select * from (values
      ('QA', 0, 82000, 'bmw-e92-m3@d1', 'a run with no score'),
      ('QA', 120000, 82000, 'bmw-e92-m3@d1', 'more than 1.3 points a millisecond'),
      ('QA', 1000, 29999, 'bmw-e92-m3@d1', 'a park lap under 30 s'),
      ('QA', 1000, 82000, 'bmw-e92-m3@v6', 'the ring season tag'),
      ('QA', 1000, 82000, 'gt3rs@d1', 'an unknown car'),
      ('   ', 1000, 82000, 'bmw-e92-m3@d1', 'a blank name')
    ) as t(name, score, ms, car, what)
  loop
    begin
      insert into public.drift_park_scores (name, score, lap_time_ms, car_id) values (bad.name, bad.score, bad.ms, bad.car);
      ok := true;
    exception when check_violation or insufficient_privilege then ok := false;
    end;
    if ok then raise exception '% was accepted', bad.what; end if;
  end loop;
  begin delete from public.drift_park_scores; ok := true; exception when insufficient_privilege then ok := false; end;
  if ok then raise exception 'anon deleted drift runs'; end if;
  begin update public.drift_park_scores set score = 2000000; ok := true; exception when insufficient_privilege then ok := false; end;
  if ok then raise exception 'anon updated a drift run'; end if;
  reset role;
  if (select count(*) from public.drift_park_scores) <> 2 then raise exception 'drift runs went missing'; end if;
  delete from public.nordschleife_rate_events;
end $$;

-- a lap shows on the board once its ghost drove the whole ring forward from
-- the line. a full lap is verified; backing over the line and coming back up
-- the straight (the 5:02 of october 2026), half a lap, or a ghost whose clock
-- doesn't end on the lap's time aren't. the api can't insert a verified lap
select set_config('request.headers', '{"sb-forwarded-for": "203.0.113.120"}', false);
do $$
declare
  cp integer[] := public.nordschleife_lap_checkpoints();
  n integer := array_length(cp, 1) / 2;
  lap uuid;
  ok boolean;
  test record;
begin
  if n <> 200 then raise exception 'expected 200 checkpoints, got %', n; end if;
  delete from public.nordschleife_rate_events;
  for test in
    with steps(what, lap_ms, path, step_ms, verified) as (values
      -- the line, then every checkpoint in order
      ('a full lap', 400000, array[n] || array(select generate_series(1, n)), 2000, true),
      -- the line, back 30 checkpoints the wrong way, then forward over the line
      ('backing over the line and coming back', 240000,
        array[n] || array(select n - k from generate_series(1, 30) k) || array(select n - 30 + k from generate_series(1, 30) k),
        4000, false),
      ('half a lap and back to the line', 202000, array[n] || array(select generate_series(1, 100)) || array[n], 2000, false),
      ('a ghost ending well before the lap', 400000, array[n] || array(select generate_series(1, n)), 1500, false)
    )
    select what, lap_ms, verified, (
      select jsonb_agg(sample order by o) from (
        select o, jsonb_build_object('t', (o - 1) * step_ms, 'x', cp[2 * k - 1], 'y', 0, 'z', cp[2 * k],
          'qx', 0, 'qy', 0, 'qz', 0, 'qw', 1) as sample
        from unnest(path) with ordinality as p(k, o)
        union all
        -- the recording closes on its first pose at the lap's time
        select array_length(path, 1) + 1, jsonb_build_object('t', (array_length(path, 1) - 1) * step_ms, 'x', cp[2 * n - 1],
          'y', 0, 'z', cp[2 * n], 'qx', 0, 'qy', 0, 'qz', 0, 'qw', 1)
      ) samples
    ) as samples
    from steps
  loop
    set local role anon;
    insert into public.nordschleife_leaderboard (name, lap_time_ms, car_id)
      values ('QA verify', test.lap_ms, 'bmw-e92-m3@v6') returning id into lap;
    if (select verified from public.nordschleife_leaderboard where id = lap) then
      raise exception 'a lap was verified before its ghost';
    end if;
    insert into public.nordschleife_ghost_replays (lap_id, lap_time_ms, car_id, samples)
      values (lap, test.lap_ms, 'bmw-e92-m3@v6', test.samples);
    if (select verified from public.nordschleife_leaderboard where id = lap) is distinct from test.verified then
      raise exception '%: verified should be %', test.what, test.verified;
    end if;
    -- the ghost the client upserts again is checked again
    if test.verified then
      update public.nordschleife_ghost_replays set samples = samples - 50 where lap_id = lap;
      if (select verified from public.nordschleife_leaderboard where id = lap) then
        raise exception 'a ghost missing a checkpoint kept its lap verified';
      end if;
    end if;
    reset role;
  end loop;

  set local role anon;
  begin
    insert into public.nordschleife_leaderboard (name, lap_time_ms, car_id, verified)
      values ('QA cheat', 190000, 'bmw-e92-m3@v6', true);
    ok := true;
  exception when insufficient_privilege then ok := false;
  end;
  if ok then raise exception 'anon inserted a verified lap'; end if;
  begin
    perform public.nordschleife_replay_drives_lap('[]'::jsonb, 1000);
    ok := true;
  exception when insufficient_privilege then ok := false;
  end;
  if ok then raise exception 'anon can run the replay check'; end if;
  reset role;
  delete from public.nordschleife_rate_events;
end $$;

-- a removed lap goes with its ghost and is listed with why, which anyone can
-- read and only the sql editor can write
do $$
declare
  lap uuid;
  ok boolean;
begin
  insert into public.nordschleife_leaderboard (name, lap_time_ms, car_id)
    values ('QA unfair', 302406, 'bugatti-chiron-super-sport@v6~ti1iiiiiiizy0tz08') returning id into lap;
  insert into public.nordschleife_ghost_replays (lap_id, lap_time_ms, car_id, samples)
    values (lap, 302406, 'bugatti-chiron-super-sport@v6~ti1iiiiiiizy0tz08',
      (select jsonb_agg(jsonb_build_object('t', g)) from generate_series(0, 7) g));
  perform public.nordschleife_remove_lap(lap, 'QA: it backed over the line');
  if exists (select 1 from public.nordschleife_leaderboard where id = lap) then raise exception 'the lap stayed'; end if;
  if exists (select 1 from public.nordschleife_ghost_replays where lap_id = lap) then raise exception 'its ghost stayed'; end if;
  begin
    perform public.nordschleife_remove_lap(gen_random_uuid(), 'QA');
    ok := true;
  exception when raise_exception then ok := false;
  end;
  if ok then raise exception 'removing a lap that isn''t there passed'; end if;

  set local role anon;
  if (select reason from public.nordschleife_removed_laps where lap_id = lap) is distinct from 'QA: it backed over the line' then
    raise exception 'anon can''t read why a lap was removed';
  end if;
  begin
    insert into public.nordschleife_removed_laps (lap_id, name, lap_time_ms, car_id, reason)
      values (gen_random_uuid(), 'QA', 1, 'x', 'x');
    ok := true;
  exception when insufficient_privilege then ok := false;
  end;
  if ok then raise exception 'anon listed a removed lap'; end if;
  begin delete from public.nordschleife_removed_laps; ok := true; exception when insufficient_privilege then ok := false; end;
  if ok then raise exception 'anon deleted removed laps'; end if;
  begin
    perform public.nordschleife_remove_lap(gen_random_uuid(), 'QA');
    ok := true;
  exception when insufficient_privilege then ok := false;
  end;
  if ok then raise exception 'anon can remove laps'; end if;
  reset role;
end $$;

-- profiles: made and changed with the device's key and nothing else, the
-- key's hash unreadable, the table closed to writes, fields the game can't
-- make refused
select set_config('request.headers', '{"sb-forwarded-for": "203.0.113.200"}', false);
do $$
declare
  me uuid := gen_random_uuid();
  key text := repeat('k', 43);
  ok boolean;
  bad record;
  saved record;
begin
  delete from public.nordschleife_rate_events;
  set local role anon;
  perform public.racing_save_player(me, key, '{"name": "QA Driver", "avatar": "bolt", "color": "#1F4FA8", "number": 7,
    "bio": "Late on the brakes", "car": "bmw-e92-m3",
    "garage": {"bmw-e92-m3": {"look": "1f4fa8.2....0.-3", "tune": "ihhhhhhhhh"}, "amg-one": {"look": "", "tune": ""}}}');
  select name, avatar, color, number, bio, car, garage into saved from public.racing_players where id = me;
  if saved.name <> 'QA Driver' or saved.avatar <> 'bolt' or saved.color <> '#1f4fa8' or saved.number <> 7
     or saved.bio <> 'Late on the brakes' or saved.car <> 'bmw-e92-m3' or saved.garage -> 'bmw-e92-m3' ->> 'tune' <> 'ihhhhhhhhh' then
    raise exception 'the profile didn''t save: %', saved;
  end if;
  perform public.racing_save_player(me, key, '{"name": "QA Renamed", "number": null}');
  select name, number, car into saved from public.racing_players where id = me;
  if saved.name <> 'QA Renamed' or saved.number is not null or saved.car is not null then
    raise exception 'the profile didn''t change: %', saved;
  end if;
  begin
    perform public.racing_save_player(me, repeat('x', 43), '{"name": "QA Thief"}');
    ok := true;
  exception when insufficient_privilege then ok := false;
  end;
  if ok then raise exception 'another key changed the profile'; end if;

  begin perform key_hash from public.racing_players; ok := true; exception when insufficient_privilege then ok := false; end;
  if ok then raise exception 'anon read a key hash'; end if;
  begin update public.racing_players set name = 'QA' where id = me; ok := true; exception when insufficient_privilege then ok := false; end;
  if ok then raise exception 'anon updated a profile'; end if;
  begin
    insert into public.racing_players (id, key_hash, name) values (gen_random_uuid(), repeat('0', 64), 'QA');
    ok := true;
  exception when insufficient_privilege then ok := false;
  end;
  if ok then raise exception 'anon inserted a profile'; end if;
  begin delete from public.racing_players; ok := true; exception when insufficient_privilege then ok := false; end;
  if ok then raise exception 'anon deleted profiles'; end if;

  for bad in
    select * from (values
      ('{"name": "   "}', 'a blank name'),
      ('{"name": "seventeen chars!!"}', 'a 17 character name'),
      ('{"name": "QA\u0007"}', 'a control character in the name'),
      ('{"name": "QA\u202ex"}', 'a right to left override in the name'),
      ('{"name": "QA", "avatar": "<b>"}', 'a bad avatar'),
      ('{"name": "QA", "color": "red"}', 'a color that isn''t hex'),
      ('{"name": "QA", "number": 100}', 'number 100'),
      ('{"name": "QA", "number": 4.5}', 'a fractional number'),
      ('{"name": "QA", "number": "7"}', 'a number as text'),
      ('{"name": "QA", "car": "gt3rs"}', 'an unknown car'),
      ('{"name": "QA", "car": "amg-one@v6"}', 'a car with a season tag'),
      ('{"name": "QA", "bio": "' || repeat('x', 141) || '"}', 'a 141 character bio'),
      ('{"name": "QA", "bio": "two\nlines"}', 'a line break in the bio'),
      ('{"name": "QA", "garage": {"gt3rs": {"look": ""}}}', 'a garage with an unknown car'),
      ('{"name": "QA", "garage": {"amg-one": {"look": "<b>"}}}', 'a look code with markup'),
      ('{"name": "QA", "garage": {"amg-one": {"paint": "x"}}}', 'a garage entry with other fields'),
      ('{"name": "QA", "garage": {"amg-one": {"tune": 5}}}', 'a tune that isn''t text'),
      ('{"name": "QA", "garage": []}', 'a garage that isn''t an object'),
      ('[]', 'a profile that isn''t an object')
    ) as t(profile, what)
  loop
    begin
      perform public.racing_save_player(me, key, bad.profile::jsonb);
      ok := true;
    exception when invalid_parameter_value then ok := false;
    end;
    if ok then raise exception '% was accepted', bad.what; end if;
  end loop;
  begin
    perform public.racing_save_player(me, 'short', '{"name": "QA"}');
    ok := true;
  exception when invalid_parameter_value then ok := false;
  end;
  if ok then raise exception 'a short key was accepted'; end if;
  begin
    perform public.racing_rate_limit('player', 1, 1);
    ok := true;
  exception when insufficient_privilege then ok := false;
  end;
  if ok then raise exception 'anon can run the rate limiter'; end if;
  reset role;
  delete from public.nordschleife_rate_events;
end $$;

-- laps and runs sent with a player's key are theirs, a device that hasn't
-- saved its profile yet gets one with the lap's name, a wrong key or a
-- player_id in the row gets nobody, and a deleted profile leaves its laps
do $$
declare
  me uuid := gen_random_uuid();
  fresh uuid := gen_random_uuid();
  key text := repeat('m', 43);
  lap uuid;
  ok boolean;
begin
  delete from public.nordschleife_rate_events;
  perform set_config('request.headers', '{"sb-forwarded-for": "203.0.113.201"}', true);
  set local role anon;
  perform public.racing_save_player(me, key, '{"name": "QA Owner"}');
  reset role;

  perform set_config('request.headers',
    json_build_object('sb-forwarded-for', '203.0.113.201', 'x-player-id', me, 'x-player-key', key)::text, true);
  set local role anon;
  insert into public.nordschleife_leaderboard (name, lap_time_ms, car_id)
    values ('QA Owner', 400000, 'bmw-e92-m3@v6') returning id into lap;
  reset role;
  if (select player_id from public.nordschleife_leaderboard where id = lap) is distinct from me then
    raise exception 'a lap sent with the key wasn''t the player''s';
  end if;

  perform set_config('request.headers',
    json_build_object('sb-forwarded-for', '203.0.113.201', 'x-player-id', me, 'x-player-key', repeat('z', 43))::text, true);
  set local role anon;
  insert into public.nordschleife_leaderboard (name, lap_time_ms, car_id, player_id)
    values ('QA Imposter', 400001, 'bmw-e92-m3@v6', me) returning id into lap;
  reset role;
  if (select player_id from public.nordschleife_leaderboard where id = lap) is not null then
    raise exception 'a wrong key got the player''s lap';
  end if;

  perform set_config('request.headers', '{"sb-forwarded-for": "203.0.113.201"}', true);
  set local role anon;
  insert into public.nordschleife_leaderboard (name, lap_time_ms, car_id, player_id)
    values ('QA Forged', 400002, 'bmw-e92-m3@v6', me) returning id into lap;
  reset role;
  if (select player_id from public.nordschleife_leaderboard where id = lap) is not null then
    raise exception 'a player_id in the row stuck';
  end if;

  perform set_config('request.headers',
    json_build_object('sb-forwarded-for', '203.0.113.201', 'x-player-id', fresh, 'x-player-key', key)::text, true);
  set local role anon;
  insert into public.drift_park_scores (name, score, lap_time_ms, car_id)
    values ('QA Fresh', 42000, 82000, 'bmw-e92-m3@d1') returning id into lap;
  reset role;
  if (select player_id from public.drift_park_scores where id = lap) is distinct from fresh then
    raise exception 'a fresh device''s run wasn''t theirs';
  end if;
  if (select name from public.racing_players where id = fresh) is distinct from 'QA Fresh' then
    raise exception 'the fresh device''s profile didn''t take the run''s name';
  end if;

  perform set_config('request.headers', '{"sb-forwarded-for": "203.0.113.201"}', true);
  set local role anon;
  begin
    perform public.racing_delete_player(me, repeat('z', 43));
    ok := true;
  exception when insufficient_privilege then ok := false;
  end;
  if ok then raise exception 'another key deleted the profile'; end if;
  perform public.racing_delete_player(me, key);
  reset role;
  if exists (select 1 from public.racing_players where id = me) then raise exception 'the profile stayed'; end if;
  if not exists (select 1 from public.nordschleife_leaderboard where name = 'QA Owner' and player_id is null) then
    raise exception 'the lap went with its profile';
  end if;
  delete from public.nordschleife_rate_events;
end $$;

-- 60 profile saves per client per 10 minutes, counted apart from laps
do $$
declare
  me uuid := gen_random_uuid();
  i int;
  limited_at int;
begin
  delete from public.nordschleife_rate_events;
  perform set_config('request.headers', '{"sb-forwarded-for": "203.0.113.202"}', true);
  set local role anon;
  for i in 1 .. 61 loop
    begin
      perform public.racing_save_player(me, repeat('r', 43), jsonb_build_object('name', 'QA ' || i));
    exception when sqlstate '53400' then limited_at := i;
    end;
    exit when limited_at is not null;
  end loop;
  insert into public.nordschleife_leaderboard (name, lap_time_ms, car_id) values ('QA busy', 400000, 'bmw-e92-m3@v6');
  reset role;
  if limited_at is distinct from 61 then raise exception 'profile saves were limited at %, not the 61st', limited_at; end if;
  delete from public.nordschleife_rate_events;
end $$;

-- the sql editor (no request headers) isn't limited
select set_config('request.headers', '', false);
insert into public.nordschleife_leaderboard (name, lap_time_ms, car_id) values ('Admin', 400000, 'bmw-e92-m3@v3');

-- the boards are each driver's best: a driver is their profile's name or the
-- lap's, in any case. unverified laps, other seasons and the other board
-- don't count, and a lap says how it stands
do $$
declare
  pro uuid := gen_random_uuid();
  ann_first uuid;
  ann_best uuid;
  ann_unverified uuid;
  pro_slow uuid;
  cat_tuned uuid;
  got text;
  standing record;
begin
  insert into public.racing_players (id, key_hash, name) values (pro, repeat('0', 64), 'QA Pro');
  insert into public.nordschleife_leaderboard (name, lap_time_ms, car_id, verified)
    values ('QA Ann', 400000, 'bmw-e92-m3@v99', true) returning id into ann_first;
  insert into public.nordschleife_leaderboard (name, lap_time_ms, car_id, verified)
    values ('qa ann ', 390000, 'amg-one@v99', true) returning id into ann_best;
  insert into public.nordschleife_leaderboard (name, lap_time_ms, car_id, verified)
    values ('QA Ann', 380000, 'amg-one@v99', false) returning id into ann_unverified;
  insert into public.nordschleife_leaderboard (name, lap_time_ms, car_id, verified, player_id)
    values ('QA Old Name', 385000, 'bmw-e92-m3@v99', true, pro);
  insert into public.nordschleife_leaderboard (name, lap_time_ms, car_id, verified)
    values ('QA Pro', 405000, 'amg-one@v99', true) returning id into pro_slow;
  insert into public.nordschleife_leaderboard (name, lap_time_ms, car_id, verified) values
    ('QA Bob', 395000, 'bmw-e92-m3@v99', true),
    ('QA Bob', 370000, 'bmw-e92-m3@v99~tabc', true),
    ('QA Ann', 360000, 'amg-one@v99~tzz', true),
    ('QA Bob', 300000, 'bmw-e92-m3@v9', true),
    ('QA Bob', 300000, 'bmw-e92-m3@v999', true);
  insert into public.nordschleife_leaderboard (name, lap_time_ms, car_id, verified)
    values ('QA Cat', 365000, 'bmw-e92-m3@v99~tq1', true) returning id into cat_tuned;

  set local role anon;
  select string_agg(name || ' ' || lap_time_ms, ', ' order by lap_time_ms) into got
    from public.nordschleife_board('@v99');
  if got is distinct from 'QA Old Name 385000, qa ann  390000, QA Bob 395000' then
    raise exception 'the stock board was %', got;
  end if;
  select string_agg(name || ' ' || lap_time_ms, ', ' order by lap_time_ms) into got
    from public.nordschleife_board('@v99', false, 'amg-one');
  if got is distinct from 'qa ann  390000, QA Pro 405000' then
    raise exception 'the stock board with one car was %', got;
  end if;
  select string_agg(name || ' ' || lap_time_ms, ', ' order by lap_time_ms) into got
    from public.nordschleife_board('@v99', true);
  if got is distinct from 'QA Ann 360000, QA Cat 365000, QA Bob 370000' then
    raise exception 'the tuned board was %', got;
  end if;
  if exists (select 1 from public.nordschleife_board('@v99', false, '%'))
     or exists (select 1 from public.nordschleife_board('v99'))
     or exists (select 1 from public.nordschleife_board('%')) then
    raise exception 'a board read with a pattern';
  end if;

  select * into standing from public.nordschleife_lap_standing(ann_best);
  if standing is distinct from row(true, 400000, 2, 3)::record then
    raise exception 'a new best stood as %', standing;
  end if;
  select * into standing from public.nordschleife_lap_standing(ann_unverified);
  if standing is distinct from row(false, 390000, 2, 3)::record then
    raise exception 'an unverified lap stood as %', standing;
  end if;
  select * into standing from public.nordschleife_lap_standing(pro_slow);
  if standing is distinct from row(true, 385000, 1, 3)::record then
    raise exception 'a slower lap stood as %', standing;
  end if;
  select * into standing from public.nordschleife_lap_standing(cat_tuned);
  if standing is distinct from row(true, null::integer, 2, 3)::record then
    raise exception 'a first tuned lap stood as %', standing;
  end if;
  if exists (select 1 from public.nordschleife_lap_standing(gen_random_uuid())) then
    raise exception 'a lap that isn''t there stood';
  end if;
  reset role;

  insert into public.drift_park_scores (name, score, lap_time_ms, car_id) values
    ('QA Ann', 50000, 82000, 'bmw-e92-m3@d99'),
    ('qa ann', 60000, 82000, 'amg-one@d99~tx'),
    ('QA Bob', 55000, 82000, 'bmw-e92-m3@d99'),
    ('QA Bob', 99999, 82000, 'bmw-e92-m3@d999');
  set local role anon;
  select string_agg(name || ' ' || score, ', ' order by score desc) into got
    from public.drift_park_board('@d99');
  if got is distinct from 'qa ann 60000, QA Bob 55000' then
    raise exception 'the drift board was %', got;
  end if;
  reset role;

  delete from public.nordschleife_leaderboard where car_id like '%@v9%';
  delete from public.drift_park_scores where car_id like '%@d99%';
  delete from public.racing_players where id = pro;
end $$;

select 'racing sql tests passed' as result;
