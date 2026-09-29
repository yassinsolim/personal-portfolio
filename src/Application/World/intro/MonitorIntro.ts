import * as THREE from 'three';
import { CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import Application from '../../Application';
import { CameraKey } from '../../Camera/Camera';
import MonitorScreen from '../MonitorScreen';
import { mark } from '../../UI/loaders/variant';

// ?loader=monitor. the boot screen is the monitor: a css3d element at the
// monitor screen's exact place (MonitorScreen's position, tilt and size),
// with the camera parked square in front of it, close enough that the screen
// covers the viewport. on a key the camera pulls back to the desk, so the
// full screen boot shrinks into the monitor by construction: every frame is
// the room's own projection of the same element, nothing to line up or swap.
// at the desk the monitor's own screen (yassinOS) fades in over it

export const SCREEN = { width: 1280, height: 1024 };
const SCREEN_POSITION = new THREE.Vector3(0, 950, 255);
const SCREEN_ROTATION = new THREE.Euler(-3 * THREE.MathUtils.DEG2RAD, 0, 0);
// the screen reaches a little past the viewport edges, so no sliver of room
// shows at the edge that fits exactly
const OVERSCAN = 1.012;
const PULLBACK_MS = 1800;
const PULLBACK_FAST_MS = 1100;
const HANDOFF_MS = 600;
const OS_WAIT_MS = 1500;
const REDUCED_FADE_MS = 220;

export type SafeArea = {
    // the part of the screen visible while booting, in screen pixels
    x: number;
    y: number;
    width: number;
    height: number;
    // css pixels on the page per screen pixel
    scale: number;
};

const easeInOutCubic = (t: number) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export default class MonitorIntro {
    application: Application;
    element: HTMLDivElement;
    object: CSS3DObject;
    state: 'boot' | 'pullback' | 'handoff' | 'done' = 'boot';
    private normal = new THREE.Vector3(0, 0, 1).applyEuler(SCREEN_ROTATION);
    private listeners = new Set<() => void>();
    private osLoaded = false;

    constructor() {
        this.application = new Application();
        const camera = this.application.camera;

        const element = document.createElement('div');
        element.className = 'boot-monitor';
        element.style.width = `${SCREEN.width}px`;
        element.style.height = `${SCREEN.height}px`;
        this.element = element;

        this.object = new CSS3DObject(element);
        this.object.position.copy(SCREEN_POSITION);
        this.object.rotation.copy(SCREEN_ROTATION);
        this.application.cssScene.add(this.object);

        camera.introLock = true;
        camera.externalControl = () => this.holdBootPose();
        this.application.sizes.on('resize', () => this.listeners.forEach((fn) => fn()));

        // yassinOS takes keyboard focus when it loads, which would eat the
        // "press any key": it loads on the key instead, during the flight
        MonitorScreen.deferLoad = true;
        // World builds the monitor first (its handler was added before this
        // one); its own screen stays hidden and inert under the boot screen
        this.application.resources.on('ready', () => {
            const monitor = this.application.world.monitorScreen;
            if (!monitor) return;
            monitor.screenOpacity = 0;
            if (monitor.monitorContainer) monitor.monitorContainer.inert = true;
        });
    }

    // a camera on the desk view, which sees everything the flight will show
    primeView() {
        const camera = this.application.camera;
        const view = camera.instance.clone();
        const desk = camera.keyframes.desk;
        view.position.copy(desk.position);
        view.lookAt(desk.focalPoint);
        view.updateProjectionMatrix();
        return view;
    }

    onResize(fn: () => void) {
        this.listeners.add(fn);
        return () => {
            this.listeners.delete(fn);
        };
    }

    // the camera distance at which the screen covers the viewport
    private bootDistance() {
        const { width, height } = this.application.sizes;
        const camera = this.application.camera.instance;
        const tan = Math.tan((camera.fov * THREE.MathUtils.DEG2RAD) / 2);
        const aspect = Math.max(1e-3, width / Math.max(1, height));
        const fitWidth = SCREEN.width / 2 / (tan * aspect);
        const fitHeight = SCREEN.height / 2 / tan;
        return Math.min(fitWidth, fitHeight) / OVERSCAN;
    }

    safeArea(): SafeArea {
        const { width, height } = this.application.sizes;
        const aspect = Math.max(1e-3, width / Math.max(1, height));
        const screenAspect = SCREEN.width / SCREEN.height;
        const visibleWidth =
            aspect >= screenAspect ? SCREEN.width / OVERSCAN : (SCREEN.height / OVERSCAN) * aspect;
        const visibleHeight = visibleWidth / aspect;
        return {
            x: (SCREEN.width - visibleWidth) / 2,
            y: (SCREEN.height - visibleHeight) / 2,
            width: visibleWidth,
            height: visibleHeight,
            scale: width / visibleWidth,
        };
    }

    private holdBootPose() {
        const camera = this.application.camera;
        const distance = this.bootDistance();
        camera.instance.position.copy(SCREEN_POSITION).addScaledVector(this.normal, distance);
        camera.instance.lookAt(SCREEN_POSITION);
        camera.position.copy(camera.instance.position);
        camera.focalPoint.copy(SCREEN_POSITION);
    }

    // the key was pressed: fly back to the desk, then hand the screen to
    // yassinOS. returns how long until the room is the desk view
    start({ fast, reduced }: { fast: boolean; reduced: boolean }) {
        if (this.state !== 'boot') return 0;
        this.state = 'pullback';
        mark('pullback');
        const iframe = this.application.world.monitorScreen?.monitorIframe;
        if (iframe) {
            iframe.addEventListener('load', () => (this.osLoaded = true), { once: true });
            this.application.world.monitorScreen?.loadIframe();
        }
        if (reduced) {
            this.fadeCut();
            return REDUCED_FADE_MS;
        }
        const camera = this.application.camera;
        const desk = camera.keyframes.desk;
        const duration = fast ? PULLBACK_FAST_MS : PULLBACK_MS;
        const startedAt = performance.now();
        const fromTarget = SCREEN_POSITION.clone();
        const fromDistance = this.bootDistance();
        const direction = new THREE.Vector3();
        const target = new THREE.Vector3();
        const deskDirection = new THREE.Vector3();

        camera.externalControl = () => {
            // the desk view follows the mouse; track it live so the last
            // frame of the flight is exactly the keyframe's
            desk.update();
            const t = Math.min(1, (performance.now() - startedAt) / duration);
            const k = easeInOutCubic(t);
            deskDirection.subVectors(desk.position, desk.focalPoint);
            const deskDistance = deskDirection.length();
            deskDirection.divideScalar(deskDistance || 1);
            target.lerpVectors(fromTarget, desk.focalPoint, k);
            direction.lerpVectors(this.normal, deskDirection, k).normalize();
            // distance in log space: the screen shrinks at an even rate
            const distance = fromDistance * Math.pow(deskDistance / fromDistance, k);
            camera.instance.position.copy(target).addScaledVector(direction, distance);
            camera.instance.lookAt(target);
            camera.position.copy(camera.instance.position);
            camera.focalPoint.copy(target);
            if (t >= 1) this.finishFlight();
        };
        return duration;
    }

    // reduced motion: through black to the desk, no flight
    private fadeCut() {
        const fade = document.createElement('div');
        fade.className = 'boot-fade';
        document.body.appendChild(fade);
        requestAnimationFrame(() => {
            fade.style.opacity = '1';
            window.setTimeout(() => {
                const camera = this.application.camera;
                camera.keyframes.desk.update();
                camera.position.copy(camera.keyframes.desk.position);
                camera.focalPoint.copy(camera.keyframes.desk.focalPoint);
                this.finishFlight();
                fade.style.opacity = '0';
                window.setTimeout(() => fade.remove(), REDUCED_FADE_MS + 50);
            }, REDUCED_FADE_MS);
        });
    }

    private finishFlight() {
        const camera = this.application.camera;
        camera.externalControl = null;
        camera.currentKeyframe = CameraKey.DESK;
        camera.targetKeyframe = undefined;
        camera.introLock = false;
        this.state = 'handoff';
        mark('desk');
        this.handoff();
    }

    // yassinOS fades in over the boot screen on the same glass, once its page
    // has loaded (it started on the key), or after OS_WAIT_MS regardless
    private handoff() {
        const monitor = this.application.world.monitorScreen;
        if (monitor?.monitorContainer) monitor.monitorContainer.inert = false;
        const arrivedAt = performance.now();
        let startedAt = 0;
        const step = () => {
            if (!startedAt) {
                if (!this.osLoaded && performance.now() - arrivedAt < OS_WAIT_MS) {
                    requestAnimationFrame(step);
                    return;
                }
                startedAt = performance.now();
            }
            const t = Math.min(1, (performance.now() - startedAt) / HANDOFF_MS);
            if (monitor) monitor.screenOpacity = t;
            if (t < 1) {
                requestAnimationFrame(step);
                return;
            }
            this.application.cssScene.remove(this.object);
            this.element.remove();
            this.state = 'done';
            mark('handoff');
        };
        requestAnimationFrame(step);
    }
}
