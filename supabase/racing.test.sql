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

-- the sql editor (no request headers) isn't limited
select set_config('request.headers', '', false);
insert into public.nordschleife_leaderboard (name, lap_time_ms, car_id) values ('Admin', 400000, 'bmw-e92-m3@v3');

select 'racing sql tests passed' as result;
