import * as THREE from 'three';
import { CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import Application from '../../Application';
import { dockCorners, resolveDockTarget, type DockTarget } from './dockTarget';

// the hybrid loading screen's terminal: a panel with the target screen's
// shape, first flat over the page (above the canvas, so the room assembles
// behind it), then docked onto a screen in the room. while flat and while
// docking it's placed by a css matrix3d that maps its rectangle onto four
// points on the page; docking moves those points onto the target screen's
// projected corners, so the last frame is the css3d projection of the same
// rectangle, and the panel moves into a css3d object there without a jump

type Point = [number, number];
type Quad = [Point, Point, Point, Point];

// the projective map of the unit square onto a quad (heckbert), as a css
// matrix3d for an element w by h with its transform origin at 0 0
const quadMatrix = (w: number, h: number, q: Quad) => {
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
    const sx = x0 - x1 + x2 - x3;
    const sy = y0 - y1 + y2 - y3;
    let a: number, b: number, d: number, e: number, g: number, k: number;
    if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
        a = x1 - x0;
        b = x2 - x1;
        d = y1 - y0;
        e = y2 - y1;
        g = 0;
        k = 0;
    } else {
        const dx1 = x1 - x2;
        const dx2 = x3 - x2;
        const dy1 = y1 - y2;
        const dy2 = y3 - y2;
        const det = dx1 * dy2 - dx2 * dy1;
        g = (sx * dy2 - dx2 * sy) / det;
        k = (dx1 * sy - sx * dy1) / det;
        a = x1 - x0 + g * x1;
        b = x3 - x0 + k * x3;
        d = y1 - y0 + g * y1;
        e = y3 - y0 + k * y3;
    }
    const m = [a / w, d / w, 0, g / w, b / h, e / h, 0, k / h, 0, 0, 1, 0, x0, y0, 0, 1];
    return `matrix3d(${m.map((v) => (Math.abs(v) < 1e-12 ? 0 : v)).join(',')})`;
};

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export type Rect = { x: number; y: number; w: number; h: number };

export default class TerminalDock {
    application: Application;
    panel: HTMLElement;
    width: number;
    height: number;
    state: 'flat' | 'docking' | 'docked' | 'released' = 'flat';
    target: DockTarget | null = null;
    private rect: Rect = { x: 0, y: 0, w: 1, h: 1 };
    private object: CSS3DObject | null = null;
    private wrapper: HTMLDivElement | null = null;
    private occluder: THREE.Mesh | null = null;

    constructor(panel: HTMLElement, width: number, height: number) {
        this.application = new Application();
        this.panel = panel;
        this.width = width;
        this.height = height;
        this.sizePanel();
    }

    private sizePanel() {
        this.panel.style.width = `${this.width}px`;
        this.panel.style.height = `${this.height}px`;
    }

    // the target decides the panel's shape (a new room's vertical screen is
    // taller than wide); called before docking, while it's still flat
    resolve(name: string) {
        this.target = resolveDockTarget(name);
        if (this.target && this.state === 'flat') {
            this.height = Math.round((this.width * this.target.height) / this.target.width);
            this.sizePanel();
        }
        return this.target;
    }

    private rectQuad(r: Rect): Quad {
        return [
            [r.x, r.y],
            [r.x + r.w, r.y],
            [r.x + r.w, r.y + r.h],
            [r.x, r.y + r.h],
        ];
    }

    private targetQuad(): Quad | null {
        if (!this.target) return null;
        const camera = this.application.camera.instance;
        camera.updateMatrixWorld();
        const { width, height } = this.application.sizes;
        const points = dockCorners(this.target).map((corner) => {
            const inView = corner.clone().applyMatrix4(camera.matrixWorldInverse);
            if (inView.z >= 0) return null;
            const p = corner.clone().project(camera);
            return [((p.x + 1) / 2) * width, ((1 - p.y) / 2) * height] as Point;
        });
        return points.some((p) => !p) ? null : (points as Quad);
    }

    // where the flat panel sits on the page
    place(rect: Rect) {
        this.rect = rect;
        if (this.state === 'flat') this.panel.style.transform = quadMatrix(this.width, this.height, this.rectQuad(rect));
    }

    scale() {
        return this.rect.w / this.width;
    }

    dock(ms: number, reduced: boolean) {
        if (this.state !== 'flat' || !this.target) return Promise.resolve();
        this.state = 'docking';
        const target = this.target;
        // the css3d object is in the scene from the start, empty, so it's
        // already placed on the frame the panel moves in
        const wrapper = document.createElement('div');
        wrapper.style.width = `${this.width}px`;
        wrapper.style.height = `${this.height}px`;
        wrapper.style.pointerEvents = 'none';
        this.wrapper = wrapper;
        const object = new CSS3DObject(wrapper);
        object.position.copy(target.position);
        object.quaternion.copy(target.quaternion);
        object.scale.setScalar(target.width / this.width);
        this.application.cssScene.add(object);
        this.object = object;
        // a screen without its own css layer needs a hole in the canvas
        if (!target.content) {
            const material = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0 });
            material.blending = THREE.NoBlending;
            material.side = THREE.DoubleSide;
            const occluder = new THREE.Mesh(new THREE.PlaneGeometry(target.width, target.height), material);
            occluder.quaternion.copy(target.quaternion);
            occluder.position
                .copy(target.position)
                .addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(target.quaternion), target.width * 0.002);
            this.application.scene.add(occluder);
            this.occluder = occluder;
        }
        const from = this.rectQuad(this.rect);
        return new Promise<void>((resolve) => {
            const startedAt = performance.now();
            const tick = () => {
                const t = reduced ? 1 : Math.min(1, (performance.now() - startedAt) / ms);
                const to = this.targetQuad();
                if (to) {
                    const k = easeInOutCubic(t);
                    const quad = from.map(([x, y], i) => [
                        x + (to[i][0] - x) * k,
                        y + (to[i][1] - y) * k,
                    ]) as Quad;
                    this.panel.style.transform = quadMatrix(this.width, this.height, quad);
                    this.panel.style.setProperty('--dock', String(k));
                }
                if (t < 1 && to) return;
                this.application.time.off('tick.terminalDock');
                this.handoff();
                resolve();
            };
            // after the tick that moved the camera, so the corners are this frame's
            this.application.time.on('tick.terminalDock', tick);
        });
    }

    private handoff() {
        if (!this.wrapper) return;
        this.panel.style.transform = 'none';
        this.panel.style.setProperty('--dock', '1');
        this.panel.classList.add('hyb-docked');
        this.wrapper.appendChild(this.panel);
        // place it this frame, not the next one
        const renderer = this.application.renderer;
        renderer.cssInstance.render(this.application.cssScene, this.application.camera.instance);
        this.state = 'docked';
    }

    // the screen's own content (yassinOS) comes back: loaded on this call,
    // faded in over the terminal once it has loaded or after waitMs
    release(fadeMs = 600, waitMs = 1500) {
        const content = this.target?.content;
        if (this.state !== 'docked' || !content || !this.wrapper) return;
        this.state = 'released';
        let loaded = false;
        content.onLoad(() => (loaded = true));
        content.load();
        const wrapper = this.wrapper;
        const askedAt = performance.now();
        let fadeFrom = 0;
        const step = () => {
            const now = performance.now();
            if (!fadeFrom) {
                if (!loaded && now - askedAt < waitMs) {
                    requestAnimationFrame(step);
                    return;
                }
                fadeFrom = now;
            }
            const t = Math.min(1, (now - fadeFrom) / fadeMs);
            content.setOpacity(t);
            wrapper.style.opacity = String(1 - t);
            if (t < 1) {
                requestAnimationFrame(step);
                return;
            }
            content.setInert(false);
            if (this.object) this.application.cssScene.remove(this.object);
            if (this.occluder) this.application.scene.remove(this.occluder);
        };
        requestAnimationFrame(step);
    }
}
