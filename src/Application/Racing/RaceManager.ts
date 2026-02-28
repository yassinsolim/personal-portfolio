import * as THREE from 'three';
import Application from '../Application';
import UIEventBus from '../UI/EventBus';
import NordschleifeTrack from './Track/NordschleifeTrack';
import RaceVehicle, { type WheelVisualMeta } from './Vehicle/RaceVehicle';
import RaceChaseCamera from './Camera/RaceChaseCamera';
import LapTimer from './Lap/LapTimer';
import LocalLeaderboard, { type LeaderboardEntry } from './Leaderboard/LocalLeaderboard';
import LeaderboardService from './Leaderboard/LeaderboardService';
import RaceEngineAudio from './Audio/RaceEngineAudio';
import GhostReplay from './Ghost/GhostReplay';
import DriftSmoke from './Effects/DriftSmoke';
import MultiplayerService, {
    type MultiplayerPlayerState,
} from './Multiplayer/MultiplayerService';

type RaceModeState = {
    active: boolean;
    paused: boolean;
};

type MultiplayerActionPayload = {
    playerName?: string;
    lobbyCode?: string;
    startRace?: boolean;
};

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
};

export default class RaceManager {
    application: Application;
    scene: THREE.Scene;
    raceRoot: THREE.Group;
    active: boolean;
    initialized: boolean;
    track: NordschleifeTrack;
    vehicle: RaceVehicle;
    chaseCamera: RaceChaseCamera;
    paused: boolean;
    lapTimer: LapTimer;
    localLeaderboard: LocalLeaderboard;
    leaderboardService: LeaderboardService;
    currentLapTimeMs: number;
    lapRunning: boolean;
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
    defaultSceneFog: THREE.FogBase | null;
    topLeaderboardGhostLapId: string | null;
    topLeaderboardGhostRequestSerial: number;

    constructor() {
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

        this.track = new NordschleifeTrack(this.raceRoot);
        this.vehicle = new RaceVehicle(this.raceRoot, this.track);
        this.chaseCamera = new RaceChaseCamera(this.vehicle);
        this.lapTimer = new LapTimer(this.track.getCurve());
        this.localLeaderboard = new LocalLeaderboard();
        this.leaderboardService = new LeaderboardService(this.localLeaderboard);
        this.currentLapTimeMs = 0;
        this.lapRunning = false;
        this.lapProgress = 0;
        this.pendingLapTimeMs = 0;
        this.lapSubmitInFlight = false;
        this.lastHudDispatchMs = 0;
        this.engineAudio = new RaceEngineAudio();
        this.ghostReplay = new GhostReplay(this.raceRoot);
        this.remoteSmoke = new DriftSmoke(this.raceRoot);
        this.remoteSmoke.root.name = 'race-remote-drift-smoke-root';
        this.remoteSmoke.setActive(false);
        this.multiplayer = new MultiplayerService();
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
        this.multiplayer.onStateChange((state) => {
            if (state.mode === 'lobby' && state.connected) {
                state.players.forEach((player) => {
                    if (player.sessionId === state.localSessionId) return;
                    this.requestRemoteCarLoad(player.carId);
                });
            }
            UIEventBus.dispatch('race:multiplayerState', state);
        });
        void this.multiplayer.initialize();
        this.leaderboardService.onLeaderboardChanged(() => {
            void this.refreshLeaderboard();
        });
        this.setupEvents();
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

        UIEventBus.on('race:multiplayerLeaveLobby', async () => {
            await this.multiplayer.leaveLobby();
            this.clearRemoteVehicles();
        });

        UIEventBus.on('carChange', (carId: string) => {
            if (!carId) return;
            this.multiplayer.setLocalCarId(carId);
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
            const entry = await this.leaderboardService.submitLap(
                name,
                lapTimeMs,
                telemetry.carId,
                lapReplay
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

        this.initialized = true;
        this.active = true;
        this.paused = false;
        this.setLobbyObjectsVisible(false);
        this.scene.background = new THREE.Color(0x0b0f14);
        this.scene.fog = new THREE.Fog(0x0b0f14, 380, 8800);
        this.raceRoot.visible = true;
        this.vehicle.resetToStart();
        this.vehicle.setActive(true);
        this.chaseCamera.setActive(true);
        this.chaseCamera.setPaused(false);
        this.lapTimer.reset();
        const nowMs = this.application.time.elapsed;
        const telemetry = this.vehicle.getTelemetry();
        const lapStart = this.lapTimer.startLap(nowMs, telemetry.position);
        this.currentLapTimeMs = lapStart.lapTimeMs;
        this.lapRunning = lapStart.lapRunning;
        this.lapProgress = lapStart.progress;
        this.pendingLapTimeMs = 0;
        this.lapSubmitInFlight = false;
        this.ghostReplay.setActive(true);
        this.ghostReplay.startLap(nowMs);
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

    exitRaceMode() {
        if (!this.initialized && !this.active) return;

        this.active = false;
        this.paused = false;
        this.raceRoot.visible = false;
        this.setLobbyObjectsVisible(true);
        this.scene.background = this.defaultSceneBackground;
        this.scene.fog = this.defaultSceneFog;
        this.vehicle.setActive(false);
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
                if (child === this.raceRoot) return;
                if (child instanceof THREE.Light) return;
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
        this.engineAudio.setPaused(paused);
        if (paused) {
            UIEventBus.dispatch('race:inputReset', {
                source: 'setPaused',
            });
        }
        UIEventBus.dispatch('race:pauseState', { paused });
        this.dispatchState();
    }

    async refreshLeaderboard() {
        const entries = await this.leaderboardService.getLeaderboard(10);
        UIEventBus.dispatch('race:leaderboardUpdate', {
            entries,
        });
        void this.syncTopLeaderboardGhost(entries);
    }

    async syncTopLeaderboardGhost(entries: LeaderboardEntry[]) {
        const topEntry = entries[0];
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

    dispatchHud() {
        const telemetry = this.vehicle.getTelemetry();
        UIEventBus.dispatch('race:hudUpdate', {
            speedKph: telemetry.speedKph,
            gear: telemetry.gear,
            rpm: telemetry.rpm,
            lapTimeMs: this.currentLapTimeMs,
            lapRunning: this.lapRunning,
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
        return [
            visual.root.position
                .clone()
                .addScaledVector(forward, -1.15)
                .addScaledVector(side, 0.62)
                .addScaledVector(up, 0.08),
            visual.root.position
                .clone()
                .addScaledVector(forward, -1.15)
                .addScaledVector(side, -0.62)
                .addScaledVector(up, 0.08),
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
        const telemetryAgeMs = Math.max(0, Date.now() - Date.parse(player.lastSeenAt || ''));
        const extrapolationSeconds = THREE.MathUtils.clamp(
            telemetryAgeMs / 1000,
            0,
            0.28
        );
        if (extrapolationSeconds > 0 && player.speedKph > 1) {
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
        multiplayerState.players.forEach((player) => {
            if (player.sessionId === multiplayerState.localSessionId) return;
            if (!player.position || !player.quaternion) return;

            this.remoteSessionScratch.add(player.sessionId);
            const visual = this.ensureRemoteVehicle(player);
            if (!visual) return;
            this.updateRemoteVehicleVisual(visual, player, deltaSeconds);
        });

        Array.from(this.remoteVehicles.keys()).forEach((sessionId) => {
            if (!this.remoteSessionScratch.has(sessionId)) {
                this.removeRemoteVehicle(sessionId);
            }
        });
        this.remoteSmoke.update(deltaSeconds);
    }

    update() {
        this.multiplayer.update();
        if (!this.active) {
            this.clearRemoteVehicles();
            return;
        }

        const nowMs = this.application.time.elapsed;
        const delta = this.application.time.delta / 1000;
        this.updateRemoteVehicles(delta);
        if (!this.paused) {
            this.vehicle.update(delta);

            const telemetry = this.vehicle.getTelemetry();
            const lapWasRunning = this.lapRunning;
            this.engineAudio.update(
                {
                    rpm: telemetry.rpm,
                    throttle: telemetry.throttle,
                    speedMps: telemetry.speedMps,
                    carId: telemetry.carId,
                    gear: telemetry.gear,
                    slipRatio: telemetry.slipRatio,
                    driftIntensity: telemetry.driftIntensity,
                    drivetrain: telemetry.drivetrain,
                },
                delta
            );
            const lapUpdate = this.lapTimer.update(
                nowMs,
                telemetry.position,
                telemetry.speedMps,
                telemetry.forward
            );

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
            });

            if (!lapWasRunning && lapUpdate.lapRunning) {
                this.ghostReplay.startLap(nowMs);
            }

            if (lapUpdate.lapRunning) {
                this.ghostReplay.capture(nowMs, {
                    position: telemetry.position,
                    quaternion: telemetry.quaternion,
                    carId: telemetry.carId,
                });
            }

            if (lapUpdate.completedLapTimeMs) {
                this.ghostReplay.completeLap(
                    Boolean(lapUpdate.validLap),
                    lapUpdate.completedLapTimeMs
                );
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
                {
                    rpm: telemetry.rpm,
                    throttle: 0,
                    speedMps: telemetry.speedMps,
                    carId: telemetry.carId,
                    gear: telemetry.gear,
                    slipRatio: telemetry.slipRatio,
                    driftIntensity: 0,
                    drivetrain: telemetry.drivetrain,
                },
                delta
            );
        }
        this.track.update();
        this.ghostReplay.update(delta);
        this.chaseCamera.update(delta);

        if (nowMs - this.lastHudDispatchMs > 75) {
            this.lastHudDispatchMs = nowMs;
            this.dispatchHud();
        }
    }
}
