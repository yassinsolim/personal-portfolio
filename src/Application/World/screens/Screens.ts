import * as THREE from 'three';
import { CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import Application from '../../Application';
import UIEventBus from '../../UI/EventBus';
import { CameraKey } from '../../Camera/Camera';
import { assetUrl } from '../../Utils/assetUrl';
import { isMobileDevice } from '../../Utils/Device';
import { roomTier } from '../../Utils/roomTier';
import { SCREEN_POSES, type ScreenPose } from './layout';
import {
    SCREEN_CSS_SIZE,
    type DisplayContext,
    type OsState,
    type RoomDisplay,
    type RoomTheme,
    type ScreenId,
    type TerminalDisplay,
} from './types';
import './screens.css';

// the three monitors. each is a css3d plane behind the webgl canvas (like
// henry's single monitor) with a gl plane that punches its hole, so gl in
// front still covers it. m1 holds the only iframe (live yassinOS, created
// late and paused whenever it can't be seen), m2 and m3 are plain dom.
// hover shows a target, a click focuses it, esc or a click elsewhere backs out

export type FocusTarget = ScreenId | 'flipper' | 'pc';

type Pose = { position: THREE.Vector3; focal: THREE.Vector3 };

type Screen = {
    id: ScreenId;
    pose: ScreenPose;
    container: HTMLDivElement;
    object: CSS3DObject;
    hole: THREE.Mesh;
    display: RoomDisplay | null;
    shown: boolean;
};

const OS_ORIGIN = 'https://os.yassin.app';
const LABELS: Record<FocusTarget, string> = {
    m1: 'yassinOS',
    m2: 'Widgets',
    m3: 'Terminal',
    flipper: 'Flipper Zero',
    pc: 'The PC',
};
// how much of the viewport each screen fills when focused
const FILL: Record<ScreenId, number> = { m1: 0.92, m2: 0.92, m3: 0.9 };
// under this share of the viewport a screen counts as out of sight
const M1_MIN_AREA = 0.06;
const DISPLAY_MIN_AREA = 0.02;
const VISIBILITY_MS = 200;
const HOVER_MS = 60;
// yassinOS without the bridge never says ready: fade in this long after load
const READY_FALLBACK_MS = 4000;
const HELLO_MS = 400;
// the desktop starts empty in the embed (it matches the poster); m1 opens
// the portfolio app once it's up, like the site always has
const START_APP = 'Portfolio';
const HIGH_TIER_IFRAME_DELAY_MS = 1500;
const LEAVE_EASE_MS = 900;

const nameToId: Record<string, ScreenId> = {
    m1: 'm1',
    main: 'm1',
    bottom: 'm1',
    m2: 'm2',
    top: 'm2',
    widgets: 'm2',
    m3: 'm3',
    side: 'm3',
    right: 'm3',
    terminal: 'm3',
};

export default class Screens {
    application: Application;
    screens: Record<ScreenId, Screen>;
    focused: FocusTarget | null = null;
    hovered: FocusTarget | null = null;
    raceActive = false;
    locked = false;
    theme: RoomTheme = {};
    osState: OsState = { apps: [], focused: null };
    iframe: HTMLIFrameElement | null = null;
    iframeOrigin = OS_ORIGIN;
    iframeReady = false;
    osVisible = true;
    pendingOs: Array<Record<string, unknown>> = [];
    extraTargets = new Map<FocusTarget, { object: THREE.Object3D; pose: () => Pose }>();
    raycaster = new THREE.Raycaster();
    pointer = new THREE.Vector2();
    lastVisibility = 0;
    lastHover = 0;
    tier = roomTier();
    mobile = isMobileDevice();
    chip: HTMLDivElement;
    back: HTMLButtonElement;
    openOs: HTMLButtonElement;
    specCard: HTMLDivElement;
    overlay: HTMLDivElement | null = null;
    displaysReady: Promise<void>;
    private resolveDisplays!: () => void;

    constructor() {
        this.application = new Application();
        this.displaysReady = new Promise((resolve) => (this.resolveDisplays = resolve));
        this.screens = {
            m1: this.createScreen('m1'),
            m2: this.createScreen('m2'),
            m3: this.createScreen('m3'),
        };
        this.createPoster();
        this.chip = this.createChip();
        this.back = this.createButton('Back', 'room-back', () => this.backOut());
        this.openOs = this.createButton('Open yassinOS', 'room-open-os', () => this.openOverlay());
        this.createNav();
        this.specCard = this.createSpecCard();
        this.bindPointer();
        this.bindKeys();
        this.bindRace();
        this.bindMessages();
        this.scheduleIframe();
        void this.createDisplays();
        UIEventBus.on('loadingScreenDone', () => {
            if (this.terminalClaimed) return;
            void this.terminal().then((terminal) => terminal?.setMode('shell'));
        });
        this.applyPointer();
    }

    // the loader (and anything else) finds a screen by id or plain name
    get(name: string) {
        const id = nameToId[name];
        return id ? this.screens[id] : undefined;
    }

    // where the camera sits to see a screen fill the viewport
    focusPose(id: ScreenId, aspect = this.application.camera.getAspect()): Pose {
        const { pose } = this.screens[id];
        const camera = this.application.camera.instance;
        const tv = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
        const th = tv * aspect;
        const distance = Math.max(pose.height / 2 / tv, pose.width / 2 / th) / FILL[id];
        return {
            position: pose.center.clone().addScaledVector(pose.normal, distance),
            focal: pose.center.clone(),
        };
    }

    async terminal(): Promise<TerminalDisplay | null> {
        await this.displaysReady;
        return this.screens.m3.display as TerminalDisplay | null;
    }

    // a loader that streams its log onto m3 claims it and switches it to the
    // shell itself. unclaimed, it becomes the shell when loading is done
    terminalClaimed = false;

    async claimTerminal() {
        this.terminalClaimed = true;
        return this.terminal();
    }

    // the flipper and the pc: anything clickable with a camera pose
    addTarget(id: FocusTarget, object: THREE.Object3D, pose: () => Pose) {
        object.traverse((child) => (child.userData.focusTarget = id));
        this.extraTargets.set(id, { object, pose });
    }

    createScreen(id: ScreenId): Screen {
        const pose = SCREEN_POSES[id];
        const size = SCREEN_CSS_SIZE[id];
        const container = document.createElement('div');
        container.className = `room-screen room-screen-${id}`;
        container.style.width = `${size.w}px`;
        container.style.height = `${size.h}px`;
        container.style.position = 'relative';
        container.style.overflow = 'hidden';
        container.style.background = '#000';
        container.style.backfaceVisibility = 'hidden';
        container.style.pointerEvents = 'none';

        const object = new CSS3DObject(container);
        const right = new THREE.Vector3().crossVectors(pose.up, pose.normal).normalize();
        const basis = new THREE.Matrix4().makeBasis(right, pose.up, pose.normal);
        object.quaternion.setFromRotationMatrix(basis);
        object.position.copy(pose.center);
        object.scale.setScalar(pose.width / size.w);
        this.application.cssScene.add(object);

        // the hole: writes transparent black over the canvas, so the css
        // layer underneath shows through. just in front of the room's own
        // black screen quad
        const hole = new THREE.Mesh(
            new THREE.PlaneGeometry(pose.width, pose.height),
            new THREE.MeshBasicMaterial({
                color: 0x000000,
                transparent: true,
                opacity: 0,
                blending: THREE.NoBlending,
            })
        );
        hole.name = `screen_hole_${id}`;
        hole.quaternion.copy(object.quaternion);
        hole.position.copy(pose.center).addScaledVector(pose.normal, 1);
        hole.userData.focusTarget = id;
        this.application.scene.add(hole);
        return { id, pose, container, object, hole, display: null, shown: true };
    }

    createPoster() {
        const poster = document.createElement('img');
        poster.className = 'room-poster';
        poster.alt = '';
        poster.decoding = 'async';
        poster.src = assetUrl('textures/room/poster-main.webp');
        Object.assign(poster.style, {
            position: 'absolute',
            inset: '0',
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transition: 'opacity 0.5s ease',
        });
        this.screens.m1.container.appendChild(poster);
    }

    async createDisplays() {
        try {
            const response = await fetch(assetUrl('textures/room/room-theme.json'));
            if (response.ok) this.theme = await response.json();
        } catch {
            // the displays fall back to their own defaults
        }
        const ctx = this.displayContext();
        try {
            const [{ createWidgetsDisplay }, { createTerminalDisplay }] = await Promise.all([
                import('./WidgetsDisplay'),
                import('./TerminalDisplay'),
            ]);
            this.mountDisplay('m2', createWidgetsDisplay(ctx));
            this.mountDisplay('m3', createTerminalDisplay(ctx));
        } catch (error) {
            console.error('[Screens] displays failed', error);
        }
        this.resolveDisplays();
    }

    mountDisplay(id: ScreenId, display: RoomDisplay) {
        const screen = this.screens[id];
        screen.display = display;
        screen.container.appendChild(display.root);
        display.setVisible(false);
    }

    displayContext(): DisplayContext {
        return {
            theme: this.theme,
            openInOS: (app, url) => this.openInOS(app, url),
            graphicsInfo: () => this.application.renderer.graphicsInfo(),
            on: <T,>(event: string, callback: (payload: T) => void) => {
                UIEventBus.on(event, callback);
                return () => UIEventBus.remove(event, callback);
            },
            osState: () => this.osState,
            startRace: () => {
                this.backOut(true);
                void this.application.world.raceTransition?.start();
            },
            bestLapMs: () => bestLocalLap(),
            focus: (target) => (target ? this.focus(target) : this.backOut()),
        };
    }

    // --- m1's iframe ---

    osSrc() {
        const params = new URLSearchParams(window.location.search);
        // a dev or lan test server, never the live site
        const host = window.location.hostname;
        const local =
            ['localhost', '127.0.0.1', '[::1]'].includes(host) || /^(192\.168|10)\.\d+\.\d+$/.test(host);
        const query = `embed=1&display=main&protocol=1&wallpaper=span&quality=${this.tier}`;
        const override = local ? params.get('os') : null;
        if (override) return `${override.replace(/\/?$/, '/')}?${query}`;
        if (local && params.has('dev')) return `http://localhost:3000/?${query}`;
        return `${OS_ORIGIN}/?${query}`;
    }

    // high tier: once the room is up and quiet. low tier: when m1 is focused.
    // phones never get a 3d iframe, focus offers the full screen one instead
    scheduleIframe() {
        if (this.tier !== 'high' || this.mobile) return;
        UIEventBus.on('loadingScreenDone', () => {
            window.setTimeout(() => {
                const idle = (window as Window & {
                    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
                }).requestIdleCallback;
                if (idle) idle(() => this.ensureIframe(), { timeout: 2000 });
                else this.ensureIframe();
            }, HIGH_TIER_IFRAME_DELAY_MS);
        });
    }

    ensureIframe() {
        if (this.iframe || this.mobile) return;
        const src = this.osSrc();
        this.iframeOrigin = new URL(src).origin;
        const iframe = document.createElement('iframe');
        iframe.src = src;
        iframe.id = 'computer-screen';
        iframe.title = 'yassinOS desktop';
        iframe.setAttribute(
            'sandbox',
            'allow-scripts allow-same-origin allow-pointer-lock allow-popups allow-popups-to-escape-sandbox'
        );
        // sandbox tokens alone don't delegate these to a cross-origin frame
        iframe.setAttribute('allow', 'fullscreen; pointer-lock; gamepad');
        iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
        Object.assign(iframe.style, {
            position: 'absolute',
            inset: '0',
            width: '100%',
            height: '100%',
            border: '0',
            background: '#000',
            opacity: '0',
            transition: 'opacity 0.6s ease',
            pointerEvents: 'none',
        });
        iframe.addEventListener('load', () => {
            // hello until yassinOS answers ready (its listener can start after load)
            const hello = () => {
                if (this.iframeReady || this.iframe !== iframe) return;
                this.postOs({
                    type: 'yassinos:hello',
                    protocol: 1,
                    display: 'main',
                    size: [SCREEN_CSS_SIZE.m1.w, SCREEN_CSS_SIZE.m1.h],
                    tier: this.tier,
                });
                window.setTimeout(hello, HELLO_MS);
            };
            hello();
            window.setTimeout(() => this.markReady(), READY_FALLBACK_MS);
        });
        this.iframe = iframe;
        this.screens.m1.container.appendChild(iframe);
        this.applyPointer();
    }

    markReady() {
        if (this.iframeReady || !this.iframe) return;
        this.iframeReady = true;
        this.iframe.style.opacity = '1';
        const queued = this.pendingOs;
        this.pendingOs = [];
        // pausing before ready would hold back what ready waits for (its
        // clock), so the visibility only goes over from here
        this.postOs({ type: this.osVisible ? 'yassinos:resume' : 'yassinos:pause' });
        if (!queued.some((message) => message.type === 'yassinos:open')) {
            queued.unshift({ type: 'yassinos:open', app: START_APP });
        }
        queued.forEach((message) => this.postOs(message));
    }

    postOs(message: Record<string, unknown>) {
        this.iframe?.contentWindow?.postMessage(message, this.iframeOrigin);
    }

    openInOS(app: string, url?: string) {
        if (this.mobile) {
            this.openOverlay(app);
            return;
        }
        this.ensureIframe();
        const message = { type: 'yassinos:open', app, ...(url ? { url } : {}) };
        if (this.iframeReady) this.postOs(message);
        else this.pendingOs.push(message);
        this.focus('m1');
    }

    bindMessages() {
        window.addEventListener('message', (event: MessageEvent) => {
            const iframe = this.iframe;
            if (!iframe || event.source !== iframe.contentWindow) return;
            if (event.origin !== this.iframeOrigin) return;
            const data = event.data as { type?: string; kind?: string; apps?: unknown; focused?: unknown };
            if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;
            switch (data.type) {
                case 'yassinos:ready':
                    this.markReady();
                    break;
                case 'yassinos:escape':
                    if (this.focused === 'm1') this.backOut();
                    break;
                case 'yassinos:input':
                    if (['keydown', 'pointerdown', 'pointerup'].includes(String(data.kind))) {
                        UIEventBus.dispatch('room:osInput', { kind: data.kind });
                    }
                    break;
                case 'yassinos:state':
                    this.osState = {
                        apps: Array.isArray(data.apps) ? data.apps.map(String).slice(0, 32) : [],
                        focused: typeof data.focused === 'string' ? data.focused : null,
                    };
                    UIEventBus.dispatch('room:osState', this.osState);
                    // the displays listen for the bridge's own name
                    UIEventBus.dispatch('yassinos:state', this.osState);
                    break;
            }
        });
    }

    // phones: yassinOS full screen in 2d, the only iframe they ever get
    openOverlay(app?: string) {
        if (this.overlay) return;
        const overlay = document.createElement('div');
        overlay.className = 'room-os-overlay';
        overlay.dataset.preventClick = '';
        Object.assign(overlay.style, {
            position: 'fixed',
            inset: '0',
            zIndex: '40',
            background: '#000',
        });
        const iframe = document.createElement('iframe');
        const src = new URL(this.osSrc());
        if (app) src.searchParams.set('app', app);
        iframe.src = src.toString();
        iframe.title = 'yassinOS desktop';
        iframe.setAttribute('allow', 'fullscreen; gamepad');
        Object.assign(iframe.style, { width: '100%', height: '100%', border: '0' });
        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = 'Close';
        close.className = 'room-chip-button room-overlay-close';
        close.addEventListener('click', () => {
            overlay.remove();
            this.overlay = null;
        });
        overlay.append(iframe, close);
        document.body.appendChild(overlay);
        this.overlay = overlay;
    }

    // --- focus ---

    poseFor(target: FocusTarget): Pose | null {
        if (target === 'm1' || target === 'm2' || target === 'm3') return this.focusPose(target);
        return this.extraTargets.get(target)?.pose() || null;
    }

    focus(target: FocusTarget) {
        if (this.raceActive || this.locked) return;
        const camera = this.application.camera;
        if (camera.freeCam) return;
        if (!this.poseFor(target)) return;
        const wasScreen = this.isScreen(this.focused);
        this.focused = target;
        camera.focusOn(() => this.poseFor(target));
        this.setHover(null);
        this.applyPointer();
        if (target === 'm1') this.ensureIframe();
        if (this.isScreen(target) && !wasScreen) UIEventBus.dispatch('enterMonitor', {});
        if (!this.isScreen(target) && wasScreen) UIEventBus.dispatch('leftMonitor', {});
        UIEventBus.dispatch('room:focus', { target });
    }

    // one level back: a focus goes to the desk view, the desk to idle
    backOut(silent = false) {
        const camera = this.application.camera;
        this.releaseFocus();
        if (this.focused) {
            const wasScreen = this.isScreen(this.focused);
            this.focused = null;
            this.applyPointer();
            if (!silent) camera.transition(CameraKey.DESK, LEAVE_EASE_MS);
            if (wasScreen) UIEventBus.dispatch('leftMonitor', {});
            UIEventBus.dispatch('room:focus', { target: null });
            return;
        }
        if (!silent && camera.currentKeyframe === CameraKey.DESK) camera.transition(CameraKey.IDLE);
    }

    isScreen(target: FocusTarget | null): target is ScreenId {
        return target === 'm1' || target === 'm2' || target === 'm3';
    }

    // keys stay with the page when a screen stops being the focus
    releaseFocus() {
        const active = document.activeElement as HTMLElement | null;
        if (!active) return;
        if (active === this.iframe || Object.values(this.screens).some((s) => s.container.contains(active))) {
            active.blur();
            window.focus();
        }
    }

    applyPointer() {
        const live = !this.raceActive && !this.locked;
        (Object.keys(this.screens) as ScreenId[]).forEach((id) => {
            const screen = this.screens[id];
            const on = live && this.focused === id;
            screen.container.style.pointerEvents = on ? 'auto' : 'none';
            // the camera's click toggle leaves a focused screen alone
            if (on) screen.container.dataset.preventClick = '';
            else delete screen.container.dataset.preventClick;
            screen.display?.setFocused(on);
        });
        if (this.iframe) this.iframe.style.pointerEvents = live && this.focused === 'm1' ? 'auto' : 'none';
        this.back.style.display = live && this.focused ? '' : 'none';
        this.openOs.style.display = live && this.mobile && this.focused === 'm1' ? '' : 'none';
        this.specCard.style.display = live && this.focused === 'pc' ? '' : 'none';
    }

    // --- pointer ---

    pickables() {
        const world = this.application.world;
        const list: THREE.Object3D[] = Object.values(this.screens).map((s) => s.hole);
        this.extraTargets.forEach(({ object }) => list.push(object));
        world.room?.occluders().forEach((object) => list.push(object));
        if (world.car?.model) list.push(world.car.model);
        return list;
    }

    // what's under the pointer, if it's something to focus. the first drawn
    // thing wins, so the desk or the car in front blocks what's behind
    pick(x: number, y: number): FocusTarget | null {
        const canvas = this.application.renderer.instance.domElement;
        const rect = canvas.getBoundingClientRect();
        this.pointer.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
        this.raycaster.setFromCamera(this.pointer, this.application.camera.instance);
        const hits = this.raycaster.intersectObjects(this.pickables(), true);
        for (const hit of hits) {
            if (!drawn(hit.object)) continue;
            let node: THREE.Object3D | null = hit.object;
            while (node) {
                const target = node.userData.focusTarget as FocusTarget | undefined;
                if (target) return target;
                node = node.parent;
            }
            return null;
        }
        return null;
    }

    canPick() {
        const camera = this.application.camera;
        if (this.raceActive || this.locked || camera.freeCam || this.overlay) return false;
        if (this.application.world.raceTransition?.busy) return false;
        const key = camera.currentKeyframe ?? camera.targetKeyframe;
        return key === CameraKey.IDLE || key === CameraKey.DESK || key === CameraKey.FOCUS;
    }

    bindPointer() {
        const mouse = this.application.mouse;
        document.addEventListener('mousemove', (event) => {
            mouse.trigger('mousemove', [event]);
            const now = performance.now();
            if (now - this.lastHover < HOVER_MS) return;
            this.lastHover = now;
            const target = this.canPick() ? this.pick(event.clientX, event.clientY) : null;
            this.setHover(target && target !== this.focused ? target : null, event);
        });
        // capture, so a click on a target never reaches the camera's
        // idle and desk toggle
        document.addEventListener(
            'mousedown',
            (event) => {
                if (event.button !== 0 || !this.canPick()) return;
                const element = event.target as HTMLElement | null;
                if (element?.closest?.('[data-prevent-click], #prevent-click')) return;
                const target = this.pick(event.clientX, event.clientY);
                if (target && target !== this.focused) {
                    event.stopImmediatePropagation();
                    event.preventDefault();
                    this.focus(target);
                    return;
                }
                if (this.focused && target !== this.focused) {
                    // the car handles its own click, and can't start from a focus
                    event.stopImmediatePropagation();
                    event.preventDefault();
                    this.backOut();
                }
            },
            true
        );
    }

    setHover(target: FocusTarget | null, event?: MouseEvent) {
        if (target !== this.hovered) {
            this.hovered = target;
            this.application.world.room?.setHover(target);
            document.body.style.cursor = target ? 'pointer' : '';
            this.chip.textContent = target ? LABELS[target] : '';
            this.chip.style.display = target ? '' : 'none';
        }
        if (target && event) {
            this.chip.style.transform = `translate(${event.clientX + 16}px, ${event.clientY + 18}px)`;
        }
    }

    bindKeys() {
        // yassinOS focuses itself when it loads. unless m1 is the focus, keys
        // belong to the page (esc, the race's keys)
        window.addEventListener('blur', () => {
            window.setTimeout(() => {
                if (this.iframe && document.activeElement === this.iframe && this.focused !== 'm1') {
                    this.iframe.blur();
                    window.focus();
                }
            }, 0);
        });
        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape' || this.raceActive || this.locked) return;
            if (this.overlay) {
                this.overlay.remove();
                this.overlay = null;
                return;
            }
            const camera = this.application.camera;
            if (camera.freeCam) return;
            if (this.focused || camera.currentKeyframe === CameraKey.DESK) this.backOut();
        });
    }

    // --- race mode ---

    bindRace() {
        UIEventBus.on('raceMode:changed', (state: { active?: boolean } | undefined) => {
            const active = Boolean(state?.active);
            if (active === this.raceActive) return;
            this.raceActive = active;
            if (active) {
                this.releaseFocus();
                if (this.focused && this.isScreen(this.focused)) UIEventBus.dispatch('leftMonitor', {});
                this.focused = null;
                this.setHover(null);
            }
            Object.values(this.screens).forEach((screen) => {
                screen.object.visible = !active;
                screen.container.style.visibility = active ? 'hidden' : 'visible';
            });
            this.applyPointer();
            this.updateVisibility(true);
        });
        // while the room opens onto the ring a click (to skip) over a screen
        // must not land in it, and keys must reach the page
        UIEventBus.on('race:transitionLock', (state: { locked?: boolean } | undefined) => {
            this.locked = Boolean(state?.locked);
            if (this.locked) {
                this.releaseFocus();
                this.setHover(null);
            }
            this.applyPointer();
        });
    }

    // --- per frame ---

    // screen area share and frustum test, every VISIBILITY_MS: m1's iframe is
    // paused when it can't be seen, the displays stop updating
    updateVisibility(force = false) {
        const now = performance.now();
        if (!force && now - this.lastVisibility < VISIBILITY_MS) return;
        this.lastVisibility = now;
        const camera = this.application.camera.instance;
        const hidden = document.hidden || this.raceActive;
        (Object.keys(this.screens) as ScreenId[]).forEach((id) => {
            const screen = this.screens[id];
            const area = hidden ? 0 : screenArea(screen.pose, camera);
            const focused = this.focused === id;
            if (id === 'm1') {
                const visible = !hidden && (focused || area > M1_MIN_AREA);
                if (visible !== this.osVisible) {
                    this.osVisible = visible;
                    if (this.iframeReady) this.postOs({ type: visible ? 'yassinos:resume' : 'yassinos:pause' });
                }
                return;
            }
            const visible = !hidden && (focused || area > DISPLAY_MIN_AREA);
            if (visible !== screen.shown) {
                screen.shown = visible;
                screen.display?.setVisible(visible);
            }
        });
    }

    update() {
        this.updateVisibility();
    }

    // the room's targets for the keyboard: hidden until tabbed to, enter
    // focuses (or races), esc goes back
    createNav() {
        const nav = document.createElement('nav');
        nav.className = 'room-nav';
        nav.setAttribute('aria-label', 'Room');
        nav.dataset.preventClick = '';
        const items: [string, () => void][] = [
            ['yassinOS, the main screen', () => this.focus('m1')],
            ['Widgets, the top screen', () => this.focus('m2')],
            ['Terminal, the side screen', () => this.focus('m3')],
            ['The PC', () => this.focus('pc')],
            ['Flipper Zero', () => this.focus('flipper')],
            ['Race the car on the Nordschleife', () => {
                this.backOut(true);
                void this.application.world.raceTransition?.start();
            }],
        ];
        items.forEach(([label, action]) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = label;
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                action();
            });
            nav.appendChild(button);
        });
        document.body.appendChild(nav);
    }

    // what the pc is, next to it while it's the focus
    createSpecCard() {
        const card = document.createElement('div');
        card.className = 'room-spec-card';
        card.dataset.preventClick = '';
        card.style.display = 'none';
        const rows: [string, string][] = [
            ['CPU', 'Intel Core i9-14900KF'],
            ['GPU', 'Gigabyte GeForce RTX 5080 GAMING OC'],
            ['Memory', '48 GB DDR5-6800'],
            ['Cooling', '360 mm AIO'],
            ['Case', 'Phanteks NV5, white'],
            ['Screens', 'Three 27 inch 1440p OLEDs'],
        ];
        const title = document.createElement('div');
        title.className = 'room-spec-title';
        title.textContent = "Yassin's PC";
        card.appendChild(title);
        rows.forEach(([key, value]) => {
            const row = document.createElement('div');
            row.className = 'room-spec-row';
            const k = document.createElement('span');
            k.textContent = key;
            const v = document.createElement('span');
            v.textContent = value;
            row.append(k, v);
            card.appendChild(row);
        });
        document.body.appendChild(card);
        return card;
    }

    createChip() {
        const chip = document.createElement('div');
        chip.className = 'room-chip';
        chip.setAttribute('aria-hidden', 'true');
        chip.style.display = 'none';
        document.body.appendChild(chip);
        return chip;
    }

    createButton(text: string, className: string, onClick: () => void) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        button.className = `room-chip-button ${className}`;
        button.dataset.preventClick = '';
        button.style.display = 'none';
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            onClick();
        });
        document.body.appendChild(button);
        return button;
    }
}

const drawn = (object: THREE.Object3D | null) => {
    for (let node = object; node; node = node.parent) {
        if (!node.visible) return false;
    }
    return true;
};

const corners = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
];
const scratch = new THREE.Vector3();
const right = new THREE.Vector3();

// the share of the viewport a screen covers, 0 when it's behind the camera
// or faces away
const screenArea = (pose: ScreenPose, camera: THREE.PerspectiveCamera) => {
    const toCamera = scratch.copy(camera.position).sub(pose.center);
    if (toCamera.dot(pose.normal) <= 0) return 0;
    right.crossVectors(pose.up, pose.normal).normalize();
    const points: [number, number][] = [];
    for (const [u, v] of corners) {
        scratch
            .copy(pose.center)
            .addScaledVector(right, u * pose.width)
            .addScaledVector(pose.up, v * pose.height)
            .project(camera);
        if (scratch.z > 1 || scratch.z < -1) return 0;
        points.push([THREE.MathUtils.clamp(scratch.x, -1, 1), THREE.MathUtils.clamp(scratch.y, -1, 1)]);
    }
    // shoelace, over the 2 x 2 ndc square
    let sum = 0;
    for (let i = 0; i < 4; i++) {
        const [x1, y1] = points[i];
        const [x2, y2] = points[(i + 1) % 4];
        sum += x1 * y2 - x2 * y1;
    }
    return Math.abs(sum) / 2 / 4;
};

const LEADERBOARD_KEY = 'yassinverse:nordschleife:leaderboard:v6';

const bestLocalLap = () => {
    try {
        const rows = JSON.parse(window.localStorage.getItem(LEADERBOARD_KEY) || '[]');
        if (!Array.isArray(rows)) return null;
        const times = rows.map((row) => Number(row?.lapTimeMs)).filter((t) => Number.isFinite(t) && t > 0);
        return times.length ? Math.min(...times) : null;
    } catch {
        return null;
    }
};
