import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { createMockRealtime, mockRealtimeEnabled } from './mockRealtime';
import { decodeLook, encodeLook, sanitizeLook, STOCK_LOOK } from '../Garage/garage';
import type { CarLook } from '../Garage/garage';
import { carOptionsById, defaultCarId } from '../../carOptions';
import { randomInt } from '../../Utils/Random';
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
    // ground plane velocity (x, z) m/s and yaw rate rad/s, for prediction and
    // car to car contact
    velocity: [number, number] | null;
    yawRate: number;
    // can't be hit right now (just reset or spawned)
    ghost: boolean;
    // when the last packet arrived, for liveness
    lastSeenAt: string;
    // local clock time the last pose was taken on the sender, arrival minus
    // the transit time. prediction runs from here, not from arrival
    sampleAtMs?: number;
    look?: CarLook;
    tuned?: boolean;
};

export type MultiplayerBump = {
    target: string;
    from?: string;
    ix: number;
    iz: number;
    px: number;
    pz: number;
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
    // garage look as a short code, and whether the car is tuned
    look?: string;
    tuned?: boolean;
    speed_kph: number;
    lap_progress: number;
    lap_time_ms: number;
    position: MultiplayerPosition;
    quaternion: MultiplayerQuaternion;
    gear: number;
    drift_intensity: number;
    velocity?: [number, number];
    yaw_rate?: number;
    ghost?: boolean;
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
    // garage look, so others see the paint and wheels, and whether the car
    // runs a tune
    look?: CarLook;
    tuned?: boolean;
};

const CONFIG_URL = '/config/racing.config.json';
// bump when track geometry changes, so old and new builds never share a lobby
const DEFAULT_LOBBY_PREFIX = 'nordschleife_lobby_v2';
// bumped with the tire model and the narrower road, and added to the channel
// name so it holds even when the config sets its own prefix
const PHYSICS_SEASON = 'p3';
const SESSION_KEY = 'yassinverse:nordschleife:multiplayer:session:v1';
const NAME_KEY = 'yassinverse:nordschleife:multiplayer:name:v1';
// realtime messages are billed (shared quota), so telemetry runs at ~11 Hz
// moving and the receiving side predicts in between. a car that hasn't moved
// only sends a keep alive
const TELEMETRY_SEND_INTERVAL_FAST_MS = 90;
const TELEMETRY_SEND_INTERVAL_SLOW_MS = 100;
const TELEMETRY_HEARTBEAT_INTERVAL_MS = 2000;
const TELEMETRY_STATE_EMIT_INTERVAL_MS = 120;
const MAX_NAME_LENGTH = 16;
const MAX_LAPS = 32;
const LOBBY_CODE_LENGTH = 6;
const LOBBY_CODE_REGEX = /^[A-Z0-9]{4,8}$/;
// testing only, with ?raceDebug=1: ?netsim=loss,lag,jitter drops that share
// of outgoing broadcasts and delays the rest by lag plus up to jitter ms,
// e.g. netsim=0.2,120,80. presence isn't touched
const readNetsim = () => {
    try {
        const params = new URLSearchParams(window.location.search);
        if (params.get('raceDebug') !== '1') return null;
        const raw = params.get('netsim');
        if (!raw) return null;
        const [loss, lag, jitter] = raw.split(',').map(Number);
        return {
            loss: Math.min(0.95, Math.max(0, loss || 0)),
            lag: Math.max(0, lag || 0),
            jitter: Math.max(0, jitter || 0),
        };
    } catch {
        return null;
    }
};

const simulateNetwork = (channel: RealtimeChannel) => {
    const sim = readNetsim();
    if (!sim) return;
    const send = channel.send.bind(channel);
    channel.send = ((message: Parameters<RealtimeChannel['send']>[0], opts?: Parameters<RealtimeChannel['send']>[1]) => {
        if (message.type === 'broadcast' && Math.random() < sim.loss) {
            return Promise.resolve('ok');
        }
        const delay = sim.lag + Math.random() * sim.jitter;
        if (delay <= 0) return send(message, opts);
        return new Promise((resolve) => {
            window.setTimeout(() => resolve(send(message, opts)), delay);
        });
    }) as RealtimeChannel['send'];
};

// quick join lobbies: RING1, RING2, ... each up to this many drivers
const PUBLIC_LOBBY_PREFIX = 'RING';
const PUBLIC_LOBBIES = 6;
const PUBLIC_LOBBY_SIZE = 8;
const PRESENCE_WAIT_MS = 1500;
const MAX_POSITION_ABS = 1000000;
const JOIN_SUBSCRIBE_TIMEOUT_MS = 12000;
const CONFIG_FETCH_TIMEOUT_MS = 10000;

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
    // set by the first presence sync of the current lobby
    presenceSynced = false;
    // the lobby to rejoin after a hidden tab or a trip out of race mode
    suspended: { code: string; host: boolean } | null = null;
    localLook: CarLook = STOCK_LOOK;
    localTuned = false;
    // lowest delay seen per sender (ms, their clock to ours)
    peerDelays = new Map<string, { floor: number; at: number }>();
    laps: MultiplayerLapState[];
    listeners: Set<(state: MultiplayerState) => void>;
    bumpListeners: Set<(bump: MultiplayerBump) => void>;
    lastTelemetrySentAt: number;
    lastTelemetryStateEmitAt: number;
    lastTelemetrySignature: string;
    lastTelemetryHeartbeatAt: number;
    joinRequestCounter: number;
    cancelPendingSubscription: (() => void) | null;

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
        this.bumpListeners = new Set();
        this.lastTelemetrySentAt = -Infinity;
        this.lastTelemetryStateEmitAt = -Infinity;
        this.lastTelemetrySignature = '';
        this.lastTelemetryHeartbeatAt = -Infinity;
        this.joinRequestCounter = 0;
        this.cancelPendingSubscription = null;
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
        // tests: an in browser stand in, nothing reaches supabase
        if (mockRealtimeEnabled()) {
            this.supabase = createMockRealtime() as unknown as SupabaseClient;
            this.supported = true;
            this.error = null;
            this.emitState();
            return;
        }
        const controller = new AbortController();
        const timeout = setTimeout(
            () => controller.abort(),
            CONFIG_FETCH_TIMEOUT_MS
        );

        try {
            const response = await fetch(CONFIG_URL, {
                cache: 'no-store',
                signal: controller.signal,
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
            const { createClient } = await import('@supabase/supabase-js');
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
        } catch {
            this.supported = false;
            this.error = 'Multiplayer unavailable: config load failed.';
            this.emitState();
        } finally {
            clearTimeout(timeout);
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

    // no server to match players, so quick join walks a few well known public
    // lobbies and takes the first with room. presence tells us who's in
    async quickJoin(playerName: string, carId: string): Promise<LobbyJoinResult> {
        await this.initialize();
        if (!this.supabase || !this.supported) {
            this.error = 'Multiplayer requires a valid Supabase runtime config.';
            this.emitState();
            return { ok: false, error: this.error };
        }
        for (let i = 1; i <= PUBLIC_LOBBIES; i++) {
            const code = `${PUBLIC_LOBBY_PREFIX}${i}`;
            const result = await this.joinLobbyInternal(code, playerName, carId, false);
            if (!result.ok) return result;
            await this.waitForPresence(PRESENCE_WAIT_MS);
            if (this.players.size <= PUBLIC_LOBBY_SIZE || i === PUBLIC_LOBBIES) {
                return result;
            }
            await this.leaveLobby(true);
        }
        return { ok: false, error: 'No public lobby found.' };
    }

    // resolves on the first presence sync after joining, or after the wait
    waitForPresence(timeoutMs: number) {
        return new Promise<void>((resolve) => {
            const started = performance.now();
            const check = () => {
                if (this.presenceSynced || performance.now() - started > timeoutMs) {
                    resolve();
                    return;
                }
                window.setTimeout(check, 100);
            };
            check();
        });
    }

    async leaveLobby(internal = false) {
        if (!internal) {
            this.joinRequestCounter++;
            // leaving on purpose: no rejoin later
            this.suspended = null;
        }
        this.cancelPendingSubscription?.();
        this.cancelPendingSubscription = null;
        this.connecting = false;
        this.connected = false;
        this.mode = 'solo';
        this.peerDelays.clear();
        this.lobbyCode = null;
        this.isHost = false;
        this.players.clear();
        this.laps = [];
        this.lastTelemetrySentAt = -Infinity;
        this.lastTelemetrySignature = '';
        this.lastTelemetryHeartbeatAt = -Infinity;
        this.error = null;
        const channel = this.channel;
        this.channel = null;
        if (channel) {
            await this.teardownChannel(channel);
        }
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
        // name changes ride on telemetry, presence is join and leave only
        this.touchLocalPlayer();
        this.emitState();
    }

    // goes out with the next telemetry packet, no message of its own
    setLocalLook(look: CarLook, tuned: boolean) {
        this.localLook = sanitizeLook(look);
        this.localTuned = tuned;
    }

    setLocalCarId(carId: string) {
        this.localCarId = carOptionsById[carId] ? carId : defaultCarId;
        this.touchLocalPlayer();
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
        velocity?: { x: number; z: number };
        yawRate?: number;
        ghost?: boolean;
    }) {
        if (!this.connected || !this.channel) return;
        // nobody to send to
        if (!this.hasRemotePlayers()) return;

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
            velocity: [
                this.roundTo(this.clampNumber(payload.velocity?.x ?? 0, -150, 150), 2),
                this.roundTo(this.clampNumber(payload.velocity?.z ?? 0, -150, 150), 2),
            ],
            yaw_rate: this.roundTo(this.clampNumber(payload.yawRate ?? 0, -12, 12), 3),
            ghost: Boolean(payload.ghost),
            sent_at: new Date(now).toISOString(),
            look: encodeLook(this.localLook),
            tuned: this.localTuned,
        };
        // the pose to a few cm, not the lap clock (it always changes), so a
        // parked car counts as unchanged
        const signature = JSON.stringify({
            speed_kph: Math.round(safePayload.speed_kph),
            position: safePayload.position.map((v) => Math.round(v * 20)),
            quaternion: safePayload.quaternion.map((v) => Math.round(v * 500)),
            gear: safePayload.gear,
            ghost: safePayload.ghost,
            car_id: safePayload.car_id,
            name: safePayload.name,
            look: safePayload.look,
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
        if (!this.hasRemotePlayers()) return;

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
        const supabase = this.supabase;
        if (!supabase) return;
        try {
            await channel.untrack();
        } catch {
            // no-op
        }
        try {
            await supabase.removeChannel(channel);
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

        channel.on('broadcast', { event: 'bump' }, ({ payload }) => {
            this.handleRemoteBump(payload);
        });
    }

    // car to car contact: the client that resolved it sends the other car its
    // half of the impulse (world x/z, N s) and where it landed
    onBump(listener: (bump: MultiplayerBump) => void) {
        this.bumpListeners.add(listener);
        return () => this.bumpListeners.delete(listener);
    }

    sendBump(bump: MultiplayerBump) {
        if (!this.connected || !this.channel) return;
        if (!this.hasRemotePlayers()) return;
        this.channel.send({
            type: 'broadcast',
            event: 'bump',
            payload: {
                ...bump,
                from: this.localSessionId,
            },
        });
    }

    handleRemoteBump(payload: unknown) {
        if (!payload || typeof payload !== 'object') return;
        const parsed = payload as Partial<MultiplayerBump> & { from?: string };
        if (this.sanitizeSessionId(parsed.target || '') !== this.localSessionId) return;
        const bump: MultiplayerBump = {
            target: this.localSessionId,
            from: this.sanitizeSessionId(parsed.from || ''),
            ix: this.clampNumber(parsed.ix, -60000, 60000),
            iz: this.clampNumber(parsed.iz, -60000, 60000),
            px: this.clampNumber(parsed.px, -500000, 500000),
            pz: this.clampNumber(parsed.pz, -500000, 500000),
        };
        this.bumpListeners.forEach((listener) => listener(bump));
    }

    subscribeChannel(channel: RealtimeChannel, timeoutMs: number) {
        return new Promise<boolean>((resolve) => {
            let settled = false;
            let cancelSubscription: (() => void) | null = null;
            const finish = (subscribed: boolean) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                if (this.cancelPendingSubscription === cancelSubscription) {
                    this.cancelPendingSubscription = null;
                }
                resolve(subscribed);
            };
            const timeout = setTimeout(() => finish(false), timeoutMs);
            cancelSubscription = () => finish(false);
            this.cancelPendingSubscription?.();
            this.cancelPendingSubscription = cancelSubscription;

            channel.subscribe((status) => {
                if (this.channel !== channel) {
                    finish(false);
                    return;
                }
                if (!settled) {
                    if (status === 'SUBSCRIBED') {
                        finish(true);
                        return;
                    }
                    if (
                        status === 'CHANNEL_ERROR' ||
                        status === 'TIMED_OUT' ||
                        status === 'CLOSED'
                    ) {
                        finish(false);
                    }
                    return;
                }
                if (status === 'SUBSCRIBED') {
                    this.handleChannelReconnected(channel);
                    return;
                }
                if (
                    status === 'CHANNEL_ERROR' ||
                    status === 'TIMED_OUT' ||
                    status === 'CLOSED'
                ) {
                    this.handleChannelDisconnected(channel);
                }
            });
        });
    }

    handleChannelReconnected(channel: RealtimeChannel) {
        if (
            this.channel !== channel ||
            this.mode !== 'lobby' ||
            this.connected
        ) {
            return;
        }

        this.connecting = false;
        this.connected = true;
        this.error = null;
        this.touchLocalPlayer();
        this.pushLocalPresenceUpdate();
        this.emitState();
    }

    handleChannelDisconnected(channel: RealtimeChannel) {
        if (
            this.channel !== channel ||
            this.mode !== 'lobby' ||
            !this.connected
        ) {
            return;
        }

        this.connecting = false;
        this.connected = false;
        this.error = 'Lost connection to the lobby.';
        this.players.clear();
        this.laps = [];
        this.emitState();
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
        this.presenceSynced = false;
        this.lobbyCode = lobbyCode;
        this.isHost = isHost;
        this.localInstanceId = this.createRandomToken(12);
        this.setLocalPlayerName(playerName);
        this.setLocalCarId(carId);
        this.emitState();

        const channelName = `${this.lobbyChannelPrefix}_${PHYSICS_SEASON}:${lobbyCode}`;
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
            simulateNetwork(channel);
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
            look: this.localLook,
            tuned: this.localTuned,
        };

        // presence carries the profile, once on join (and it goes on leave).
        // later name or car changes ride on telemetry
        try {
            await channel.track(profile);
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
        this.presenceSynced = true;

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
                const isHost = this.readBooleanField(raw, 'is_host');
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
                    existing.look = sanitizeLook((raw as { look?: unknown }).look);
                    existing.tuned = (raw as { tuned?: unknown }).tuned === true;
                    existing.isHost = isHost;
                    existing.lastSeenAt = nowIso;
                    return;
                }

                this.players.set(sessionId, {
                    sessionId,
                    name,
                    carId,
                    look: sanitizeLook((raw as { look?: unknown }).look),
                    tuned: (raw as { tuned?: unknown }).tuned === true,
                    connectedAt,
                    isHost,
                    speedKph: 0,
                    lapProgress: 0,
                    lapTimeMs: 0,
                    driftIntensity: 0,
                    position: null,
                    quaternion: null,
                    velocity: null,
                    yawRate: 0,
                    ghost: false,
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
        const look = sanitizeLook(parsed.look);
        const tuned = parsed.tuned === true;
        const existing = this.players.get(sessionId);
        const nowIso = new Date().toISOString();
        if (existing) {
            existing.look = look;
            existing.tuned = tuned;
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
                velocity: null,
                yawRate: 0,
                ghost: false,
                lastSeenAt: nowIso,
                look,
                tuned,
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

        const nowIso = new Date().toISOString();
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
            velocity: null,
            yawRate: 0,
            ghost: false,
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
        player.velocity = Array.isArray(parsed.velocity)
            ? [
                  this.clampNumber(parsed.velocity[0], -150, 150),
                  this.clampNumber(parsed.velocity[1], -150, 150),
              ]
            : null;
        player.yawRate = this.clampNumber(parsed.yaw_rate ?? 0, -12, 12);
        player.ghost = Boolean(parsed.ghost);
        if (typeof parsed.look === 'string') player.look = decodeLook(parsed.look);
        player.tuned = parsed.tuned === true;
        player.lastSeenAt = nowIso;
        player.sampleAtMs = this.estimateSampleTime(sessionId, parsed.sent_at);

        this.players.set(sessionId, player);
        this.emitTelemetryState();
    }

    // arrival minus transit. with synced clocks (ntp, most devices) transit is
    // arrival minus the sender's stamp. a clock that's off shows up as a
    // lowest delay that's negative or huge, then the lowest seen is taken as
    // a ~60 ms trip and the rest as skew
    estimateSampleTime(sessionId: string, sentAt: string | undefined) {
        const now = Date.now();
        const sent = Date.parse(sentAt || '');
        if (!Number.isFinite(sent)) return now;
        const delay = now - sent;
        const seen = this.peerDelays.get(sessionId);
        // the floor creeps up 1 ms a second so a clock step or route change
        // is picked up again
        const floor = seen ? Math.min(delay, seen.floor + (now - seen.at) / 1000) : delay;
        this.peerDelays.set(sessionId, { floor, at: now });
        const skew = floor < -20 || floor > 400 ? floor - 60 : 0;
        const transit = this.clampNumber(delay - skew, 0, 500);
        return now - transit;
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
            look: this.localLook,
            tuned: this.localTuned,
        };
        this.channel.track(payload).catch(() => undefined);
    }

    hasRemotePlayers() {
        for (const id of this.players.keys()) {
            if (id !== this.localSessionId) return true;
        }
        return false;
    }

    // a hidden tab or leaving race mode drops the realtime connection, and
    // coming back joins the same lobby again
    async suspend() {
        if (this.mode !== 'lobby' || !this.lobbyCode || this.suspended) return;
        const saved = { code: this.lobbyCode, host: this.isHost };
        await this.leaveLobby();
        this.suspended = saved;
        this.emitState();
    }

    async resume() {
        const suspended = this.suspended;
        if (!suspended) return;
        this.suspended = null;
        if (this.mode === 'lobby') return;
        await this.joinLobbyInternal(suspended.code, this.localPlayerName, this.localCarId, suspended.host);
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
            velocity: null,
            yawRate: 0,
            ghost: false,
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
        const clean = Array.from(String(name || ''))
            .filter((character) => !/[\u0000-\u001F\u007F-\u009F]/.test(character))
            .slice(0, MAX_NAME_LENGTH)
            .join('')
            .trim();
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
            const next = randomInt(alphabet.length);
            code += alphabet[next];
        }
        return code;
    }

    createRandomToken(length: number) {
        const alphabet =
            'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let out = '';
        for (let i = 0; i < length; i++) {
            const index = randomInt(alphabet.length);
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
        const maxComponent = Math.max(
            Math.abs(x),
            Math.abs(y),
            Math.abs(z),
            Math.abs(w)
        );
        if (maxComponent === 0) {
            return [0, 0, 0, 0] as MultiplayerQuaternion;
        }
        const scaledX = x / maxComponent;
        const scaledY = y / maxComponent;
        const scaledZ = z / maxComponent;
        const scaledW = w / maxComponent;
        const invLength = 1 / Math.hypot(scaledX, scaledY, scaledZ, scaledW);
        return [
            scaledX * invLength,
            scaledY * invLength,
            scaledZ * invLength,
            scaledW * invLength,
        ] as MultiplayerQuaternion;
    }
    isRecord(value: unknown): value is Record<string, unknown> {
        return value !== null && typeof value === 'object';
    }

    readBooleanField(source: unknown, key: string) {
        return this.isRecord(source) && source[key] === true;
    }

    readStringField(source: unknown, key: string) {
        if (!this.isRecord(source)) return '';
        const value = source[key];
        return typeof value === 'string' ? value : '';
    }
}
