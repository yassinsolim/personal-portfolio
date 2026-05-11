const fs = require('fs');
const path = require('path');

const configPath = path.resolve(__dirname, '../static/config/racing.config.json');

const first = (...values) =>
    values.find((value) => typeof value === 'string' && value.trim());

const config = {
    supabaseUrl: first(
        process.env.RACING_SUPABASE_URL,
        process.env.SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_URL
    ),
    supabaseAnonKey: first(
        process.env.RACING_SUPABASE_ANON_KEY,
        process.env.SUPABASE_ANON_KEY,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ),
    leaderboardTable:
        first(process.env.RACING_LEADERBOARD_TABLE) ||
        'nordschleife_leaderboard',
    ghostReplayTable:
        first(process.env.RACING_GHOST_REPLAY_TABLE) ||
        'nordschleife_ghost_replays',
    lobbyChannelPrefix:
        first(process.env.RACING_LOBBY_CHANNEL_PREFIX) ||
        'nordschleife_lobby_v1',
};

if (!config.supabaseUrl || !config.supabaseAnonKey) {
    if (fs.existsSync(configPath)) {
        console.log(
            '[racing-config] Supabase env vars not set; keeping existing static config.'
        );
        process.exit(0);
    }

    console.log(
        '[racing-config] Supabase env vars not set; racing will use local leaderboard fallback.'
    );
    process.exit(0);
}

fs.mkdirSync(path.dirname(configPath), { recursive: true });
fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`[racing-config] Wrote ${path.relative(process.cwd(), configPath)}.`);
