import * as THREE from 'three';
import Application from '../Application';
import UIEventBus from '../UI/EventBus';
import NordschleifeTrack from './Track/NordschleifeTrack';
import RaceVehicle from './Vehicle/RaceVehicle';
import RaceChaseCamera from './Camera/RaceChaseCamera';
import LapTimer from './Lap/LapTimer';
import LocalLeaderboard from './Leaderboard/LocalLeaderboard';
import LeaderboardService from './Leaderboard/LeaderboardService';

type RaceModeState = {
    active: boolean;
    paused: boolean;
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
    lastHudDispatchMs: number;

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
        this.lastHudDispatchMs = 0;
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

        UIEventBus.on('race:submitLapName', async (payload: { name?: string }) => {
            if (!this.pendingLapTimeMs) return;
            const name = (payload?.name || '').trim().slice(0, 16);
            if (!name) return;

            const telemetry = this.vehicle.getTelemetry();
            await this.leaderboardService.submitLap(
                name,
                this.pendingLapTimeMs,
                telemetry.carId
            );
            this.pendingLapTimeMs = 0;
            this.refreshLeaderboard();
            this.setPaused(false);
            UIEventBus.dispatch('race:requestPointerLock', { fromLap: true });
        });
    }

    enterRaceMode() {
        if (this.active) return;

        this.initialized = true;
        this.active = true;
        this.paused = false;
        this.raceRoot.visible = true;
        this.vehicle.resetToStart();
        this.vehicle.setActive(true);
        this.chaseCamera.setActive(true);
        this.chaseCamera.setPaused(false);
        this.lapTimer.reset();
        this.currentLapTimeMs = 0;
        this.lapRunning = false;
        this.lapProgress = 0;
        this.pendingLapTimeMs = 0;

        UIEventBus.dispatch('freeCamToggle', false);
        this.setLayerInteraction(true);
        this.dispatchState();
        UIEventBus.dispatch('race:pauseState', { paused: false });
        this.refreshLeaderboard();
    }

    exitRaceMode() {
        if (!this.initialized && !this.active) return;

        this.active = false;
        this.paused = false;
        this.raceRoot.visible = false;
        this.vehicle.setActive(false);
        this.chaseCamera.setPaused(false);
        this.chaseCamera.setActive(false);
        this.pendingLapTimeMs = 0;

        this.setLayerInteraction(false);
        this.dispatchState();
        UIEventBus.dispatch('race:pauseState', { paused: false });
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
        UIEventBus.dispatch('race:pauseState', { paused });
        this.dispatchState();
    }

    async refreshLeaderboard() {
        const entries = await this.leaderboardService.getLeaderboard(10);
        UIEventBus.dispatch('race:leaderboardUpdate', {
            entries,
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
        });
    }

    update() {
        if (!this.active) return;

        const nowMs = this.application.time.elapsed;
        const delta = this.application.time.delta / 1000;
        if (!this.paused) {
            this.vehicle.update(delta);

            const telemetry = this.vehicle.getTelemetry();
            const lapUpdate = this.lapTimer.update(
                nowMs,
                telemetry.position,
                telemetry.speedMps,
                telemetry.forward
            );

            this.currentLapTimeMs = lapUpdate.lapTimeMs;
            this.lapRunning = lapUpdate.lapRunning;
            this.lapProgress = lapUpdate.progress;

            if (lapUpdate.completedLapTimeMs && lapUpdate.validLap) {
                this.pendingLapTimeMs = lapUpdate.completedLapTimeMs;
                this.setPaused(true);
                UIEventBus.dispatch('race:lapCompleted', {
                    lapTimeMs: lapUpdate.completedLapTimeMs,
                    carId: telemetry.carId,
                });
            }
        }
        this.track.update();
        this.chaseCamera.update(delta);

        if (nowMs - this.lastHudDispatchMs > 75) {
            this.lastHudDispatchMs = nowMs;
            this.dispatchHud();
        }
    }
}
