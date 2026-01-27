import * as THREE from 'three';
import Application from '../Application';
import UIEventBus from '../UI/EventBus';
import NordschleifeTrack from './Track/NordschleifeTrack';
import RaceVehicle from './Vehicle/RaceVehicle';
import RaceChaseCamera from './Camera/RaceChaseCamera';

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

        UIEventBus.dispatch('freeCamToggle', false);
        this.setLayerInteraction(true);
        this.dispatchState();
        UIEventBus.dispatch('race:pauseState', { paused: false });
    }

    exitRaceMode() {
        if (!this.initialized && !this.active) return;

        this.active = false;
        this.paused = false;
        this.raceRoot.visible = false;
        this.vehicle.setActive(false);
        this.chaseCamera.setPaused(false);
        this.chaseCamera.setActive(false);

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

    update() {
        if (!this.active) return;
        const delta = this.application.time.delta / 1000;
        if (!this.paused) {
            this.vehicle.update(delta);
        }
        this.track.update();
        this.chaseCamera.update(delta);
    }
}
