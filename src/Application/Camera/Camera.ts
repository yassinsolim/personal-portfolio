import * as THREE from 'three';
import Application from '../Application';
import Sizes from '../Utils/Sizes';
import EventEmitter from '../Utils/EventEmitter';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import TWEEN from '@tweenjs/tween.js';
import Renderer from '../Renderer';
import Resources from '../Utils/Resources';
import UIEventBus from '../UI/EventBus';
import Time from '../Utils/Time';
import BezierEasing from 'bezier-easing';
import {
    CameraKeyframeInstance,
    FocusKeyframe,
    IdleKeyframe,
    LoadingKeyframe,
    DeskKeyframe,
    OrbitControlsStart,
    FlipperKeyframe,
} from './CameraKeyframes';

export enum CameraKey {
    IDLE = 'idle',
    // a screen, the flipper or the pc (World/screens/Screens.ts)
    FOCUS = 'focus',
    LOADING = 'loading',
    DESK = 'desk',
    ORBIT_CONTROLS_START = 'orbitControlsStart',
    FLIPPER = 'flipper',
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
    // the homepage to race transition moves the camera itself, from here
    externalControl: (() => void) | null;


    // room objects that handle their own clicks (World/Flipper.ts); true means taken
    clickInterceptors: Array<(event: MouseEvent) => boolean> = [];
    // clicks an interceptor took, so later listeners (the car's look around) skip them
    handledClicks = new WeakSet<Event>();

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
        this.externalControl = null;

        this.keyframes = {
            idle: new IdleKeyframe(),
            focus: new FocusKeyframe(),
            loading: new LoadingKeyframe(),
            desk: new DeskKeyframe(),
            orbitControlsStart: new OrbitControlsStart(),
            flipper: new FlipperKeyframe(),
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
            if (this.clickInterceptors.some((intercept) => intercept(event))) {
                this.handledClicks.add(event);
                return;
            }
            this.toggleIdleDesk();
        });

        this.setPostLoadTransition();
        this.setInstance();
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
        // near plane sets depth precision. car stripes/decals sit <1mm above the
        // paint and z-fight at near=10. closest view (a focused screen) is ~1600 units away
        this.instance = new THREE.PerspectiveCamera(
            35,
            this.getAspect(),
            200,
            900000
        );
        this.currentKeyframe = CameraKey.LOADING;

        this.scene.add(this.instance);
    }
    getAspect() {
        const width =
            Number.isFinite(this.sizes.width) && this.sizes.width > 0
                ? this.sizes.width
                : 1;
        const height =
            Number.isFinite(this.sizes.height) && this.sizes.height > 0
                ? this.sizes.height
                : 1;
        return width / height;
    }


    // glide to a target's framing. the pose is asked for every frame, so a
    // resize refits it. moving from one target straight to another works too
    focusOn(pose: () => { position: THREE.Vector3; focal: THREE.Vector3 } | null) {
        const focus = this.keyframes.focus as FocusKeyframe;
        focus.provider = pose;
        focus.update();
        if (this.currentKeyframe === CameraKey.FOCUS) this.currentKeyframe = undefined;
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        this.transition(CameraKey.FOCUS, reduced ? 1 : 1100, BezierEasing(0.13, 0.99, 0, 1));
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

    setFreeCamLayerInteraction(enabled: boolean) {
        const webgl = document.getElementById('webgl');
        if (webgl) {
            webgl.style.pointerEvents = enabled ? 'auto' : 'none';
        }
        if (this.renderer.cssInstance?.domElement) {
            this.renderer.cssInstance.domElement.style.pointerEvents = enabled
                ? 'none'
                : 'auto';
        }
    }

    dispatchFreeCamState(pending = false) {
        UIEventBus.dispatch('freeCam:state', {
            active: this.freeCam,
            pending,
        });
    }

    activateFreeCam(transitionToken: number) {
        if (transitionToken !== this.freeCamTransitionToken) return;
        if (!this.freeCamLocked || this.raceModeActive) {
            this.dispatchFreeCamState(false);
            return;
        }
        this.instance.position.copy(this.keyframes.orbitControlsStart.position);
        this.orbitControls.target.copy(
            this.keyframes.orbitControlsStart.focalPoint
        );
        this.orbitControls.object.position.copy(this.instance.position);
        this.orbitControls.update();
        this.freeCam = true;
        this.syncOrbitControlsState();
        this.setFreeCamLayerInteraction(true);
        this.dispatchFreeCamState(false);
    }

    enableFreeCam(duration: number = 450) {
        if (this.raceModeActive) {
            this.dispatchFreeCamState(false);
            return;
        }

        this.freeCamLocked = true;
        this.setFreeCamLayerInteraction(true);

        if (this.freeCam) {
            this.syncOrbitControlsState();
            this.dispatchFreeCamState(false);
            return;
        }

        const transitionToken = ++this.freeCamTransitionToken;
        this.dispatchFreeCamState(true);

        if (
            this.currentKeyframe === CameraKey.ORBIT_CONTROLS_START &&
            !this.targetKeyframe
        ) {
            this.activateFreeCam(transitionToken);
            return;
        }

        this.transition(
            CameraKey.ORBIT_CONTROLS_START,
            duration,
            BezierEasing(0.13, 0.99, 0, 1),
            () => this.activateFreeCam(transitionToken)
        );
    }

    disableFreeCam() {
        this.freeCamTransitionToken++;
        this.freeCamLocked = false;
        const shouldReturnToDesk =
            this.freeCam ||
            this.targetKeyframe === CameraKey.ORBIT_CONTROLS_START ||
            this.currentKeyframe === CameraKey.ORBIT_CONTROLS_START;
        this.freeCam = false;
        this.syncOrbitControlsState();
        if (!this.raceModeActive) {
            this.setFreeCamLayerInteraction(false);
        }
        if (shouldReturnToDesk && !this.raceModeActive) {
            this.transition(CameraKey.DESK, 600, TWEEN.Easing.Exponential.Out);
        }
        this.dispatchFreeCamState(false);
    }

    syncOrbitControlsState() {
        if (!this.orbitControls) return;
        this.orbitControls.enabled = this.freeCam && !this.raceModeActive;
    }

    resize() {
        this.instance.aspect = this.getAspect();
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
        this.orbitControls.minDistance = 2900;
        this.orbitControls.maxDistance = 21000;

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
        if (this.externalControl) {
            this.externalControl();
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
