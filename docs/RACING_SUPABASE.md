# Supabase Leaderboard Setup

This project uses an optional runtime config file for online race leaderboard writes/reads.

## 1) Create runtime config

Copy:

`static/config/racing.config.example.json` -> `static/config/racing.config.json`

Fill:

- `supabaseUrl`
- `supabaseAnonKey`
- `leaderboardTable` (default: `nordschleife_leaderboard`)

If `static/config/racing.config.json` is missing or invalid, the app automatically falls back to localStorage leaderboard.

## 2) Create table in Supabase

```sql
create table if not exists public.nordschleife_leaderboard (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  lap_time_ms integer not null check (lap_time_ms > 0),
  car_id text not null,
  created_at timestamptz not null default now()
);

alter table public.nordschleife_leaderboard enable row level security;

create policy "public read laps"
on public.nordschleife_leaderboard
for select
using (true);

create policy "public insert laps"
on public.nordschleife_leaderboard
for insert
with check (true);
```

## 3) Verify

- Start race mode, complete a valid lap, submit a name.
- Refresh and verify row appears in leaderboard.
- Remove/rename config file and verify local fallback still works.
