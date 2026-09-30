import * as THREE from 'three';
import Application from '../Application';
import UIEventBus from '../UI/EventBus';
import NordschleifeTrack from './Track/NordschleifeTrack';
import RaceVehicle, { type WheelVisualMeta } from './Vehicle/RaceVehicle';
import { peakOutput, predictTopSpeed, rpmAtSpeed } from './Vehicle/VehiclePhysics';
import RaceChaseCamera from './Camera/RaceChaseCamera';
import LapTimer from './Lap/LapTimer';
import SectorTimer from './Lap/SectorTimer';
import { isStockSetup, sanitizeLook, sanitizeTune, STOCK_LOOK, tuneCode } from './Garage/garage';
import { carHasCalipers } from './Garage/carLook';
import LocalLeaderboard, { type LeaderboardEntry } from './Leaderboard/LocalLeaderboard';
import LeaderboardService from './Leaderboard/LeaderboardService';
import RaceEngineAudio from './Audio/RaceEngineAudio';
import type { RemoteCarAudioState } from './Audio/CarAudio';
import GhostReplay from './Ghost/GhostReplay';
import DriftSmoke from './Effects/DriftSmoke';
import MultiplayerService, {
    type MultiplayerPlayerState,
} from './Multiplayer/MultiplayerService';
import RaceVisuals from './Visuals/RaceVisuals';
import CarCollisions, { type RemoteCar } from './Multiplayer/CarCollisions';
import { carOptionsById } from '../carOptions';
import { drain, type Steps } from './slicing';

type RaceModeState = {
    active: boolean;
    paused: boolean;
};

type MultiplayerActionPayload = {
    playerName?: string;
    lobbyCode?: string;
    startRace?: boolean;
};

const MAX_VEHICLE_SUBSTEP_SECONDS = 1 / 60;
const MAX_FRAME_DELTA_SECONDS = 0.05;
const MAX_PHYSICS_STEPS_PER_FRAME = 4;
const AUDIO_LISTENER_POSITION = new THREE.Vector3();
const AUDIO_LISTENER_FORWARD = new THREE.Vector3();
const AUDIO_LISTENER_UP = new THREE.Vector3();
const AUDIO_LISTENER_QUAT = new THREE.Quaternion();
const AUDIO_REMOTE_POSITION = new THREE.Vector3();

type RemoteLinkedWheelVisual = {
    object: THREE.Object3D;
    spinCenter: THREE.Vector3;
    basePosition: THREE.Vector3;
    baseQuaternion: THREE.Quaternion;
};

type RemoteWheelVisual = {
    object: THREE.Object3D;
    front: boolean;
    spinCenter: THREE.Vector3;
    basePosition: THREE.Vector3;
    baseQuaternion: THREE.Quaternion;
    spinAxis: THREE.Vector3;
    spinSign: number;
    linkedVisuals: RemoteLinkedWheelVisual[];
};

type RemoteVehicleVisual = {
    sessionId: string;
    carId: string;
    root: THREE.Group;
    wheelRig: RemoteWheelVisual[];
    rearWheelRig: RemoteWheelVisual[];
    wheelRadius: number;
    wheelSpinAngle: number;
    targetPosition: THREE.Vector3;
    targetQuaternion: THREE.Quaternion;
    model: THREE.Object3D;
    // the look applied last, as json, to spot changes
    lookKey: string;
};

export default class RaceManager {
    application: Application;
    scene: THREE.Scene;
    raceRoot: THREE.Group;
    visuals: RaceVisuals;
    collisions: CarCollisions;
    remoteCars: RemoteCar[];
    active: boolean;
    initialized: boolean;
    track: NordschleifeTrack;
    vehicle: RaceVehicle;
    chaseCamera: RaceChaseCamera;
    paused: boolean;
    lapTimer: LapTimer;
    sectors: SectorTimer;
    garageOpen = false;
    // the homepage transition parks the car while the ring builds around it,
    // so it sits exactly where the room's last frame shows it
    transitionHold = false;
    garageSetupAtOpen = '';
    leaderboardBoard: 'stock' | 'tuned' = 'stock';
    lastLapTimeMs = 0;
    localLeaderboard: LocalLeaderboard;
    leaderboardService: LeaderboardService;
    currentLapTimeMs: number;
    lapRunning: boolean;
    // the first lap's clock is at 0, waiting for the car to move
    lapArmed = false;
    lapProgress: number;
    pendingLapTimeMs: number;
    lapSubmitInFlight: boolean;
    lastHudDispatchMs: number;
    engineAudio: RaceEngineAudio;
    ghostReplay: GhostReplay;
    remoteSmoke: DriftSmoke;
    multiplayer: MultiplayerService;
    remoteVehicles: Map<string, RemoteVehicleVisual>;
    remoteSmokeCooldownBySession: Map<string, number>;
    pendingRemoteCarLoads: Set<string>;
    tmpRemotePosition: THREE.Vector3;
    tmpRemoteQuaternion: THREE.Quaternion;
    tmpRemoteForward: THREE.Vector3;
    tmpRemoteUp: THREE.Vector3;
    tmpRemoteSide: THREE.Vector3;
    tmpRemoteVectorA: THREE.Vector3;
    tmpRemoteVectorB: THREE.Vector3;
    tmpRemoteVectorC: THREE.Vector3;
    tmpRemoteVectorD: THREE.Vector3;
    tmpRemoteVectorE: THREE.Vector3;
    tmpRemoteVectorF: THREE.Vector3;
    tmpRemoteQuatA: THREE.Quaternion;
    tmpRemoteQuatB: THREE.Quaternion;
    tmpRemoteQuatC: THREE.Quaternion;
    tmpRemoteQuatD: THREE.Quaternion;
    tmpRemoteQuatE: THREE.Quaternion;
    tmpRemoteQuatF: THREE.Quaternion;
    remoteSessionScratch: Set<string>;
    hiddenLobbyObjects: THREE.Object3D[];
    defaultSceneBackground: THREE.Color | THREE.Texture | THREE.CubeTexture | null;
    defaultSceneFog: THREE.Fog | THREE.FogExp2 | null;
    topLeaderboardGhostLapId: string | null;
    topLeaderboardGhostRequestSerial: number;
    physicsAccumulator: number;
    lastPhysicsStepTimeMs: number;
    debugGameEnabled: boolean;
    ghostPlaybackEnabled: boolean;
    lastStartResets: number;

    // built when constructed, or with defer by running pending (the
    // homepage builds it a slice a frame)
    pending: Steps;

    constructor(defer = false) {
        this.pending = this.build();
        if (!defer) drain(this.pending);
    }

    private *build(): Steps {
        this.application = new Application();
        this.scene = this.application.scene;
        this.active = false;
        this.initialized = false;
        this.paused = false;

        this.raceRoot = new THREE.Group();
        this.raceRoot.name = 'race-mode-root';
        this.raceRoot.visible = false;
        this.raceRoot.userData.raceRoot = true;
        this.scene.add(this.raceRoot);

        this.track = new NordschleifeTrack(this.raceRoot, true);
        yield* this.track.pending;
        this.vehicle = new RaceVehicle(this.raceRoot, this.track);
        yield 'vehicle';
        this.chaseCamera = new RaceChaseCamera(this.vehicle);
        this.visuals = new RaceVisuals(this.raceRoot, this.track, this.vehicle, true);
        yield* this.visuals.pending;
        this.collisions = new CarCollisions(this.vehicle);
        this.remoteCars = [];

        this.lapTimer = new LapTimer(this.track.getCurve());
        // sectors split at breidscheid and bruennchen, about 7.7, 6.5 and
        // 6.6 km
        const splitAt = (name: string, fallback: number) => {
            const section = this.track.sections.find((s) => s.name === name);
            return (section ? section.distance : fallback) / this.track.length;
        };
        this.sectors = new SectorTimer(
            [splitAt('Breidscheid', 7720), splitAt('Brünnchen', 14228)],
            ['T13 to Breidscheid', 'Breidscheid to Brünnchen', 'Brünnchen to the line']
        );
        this.localLeaderboard = new LocalLeaderboard();
        this.leaderboardService = new LeaderboardService(this.localLeaderboard);
        this.currentLapTimeMs = 0;
        this.lapRunning = false;
        this.lapProgress = 0;
        this.pendingLapTimeMs = 0;
        this.lapSubmitInFlight = false;
        this.lastHudDispatchMs = 0;
        this.engineAudio = new RaceEngineAudio();
        this.ghostReplay = new GhostReplay(
            this.raceRoot,
            (carId) => this.vehicle.getPreparedModel(carId),
            (x, z, normal) => this.track.sampleGround(x, z, normal),
            (carId) => this.vehicle.ensurePreparedModel(carId)
        );
        this.remoteSmoke = new DriftSmoke(this.raceRoot);
        this.remoteSmoke.root.name = 'race-remote-drift-smoke-root';
        this.remoteSmoke.setActive(false);
        this.multiplayer = new MultiplayerService();
        this.collisions.sendBump = (bump) => this.multiplayer.sendBump(bump);
        this.multiplayer.onBump((bump) => {
            if (this.active) this.collisions.applyBump(bump);
        });
        this.remoteVehicles = new Map();
        this.remoteSmokeCooldownBySession = new Map();
        this.pendingRemoteCarLoads = new Set();
        this.tmpRemotePosition = new THREE.Vector3();
        this.tmpRemoteQuaternion = new THREE.Quaternion();
        this.tmpRemoteForward = new THREE.Vector3();
        this.tmpRemoteUp = new THREE.Vector3();
        this.tmpRemoteSide = new THREE.Vector3();
        this.tmpRemoteVectorA = new THREE.Vector3();
        this.tmpRemoteVectorB = new THREE.Vector3();
        this.tmpRemoteVectorC = new THREE.Vector3();
        this.tmpRemoteVectorD = new THREE.Vector3();
        this.tmpRemoteVectorE = new THREE.Vector3();
        this.tmpRemoteVectorF = new THREE.Vector3();
        this.tmpRemoteQuatA = new THREE.Quaternion();
        this.tmpRemoteQuatB = new THREE.Quaternion();
        this.tmpRemoteQuatC = new THREE.Quaternion();
        this.tmpRemoteQuatD = new THREE.Quaternion();
        this.tmpRemoteQuatE = new THREE.Quaternion();
        this.tmpRemoteQuatF = new THREE.Quaternion();
        this.remoteSessionScratch = new Set();
        this.hiddenLobbyObjects = [];
        this.defaultSceneBackground = this.scene.background;
        this.defaultSceneFog = this.scene.fog;
        this.topLeaderboardGhostLapId = null;
        this.topLeaderboardGhostRequestSerial = 0;
        this.physicsAccumulator = 0;
        this.lastPhysicsStepTimeMs = 0;
        this.lastStartResets = 0;
        this.debugGameEnabled = new URLSearchParams(window.location.search).has(
            'debugGame'
        );
        this.ghostPlaybackEnabled = new URLSearchParams(window.location.search).has(
            'ghostReplay'
        );
        this.multiplayer.onStateChange((state) => {
            if (state.mode === 'lobby' && state.connected) {
                state.players.forEach((player) => {
                    if (player.sessionId === state.localSessionId) return;
                    this.requestRemoteCarLoad(player.carId);
                });
            }
            UIEventBus.dispatch('race:multiplayerState', state);
        });
        this.leaderboardService.onLeaderboardChanged(() => {
            void this.refreshLeaderboard();
        });
        this.setupEvents();
        yield 'manager';
    }

    setupEvents() {
        UIEventBus.on('raceMode:start', () => {
            this.enterRaceMode();
        });

        UIEventBus.on('raceMode:exit', () => {
            this.exitRaceMode();
        });

        UIEventBus.on('race:pauseRequest', () => {
            if (!this.active) return;
            this.setPaused(true);
        });

        UIEventBus.on('race:resetVehicle', () => {
            if (!this.active || this.paused) return;
            this.vehicle.resetToTrack();
            this.physicsAccumulator = 0;
        });

        UIEventBus.on('race:restartLap', () => {
            if (!this.active || this.paused) return;
            this.restartLap();
        });

        UIEventBus.on(
            'race:setPaused',
            (state: { paused?: boolean } | undefined) => {
                if (!this.active) return;
                this.setPaused(Boolean(state?.paused));
            }
        );

        UIEventBus.on('race:requestLeaderboard', () => {
            this.refreshLeaderboard();
        });

        UIEventBus.on('race:multiplayerRequestState', () => {
            this.multiplayer.emitState();
        });

        UIEventBus.on(
            'race:multiplayerSetName',
            (payload: { playerName?: string } | undefined) => {
                const playerName = payload?.playerName || 'Driver';
                this.multiplayer.setLocalPlayerName(playerName);
            }
        );

        UIEventBus.on(
            'race:multiplayerPlaySolo',
            async (payload: MultiplayerActionPayload | undefined) => {
                const playerName = payload?.playerName || 'Driver';
                const startRace = Boolean(payload?.startRace);
                const telemetry = this.vehicle.getTelemetry();
                await this.multiplayer.setSoloMode(playerName, telemetry.carId);
                if (startRace) {
                    this.enterRaceMode();
                }
            }
        );

        UIEventBus.on(
            'race:multiplayerCreateLobby',
            async (payload: MultiplayerActionPayload | undefined) => {
                await this.multiplayer.initialize();
                const playerName = payload?.playerName || 'Driver';
                const startRace = Boolean(payload?.startRace);
                const telemetry = this.vehicle.getTelemetry();
                const result = await this.multiplayer.createLobby(
                    playerName,
                    telemetry.carId
                );
                if (result.ok && startRace) {
                    this.enterRaceMode();
                }
            }
        );

        UIEventBus.on(
            'race:multiplayerJoinLobby',
            async (payload: MultiplayerActionPayload | undefined) => {
                await this.multiplayer.initialize();
                const playerName = payload?.playerName || 'Driver';
                const lobbyCode = payload?.lobbyCode || '';
                const startRace = Boolean(payload?.startRace);
                const telemetry = this.vehicle.getTelemetry();
                const result = await this.multiplayer.joinLobby(
                    lobbyCode,
                    playerName,
                    telemetry.carId
                );
                if (result.ok && startRace) {
                    this.enterRaceMode();
                }
            }
        );

        UIEventBus.on(
            'race:multiplayerQuickJoin',
            async (payload: MultiplayerActionPayload | undefined) => {
                await this.multiplayer.initialize();
                const playerName = payload?.playerName || 'Driver';
                const telemetry = this.vehicle.getTelemetry();
                await this.multiplayer.quickJoin(playerName, telemetry.carId);
            }
        );

        // a hidden tab drops realtime too
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') void this.multiplayer.suspend();
            else if (this.active) void this.multiplayer.resume();
        });

        UIEventBus.on('race:multiplayerLeaveLobby', async () => {
            await this.multiplayer.leaveLobby();
            this.clearRemoteVehicles();
        });

        UIEventBus.on('carChange', (carId: string) => {
            if (!carId) return;
            this.multiplayer.setLocalCarId(carId);
            // the vehicle loads that car's garage setup on the same event
            window.setTimeout(() => this.publishGarage(), 0);
        });

        UIEventBus.on('race:garageOpen', (state: { open?: boolean } | undefined) => {
            const open = Boolean(state?.open);
            if (open === this.garageOpen) return;
            this.garageOpen = open;
            this.chaseCamera.garage = open;
            if (open) {
                this.garageSetupAtOpen = JSON.stringify([this.vehicle.look, this.vehicle.tune]);
                this.dispatchGarage();
            } else if (this.garageSetupAtOpen !== JSON.stringify([this.vehicle.look, this.vehicle.tune])) {
                // a lap can't start stock and end tuned
                this.startLapTimer();
            }
            UIEventBus.dispatch('race:inputReset', { source: 'garage' });
        });

        UIEventBus.on(
            'race:garageApply',
            (state: { look?: unknown; tune?: unknown; save?: boolean } | undefined) => {
                this.vehicle.setGarage(
                    sanitizeLook(state?.look),
                    sanitizeTune(state?.tune),
                    state?.save !== false
                );
                this.publishGarage();
                this.dispatchGarage();
            }
        );

        UIEventBus.on('race:leaderboardBoard', (state: { board?: string } | undefined) => {
            this.leaderboardBoard = state?.board === 'tuned' ? 'tuned' : 'stock';
            void this.refreshLeaderboard();
        });

        UIEventBus.on('race:submitLapName', async (payload: { name?: string }) => {
            const explicitName = (payload?.name || '').trim().slice(0, 16);
            await this.submitPendingLap(explicitName);
        });
    }

    async submitPendingLap(preferredName?: string) {
        if (!this.pendingLapTimeMs) return;
        if (this.lapSubmitInFlight) return;

        this.lapSubmitInFlight = true;
        const lapTimeMs = this.pendingLapTimeMs;
        this.pendingLapTimeMs = 0;

        const fallbackName = this.multiplayer.getLocalPlayerName() || 'Driver';
        const name = (preferredName || fallbackName).trim().slice(0, 16) || 'Driver';
        const lapReplay = this.ghostReplay.getLastCompletedLapReplay(lapTimeMs);

        try {
            const telemetry = this.vehicle.getTelemetry();
            const { tune, look } = this.vehicle;
            const entry = await this.leaderboardService.submitLap(
                name,
                lapTimeMs,
                telemetry.carId,
                lapReplay,
                isStockSetup(tune, look) ? undefined : tuneCode(tune, look)
            );
            this.multiplayer.setLocalPlayerName(name);
            this.multiplayer.publishLap(entry);
            await this.refreshLeaderboard();
            UIEventBus.dispatch('race:lapSubmitted', {
                entry,
            });
        } finally {
            this.lapSubmitInFlight = false;
            if (this.pendingLapTimeMs > 0) {
                void this.submitPendingLap();
            }
        }
    }

    enterRaceMode() {
        if (this.active) return;
        void this.multiplayer.resume();
        UIEventBus.dispatch('race:trackOutline', { points: this.getTrackOutline() });

        this.initialized = true;
        this.active = true;
        this.paused = false;
        this.setLobbyObjectsVisible(false);
        this.raceRoot.visible = true;
        this.visuals.enter();
        this.vehicle.spawnSlot = this.getSpawnSlot();
        this.vehicle.resetToStart();
        this.physicsAccumulator = 0;
        this.lastPhysicsStepTimeMs = 0;
        this.vehicle.setActive(true);
        this.chaseCamera.setActive(true);
        this.chaseCamera.setPaused(false);
        this.pendingLapTimeMs = 0;
        this.lapSubmitInFlight = false;
        this.ghostReplay.setActive(this.ghostPlaybackEnabled);
        this.startLapTimer();
        this.remoteSmoke.setActive(true);

        UIEventBus.dispatch('freeCamToggle', false);
        this.setLayerInteraction(true);
        this.dispatchState();
        UIEventBus.dispatch('race:pauseState', { paused: false });
        UIEventBus.dispatch('race:inputReset', { source: 'enterRaceMode' });
        this.refreshLeaderboard();
        this.engineAudio.setRaceActive(true);
        this.engineAudio.setPaused(false);
    }

    // back to the start line with a fresh lap, keeping race mode running
    restartLap() {
        this.vehicle.spawnSlot = this.getSpawnSlot();
        this.vehicle.resetToStart();
        this.startLapTimer();
    }

    // lobby players line up by when they joined
    getSpawnSlot() {
        const state = this.multiplayer.getState();
        if (state.mode !== 'lobby') return 0;
        const order = [...state.players]
            .sort(
                (a, b) =>
                    a.connectedAt.localeCompare(b.connectedAt) ||
                    a.sessionId.localeCompare(b.sessionId)
            )
            .map((player) => player.sessionId);
        return Math.max(0, order.indexOf(state.localSessionId));
    }

    startLapTimer() {
        this.physicsAccumulator = 0;
        this.lapTimer.reset();
        this.sectors.reset();
        const nowMs = this.application.time.elapsed;
        const telemetry = this.vehicle.getTelemetry();
        // the clock starts on the first movement (LapTimer.arm), the ghost
        // and the sectors with it
        const lapStart = this.lapTimer.arm(nowMs, telemetry.position);
        this.currentLapTimeMs = lapStart.lapTimeMs;
        this.lapRunning = lapStart.lapRunning;
        this.lapArmed = lapStart.armed;
        this.lapProgress = lapStart.progress;
        this.ghostReplay.holdAtStart();
        this.lastStartResets = this.vehicle.startResets;
    }

    exitRaceMode() {
        if (!this.initialized && !this.active) return;
        // no realtime traffic outside race mode, the lobby is rejoined on return
        void this.multiplayer.suspend();

        this.active = false;
        this.paused = false;
        this.transitionHold = false;
        this.raceRoot.visible = false;
        this.visuals.exit();
        this.setLobbyObjectsVisible(true);
        this.scene.background = this.defaultSceneBackground;
        this.scene.fog = this.defaultSceneFog;
        this.vehicle.setActive(false);
        this.physicsAccumulator = 0;
        this.chaseCamera.setPaused(false);
        this.chaseCamera.setActive(false);
        this.pendingLapTimeMs = 0;
        this.lapSubmitInFlight = false;
        this.ghostReplay.cancelLap();
        this.ghostReplay.setActive(false);
        this.remoteSmoke.setActive(false);
        this.clearRemoteVehicles();

        this.setLayerInteraction(false);
        this.dispatchState();
        UIEventBus.dispatch('race:pauseState', { paused: false });
        UIEventBus.dispatch('race:inputReset', { source: 'exitRaceMode' });
        this.engineAudio.setPaused(false);
        this.engineAudio.setRaceActive(false);
    }

    setLayerInteraction(raceActive: boolean) {
        const webgl = document.getElementById('webgl');
        if (webgl) {
            webgl.style.pointerEvents = raceActive ? 'auto' : 'none';
        }

        if (this.application.renderer.cssInstance?.domElement) {
            this.application.renderer.cssInstance.domElement.style.pointerEvents =
                raceActive ? 'none' : 'auto';
        }
    }

    setLobbyObjectsVisible(visible: boolean) {
        if (!visible) {
            this.hiddenLobbyObjects = [];
            this.scene.children.forEach((child) => {
                // the room lights go too, race mode has its own sun and sky
                if (child === this.raceRoot) return;
                if (!child.visible) return;
                child.visible = false;
                this.hiddenLobbyObjects.push(child);
            });
            return;
        }

        this.hiddenLobbyObjects.forEach((object) => {
            object.visible = true;
        });
        this.hiddenLobbyObjects = [];
    }

    dispatchState() {
        const state: RaceModeState = {
            active: this.active,
            paused: this.paused,
        };
        UIEventBus.dispatch('raceMode:changed', state);
    }

    getTrack() {
        return this.track;
    }

    getVehicle() {
        return this.vehicle;
    }

    setPaused(paused: boolean) {
        this.paused = paused;
        this.vehicle.setActive(!paused);
        this.chaseCamera.setPaused(paused);
        this.physicsAccumulator = 0;
        this.engineAudio.setPaused(paused);
        if (paused) {
            UIEventBus.dispatch('race:inputReset', {
                source: 'setPaused',
            });
        }
        UIEventBus.dispatch('race:pauseState', { paused });
        this.dispatchState();
    }

    publishGarage() {
        const { look, tune } = this.vehicle;
        this.multiplayer.setLocalLook(look, !isStockSetup(tune, look));
    }

    // what the garage screen shows: the current setup and the car's numbers,
    // worked out from the physics the car drives with
    dispatchGarage() {
        const { look, tune } = this.vehicle;
        const spec = this.vehicle.physics.spec;
        const peak = peakOutput(spec);
        const top = predictTopSpeed(spec);
        UIEventBus.dispatch('race:garageState', {
            carId: this.vehicle.currentCarId,
            look,
            tune,
            calipers: carHasCalipers(this.vehicle.currentCarId),
            speedLimiter: this.vehicle.currentTuning.speedLimitKph,
            tuned: !isStockSetup(tune, look),
            stats: {
                powerKw: Math.round(peak.powerW / 1000),
                torqueNm: Math.round(peak.torqueNm),
                grip: Math.round(spec.tireGrip * 100) / 100,
                topKph: Math.round(top.speed * 3.6),
                topLimitedBy: top.limitedBy,
                downforce: Math.round(spec.clA * 100) / 100,
                brakeFront: Math.round(spec.brakeBias * 100),
                rpmAt100: Math.round(
                    rpmAtSpeed(spec, 100 / 3.6, spec.gearRatios.length)
                ),
            },
        });
    }

    async refreshLeaderboard() {
        const board = this.leaderboardBoard;
        const entries = await this.leaderboardService.getLeaderboard(10, board);
        UIEventBus.dispatch('race:leaderboardUpdate', {
            entries,
            board,
        });
        // the ghost to chase is always the stock record
        if (board === 'stock') void this.syncTopLeaderboardGhost(entries);
    }

    async syncTopLeaderboardGhost(entries: LeaderboardEntry[]) {
        const topEntry = entries[0];
        if (!this.ghostPlaybackEnabled) {
            this.topLeaderboardGhostLapId = null;
            this.ghostReplay.setExternalReplay(null);
            return;
        }
        if (!topEntry) {
            this.topLeaderboardGhostLapId = null;
            this.ghostReplay.setExternalReplay(null);
            return;
        }

        if (this.topLeaderboardGhostLapId === topEntry.id) {
            return;
        }

        const requestId = ++this.topLeaderboardGhostRequestSerial;
        const replay = await this.leaderboardService.getGhostReplayForLap(
            topEntry.id,
            topEntry.carId,
            topEntry.lapTimeMs
        );
        if (requestId !== this.topLeaderboardGhostRequestSerial) {
            return;
        }

        if (!replay || replay.samples.length < 2) {
            this.topLeaderboardGhostLapId = null;
            this.ghostReplay.setExternalReplay(null);
            return;
        }

        this.topLeaderboardGhostLapId = topEntry.id;
        this.ghostReplay.setExternalReplay({
            lapTimeMs: topEntry.lapTimeMs,
            carId: replay.carId || topEntry.carId,
            samples: replay.samples,
        });
    }

    // the lap as a few hundred x, z points for the minimap
    getTrackOutline() {
        const curve = this.track.getCurve();
        const points: number[][] = [];
        for (let i = 0; i < 400; i++) {
            const p = curve.getPointAt(i / 400);
            points.push([Math.round(p.x), Math.round(p.z)]);
        }
        return points;
    }

    dispatchHud() {
        const telemetry = this.vehicle.getTelemetry();
        const remotes: Array<{ x: number; z: number }> = [];
        this.remoteVehicles.forEach((visual) => {
            remotes.push({ x: visual.root.position.x, z: visual.root.position.z });
        });
        UIEventBus.dispatch('race:hudUpdate', {
            redlineRpm: this.vehicle.currentTuning.redlineRpm,
            tachMaxRpm: this.vehicle.currentTuning.tachMaxRpm,
            sectors: this.sectors.getState(),
            lastLapMs: this.lastLapTimeMs,
            map: {
                x: telemetry.position.x,
                z: telemetry.position.z,
                heading: Math.atan2(telemetry.forward.x, telemetry.forward.z),
                remotes,
            },
            speedKph: telemetry.speedKph,
            gear: telemetry.gear,
            rpm: telemetry.rpm,
            lapTimeMs: this.currentLapTimeMs,
            lapRunning: this.lapRunning,
            lapArmed: this.lapArmed,
            lapProgress: this.lapProgress,
            paused: this.paused,
            pendingLapSubmission: this.pendingLapTimeMs > 0,
            ghostBestLapMs: this.ghostReplay.getBestLapTimeMs(),
        });
    }

    clearRemoteVehicles() {
        this.remoteVehicles.forEach((visual) => {
            if (visual.root.parent) {
                visual.root.parent.remove(visual.root);
            }
        });
        this.remoteVehicles.clear();
        this.remoteSmokeCooldownBySession.clear();
        this.remoteSmoke.clear();
        this.pendingRemoteCarLoads.clear();
        this.remoteSessionScratch.clear();
    }

    removeRemoteVehicle(sessionId: string) {
        const visual = this.remoteVehicles.get(sessionId);
        if (!visual) return;
        if (visual.root.parent) {
            visual.root.parent.remove(visual.root);
        }
        this.remoteVehicles.delete(sessionId);
        this.remoteSmokeCooldownBySession.delete(sessionId);
    }

    readVec3Tuple(
        tuple: unknown,
        fallback = new THREE.Vector3()
    ): THREE.Vector3 {
        if (!Array.isArray(tuple) || tuple.length < 3) return fallback.clone();
        const x = Number(tuple[0]);
        const y = Number(tuple[1]);
        const z = Number(tuple[2]);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
            return fallback.clone();
        }
        return new THREE.Vector3(x, y, z);
    }

    readQuatTuple(
        tuple: unknown,
        fallback = new THREE.Quaternion()
    ): THREE.Quaternion {
        if (!Array.isArray(tuple) || tuple.length < 4) return fallback.clone();
        const x = Number(tuple[0]);
        const y = Number(tuple[1]);
        const z = Number(tuple[2]);
        const w = Number(tuple[3]);
        if (
            !Number.isFinite(x) ||
            !Number.isFinite(y) ||
            !Number.isFinite(z) ||
            !Number.isFinite(w)
        ) {
            return fallback.clone();
        }
        const quat = new THREE.Quaternion(x, y, z, w);
        if (quat.lengthSq() <= 1e-10) return fallback.clone();
        return quat.normalize();
    }

    buildRemoteWheelRig(model: THREE.Object3D): RemoteWheelVisual[] {
        const rawMeta = model.userData.raceWheelMeta;
        if (!Array.isArray(rawMeta)) return [];

        const wheels: RemoteWheelVisual[] = [];
        (rawMeta as WheelVisualMeta[]).forEach((entry) => {
            const objectName = String(entry?.objectName || '').trim();
            if (!objectName) return;
            const object = model.getObjectByName(objectName);
            if (!object) return;

            const spinAxis = this.readVec3Tuple(entry?.spinAxis, new THREE.Vector3(1, 0, 0));
            if (spinAxis.lengthSq() <= 1e-10) {
                spinAxis.set(1, 0, 0);
            } else {
                spinAxis.normalize();
            }

            const linkedVisuals: RemoteLinkedWheelVisual[] = [];
            if (Array.isArray(entry?.linkedVisuals)) {
                entry.linkedVisuals.forEach((linked) => {
                    const linkedName = String(linked?.objectName || '').trim();
                    if (!linkedName) return;
                    const linkedObject = model.getObjectByName(linkedName);
                    if (!linkedObject) return;
                    linkedVisuals.push({
                        object: linkedObject,
                        spinCenter: this.readVec3Tuple(linked?.spinCenter),
                        basePosition: this.readVec3Tuple(linked?.basePosition),
                        baseQuaternion: this.readQuatTuple(linked?.baseQuaternion),
                    });
                });
            }

            wheels.push({
                object,
                front: entry?.front === true,
                spinCenter: this.readVec3Tuple(entry?.spinCenter),
                basePosition: this.readVec3Tuple(entry?.basePosition),
                baseQuaternion: this.readQuatTuple(entry?.baseQuaternion),
                spinAxis,
                spinSign: Number.isFinite(Number(entry?.spinSign))
                    ? Number(entry?.spinSign)
                    : 1,
                linkedVisuals,
            });
        });
        return wheels;
    }

    createRemoteVehicle(
        player: MultiplayerPlayerState
    ): RemoteVehicleVisual | null {
        const preparedModel = this.vehicle.getPreparedModel(player.carId);
        if (!preparedModel) {
            this.requestRemoteCarLoad(player.carId);
            return null;
        }

        const originalWheelRig = preparedModel.userData.raceWheelRig;
        if (originalWheelRig) {
            delete preparedModel.userData.raceWheelRig;
        }

        let model: THREE.Group | null = null;
        try {
            model = preparedModel.clone(true) as THREE.Group;
        } catch (error) {
            console.warn(
                `[RaceManager] Failed to clone remote car model for ${player.carId}`,
                error
            );
            return null;
        } finally {
            if (originalWheelRig) {
                preparedModel.userData.raceWheelRig = originalWheelRig;
            }
        }
        if (!model) return null;

        const root = new THREE.Group();
        root.name = `race-remote-${player.sessionId}`;
        root.userData.remotePoseInitialized = false;
        model.name = `race-remote-model-${player.carId}`;
        root.add(model);
        this.raceRoot.add(root);
        const wheelRig = this.buildRemoteWheelRig(model);
        const rearWheelRig = wheelRig.filter((wheel) => !wheel.front);

        const visual: RemoteVehicleVisual = {
            sessionId: player.sessionId,
            carId: player.carId,
            root,
            wheelRig,
            rearWheelRig,
            wheelRadius: Number(model.userData.raceWheelRadius) || 0.34,
            wheelSpinAngle: 0,
            targetPosition: new THREE.Vector3(),
            targetQuaternion: new THREE.Quaternion(),
            model,
            lookKey: '',
        };
        this.remoteVehicles.set(player.sessionId, visual);
        return visual;
    }

    requestRemoteCarLoad(carId: string) {
        if (!carId || this.pendingRemoteCarLoads.has(carId)) return;
        this.pendingRemoteCarLoads.add(carId);
        this.vehicle
            .ensurePreparedModel(carId)
            .catch(() => null)
            .finally(() => {
                this.pendingRemoteCarLoads.delete(carId);
            });
    }

    ensureRemoteVehicle(player: MultiplayerPlayerState): RemoteVehicleVisual | null {
        const existing = this.remoteVehicles.get(player.sessionId);
        if (existing && existing.carId === player.carId) {
            return existing;
        }
        if (existing) {
            this.removeRemoteVehicle(player.sessionId);
        }
        return this.createRemoteVehicle(player);
    }

    rotateObjectLocalAroundCenter(
        object: THREE.Object3D,
        spinCenter: THREE.Vector3,
        localRotation: THREE.Quaternion
    ) {
        this.tmpRemoteQuatC.copy(object.quaternion);
        object.quaternion.multiply(localRotation);
        this.tmpRemoteQuatD
            .copy(object.quaternion)
            .multiply(this.tmpRemoteQuatC.invert());
        object.position
            .sub(spinCenter)
            .applyQuaternion(this.tmpRemoteQuatD)
            .add(spinCenter);
    }

    updateRemoteWheelVisuals(
        visual: RemoteVehicleVisual,
        speedMps: number,
        deltaSeconds: number
    ) {
        if (!visual.wheelRig.length) return;

        visual.wheelSpinAngle +=
            (speedMps / Math.max(0.1, visual.wheelRadius)) * deltaSeconds;
        visual.wheelRig.forEach((wheel) => {
            wheel.object.position.copy(wheel.basePosition);
            wheel.object.quaternion.copy(wheel.baseQuaternion);
            const spinAngle = visual.wheelSpinAngle * wheel.spinSign;
            const spinQuat = this.tmpRemoteQuatA.setFromAxisAngle(
                wheel.spinAxis,
                spinAngle
            );
            const wheelWorldQuaternionBeforeSpin = wheel.object.getWorldQuaternion(
                this.tmpRemoteQuatE
            );
            const wheelSpinAxisWorld = this.tmpRemoteVectorE
                .copy(wheel.spinAxis)
                .applyQuaternion(wheelWorldQuaternionBeforeSpin)
                .normalize();
            this.rotateObjectLocalAroundCenter(wheel.object, wheel.spinCenter, spinQuat);

            wheel.linkedVisuals.forEach((linked) => {
                linked.object.position.copy(linked.basePosition);
                linked.object.quaternion.copy(linked.baseQuaternion);
                const linkedWorldOrigin = linked.object.getWorldPosition(
                    this.tmpRemoteVectorA
                );
                const linkedWorldAxisTip = this.tmpRemoteVectorB
                    .copy(linkedWorldOrigin)
                    .add(wheelSpinAxisWorld);
                const linkedLocalOrigin = linked.object.worldToLocal(
                    this.tmpRemoteVectorC.copy(linkedWorldOrigin)
                );
                const linkedLocalAxisTip = linked.object.worldToLocal(
                    this.tmpRemoteVectorD.copy(linkedWorldAxisTip)
                );
                const linkedSpinAxisLocal = this.tmpRemoteVectorF
                    .copy(linkedLocalAxisTip)
                    .sub(linkedLocalOrigin);
                if (linkedSpinAxisLocal.lengthSq() <= 1e-10) {
                    linkedSpinAxisLocal.copy(wheel.spinAxis);
                } else {
                    linkedSpinAxisLocal.normalize();
                }
                const linkedSpinQuat = this.tmpRemoteQuatF.setFromAxisAngle(
                    linkedSpinAxisLocal,
                    spinAngle
                );
                this.rotateObjectLocalAroundCenter(
                    linked.object,
                    linked.spinCenter,
                    linkedSpinQuat
                );
            });
        });
    }

    getRemoteRearWheelWorldPositions(visual: RemoteVehicleVisual) {
        if (visual.rearWheelRig.length > 0) {
            return visual.rearWheelRig.map((wheel) =>
                wheel.object.getWorldPosition(new THREE.Vector3())
            );
        }

        const forward = this.tmpRemoteForward
            .set(0, 0, 1)
            .applyQuaternion(visual.root.quaternion)
            .normalize();
        const up = this.tmpRemoteUp
            .set(0, 1, 0)
            .applyQuaternion(visual.root.quaternion)
            .normalize();
        const side = this.tmpRemoteSide.crossVectors(up, forward).normalize();
        // the synced position is the chassis point, about 0.3 m over the road
        return [
            visual.root.position
                .clone()
                .addScaledVector(forward, -1.15)
                .addScaledVector(side, 0.62)
                .addScaledVector(up, -0.28),
            visual.root.position
                .clone()
                .addScaledVector(forward, -1.15)
                .addScaledVector(side, -0.62)
                .addScaledVector(up, -0.28),
        ];
    }

    updateRemoteDriftSmoke(
        visual: RemoteVehicleVisual,
        player: MultiplayerPlayerState,
        speedMps: number,
        deltaSeconds: number
    ) {
        const previousCooldown =
            this.remoteSmokeCooldownBySession.get(visual.sessionId) || 0;
        const cooldown = previousCooldown - deltaSeconds;
        const intensity = THREE.MathUtils.clamp(player.driftIntensity, 0, 1);
        if (intensity > 0.26 && speedMps > 4.5 && cooldown <= 0) {
            this.getRemoteRearWheelWorldPositions(visual).forEach((position) => {
                this.remoteSmoke.emit(position, intensity, Math.abs(speedMps));
            });
            this.remoteSmokeCooldownBySession.set(visual.sessionId, 0.03);
            return;
        }
        this.remoteSmokeCooldownBySession.set(visual.sessionId, Math.max(0, cooldown));
    }

    // the other player's car as a box for contact, from its smoothed pose
    remoteCarFrom(visual: RemoteVehicleVisual, player: MultiplayerPlayerState): RemoteCar {
        const forward = this.tmpRemoteVectorF
            .set(0, 0, 1)
            .applyQuaternion(visual.root.quaternion);
        const model = this.vehicle.getPreparedModel(visual.carId);
        const size = model?.userData.raceBodySize as number[] | undefined;
        return {
            sessionId: player.sessionId,
            x: visual.root.position.x,
            y: visual.root.position.y,
            z: visual.root.position.z,
            yaw: Math.atan2(forward.x, forward.z),
            vx: player.velocity ? player.velocity[0] : 0,
            vz: player.velocity ? player.velocity[1] : 0,
            yawRate: player.yawRate || 0,
            halfLength: (size ? size[2] : 4.7) * 0.48,
            halfWidth: (size ? size[0] : 1.95) * 0.46,
            massKg: carOptionsById[player.carId]?.race.massKg ?? 1700,
            ghost: player.ghost,
            ageMs: Math.max(0, Date.now() - Date.parse(player.lastSeenAt || '')),
        };
    }

    updateRemoteVehicleVisual(
        visual: RemoteVehicleVisual,
        player: MultiplayerPlayerState,
        deltaSeconds: number
    ) {
        if (!player.position || !player.quaternion) return;

        this.tmpRemotePosition.set(
            player.position[0],
            player.position[1],
            player.position[2]
        );
        this.tmpRemoteQuaternion.set(
            player.quaternion[0],
            player.quaternion[1],
            player.quaternion[2],
            player.quaternion[3]
        );
        if (this.tmpRemoteQuaternion.lengthSq() <= 1e-10) {
            this.tmpRemoteQuaternion.identity();
        } else {
            this.tmpRemoteQuaternion.normalize();
        }

        visual.targetPosition.copy(this.tmpRemotePosition);
        visual.targetQuaternion.copy(this.tmpRemoteQuaternion);
        const sampleAt = player.sampleAtMs ?? Date.parse(player.lastSeenAt || '');
        const telemetryAgeMs = Math.max(0, Date.now() - sampleAt);
        const extrapolationSeconds = THREE.MathUtils.clamp(
            telemetryAgeMs / 1000,
            0,
            0.45
        );
        if (extrapolationSeconds > 0 && player.velocity) {
            // predicted along the real velocity, which in a slide isn't
            // where the nose points
            visual.targetPosition.x += player.velocity[0] * extrapolationSeconds;
            visual.targetPosition.z += player.velocity[1] * extrapolationSeconds;
        } else if (extrapolationSeconds > 0 && player.speedKph > 1) {
            this.tmpRemoteForward
                .set(0, 0, 1)
                .applyQuaternion(visual.targetQuaternion)
                .normalize();
            visual.targetPosition.addScaledVector(
                this.tmpRemoteForward,
                (player.speedKph / 3.6) * extrapolationSeconds
            );
        }

        if (!visual.root.userData.remotePoseInitialized) {
            visual.root.position.copy(visual.targetPosition);
            visual.root.quaternion.copy(visual.targetQuaternion);
            visual.root.userData.remotePoseInitialized = true;
        } else {
            const teleportDistanceSq = Math.max(70, player.speedKph * 0.45) ** 2;
            const distanceSq = visual.root.position.distanceToSquared(visual.targetPosition);
            if (distanceSq > teleportDistanceSq) {
                visual.root.position.copy(visual.targetPosition);
                visual.root.quaternion.copy(visual.targetQuaternion);
            } else {
                // move with the car first, so the smoothing only eats
                // corrections and doesn't trail a fast car by a few meters
                if (player.velocity) {
                    visual.root.position.x += player.velocity[0] * deltaSeconds;
                    visual.root.position.z += player.velocity[1] * deltaSeconds;
                }
                const alpha = THREE.MathUtils.clamp(deltaSeconds * 16, 0, 1);
                visual.root.position.lerp(visual.targetPosition, alpha);
                visual.root.quaternion.slerp(visual.targetQuaternion, alpha);
            }
        }
        const speedMps = player.speedKph / 3.6;
        this.updateRemoteWheelVisuals(visual, speedMps, deltaSeconds);
        this.updateRemoteDriftSmoke(visual, player, speedMps, deltaSeconds);
    }

    updateRemoteVehicles(deltaSeconds: number) {
        const multiplayerState = this.multiplayer.getState();
        if (
            multiplayerState.mode !== 'lobby' ||
            !multiplayerState.connected ||
            !this.active
        ) {
            this.clearRemoteVehicles();
            return;
        }

        this.remoteSessionScratch.clear();
        this.remoteCars.length = 0;
        multiplayerState.players.forEach((player) => {
            if (player.sessionId === multiplayerState.localSessionId) return;
            if (!player.position || !player.quaternion) return;

            this.remoteSessionScratch.add(player.sessionId);
            const visual = this.ensureRemoteVehicle(player);
            if (!visual) return;
            const look = player.look || STOCK_LOOK;
            const lookKey = JSON.stringify(look);
            if (visual.lookKey !== lookKey) {
                visual.lookKey = lookKey;
                this.vehicle.applyLookTo(visual.model, player.carId, look);
            }
            this.updateRemoteVehicleVisual(visual, player, deltaSeconds);
            this.remoteCars.push(this.remoteCarFrom(visual, player));
        });

        Array.from(this.remoteVehicles.keys()).forEach((sessionId) => {
            if (!this.remoteSessionScratch.has(sessionId)) {
                this.removeRemoteVehicle(sessionId);
            }
        });
        this.remoteSmoke.update(deltaSeconds);
    }

    // the camera is the listener; ghost and multiplayer cars are placed in 3d
    updateWorldAudio(deltaSeconds: number) {
        const camera = this.application.camera.instance;
        camera.getWorldPosition(AUDIO_LISTENER_POSITION);
        camera.getWorldDirection(AUDIO_LISTENER_FORWARD);
        camera.getWorldQuaternion(AUDIO_LISTENER_QUAT);
        AUDIO_LISTENER_UP.set(0, 1, 0).applyQuaternion(AUDIO_LISTENER_QUAT);
        const remotes: RemoteCarAudioState[] = [];
        const state = this.multiplayer.getState();
        state.players.forEach((player) => {
            const visual = this.remoteVehicles.get(player.sessionId);
            if (!visual) return;
            const p = visual.root.getWorldPosition(AUDIO_REMOTE_POSITION);
            remotes.push({
                id: player.sessionId,
                carId: visual.carId,
                position: { x: p.x, y: p.y, z: p.z },
                speedKph: player.speedKph,
            });
        });
        const ghostCarId = this.ghostReplay.ghostCarId || this.ghostReplay.carId;
        if (this.ghostReplay.root.visible && ghostCarId && ghostCarId !== 'unknown') {
            const p = this.ghostReplay.ghostMesh.getWorldPosition(AUDIO_REMOTE_POSITION);
            remotes.push({
                id: 'ghost',
                carId: ghostCarId,
                position: { x: p.x, y: p.y, z: p.z },
                ghost: true,
            });
        }
        this.engineAudio.updateWorld(
            {
                position: AUDIO_LISTENER_POSITION,
                forward: AUDIO_LISTENER_FORWARD,
                up: AUDIO_LISTENER_UP,
            },
            remotes,
            deltaSeconds
        );
    }

    update() {
        this.multiplayer.update();
        if (!this.active) {
            this.clearRemoteVehicles();
            this.physicsAccumulator = 0;
            return;
        }

        const nowMs = this.application.time.elapsed;
        const delta = Math.min(
            MAX_FRAME_DELTA_SECONDS,
            Math.max(0, this.application.time.delta / 1000)
        );
        this.updateRemoteVehicles(delta);
        if (!this.paused && !this.garageOpen && !this.transitionHold) {
            // equal steps. a leftover sliver (a frame just over 1/60 s) used
            // to run as a microsecond step, and the grounding divides height
            // changes by the step, which could launch the car into the sky
            const physicsSteps =
                delta > 0
                    ? Math.min(
                          MAX_PHYSICS_STEPS_PER_FRAME,
                          Math.ceil(delta / MAX_VEHICLE_SUBSTEP_SECONDS - 1e-6)
                      )
                    : 0;
            const step = physicsSteps ? delta / physicsSteps : 0;
            const physicsStart =
                typeof performance !== 'undefined' ? performance.now() : Date.now();
            for (let i = 0; i < physicsSteps; i++) {
                this.vehicle.update(Math.min(MAX_VEHICLE_SUBSTEP_SECONDS, step));
                // contact with the other players, every step like the barriers
                if (this.remoteCars.length) {
                    this.collisions.localSessionId =
                        this.multiplayer.getState().localSessionId;
                    this.collisions.resolve(this.remoteCars);
                }
            }
            const physicsEnd =
                typeof performance !== 'undefined' ? performance.now() : Date.now();
            this.lastPhysicsStepTimeMs = physicsEnd - physicsStart;
            if (this.vehicle.startResets !== this.lastStartResets) {
                this.startLapTimer();
            }

            const telemetry = this.vehicle.getTelemetry();
            const lapWasRunning = this.lapRunning;
            this.engineAudio.update(telemetry, delta);
            // held throttle, or reverse. not the smoothed input: it's still
            // ramping down for a moment after a restart with the key let go
            const intent = this.vehicle.input.intent;
            const lapUpdate = this.lapTimer.update(
                nowMs,
                telemetry.position,
                telemetry.speedMps,
                telemetry.forward,
                intent.throttle > 0.05 || (telemetry.gear < 0 && intent.brake > 0.05)
            );
            this.lapArmed = Boolean(lapUpdate.armed);

            this.currentLapTimeMs = lapUpdate.lapTimeMs;
            this.lapRunning = lapUpdate.lapRunning;
            this.lapProgress = lapUpdate.progress;
            this.multiplayer.publishTelemetry({
                speedKph: telemetry.speedKph,
                lapProgress: this.lapProgress,
                lapTimeMs: this.currentLapTimeMs,
                position: telemetry.position,
                quaternion: telemetry.quaternion,
                gear: telemetry.gear,
                driftIntensity: telemetry.driftIntensity,
                velocity: { x: this.vehicle.velocity.x, z: this.vehicle.velocity.z },
                yawRate: this.vehicle.physics.yawRate,
                ghost: this.collisions.ghost,
            });

            this.sectors.setCar(telemetry.carId);
            if (!lapWasRunning && lapUpdate.lapRunning) {
                this.ghostReplay.startLap(nowMs);
                this.sectors.reset();
            }
            this.sectors.update(this.lapProgress, this.currentLapTimeMs, this.lapRunning);

            if (lapUpdate.lapRunning) {
                this.ghostReplay.capture(nowMs, {
                    position: telemetry.position,
                    quaternion: telemetry.quaternion,
                    carId: telemetry.carId,
                });
            }

            if (lapUpdate.completedLapTimeMs) {
                this.sectors.completeLap(
                    lapUpdate.completedLapTimeMs,
                    Boolean(lapUpdate.validLap)
                );
                this.lastLapTimeMs = lapUpdate.completedLapTimeMs;
                this.ghostReplay.completeLap(
                    Boolean(lapUpdate.validLap),
                    lapUpdate.completedLapTimeMs
                );
                // the next lap started on the line: record it, and the ghost
                // races it from its start too
                this.ghostReplay.startLap(nowMs);
            }

            if (lapUpdate.completedLapTimeMs && lapUpdate.validLap) {
                this.pendingLapTimeMs = lapUpdate.completedLapTimeMs;
                UIEventBus.dispatch('race:lapCompleted', {
                    lapTimeMs: lapUpdate.completedLapTimeMs,
                    carId: telemetry.carId,
                    autoSubmitted: true,
                });
                void this.submitPendingLap();
            }
        } else {
            const telemetry = this.vehicle.getTelemetry();
            this.engineAudio.update(
                { ...telemetry, throttle: 0, driftIntensity: 0 },
                delta
            );
        }
        this.track.update();
        this.ghostReplay.update(delta);
        this.chaseCamera.update(delta);
        this.visuals.update(delta);
        this.updateWorldAudio(delta);

        if (nowMs - this.lastHudDispatchMs > 75) {
            this.lastHudDispatchMs = nowMs;
            this.dispatchHud();
        }

        if (this.debugGameEnabled && nowMs % 500 < this.application.time.delta) {
            const telemetry = this.vehicle.getTelemetry();
            UIEventBus.dispatch('race:debugStats', {
                fps: Math.round(1000 / Math.max(1, this.application.time.delta)),
                frameMs: Math.round(this.application.time.delta * 10) / 10,
                physicsMs: Math.round(this.lastPhysicsStepTimeMs * 100) / 100,
                speedKph: Math.round(telemetry.speedKph),
                grounded: telemetry.grounded,
                wheelContactCount: telemetry.wheelContactCount,
                suspensionCompression: telemetry.suspensionCompression,
                roadNormal: telemetry.surfaceNormal,
            });
        }
    }
}
