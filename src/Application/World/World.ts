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
import Flipper from './Flipper';
import UIEventBus from '../UI/EventBus';
import type RaceManager from '../Racing/RaceManager';

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
    flipper: Flipper;
    raceManager: RaceManager | null;
    raceManagerLoading: Promise<RaceManager> | null;
    pendingRaceAction: RaceAction | null;

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
            // Setup
            this.environment = new Environment();
            this.decor = new Decor();
            this.computerSetup = new ComputerSetup();
            this.monitorScreen = new MonitorScreen();
            this.coffeeSteam = new CoffeeSteam();
            this.car = new Car();
            this.flipper = new Flipper();
            // const hb = new Hitboxes();
            // this.cursor = new Cursor();
        });
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
            this.raceManagerLoading = import('../Racing/RaceManager').then(
                ({ default: RaceManagerClass }) => {
                    this.raceManager = new RaceManagerClass();
                    return this.raceManager;
                }
            );
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
