import * as THREE from 'three';
import Application from '../../Application';
import UIEventBus from '../../UI/EventBus';
import RaceVehicle from '../Vehicle/RaceVehicle';

const MOUSE_SENSITIVITY_X = 0.0022;
const MOUSE_SENSITIVITY_Y = 0.0016;
const MIN_PITCH = -0.35;
const MAX_PITCH = 0.28;
const BASE_FOV = 48;
const MAX_FOV = 62;
const MIN_CAMERA_DISTANCE = 11.4;
const MAX_CAMERA_DISTANCE = 21;
const SHAKE_SPEED_START = 22;
const RACE_CAMERA_NEAR = 0.18;
const RACE_CAMERA_FAR = 20000;
const DRIFT_SHAKE_SCALE = 0.5;
const CLOSE_CAMERA_NEAR = 0.32;
const CAMERA_BODY_CLEARANCE = 2.8;
const CAMERA_BODY_CLEARANCE_SMOOTH = 2.6;
const POINTER_LOCK_PENDING_TIMEOUT_MS = 650;

export default class RaceChaseCamera {
    application: Application;
    vehicle: RaceVehicle;
    active: boolean;
    paused: boolean;
    pointerLocked: boolean;
    pointerLockRequestPending: boolean;
    yawOffset: number;
    pitchOffset: number;
    smoothPosition: THREE.Vector3;
    smoothLookAt: THREE.Vector3;
    defaultFov: number;
    defaultNear: number;
    defaultFar: number;
    shakeTime: number;
    tmpUp: THREE.Vector3;
    tmpForward: THREE.Vector3;
    tmpSide: THREE.Vector3;
    tmpOffset: THREE.Vector3;
    tmpAnchor: THREE.Vector3;
    tmpToCamera: THREE.Vector3;
    keyDownHandler: (event: KeyboardEvent) => void;
    mouseDownHandler: (event: MouseEvent) => void;
    mouseMoveHandler: (event: MouseEvent) => void;
    pointerLockChangeHandler: () => void;
    pointerLockErrorHandler: () => void;
    blurHandler: () => void;
    pointerLockPendingTimeoutId: number | null;

    constructor(vehicle: RaceVehicle) {
        this.application = new Application();
        this.vehicle = vehicle;
        this.active = false;
        this.paused = false;
        this.pointerLocked = false;
        this.pointerLockRequestPending = false;
        this.yawOffset = 0;
        this.pitchOffset = 0.1;

        this.smoothPosition = new THREE.Vector3();
        this.smoothLookAt = new THREE.Vector3();
        this.defaultFov = this.application.camera.instance.fov;
        this.defaultNear = this.application.camera.instance.near;
        this.defaultFar = this.application.camera.instance.far;
        this.shakeTime = 0;

        this.tmpUp = new THREE.Vector3();
        this.tmpForward = new THREE.Vector3();
        this.tmpSide = new THREE.Vector3();
        this.tmpOffset = new THREE.Vector3();
        this.tmpAnchor = new THREE.Vector3();
        this.tmpToCamera = new THREE.Vector3();
        this.pointerLockPendingTimeoutId = null;

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
            if (event.button !== 0) return;

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
            this.clearPointerLockPendingTimeout();
            const element = this.application.renderer.instance.domElement;
            this.pointerLockRequestPending = false;
            this.pointerLocked = document.pointerLockElement === element;
            UIEventBus.dispatch('race:pointerLockChanged', {
                locked: this.pointerLocked,
            });
            if (!this.pointerLocked) {
                UIEventBus.dispatch('race:inputReset', {
                    source: 'pointerLockChange',
                });
            }
        };

        this.pointerLockErrorHandler = () => {
            this.clearPointerLockPendingTimeout();
            this.pointerLockRequestPending = false;
            this.pointerLocked = false;
            UIEventBus.dispatch('race:pointerLockChanged', {
                locked: false,
            });
            UIEventBus.dispatch('race:inputReset', {
                source: 'pointerLockError',
            });
        };

        this.blurHandler = () => {
            UIEventBus.dispatch('race:inputReset', {
                source: 'windowBlur',
            });
        };

        document.addEventListener('keydown', this.keyDownHandler);
        document.addEventListener('mousedown', this.mouseDownHandler);
        document.addEventListener('mousemove', this.mouseMoveHandler);
        document.addEventListener(
            'pointerlockchange',
            this.pointerLockChangeHandler
        );
        document.addEventListener(
            'pointerlockerror',
            this.pointerLockErrorHandler
        );
        window.addEventListener('blur', this.blurHandler);

        UIEventBus.on('race:requestPointerLock', () => {
            if (!this.active || this.paused) return;
            this.requestPointerLock();
        });
    }

    requestPointerLock() {
        if (!this.active || this.paused || this.pointerLockRequestPending) return;
        const canvas = this.application.renderer.instance.domElement;
        if (
            !canvas ||
            !canvas.isConnected ||
            !document.hasFocus() ||
            document.pointerLockElement === canvas ||
            document.pointerLockElement !== null
        ) {
            return;
        }

        if (canvas.requestPointerLock) {
            try {
                this.pointerLockRequestPending = true;
                this.clearPointerLockPendingTimeout();
                const maybePromise = canvas.requestPointerLock();
                const pointerLockPromise = maybePromise as Promise<void> | undefined;

                if (
                    pointerLockPromise &&
                    typeof pointerLockPromise.catch === 'function'
                ) {
                    pointerLockPromise
                        .catch((error) => {
                            if (this.isExpectedPointerLockAbort(error)) {
                                return;
                            }
                            console.warn(
                                '[Race] Pointer lock request failed',
                                error
                            );
                            UIEventBus.dispatch('race:pointerLockChanged', {
                                locked: false,
                            });
                        })
                        .finally(() => {
                            this.pointerLockRequestPending = false;
                            this.clearPointerLockPendingTimeout();
                        });
                } else {
                    this.pointerLockPendingTimeoutId = window.setTimeout(() => {
                        this.pointerLockPendingTimeoutId = null;
                        this.pointerLockRequestPending = false;
                    }, POINTER_LOCK_PENDING_TIMEOUT_MS);
                }
            } catch (error) {
                this.pointerLockRequestPending = false;
                this.clearPointerLockPendingTimeout();
                if (!this.isExpectedPointerLockAbort(error)) {
                    console.warn('[Race] Pointer lock request failed', error);
                }
                UIEventBus.dispatch('race:pointerLockChanged', {
                    locked: false,
                });
                UIEventBus.dispatch('race:inputReset', {
                    source: 'pointerLockRequestError',
                });
            }
        }
    }

    isExpectedPointerLockAbort(error: unknown) {
        if (!error) return false;
        const message = (
            (error as { message?: string }).message || String(error)
        ).toLowerCase();
        return (
            message.includes('exited the lock before this request was completed') ||
            message.includes('user has exited the lock') ||
            message.includes('request is not allowed') ||
            message.includes('aborted') ||
            message.includes('not active')
        );
    }

    exitPointerLock() {
        this.pointerLockRequestPending = false;
        this.clearPointerLockPendingTimeout();
        if (document.pointerLockElement) {
            document.exitPointerLock();
        }
    }

    clearPointerLockPendingTimeout() {
        if (this.pointerLockPendingTimeoutId === null) return;
        window.clearTimeout(this.pointerLockPendingTimeoutId);
        this.pointerLockPendingTimeoutId = null;
    }

    setActive(active: boolean) {
        this.active = active;
        if (active) {
            this.shakeTime = 0;
            this.application.camera.instance.near = RACE_CAMERA_NEAR;
            this.application.camera.instance.far = RACE_CAMERA_FAR;
            this.application.camera.instance.fov = BASE_FOV;
            this.application.camera.instance.updateProjectionMatrix();
            return;
        }

        if (!active) {
            this.exitPointerLock();
            this.pointerLocked = false;
            this.pointerLockRequestPending = false;
            this.clearPointerLockPendingTimeout();
            this.yawOffset = 0;
            this.pitchOffset = 0.1;
            this.shakeTime = 0;
            this.application.camera.instance.near = this.defaultNear;
            this.application.camera.instance.far = this.defaultFar;
            this.application.camera.instance.fov = this.defaultFov;
            this.application.camera.instance.updateProjectionMatrix();
            UIEventBus.dispatch('race:inputReset', {
                source: 'setInactive',
            });
            UIEventBus.dispatch('race:pointerLockChanged', { locked: false });
        }
    }

    setPaused(paused: boolean) {
        this.paused = paused;
        if (paused) {
            this.exitPointerLock();
            this.pointerLockRequestPending = false;
            this.clearPointerLockPendingTimeout();
            UIEventBus.dispatch('race:inputReset', {
                source: 'setPaused',
            });
            this.application.camera.instance.fov = BASE_FOV;
            this.application.camera.instance.updateProjectionMatrix();
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

        this.tmpAnchor.copy(this.vehicle.getCameraAnchor());
        const followDistanceOffset = this.vehicle.getCameraFollowDistanceOffset();
        const minDistance = MIN_CAMERA_DISTANCE + followDistanceOffset;
        const maxDistance = MAX_CAMERA_DISTANCE + followDistanceOffset;

        const armDistance = THREE.MathUtils.clamp(
            9.4 + speed * 0.12 + followDistanceOffset,
            minDistance,
            maxDistance
        );
        const armHeight = THREE.MathUtils.clamp(4 + speed * 0.03, 4, 8);

        this.tmpOffset
            .copy(this.tmpForward)
            .multiplyScalar(-armDistance)
            .addScaledVector(this.tmpUp, armHeight)
            .applyAxisAngle(this.tmpSide, this.pitchOffset);

        const targetPosition = this.tmpAnchor.clone().add(this.tmpOffset);
        const targetLookAt = this.tmpAnchor
            .clone()
            .addScaledVector(this.tmpForward, 9 + speed * 0.06)
            .addScaledVector(this.tmpUp, 1.2);

        this.tmpToCamera.subVectors(targetPosition, this.tmpAnchor);
        const distance = this.tmpToCamera.length();
        if (distance > 0.0001) {
            this.tmpToCamera.normalize();
            const safeDistance = Math.max(
                minDistance,
                this.vehicle.getCameraBodyRadius() + CAMERA_BODY_CLEARANCE
            );
            const clampedDistance = THREE.MathUtils.clamp(
                distance,
                safeDistance,
                maxDistance
            );
            targetPosition.copy(this.tmpAnchor).addScaledVector(
                this.tmpToCamera,
                clampedDistance
            );
        }

        const smoothFactor = THREE.MathUtils.clamp(deltaSeconds * 8, 0, 1);
        this.smoothPosition.lerp(targetPosition, smoothFactor);
        this.smoothLookAt.lerp(targetLookAt, smoothFactor);

        this.tmpToCamera.subVectors(this.smoothPosition, this.tmpAnchor);
        const smoothDistance = this.tmpToCamera.length();
        const minSafeDistance = Math.max(
            minDistance,
            this.vehicle.getCameraBodyRadius() + CAMERA_BODY_CLEARANCE_SMOOTH
        );
        if (smoothDistance > 0.0001 && smoothDistance < minSafeDistance) {
            this.tmpToCamera.normalize();
            this.smoothPosition
                .copy(this.tmpAnchor)
                .addScaledVector(this.tmpToCamera, minSafeDistance);
        }

        const closeFollow = THREE.MathUtils.clamp(
            (smoothDistance - minSafeDistance) / 4,
            0,
            1
        );
        this.application.camera.instance.near = THREE.MathUtils.lerp(
            CLOSE_CAMERA_NEAR,
            RACE_CAMERA_NEAR,
            closeFollow
        );

        const targetFov = this.paused
            ? BASE_FOV
            : THREE.MathUtils.lerp(
                  BASE_FOV,
                  MAX_FOV,
                  THREE.MathUtils.clamp((speed - 20) / 120, 0, 1)
              );
        this.application.camera.instance.fov = THREE.MathUtils.lerp(
            this.application.camera.instance.fov,
            targetFov,
            THREE.MathUtils.clamp(deltaSeconds * 5.5, 0, 1)
        );
        this.application.camera.instance.updateProjectionMatrix();

        this.shakeTime += deltaSeconds * (1 + speed * 0.045);
        const speedShake = THREE.MathUtils.clamp(
            (speed - SHAKE_SPEED_START) / 105,
            0,
            1
        );
        const driftShake = THREE.MathUtils.clamp(telemetry.driftIntensity, 0, 1);
        const shakeAmount =
            (speedShake * 0.085 + driftShake * 0.055) *
            DRIFT_SHAKE_SCALE *
            (this.paused ? 0 : 1);
        if (shakeAmount > 0.0001) {
            const shakeSide =
                Math.sin(this.shakeTime * 17.4) * shakeAmount * 0.42;
            const shakeUp =
                Math.sin(this.shakeTime * 23.8 + 0.7) * shakeAmount * 0.28;
            this.smoothPosition
                .addScaledVector(this.tmpSide, shakeSide)
                .addScaledVector(this.tmpUp, shakeUp);
            this.smoothLookAt
                .addScaledVector(this.tmpSide, shakeSide * 0.45)
                .addScaledVector(this.tmpUp, shakeUp * 0.3);
        }

        this.application.camera.instance.position.copy(this.smoothPosition);
        this.application.camera.instance.lookAt(this.smoothLookAt);
    }
}
