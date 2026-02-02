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
import RaceTrack from './RaceTrack';
import DriveController from './DriveController';
import AudioManager from '../Audio/AudioManager';
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
    raceTrack: RaceTrack;
    driveController: DriveController;
    audio: AudioManager;

    constructor() {
        this.application = new Application();
        this.scene = this.application.scene;
        this.resources = this.application.resources;
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
            this.raceTrack = new RaceTrack(
                this.car.sceneUnitsPerMeter || 25
            );
            this.audio = new AudioManager();
            this.driveController = new DriveController(
                this.car,
                this.raceTrack,
                this.audio
            );
            // const hb = new Hitboxes();
            // this.cursor = new Cursor();
        });
    }

    update() {
        if (this.monitorScreen) this.monitorScreen.update();
        if (this.environment) this.environment.update();
        if (this.coffeeSteam) this.coffeeSteam.update();
        if (this.driveController) this.driveController.update();
        if (this.audio) this.audio.update();
    }
}
