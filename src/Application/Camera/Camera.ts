import * as THREE from 'three';
import Application from '../Application';
import Sizes from '../Utils/Sizes';
import EventEmitter from '../Utils/EventEmitter';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import TWEEN from '@tweenjs/tween.js';
import Renderer from '../Renderer';
import Resources from '../Utils/Resources';
import UIEventBus from '../UI/EventBus';
import Time from '../Utils/Time';
import BezierEasing from 'bezier-easing';
import {
    CameraKeyframeInstance,
    MonitorKeyframe,
    IdleKeyframe,
    LoadingKeyframe,
    DeskKeyframe,
    OrbitControlsStart,
} from './CameraKeyframes';

export enum CameraKey {
    IDLE = 'idle',
    MONITOR = 'monitor',
    LOADING = 'loading',
    DESK = 'desk',
    ORBIT_CONTROLS_START = 'orbitControlsStart',
}
export default class Camera extends EventEmitter {
    application: Application;
    sizes: Sizes;
    scene: THREE.Scene;
    instance: THREE.PerspectiveCamera;
    renderer: Renderer;
    resources: Resources;
    time: Time;

    position: THREE.Vector3;
    focalPoint: THREE.Vector3;

    freeCam: boolean;
    orbitControls: OrbitControls;
    freeCamLocked: boolean;
    raceModeActive: boolean;
    freeCamTransitionToken: number;

    currentKeyframe: CameraKey | undefined;
    targetKeyframe: CameraKey | undefined;
    keyframes: { [key in CameraKey]: CameraKeyframeInstance };

    constructor() {
        super();
        this.application = new Application();
        this.sizes = this.application.sizes;
        this.scene = this.application.scene;
        this.renderer = this.application.renderer;
        this.resources = this.application.resources;
        this.time = this.application.time;

        this.position = new THREE.Vector3(0, 0, 0);
        this.focalPoint = new THREE.Vector3(0, 0, 0);

        this.freeCam = false;
        this.freeCamLocked = false;
        this.raceModeActive = false;
        this.freeCamTransitionToken = 0;

        this.keyframes = {
            idle: new IdleKeyframe(),
            monitor: new MonitorKeyframe(),
            loading: new LoadingKeyframe(),
            desk: new DeskKeyframe(),
            orbitControlsStart: new OrbitControlsStart(),
        };

        document.addEventListener('mousedown', (event) => {
            const target = event.target as HTMLElement | null;
            if (
                target?.closest('#prevent-click') ||
                target?.closest('[data-prevent-click]')
            ) {
                return;
            }
            if (event.button === 2 || this.freeCam || this.raceModeActive)
                return;
            event.preventDefault();
            this.toggleIdleDesk();
        });

        this.setPostLoadTransition();
        this.setInstance();
        this.setMonitorListeners();
        this.setFreeCamListeners();
    }

    toggleIdleDesk() {
        if (this.raceModeActive) return;
        if (
            this.currentKeyframe === CameraKey.IDLE ||
            this.targetKeyframe === CameraKey.IDLE
        ) {
            this.transition(CameraKey.DESK);
        } else if (
            this.currentKeyframe === CameraKey.DESK ||
            this.targetKeyframe === CameraKey.DESK
        ) {
            this.transition(CameraKey.IDLE);
        }
    }

    transition(
        key: CameraKey,
        duration: number = 1000,
        easing?: (k: number) => number,
        callback?: () => void
    ) {
        if (this.currentKeyframe === key) return;

        if (this.targetKeyframe) TWEEN.removeAll();

        this.currentKeyframe = undefined;
        this.targetKeyframe = key;

        const keyframe = this.keyframes[key];

        const posTween = new TWEEN.Tween(this.position)
            .to(keyframe.position, duration)
            .easing(easing || TWEEN.Easing.Quintic.InOut)
            .onComplete(() => {
                this.currentKeyframe = key;
                this.targetKeyframe = undefined;
                if (callback) callback();
            });

        const focTween = new TWEEN.Tween(this.focalPoint)
            .to(keyframe.focalPoint, duration)
            .easing(easing || TWEEN.Easing.Quintic.InOut);

        posTween.start();
        focTween.start();
    }

    setInstance() {
        this.instance = new THREE.PerspectiveCamera(
            35,
            this.sizes.width / this.sizes.height,
            10,
            900000
        );
        this.currentKeyframe = CameraKey.LOADING;

        this.scene.add(this.instance);
    }

    setMonitorListeners() {
        this.on('enterMonitor', () => {
            this.transition(
                CameraKey.MONITOR,
                2000,
                BezierEasing(0.13, 0.99, 0, 1)
            );
            UIEventBus.dispatch('enterMonitor', {});
        });
        this.on('leftMonitor', () => {
            this.transition(CameraKey.DESK);
            UIEventBus.dispatch('leftMonitor', {});
        });
    }

    setFreeCamListeners() {
        UIEventBus.on('freeCamToggle', (toggle: boolean) => {
            if (this.raceModeActive) return;
            this.freeCamLocked = toggle;
            if (toggle) this.enableFreeCam();
            else this.disableFreeCam();
            this.syncOrbitControlsState();
        });

        UIEventBus.on(
            'raceMode:changed',
            (state: { active?: boolean } | undefined) => {
                this.raceModeActive = Boolean(state?.active);
                if (this.raceModeActive && this.freeCam) {
                    this.disableFreeCam();
                }
                if (this.raceModeActive) {
                    this.freeCamLocked = false;
                    this.freeCam = false;
                    this.freeCamTransitionToken++;
                }
                this.syncOrbitControlsState();
            }
        );
    }

    setPostLoadTransition() {
        UIEventBus.on('loadingScreenDone', () => {
            this.transition(CameraKey.IDLE, 2500, TWEEN.Easing.Exponential.Out);
        });
    }

    enableFreeCam(duration: number = 750) {
        if (this.freeCam) return;
        const transitionToken = ++this.freeCamTransitionToken;
        this.transition(
            CameraKey.ORBIT_CONTROLS_START,
            duration,
            BezierEasing(0.13, 0.99, 0, 1),
            () => {
                if (transitionToken !== this.freeCamTransitionToken) return;
                if (!this.freeCamLocked || this.raceModeActive) return;
                this.instance.position.copy(
                    this.keyframes.orbitControlsStart.position
                );
                this.orbitControls.target.copy(
                    this.keyframes.orbitControlsStart.focalPoint
                );
                this.orbitControls.update();
                this.freeCam = true;
                this.syncOrbitControlsState();
            }
        );
        // @ts-ignore
        document.getElementById('webgl').style.pointerEvents = 'auto';
        if (this.renderer.cssInstance?.domElement) {
            this.renderer.cssInstance.domElement.style.pointerEvents = 'none';
        }
    }

    disableFreeCam() {
        this.freeCamTransitionToken++;
        if (!this.freeCam) return;
        this.freeCam = false;
        this.syncOrbitControlsState();
        this.transition(CameraKey.DESK, 600, TWEEN.Easing.Exponential.Out);
        // @ts-ignore
        document.getElementById('webgl').style.pointerEvents = 'none';
        if (this.renderer.cssInstance?.domElement) {
            this.renderer.cssInstance.domElement.style.pointerEvents = 'auto';
        }
    }

    syncOrbitControlsState() {
        if (!this.orbitControls) return;
        this.orbitControls.enabled = this.freeCam && !this.raceModeActive;
    }

    resize() {
        this.instance.aspect = this.sizes.width / this.sizes.height;
        this.instance.updateProjectionMatrix();
    }

    createControls() {
        this.renderer = this.application.renderer;
        this.patchSafePointerCapture(this.renderer.instance.domElement);
        this.orbitControls = new OrbitControls(
            this.instance,
            this.renderer.instance.domElement
        );

        const { x, y, z } = this.keyframes.orbitControlsStart.focalPoint;
        this.orbitControls.target.set(x, y, z);

        this.orbitControls.enablePan = false;
        this.orbitControls.enableDamping = true;
        this.orbitControls.object.position.copy(
            this.keyframes.orbitControlsStart.position
        );
        this.orbitControls.dampingFactor = 0.05;
        this.orbitControls.maxPolarAngle = Math.PI / 2;
        this.orbitControls.minDistance = 4000;
        this.orbitControls.maxDistance = 29000;

        this.orbitControls.update();
        this.syncOrbitControlsState();
    }

    patchSafePointerCapture(canvas: HTMLCanvasElement) {
        const patchedFlag = '__raceSafePointerCapturePatched';
        const anyCanvas = canvas as HTMLCanvasElement & {
            [patchedFlag]?: boolean;
        };
        if (anyCanvas[patchedFlag]) return;
        anyCanvas[patchedFlag] = true;

        const originalSetPointerCapture =
            canvas.setPointerCapture?.bind(canvas);
        if (!originalSetPointerCapture) return;

        canvas.setPointerCapture = ((pointerId: number) => {
            try {
                originalSetPointerCapture(pointerId);
            } catch (error) {
                const message = String(
                    (error as { message?: string })?.message || error
                ).toLowerCase();
                if (
                    message.includes('invalidstateerror') ||
                    message.includes('not active') ||
                    message.includes('failed to execute')
                ) {
                    return;
                }
                throw error;
            }
        }) as unknown as (pointerId: number) => void;
    }

    update() {
        TWEEN.update();

        if (this.raceModeActive) {
            return;
        }

        if (this.freeCam && this.orbitControls) {
            this.position.copy(this.orbitControls.object.position);
            this.focalPoint.copy(this.orbitControls.target);
            this.orbitControls.update();
            return;
        }

        for (const key in this.keyframes) {
            const _key = key as CameraKey;
            this.keyframes[_key].update();
        }

        if (this.currentKeyframe) {
            const keyframe = this.keyframes[this.currentKeyframe];
            this.position.copy(keyframe.position);
            this.focalPoint.copy(keyframe.focalPoint);
        }

        this.instance.position.copy(this.position);
        this.instance.lookAt(this.focalPoint);
    }
}
