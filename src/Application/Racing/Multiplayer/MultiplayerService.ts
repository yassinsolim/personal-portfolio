import { RealtimeChannel, SupabaseClient, createClient } from '@supabase/supabase-js';
import { carOptionsById, defaultCarId } from '../../carOptions';
import type { LeaderboardEntry } from '../Leaderboard/LocalLeaderboard';

type SupabaseConfig = {
    supabaseUrl: string;
    supabaseAnonKey: string;
    leaderboardTable?: string;
    lobbyChannelPrefix?: string;
};

type MultiplayerPosition = [number, number, number];
type MultiplayerQuaternion = [number, number, number, number];

export type MultiplayerPlayerState = {
    sessionId: string;
    name: string;
    carId: string;
    connectedAt: string;
    isHost: boolean;
    speedKph: number;
    lapProgress: number;
    lapTimeMs: number;
    driftIntensity: number;
    position: MultiplayerPosition | null;
    quaternion: MultiplayerQuaternion | null;
    lastSeenAt: string;
};

export type MultiplayerLapState = {
    id: string;
    sessionId: string;
    name: string;
    lapTimeMs: number;
    carId: string;
    createdAt: string;
};

export type MultiplayerState = {
    mode: 'solo' | 'lobby';
    supported: boolean;
    connecting: boolean;
    connected: boolean;
    lobbyCode: string | null;
    localSessionId: string;
    localPlayerName: string;
    localCarId: string;
    isHost: boolean;
    error: string | null;
    players: MultiplayerPlayerState[];
    laps: MultiplayerLapState[];
};

type LobbyJoinResult = {
    ok: boolean;
    error?: string;
    lobbyCode?: string;
};

type MultiplayerTelemetryPayload = {
    session_id: string;
    name: string;
    car_id: string;
    speed_kph: number;
    lap_progress: number;
    lap_time_ms: number;
    position: MultiplayerPosition;
    quaternion: MultiplayerQuaternion;
    gear: number;
    drift_intensity: number;
    sent_at: string;
};

type MultiplayerLapPayload = {
    id: string;
    session_id: string;
    name: string;
    lap_time_ms: number;
    car_id: string;
    created_at: string;
};

type MultiplayerProfilePayload = {
    session_id: string;
    name: string;
    car_id: string;
    is_host: boolean;
    connected_at: string;
};

const CONFIG_URL = '/config/racing.config.json';
const DEFAULT_LOBBY_PREFIX = 'nordschleife_lobby_v1';
const SESSION_KEY = 'yassinverse:nordschleife:multiplayer:session:v1';
const NAME_KEY = 'yassinverse:nordschleife:multiplayer:name:v1';
const TELEMETRY_SEND_INTERVAL_FAST_MS = 40;
const TELEMETRY_SEND_INTERVAL_SLOW_MS = 80;
const TELEMETRY_HEARTBEAT_INTERVAL_MS = 180;
const TELEMETRY_STATE_EMIT_INTERVAL_MS = 120;
const MAX_NAME_LENGTH = 16;
const MAX_LAPS = 32;
const LOBBY_CODE_LENGTH = 6;
const LOBBY_CODE_REGEX = /^[A-Z0-9]{4,8}$/;
const MAX_POSITION_ABS = 1000000;
const JOIN_SUBSCRIBE_TIMEOUT_MS = 12000;

export default class MultiplayerService {
    supabase: SupabaseClient | null;
    channel: RealtimeChannel | null;
    lobbyChannelPrefix: string;
    initialized: boolean;
    initPromise: Promise<void> | null;
    supported: boolean;
    mode: 'solo' | 'lobby';
    connecting: boolean;
    connected: boolean;
    lobbyCode: string | null;
    localSessionId: string;
    localPlayerName: string;
    localCarId: string;
    localInstanceId: string;
    isHost: boolean;
    error: string | null;
    players: Map<string, MultiplayerPlayerState>;
    laps: MultiplayerLapState[];
    listeners: Set<(state: MultiplayerState) => void>;
    lastTelemetrySentAt: number;
    lastTelemetryStateEmitAt: number;
    lastTelemetrySignature: string;
    lastTelemetryHeartbeatAt: number;
    joinRequestCounter: number;

    constructor() {
        this.supabase = null;
        this.channel = null;
        this.lobbyChannelPrefix = DEFAULT_LOBBY_PREFIX;
        this.initialized = false;
        this.initPromise = null;
        this.supported = false;
        this.mode = 'solo';
        this.connecting = false;
        this.connected = false;
        this.lobbyCode = null;
        this.localSessionId = this.getOrCreateSessionId();
        this.localPlayerName = this.getStoredName();
        this.localCarId = defaultCarId;
        this.localInstanceId = this.createRandomToken(10);
        this.isHost = false;
        this.error = null;
        this.players = new Map();
        this.laps = [];
        this.listeners = new Set();
        this.lastTelemetrySentAt = -Infinity;
        this.lastTelemetryStateEmitAt = -Infinity;
        this.lastTelemetrySignature = '';
        this.lastTelemetryHeartbeatAt = -Infinity;
        this.joinRequestCounter = 0;
    }

    onStateChange(listener: (state: MultiplayerState) => void) {
        this.listeners.add(listener);
        listener(this.getState());
        return () => {
            this.listeners.delete(listener);
        };
    }

    emitState() {
        const state = this.getState();
        this.listeners.forEach((listener) => listener(state));
    }

    getState(): MultiplayerState {
        return {
            mode: this.mode,
            supported: this.supported,
            connecting: this.connecting,
            connected: this.connected,
            lobbyCode: this.lobbyCode,
            localSessionId: this.localSessionId,
            localPlayerName: this.localPlayerName,
            localCarId: this.localCarId,
            isHost: this.isHost,
            error: this.error,
            players: this.getSortedPlayers(),
            laps: [...this.laps],
        };
    }

    getLocalPlayerName() {
        return this.localPlayerName;
    }

    async initialize() {
        if (this.initialized) return;
        if (this.initPromise) {
            await this.initPromise;
            return;
        }

        this.initPromise = this.loadConfig();
        await this.initPromise;
        this.initialized = true;
    }

    async loadConfig() {
        try {
            const response = await fetch(CONFIG_URL, {
                cache: 'no-store',
            });
            if (!response.ok) {
                this.supported = false;
                this.error = 'Multiplayer unavailable: missing config.';
                this.emitState();
                return;
            }

            const config = (await response.json()) as Partial<SupabaseConfig>;
            if (!config.supabaseUrl || !config.supabaseAnonKey) {
                this.supported = false;
                this.error = 'Multiplayer unavailable: invalid Supabase keys.';
                this.emitState();
                return;
            }

            this.lobbyChannelPrefix =
                this.normalizeLobbyToken(config.lobbyChannelPrefix || '') ||
                DEFAULT_LOBBY_PREFIX;
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
            this.supported = true;
            this.error = null;
            this.emitState();
        } catch (error) {
            this.supported = false;
            this.error = 'Multiplayer unavailable: config load failed.';
            this.emitState();
        }
    }

    async setSoloMode(playerName?: string, carId?: string) {
        if (playerName) this.setLocalPlayerName(playerName);
        if (carId) this.setLocalCarId(carId);
        await this.leaveLobby();
        this.mode = 'solo';
        this.error = null;
        this.emitState();
    }

    async createLobby(playerName: string, carId: string): Promise<LobbyJoinResult> {
        await this.initialize();
        if (!this.supabase || !this.supported) {
            this.error = 'Multiplayer requires a valid Supabase runtime config.';
            this.emitState();
            return {
                ok: false,
                error: this.error,
            };
        }

        const lobbyCode = this.generateLobbyCode();
        return this.joinLobbyInternal(lobbyCode, playerName, carId, true);
    }

    async joinLobby(
        requestedCode: string,
        playerName: string,
        carId: string
    ): Promise<LobbyJoinResult> {
        await this.initialize();
        if (!this.supabase || !this.supported) {
            this.error = 'Multiplayer requires a valid Supabase runtime config.';
            this.emitState();
            return {
                ok: false,
                error: this.error,
            };
        }

        const lobbyCode = this.normalizeLobbyCode(requestedCode);
        if (!LOBBY_CODE_REGEX.test(lobbyCode)) {
            this.error = 'Lobby code must be 4-8 letters/numbers.';
            this.emitState();
            return {
                ok: false,
                error: this.error,
            };
        }

        return this.joinLobbyInternal(lobbyCode, playerName, carId, false);
    }

    async leaveLobby(internal = false) {
        if (!internal) {
            this.joinRequestCounter++;
        }
        this.connecting = false;
        this.connected = false;
        this.mode = 'solo';
        this.lobbyCode = null;
        this.isHost = false;
        this.players.clear();
        this.laps = [];
        this.lastTelemetrySentAt = -Infinity;
        this.lastTelemetrySignature = '';
        this.lastTelemetryHeartbeatAt = -Infinity;
        this.error = null;
        if (this.channel && this.supabase) {
            await this.teardownChannel(this.channel);
        }
        this.channel = null;
        this.emitState();
    }

    setLocalPlayerName(nextName: string) {
        const sanitized = this.sanitizePlayerName(nextName);
        this.localPlayerName = sanitized;
        if (typeof window !== 'undefined') {
            try {
                window.localStorage.setItem(NAME_KEY, sanitized);
            } catch {
                // no-op
            }
        }
        this.touchLocalPlayer();
        this.pushLocalPresenceUpdate();
        this.emitState();
    }

    setLocalCarId(carId: string) {
        this.localCarId = carOptionsById[carId] ? carId : defaultCarId;
        this.touchLocalPlayer();
        this.pushLocalPresenceUpdate();
        this.emitState();
    }

    update() {
        if (!this.connected) return;

        const now = Date.now();
        let changed = false;
        this.players.forEach((player, key) => {
            if (player.sessionId === this.localSessionId) return;
            const ageMs =
                now - new Date(player.lastSeenAt || player.connectedAt).getTime();
            if (ageMs > 30000) {
                this.players.delete(key);
                changed = true;
            }
        });
        if (changed) this.emitState();
    }

    publishTelemetry(payload: {
        speedKph: number;
        lapProgress: number;
        lapTimeMs: number;
        position: { x: number; y: number; z: number };
        quaternion: { x: number; y: number; z: number; w: number };
        gear: number;
        driftIntensity: number;
    }) {
        if (!this.connected || !this.channel) return;

        const now = Date.now();
        const highMotion =
            payload.speedKph > 170 ||
            payload.driftIntensity > 0.35 ||
            Math.abs(payload.gear) > 5;
        const telemetryIntervalMs = highMotion
            ? TELEMETRY_SEND_INTERVAL_FAST_MS
            : TELEMETRY_SEND_INTERVAL_SLOW_MS;
        if (now - this.lastTelemetrySentAt < telemetryIntervalMs) return;
        const fallbackPosition: MultiplayerPosition = [0, 0, 0];
        const fallbackQuaternion: MultiplayerQuaternion = [0, 0, 0, 1];
        const sanitizedPosition =
            this.sanitizePositionTuple(
                [payload.position.x, payload.position.y, payload.position.z],
                fallbackPosition
            ) || fallbackPosition;
        const sanitizedQuaternion =
            this.sanitizeQuaternionTuple(
                [
                    payload.quaternion.x,
                    payload.quaternion.y,
                    payload.quaternion.z,
                    payload.quaternion.w,
                ],
                fallbackQuaternion
            ) || fallbackQuaternion;
        const quantizedPosition: MultiplayerPosition = [
            this.roundTo(sanitizedPosition[0], 3),
            this.roundTo(sanitizedPosition[1], 3),
            this.roundTo(sanitizedPosition[2], 3),
        ];
        const quantizedQuaternion: MultiplayerQuaternion = [
            this.roundTo(sanitizedQuaternion[0], 4),
            this.roundTo(sanitizedQuaternion[1], 4),
            this.roundTo(sanitizedQuaternion[2], 4),
            this.roundTo(sanitizedQuaternion[3], 4),
        ];

        const safePayload: MultiplayerTelemetryPayload = {
            session_id: this.localSessionId,
            name: this.localPlayerName,
            car_id: this.localCarId,
            speed_kph: this.roundTo(this.clampNumber(payload.speedKph, 0, 650), 2),
            lap_progress: this.roundTo(this.clampNumber(payload.lapProgress, 0, 1), 4),
            lap_time_ms: this.clampNumber(payload.lapTimeMs, 0, 7200000),
            position: quantizedPosition,
            quaternion: quantizedQuaternion,
            gear: Math.round(this.clampNumber(payload.gear, -1, 10)),
            drift_intensity: this.roundTo(
                this.clampNumber(payload.driftIntensity, 0, 1),
                3
            ),
            sent_at: new Date(now).toISOString(),
        };
        const signature = JSON.stringify({
            speed_kph: safePayload.speed_kph,
            lap_progress: safePayload.lap_progress,
            lap_time_ms: safePayload.lap_time_ms,
            position: safePayload.position,
            quaternion: safePayload.quaternion,
            gear: safePayload.gear,
            drift_intensity: safePayload.drift_intensity,
        });
        const heartbeatDue =
            now - this.lastTelemetryHeartbeatAt >= TELEMETRY_HEARTBEAT_INTERVAL_MS;
        if (!heartbeatDue && signature === this.lastTelemetrySignature) {
            return;
        }
        this.lastTelemetrySentAt = now;
        this.lastTelemetrySignature = signature;
        this.lastTelemetryHeartbeatAt = now;

        this.channel.send({
            type: 'broadcast',
            event: 'telemetry',
            payload: safePayload,
        });

        const existing = this.players.get(this.localSessionId);
        if (existing) {
            existing.speedKph = safePayload.speed_kph;
            existing.lapProgress = safePayload.lap_progress;
            existing.lapTimeMs = safePayload.lap_time_ms;
            existing.driftIntensity = safePayload.drift_intensity;
            existing.position = safePayload.position;
            existing.quaternion = safePayload.quaternion;
            existing.lastSeenAt = safePayload.sent_at;
        }
        this.emitTelemetryState();
    }

    publishLap(entry: LeaderboardEntry) {
        if (!this.connected || !this.channel) return;

        const safeName = this.sanitizePlayerName(entry.name || this.localPlayerName);
        const safeCarId = carOptionsById[entry.carId] ? entry.carId : this.localCarId;
        const lap: MultiplayerLapState = {
            id:
                String(entry.id || '').slice(0, 80) ||
                `${this.localSessionId}-${Date.now()}`,
            sessionId: this.localSessionId,
            name: safeName,
            lapTimeMs: this.clampNumber(entry.lapTimeMs, 1, 7200000),
            carId: safeCarId,
            createdAt: entry.createdAt || new Date().toISOString(),
        };

        this.upsertLobbyLap(lap);
        const payload: MultiplayerLapPayload = {
            id: lap.id,
            session_id: lap.sessionId,
            name: lap.name,
            lap_time_ms: lap.lapTimeMs,
            car_id: lap.carId,
            created_at: lap.createdAt,
        };
        this.channel.send({
            type: 'broadcast',
            event: 'lap_submitted',
            payload,
        });
        this.emitState();
    }

    async teardownChannel(channel: RealtimeChannel) {
        if (!this.supabase) return;
        try {
            await channel.untrack();
        } catch {
            // no-op
        }
        try {
            await this.supabase.removeChannel(channel);
        } catch {
            // no-op
        }
    }

    async removeStaleChannelsByName(channelName: string) {
        if (!this.supabase?.getChannels) return;
        const channels = this.supabase
            .getChannels()
            .filter((channel) => channel.topic === channelName);
        for (const stale of channels) {
            await this.teardownChannel(stale);
        }
    }

    wireChannelEvents(channel: RealtimeChannel) {
        channel.on('presence', { event: 'sync' }, () => {
            this.handlePresenceSync();
        });

        channel.on('broadcast', { event: 'profile' }, ({ payload }) => {
            this.handleRemoteProfile(payload);
        });

        channel.on('broadcast', { event: 'telemetry' }, ({ payload }) => {
            this.handleRemoteTelemetry(payload);
        });

        channel.on('broadcast', { event: 'lap_submitted' }, ({ payload }) => {
            this.handleRemoteLap(payload);
        });
    }

    subscribeChannel(channel: RealtimeChannel, timeoutMs: number) {
        return new Promise<boolean>((resolve) => {
            let settled = false;
            const timeout = setTimeout(() => {
                if (settled) return;
                settled = true;
                resolve(false);
            }, timeoutMs);

            channel.subscribe((status) => {
                if (settled) return;
                if (status === 'SUBSCRIBED') {
                    settled = true;
                    clearTimeout(timeout);
                    resolve(true);
                    return;
                }

                if (
                    status === 'CHANNEL_ERROR' ||
                    status === 'TIMED_OUT' ||
                    status === 'CLOSED'
                ) {
                    settled = true;
                    clearTimeout(timeout);
                    resolve(false);
                }
            });
        });
    }

    async joinLobbyInternal(
        lobbyCode: string,
        playerName: string,
        carId: string,
        isHost: boolean
    ): Promise<LobbyJoinResult> {
        if (!this.supabase) {
            this.error = 'Supabase client unavailable.';
            this.emitState();
            return {
                ok: false,
                error: this.error,
            };
        }

        const joinRequestId = ++this.joinRequestCounter;
        await this.leaveLobby(true);
        if (joinRequestId !== this.joinRequestCounter) {
            return {
                ok: false,
                error: 'Join request cancelled.',
            };
        }

        this.mode = 'lobby';
        this.connecting = true;
        this.error = null;
        this.lobbyCode = lobbyCode;
        this.isHost = isHost;
        this.localInstanceId = this.createRandomToken(12);
        this.setLocalPlayerName(playerName);
        this.setLocalCarId(carId);
        this.emitState();

        const channelName = `${this.lobbyChannelPrefix}:${lobbyCode}`;
        await this.removeStaleChannelsByName(channelName);

        let channel: RealtimeChannel | null = null;
        for (let attempt = 0; attempt < 2; attempt++) {
            if (joinRequestId !== this.joinRequestCounter) {
                return {
                    ok: false,
                    error: 'Join request cancelled.',
                };
            }

            const presenceKey = `${this.localInstanceId}-${attempt}`;
            channel = this.supabase.channel(channelName, {
                config: {
                    presence: {
                        key: presenceKey,
                    },
                },
            });
            this.wireChannelEvents(channel);
            this.channel = channel;

            const subscribed = await this.subscribeChannel(
                channel,
                JOIN_SUBSCRIBE_TIMEOUT_MS
            );
            if (subscribed) break;

            await this.teardownChannel(channel);
            if (this.channel === channel) {
                this.channel = null;
            }
            channel = null;
            this.localInstanceId = this.createRandomToken(12);
            await new Promise((resolve) => setTimeout(resolve, 250));
        }

        if (!channel || !this.channel) {
            this.mode = 'solo';
            this.connecting = false;
            this.connected = false;
            this.error =
                'Could not connect to lobby right now. Please try again in a moment.';
            if (this.channel && this.supabase) {
                await this.teardownChannel(this.channel);
            }
            this.channel = null;
            this.emitState();
            return {
                ok: false,
                error: this.error,
            };
        }

        if (joinRequestId !== this.joinRequestCounter) {
            await this.teardownChannel(channel);
            if (this.channel === channel) {
                this.channel = null;
            }
            return {
                ok: false,
                error: 'Join request cancelled.',
            };
        }

        const profile: MultiplayerProfilePayload = {
            session_id: this.localSessionId,
            name: this.localPlayerName,
            car_id: this.localCarId,
            is_host: this.isHost,
            connected_at: new Date().toISOString(),
        };

        try {
            await channel.track(profile);
            channel.send({
                type: 'broadcast',
                event: 'profile',
                payload: profile,
            });
        } catch {
            // presence errors should not crash flow
        }

        this.connecting = false;
        this.connected = true;
        this.error = null;
        this.touchLocalPlayer();
        this.emitState();
        return {
            ok: true,
            lobbyCode,
        };
    }

    handlePresenceSync() {
        if (!this.channel) return;

        const state = this.channel.presenceState();
        const connectedSessionIds = new Set<string>();
        const nowIso = new Date().toISOString();
        Object.values(state).forEach((presenceList) => {
            if (!Array.isArray(presenceList)) return;
            presenceList.forEach((raw) => {
                const sessionId = this.sanitizeSessionId(
                    this.readStringField(raw, 'session_id')
                );
                if (!sessionId) return;

                const name = this.sanitizePlayerName(
                    this.readStringField(raw, 'name')
                );
                const carId = this.sanitizeCarId(this.readStringField(raw, 'car_id'));
                const isHost = Boolean((raw as { is_host?: unknown }).is_host);
                const connectedAt =
                    this.readStringField(raw, 'connected_at') || nowIso;

                connectedSessionIds.add(sessionId);
                if (sessionId === this.localSessionId) {
                    this.touchLocalPlayer();
                    return;
                }
                const existing = this.players.get(sessionId);
                if (existing) {
                    existing.name = name;
                    existing.carId = carId;
                    existing.isHost = isHost;
                    existing.lastSeenAt = nowIso;
                    return;
                }

                this.players.set(sessionId, {
                    sessionId,
                    name,
                    carId,
                    connectedAt,
                    isHost,
                    speedKph: 0,
                    lapProgress: 0,
                    lapTimeMs: 0,
                    driftIntensity: 0,
                    position: null,
                    quaternion: null,
                    lastSeenAt: nowIso,
                });
            });
        });

        Array.from(this.players.keys()).forEach((sessionId) => {
            if (!connectedSessionIds.has(sessionId)) {
                this.players.delete(sessionId);
            }
        });

        this.touchLocalPlayer();
        this.emitState();
    }

    handleRemoteProfile(payload: unknown) {
        if (!payload || typeof payload !== 'object') return;
        const parsed = payload as Partial<MultiplayerProfilePayload>;
        const sessionId = this.sanitizeSessionId(parsed.session_id || '');
        if (!sessionId) return;
        if (sessionId === this.localSessionId) return;
        const name = this.sanitizePlayerName(parsed.name || '');
        const carId = this.sanitizeCarId(parsed.car_id || '');
        const connectedAt =
            this.sanitizeIsoString(parsed.connected_at) || new Date().toISOString();
        const isHost = parsed.is_host === true;
        const existing = this.players.get(sessionId);
        const nowIso = new Date().toISOString();
        if (existing) {
            existing.name = name;
            existing.carId = carId;
            existing.isHost = isHost;
            existing.connectedAt = connectedAt;
            existing.lastSeenAt = nowIso;
        } else {
            this.players.set(sessionId, {
                sessionId,
                name,
                carId,
                connectedAt,
                isHost,
                speedKph: 0,
                lapProgress: 0,
                lapTimeMs: 0,
                driftIntensity: 0,
                position: null,
                quaternion: null,
                lastSeenAt: nowIso,
            });
        }
        this.emitState();
    }

    handleRemoteTelemetry(payload: unknown) {
        if (!payload || typeof payload !== 'object') return;
        const parsed = payload as Partial<MultiplayerTelemetryPayload>;
        const sessionId = this.sanitizeSessionId(parsed.session_id || '');
        if (!sessionId) return;
        if (sessionId === this.localSessionId) return;

        const nowIso = this.sanitizeIsoString(parsed.sent_at) || new Date().toISOString();
        const player = this.players.get(sessionId) || {
            sessionId,
            name: this.sanitizePlayerName(parsed.name || ''),
            carId: this.sanitizeCarId(parsed.car_id || ''),
            connectedAt: nowIso,
            isHost: false,
            speedKph: 0,
            lapProgress: 0,
            lapTimeMs: 0,
            driftIntensity: 0,
            position: null,
            quaternion: null,
            lastSeenAt: nowIso,
        };

        player.name = this.sanitizePlayerName(parsed.name || player.name);
        player.carId = this.sanitizeCarId(parsed.car_id || player.carId);
        player.speedKph = this.clampNumber(parsed.speed_kph, 0, 650);
        player.lapProgress = this.clampNumber(parsed.lap_progress, 0, 1);
        player.lapTimeMs = this.clampNumber(parsed.lap_time_ms, 0, 7200000);
        player.driftIntensity = this.clampNumber(parsed.drift_intensity, 0, 1);
        player.position = this.sanitizePositionTuple(parsed.position, player.position);
        player.quaternion = this.sanitizeQuaternionTuple(
            parsed.quaternion,
            player.quaternion
        );
        player.lastSeenAt = nowIso;

        this.players.set(sessionId, player);
        this.emitTelemetryState();
    }

    handleRemoteLap(payload: unknown) {
        if (!payload || typeof payload !== 'object') return;
        const parsed = payload as Partial<MultiplayerLapPayload>;
        const sessionId = this.sanitizeSessionId(parsed.session_id || '');
        if (!sessionId) return;
        if (sessionId === this.localSessionId) return;

        const lap: MultiplayerLapState = {
            id:
                String(parsed.id || '').slice(0, 80) ||
                `${sessionId}-${Date.now()}`,
            sessionId,
            name: this.sanitizePlayerName(parsed.name || ''),
            lapTimeMs: this.clampNumber(parsed.lap_time_ms, 1, 7200000),
            carId: this.sanitizeCarId(parsed.car_id || ''),
            createdAt:
                this.sanitizeIsoString(parsed.created_at) || new Date().toISOString(),
        };
        this.upsertLobbyLap(lap);
        this.emitState();
    }

    upsertLobbyLap(lap: MultiplayerLapState) {
        const existingIndex = this.laps.findIndex((entry) => entry.id === lap.id);
        if (existingIndex >= 0) {
            this.laps[existingIndex] = lap;
        } else {
            this.laps.push(lap);
        }
        this.laps.sort((a, b) => a.lapTimeMs - b.lapTimeMs);
        this.laps = this.laps.slice(0, MAX_LAPS);
    }

    pushLocalPresenceUpdate() {
        if (!this.channel || !this.connected) return;
        const payload: MultiplayerProfilePayload = {
            session_id: this.localSessionId,
            name: this.localPlayerName,
            car_id: this.localCarId,
            is_host: this.isHost,
            connected_at: new Date().toISOString(),
        };
        this.channel.track(payload).catch(() => undefined);
        this.channel.send({
            type: 'broadcast',
            event: 'profile',
            payload,
        });
    }

    touchLocalPlayer() {
        const nowIso = new Date().toISOString();
        const existing = this.players.get(this.localSessionId);
        if (existing) {
            existing.name = this.localPlayerName;
            existing.carId = this.localCarId;
            existing.isHost = this.isHost;
            existing.lastSeenAt = nowIso;
            return;
        }

        this.players.set(this.localSessionId, {
            sessionId: this.localSessionId,
            name: this.localPlayerName,
            carId: this.localCarId,
            connectedAt: nowIso,
            isHost: this.isHost,
            speedKph: 0,
            lapProgress: 0,
            lapTimeMs: 0,
            driftIntensity: 0,
            position: null,
            quaternion: null,
            lastSeenAt: nowIso,
        });
    }

    emitTelemetryState() {
        const now = Date.now();
        if (now - this.lastTelemetryStateEmitAt < TELEMETRY_STATE_EMIT_INTERVAL_MS) {
            return;
        }
        this.lastTelemetryStateEmitAt = now;
        this.emitState();
    }

    getSortedPlayers() {
        const players = Array.from(this.players.values());
        players.sort((a, b) => {
            if (a.sessionId === this.localSessionId && b.sessionId !== this.localSessionId) {
                return -1;
            }
            if (b.sessionId === this.localSessionId && a.sessionId !== this.localSessionId) {
                return 1;
            }
            if (a.isHost && !b.isHost) return -1;
            if (b.isHost && !a.isHost) return 1;
            if (b.lapProgress !== a.lapProgress) {
                return b.lapProgress - a.lapProgress;
            }
            if (a.lapTimeMs !== b.lapTimeMs) {
                return a.lapTimeMs - b.lapTimeMs;
            }
            return a.name.localeCompare(b.name);
        });
        return players;
    }

    getOrCreateSessionId() {
        if (typeof window === 'undefined') {
            return `session-${this.createRandomToken(18)}`;
        }
        try {
            const existing = window.sessionStorage.getItem(SESSION_KEY) || '';
            const sanitized = this.sanitizeSessionId(existing);
            if (sanitized) return sanitized;
        } catch {
            // no-op
        }

        const next = `session-${this.createRandomToken(18)}`;
        try {
            window.sessionStorage.setItem(SESSION_KEY, next);
        } catch {
            // no-op
        }
        return next;
    }

    getStoredName() {
        if (typeof window === 'undefined') return 'Driver';
        try {
            const raw = window.localStorage.getItem(NAME_KEY) || 'Driver';
            return this.sanitizePlayerName(raw);
        } catch {
            return 'Driver';
        }
    }

    sanitizePlayerName(name: string) {
        const clean = String(name || '')
            .replace(/[^a-zA-Z0-9 _-]/g, '')
            .trim()
            .slice(0, MAX_NAME_LENGTH);
        return clean || 'Driver';
    }

    sanitizeCarId(carId: string) {
        return carOptionsById[carId] ? carId : defaultCarId;
    }

    sanitizeSessionId(sessionId: string) {
        const clean = String(sessionId || '')
            .replace(/[^a-zA-Z0-9:_-]/g, '')
            .slice(0, 80);
        return clean || '';
    }

    sanitizeIsoString(value: unknown) {
        const text = String(value || '').trim();
        if (!text) return '';
        const time = Date.parse(text);
        if (!Number.isFinite(time)) return '';
        return new Date(time).toISOString();
    }

    normalizeLobbyCode(value: string) {
        return String(value || '')
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '')
            .slice(0, 8);
    }

    normalizeLobbyToken(value: string) {
        return String(value || '')
            .toLowerCase()
            .replace(/[^a-z0-9:_-]/g, '')
            .slice(0, 64);
    }

    generateLobbyCode() {
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < LOBBY_CODE_LENGTH; i++) {
            const next = Math.floor(Math.random() * alphabet.length);
            code += alphabet[next];
        }
        return code;
    }

    createRandomToken(length: number) {
        const alphabet =
            'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let out = '';
        for (let i = 0; i < length; i++) {
            const index = Math.floor(Math.random() * alphabet.length);
            out += alphabet[index];
        }
        return out;
    }

    clampNumber(value: unknown, min: number, max: number) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return min;
        return Math.min(max, Math.max(min, numeric));
    }

    roundTo(value: number, digits: number) {
        const factor = 10 ** digits;
        return Math.round(value * factor) / factor;
    }

    readFiniteNumber(value: unknown) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
    }

    sanitizePositionTuple(
        value: unknown,
        fallback: MultiplayerPosition | null = null
    ): MultiplayerPosition | null {
        if (!Array.isArray(value) || value.length < 3) return fallback;
        const x = this.readFiniteNumber(value[0]);
        const y = this.readFiniteNumber(value[1]);
        const z = this.readFiniteNumber(value[2]);
        if (x === null || y === null || z === null) return fallback;
        return [
            this.clampNumber(x, -MAX_POSITION_ABS, MAX_POSITION_ABS),
            this.clampNumber(y, -MAX_POSITION_ABS, MAX_POSITION_ABS),
            this.clampNumber(z, -MAX_POSITION_ABS, MAX_POSITION_ABS),
        ] as MultiplayerPosition;
    }

    sanitizeQuaternionTuple(
        value: unknown,
        fallback: MultiplayerQuaternion | null = null
    ): MultiplayerQuaternion | null {
        if (!Array.isArray(value) || value.length < 4) return fallback;
        const x = this.readFiniteNumber(value[0]);
        const y = this.readFiniteNumber(value[1]);
        const z = this.readFiniteNumber(value[2]);
        const w = this.readFiniteNumber(value[3]);
        if (x === null || y === null || z === null || w === null) return fallback;
        const lengthSq = x * x + y * y + z * z + w * w;
        if (lengthSq <= 1e-12) return fallback;
        const invLength = 1 / Math.sqrt(lengthSq);
        return [
            this.clampNumber(x * invLength, -1, 1),
            this.clampNumber(y * invLength, -1, 1),
            this.clampNumber(z * invLength, -1, 1),
            this.clampNumber(w * invLength, -1, 1),
        ] as MultiplayerQuaternion;
    }

    readStringField(source: unknown, key: string) {
        if (!source || typeof source !== 'object') return '';
        const value = (source as Record<string, unknown>)[key];
        return typeof value === 'string' ? value : '';
    }
}
