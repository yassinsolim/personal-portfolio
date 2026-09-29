import * as THREE from 'three';
import Application from '../Application';
import Resources from '../Utils/Resources';
import Room from './Room';
import Screens from './screens/Screens';
import CoffeeSteam from './CoffeeSteam';
import Cursor from './Cursor';
import Hitboxes from './Hitboxes';
import Car from './Car';
import RaceTransition from './RaceTransition';
import Flipper from './Flipper';
import UIEventBus from '../UI/EventBus';
import { raceSources } from '../sources';
import { isLowPowerDevice } from '../Utils/Device';
import { reportStage } from '../Utils/loadStages';
import { afterFrame } from '../Racing/slicing';
import type RaceManager from '../Racing/RaceManager';
import PipelineIntro from './intro/PipelineIntro';
import M3Dock from './intro/M3Dock';
import { loaderVariant } from '../UI/loaders/variant';

// the camera's intro move takes 2.5 s after the loading screen
const RACE_PREFETCH_DELAY_MS = 3000;
// the room's programs get this long to compile before it's drawn anyway
const COMPILE_WAIT_MS = 4000;

type RaceAction = {
    event: string;
    payload: unknown;
};

export default class World {
    application: Application;
    scene: THREE.Scene;
    resources: Resources;

    // Objects in the scene
    room: Room;
    // the three monitors. built at once, before the room loads, so the
    // loader can dock its terminal on m3 (screens.get('m3'))
    screens: Screens;
    coffeeSteam: CoffeeSteam;
    cursor: Cursor;
    car: Car;
    raceTransition: RaceTransition;
    flipper: Flipper;
    raceManager: RaceManager | null;
    raceManagerLoading: Promise<RaceManager> | null;
    raceLoading: Promise<
        [typeof import('../Racing/RaceManager'), typeof import('../Racing/slicing'), void]
    > | null = null;
    pendingRaceAction: RaceAction | null;
    // set while the room's textures and programs get ready (warmUp)
    warming: Promise<void> | null = null;
    // the hybrid loading screen draws its pipeline stages while the room
    // warms up, and has the real materials compiled instead of its stand ins
    drawWhileWarming = false;
    warmUpSwap: (() => () => void) | null = null;
    intro: PipelineIntro | null = null;

    constructor() {
        this.application = new Application();
        this.scene = this.application.scene;
        this.resources = this.application.resources;
        this.raceManager = null;
        this.raceManagerLoading = null;
        this.pendingRaceAction = null;
        this.screens = new Screens();
        this.bindRaceManagerLoader();
        UIEventBus.on('loadingScreenDone', () => this.prefetchRaceWhenIdle());
        // Wait for resources
        this.resources.on('ready', () => {
            // Setup
            this.room = new Room();
            this.coffeeSteam = new CoffeeSteam();
            this.car = new Car();
            this.raceTransition = new RaceTransition();
            this.flipper = new Flipper();
            if (this.room.pc) {
                this.screens.addTarget('pc', this.room.pc, () => this.room.pcPose());
            }
            // const hb = new Hitboxes();
            // this.cursor = new Cursor();
            this.warming = this.warmUp();
            void this.warming.then(async () => {
                this.warming = null;
                // the room is drawn in the next frame
                await afterFrame();
                reportStage('homepage', 'ready', 1);
            });
        });
        // the hybrid loading screen (the default), after the build handler
        // above so its own 'ready' handler runs second
        if (loaderVariant() === 'hybrid') {
            const intro = new PipelineIntro({
                onRelease: (catchUpMs) => UIEventBus.dispatch('hybrid:workDone', { catchUpMs }),
            });
            this.intro = intro;
            // the camera boots on the terminal screen the log is written on
            new M3Dock();
            // warmUp keeps drawing the stages, and compiles the real materials
            this.drawWhileWarming = true;
            this.warmUpSwap = () => intro.swapReal();
        }
    }

    // while the loading screen is up, the room's textures go to the gpu a
    // frame at a time and its programs compile in parallel (compileAsync),
    // instead of all in the first frame it's drawn: that frame held the
    // main thread for about a second. Application skips drawing until then
    async warmUp() {
        const renderer = this.application.renderer.instance;
        try {
            const textures = new Set<THREE.Texture>([
                ...Object.values(this.resources.items.texture),
                ...Object.values(this.resources.items.cubeTexture),
            ]);
            this.scene.traverse((child) => {
                const mesh = child as THREE.Mesh;
                if (!mesh.isMesh || !mesh.visible) return;
                const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                materials.forEach((material) =>
                    Object.values(material).forEach((value) => {
                        if (value instanceof THREE.Texture) textures.add(value);
                    })
                );
            });
            let uploaded = 0;
            for (const texture of textures) {
                reportStage('homepage', 'upload', uploaded++ / textures.size);
                await afterFrame();
                renderer.initTexture(texture);
            }
            reportStage('homepage', 'compile', 0);
            // compileAsync gathers its materials right away, so a swap only
            // needs to last for the call
            const restore = this.warmUpSwap?.();
            const compiling = renderer.compileAsync(this.scene, this.application.camera.instance);
            restore?.();
            await Promise.race([
                compiling,
                new Promise((resolve) => window.setTimeout(resolve, COMPILE_WAIT_MS)),
            ]);
        } catch (error) {
            console.warn('[World] warm up', error);
        }
    }

    bindRaceManagerLoader() {
        [
            'raceMode:start',
            'race:multiplayerPlaySolo',
            'race:multiplayerCreateLobby',
            'race:multiplayerJoinLobby',
        ].forEach((event) => {
            UIEventBus.on(event, (payload: unknown) => {
                if (this.raceManager) {
                    return;
                }

                this.pendingRaceAction = { event, payload };
                // a failure is logged and the next press tries again
                this.ensureRaceManager().catch(() => (this.pendingRaceAction = null));
            });
        });
    }

    // the race code and its track data, downloaded but nothing built yet
    loadRace() {
        if (!this.raceLoading) {
            // chrome starts its audio service with the first AudioContext,
            // which then blocks for 100 to 150 ms, and race audio makes that
            // context in the car click. listing the devices starts the
            // service in the background, so the click doesn't pay for it
            void navigator.mediaDevices?.enumerateDevices?.().catch(() => undefined);
            reportStage('race', 'download', 0);
            this.raceLoading = Promise.all([
                import('../Racing/RaceManager'),
                import('../Racing/slicing'),
                this.resources.loadExtra(raceSources),
            ]);
            this.raceLoading.then(
                () => reportStage('race', 'download', 1),
                () => (this.raceLoading = null)
            );
        }
        return this.raceLoading;
    }

    // capable desktops on a fast connection fetch the race once the room is
    // up and the camera's intro is over, so the car click never waits on the
    // network. phones, slow or metered connections wait for the hover
    prefetchRaceWhenIdle() {
        const connection = (navigator as Navigator & {
            connection?: { saveData?: boolean; effectiveType?: string };
        }).connection;
        if (connection?.saveData) return;
        if (connection?.effectiveType && connection.effectiveType !== '4g') return;
        if (isLowPowerDevice()) return;
        const load = () => void this.loadRace().catch(() => undefined);
        window.setTimeout(() => {
            if (typeof window.requestIdleCallback === 'function') {
                window.requestIdleCallback(load, { timeout: 5000 });
            } else {
                load();
            }
        }, RACE_PREFETCH_DELAY_MS);
    }

    async ensureRaceManager() {
        if (this.raceManager) {
            return this.raceManager;
        }

        if (!this.raceManagerLoading) {
            // the race code and its track data come down together, then the
            // world is built a slice a frame, so the page keeps moving
            this.raceManagerLoading = this.loadRace().then(async ([{ default: RaceManagerClass }, { slice }]) => {
                reportStage('race', 'build', 0);
                const manager = new RaceManagerClass(true);
                await this.application.renderer.holdResolution(slice(manager.pending));
                this.raceManager = manager;
                reportStage('race', 'build', 1);
                return manager;
            });
            // a failed download (offline, or a deploy replaced the chunks)
            // can be tried again on the next hover or click
            this.raceManagerLoading.catch((error) => {
                console.error('[World] race mode failed to load', error);
                this.raceManagerLoading = null;
            });
        }

        const manager = await this.raceManagerLoading;
        const pending = this.pendingRaceAction;
        this.pendingRaceAction = null;
        if (pending) {
            window.setTimeout(() => {
                UIEventBus.dispatch(pending.event, pending.payload);
            }, 0);
        }
        return manager;
    }

    update() {
        this.screens.update();
        if (this.coffeeSteam) this.coffeeSteam.update();
        if (this.flipper) this.flipper.update();
        if (this.raceManager) this.raceManager.update();
    }
}
