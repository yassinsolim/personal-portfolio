import * as THREE from 'three';
import Application from '../Application';
import UIEventBus from '../UI/EventBus';
import Camera, { CameraKey } from '../Camera/Camera';
import Time from '../Utils/Time';
import Car from './Car';
import RaceTrack from './RaceTrack';
import AudioManager from '../Audio/AudioManager';
import EngineAudio from '../Audio/EngineAudio';

type DriveView = 'first' | 'third';

const GEAR_RATIOS = [3.15, 2.1, 1.55, 1.2, 1.0, 0.82];
const FINAL_DRIVE = 3.4;
const REVERSE_RATIO = 3.0;
const WHEEL_RADIUS = 0.34;

const IDLE_RPM = 900;
const REDLINE_RPM = 7200;
const UPSHIFT_RPM = 6400;
const DOWNSHIFT_RPM = 2100;

const MAX_SPEED = 78;
const MAX_REVERSE_SPEED = 22;
const ACCELERATION = 18;
const BRAKE_DECEL = 30;
const COAST_DECEL = 6;
const MAX_STEER = THREE.MathUtils.degToRad(32);
const STEER_RESPONSE = 6;
const CAMERA_LAG = 7;

const FIRST_PERSON_OFFSET = new THREE.Vector3(0.32, 1.05, 0.35);
const THIRD_PERSON_OFFSET = new THREE.Vector3(0, 3.1, -8.8);
const FIRST_PERSON_LOOK_AHEAD = 6;
const THIRD_PERSON_LOOK_AHEAD = 14;

const START_LIGHTS_COUNT = 5;
const START_LIGHT_INTERVAL = 1;
const START_LIGHT_MIN_HOLD = 0.2;
const START_LIGHT_MAX_HOLD = 3;
const START_LIGHT_GO_DURATION = 0.8;

export default class DriveController {
    application: Application;
    time: Time;
    camera: Camera;
    car: Car;
    track: RaceTrack;
    audio: AudioManager;
    engineAudio: EngineAudio;

    active: boolean;
    pendingEnter: boolean;
    viewMode: DriveView;
    input: { forward: boolean; backward: boolean; left: boolean; right: boolean };
    speed: number;
    rpm: number;
    gear: number;
    steer: number;
    unitsPerMeter: number;
    groundOffset: number;
    controlsEnabled: boolean;
    startSequenceActive: boolean;
    startLightsOn: number;
    startElapsed: number;
    startHoldDuration: number;
    startHoldElapsed: number;
    startGoActive: boolean;
    startGoElapsed: number;

    cameraPosition: THREE.Vector3;
    cameraTarget: THREE.Vector3;
    desiredCameraPosition: THREE.Vector3;
    desiredCameraTarget: THREE.Vector3;
    forward: THREE.Vector3;
    hudTimer: number;

    constructor(car: Car, track: RaceTrack, audio: AudioManager) {
        this.application = new Application();
        this.time = this.application.time;
        this.camera = this.application.camera;
        this.car = car;
        this.track = track;
        this.audio = audio;
        const currentOption = this.car.getCurrentCarOption();
        this.engineAudio = new EngineAudio(
            audio,
            currentOption?.engineSound.low || 'engineLoop2',
            currentOption?.engineSound.high || 'engineLoop3'
        );

        this.active = false;
        this.pendingEnter = false;
        this.viewMode = 'third';
        this.input = { forward: false, backward: false, left: false, right: false };
        this.speed = 0;
        this.rpm = IDLE_RPM;
        this.gear = 1;
        this.steer = 0;
        this.unitsPerMeter = this.car.sceneUnitsPerMeter || 25;
        this.groundOffset = 0;
        this.controlsEnabled = true;
        this.startSequenceActive = false;
        this.startLightsOn = 0;
        this.startElapsed = 0;
        this.startHoldDuration = 0;
        this.startHoldElapsed = 0;
        this.startGoActive = false;
        this.startGoElapsed = 0;

        this.cameraPosition = new THREE.Vector3();
        this.cameraTarget = new THREE.Vector3();
        this.desiredCameraPosition = new THREE.Vector3();
        this.desiredCameraTarget = new THREE.Vector3();
        this.forward = new THREE.Vector3();
        this.hudTimer = 0;

        this.bindEvents();
    }

    bindEvents() {
        UIEventBus.on('driveEnter', () => {
            this.enterDrive();
        });
        UIEventBus.on('driveExit', () => {
            this.exitDrive();
        });
        UIEventBus.on('driveViewToggle', (payload: { mode?: DriveView }) => {
            if (!this.active) return;
            const next =
                payload?.mode ||
                (this.viewMode === 'third' ? 'first' : 'third');
            this.viewMode = next;
            this.snapCameraToCar();
            UIEventBus.dispatch('driveView', { mode: this.viewMode });
        });

        document.addEventListener('keydown', (event) => {
            // @ts-ignore
            if (event.inComputer) return;
            if (event.code === 'Escape' && this.active) {
                this.exitDrive();
                return;
            }
            if (!this.active || event.repeat) return;
            switch (event.code) {
                case 'KeyW':
                    this.input.forward = true;
                    break;
                case 'KeyS':
                    this.input.backward = true;
                    break;
                case 'KeyA':
                    this.input.left = true;
                    break;
                case 'KeyD':
                    this.input.right = true;
                    break;
                default:
                    break;
            }
        });

        document.addEventListener('keyup', (event) => {
            // @ts-ignore
            if (event.inComputer) return;
            if (!this.active) return;
            switch (event.code) {
                case 'KeyW':
                    this.input.forward = false;
                    break;
                case 'KeyS':
                    this.input.backward = false;
                    break;
                case 'KeyA':
                    this.input.left = false;
                    break;
                case 'KeyD':
                    this.input.right = false;
                    break;
                default:
                    break;
            }
        });

        window.addEventListener('blur', () => {
            this.resetInput();
        });
    }

    canEnter() {
        return Boolean(this.car.model && this.track.ready);
    }

    enterDrive() {
        if (this.active) return;
        if (!this.canEnter()) {
            this.pendingEnter = true;
            return;
        }

        this.pendingEnter = false;
        this.active = true;
        this.unitsPerMeter = this.car.sceneUnitsPerMeter || 25;
        this.resetInput();
        this.controlsEnabled = false;

        this.car.setDriveMode(true);

        const carModel = this.car.model;
        const carOption = this.car.getCurrentCarOption();
        if (carOption?.engineSound) {
            this.engineAudio.setSoundSet(
                carOption.engineSound.low,
                carOption.engineSound.high
            );
        }
        if (carModel) {
            this.car.captureDeskTransform();
            const start = this.track.getStartTransform();
            carModel.position.copy(start.position);
            this.alignCarToDirection(start.direction);
            this.setCarOnGround();
            carModel.updateMatrixWorld(true);
            this.engineAudio.attachTo(carModel);
        }

        this.speed = 0;
        this.rpm = IDLE_RPM;
        this.gear = 1;
        this.steer = 0;
        this.viewMode = 'third';

        this.camera.setDriveMode(true);
        this.snapCameraToCar();
        UIEventBus.dispatch('driveMode', { active: true });
        UIEventBus.dispatch('driveView', { mode: this.viewMode });
        this.engineAudio.start();
        this.startSequence();
    }

    exitDrive() {
        if (!this.active) return;
        this.active = false;
        this.pendingEnter = false;
        this.resetInput();
        this.stopSequence();
        this.engineAudio.stop();

        this.car.restoreDeskTransform();
        this.car.setDriveMode(false);

        this.camera.setDriveMode(false);
        this.camera.transition(CameraKey.DESK, 900);

        UIEventBus.dispatch('driveMode', { active: false });
    }

    resetInput() {
        this.input.forward = false;
        this.input.backward = false;
        this.input.left = false;
        this.input.right = false;
    }

    startSequence() {
        this.startSequenceActive = true;
        this.controlsEnabled = false;
        this.startElapsed = 0;
        this.startLightsOn = 0;
        this.startHoldDuration =
            START_LIGHT_MIN_HOLD +
            Math.random() * (START_LIGHT_MAX_HOLD - START_LIGHT_MIN_HOLD);
        this.startHoldElapsed = 0;
        this.startGoActive = false;
        this.startGoElapsed = 0;
        this.dispatchStartLights();
    }

    stopSequence() {
        this.startSequenceActive = false;
        this.controlsEnabled = false;
        this.startLightsOn = 0;
        this.startElapsed = 0;
        this.startHoldDuration = 0;
        this.startHoldElapsed = 0;
        this.startGoActive = false;
        this.startGoElapsed = 0;
        this.dispatchStartLights();
    }

    updateStartSequence(dt: number) {
        if (this.startSequenceActive) {
            this.startElapsed += dt;
            const lightsTarget = Math.min(
                START_LIGHTS_COUNT,
                Math.floor(this.startElapsed / START_LIGHT_INTERVAL)
            );
            if (lightsTarget !== this.startLightsOn) {
                this.startLightsOn = lightsTarget;
                this.dispatchStartLights();
            }

            if (this.startLightsOn >= START_LIGHTS_COUNT) {
                this.startHoldElapsed += dt;
                if (this.startHoldElapsed >= this.startHoldDuration) {
                    this.startSequenceActive = false;
                    this.controlsEnabled = true;
                    this.startLightsOn = 0;
                    this.startGoActive = true;
                    this.startGoElapsed = 0;
                    this.dispatchStartLights();
                }
            }
        }

        if (this.startGoActive) {
            this.startGoElapsed += dt;
            if (this.startGoElapsed >= START_LIGHT_GO_DURATION) {
                this.startGoActive = false;
                this.dispatchStartLights();
            }
        }
    }

    dispatchStartLights() {
        UIEventBus.dispatch('driveStartLights', {
            active: this.startSequenceActive,
            lightsOn: this.startLightsOn,
            go: this.startGoActive,
        });
    }

    alignCarToDirection(direction: THREE.Vector3) {
        const carModel = this.car.model;
        if (!carModel) return;
        const baseRotation = this.car.getDriveBaseRotation();
        const baseQuat = new THREE.Quaternion().setFromEuler(baseRotation);
        const modelForward = new THREE.Vector3(0, 0, 1)
            .applyQuaternion(baseQuat)
            .normalize();
        const desired = direction.clone();
        desired.y = 0;
        if (desired.lengthSq() > 0) {
            desired.normalize();
        }
        const alignQuat = new THREE.Quaternion().setFromUnitVectors(
            modelForward,
            desired
        );
        carModel.quaternion.copy(alignQuat.multiply(baseQuat));
    }

    setCarOnGround() {
        const carModel = this.car.model;
        if (!carModel) return;
        const bbox = new THREE.Box3().setFromObject(carModel);
        this.groundOffset = carModel.position.y - bbox.min.y;
        carModel.position.y = this.track.getGroundY() + this.groundOffset;
    }

    update() {
        if (this.pendingEnter && this.canEnter()) {
            this.enterDrive();
        }

        if (!this.active || !this.car.model) return;

        const dt = Math.min(this.time.delta / 1000, 0.05);
        this.updateStartSequence(dt);
        this.updatePhysics(dt);
        this.updateCamera(dt);
        this.updateHud(dt);
    }

    updatePhysics(dt: number) {
        const carModel = this.car.model;
        if (!carModel) return;

        const rawThrottle =
            (this.input.forward ? 1 : 0) + (this.input.backward ? -1 : 0);
        const throttle = this.controlsEnabled ? rawThrottle : 0;
        const soundThrottle = Math.max(rawThrottle, 0);
        const steerInput =
            (this.input.left ? 1 : 0) + (this.input.right ? -1 : 0);

        const steerLerp = 1 - Math.exp(-STEER_RESPONSE * dt);
        this.steer = THREE.MathUtils.lerp(this.steer, steerInput, steerLerp);

        if (throttle > 0) {
            this.speed += ACCELERATION * dt;
        } else if (throttle < 0) {
            if (this.speed > 0.5) {
                this.speed -= BRAKE_DECEL * dt;
            } else {
                this.speed -= ACCELERATION * dt;
            }
        } else {
            const decel = COAST_DECEL * dt;
            if (Math.abs(this.speed) <= decel) {
                this.speed = 0;
            } else {
                this.speed -= Math.sign(this.speed) * decel;
            }
        }

        this.speed = THREE.MathUtils.clamp(
            this.speed,
            -MAX_REVERSE_SPEED,
            MAX_SPEED
        );

        this.updateGearAndRpm(soundThrottle, dt);

        const steerScale = THREE.MathUtils.clamp(
            Math.abs(this.speed) / 10,
            0,
            1
        );
        const speedFactor = THREE.MathUtils.clamp(
            Math.abs(this.speed) / MAX_SPEED,
            0,
            1
        );
        const steerAmount =
            this.steer *
            MAX_STEER *
            steerScale *
            (1 - speedFactor * 0.6) *
            dt *
            (this.speed >= 0 ? 1 : -1);

        carModel.rotateY(steerAmount);

        carModel.getWorldDirection(this.forward);
        this.forward.y = 0;
        if (this.forward.lengthSq() > 0) {
            this.forward.normalize();
        }

        const travel = this.speed * dt * this.unitsPerMeter;
        carModel.position.addScaledVector(this.forward, travel);
        carModel.position.y = this.track.getGroundY() + this.groundOffset;

        this.engineAudio.update(this.rpm, soundThrottle);
    }

    updateGearAndRpm(throttle: number, dt: number) {
        const speedAbs = Math.abs(this.speed);

        if (this.speed < -0.5) {
            this.gear = 0;
        } else if (this.gear === 0 && throttle >= 0 && speedAbs < 0.5) {
            this.gear = 1;
        }

        const ratio =
            this.gear === 0
                ? REVERSE_RATIO
                : GEAR_RATIOS[Math.max(this.gear - 1, 0)] || GEAR_RATIOS[0];
        const wheelRps = speedAbs / (2 * Math.PI * WHEEL_RADIUS);
        let targetRpm = wheelRps * 60 * ratio * FINAL_DRIVE;

        if (this.gear !== 0 && throttle > 0 && speedAbs < 5) {
            targetRpm = Math.max(targetRpm, IDLE_RPM + throttle * 2600);
        }

        targetRpm = THREE.MathUtils.clamp(targetRpm, IDLE_RPM, REDLINE_RPM);
        const rpmLerp = 1 - Math.exp(-6 * dt);
        this.rpm = THREE.MathUtils.lerp(this.rpm, targetRpm, rpmLerp);

        if (this.gear !== 0) {
            if (this.rpm > UPSHIFT_RPM && this.gear < GEAR_RATIOS.length) {
                this.gear += 1;
            } else if (this.rpm < DOWNSHIFT_RPM && this.gear > 1) {
                this.gear -= 1;
            }
        }
    }

    updateCamera(dt: number) {
        const carModel = this.car.model;
        if (!carModel) return;

        const offset =
            this.viewMode === 'first'
                ? FIRST_PERSON_OFFSET
                : THIRD_PERSON_OFFSET;

        this.desiredCameraPosition.copy(offset);
        this.desiredCameraPosition.multiplyScalar(this.unitsPerMeter);
        this.desiredCameraPosition.applyQuaternion(carModel.quaternion);
        this.desiredCameraPosition.add(carModel.position);

        this.forward.set(0, 0, 1).applyQuaternion(carModel.quaternion);
        this.forward.y = 0;
        if (this.forward.lengthSq() > 0) {
            this.forward.normalize();
        }

        const lookAhead =
            this.viewMode === 'first'
                ? FIRST_PERSON_LOOK_AHEAD
                : THIRD_PERSON_LOOK_AHEAD;
        this.desiredCameraTarget.copy(carModel.position);
        this.desiredCameraTarget.addScaledVector(
            this.forward,
            lookAhead * this.unitsPerMeter
        );

        if (this.viewMode === 'first') {
            this.cameraPosition.copy(this.desiredCameraPosition);
            this.cameraTarget.copy(this.desiredCameraTarget);
        } else {
            const damp = 1 - Math.exp(-CAMERA_LAG * dt);
            this.cameraPosition.lerp(this.desiredCameraPosition, damp);
            this.cameraTarget.lerp(this.desiredCameraTarget, damp);
        }

        this.camera.setDriveView(this.cameraPosition, this.cameraTarget);
    }

    snapCameraToCar() {
        const carModel = this.car.model;
        if (!carModel) return;
        const offset =
            this.viewMode === 'first'
                ? FIRST_PERSON_OFFSET
                : THIRD_PERSON_OFFSET;
        this.desiredCameraPosition.copy(offset);
        this.desiredCameraPosition.multiplyScalar(this.unitsPerMeter);
        this.desiredCameraPosition.applyQuaternion(carModel.quaternion);
        this.desiredCameraPosition.add(carModel.position);

        this.forward.set(0, 0, 1).applyQuaternion(carModel.quaternion);
        this.forward.y = 0;
        if (this.forward.lengthSq() > 0) {
            this.forward.normalize();
        }
        const lookAhead =
            this.viewMode === 'first'
                ? FIRST_PERSON_LOOK_AHEAD
                : THIRD_PERSON_LOOK_AHEAD;
        this.desiredCameraTarget.copy(carModel.position);
        this.desiredCameraTarget.addScaledVector(
            this.forward,
            lookAhead * this.unitsPerMeter
        );

        this.cameraPosition.copy(this.desiredCameraPosition);
        this.cameraTarget.copy(this.desiredCameraTarget);
        this.camera.setDriveView(this.cameraPosition, this.cameraTarget);
    }

    updateHud(dt: number) {
        this.hudTimer += dt;
        if (this.hudTimer < 0.1) return;
        this.hudTimer = 0;
        const speedKph = Math.abs(this.speed) * 3.6;
        UIEventBus.dispatch('driveStats', {
            speedKph,
            gear: this.gear === 0 ? 'R' : this.gear,
            rpm: Math.round(this.rpm),
        });
    }
}
