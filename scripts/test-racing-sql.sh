#!/usr/bin/env bash
# applies supabase/racing.sql twice to a throwaway local postgres (docker) with
# supabase-like roles and a supabase_realtime publication, then runs the checks.
set -euo pipefail

cd "$(dirname "$0")/.."
name="racing-sqltest-$$"
docker run -d --rm --name "$name" -e POSTGRES_PASSWORD=test postgres:16-alpine >/dev/null
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 60); do
  if docker exec "$name" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 0.5
done
sleep 1

psql() { docker exec -i "$name" psql -v ON_ERROR_STOP=1 -q -U postgres "$@"; }
psql <<'SQL'
create role anon nologin;
create role authenticated nologin;
grant usage on schema public to anon, authenticated;
-- the worst case: a project that still exposes new tables to the api roles by default
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
create publication supabase_realtime;
SQL
psql < supabase/racing.sql
psql < supabase/racing.sql
psql < supabase/racing.test.sql
psql -tc "select tablename from pg_publication_tables where pubname = 'supabase_realtime'"
