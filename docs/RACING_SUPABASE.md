# Supabase Multiplayer + Leaderboard Setup

This project uses an optional runtime config file for:

- Global leaderboard persistence (Postgres table)
- Multiplayer lobbies (Supabase Realtime presence + broadcast)

If `static/config/racing.config.json` is missing or invalid, the app keeps working in solo mode and falls back to localStorage leaderboard.

## 1) Runtime config

Copy:

`static/config/racing.config.example.json` -> `static/config/racing.config.json`

Fill:

- `supabaseUrl`
- `supabaseAnonKey`
- `leaderboardTable` (default: `nordschleife_leaderboard`)
- `ghostReplayTable` (default: `nordschleife_ghost_replays`)
- `lobbyChannelPrefix` (default: `nordschleife_lobby_v1`)

Important security note:

- Use only the **anon public key** in this client config.
- Never put a service-role key in frontend files.

## 2) Secure leaderboard table

Run in Supabase SQL editor:

```sql
create table if not exists public.nordschleife_leaderboard (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 16),
  lap_time_ms integer not null check (lap_time_ms between 1000 and 7200000),
  car_id text not null check (char_length(car_id) between 1 and 64),
  created_at timestamptz not null default now()
);

alter table public.nordschleife_leaderboard enable row level security;

drop policy if exists "public read laps" on public.nordschleife_leaderboard;
drop policy if exists "public insert laps" on public.nordschleife_leaderboard;

create policy "public read laps"
on public.nordschleife_leaderboard
for select
to anon, authenticated
using (true);

create policy "public insert laps"
on public.nordschleife_leaderboard
for insert
to anon, authenticated
with check (
  char_length(name) between 1 and 16
  and lap_time_ms between 1000 and 7200000
  and char_length(car_id) between 1 and 64
);
```

## 3) Realtime for leaderboard updates

In Supabase:

- Database -> Replication -> enable replication for `public.nordschleife_leaderboard`

The app subscribes to `INSERT` events and refreshes leaderboard automatically when anyone submits a lap.

## 3b) Ghost replay table for leaderboard #1 ghost

Run in Supabase SQL editor:

```sql
create table if not exists public.nordschleife_ghost_replays (
  lap_id uuid primary key references public.nordschleife_leaderboard(id) on delete cascade,
  lap_time_ms integer not null check (lap_time_ms between 1000 and 7200000),
  car_id text not null check (char_length(car_id) between 1 and 64),
  samples jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.nordschleife_ghost_replays enable row level security;

drop policy if exists "public read ghost replays" on public.nordschleife_ghost_replays;
drop policy if exists "public insert ghost replays" on public.nordschleife_ghost_replays;

create policy "public read ghost replays"
on public.nordschleife_ghost_replays
for select
to anon, authenticated
using (true);

create policy "public insert ghost replays"
on public.nordschleife_ghost_replays
for insert
to anon, authenticated
with check (
  lap_time_ms between 1000 and 7200000
  and char_length(car_id) between 1 and 64
);

drop policy if exists "public update ghost replays" on public.nordschleife_ghost_replays;
create policy "public update ghost replays"
on public.nordschleife_ghost_replays
for update
to anon, authenticated
using (true)
with check (
  lap_time_ms between 1000 and 7200000
  and char_length(car_id) between 1 and 64
);
```

## 4) Realtime for multiplayer lobbies

The app uses Realtime channels with presence + broadcast:

- Create Lobby
- Join Lobby by code
- Play Solo

No additional table is required for lobby transport. Lobby codes are random and sanitized client-side.

## 5) Verification checklist

1. Open two browsers/windows with the same build.
2. In one client: `Create Lobby`.
3. In the other: `Join` with the code.
4. Confirm both players appear in the lobby panel and progress updates while driving.
5. Complete a valid lap and submit a name in one client.
6. Confirm:
   - Lobby lap list updates for both clients.
   - Global leaderboard updates for both clients.
