import * as THREE from 'three';
import Application from '../Application';
import UIEventBus from '../UI/EventBus';
import { CameraKey } from '../Camera/Camera';
import type { FocusTarget } from '../World/screens/Screens';
import type { FlipperButton } from '../World/flipper/FlipperDevice';
import {
    BUTTON,
    Repeat,
    buttonLabel,
    currentPad,
    padDirection,
    padKind,
    padShared,
    stick,
    type Direction,
    type PadKind,
} from './pad';
import { pickInDirection, type Box } from './spatial';
import { SCREEN_CSS_SIZE } from '../World/screens/types';
import './gamepad.css';

// the whole site on a controller. the race's car reads the pad itself
// (Racing/Input/DrivingInput.ts); everything else goes through here: the
// d-pad or left stick moves a focus between the page's buttons, the room's
// screens, the car, the pc and the flipper, A presses, B goes back, like
// esc. menus get their tabs on the bumpers, the garage turns the car on the
// right stick. any mouse, touch or key hands the page back

type RoomTarget = FocusTarget | 'car';
type Item =
    | { element: HTMLElement; target?: undefined }
    | { target: RoomTarget; element?: undefined };
type Context =
    | 'busy'
    | 'transition'
    | 'drive'
    | 'menu'
    | 'flipper'
    | 'freecam'
    | 'screen'
    | 'room';
type Frame = {
    pad: Gamepad;
    down: boolean[];
    pressed: (button: number) => boolean;
    lx: number;
    ly: number;
    rx: number;
    ry: number;
    dt: number;
    now: number;
};

const FOCUSABLE =
    'button, a[href], input, select, textarea, summary, [tabindex]';
const TARGETS: RoomTarget[] = ['car', 'm1', 'm2', 'm3', 'pc', 'flipper'];
const TARGET_LABELS: Record<RoomTarget, string> = {
    car: 'Drive the Nordschleife',
    m1: 'yassinOS',
    m2: 'Widgets',
    m3: 'Terminal',
    pc: 'The PC',
    flipper: 'Flipper Zero',
};
// the overlays, topmost first
const OVERLAYS = [
    '.car-picker',
    '.garage',
    '.race-photo',
    '.race-help',
    '.race-menu-overlay',
    '.race-lobby-choice',
];
// where a menu's focus starts
const DEFAULTS = [
    '.race-help-tabs .on',
    '.race-menu-primary',
    '.race-photo-save',
    '.look-hint-primary',
    '.garage-tabs .on',
    '.car-card[aria-pressed="true"]',
    '.race-lobby-options button',
    '.race-lobby-actions button:last-child',
    '.room-overlay-close',
];
const TABS = '.garage-tabs, .car-picker-filters, .race-help-tabs';
const TEXT_INPUTS = new Set([
    'text',
    'search',
    'email',
    'url',
    'tel',
    'password',
    'number',
]);
const SKIP_BUTTONS = [BUTTON.A, BUTTON.B, BUTTON.X, BUTTON.Y, BUTTON.MENU];
const DRIVE_HINT_MS = 7000;
// the room's targets are steered to by their centres, the frame shows all of them
const TARGET_HALF = 20;
const SCROLL_SPEED = 900;
const ORBIT_SPEED = 2.2;
// yassinOS's pointer, in its css pixels a second at full stick (the stick
// is curved so a small push is fine aiming), the d-pad nudges slowly
const OS_POINTER_SPEED = 1100;
const OS_NUDGE = 0.3;
const OS_SCROLL = 1600;
// garage turntable, in the drag's pixels a second at full stick
const GARAGE_TURN = 300;
const GARAGE_TILT = 120;
// photo mode zoom, in wheel delta a second on a held trigger
const PHOTO_ZOOM = 500;
const FLIPPER_KEYS: [number, FlipperButton][] = [
    [BUTTON.A, 'ok'],
    [BUTTON.B, 'back'],
];

const isTextField = (element: Element | null) =>
    element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLInputElement && TEXT_INPUTS.has(element.type));

const isScroller = (node: HTMLElement) => {
    if (node.scrollHeight <= node.clientHeight + 1) return false;
    return /(auto|scroll)/.test(getComputedStyle(node).overflowY);
};

const drawn = (object: THREE.Object3D) => {
    for (let node: THREE.Object3D | null = object; node; node = node.parent) {
        if (!node.visible) return false;
    }
    return true;
};

// react only sees a value it didn't set through the native setter
const setValue = (
    element: HTMLInputElement | HTMLSelectElement,
    value: string,
) => {
    const proto =
        element instanceof HTMLSelectElement
            ? HTMLSelectElement.prototype
            : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
};

export default class GamepadController {
    application: Application;
    connected = false;
    kind: PadKind = 'xbox';
    prev: boolean[] = [];
    repeat = new Repeat();
    current: Item | null = null;
    // where the focus was on each screen and menu, for coming back to it
    memory = new Map<string, Item>();
    context: Context = 'busy';
    key = 'busy';
    lastFrame = 0;
    // the driving hints show for a while from here
    since = 0;
    ring: HTMLDivElement;
    ringLabel: HTMLSpanElement;
    hints: HTMLDivElement;
    hintKey = '';
    flipperHeld = new Set<FlipperButton>();
    revving = false;
    // the photo camera was moving last frame, so letting go sends one stop
    photoMoving = false;
    carPrepared = false;
    // the pointer on yassinOS while m1 is the focus, and where it was left
    osPointer: { x: number; y: number } | null = null;
    osLast: { x: number; y: number } | null = null;
    osPressed = false;
    private box = new THREE.Box3();
    private part = new THREE.Box3();
    // each target's bounds in its own frame: a turned car's world box is
    // much bigger than the car on screen
    private bounds = new WeakMap<THREE.Object3D, THREE.Box3>();
    private inverse = new THREE.Matrix4();
    private relative = new THREE.Matrix4();
    private corner = new THREE.Vector3();
    private offset = new THREE.Vector3();
    private spherical = new THREE.Spherical();

    constructor() {
        this.application = new Application();
        this.ring = document.createElement('div');
        this.ring.className = 'pad-target';
        this.ring.setAttribute('aria-hidden', 'true');
        this.ringLabel = document.createElement('span');
        this.ring.appendChild(this.ringLabel);
        this.hints = document.createElement('div');
        this.hints.className = 'pad-hints';
        this.hints.setAttribute('aria-hidden', 'true');
        document.body.append(this.ring, this.hints);

        window.addEventListener(
            'gamepadconnected',
            () => (this.connected = true),
        );
        window.addEventListener('gamepaddisconnected', () => {
            this.connected = Boolean(currentPad());
            if (!this.connected) this.setActive(false);
        });
        this.connected = Boolean(currentPad());

        // a real mouse move, touch, wheel or key hands the page back. our own
        // esc presses aren't trusted, so they don't
        const leave = (event: Event) => {
            if (event.isTrusted) this.setActive(false);
        };
        window.addEventListener(
            'mousemove',
            (event) => {
                if (event.movementX || event.movementY) leave(event);
            },
            true,
        );
        window.addEventListener('pointerdown', leave, true);
        window.addEventListener('wheel', leave, {
            capture: true,
            passive: true,
        });
        window.addEventListener('keydown', leave, true);
    }

    update() {
        if (!this.connected) return;
        const pad = currentPad();
        if (!pad) return;
        const now = performance.now();
        const dt = this.lastFrame
            ? Math.min(0.1, (now - this.lastFrame) / 1000)
            : 0;
        this.lastFrame = now;
        const down = Array.from(pad.buttons, (button) => button.pressed);
        const [lx, ly] = stick(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
        const [rx, ry] = stick(pad.axes[2] ?? 0, pad.axes[3] ?? 0);
        const prev = this.prev;
        const frame: Frame = {
            pad,
            down,
            pressed: (button) => Boolean(down[button] && !prev[button]),
            lx,
            ly,
            rx,
            ry,
            dt,
            now,
        };
        this.prev = down;

        const context = this.resolveContext();
        const key = this.keyOf(context);
        if (key !== this.key) this.enter(context, key, now);
        // the car leaves the pad alone while a menu or the fly in has it
        padShared.menuOpen = context === 'menu' || context === 'transition';

        const used = down.some(Boolean) || Boolean(lx || ly || rx || ry);
        if (!padShared.active) {
            if (!used) return;
            this.kind = padKind(pad.id);
            this.setActive(true);
            this.since = now;
            // the press that wakes the pad only shows where the focus is,
            // except where the pad acts at once
            if (context !== 'drive' && context !== 'transition') {
                this.repeat.step(padDirection(pad), now);
                this.show(context, now);
                return;
            }
        }
        this.handle(context, frame);
        this.show(context, now);
    }

    // --- what the page is showing ---

    resolveContext(): Context {
        const app = this.application;
        const world = app.world;
        const camera = app.camera;
        if (!world?.screens || !camera) return 'busy';
        if (document.querySelector('.garage-fade.on')) return 'busy';
        if (document.body.classList.contains('race-transition'))
            return 'transition';
        if (this.overlay()) return 'menu';
        if (world.raceManager?.active) return 'drive';
        const key = camera.currentKeyframe ?? camera.targetKeyframe;
        if (camera.introLock || !key || key === CameraKey.LOADING)
            return 'busy';
        if (world.flipper?.focused) return 'flipper';
        if (camera.freeCam) return 'freecam';
        if (key === CameraKey.ORBIT_CONTROLS_START) return 'busy';
        if (world.screens.focused) return 'screen';
        return 'room';
    }

    overlay(): HTMLElement | null {
        const os = this.application.world?.screens?.overlay;
        if (os?.isConnected) return os;
        for (const selector of OVERLAYS) {
            const element = document.querySelector<HTMLElement>(selector);
            if (element && element.getClientRects().length) return element;
        }
        return null;
    }

    // each screen and each menu keeps its own focus
    keyOf(context: Context) {
        if (context === 'screen')
            return `screen:${this.application.world.screens.focused}`;
        if (context === 'menu')
            return `menu:${this.overlay()?.className.split(' ')[0] || 'os'}`;
        return context;
    }

    enter(context: Context, key: string, now: number) {
        if (this.context === 'flipper') this.releaseFlipper();
        if (this.context === 'menu') this.setRev(false);
        if (this.key === 'screen:m1') this.releaseOs();
        if (this.current) this.memory.set(this.key, this.current);
        if (context !== this.context) this.since = now;
        this.context = context;
        this.key = key;
        // back where the focus was, if it's still there
        const remembered = this.memory.get(key) || null;
        this.setCurrent(
            remembered && (remembered.target || remembered.element?.isConnected)
                ? remembered
                : null,
        );
    }

    handle(context: Context, frame: Frame) {
        switch (context) {
            case 'transition':
                if (SKIP_BUTTONS.some((button) => frame.pressed(button))) {
                    this.application.world.raceTransition?.skip();
                }
                return;
            case 'menu':
                return this.handleMenu(frame);
            case 'flipper':
                return this.handleFlipper(frame);
            case 'freecam':
                return this.handleFreeCam(frame);
            case 'screen':
                return this.handleScreen(frame);
            case 'room':
                return this.handleRoom(frame);
            default:
                this.setCurrent(null);
        }
    }

    // --- menus: the lobby card, the garage, the pause menu, the car picker ---

    handleMenu(frame: Frame) {
        const scope = this.overlay();
        if (!scope) return;
        const pause = scope.matches('.race-menu-overlay');
        const photo = scope.matches('.race-photo');
        // photo mode's left stick moves the camera, so only the d-pad moves the focus
        const direction = this.repeat.step(
            padDirection(
                photo
                    ? {
                          index: frame.pad.index,
                          connected: frame.pad.connected,
                          mapping: frame.pad.mapping,
                          buttons: frame.pad.buttons,
                          axes: [],
                      }
                    : frame.pad,
            ),
            frame.now,
        );
        const element = this.current?.element;
        const sideways = direction === 'left' || direction === 'right';
        if (!(
            sideways &&
            element &&
            this.adjust(element, direction === 'right' ? 1 : -1)
        )) {
            this.navigate(() => this.domItems(scope, false), direction, scope);
        }
        if (frame.pressed(BUTTON.A) && this.current)
            this.activate(this.current);
        if (frame.pressed(BUTTON.B)) {
            if (isTextField(document.activeElement))
                (document.activeElement as HTMLElement).blur();
            else if (pause) this.resume();
            else this.pressKey('Escape');
        }
        if (pause && frame.pressed(BUTTON.MENU)) this.resume();
        if (!photo && frame.pressed(BUTTON.LB)) this.switchTab(scope, -1);
        if (!photo && frame.pressed(BUTTON.RB)) this.switchTab(scope, 1);
        if (scope.matches('.garage')) {
            if (frame.rx || frame.ry) {
                UIEventBus.dispatch('race:garageOrbit', {
                    dx: frame.rx * GARAGE_TURN * frame.dt,
                    dy: frame.ry * GARAGE_TILT * frame.dt,
                });
            }
            this.setRev(Boolean(frame.down[BUTTON.RT]));
        } else if (scope.matches('.race-photo')) {
            if (frame.rx || frame.ry) {
                UIEventBus.dispatch('race:photoOrbit', {
                    dx: frame.rx * GARAGE_TURN * frame.dt,
                    dy: frame.ry * GARAGE_TILT * frame.dt,
                });
            }
            // the triggers zoom, out on the left one
            const zoom = (frame.down[BUTTON.LT] ? 1 : 0) - (frame.down[BUTTON.RT] ? 1 : 0);
            if (zoom) UIEventBus.dispatch('race:photoZoom', { delta: zoom * PHOTO_ZOOM * frame.dt });
            // the left stick moves it, the bumpers down and up, a stick click faster
            const rise = (frame.down[BUTTON.RB] ? 1 : 0) - (frame.down[BUTTON.LB] ? 1 : 0);
            const moving = Boolean(frame.lx || frame.ly || rise);
            if (moving || this.photoMoving) {
                UIEventBus.dispatch('race:photoMove', {
                    x: frame.lx,
                    y: rise,
                    z: -frame.ly,
                    fast: Boolean(frame.down[BUTTON.L3]),
                });
            }
            this.photoMoving = moving;
        } else if (frame.ry) {
            this.scroll(scope, frame.ry * SCROLL_SPEED * frame.dt);
        }
    }

    resume() {
        UIEventBus.dispatch('race:setPaused', { paused: false });
    }

    setRev(on: boolean) {
        if (on === this.revving) return;
        this.revving = on;
        UIEventBus.dispatch('race:garageRev', { on });
    }

    // the bumpers step through a menu's tabs (garage) or filters (car picker)
    switchTab(scope: HTMLElement, step: number) {
        const row = scope.querySelector(TABS);
        if (!row) return;
        const tabs = Array.from(
            row.querySelectorAll<HTMLButtonElement>('button'),
        ).filter((tab) => !tab.disabled);
        if (!tabs.length) return;
        const at = tabs.findIndex(
            (tab) =>
                tab.classList.contains('on') ||
                tab.classList.contains('active') ||
                tab.getAttribute('aria-pressed') === 'true',
        );
        const next = tabs[(Math.max(0, at) + step + tabs.length) % tabs.length];
        next.click();
        if (this.current?.element && row.contains(this.current.element))
            this.setCurrent({ element: next });
    }

    // left and right move a slider or a dropdown instead of the focus
    adjust(element: HTMLElement, step: 1 | -1) {
        if (element instanceof HTMLInputElement && element.type === 'range') {
            const min = Number(element.min) || 0;
            const max = element.max === '' ? 100 : Number(element.max);
            const unit = Number(element.step) || 1;
            const delta = Math.max(unit, (max - min) / 20);
            const raw = Number(element.value) + delta * step;
            const snapped = min + Math.round((raw - min) / unit) * unit;
            const next = Math.min(max, Math.max(min, snapped));
            setValue(element, String(Number(next.toFixed(6))));
            return true;
        }
        if (element instanceof HTMLSelectElement) {
            const index = Math.min(
                element.options.length - 1,
                Math.max(0, element.selectedIndex + step),
            );
            if (index !== element.selectedIndex)
                setValue(element, element.options[index].value);
            return true;
        }
        return false;
    }

    // --- the room ---

    handleRoom(frame: Frame) {
        this.navigate(
            () => [
                ...this.domItems(document.body, true),
                ...this.roomTargets(),
            ],
            this.repeat.step(padDirection(frame.pad), frame.now),
        );
        if (frame.pressed(BUTTON.A)) {
            if (this.current) this.activate(this.current);
            else this.application.camera.toggleIdleDesk();
        }
        if (frame.pressed(BUTTON.B)) this.back();
        // menu: straight to the panel (the desk view's tab opens with the
        // focus), play solo first
        if (frame.pressed(BUTTON.MENU)) {
            const panel = document.querySelector<HTMLElement>('.look-hint');
            if (panel?.getClientRects().length) {
                if (panel.tabIndex >= 0) panel.focus({ preventScroll: true });
                const first = ['.look-hint-primary', '.look-hint-menu']
                    .map((selector) =>
                        panel.querySelector<HTMLElement>(selector),
                    )
                    .find((element) => element && this.usable(element, true));
                if (first) this.setCurrent({ element: first });
                else if (this.usable(panel, true))
                    this.setCurrent({ element: panel });
            }
        }
    }

    // a focused screen (m2 and m3 have buttons of their own), the pc or yassinOS
    handleScreen(frame: Frame) {
        const screens = this.application.world.screens;
        const id = screens.focused;
        if (id === 'm1' && screens.iframeReady && !screens.mobile) {
            this.handleOs(frame);
            return;
        }
        const container =
            id === 'm2' || id === 'm3' ? screens.screens[id].container : null;
        this.navigate(
            () => [
                ...(container ? this.domItems(container, true) : []),
                ...[screens.back, screens.openOs]
                    .filter((button) => this.usable(button, true))
                    .map((element) => ({ element })),
            ],
            this.repeat.step(padDirection(frame.pad), frame.now),
        );
        if (frame.pressed(BUTTON.A) && this.current)
            this.activate(this.current);
        if (frame.pressed(BUTTON.B)) this.back();
        if (container && frame.ry)
            this.scroll(container, frame.ry * SCROLL_SPEED * frame.dt);
    }

    back() {
        const active = document.activeElement as HTMLElement | null;
        if (isTextField(active)) active?.blur();
        else this.pressKey('Escape');
    }

    // yassinOS on m1 takes a pointer of its own (utils/padPointer.ts in the
    // yassinOS repo): where it is and what it does go over the embed bridge
    handleOs(frame: Frame) {
        const { w, h } = SCREEN_CSS_SIZE.m1;
        this.setCurrent(null);
        if (!this.osPointer) {
            this.osPointer = this.osLast || { x: w / 2, y: h / 2 };
            this.postPointer('move');
        }
        const pointer = this.osPointer;
        let x = frame.lx;
        let y = frame.ly;
        if (!x && !y) {
            const held = (button: number) => (frame.down[button] ? 1 : 0);
            x = (held(BUTTON.RIGHT) - held(BUTTON.LEFT)) * OS_NUDGE;
            y = (held(BUTTON.DOWN) - held(BUTTON.UP)) * OS_NUDGE;
        }
        const push = Math.min(1, Math.hypot(x, y));
        if (push > 0) {
            const step = (OS_POINTER_SPEED * push ** 1.6 * frame.dt) / push;
            pointer.x = THREE.MathUtils.clamp(pointer.x + x * step, 0, w - 1);
            pointer.y = THREE.MathUtils.clamp(pointer.y + y * step, 0, h - 1);
            this.postPointer('move');
        }
        if (frame.pressed(BUTTON.A)) {
            this.osPressed = true;
            this.postPointer('down');
        } else if (this.osPressed && !frame.down[BUTTON.A]) {
            this.osPressed = false;
            this.postPointer('up');
        }
        if (frame.pressed(BUTTON.X)) this.postPointer('menu');
        if (frame.rx || frame.ry) {
            this.postPointer(
                'scroll',
                frame.rx * OS_SCROLL * frame.dt,
                frame.ry * OS_SCROLL * frame.dt,
            );
        }
        if (frame.pressed(BUTTON.B)) this.back();
    }

    postPointer(kind: string, dx = 0, dy = 0) {
        const pointer = this.osPointer;
        if (!pointer) return;
        const message: Record<string, unknown> = {
            type: 'yassinos:pointer',
            kind,
            x: Math.round(pointer.x),
            y: Math.round(pointer.y),
        };
        if (kind === 'scroll') Object.assign(message, { dx, dy });
        this.application.world.screens.postOs(message);
    }

    releaseOs() {
        if (!this.osPointer) return;
        if (this.osPressed) this.postPointer('up');
        this.postPointer('hide');
        this.osLast = this.osPointer;
        this.osPointer = null;
        this.osPressed = false;
    }

    // the flipper's own keys: the d-pad, A for ok and B for its back button.
    // menu or Y puts it down
    handleFlipper(frame: Frame) {
        const flipper = this.application.world.flipper;
        const direction = padDirection(frame.pad);
        const held = new Set<FlipperButton>();
        if (direction) held.add(direction);
        FLIPPER_KEYS.forEach(([index, button]) => {
            if (frame.down[index]) held.add(button);
        });
        held.forEach((button) => {
            if (this.flipperHeld.has(button)) return;
            this.flipperHeld.add(button);
            flipper.device.press(button);
        });
        this.flipperHeld.forEach((button) => {
            if (held.has(button)) return;
            this.flipperHeld.delete(button);
            flipper.device.release(button);
        });
        if (frame.pressed(BUTTON.MENU) || frame.pressed(BUTTON.Y)) {
            this.releaseFlipper();
            flipper.leave();
        }
    }

    releaseFlipper() {
        const device = this.application.world?.flipper?.device;
        this.flipperHeld.forEach((button) => device?.release(button));
        this.flipperHeld.clear();
    }

    // look around: either stick orbits, the triggers zoom
    handleFreeCam(frame: Frame) {
        const controls = this.application.camera.orbitControls;
        const x = frame.rx || frame.lx;
        const y = frame.ry || frame.ly;
        const zoom =
            (frame.pad.buttons[BUTTON.RT]?.value ?? 0) -
            (frame.pad.buttons[BUTTON.LT]?.value ?? 0);
        if (controls && (x || y || Math.abs(zoom) > 0.05)) {
            const offset = this.offset
                .copy(controls.object.position)
                .sub(controls.target);
            this.spherical.setFromVector3(offset);
            this.spherical.theta -= x * ORBIT_SPEED * frame.dt;
            this.spherical.phi = THREE.MathUtils.clamp(
                this.spherical.phi + y * ORBIT_SPEED * 0.6 * frame.dt,
                0.05,
                controls.maxPolarAngle,
            );
            this.spherical.radius = THREE.MathUtils.clamp(
                this.spherical.radius * (1 - zoom * frame.dt),
                controls.minDistance,
                controls.maxDistance,
            );
            offset.setFromSpherical(this.spherical);
            controls.object.position.copy(controls.target).add(offset);
        }
        if (frame.pressed(BUTTON.B) || frame.pressed(BUTTON.MENU)) {
            UIEventBus.dispatch('freeCamToggle', false);
        }
    }

    // --- the focus ---

    // the item list is only built for a move, or when the focus went away
    navigate(
        items: () => Item[],
        direction: Direction | null,
        scope?: HTMLElement,
    ) {
        let list: Item[] | null = null;
        if (!this.current || !this.stillThere(this.current, scope)) {
            list = items();
            const current = this.current;
            const kept =
                current && list.find((item) => this.same(item, current));
            this.setCurrent(kept || this.defaultItem(list, scope));
        }
        const current = this.current;
        if (!direction || !current) return;
        list = list || items();
        // a focused container (the desk view's panel tab) is stepped into
        const inside = current.element
            ? list.filter(
                  (item) =>
                      item.element &&
                      item.element !== current.element &&
                      current.element?.contains(item.element),
              )
            : [];
        if (inside.length) {
            this.setCurrent(this.defaultItem(inside, current.element));
            return;
        }
        const from = this.itemBox(current);
        if (!from) return;
        const boxes = list.map(
            (item) =>
                this.itemBox(item) || {
                    left: -1e9,
                    top: -1e9,
                    right: -1e9,
                    bottom: -1e9,
                },
        );
        const index = pickInDirection(from, boxes, direction);
        if (index >= 0) this.setCurrent(list[index]);
        // nothing that way: show what's past the last button (the menu's notes)
        else if (scope && (direction === 'up' || direction === 'down')) {
            this.scroll(scope, direction === 'down' ? 160 : -160);
        }
    }

    stillThere(item: Item, scope?: HTMLElement) {
        if (item.target)
            return (
                this.context === 'room' && Boolean(this.targetBox(item.target))
            );
        const element = item.element;
        if (!element.isConnected || (scope && !scope.contains(element)))
            return false;
        return this.usable(element, !scope);
    }

    same(a: Item, b: Item | null) {
        return (
            Boolean(b) &&
            (a.element ? a.element === b?.element : a.target === b?.target)
        );
    }

    defaultItem(items: Item[], scope?: HTMLElement): Item | null {
        if (scope) {
            for (const selector of DEFAULTS) {
                const element = scope.querySelector(selector);
                const item =
                    element && items.find((entry) => entry.element === element);
                if (item) return item;
            }
        }
        const start =
            this.application.camera.currentKeyframe === CameraKey.DESK
                ? 'm1'
                : 'car';
        return (
            items.find((item) => item.target === start) ||
            items.find((item) => item.target === 'm1') ||
            items[0] ||
            null
        );
    }

    setCurrent(item: Item | null) {
        const old = this.current;
        if (old && item && this.same(item, old)) return;
        if (old?.element) {
            old.element.removeAttribute('data-pad-focus');
            if (
                isTextField(old.element) &&
                document.activeElement === old.element
            )
                old.element.blur();
        }
        if (old?.target === 'car') this.releaseCar();
        this.current = item;
        if (item?.element) {
            item.element.setAttribute('data-pad-focus', '');
            // a text field takes the focus only on A, or a phone opens its keyboard
            if (
                !isTextField(item.element) &&
                document.activeElement !== item.element
            ) {
                item.element.focus({ preventScroll: true });
            }
            this.reveal(item.element);
        } else if (item?.target) {
            // the room's panel folds back once nothing in it has the focus
            const active = document.activeElement as HTMLElement | null;
            if (
                active &&
                active !== document.body &&
                active.closest('.look-hint')
            )
                active.blur();
            if (item.target === 'car') this.prepareCar();
        }
    }

    activate(item: Item) {
        if (item.target) {
            this.activateTarget(item.target);
            return;
        }
        const element = item.element;
        if (isTextField(element)) {
            element.focus();
            return;
        }
        if (element instanceof HTMLSelectElement) {
            const next = (element.selectedIndex + 1) % element.options.length;
            setValue(element, element.options[next].value);
            return;
        }
        if (element instanceof HTMLInputElement && element.type === 'range')
            return;
        element.click();
    }

    activateTarget(target: RoomTarget) {
        const world = this.application.world;
        if (target === 'car') {
            if (world.raceTransition?.canStart())
                void world.raceTransition.start({ ask: false });
            return;
        }
        if (target === 'flipper') {
            world.screens.backOut(true);
            world.flipper?.focus();
            return;
        }
        world.screens.focus(target);
    }

    // hovering the car downloads and builds the race, so does the focus
    prepareCar() {
        const transition = this.application.world.raceTransition;
        if (!transition || this.carPrepared) return;
        this.carPrepared = true;
        transition.holdResolution();
        void transition.prepareOnHover();
    }

    releaseCar() {
        if (!this.carPrepared) return;
        this.carPrepared = false;
        const transition = this.application.world.raceTransition;
        if (transition && !transition.busy) transition.letResolutionGo();
    }

    // the page's buttons, inputs and links that can take a press right now
    domItems(root: ParentNode, onScreen: boolean): Item[] {
        const items: Item[] = [];
        root.querySelectorAll<HTMLElement>(FOCUSABLE).forEach((element) => {
            if (this.usable(element, onScreen)) items.push({ element });
        });
        return items;
    }

    usable(element: HTMLElement, onScreen: boolean) {
        if (element.tabIndex < 0 || (element as HTMLButtonElement).disabled)
            return false;
        if (
            element instanceof HTMLInputElement &&
            (element.type === 'hidden' || element.type === 'color')
        ) {
            return false;
        }
        // a new tab needs a real click, which a pad press isn't
        if (element instanceof HTMLAnchorElement && element.target === '_blank')
            return false;
        if (element.closest('[aria-hidden="true"], .room-nav')) return false;
        // inside a closed details, only its summary shows
        const details = element.closest('details');
        if (details && !details.open && !element.closest('summary'))
            return false;
        const rect = element.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return false;
        if (
            onScreen &&
            (rect.right <= 0 ||
                rect.bottom <= 0 ||
                rect.left >= window.innerWidth ||
                rect.top >= window.innerHeight)
        ) {
            return false;
        }
        const check = (
            element as HTMLElement & {
                checkVisibility?: (options: Record<string, boolean>) => boolean;
            }
        ).checkVisibility;
        if (
            check &&
            !check.call(element, {
                checkOpacity: true,
                checkVisibilityCSS: true,
            })
        )
            return false;
        const style = getComputedStyle(element);
        return (
            style.visibility !== 'hidden' &&
            style.pointerEvents !== 'none' &&
            Number(style.opacity) > 0.05
        );
    }

    // the room's screens, the car, the pc and the flipper that are in view
    roomTargets(): Item[] {
        return TARGETS.filter((target) => this.targetBox(target)).map(
            (target) => ({ target }),
        );
    }

    targetObject(target: RoomTarget): THREE.Object3D | null {
        const world = this.application.world;
        if (target === 'car') {
            // from the idle view only: the desk view looks past it at the screens
            const idle =
                this.application.camera.currentKeyframe === CameraKey.IDLE;
            return idle && world.raceTransition?.canStart()
                ? world.car?.model || null
                : null;
        }
        if (target === 'flipper') return world.flipper?.model || null;
        if (target === 'pc')
            return world.screens.extraTargets.get('pc')?.object || null;
        return world.screens.screens[target].hole;
    }

    localBox(object: THREE.Object3D) {
        let box = this.bounds.get(object);
        if (box) return box;
        box = new THREE.Box3();
        object.updateWorldMatrix(true, true);
        this.inverse.copy(object.matrixWorld).invert();
        object.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (!mesh.isMesh || !mesh.geometry) return;
            if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
            const bounds = mesh.geometry.boundingBox;
            if (!bounds) return;
            this.relative.multiplyMatrices(this.inverse, mesh.matrixWorld);
            box?.union(this.part.copy(bounds).applyMatrix4(this.relative));
        });
        this.bounds.set(object, box);
        return box;
    }

    // a target's box on screen, from the corners of its own bounds
    targetBox(target: RoomTarget): Box | null {
        const object = this.targetObject(target);
        if (!object || !drawn(object)) return null;
        this.box.copy(this.localBox(object));
        if (this.box.isEmpty()) return null;
        const camera = this.application.camera.instance;
        const { min, max } = this.box;
        let left = Infinity;
        let top = Infinity;
        let right = -Infinity;
        let bottom = -Infinity;
        for (let i = 0; i < 8; i++) {
            this.corner
                .set(
                    i & 1 ? max.x : min.x,
                    i & 2 ? max.y : min.y,
                    i & 4 ? max.z : min.z,
                )
                .applyMatrix4(object.matrixWorld)
                .project(camera);
            // behind the camera
            if (this.corner.z > 1) return null;
            const x = ((this.corner.x + 1) / 2) * window.innerWidth;
            const y = ((1 - this.corner.y) / 2) * window.innerHeight;
            left = Math.min(left, x);
            right = Math.max(right, x);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
        }
        left = Math.max(0, left);
        top = Math.max(0, top);
        right = Math.min(window.innerWidth, right);
        bottom = Math.min(window.innerHeight, bottom);
        if (right - left < 12 || bottom - top < 12) return null;
        return { left, top, right, bottom };
    }

    itemBox(item: Item): Box | null {
        if (item.target) {
            const box = this.targetBox(item.target);
            if (!box) return null;
            const x = (box.left + box.right) / 2;
            const y = (box.top + box.bottom) / 2;
            return {
                left: x - TARGET_HALF,
                top: y - TARGET_HALF,
                right: x + TARGET_HALF,
                bottom: y + TARGET_HALF,
            };
        }
        const rect = item.element.getBoundingClientRect();
        return {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
        };
    }

    // keeps the focused control in view inside a scrolling panel
    reveal(element: HTMLElement) {
        for (
            let node = element.parentElement;
            node && node !== document.body;
            node = node.parentElement
        ) {
            if (!isScroller(node)) continue;
            const box = node.getBoundingClientRect();
            const rect = element.getBoundingClientRect();
            const margin = 16;
            if (rect.top < box.top + margin)
                node.scrollTop -= box.top + margin - rect.top;
            else if (rect.bottom > box.bottom - margin)
                node.scrollTop += rect.bottom - (box.bottom - margin);
            return;
        }
    }

    scroll(scope: HTMLElement, amount: number) {
        let scroller: HTMLElement | null = null;
        const start =
            this.current?.element && scope.contains(this.current.element)
                ? this.current.element
                : null;
        for (
            let node = start;
            node && !scroller;
            node = node === scope ? null : node.parentElement
        ) {
            if (isScroller(node)) scroller = node;
        }
        scroller =
            scroller ||
            (isScroller(scope) ? scope : null) ||
            Array.from(scope.querySelectorAll<HTMLElement>('*')).find(
                isScroller,
            ) ||
            null;
        if (scroller) scroller.scrollTop += amount;
    }

    // esc and the like, through the page's own key handlers
    pressKey(key: string) {
        const init = { key, code: key, bubbles: true, cancelable: true };
        document.body.dispatchEvent(new KeyboardEvent('keydown', init));
        document.body.dispatchEvent(new KeyboardEvent('keyup', init));
    }

    // --- pad mode, the target frame and the button hints ---

    setActive(active: boolean) {
        if (active === padShared.active) return;
        padShared.active = active;
        document.documentElement.classList.toggle('pad-mode', active);
        if (active) return;
        const element = this.current?.element;
        if (
            element &&
            document.activeElement === element &&
            !isTextField(element)
        )
            element.blur();
        this.setCurrent(null);
        this.releaseFlipper();
        this.releaseOs();
        this.setRev(false);
        this.ring.classList.remove('on');
        this.hints.classList.remove('on');
        this.hintKey = '';
    }

    show(context: Context, now: number) {
        const target = this.current?.target;
        const box = target ? this.targetBox(target) : null;
        if (box && target) {
            const pad = 8;
            this.ring.style.transform = `translate(${box.left - pad}px, ${box.top - pad}px)`;
            this.ring.style.width = `${box.right - box.left + pad * 2}px`;
            this.ring.style.height = `${box.bottom - box.top + pad * 2}px`;
            this.ringLabel.textContent = TARGET_LABELS[target];
            this.ring.classList.add('on');
        } else {
            this.ring.classList.remove('on');
        }
        this.setHints(this.hintsFor(context, now));
        // menus sit in the middle or on one side: the hints take the other corner
        if (context === 'menu') {
            const scope = this.overlay();
            const panel =
                scope?.querySelector(
                    '.garage-panel, .race-menu-panel, .race-lobby-card',
                ) || scope;
            const rect = panel?.getBoundingClientRect();
            this.hints.classList.toggle(
                'right',
                Boolean(
                    rect &&
                    rect.left + rect.width / 2 < window.innerWidth / 2 - 1,
                ),
            );
        }
    }

    hintsFor(context: Context, now: number): [string, string][] {
        const label = (button: keyof typeof BUTTON) =>
            buttonLabel(this.kind, button);
        const bumpers = `${label('LB')} ${label('RB')}`;
        switch (context) {
            case 'room':
                return [
                    [label('A'), 'Select'],
                    [label('B'), 'Back'],
                    [label('MENU'), 'Menu'],
                ];
            case 'screen':
                if (this.osPointer) {
                    return [
                        ['LS', 'Pointer'],
                        [label('A'), 'Click'],
                        [label('X'), 'Right click'],
                        ['RS', 'Scroll'],
                        [label('B'), 'Back'],
                    ];
                }
                return [
                    [label('A'), 'Select'],
                    [label('B'), 'Back'],
                ];
            case 'menu': {
                const scope = this.overlay();
                const list: [string, string][] = [
                    [label('A'), 'Select'],
                    [
                        label('B'),
                        scope?.matches('.race-menu-overlay')
                            ? 'Resume'
                            : 'Back',
                    ],
                ];
                if (scope?.querySelector(TABS)) list.push([bumpers, 'Tabs']);
                if (scope?.matches('.garage'))
                    list.push(['RS', 'Turn'], [label('RT'), 'Rev']);
                if (scope?.matches('.race-photo'))
                    list.push(
                        ['LS', 'Move'],
                        ['RS', 'Orbit'],
                        [bumpers, 'Down, up'],
                        [`${label('LT')} ${label('RT')}`, 'Zoom'],
                    );
                return list;
            }
            case 'flipper':
                return [
                    ['D-pad', 'Keys'],
                    [label('A'), 'OK'],
                    [label('B'), 'Back'],
                    [label('MENU'), 'Leave'],
                ];
            case 'freecam':
                return [
                    ['Sticks', 'Orbit'],
                    [`${label('LT')} ${label('RT')}`, 'Zoom'],
                    [label('B'), 'Done'],
                ];
            case 'transition':
                return [[label('A'), 'Skip']];
            case 'drive':
                if (now - this.since > DRIVE_HINT_MS) return [];
                return [
                    [label('RT'), 'Gas'],
                    [label('LT'), 'Brake'],
                    [label('A'), 'Handbrake'],
                    [label('X'), 'Camera'],
                    [label('Y'), 'Reset'],
                    [label('MENU'), 'Pause'],
                ];
            default:
                return [];
        }
    }

    setHints(list: [string, string][]) {
        const key = `${this.context}|${list.map((entry) => entry.join(':')).join('|')}`;
        if (key === this.hintKey) return;
        this.hintKey = key;
        this.hints.classList.toggle('on', list.length > 0);
        this.hints.classList.toggle(
            'raised',
            this.context === 'flipper' || this.context === 'screen',
        );
        this.hints.classList.toggle('corner', this.context === 'menu');
        if (!list.length) return;
        this.hints.replaceChildren(
            ...list.map(([button, action]) => {
                const entry = document.createElement('span');
                const glyph = document.createElement('kbd');
                glyph.textContent = button;
                entry.append(glyph, action);
                return entry;
            }),
        );
    }
}
