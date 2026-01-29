import { SupabaseClient, createClient } from '@supabase/supabase-js';
import LocalLeaderboard, { LeaderboardEntry } from './LocalLeaderboard';

type SupabaseConfig = {
    supabaseUrl: string;
    supabaseAnonKey: string;
    leaderboardTable?: string;
};

const DEFAULT_TABLE = 'nordschleife_leaderboard';
const CONFIG_URL = '/config/racing.config.json';

type RemoteLeaderboardRow = {
    id: string;
    name: string;
    lap_time_ms: number;
    car_id: string;
    created_at: string;
};

export default class LeaderboardService {
    local: LocalLeaderboard;
    supabase: SupabaseClient | null;
    tableName: string;
    initialized: boolean;
    initPromise: Promise<void> | null;
    missingConfigLogged: boolean;

    constructor(local: LocalLeaderboard) {
        this.local = local;
        this.supabase = null;
        this.tableName = DEFAULT_TABLE;
        this.initialized = false;
        this.initPromise = null;
        this.missingConfigLogged = false;
    }

    async initialize() {
        if (this.initialized) return;
        if (this.initPromise) {
            await this.initPromise;
            return;
        }

        this.initPromise = this.loadSupabaseConfig();
        await this.initPromise;
        this.initialized = true;
    }

    async loadSupabaseConfig() {
        try {
            const response = await fetch(CONFIG_URL, {
                cache: 'no-store',
            });

            if (!response.ok) {
                this.logConfigFallback();
                return;
            }

            const config = (await response.json()) as Partial<SupabaseConfig>;

            if (!config.supabaseUrl || !config.supabaseAnonKey) {
                this.logConfigFallback();
                return;
            }

            this.tableName = config.leaderboardTable || DEFAULT_TABLE;
            this.supabase = createClient(
                config.supabaseUrl,
                config.supabaseAnonKey,
                {
                    auth: {
                        persistSession: false,
                        autoRefreshToken: false,
                    },
                }
            );
        } catch (error) {
            this.logConfigFallback();
        }
    }

    logConfigFallback() {
        if (this.missingConfigLogged) return;
        this.missingConfigLogged = true;
        console.info(
            `[Leaderboard] Using local fallback. Missing or invalid ${CONFIG_URL}.`
        );
    }

    async getLeaderboard(limit = 10) {
        await this.initialize();

        const localEntries = this.local.getTop(limit);
        if (!this.supabase) {
            return localEntries;
        }

        try {
            const { data, error } = await this.supabase
                .from(this.tableName)
                .select('id,name,lap_time_ms,car_id,created_at')
                .order('lap_time_ms', { ascending: true })
                .limit(limit);

            if (error || !data) {
                return localEntries;
            }

            const remoteEntries = (data as RemoteLeaderboardRow[]).map((entry) => ({
                id: String(entry.id),
                name: entry.name,
                lapTimeMs: entry.lap_time_ms,
                carId: entry.car_id || 'unknown',
                createdAt: entry.created_at || new Date().toISOString(),
                source: 'remote' as const,
            }));

            return this.mergeEntries(remoteEntries, localEntries).slice(0, limit);
        } catch (error) {
            return localEntries;
        }
    }

    async submitLap(name: string, lapTimeMs: number, carId: string) {
        const localEntry = this.local.add({
            name,
            lapTimeMs,
            carId,
        });

        await this.initialize();
        if (!this.supabase) {
            return localEntry;
        }

        try {
            const { data, error } = await this.supabase
                .from(this.tableName)
                .insert({
                    name,
                    lap_time_ms: lapTimeMs,
                    car_id: carId,
                })
                .select('id,name,lap_time_ms,car_id,created_at')
                .single();

            if (error || !data) {
                return localEntry;
            }

            const row = data as RemoteLeaderboardRow;
            return {
                id: String(row.id),
                name: row.name,
                lapTimeMs: row.lap_time_ms,
                carId: row.car_id || carId,
                createdAt: row.created_at || new Date().toISOString(),
                source: 'remote' as const,
            };
        } catch (error) {
            return localEntry;
        }
    }

    mergeEntries(remote: LeaderboardEntry[], local: LeaderboardEntry[]) {
        const merged = [...remote];
        const existingKeys = new Set(
            merged.map((entry) => `${entry.name}:${entry.lapTimeMs}:${entry.carId}`)
        );

        for (const localEntry of local) {
            const key = `${localEntry.name}:${localEntry.lapTimeMs}:${localEntry.carId}`;
            if (!existingKeys.has(key)) {
                merged.push(localEntry);
            }
        }

        merged.sort((a, b) => a.lapTimeMs - b.lapTimeMs);
        return merged;
    }
}

