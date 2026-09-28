-- checks for supabase/racing.sql, run by scripts/test-racing-sql.sh against a
-- throwaway local postgres. every block raises on failure.
\set ON_ERROR_STOP on

select set_config('request.headers', '{"x-forwarded-for": "203.0.113.9"}', false);

do $$
declare
  lap uuid;
  ok boolean;
  samples jsonb := (select jsonb_agg(jsonb_build_object('t', g * 100, 'x', g, 'y', 0, 'z', 0, 'qx', 0, 'qy', 0, 'qz', 0, 'qw', 1)) from generate_series(0, 9) g);
begin
  set local role anon;
  insert into public.nordschleife_leaderboard (name, lap_time_ms, car_id) values ('QA racer', 480123, 'gt3rs@v3') returning id into lap;

  -- a matching ghost goes in and can be replaced (the client upserts)
  insert into public.nordschleife_ghost_replays (lap_id, lap_time_ms, car_id, samples) values (lap, 480123, 'gt3rs@v3', samples);
  insert into public.nordschleife_ghost_replays (lap_id, lap_time_ms, car_id, samples) values (lap, 480140, 'gt3rs@v3', samples)
    on conflict (lap_id) do update set samples = excluded.samples, lap_time_ms = excluded.lap_time_ms;

  -- a ghost for a different car or time is refused
  begin
    update public.nordschleife_ghost_replays set car_id = 'other@v3' where lap_id = lap;
    ok := true;
  exception when insufficient_privilege then ok := false;
  end;
  if ok then raise exception 'ghost with a different car was accepted'; end if;
  begin
    insert into public.nordschleife_ghost_replays (lap_id, lap_time_ms, car_id, samples)
      values (gen_random_uuid(), 480123, 'gt3rs@v3', samples);
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

  -- bad rows are refused by the checks
  begin insert into public.nordschleife_leaderboard (name, lap_time_ms, car_id) values ('x', 5, 'gt3rs@v3'); ok := true;
  exception when check_violation or insufficient_privilege then ok := false; end;
  if ok then raise exception 'a 5 ms lap was accepted'; end if;
  reset role;
end $$;

-- per ip cap: 30 laps per 10 minutes (one used above)
do $$
declare
  i int;
  limited boolean := false;
begin
  set local role anon;
  for i in 1 .. 31 loop
    begin
      insert into public.nordschleife_leaderboard (name, lap_time_ms, car_id) values ('QA spam', 400000 + i, 'gt3rs@v3');
    exception when sqlstate '53400' then limited := true; exit;
    end;
  end loop;
  reset role;
  if not limited then raise exception 'lap rate limit never kicked in'; end if;
end $$;

-- the sql editor (no request headers) isn't limited
select set_config('request.headers', '', false);
insert into public.nordschleife_leaderboard (name, lap_time_ms, car_id) values ('Admin', 400000, 'gt3rs@v3');

select 'racing sql tests passed' as result;
