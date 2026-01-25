import * as THREE from 'three';
import Application from '../Application';
import UIEventBus from '../UI/EventBus';

type RaceModeState = {
    active: boolean;
};

export default class RaceManager {
    application: Application;
    scene: THREE.Scene;
    raceRoot: THREE.Group;
    active: boolean;
    initialized: boolean;

    constructor() {
        this.application = new Application();
        this.scene = this.application.scene;
        this.active = false;
        this.initialized = false;

        this.raceRoot = new THREE.Group();
        this.raceRoot.name = 'race-mode-root';
        this.raceRoot.visible = false;
        this.raceRoot.userData.raceRoot = true;
        this.scene.add(this.raceRoot);

        this.setupEvents();
    }

    setupEvents() {
        UIEventBus.on('raceMode:start', () => {
            this.enterRaceMode();
        });

        UIEventBus.on('raceMode:exit', () => {
            this.exitRaceMode();
        });
    }

    enterRaceMode() {
        if (this.active) return;

        this.initialized = true;
        this.active = true;
        this.raceRoot.visible = true;

        UIEventBus.dispatch('freeCamToggle', false);
        this.setLayerInteraction(true);
        this.dispatchState();
    }

    exitRaceMode() {
        if (!this.initialized && !this.active) return;

        this.active = false;
        this.raceRoot.visible = false;

        this.setLayerInteraction(false);
        this.dispatchState();
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
        };
        UIEventBus.dispatch('raceMode:changed', state);
    }

    update() {
        if (!this.active) return;
    }
}

