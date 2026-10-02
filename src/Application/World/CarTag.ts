import * as THREE from 'three';
import Application from '../Application';
import UIEventBus from '../UI/EventBus';
import type RaceTransition from './RaceTransition';

// a tag over the room's car asking for the click that starts a race. it rides
// the car's roof on screen and steps aside whenever the car can't be clicked:
// the loading screen, a focused screen, free cam, the race itself
export default class CarTag {
    application: Application;
    transition: RaceTransition;
    element: HTMLDivElement;
    private ready = false;
    private shown = false;
    private hover = false;
    private anchor = new THREE.Vector3();
    private anchorAt = -Infinity;
    private box = new THREE.Box3();
    private point = new THREE.Vector3();
    private x = Number.NaN;
    private y = Number.NaN;
    // the room panel's box and the tag's size, re-read twice a second
    private panel: DOMRect | null = null;
    private size = { w: 0, h: 0 };
    private measuredAt = -Infinity;

    constructor(transition: RaceTransition) {
        this.application = new Application();
        this.transition = transition;
        const element = document.createElement('div');
        element.className = 'car-tag';
        element.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.textContent = 'Play Solo';
        element.appendChild(label);
        document.body.appendChild(element);
        this.element = element;
        // with the room's panel, once the loading screen is done
        UIEventBus.on('loadingScreenDone', (data?: { holdHint?: boolean }) => {
            if (!data?.holdHint) this.ready = true;
            else window.setTimeout(() => (this.ready = true), 6000);
        });
        UIEventBus.on('loader:showHint', () => (this.ready = true));
        UIEventBus.on('carChange', () => (this.anchorAt = -Infinity));
    }

    update() {
        const car = this.application.world?.car?.model;
        const show = Boolean(
            this.ready && car && this.transition.canStart() && this.place(car)
        );
        if (show !== this.shown) {
            this.shown = show;
            this.element.classList.toggle('on', show);
        }
        const hover = show && this.transition.hovering;
        if (hover !== this.hover) {
            this.hover = hover;
            this.element.classList.toggle('hover', hover);
        }
    }

    // over the middle of the roof, in css pixels. false when that's off screen
    private place(car: THREE.Object3D) {
        const now = performance.now();
        // the car only moves when it's swapped or rocks, so its box is cheap
        // to keep a second old
        if (now - this.anchorAt > 1000) {
            this.box.setFromObject(car);
            if (this.box.isEmpty()) return false;
            this.box.getCenter(this.anchor);
            this.anchor.y = this.box.max.y;
            this.anchorAt = now;
        }
        this.point.copy(this.anchor).project(this.application.camera.instance);
        const { x, y, z } = this.point;
        if (z > 1 || Math.abs(x) > 0.92 || y > 0.85 || y < -0.95) return false;
        const sizes = this.application.sizes;
        const left = Math.round((x * 0.5 + 0.5) * sizes.width);
        const top = Math.round((0.5 - y * 0.5) * sizes.height);
        // the idle camera swings the car across the room, and the panel has
        // the corner: the tag waits rather than slide under it
        if (now - this.measuredAt > 500) {
            this.measuredAt = now;
            const panel = document.querySelector('.look-hint');
            this.panel = panel ? panel.getBoundingClientRect() : null;
            const label = this.element.firstElementChild as HTMLElement | null;
            if (label) this.size = { w: label.offsetWidth, h: label.offsetHeight };
        }
        const panel = this.panel;
        if (
            panel &&
            panel.width > 0 &&
            left - this.size.w / 2 < panel.right + 8 &&
            top - this.size.h - 24 < panel.bottom + 8
        ) {
            return false;
        }
        if (left !== this.x || top !== this.y) {
            this.x = left;
            this.y = top;
            this.element.style.transform = `translate(${left}px, ${top}px)`;
        }
        return true;
    }
}
