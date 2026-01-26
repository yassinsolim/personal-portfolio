import * as THREE from 'three';
import Application from '../../Application';
import Resources from '../../Utils/Resources';
import UIEventBus from '../../UI/EventBus';
import DrivingInput from '../Input/DrivingInput';
import NordschleifeTrack from '../Track/NordschleifeTrack';
import { carOptionsById, getStoredCarId } from '../../carOptions';

const SPAWN_T = 0.003;
const MAX_FORWARD_SPEED = 95;
const MAX_REVERSE_SPEED = -18;
const FORWARD_ACCEL = 27;
const BRAKE_ACCEL = 44;
const REVERSE_ACCEL = 11;
const COAST_DECEL = 8;
const DRAG_COEFFICIENT = 0.015;
const HAND_BRAKE_DAMPING = 1.8;
const GRAVITY = 28;
const RIDE_HEIGHT = 2.2;
const RAYCAST_HEIGHT = 360;
const RAYCAST_DISTANCE = 1200;
const STEER_RATE_LOW = 0.6;
const STEER_RATE_HIGH = 2.0;
const WHEEL_RADIUS = 0.34;
const FINAL_DRIVE = 3.45;
const IDLE_RPM = 900;
const REDLINE_RPM = 7600;
const SHIFT_UP_RPM = 6900;
const SHIFT_DOWN_RPM = 2200;
const GEAR_RATIOS = [0, 3.4, 2.45, 1.95, 1.55, 1.24, 1.04];

type VehicleTelemetry = {
    speedMps: number;
    speedKph: number;
    gear: number;
    rpm: number;
    throttle: number;
    brake: number;
    handbrake: number;
    grounded: boolean;
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    forward: THREE.Vector3;
    carId: string;
};

export default class RaceVehicle {
    application: Application;
    resources: Resources;
    input: DrivingInput;
    track: NordschleifeTrack;
    colliderMesh: THREE.Mesh;
    raycaster: THREE.Raycaster;
    root: THREE.Group;
    carPivot: THREE.Group;
    carModel: THREE.Group | null;
    currentCarId: string;
    cachedModels: Map<string, THREE.Group>;
    loadingPromises: Map<string, Promise<THREE.Group>>;
    active: boolean;
    grounded: boolean;
    gear: number;
    rpm: number;
    speedMps: number;
    verticalVelocity: number;
    yaw: number;
    position: THREE.Vector3;
    surfaceNormal: THREE.Vector3;
    forward: THREE.Vector3;
    orientationTarget: THREE.Quaternion;
    tmpVectorA: THREE.Vector3;
    tmpVectorB: THREE.Vector3;
    tmpVectorC: THREE.Vector3;
    tmpMatrix: THREE.Matrix4;

    constructor(parent: THREE.Object3D, track: NordschleifeTrack) {
        this.application = new Application();
        this.resources = this.application.resources;
        this.track = track;
        this.colliderMesh = this.track.getColliderMesh();
        this.raycaster = new THREE.Raycaster();
        this.input = new DrivingInput();

        this.root = new THREE.Group();
        this.root.name = 'race-vehicle-root';
        this.carPivot = new THREE.Group();
        this.carPivot.name = 'race-vehicle-pivot';
        this.root.add(this.carPivot);
        parent.add(this.root);

        this.carModel = null;
        this.cachedModels = new Map();
        this.loadingPromises = new Map();
        this.currentCarId = getStoredCarId();

        this.active = false;
        this.grounded = false;
        this.gear = 1;
        this.rpm = IDLE_RPM;
        this.speedMps = 0;
        this.verticalVelocity = 0;
        this.yaw = 0;
        this.position = new THREE.Vector3();
        this.surfaceNormal = new THREE.Vector3(0, 1, 0);
        this.forward = new THREE.Vector3(0, 0, 1);
        this.orientationTarget = new THREE.Quaternion();

        this.tmpVectorA = new THREE.Vector3();
        this.tmpVectorB = new THREE.Vector3();
        this.tmpVectorC = new THREE.Vector3();
        this.tmpMatrix = new THREE.Matrix4();

        this.setupCarSwitcher();
        this.setModel(this.currentCarId);
        this.resetToStart();
    }

    setupCarSwitcher() {
        UIEventBus.on('carChange', (carId: string) => {
            if (!carId || carId === this.currentCarId) return;
            if (!carOptionsById[carId]) return;
            this.currentCarId = carId;
            this.setModel(carId);
        });
    }

    setModel(carId: string) {
        const car = this.getPreparedModel(carId);
        if (car) {
            this.swapModel(car);
            return;
        }

        const option = carOptionsById[carId];
        if (!option) return;

        const existingPromise = this.loadingPromises.get(carId);
        if (existingPromise) {
            existingPromise
                .then((model) => this.swapModelIfCurrent(carId, model))
                .catch(() => {});
            return;
        }

        const loadPromise = new Promise<THREE.Group>((resolve, reject) => {
            this.resources.loaders.gltfLoader.load(
                option.modelPath,
                (gltf) => {
                    this.resources.items.gltfModel[option.resourceName] = gltf;
                    const prepared = this.prepareModel(gltf.scene.clone(true), carId);
                    resolve(prepared);
                },
                undefined,
                (error) => {
                    reject(error);
                }
            );
        });

        this.loadingPromises.set(carId, loadPromise);
        loadPromise
            .then((model) => {
                this.cachedModels.set(carId, model);
                this.swapModelIfCurrent(carId, model);
            })
            .catch(() => {})
            .finally(() => {
                this.loadingPromises.delete(carId);
            });
    }

    getPreparedModel(carId: string) {
        const cached = this.cachedModels.get(carId);
        if (cached) return cached;

        const option = carOptionsById[carId];
        if (!option) return null;

        const gltf = this.resources.items.gltfModel[option.resourceName];
        if (!gltf) return null;

        const prepared = this.prepareModel(gltf.scene.clone(true), carId);
        this.cachedModels.set(carId, prepared);
        return prepared;
    }

    prepareModel(model: THREE.Group, carId: string) {
        this.cloneMaterials(model);
        this.applyMaterialTweaks(model);

        const option = carOptionsById[carId];
        const rawLength = this.getModelLength(model);
        const scale = option && rawLength > 0 ? option.lengthMeters / rawLength : 1;
        model.scale.setScalar(scale);
        model.rotation.set(0, -Math.PI / 2, 0);
        model.updateMatrixWorld(true);

        const bbox = new THREE.Box3().setFromObject(model);
        model.position.set(0, -bbox.min.y + 0.1, 0);
        model.updateMatrixWorld(true);

        return model;
    }

    cloneMaterials(model: THREE.Object3D) {
        model.traverse((child) => {
            if (!(child instanceof THREE.Mesh) || !child.material) return;
            if (Array.isArray(child.material)) {
                child.material = child.material.map((material) => material.clone());
            } else {
                child.material = child.material.clone();
            }
        });
    }

    applyMaterialTweaks(model: THREE.Object3D) {
        const envMap =
            this.resources.items.cubeTexture.environmentMapTexture || undefined;
        model.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;
            child.castShadow = false;
            child.receiveShadow = true;

            if (!child.material || Array.isArray(child.material)) return;
            const material = child.material as THREE.MeshStandardMaterial;
            if (envMap) {
                material.envMap = envMap;
                material.envMapIntensity = 0.9;
            }
            material.needsUpdate = true;
        });
    }

    getModelLength(model: THREE.Object3D) {
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        return Math.max(size.x, size.z);
    }

    swapModelIfCurrent(carId: string, model: THREE.Group) {
        if (this.currentCarId !== carId) return;
        this.swapModel(model);
    }

    swapModel(model: THREE.Group) {
        if (this.carModel && this.carModel !== model) {
            this.carPivot.remove(this.carModel);
        }
        this.carModel = model;
        this.carPivot.add(model);
    }

    setActive(active: boolean) {
        this.active = active;
        this.input.setEnabled(active);
        if (!active) {
            this.speedMps = 0;
            this.verticalVelocity = 0;
            this.input.reset();
        }
    }

    resetToStart() {
        const curve = this.track.getCurve();
        const point = curve.getPointAt(SPAWN_T);
        const tangent = curve.getTangentAt(SPAWN_T).normalize();

        this.position.copy(point).add(new THREE.Vector3(0, 180, 0));
        this.forward.set(tangent.x, 0, tangent.z).normalize();
        this.yaw = Math.atan2(this.forward.x, this.forward.z);

        this.surfaceNormal.set(0, 1, 0);
        this.speedMps = 0;
        this.verticalVelocity = 0;
        this.gear = 1;
        this.rpm = IDLE_RPM;
        this.groundToCollider(0);
        this.updateTransform(1);
    }

    update(deltaSeconds: number) {
        if (!this.active) return;

        this.input.update(deltaSeconds);
        const controls = this.input.getState();

        this.updateLongitudinalSpeed(deltaSeconds, controls.throttle, controls.brake);
        this.updateSteering(deltaSeconds, controls.steer, controls.handbrake);
        this.updatePosition(deltaSeconds, controls.handbrake);
        this.groundToCollider(deltaSeconds);
        this.updateTransform(deltaSeconds);
        this.updateDrivetrain(deltaSeconds);
    }

    updateLongitudinalSpeed(
        deltaSeconds: number,
        throttle: number,
        brake: number
    ) {
        if (throttle > 0 && brake <= 0) {
            if (this.speedMps >= 0) {
                this.speedMps += throttle * FORWARD_ACCEL * deltaSeconds;
            } else {
                this.speedMps += throttle * BRAKE_ACCEL * deltaSeconds;
            }
        } else if (brake > 0 && throttle <= 0) {
            if (this.speedMps > 0) {
                this.speedMps -= brake * BRAKE_ACCEL * deltaSeconds;
            } else {
                this.speedMps -= brake * REVERSE_ACCEL * deltaSeconds;
            }
        } else {
            const speedSign = Math.sign(this.speedMps);
            const coast = COAST_DECEL * deltaSeconds;
            if (Math.abs(this.speedMps) <= coast) {
                this.speedMps = 0;
            } else {
                this.speedMps -= speedSign * coast;
            }
        }

        const drag = DRAG_COEFFICIENT * this.speedMps * Math.abs(this.speedMps);
        this.speedMps -= drag * deltaSeconds;
        this.speedMps = THREE.MathUtils.clamp(
            this.speedMps,
            MAX_REVERSE_SPEED,
            MAX_FORWARD_SPEED
        );
    }

    updateSteering(deltaSeconds: number, steer: number, handbrake: number) {
        const speed = Math.abs(this.speedMps);
        if (speed < 0.4) return;

        const speedFactor = THREE.MathUtils.clamp(speed / 30, 0, 1);
        let steerRate = THREE.MathUtils.lerp(STEER_RATE_LOW, STEER_RATE_HIGH, speedFactor);
        steerRate *= this.speedMps >= 0 ? 1 : -1;

        if (handbrake > 0.2 && speed > 10) {
            steerRate *= 1.8;
        }

        this.yaw += steer * steerRate * deltaSeconds;
    }

    updatePosition(deltaSeconds: number, handbrake: number) {
        this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).normalize();
        this.tmpVectorA
            .copy(this.forward)
            .projectOnPlane(this.surfaceNormal)
            .normalize();

        if (this.tmpVectorA.lengthSq() > 0.0001) {
            this.forward.copy(this.tmpVectorA);
        }

        if (handbrake > 0.2 && Math.abs(this.speedMps) > 8) {
            this.speedMps *= 1 - handbrake * HAND_BRAKE_DAMPING * deltaSeconds;
        }

        this.position.addScaledVector(this.forward, this.speedMps * deltaSeconds);
    }

    groundToCollider(deltaSeconds: number) {
        this.tmpVectorA.copy(this.position).add(new THREE.Vector3(0, RAYCAST_HEIGHT, 0));
        this.tmpVectorB.set(0, -1, 0);

        this.raycaster.layers.set(this.track.getColliderLayer());
        this.raycaster.set(this.tmpVectorA, this.tmpVectorB);
        this.raycaster.far = RAYCAST_DISTANCE;

        const hits = this.raycaster.intersectObject(this.colliderMesh, false);
        const hit = hits[0];

        if (hit) {
            this.grounded = true;
            this.position.y = hit.point.y + RIDE_HEIGHT;
            this.verticalVelocity = 0;

            this.tmpVectorC
                .copy(hit.face?.normal || new THREE.Vector3(0, 1, 0))
                .transformDirection(hit.object.matrixWorld)
                .normalize();

            const normalLerp = THREE.MathUtils.clamp(deltaSeconds * 9, 0, 1);
            this.surfaceNormal.lerp(this.tmpVectorC, normalLerp).normalize();
            return;
        }

        this.grounded = false;
        this.verticalVelocity -= GRAVITY * deltaSeconds;
        this.position.y += this.verticalVelocity * deltaSeconds;
        this.surfaceNormal
            .lerp(new THREE.Vector3(0, 1, 0), THREE.MathUtils.clamp(deltaSeconds * 2, 0, 1))
            .normalize();
    }

    updateTransform(deltaSeconds: number) {
        this.tmpVectorA
            .copy(this.forward)
            .projectOnPlane(this.surfaceNormal)
            .normalize();

        this.tmpVectorB
            .crossVectors(this.surfaceNormal, this.tmpVectorA)
            .normalize();
        this.tmpVectorC
            .crossVectors(this.tmpVectorB, this.surfaceNormal)
            .normalize();

        this.tmpMatrix.makeBasis(this.tmpVectorB, this.surfaceNormal, this.tmpVectorC);
        this.orientationTarget.setFromRotationMatrix(this.tmpMatrix);

        const rotLerp = THREE.MathUtils.clamp(deltaSeconds * 10, 0, 1);
        this.carPivot.quaternion.slerp(this.orientationTarget, rotLerp);
        this.carPivot.position.copy(this.position);
    }

    updateDrivetrain(deltaSeconds: number) {
        const wheelRpm =
            (Math.abs(this.speedMps) / (Math.PI * 2 * WHEEL_RADIUS)) * 60;

        if (this.speedMps < -0.5) {
            this.gear = -1;
            const reverseRpm = IDLE_RPM + wheelRpm * 2.6;
            this.rpm = THREE.MathUtils.clamp(reverseRpm, IDLE_RPM, REDLINE_RPM * 0.85);
            return;
        }

        if (this.gear < 1) {
            this.gear = 1;
        }

        const maxGear = GEAR_RATIOS.length - 1;
        const currentRatio = GEAR_RATIOS[this.gear];
        let rpmTarget =
            IDLE_RPM + wheelRpm * (currentRatio || GEAR_RATIOS[1]) * FINAL_DRIVE;

        if (rpmTarget > SHIFT_UP_RPM && this.gear < maxGear) {
            this.gear++;
            UIEventBus.dispatch('race:gearShift', {
                gear: this.gear,
                carId: this.currentCarId,
            });
        } else if (rpmTarget < SHIFT_DOWN_RPM && this.gear > 1) {
            this.gear--;
            UIEventBus.dispatch('race:gearShift', {
                gear: this.gear,
                carId: this.currentCarId,
            });
        }

        const shiftedRatio = GEAR_RATIOS[this.gear] || GEAR_RATIOS[1];
        rpmTarget = IDLE_RPM + wheelRpm * shiftedRatio * FINAL_DRIVE;
        rpmTarget = THREE.MathUtils.clamp(rpmTarget, IDLE_RPM, REDLINE_RPM);

        const rpmLerp = THREE.MathUtils.clamp(deltaSeconds * 12, 0, 1);
        this.rpm = THREE.MathUtils.lerp(this.rpm, rpmTarget, rpmLerp);
    }

    getTelemetry(): VehicleTelemetry {
        return {
            speedMps: this.speedMps,
            speedKph: this.speedMps * 3.6,
            gear: this.gear,
            rpm: this.rpm,
            throttle: this.input.getState().throttle,
            brake: this.input.getState().brake,
            handbrake: this.input.getState().handbrake,
            grounded: this.grounded,
            position: this.position.clone(),
            quaternion: this.carPivot.quaternion.clone(),
            forward: this.forward.clone(),
            carId: this.currentCarId,
        };
    }
}

