import * as THREE from 'three';
import TWEEN from '@tweenjs/tween.js';
import Application from '../Application';
import UIEventBus from '../UI/EventBus';
import { CameraKey } from '../Camera/Camera';
import { carOptionsById, getStoredCarId } from '../carOptions';
import { getInviteLobbyCode } from '../Racing/Multiplayer/invite';

// click the car in the room: it rocks on its springs, the camera swings in
// behind it, then the room opens up from the car outward onto the ring while
// the ring builds itself around the car. any key or click skips it
const FLY_MS = 1300;
const OPEN_MS = 1150;
const NAME_KEY = 'yassinverse:nordschleife:multiplayer:name:v1';

export default class RaceTransition {
    application: Application;
    busy: boolean;
    skipped: boolean;
    raycaster: THREE.Raycaster;
    pointer: THREE.Vector2;
    overlay: HTMLCanvasElement | null;
    ring: HTMLDivElement | null;
    lastHover: number;
    hovering: boolean;
    skipHandler: (event: Event) => void;
    private finishOpen: (() => void) | null;
    private finishFly: (() => void) | null;

    constructor() {
        this.application = new Application();
        this.busy = false;
        this.skipped = false;
        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();
        this.overlay = null;
        this.ring = null;
        this.lastHover = 0;
        this.hovering = false;
        this.finishOpen = null;
        this.finishFly = null;
        this.skipHandler = (event: Event) => {
            if (event instanceof KeyboardEvent && event.repeat) return;
            this.skip();
        };

        // capture phase, ahead of the camera's own click handler
        document.addEventListener(
            'mousedown',
            (event) => {
                if (event.button !== 0 || !this.canStart()) return;
                if (!this.hitsCar(event.clientX, event.clientY)) return;
                event.stopImmediatePropagation();
                event.preventDefault();
                void this.start();
            },
            true
        );
        document.addEventListener('mousemove', (event) => {
            const now = performance.now();
            if (now - this.lastHover < 90) return;
            this.lastHover = now;
            const over =
                this.canStart() && this.hitsCar(event.clientX, event.clientY);
            if (over === this.hovering) return;
            this.hovering = over;
            document.body.style.cursor = over ? 'pointer' : '';
            // building the ring takes most of a second on the main thread, so
            // start it on hover and the click doesn't have to wait
            if (over) void this.application.world.ensureRaceManager();
        });
    }

    canStart() {
        const camera = this.application.camera;
        const world = this.application.world;
        if (this.busy || camera.freeCam || camera.raceModeActive) return false;
        if (world?.raceManager?.active) return false;
        const key = camera.currentKeyframe ?? camera.targetKeyframe;
        return key === CameraKey.IDLE || key === CameraKey.DESK;
    }

    // the car has to be the first thing under the pointer, not behind the desk
    hitsCar(x: number, y: number) {
        const car = this.application.world?.car?.model;
        if (!car) return false;
        const canvas = this.application.renderer.instance.domElement;
        const rect = canvas.getBoundingClientRect();
        this.pointer.set(
            ((x - rect.left) / rect.width) * 2 - 1,
            -((y - rect.top) / rect.height) * 2 + 1
        );
        this.raycaster.setFromCamera(
            this.pointer,
            this.application.camera.instance
        );
        const shown = (object: THREE.Object3D | null) => {
            for (let node = object; node; node = node.parent) {
                if (!node.visible) return false;
            }
            return true;
        };
        // the hidden race world is in the scene too, only what's drawn counts
        const hit = this.raycaster
            .intersectObjects(this.application.scene.children, true)
            .find((h) => (h.object as THREE.Mesh).isMesh && shown(h.object));
        if (!hit) return false;
        let node: THREE.Object3D | null = hit.object;
        while (node) {
            if (node === car) return true;
            node = node.parent;
        }
        return false;
    }

    // behind the car, a little high, looking over the roof at the road ahead
    chasePose(car: THREE.Object3D) {
        car.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(car);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const option = carOptionsById[getStoredCarId()];
        const sign = option?.race.visualForwardAxis === 'negativeZ' ? -1 : 1;
        const forward = new THREE.Vector3(0, 0, sign)
            .applyQuaternion(car.getWorldQuaternion(new THREE.Quaternion()))
            .setY(0)
            .normalize();
        const length = Math.max(size.x, size.z);
        const position = center
            .clone()
            .addScaledVector(forward, -length * 1.05)
            .add(new THREE.Vector3(0, size.y * 0.75, 0));
        const focal = center
            .clone()
            .addScaledVector(forward, length * 0.6)
            .add(new THREE.Vector3(0, size.y * 0.2, 0));
        return { position, focal, center };
    }

    async start() {
        const car = this.application.world?.car?.model;
        if (!car || this.busy) return;
        this.busy = true;
        this.skipped = false;
        document.body.style.cursor = '';
        // the click's default was stopped, so focus can still be inside the
        // monitor's iframe, where a key to skip would never reach us
        (document.activeElement as HTMLElement | null)?.blur?.();
        window.focus();
        // capture, the page's own key handlers stop some keys from bubbling
        window.addEventListener('keydown', this.skipHandler, true);
        window.addEventListener('pointerdown', this.skipHandler, true);
        const camera = this.application.camera;

        // a rev on its springs
        const baseY = car.position.y;
        const rock = { t: 0 };
        new TWEEN.Tween(rock)
            .to({ t: 1 }, 420)
            .onUpdate(() => {
                car.position.y =
                    baseY + Math.sin(rock.t * Math.PI * 3) * (1 - rock.t) * 0.6;
            })
            .onComplete(() => (car.position.y = baseY))
            .start();

        // the race world builds while the car rocks, then the camera flies,
        // so the fly never stutters on the build
        const ready = this.application.world.ensureRaceManager();
        await ready;
        await new Promise((resolve) => requestAnimationFrame(resolve));
        if (!this.busy) return;
        const pose = this.chasePose(car);
        camera.currentKeyframe = undefined;
        camera.targetKeyframe = undefined;
        const fly = new Promise<void>((resolve) => {
            this.finishFly = () => {
                car.position.y = baseY;
                camera.position.copy(pose.position);
                camera.focalPoint.copy(pose.focal);
                resolve();
            };
            new TWEEN.Tween(camera.position)
                .to(pose.position, FLY_MS)
                .easing(TWEEN.Easing.Quintic.InOut)
                .onComplete(() => resolve())
                .start();
            new TWEEN.Tween(camera.focalPoint)
                .to(pose.focal, FLY_MS)
                .easing(TWEEN.Easing.Quintic.InOut)
                .start();
        });
        // skipped while the ring was still building: no fly at all
        if (this.skipped) this.finishFly?.();
        await fly;
        this.finishFly = null;
        if (!this.busy) return;

        let name = 'Driver';
        try {
            name = window.localStorage.getItem(NAME_KEY) || name;
        } catch {
            // default name
        }
        const startRace = () => {
            // from an invite link the car click joins that lobby
            const invite = getInviteLobbyCode();
            if (invite) {
                UIEventBus.dispatch('race:multiplayerJoinLobby', {
                    playerName: name,
                    lobbyCode: invite,
                    startRace: true,
                });
            } else {
                UIEventBus.dispatch('race:multiplayerPlaySolo', {
                    playerName: name,
                    startRace: true,
                });
            }
        };
        // solo, quick join or an invite link, asked once the ring is built.
        // an invite link already picked the lobby
        const askLobby = () => {
            if (!getInviteLobbyCode()) UIEventBus.dispatch('race:lobbyChoice', {});
        };
        if (this.skipped) {
            // straight into the race with the ring already built
            startRace();
            await this.raceOnScreen();
            UIEventBus.dispatch('race:transitionSkip', {});
            this.finish();
            askLobby();
            return;
        }
        this.captureRoom();
        startRace();
        // open once the race is on screen and past its first shader compiles,
        // which stall a frame or two. the room's last frame covers that
        await this.raceOnScreen();
        UIEventBus.dispatch('race:transitionReveal', {});
        await this.openRoom();
        this.finish();
        askLobby();
    }

    raceOnScreen() {
        return new Promise<void>((resolve) => {
            const started = performance.now();
            let last = started;
            let smooth = 0;
            const check = (now: number) => {
                const active = this.application.world?.raceManager?.active;
                smooth = active && now - last < 40 ? smooth + 1 : 0;
                last = now;
                if (smooth >= 3 || now - started > 6000) {
                    resolve();
                    return;
                }
                requestAnimationFrame(check);
            };
            requestAnimationFrame(check);
        });
    }

    // the last room frame, drawn over the race while it opens up
    captureRoom() {
        const renderer = this.application.renderer.instance;
        renderer.render(
            this.application.scene,
            this.application.camera.instance
        );
        const source = renderer.domElement;
        const canvas = document.createElement('canvas');
        canvas.width = source.width;
        canvas.height = source.height;
        canvas.getContext('2d')?.drawImage(source, 0, 0);
        Object.assign(canvas.style, {
            position: 'fixed',
            inset: '0',
            width: '100%',
            height: '100%',
            zIndex: '4',
            pointerEvents: 'none',
        });
        const ring = document.createElement('div');
        Object.assign(ring.style, {
            position: 'fixed',
            inset: '0',
            zIndex: '5',
            pointerEvents: 'none',
            mixBlendMode: 'screen',
        });
        document.body.appendChild(canvas);
        document.body.appendChild(ring);
        this.overlay = canvas;
        this.ring = ring;
    }

    // a circle opens from the car out, with a bright rim running ahead of it
    openRoom() {
        return new Promise<void>((resolve) => {
            const start = performance.now();
            this.finishOpen = resolve;
            const frame = (now: number) => {
                if (!this.overlay || !this.ring) {
                    resolve();
                    return;
                }
                const t = Math.min(1, (now - start) / OPEN_MS);
                const eased = t * t * (3 - 2 * t);
                const radius = eased * 125;
                const mask = `radial-gradient(circle at 50% 62%, transparent ${radius}%, black ${
                    radius + 6
                }%)`;
                this.overlay.style.maskImage = mask;
                this.overlay.style.webkitMaskImage = mask;
                const glow = 0.85 * (1 - t);
                this.ring.style.background = `radial-gradient(circle at 50% 62%, rgba(0,0,0,0) ${Math.max(
                    0,
                    radius - 2
                )}%, rgba(140,210,255,${glow}) ${radius + 1}%, rgba(0,0,0,0) ${
                    radius + 7
                }%)`;
                if (t < 1) requestAnimationFrame(frame);
                else resolve();
            };
            requestAnimationFrame(frame);
        });
    }

    skip() {
        if (!this.busy || this.skipped) return;
        this.skipped = true;
        // the camera jump and the race start still happen, just at once
        TWEEN.removeAll();
        UIEventBus.dispatch('race:transitionSkip', {});
        this.finishFly?.();
        if (this.overlay) {
            this.finishOpen?.();
            this.finish();
        }
    }

    finish() {
        this.overlay?.remove();
        this.ring?.remove();
        this.overlay = null;
        this.ring = null;
        this.finishOpen = null;
        this.busy = false;
        window.removeEventListener('keydown', this.skipHandler, true);
        window.removeEventListener('pointerdown', this.skipHandler, true);
    }
}
