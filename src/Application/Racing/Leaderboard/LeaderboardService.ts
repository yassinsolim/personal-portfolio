import { RealtimeChannel, SupabaseClient, createClient } from '@supabase/supabase-js';
import LocalLeaderboard, { LeaderboardEntry } from './LocalLeaderboard';
import { carOptionsById, defaultCarId } from '../../carOptions';
import type { GhostLapReplay } from '../Ghost/GhostReplay';

type SupabaseConfig = {
    supabaseUrl: string;
    supabaseAnonKey: string;
    leaderboardTable?: string;
    ghostReplayTable?: string;
};

const DEFAULT_TABLE = 'nordschleife_leaderboard';
const DEFAULT_GHOST_REPLAY_TABLE = 'nordschleife_ghost_replays';
const CONFIG_URL = '/config/racing.config.json';
const GHOST_FALLBACK_STORAGE_KEY = 'yassinverse:nordschleife:leaderboard-ghosts:v1';

type RemoteLeaderboardRow = {
    id: string;
    name: string;
    lap_time_ms: number;
    car_id: string;
    created_at: string;
};

type RemoteGhostReplayRow = {
    lap_id: string;
    lap_time_ms: number;
    car_id: string;
    samples: unknown;
    created_at?: string;
};

export default class LeaderboardService {
    local: LocalLeaderboard;
    supabase: SupabaseClient | null;
    tableName: string;
    ghostReplayTableName: string;
    initialized: boolean;
    initPromise: Promise<void> | null;
    missingConfigLogged: boolean;
    listeners: Set<() => void>;
    tableChangesChannel: RealtimeChannel | null;
    ghostReplayCache: Map<string, GhostLapReplay>;
    ghostReplayRemoteDisabled: boolean;

    constructor(local: LocalLeaderboard) {
        this.local = local;
        this.supabase = null;
        this.tableName = DEFAULT_TABLE;
        this.ghostReplayTableName = DEFAULT_GHOST_REPLAY_TABLE;
        this.initialized = false;
        this.initPromise = null;
        this.missingConfigLogged = false;
        this.listeners = new Set();
        this.tableChangesChannel = null;
        this.ghostReplayCache = new Map();
        this.ghostReplayRemoteDisabled = false;
        this.loadGhostFallbackCache();
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
            this.ghostReplayTableName =
                config.ghostReplayTable || DEFAULT_GHOST_REPLAY_TABLE;
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
            this.subscribeToTableChanges();
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

    async submitLap(
        name: string,
        lapTimeMs: number,
        carId: string,
        ghostReplay?: GhostLapReplay | null
    ) {
        const safeName = this.sanitizeName(name);
        const safeLapTimeMs = this.sanitizeLapTime(lapTimeMs);
        const safeCarId = this.sanitizeCarId(carId);
        const safeReplay = this.sanitizeGhostReplay(
            ghostReplay,
            safeCarId,
            safeLapTimeMs
        );

        const localEntry = this.local.add({
            name: safeName,
            lapTimeMs: safeLapTimeMs,
            carId: safeCarId,
        });
        if (safeReplay) {
            this.cacheGhostReplay(localEntry.id, safeReplay);
        }

        await this.initialize();
        if (!this.supabase) {
            return localEntry;
        }

        try {
            const { data, error } = await this.supabase
                .from(this.tableName)
                .insert({
                    name: safeName,
                    lap_time_ms: safeLapTimeMs,
                    car_id: safeCarId,
                })
                .select('id,name,lap_time_ms,car_id,created_at')
                .single();

            if (error || !data) {
                return localEntry;
            }

            const row = data as RemoteLeaderboardRow;
            const entry = {
                id: String(row.id),
                name: row.name,
                lapTimeMs: row.lap_time_ms,
                carId: row.car_id || safeCarId,
                createdAt: row.created_at || new Date().toISOString(),
                source: 'remote' as const,
            };
            if (safeReplay) {
                await this.submitGhostReplay(entry.id, safeReplay);
            }
            return entry;
        } catch (error) {
            return localEntry;
        }
    }

    async getGhostReplayForLap(
        lapId: string,
        fallbackCarId?: string,
        fallbackLapTimeMs?: number
    ) {
        const safeLapId = String(lapId || '').trim();
        if (!safeLapId) return null;

        const cached = this.ghostReplayCache.get(safeLapId);
        if (cached) {
            return this.cloneGhostReplay(cached);
        }

        await this.initialize();
        if (!this.supabase || this.ghostReplayRemoteDisabled) {
            return null;
        }

        try {
            const { data, error } = await this.supabase
                .from(this.ghostReplayTableName)
                .select('lap_id,lap_time_ms,car_id,samples,created_at')
                .eq('lap_id', safeLapId)
                .limit(1)
                .maybeSingle();

            if (error || !data) {
                if (this.isMissingRelationError(error)) {
                    this.ghostReplayRemoteDisabled = true;
                }
                return null;
            }

            const row = data as RemoteGhostReplayRow;
            const sanitized = this.sanitizeGhostReplay(
                {
                    lapTimeMs:
                        Number.isFinite(row.lap_time_ms) && row.lap_time_ms > 0
                            ? row.lap_time_ms
                            : fallbackLapTimeMs || 0,
                    carId:
                        typeof row.car_id === 'string' && row.car_id.trim()
                            ? row.car_id
                            : fallbackCarId || defaultCarId,
                    samples: Array.isArray(row.samples) ? row.samples : [],
                },
                fallbackCarId || defaultCarId,
                fallbackLapTimeMs || 60_000
            );
            if (!sanitized) return null;

            this.cacheGhostReplay(safeLapId, sanitized);
            return this.cloneGhostReplay(sanitized);
        } catch {
            return null;
        }
    }

    onLeaderboardChanged(listener: () => void) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    notifyLeaderboardChanged() {
        this.listeners.forEach((listener) => {
            try {
                listener();
            } catch {
                // no-op
            }
        });
    }

    subscribeToTableChanges() {
        if (!this.supabase) return;
        if (this.tableChangesChannel) return;

        const channel = this.supabase.channel(
            `leaderboard-changes:${this.tableName}`
        );

        channel.on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: this.tableName,
            },
            () => {
                this.notifyLeaderboardChanged();
            }
        );

        channel.subscribe((status) => {
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                this.tableChangesChannel = null;
            }
        });

        this.tableChangesChannel = channel;
    }

    sanitizeName(name: string) {
        const normalized = String(name || '')
            .replace(/[^a-zA-Z0-9 _-]/g, '')
            .trim()
            .slice(0, 16);
        return normalized || 'Driver';
    }

    sanitizeLapTime(value: number) {
        const numeric = Math.floor(Number(value));
        if (!Number.isFinite(numeric)) return 60000;
        return Math.min(7_200_000, Math.max(1_000, numeric));
    }

    sanitizeCarId(carId: string) {
        return carOptionsById[carId] ? carId : defaultCarId;
    }

    sanitizeGhostReplay(
        replay: GhostLapReplay | null | undefined,
        fallbackCarId: string,
        fallbackLapTimeMs: number
    ) {
        if (!replay || !Array.isArray(replay.samples)) return null;

        const safeCarId = this.sanitizeCarId(replay.carId || fallbackCarId);
        const safeLapTimeMs = this.sanitizeLapTime(
            replay.lapTimeMs || fallbackLapTimeMs
        );

        const safeSamples = replay.samples
            .slice(0, 5000)
            .map((sample) => {
                const qx = this.clampNumber(sample?.qx, -1, 1);
                const qy = this.clampNumber(sample?.qy, -1, 1);
                const qz = this.clampNumber(sample?.qz, -1, 1);
                const qw = this.clampNumber(sample?.qw, -1, 1);
                const qLen = Math.hypot(qx, qy, qz, qw);
                const invLen = qLen > 1e-6 ? 1 / qLen : 1;
                return {
                    t: this.clampNumber(sample?.t, 0, 7_200_000),
                    x: this.clampNumber(sample?.x, -500_000, 500_000),
                    y: this.clampNumber(sample?.y, -500_000, 500_000),
                    z: this.clampNumber(sample?.z, -500_000, 500_000),
                    qx: qLen > 1e-6 ? qx * invLen : 0,
                    qy: qLen > 1e-6 ? qy * invLen : 0,
                    qz: qLen > 1e-6 ? qz * invLen : 0,
                    qw: qLen > 1e-6 ? qw * invLen : 1,
                };
            })
            .filter((sample) => Number.isFinite(sample.t));

        if (safeSamples.length < 8) return null;
        safeSamples.sort((a, b) => a.t - b.t);
        safeSamples[0].t = 0;

        return {
            lapTimeMs: safeLapTimeMs,
            carId: safeCarId,
            samples: safeSamples,
        } as GhostLapReplay;
    }

    clampNumber(value: unknown, min: number, max: number) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return min;
        return Math.min(max, Math.max(min, numeric));
    }

    cloneGhostReplay(replay: GhostLapReplay) {
        return {
            lapTimeMs: replay.lapTimeMs,
            carId: replay.carId,
            samples: replay.samples.map((sample) => ({ ...sample })),
        } as GhostLapReplay;
    }

    async submitGhostReplay(lapId: string, replay: GhostLapReplay) {
        const safeLapId = String(lapId || '').trim();
        if (!safeLapId) return;

        const safeReplay = this.sanitizeGhostReplay(
            replay,
            replay.carId || defaultCarId,
            replay.lapTimeMs
        );
        if (!safeReplay) return;

        this.cacheGhostReplay(safeLapId, safeReplay);
        if (!this.supabase || this.ghostReplayRemoteDisabled) {
            return;
        }

        try {
            const { error } = await this.supabase
                .from(this.ghostReplayTableName)
                .upsert(
                    {
                        lap_id: safeLapId,
                        lap_time_ms: safeReplay.lapTimeMs,
                        car_id: safeReplay.carId,
                        samples: safeReplay.samples,
                    },
                    { onConflict: 'lap_id' }
                );
            if (error && this.isMissingRelationError(error)) {
                this.ghostReplayRemoteDisabled = true;
            }
        } catch {
            return;
        }
    }

    isMissingRelationError(error: unknown) {
        if (!error || typeof error !== 'object') return false;
        const code = String((error as { code?: unknown }).code || '');
        const message = String((error as { message?: unknown }).message || '');
        return (
            code === '42P01' ||
            message.toLowerCase().includes('relation') ||
            message.toLowerCase().includes('does not exist')
        );
    }

    cacheGhostReplay(lapId: string, replay: GhostLapReplay) {
        this.ghostReplayCache.set(lapId, this.cloneGhostReplay(replay));
        while (this.ghostReplayCache.size > 96) {
            const oldestKey = this.ghostReplayCache.keys().next().value;
            if (!oldestKey) break;
            this.ghostReplayCache.delete(oldestKey);
        }
        this.persistGhostFallbackCache();
    }

    loadGhostFallbackCache() {
        if (typeof window === 'undefined') return;
        try {
            const raw = window.localStorage.getItem(GHOST_FALLBACK_STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw) as Record<string, GhostLapReplay>;
            if (!parsed || typeof parsed !== 'object') return;
            Object.entries(parsed).forEach(([lapId, replay]) => {
                const safeReplay = this.sanitizeGhostReplay(
                    replay,
                    replay?.carId || defaultCarId,
                    replay?.lapTimeMs || 60_000
                );
                if (!safeReplay) return;
                this.ghostReplayCache.set(lapId, safeReplay);
            });
        } catch {
            return;
        }
    }

    persistGhostFallbackCache() {
        if (typeof window === 'undefined') return;
        try {
            const serialized: Record<string, GhostLapReplay> = {};
            this.ghostReplayCache.forEach((replay, lapId) => {
                serialized[lapId] = this.cloneGhostReplay(replay);
            });
            window.localStorage.setItem(
                GHOST_FALLBACK_STORAGE_KEY,
                JSON.stringify(serialized)
            );
        } catch {
            return;
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
