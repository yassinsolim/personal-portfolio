import * as THREE from 'three';
import Application from '../../Application';
import UIEventBus from '../../UI/EventBus';
import RaceVehicle from '../Vehicle/RaceVehicle';

const MOUSE_SENSITIVITY_X = 0.0022;
const MOUSE_SENSITIVITY_Y = 0.0016;
const MIN_PITCH = -0.35;
const MAX_PITCH = 0.28;

export default class RaceChaseCamera {
    application: Application;
    vehicle: RaceVehicle;
    active: boolean;
    paused: boolean;
    pointerLocked: boolean;
    yawOffset: number;
    pitchOffset: number;
    smoothPosition: THREE.Vector3;
    smoothLookAt: THREE.Vector3;
    tmpUp: THREE.Vector3;
    tmpForward: THREE.Vector3;
    tmpSide: THREE.Vector3;
    tmpOffset: THREE.Vector3;
    keyDownHandler: (event: KeyboardEvent) => void;
    mouseDownHandler: (event: MouseEvent) => void;
    mouseMoveHandler: (event: MouseEvent) => void;
    pointerLockChangeHandler: () => void;

    constructor(vehicle: RaceVehicle) {
        this.application = new Application();
        this.vehicle = vehicle;
        this.active = false;
        this.paused = false;
        this.pointerLocked = false;
        this.yawOffset = 0;
        this.pitchOffset = 0.1;

        this.smoothPosition = new THREE.Vector3();
        this.smoothLookAt = new THREE.Vector3();

        this.tmpUp = new THREE.Vector3();
        this.tmpForward = new THREE.Vector3();
        this.tmpSide = new THREE.Vector3();
        this.tmpOffset = new THREE.Vector3();

        this.keyDownHandler = (event: KeyboardEvent) => {
            if (!this.active) return;
            if (event.code !== 'Escape') return;
            if (this.paused) return;

            event.preventDefault();
            UIEventBus.dispatch('race:pauseRequest', {
                source: 'escape',
            });
        };

        this.mouseDownHandler = (event: MouseEvent) => {
            if (!this.active || this.paused || this.pointerLocked) return;

            const target = event.target as HTMLElement | null;
            if (
                target?.closest('#prevent-click') ||
                target?.closest('[data-prevent-click]')
            ) {
                return;
            }

            this.requestPointerLock();
        };

        this.mouseMoveHandler = (event: MouseEvent) => {
            if (!this.active || !this.pointerLocked) return;

            this.yawOffset -= event.movementX * MOUSE_SENSITIVITY_X;
            this.pitchOffset += event.movementY * MOUSE_SENSITIVITY_Y;
            this.pitchOffset = THREE.MathUtils.clamp(
                this.pitchOffset,
                MIN_PITCH,
                MAX_PITCH
            );
        };

        this.pointerLockChangeHandler = () => {
            const element = this.application.renderer.instance.domElement;
            this.pointerLocked = document.pointerLockElement === element;
            UIEventBus.dispatch('race:pointerLockChanged', {
                locked: this.pointerLocked,
            });
        };

        document.addEventListener('keydown', this.keyDownHandler);
        document.addEventListener('mousedown', this.mouseDownHandler);
        document.addEventListener('mousemove', this.mouseMoveHandler);
        document.addEventListener(
            'pointerlockchange',
            this.pointerLockChangeHandler
        );

        UIEventBus.on('race:requestPointerLock', () => {
            if (!this.active || this.paused) return;
            this.requestPointerLock();
        });
    }

    requestPointerLock() {
        const canvas = this.application.renderer.instance.domElement;
        if (canvas.requestPointerLock) {
            canvas.requestPointerLock();
        }
    }

    exitPointerLock() {
        if (document.pointerLockElement) {
            document.exitPointerLock();
        }
    }

    setActive(active: boolean) {
        this.active = active;
        if (!active) {
            this.exitPointerLock();
            this.pointerLocked = false;
            this.yawOffset = 0;
            this.pitchOffset = 0.1;
            UIEventBus.dispatch('race:pointerLockChanged', { locked: false });
        }
    }

    setPaused(paused: boolean) {
        this.paused = paused;
        if (paused) {
            this.exitPointerLock();
        }
    }

    update(deltaSeconds: number) {
        if (!this.active) return;

        const telemetry = this.vehicle.getTelemetry();
        const speed = Math.abs(telemetry.speedMps);

        this.tmpForward
            .set(0, 0, 1)
            .applyQuaternion(telemetry.quaternion)
            .normalize();
        this.tmpUp.set(0, 1, 0).applyQuaternion(telemetry.quaternion).normalize();
        this.tmpSide.crossVectors(this.tmpUp, this.tmpForward).normalize();

        this.tmpForward.applyAxisAngle(this.tmpUp, this.yawOffset).normalize();

        const armDistance = THREE.MathUtils.clamp(9 + speed * 0.12, 9, 20);
        const armHeight = THREE.MathUtils.clamp(4 + speed * 0.03, 4, 8);

        this.tmpOffset
            .copy(this.tmpForward)
            .multiplyScalar(-armDistance)
            .addScaledVector(this.tmpUp, armHeight)
            .applyAxisAngle(this.tmpSide, this.pitchOffset);

        const targetPosition = telemetry.position.clone().add(this.tmpOffset);
        const targetLookAt = telemetry.position
            .clone()
            .addScaledVector(this.tmpForward, 10)
            .addScaledVector(this.tmpUp, 2);

        const smoothFactor = THREE.MathUtils.clamp(deltaSeconds * 8, 0, 1);
        this.smoothPosition.lerp(targetPosition, smoothFactor);
        this.smoothLookAt.lerp(targetLookAt, smoothFactor);

        this.application.camera.instance.position.copy(this.smoothPosition);
        this.application.camera.instance.lookAt(this.smoothLookAt);
    }
}

