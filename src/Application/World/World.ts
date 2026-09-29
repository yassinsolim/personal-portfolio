import * as THREE from 'three';
import Application from '../Application';
import Resources from '../Utils/Resources';
import ComputerSetup from './Computer';
import MonitorScreen from './MonitorScreen';
import Environment from './Environment';
import Decor from './Decor';
import CoffeeSteam from './CoffeeSteam';
import Cursor from './Cursor';
import Hitboxes from './Hitboxes';
import Car from './Car';
import RaceTransition from './RaceTransition';
import Flipper from './Flipper';
import UIEventBus from '../UI/EventBus';
import type RaceManager from '../Racing/RaceManager';
import MonitorIntro from './intro/MonitorIntro';
import PipelineIntro from './intro/PipelineIntro';
import { loaderVariant } from '../UI/loaders/variant';

type RaceAction = {
    event: string;
    payload: unknown;
};

export default class World {
    application: Application;
    scene: THREE.Scene;
    resources: Resources;

    // Objects in the scene
    environment: Environment;
    decor: Decor;
    computerSetup: ComputerSetup;
    monitorScreen: MonitorScreen;
    coffeeSteam: CoffeeSteam;
    cursor: Cursor;
    car: Car;
    raceTransition: RaceTransition;
    flipper: Flipper;
    raceManager: RaceManager | null;
    raceManagerLoading: Promise<RaceManager> | null;
    pendingRaceAction: RaceAction | null;
    // the loading screen's part in the room, for the prototypes that have one
    intro: MonitorIntro | PipelineIntro | null = null;

    constructor() {
        this.application = new Application();
        this.scene = this.application.scene;
        this.resources = this.application.resources;
        this.raceManager = null;
        this.raceManagerLoading = null;
        this.pendingRaceAction = null;
        this.bindRaceManagerLoader();
        // Wait for resources
        this.resources.on('ready', () => {
            const loading = this.application.loading;
            loading.stageStart('build');
            // Setup
            this.environment = new Environment();
            this.decor = new Decor();
            this.computerSetup = new ComputerSetup();
            this.monitorScreen = new MonitorScreen();
            this.coffeeSteam = new CoffeeSteam();
            this.car = new Car();
            this.raceTransition = new RaceTransition();
            this.flipper = new Flipper();
            // const hb = new Hitboxes();
            // this.cursor = new Cursor();
            let meshes = 0;
            this.scene.traverse((child) => {
                if ((child as THREE.Mesh).isMesh) meshes++;
            });
            loading.stageDone('build', meshes);
        });
        // after the build handler above, so the intro's own 'ready' runs second
        const variant = loaderVariant();
        if (variant === 'monitor') this.intro = new MonitorIntro();
        if (variant === 'pipeline') this.intro = new PipelineIntro();
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
                void this.ensureRaceManager();
            });
        });
    }

    async ensureRaceManager() {
        if (this.raceManager) {
            return this.raceManager;
        }

        if (!this.raceManagerLoading) {
            // built a slice a frame, so the page keeps moving
            this.raceManagerLoading = Promise.all([
                import('../Racing/RaceManager'),
                import('../Racing/slicing'),
            ]).then(async ([{ default: RaceManagerClass }, { slice }]) => {
                const manager = new RaceManagerClass(true);
                await this.application.renderer.holdResolution(slice(manager.pending));
                this.raceManager = manager;
                return manager;
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
        if (this.monitorScreen) this.monitorScreen.update();
        if (this.environment) this.environment.update();
        if (this.coffeeSteam) this.coffeeSteam.update();
        if (this.raceManager) this.raceManager.update();
    }
}
