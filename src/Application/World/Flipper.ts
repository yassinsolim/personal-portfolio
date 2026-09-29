import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import BezierEasing from 'bezier-easing';
import Application from '../Application';
import Camera, { CameraKey } from '../Camera/Camera';
import Resources from '../Utils/Resources';
import Sizes from '../Utils/Sizes';
import UIEventBus from '../UI/EventBus';
import { isLowPowerDevice, isMobileDevice } from '../Utils/Device';
import FlipperDevice, { FlipperButton, FLIPPER_BUTTONS } from './flipper/FlipperDevice';

// the flipper zero on the desk, running its real firmware (static/handheld).
// model: scripts/blender/build-flipper.py, parts named flipper-body, -screen,
// -led and -btn-<button>. hover loads and wakes it, a click zooms in (the
// FLIPPER camera keyframe), arrows, enter or space and backspace work its
// buttons while focused, esc or a click outside goes back to the desk.
// room v2 (docs/room-v2-plan.md 5.3) takes the same pieces: screenCanvas,
// press(button) and the hit areas, only the placement constants change.

const MODEL_LENGTH_METERS = 0.1003;
// today's desk: the old prop's 420 units for the device's 100.3 mm
const FLIPPER_LENGTH_UNITS = 420;
const PAPER_ANCHOR = new THREE.Vector3(-2064, -444, 986);
const FLIPPER_OFFSET = new THREE.Vector3(520, 0, 380);
// turned toward the chair
const FLIPPER_YAW = 18 * THREE.MathUtils.DEG2RAD;

// focus pose: above and in front, device about 55% of the viewport height
const FOCUS_ELEVATION = 58 * THREE.MathUtils.DEG2RAD;
const FOCUS_HEIGHT_SHARE = 0.55;
const FOCUS_WIDTH_SHARE = 0.86;
const FOCUS_MS = 1000;
const BUTTON_TRAVEL_METERS = 0.0008;

const LED_OFF = 0x1c1c1c;

const SOURCE_URL = 'https://github.com/yassinsolim/flipper-wasm';

const KEYS: Record<string, FlipperButton> = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
    Enter: 'ok',
    ' ': 'ok',
    Backspace: 'back',
};

export default class Flipper {
    application: Application;
    scene: THREE.Scene;
    resources: Resources;
    camera: Camera;
    sizes: Sizes;
    model: THREE.Group;
    device: FlipperDevice;
    screenTexture: THREE.CanvasTexture;
    lowTier: boolean;
    buttons = new Map<FlipperButton, THREE.Mesh>();
    hitAreas = new Map<FlipperButton, THREE.Mesh>();
    ledMaterial: THREE.MeshBasicMaterial | null = null;
    pickTargets: THREE.Object3D[] = [];
    focused = false;
    hovered = false;
    // the car's hover sets the cursor too, so only write it when this changes
    private pointerShown = false;
    private raycaster = new THREE.Raycaster();
    private pointer = new THREE.Vector2();
    private keyCentre = new THREE.Vector3();
    private heldByPointer: FlipperButton | null = null;
    private chip: HTMLDivElement;
    private raceActive = false;
    private rest = new THREE.Vector3();
    private bounds = new THREE.Sphere();
    private frustum = new THREE.Frustum();
    private matrix = new THREE.Matrix4();
    private temp = new THREE.Vector3();
    private temp2 = new THREE.Vector3();

    constructor() {
        this.application = new Application();
        this.scene = this.application.scene;
        this.resources = this.application.resources;
        this.camera = this.application.camera;
        this.sizes = this.application.sizes;
        this.lowTier = isLowPowerDevice();

        // weak tiers: 128x64 texture with nearest filtering, everything else full size
        this.device = new FlipperDevice({ scale: this.lowTier ? 1 : 4 });
        this.screenTexture = new THREE.CanvasTexture(this.device.screenCanvas);
        this.screenTexture.colorSpace = THREE.SRGBColorSpace;
        if (this.lowTier) {
            this.screenTexture.magFilter = THREE.NearestFilter;
            this.screenTexture.minFilter = THREE.NearestFilter;
            this.screenTexture.generateMipmaps = false;
        } else {
            this.screenTexture.anisotropy = 8;
        }
        this.device.addEventListener('frame', () => (this.screenTexture.needsUpdate = true));
        this.device.addEventListener('button', (event) => {
            const { button, pressed } = (event as CustomEvent).detail;
            const mesh = this.buttons.get(button);
            if (mesh) mesh.userData.pressed = pressed;
        });
        this.device.addEventListener('led', (event) => {
            if (!this.ledMaterial) return;
            const led = (event as CustomEvent).detail;
            this.ledMaterial.userData.led = led;
        });

        this.setModel();
        this.chip = this.createChip();
        this.bindInput();
        UIEventBus.on('raceMode:changed', (state: { active?: boolean } | undefined) => {
            this.raceActive = Boolean(state?.active);
            if (this.raceActive) this.leave(false);
        });
        document.addEventListener('visibilitychange', () => this.updateRunning());
        // test harnesses find the device through this (scripts/flipper-room-check.mjs)
        if (new URLSearchParams(window.location.search).has('handheldDebug')) {
            (window as unknown as { __flipper: Flipper }).__flipper = this;
        }
    }

    setModel() {
        const gltf = this.resources.items.gltfModel.flipperModel;
        const model = gltf.scene as THREE.Group;
        const scale = FLIPPER_LENGTH_UNITS / MODEL_LENGTH_METERS;

        let baked: THREE.Texture | null = null;
        model.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (!mesh.isMesh) return;
            const material = mesh.material as THREE.MeshStandardMaterial;
            if (mesh.name !== 'flipper-screen' && material.map) baked = material.map;
        });
        const texture = baked as THREE.Texture | null;
        if (texture) texture.colorSpace = THREE.SRGBColorSpace;
        const bakedMaterial = new THREE.MeshBasicMaterial({ map: texture });

        const screen = model.getObjectByName('flipper-screen') as THREE.Mesh;
        this.setScreenUvs(screen.geometry);
        // the lcd sits half a millimetre over the bezel; the offset keeps it on top at any distance
        screen.material = new THREE.MeshBasicMaterial({
            map: this.screenTexture,
            toneMapped: false,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
        });

        const parts: THREE.Mesh[] = [];
        model.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (mesh.isMesh && mesh !== screen) parts.push(mesh);
        });

        // hit areas: invisible boxes a bit bigger than each key, bigger still for fingers
        const grow = isMobileDevice() ? 2.2 : 1.5;
        for (const button of FLIPPER_BUTTONS) {
            const mesh = model.getObjectByName(`flipper-btn-${button}`) as THREE.Mesh;
            mesh.geometry.computeBoundingBox();
            const size = mesh.geometry.boundingBox!.getSize(new THREE.Vector3());
            const hit = new THREE.Mesh(
                new THREE.BoxGeometry(size.x * grow, size.y * 3, size.z * grow),
                new THREE.MeshBasicMaterial({ visible: false })
            );
            hit.name = `flipper-hit-${button}`;
            hit.position.copy(mesh.position);
            hit.quaternion.copy(mesh.quaternion);
            hit.userData.button = button;
            model.add(hit);
            this.hitAreas.set(button, hit);
            this.buttons.set(button, mesh);
            mesh.userData.restY = mesh.position.y;
        }

        if (this.lowTier) {
            // two draws: body, keys and led merged into one mesh, plus the screen
            model.updateMatrixWorld(true);
            const geometries = parts.map((mesh) => mesh.geometry.clone().applyMatrix4(mesh.matrix));
            const merged = new THREE.Mesh(mergeGeometries(geometries, false), bakedMaterial);
            merged.name = 'flipper-body';
            parts.forEach((mesh) => mesh.removeFromParent());
            model.add(merged);
            this.buttons.clear();
        } else {
            for (const mesh of parts) mesh.material = bakedMaterial;
            const led = model.getObjectByName('flipper-led') as THREE.Mesh | undefined;
            if (led) {
                this.ledMaterial = new THREE.MeshBasicMaterial({ color: LED_OFF });
                led.material = this.ledMaterial;
            }
        }

        model.scale.setScalar(scale);
        model.rotation.set(0, FLIPPER_YAW, 0);
        model.position.set(0, 0, 0);
        model.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(model);
        const target = PAPER_ANCHOR.clone().add(FLIPPER_OFFSET);
        model.position.set(target.x, target.y - box.min.y, target.z);
        model.updateMatrixWorld(true);
        new THREE.Box3().setFromObject(model).getBoundingSphere(this.bounds);

        this.rest.copy(model.position);
        this.model = model;
        this.pickTargets = [model];
        this.scene.add(model);
    }

    // the optimizer prunes uvs from untextured materials, and the quad is flat
    // anyway: u runs along the device, v from its front edge (+z) to the back
    setScreenUvs(geometry: THREE.BufferGeometry) {
        geometry.computeBoundingBox();
        const box = geometry.boundingBox as THREE.Box3;
        const position = geometry.getAttribute('position');
        const uv = new Float32Array(position.count * 2);
        for (let i = 0; i < position.count; i++) {
            uv[i * 2] = (position.getX(i) - box.min.x) / (box.max.x - box.min.x);
            uv[i * 2 + 1] = (box.max.z - position.getZ(i)) / (box.max.z - box.min.z);
        }
        geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }

    createChip() {
        const touch = isMobileDevice();
        const chip = document.createElement('div');
        chip.setAttribute('data-prevent-click', '');
        chip.style.cssText = [
            'position:fixed',
            'left:50%',
            'bottom:22px',
            'transform:translateX(-50%)',
            'max-width:min(92vw,760px)',
            'box-sizing:border-box',
            'padding:7px 14px',
            'border-radius:18px',
            'background:rgba(16,16,19,0.78)',
            'color:#e9e6e1',
            'font:12px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif',
            'text-align:center',
            'white-space:normal',
            'z-index:20',
            'opacity:0',
            'pointer-events:none',
            'transition:opacity 200ms ease',
        ].join(';');
        const hint = touch ? 'Tap the keys' : 'Arrows, Enter, Backspace &middot; Esc to leave';
        chip.innerHTML =
            `${hint} &middot; Unofficial build of the Flipper Zero firmware 1.4.3, not affiliated ` +
            `with Flipper Devices &middot; GPL-3.0, modified, ` +
            `<a href="${SOURCE_URL}" target="_blank" rel="noopener" style="color:#ffb35c">source</a>`;
        if (touch) {
            // phones have no esc key
            const done = document.createElement('button');
            done.textContent = 'Done';
            done.style.cssText =
                'margin-left:10px;padding:3px 12px;border:0;border-radius:999px;background:#ff8a16;color:#1a1208;font:inherit;font-weight:600';
            done.addEventListener('click', () => this.leave());
            chip.appendChild(done);
        }
        document.body.appendChild(chip);
        return chip;
    }

    bindInput() {
        this.camera.clickInterceptors.push((event) => this.onMouseDown(event));
        window.addEventListener('mouseup', () => this.releasePointer());
        window.addEventListener('blur', () => {
            this.releasePointer();
            this.device.releaseAll();
        });
        window.addEventListener('mousemove', (event) => this.onMouseMove(event));
        window.addEventListener('keydown', (event) => this.onKey(event, true), true);
        window.addEventListener('keyup', (event) => this.onKey(event, false), true);
    }

    pick(clientX: number, clientY: number) {
        this.pointer.set((clientX / this.sizes.width) * 2 - 1, -(clientY / this.sizes.height) * 2 + 1);
        this.raycaster.setFromCamera(this.pointer, this.camera.instance);
        const hits = this.raycaster.intersectObjects(this.pickTargets, true);
        if (!hits.length) return null;
        // the grown hit boxes overlap (ok's covers most of the d-pad), so the
        // first box along the ray isn't the key under the finger: take the key
        // whose centre is closest to the ray
        let button: FlipperButton | null = null;
        let best = Infinity;
        for (const hit of hits) {
            if (!hit.object.userData.button) continue;
            hit.object.getWorldPosition(this.keyCentre);
            const distance = this.raycaster.ray.distanceSqToPoint(this.keyCentre);
            if (distance < best) {
                best = distance;
                button = hit.object.userData.button as FlipperButton;
            }
        }
        return { button };
    }

    interactive() {
        return !this.raceActive && !this.camera.freeCam && !this.camera.externalControl;
    }

    onMouseMove(event: MouseEvent) {
        if (!this.interactive()) return;
        const hit = this.pick(event.clientX, event.clientY);
        const over = Boolean(hit) && (!this.focused || Boolean(hit?.button));
        if (Boolean(hit) !== this.hovered) {
            this.hovered = Boolean(hit);
            // first hover downloads and boots it; later ones turn the backlight on
            if (this.hovered) {
                if (!this.device.started) void this.device.start().catch(() => undefined);
                else this.device.wake();
            }
            this.updateRunning();
        }
        if (over !== this.pointerShown) {
            this.pointerShown = over;
            document.body.style.cursor = over ? 'pointer' : '';
        }
    }

    onMouseDown(event: MouseEvent) {
        if (!this.interactive()) return false;
        const hit = this.pick(event.clientX, event.clientY);
        if (!this.focused) {
            if (!hit) return false;
            this.focus();
            return true;
        }
        if (hit?.button) {
            this.heldByPointer = hit.button;
            this.device.press(hit.button);
            return true;
        }
        if (!hit) this.leave();
        return true;
    }

    releasePointer() {
        if (!this.heldByPointer) return;
        this.device.release(this.heldByPointer);
        this.heldByPointer = null;
    }

    onKey(event: KeyboardEvent, down: boolean) {
        if (!this.focused) return;
        if (event.key === 'Escape') {
            if (down) this.leave();
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        const button = KEYS[event.key];
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return; // the firmware makes its own repeats
        if (down) this.device.press(button);
        else this.device.release(button);
    }

    focus() {
        if (this.focused) return;
        this.focused = true;
        // a focused iframe (the monitor's yassinOS) would swallow the arrow keys
        const active = document.activeElement as HTMLElement | null;
        if (active && active !== document.body) active.blur();
        window.focus();
        this.updateFocusPose();
        this.camera.transition(CameraKey.FLIPPER, FOCUS_MS, BezierEasing(0.13, 0.99, 0, 1));
        void this.device.start().catch(() => undefined);
        this.device.setAwake(true);
        this.chip.style.opacity = '1';
        this.chip.style.pointerEvents = 'auto';
        UIEventBus.dispatch('flipper:focus', { focused: true });
        this.updateRunning();
    }

    leave(moveCamera = true) {
        if (!this.focused) return;
        this.focused = false;
        this.releasePointer();
        this.device.releaseAll();
        this.device.setAwake(false);
        this.chip.style.opacity = '0';
        this.chip.style.pointerEvents = 'none';
        this.pointerShown = false;
        document.body.style.cursor = '';
        if (moveCamera) this.camera.transition(CameraKey.DESK);
        UIEventBus.dispatch('flipper:focus', { focused: false });
        this.updateRunning();
    }

    // frame the device from its real size and the viewport's aspect
    updateFocusPose() {
        const scale = this.model.scale.x;
        const center = this.temp.set(0, 0.0256, 0.001).multiplyScalar(scale).applyQuaternion(this.model.quaternion);
        center.add(this.model.position);
        const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.instance.fov / 2));
        const aspect = this.camera.instance.aspect;
        const length = MODEL_LENGTH_METERS * scale;
        const apparent = (0.0401 * Math.sin(FOCUS_ELEVATION) + 0.0256 * Math.cos(FOCUS_ELEVATION)) * scale;
        const byHeight = apparent / FOCUS_HEIGHT_SHARE / (2 * tan);
        const byWidth = length / FOCUS_WIDTH_SHARE / (2 * tan * aspect);
        const distance = Math.max(byHeight, byWidth);
        const offset = this.temp2
            .set(0, Math.sin(FOCUS_ELEVATION), Math.cos(FOCUS_ELEVATION))
            .multiplyScalar(distance)
            .applyQuaternion(this.model.quaternion);
        const keyframe = this.camera.keyframes[CameraKey.FLIPPER] as unknown as {
            setPose: (p: THREE.Vector3, f: THREE.Vector3) => void;
        };
        keyframe.setPose(center.clone().add(offset), center);
    }

    // runs while focused or hovered, or while the desk view shows it; paused otherwise
    updateRunning() {
        if (!this.device.started) return;
        const visible = document.visibilityState === 'visible' && !this.raceActive;
        const key = this.camera.currentKeyframe ?? this.camera.targetKeyframe;
        const onDesk = key === CameraKey.DESK || key === CameraKey.FLIPPER || this.hovered;
        let inView = true;
        if (!this.focused) {
            this.matrix.multiplyMatrices(this.camera.instance.projectionMatrix, this.camera.instance.matrixWorldInverse);
            this.frustum.setFromProjectionMatrix(this.matrix);
            inView = this.frustum.intersectsSphere(this.bounds);
        }
        const run = visible && (this.focused || (onDesk && inView));
        if (run) this.device.resume();
        else this.device.pause();
    }

    update() {
        if (!this.model) return;
        if (this.focused) this.updateFocusPose();

        // the camera went somewhere else (monitor, race, free cam): drop focus
        const key = this.camera.currentKeyframe ?? this.camera.targetKeyframe;
        if (this.focused && key !== CameraKey.FLIPPER) this.leave(false);
        this.updateRunning();

        for (const mesh of this.buttons.values()) {
            const goal = mesh.userData.restY - (mesh.userData.pressed ? BUTTON_TRAVEL_METERS : 0);
            mesh.position.y += (goal - mesh.position.y) * 0.5;
        }

        if (this.ledMaterial) {
            const led = this.ledMaterial.userData.led as FlipperDevice['led'] | undefined;
            let on = false;
            if (led) {
                on = led.red + led.green + led.blue > 0;
                if (led.blinkPeriodMs > 0) on = on && performance.now() % led.blinkPeriodMs < led.blinkOnMs;
            }
            if (on && led) {
                this.ledMaterial.color.setRGB(led.red / 255, led.green / 255, led.blue / 255, THREE.SRGBColorSpace);
            } else {
                this.ledMaterial.color.set(LED_OFF);
            }
        }

        this.model.position.copy(this.rest);
        if (this.device.vibrating) {
            const jitter = 1.2;
            this.model.position.x += (Math.random() - 0.5) * jitter;
            this.model.position.z += (Math.random() - 0.5) * jitter;
        }
    }
}
