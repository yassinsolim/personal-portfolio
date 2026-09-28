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

### The racing project

The racing game has its own free Supabase organization and project, **Nordschleife**
(ref `qdepbyxxzbdknkfgpwyl`, AWS `us-west-2`), so its Realtime messages count against
its own 2M a month and can't use up the quota of the shared project that WebStrafe runs
on (and the other way around). The old shared project (`axrljzcrlmliscstmctb`) keeps the
pre-season laps as history.

### Vercel setup

Set these in Vercel (Production and Preview) and redeploy:

- `NORDSCHLEIFE_SUPABASE_URL` = `https://qdepbyxxzbdknkfgpwyl.supabase.co`
- `NORDSCHLEIFE_SUPABASE_PUBLISHABLE_KEY` = the project's publishable key (Project Settings -> API Keys)
- `RACING_LEADERBOARD_TABLE` (optional, defaults to `nordschleife_leaderboard`)
- `RACING_GHOST_REPLAY_TABLE` (optional, defaults to `nordschleife_ghost_replays`)
- `RACING_LOBBY_CHANNEL_PREFIX` (optional, defaults to `nordschleife_lobby_v2`)

The old `RACING_SUPABASE_URL` / `RACING_SUPABASE_ANON_KEY` pointed at the shared project. They
were removed from Vercel and the build no longer reads them.

`npm run build` runs `scripts/write-racing-config.js` first. If the Supabase URL/key are set, it writes `static/config/racing.config.json`, then Webpack copies that file into `build/config/racing.config.json`.

The CSP `connect-src` in `vercel.json` and `bundler/webpack.dev.js` lists this project's https
and wss origins, and only those.

## 2) Tables, RLS and grants

Run `supabase/racing.sql` in the project's SQL editor. It is safe to run again, and sets up:

- `nordschleife_leaderboard`: public read, public insert through RLS checks: name 1 to 16
  chars with no control characters, lap 3 minutes to 2 hours (the client's own floor), and a
  `car_id` that is one of the game's cars plus the season tag and an optional garage tune code
  (`nordschleife_valid_car_id`; add a car there when `carOptions.ts` gets one).
- A trigger caps inserts at 30 laps per 10 minutes per client, and 300 per 10 minutes overall
  as a backstop. The client is the address Supabase's edge sets in `sb-forwarded-for`, else
  `cf-connecting-ip`, with IPv6 grouped by /64. Not `x-forwarded-for`: Supabase keeps whatever
  the client sent as its first entry. `sb-forwarded-for` is overwritten with the real address,
  and Cloudflare refuses a request that sets `cf-connecting-ip` itself (checked on the live
  project in September 2026).
- `nordschleife_ghost_replays`: public read, insert and update (the client upserts), but only
  for a real lap with the same car and lap time, 8 to 5001 samples, every sample an object and
  at most 1.5 MB. A ghost can only be replaced in the 15 minutes after it's written.
- `nordschleife_rate_events`: private, no access for the browser roles.
- Grants: anon/authenticated get select + insert on laps and select + insert + update on
  ghosts, nothing else (no delete, truncate or update on laps).
- The leaderboard table in the `supabase_realtime` publication, so boards refresh on new laps.

Test it locally first (docker, nothing touches the real project): `./scripts/test-racing-sql.sh`.

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
