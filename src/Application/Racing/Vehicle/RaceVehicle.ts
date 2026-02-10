import * as THREE from 'three';
import Application from '../../Application';
import Resources from '../../Utils/Resources';
import UIEventBus from '../../UI/EventBus';
import DrivingInput from '../Input/DrivingInput';
import NordschleifeTrack from '../Track/NordschleifeTrack';
import DriftSmoke from '../Effects/DriftSmoke';
import {
    carOptionsById,
    defaultCarId,
    getStoredCarId,
    type CarRaceConfig,
    type DrivetrainType,
} from '../../carOptions';

const SPAWN_T = 0.003;
const MAX_REVERSE_SPEED_KPH = 34;
const GRAVITY = 32;
const RAYCAST_HEIGHT = 320;
const RAYCAST_DISTANCE = 1200;
const LONG_AXIS_THRESHOLD = 1.12;
const DRIFT_ENTRY_SPEED_MPS = 7.5;
const DRIFT_RELEASE_SPEED_MPS = 4.5;
const SMOKE_SPAWN_INTERVAL = 0.03;
const STEERING_SENSITIVITY_SCALE = 0.22;
const AMG_ONE_ID = 'amg-one';
const TOYOTA_CROWN_ID = 'toyota-crown-platinum';
const AMG_ONE_RACE_BLUE = new THREE.Color(0x050f2f);
const TOYOTA_CROWN_SILVER = new THREE.Color(0x8f9296);
const WHEEL_NAME_HINT_REGEX =
    /(^|[^a-z])(wheel|tire|tyre|rim)([^a-z]|$)/i;
const WHEEL_MATERIAL_HINT_REGEX =
    /(wheel|tire|tyre|rim|rubber|michelin|hub|disk|brake)/i;
const NON_WHEEL_NAME_HINT_REGEX =
    /(trim|glass|window|windshield|body|door|hood|trunk|mirror|bumper|panel)/i;
const FRONT_HINTS = ['front', '_fl', '_fr', 'head', 'hood', 'grille'];
const REAR_HINTS = ['rear', '_rl', '_rr', 'tail', 'trunk', 'exhaust'];

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
    drivetrain: DrivetrainType;
    slipRatio: number;
    driftIntensity: number;
};

type WheelRig = {
    object: THREE.Object3D;
    front: boolean;
    rear: boolean;
    left: boolean;
    mappedCorner: boolean;
    localCenter: THREE.Vector3;
    baseQuaternion: THREE.Quaternion;
    spinSign: number;
    radius: number;
};

type WheelNodeMap = NonNullable<CarRaceConfig['wheelNodeMap']>;

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
    currentTuning: CarRaceConfig;
    cachedModels: Map<string, THREE.Group>;
    loadingPromises: Map<string, Promise<THREE.Group>>;
    wheelWarningCarIds: Set<string>;
    active: boolean;
    grounded: boolean;
    gear: number;
    rpm: number;
    speedMps: number;
    lateralSpeed: number;
    driftAmount: number;
    slipRatio: number;
    verticalVelocity: number;
    yaw: number;
    steerAngle: number;
    steerVisualAngle: number;
    wheelSpinAngle: number;
    rideHeight: number;
    wheelRadius: number;
    maxForwardSpeedMps: number;
    maxReverseSpeedMps: number;
    engineAccelBase: number;
    reverseAccel: number;
    engineBrakeDecel: number;
    aeroDrag: number;
    rollingResistance: number;
    bodyRadius: number;
    bodySize: THREE.Vector3;
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    surfaceNormal: THREE.Vector3;
    forward: THREE.Vector3;
    orientationTarget: THREE.Quaternion;
    wheelRig: WheelRig[];
    frontWheelRig: WheelRig[];
    rearWheelRig: WheelRig[];
    smoke: DriftSmoke;
    smokeSpawnCooldown: number;
    tmpVectorA: THREE.Vector3;
    tmpVectorB: THREE.Vector3;
    tmpVectorC: THREE.Vector3;
    tmpMatrix: THREE.Matrix4;
    tmpQuatA: THREE.Quaternion;
    tmpQuatB: THREE.Quaternion;

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
        this.smoke = new DriftSmoke(parent);
        this.smokeSpawnCooldown = 0;

        this.carModel = null;
        this.cachedModels = new Map();
        this.loadingPromises = new Map();
        this.currentCarId = getStoredCarId();
        this.currentTuning =
            carOptionsById[this.currentCarId]?.race ||
            carOptionsById[defaultCarId].race;
        this.wheelWarningCarIds = new Set();

        this.active = false;
        this.grounded = false;
        this.gear = 1;
        this.rpm = this.currentTuning.idleRpm;
        this.speedMps = 0;
        this.lateralSpeed = 0;
        this.driftAmount = 0;
        this.slipRatio = 0;
        this.verticalVelocity = 0;
        this.yaw = 0;
        this.steerAngle = 0;
        this.steerVisualAngle = 0;
        this.wheelSpinAngle = 0;
        this.rideHeight = this.currentTuning.wheelRadiusMeters + 0.02;
        this.wheelRadius = this.currentTuning.wheelRadiusMeters;
        this.maxForwardSpeedMps = this.currentTuning.topSpeedKph / 3.6;
        this.maxReverseSpeedMps = MAX_REVERSE_SPEED_KPH / 3.6;
        this.engineAccelBase = 8;
        this.reverseAccel = 5.5;
        this.engineBrakeDecel = 2.2;
        this.aeroDrag = 0.00012;
        this.rollingResistance = 0.32;
        this.bodyRadius = 2.4;
        this.bodySize = new THREE.Vector3(4.7, 1.4, 2.1);
        this.position = new THREE.Vector3();
        this.velocity = new THREE.Vector3();
        this.surfaceNormal = new THREE.Vector3(0, 1, 0);
        this.forward = new THREE.Vector3(0, 0, 1);
        this.orientationTarget = new THREE.Quaternion();
        this.wheelRig = [];
        this.frontWheelRig = [];
        this.rearWheelRig = [];

        this.tmpVectorA = new THREE.Vector3();
        this.tmpVectorB = new THREE.Vector3();
        this.tmpVectorC = new THREE.Vector3();
        this.tmpMatrix = new THREE.Matrix4();
        this.tmpQuatA = new THREE.Quaternion();
        this.tmpQuatB = new THREE.Quaternion();

        this.setCarTuning(this.currentCarId);
        this.setupCarSwitcher();
        this.setModel(this.currentCarId);
        this.resetToStart();
    }

    setupCarSwitcher() {
        UIEventBus.on('carChange', (carId: string) => {
            if (!carId || carId === this.currentCarId) return;
            if (!carOptionsById[carId]) return;
            this.currentCarId = carId;
            this.setCarTuning(carId);
            this.setModel(carId);
        });
    }

    setCarTuning(carId: string) {
        const option = carOptionsById[carId] || carOptionsById[defaultCarId];
        this.currentTuning = option.race;
        this.maxForwardSpeedMps = this.currentTuning.topSpeedKph / 3.6;
        this.maxReverseSpeedMps = Math.max(
            6,
            Math.min(
                13.5,
                MAX_REVERSE_SPEED_KPH / 3.6 + this.currentTuning.topSpeedKph * 0.005
            )
        );

        this.wheelRadius = this.currentTuning.wheelRadiusMeters;
        this.rideHeight = THREE.MathUtils.clamp(this.wheelRadius * 0.98, 0.16, 0.52);

        const zeroToHundred = Math.max(2.3, this.currentTuning.zeroToHundredSec);
        this.engineAccelBase = 27.7778 / zeroToHundred;
        this.reverseAccel = this.engineAccelBase * 0.56;
        this.engineBrakeDecel = THREE.MathUtils.lerp(1.8, 3.1, this.engineAccelBase / 10);

        const firstGear = this.currentTuning.gearRatios[0] || 1;
        const topGear =
            this.currentTuning.gearRatios[this.currentTuning.gearRatios.length - 1] ||
            firstGear;
        const topGearPull = THREE.MathUtils.clamp(topGear / firstGear, 0.15, 0.5);
        const engineAtTop =
            this.engineAccelBase * (0.52 + topGearPull * 0.52) * 0.7;
        this.aeroDrag = THREE.MathUtils.clamp(
            engineAtTop / Math.max(1, this.maxForwardSpeedMps * this.maxForwardSpeedMps),
            0.000065,
            0.00032
        );
        this.rollingResistance = THREE.MathUtils.lerp(
            0.26,
            0.42,
            THREE.MathUtils.clamp(
                (this.currentTuning.massKg - 1500) / 700,
                0,
                1
            )
        );

        this.rpm = THREE.MathUtils.clamp(
            this.rpm,
            this.currentTuning.idleRpm,
            this.currentTuning.redlineRpm
        );
    }

    setModel(carId: string) {
        this.setCarTuning(carId);
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
                .catch((error) => {
                    console.warn(
                        `[RaceVehicle] Failed to load car model for ${carId}`,
                        error
                    );
                });
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
            .catch((error) => {
                console.warn(
                    `[RaceVehicle] Failed to load car model for ${carId}`,
                    error
                );
            })
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
        this.applyMaterialTweaks(model, carId);

        const option = carOptionsById[carId];
        const rawLength = this.getModelLength(model);
        const scale = option && rawLength > 0 ? option.lengthMeters / rawLength : 1;
        model.scale.setScalar(scale);
        model.rotation.set(0, this.getVisualForwardOffsetY(model), 0);

        if (option?.race.visualForwardAxis === 'negativeZ') {
            model.rotation.y += Math.PI;
        }

        this.alignVisualFrontToPositiveZ(model);
        model.updateMatrixWorld(true);

        let wheelRig = this.buildWheelRig(model, option?.race.wheelNodeMap);
        if (this.shouldFlipModelForwardFromMappedWheels(wheelRig, option?.race.visualForwardAxis || 'positiveZ')) {
            model.rotation.y += Math.PI;
            model.updateMatrixWorld(true);
            wheelRig = this.buildWheelRig(model, option?.race.wheelNodeMap);
        }
        wheelRig = this.filterValidWheelRig(carId, wheelRig);
        const wheelRadius = this.getDetectedWheelRadius(wheelRig);
        const rideHeight = THREE.MathUtils.clamp(wheelRadius * 0.98, 0.16, 0.52);

        const bbox = new THREE.Box3().setFromObject(model);
        const wheelBottom = this.getWheelContactBottom(wheelRig);
        const contactBottom = wheelBottom ?? bbox.min.y;
        model.position.set(
            0,
            -rideHeight - contactBottom + (option?.race.groundOffsetMeters || 0),
            0
        );
        model.updateMatrixWorld(true);

        const shiftedBox = new THREE.Box3().setFromObject(model);
        const shiftedSize = new THREE.Vector3();
        shiftedBox.getSize(shiftedSize);
        const bodyRadius = Math.max(
            1.4,
            Math.sqrt(
                shiftedSize.x * shiftedSize.x + shiftedSize.z * shiftedSize.z
            ) * 0.42
        );

        model.userData.raceWheelRig = wheelRig;
        model.userData.raceWheelRadius = wheelRadius;
        model.userData.raceRideHeight = rideHeight;
        model.userData.raceBodyRadius = bodyRadius;
        model.userData.raceBodySize = [
            shiftedSize.x,
            shiftedSize.y,
            shiftedSize.z,
        ];

        return model;
    }

    getVisualForwardOffsetY(model: THREE.Object3D) {
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);

        // Most race transforms assume mesh forward is +Z.
        // If the imported model long axis is X, rotate to align with +Z.
        if (size.x > size.z * LONG_AXIS_THRESHOLD) {
            return -Math.PI / 2;
        }

        return 0;
    }

    alignVisualFrontToPositiveZ(model: THREE.Object3D) {
        let frontSum = 0;
        let frontCount = 0;
        let rearSum = 0;
        let rearCount = 0;
        const center = new THREE.Vector3();

        model.traverse((child) => {
            const name = (child.name || '').toLowerCase();
            if (!name) return;
            if (
                !this.matchesAnyHint(name, FRONT_HINTS) &&
                !this.matchesAnyHint(name, REAR_HINTS)
            ) {
                return;
            }

            const box = new THREE.Box3().setFromObject(child);
            if (box.isEmpty()) return;
            box.getCenter(center);
            this.toScaledModelSpace(center, model);

            if (this.matchesAnyHint(name, FRONT_HINTS)) {
                frontSum += center.z;
                frontCount++;
            }
            if (this.matchesAnyHint(name, REAR_HINTS)) {
                rearSum += center.z;
                rearCount++;
            }
        });

        if (frontCount < 2 || rearCount < 2) return;
        if (frontSum / frontCount < rearSum / rearCount) {
            model.rotation.y += Math.PI;
        }
    }

    shouldFlipModelForwardFromMappedWheels(
        wheels: WheelRig[],
        expectedForward: 'positiveZ' | 'negativeZ'
    ) {
        const mappedFront = wheels.filter(
            (wheel) => wheel.mappedCorner && wheel.front
        );
        const mappedRear = wheels.filter(
            (wheel) => wheel.mappedCorner && wheel.rear
        );

        if (!mappedFront.length || !mappedRear.length) return false;

        const frontAverage =
            mappedFront.reduce((sum, wheel) => sum + wheel.localCenter.z, 0) /
            mappedFront.length;
        const rearAverage =
            mappedRear.reduce((sum, wheel) => sum + wheel.localCenter.z, 0) /
            mappedRear.length;

        if (expectedForward === 'positiveZ') {
            return frontAverage < rearAverage;
        }

        return frontAverage > rearAverage;
    }

    filterValidWheelRig(carId: string, wheels: WheelRig[]) {
        if (!this.isWheelRigValid(wheels)) {
            if (!this.wheelWarningCarIds.has(carId)) {
                this.wheelWarningCarIds.add(carId);
                console.warn(
                    `[RaceVehicle] Could not resolve 4 valid wheel nodes for ${carId}. Wheel animation disabled for this car.`
                );
            }
            return [] as WheelRig[];
        }
        return wheels;
    }

    isWheelRigValid(wheels: WheelRig[]) {
        if (wheels.length < 4) return false;

        const unique = new Map<string, WheelRig>();
        for (const wheel of wheels) {
            if (!wheel.object?.uuid) continue;
            if (!unique.has(wheel.object.uuid)) {
                unique.set(wheel.object.uuid, wheel);
            }
        }

        if (unique.size < 4) return false;

        const normalized = Array.from(unique.values());
        const frontCount = normalized.filter((wheel) => wheel.front).length;
        const rearCount = normalized.filter((wheel) => wheel.rear).length;
        const leftCount = normalized.filter((wheel) => wheel.left).length;
        const rightCount = normalized.filter((wheel) => !wheel.left).length;
        if (frontCount < 2 || rearCount < 2 || leftCount < 2 || rightCount < 2) {
            return false;
        }

        return normalized.every((wheel) =>
            this.isWheelRadiusPlausible(wheel.radius)
        );
    }

    getWheelContactBottom(wheels: WheelRig[]) {
        if (!wheels.length) return null;

        let minBottom = Infinity;
        wheels.forEach((wheel) => {
            const bottom = wheel.localCenter.y - wheel.radius;
            if (bottom < minBottom) {
                minBottom = bottom;
            }
        });

        if (!Number.isFinite(minBottom)) return null;
        return minBottom;
    }

    buildMappedWheelRig(
        model: THREE.Object3D,
        wheelNodeMap?: WheelNodeMap
    ): WheelRig[] {
        if (!wheelNodeMap) return [];

        const mappedWheels: WheelRig[] = [];
        const candidates = new Map<string, THREE.Object3D>();
        const center = new THREE.Vector3();
        const size = new THREE.Vector3();

        const explicitCorners: Array<{
            front: boolean;
            left: boolean;
            names?: string[];
        }> = [
            {
                front: true,
                left: true,
                names: wheelNodeMap.frontLeft,
            },
            {
                front: true,
                left: false,
                names: wheelNodeMap.frontRight,
            },
            {
                front: false,
                left: true,
                names: wheelNodeMap.rearLeft,
            },
            {
                front: false,
                left: false,
                names: wheelNodeMap.rearRight,
            },
        ];

        const hasExplicitCorners = explicitCorners.some(
            (entry) => (entry.names || []).length > 0
        );

        if (hasExplicitCorners) {
            for (const corner of explicitCorners) {
                const node = this.findNodeByHints(model, corner.names || []);
                if (!node) continue;

                const box = new THREE.Box3().setFromObject(node);
                if (box.isEmpty()) continue;
                box.getSize(size);
                const radius = Math.max(size.x, size.y, size.z) * 0.5;
                if (!this.isWheelRadiusPlausible(radius)) continue;

                box.getCenter(center);
                this.toScaledModelSpace(center, model);

                mappedWheels.push({
                    object: node,
                    front: corner.front,
                    rear: !corner.front,
                    left: corner.left,
                    mappedCorner: true,
                    localCenter: center.clone(),
                    baseQuaternion: node.quaternion.clone(),
                    spinSign: corner.left ? 1 : -1,
                    radius,
                });
            }

            if (mappedWheels.length >= 4) {
                const medianX = this.getMedian(
                    mappedWheels.map((wheel) => wheel.localCenter.x)
                );
                mappedWheels.forEach((wheel) => {
                    wheel.left = wheel.localCenter.x <= medianX;
                    wheel.spinSign = wheel.left ? 1 : -1;
                });
                return mappedWheels;
            }
        }

        if (!wheelNodeMap.candidates || wheelNodeMap.candidates.length === 0) {
            return [];
        }

        for (const hint of wheelNodeMap.candidates) {
            const node = this.findNodeByHints(model, [hint]);
            if (node) {
                candidates.set(node.uuid, node);
            }
        }

        const candidateWheels: WheelRig[] = [];
        for (const node of candidates.values()) {
            const box = new THREE.Box3().setFromObject(node);
            if (box.isEmpty()) continue;
            box.getSize(size);
            const radius = Math.max(size.x, size.y, size.z) * 0.5;
            if (!this.isWheelRadiusPlausible(radius)) continue;

            box.getCenter(center);
            this.toScaledModelSpace(center, model);

            candidateWheels.push({
                object: node,
                front: false,
                rear: false,
                left: false,
                mappedCorner: false,
                localCenter: center.clone(),
                baseQuaternion: node.quaternion.clone(),
                spinSign: center.x <= 0 ? 1 : -1,
                radius,
            });
        }

        if (candidateWheels.length < 4) {
            return [];
        }

        const medianX = this.getMedian(
            candidateWheels.map((candidate) => candidate.localCenter.x)
        );
        const medianZ = this.getMedian(
            candidateWheels.map((candidate) => candidate.localCenter.z)
        );

        candidateWheels.forEach((wheel) => {
            wheel.front = wheel.localCenter.z >= medianZ;
            wheel.rear = !wheel.front;
            wheel.left = wheel.localCenter.x <= medianX;
            wheel.spinSign = wheel.left ? 1 : -1;
        });

        const frontAxle = this.pickAxlePair(
            candidateWheels.filter((wheel) => wheel.front)
        );
        const rearAxle = this.pickAxlePair(
            candidateWheels.filter((wheel) => wheel.rear)
        );
        const combined = [...frontAxle, ...rearAxle];
        if (combined.length < 4) {
            return [];
        }
        return combined;
    }

    findNodeByHints(
        model: THREE.Object3D,
        hints: string[]
    ): THREE.Object3D | null {
        if (!hints.length) return null;

        const loweredHints = hints.map((hint) => hint.toLowerCase());
        let exactMatch: THREE.Object3D | null = null;
        let containsMatch: THREE.Object3D | null = null;

        model.traverse((child) => {
            if (exactMatch) return;
            const childName = (child.name || '').toLowerCase();
            if (!childName) return;

            for (const hint of loweredHints) {
                if (childName === hint) {
                    exactMatch = child;
                    return;
                }
                if (!containsMatch && childName.includes(hint)) {
                    containsMatch = child;
                }
            }
        });

        return exactMatch || containsMatch;
    }

    buildWheelRig(model: THREE.Object3D, wheelNodeMap?: WheelNodeMap) {
        const mapped = this.buildMappedWheelRig(model, wheelNodeMap);
        if (mapped.length >= 4) {
            return mapped;
        }

        const candidates = new Map<
            string,
            {
                object: THREE.Object3D;
                center: THREE.Vector3;
                radius: number;
                frontHint: boolean;
                rearHint: boolean;
                leftHint: boolean;
                rightHint: boolean;
            }
        >();
        const center = new THREE.Vector3();
        const size = new THREE.Vector3();
        const modelBox = new THREE.Box3().setFromObject(model);
        const modelCenter = new THREE.Vector3();
        const modelSize = new THREE.Vector3();
        modelBox.getCenter(modelCenter);
        modelBox.getSize(modelSize);
        const sideThreshold = Math.max(0.25, modelSize.x * 0.18);
        const longitudinalThreshold = Math.max(0.2, modelSize.z * 0.14);
        const verticalThreshold = modelCenter.y + modelSize.y * 0.25;

        model.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;
            const name = (child.name || '').toLowerCase();
            if (!this.isWheelCandidateMesh(child, name)) return;

            const node = this.resolveWheelNode(child, model);
            const nodeName = (node.name || '').toLowerCase();
            const box = new THREE.Box3().setFromObject(node);
            if (box.isEmpty()) return;

            box.getSize(size);
            const radius = Math.max(size.x, size.y, size.z) * 0.5;
            if (!this.isWheelRadiusPlausible(radius)) return;

            box.getCenter(center);
            this.toScaledModelSpace(center, model);
            const centerWorld = box.getCenter(new THREE.Vector3());

            if (Math.abs(centerWorld.x) < sideThreshold) return;
            if (Math.abs(centerWorld.z) < longitudinalThreshold) return;
            if (centerWorld.y > verticalThreshold) return;

            const existing = candidates.get(node.uuid);
            if (existing && existing.radius >= radius) return;

            candidates.set(node.uuid, {
                object: node,
                center: center.clone(),
                radius,
                frontHint: this.matchesAnyHint(nodeName, FRONT_HINTS),
                rearHint: this.matchesAnyHint(nodeName, REAR_HINTS),
                leftHint:
                    nodeName.includes('left') ||
                    nodeName.includes('_l') ||
                    nodeName.includes('-l'),
                rightHint:
                    nodeName.includes('right') ||
                    nodeName.includes('_r') ||
                    nodeName.includes('-r'),
            });
        });

        const sorted = Array.from(candidates.values())
            .sort((a, b) => b.radius - a.radius)
            .slice(0, 12);

        if (!sorted.length) return [];

        const medianX = this.getMedian(sorted.map((candidate) => candidate.center.x));
        const medianZ = this.getMedian(sorted.map((candidate) => candidate.center.z));

        let frontPositiveZ = true;
        const frontHinted = sorted.filter((candidate) => candidate.frontHint);
        const rearHinted = sorted.filter((candidate) => candidate.rearHint);
        if (frontHinted.length >= 2 && rearHinted.length >= 2) {
            const frontAverage =
                frontHinted.reduce(
                    (sum, candidate) => sum + candidate.center.z,
                    0
                ) / frontHinted.length;
            const rearAverage =
                rearHinted.reduce(
                    (sum, candidate) => sum + candidate.center.z,
                    0
                ) / rearHinted.length;
            frontPositiveZ = frontAverage >= rearAverage;
        }

        const wheels: WheelRig[] = sorted.map((candidate) => {
            const front =
                candidate.frontHint ||
                (!candidate.rearHint &&
                    (frontPositiveZ
                        ? candidate.center.z >= medianZ
                        : candidate.center.z <= medianZ));
            const left =
                candidate.leftHint ||
                (!candidate.rightHint && candidate.center.x <= medianX);

            return {
                object: candidate.object,
                front,
                rear: !front,
                left,
                mappedCorner: false,
                localCenter: candidate.center.clone(),
                baseQuaternion: candidate.object.quaternion.clone(),
                spinSign: left ? 1 : -1,
                radius: candidate.radius,
            };
        });

        const frontAxle = this.pickAxlePair(
            wheels.filter((wheel) => wheel.front)
        );
        const rearAxle = this.pickAxlePair(wheels.filter((wheel) => wheel.rear));
        const combined = [...frontAxle, ...rearAxle];

        if (combined.length >= 4) {
            return combined;
        }
        return [];
    }

    pickAxlePair(candidates: WheelRig[]) {
        if (candidates.length <= 2) return candidates;

        const leftCandidates = candidates
            .filter((candidate) => candidate.left)
            .sort((a, b) => a.localCenter.x - b.localCenter.x);
        const rightCandidates = candidates
            .filter((candidate) => !candidate.left)
            .sort((a, b) => b.localCenter.x - a.localCenter.x);

        if (leftCandidates.length > 0 && rightCandidates.length > 0) {
            return [leftCandidates[0], rightCandidates[0]];
        }

        return candidates
            .slice()
            .sort(
                (a, b) => Math.abs(b.localCenter.x) - Math.abs(a.localCenter.x)
            )
            .slice(0, 2);
    }

    getDetectedWheelRadius(wheels: WheelRig[]) {
        if (!wheels.length) return this.currentTuning.wheelRadiusMeters;
        const average =
            wheels.reduce((sum, wheel) => sum + wheel.radius, 0) / wheels.length;
        return THREE.MathUtils.clamp(average, 0.24, 0.46);
    }

    resolveWheelNode(node: THREE.Object3D, model: THREE.Object3D) {
        let current = node;
        while (
            current.parent &&
            current.parent !== model &&
            this.isWheelName((current.parent.name || '').toLowerCase())
        ) {
            current = current.parent;
        }
        return current;
    }

    getMedian(values: number[]) {
        if (!values.length) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        if (sorted.length % 2 === 0) {
            return (sorted[middle - 1] + sorted[middle]) * 0.5;
        }
        return sorted[middle];
    }

    toScaledModelSpace(center: THREE.Vector3, model: THREE.Object3D) {
        model.worldToLocal(center);
        // Keep wheel centers in scaled model units so ride-height math is stable.
        center.multiplyScalar(model.scale.x || 1);
        center.applyQuaternion(model.quaternion);
    }

    isWheelRadiusPlausible(radius: number) {
        return radius >= 0.12 && radius <= 0.8;
    }

    isWheelCandidateMesh(mesh: THREE.Mesh, meshName: string) {
        if (NON_WHEEL_NAME_HINT_REGEX.test(meshName)) {
            return false;
        }
        if (this.isWheelName(meshName)) return true;

        if (Array.isArray(mesh.material)) {
            return mesh.material.some((material) =>
                this.isWheelMaterialName(material?.name || '')
            );
        }

        return this.isWheelMaterialName(mesh.material?.name || '');
    }

    isWheelMaterialName(name: string) {
        const lowered = String(name || '').toLowerCase();
        if (!lowered) return false;
        if (NON_WHEEL_NAME_HINT_REGEX.test(lowered)) return false;
        if (lowered.includes('trim')) return false;
        return WHEEL_MATERIAL_HINT_REGEX.test(lowered);
    }

    isWheelName(name: string) {
        const lowered = String(name || '').toLowerCase();
        if (!lowered) return false;
        if (NON_WHEEL_NAME_HINT_REGEX.test(lowered)) return false;
        if (lowered.includes('trim')) return false;
        return WHEEL_NAME_HINT_REGEX.test(lowered);
    }

    matchesAnyHint(name: string, hints: string[]) {
        const lowered = String(name || '').toLowerCase();
        return hints.some((hint) => lowered.includes(hint));
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

    applyMaterialTweaks(model: THREE.Object3D, carId: string) {
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
        this.applyRaceMaterialStyling(model, carId);
    }

    applyRaceMaterialStyling(model: THREE.Object3D, carId: string) {
        if (carId !== AMG_ONE_ID && carId !== TOYOTA_CROWN_ID) return;

        const bodyColor =
            carId === TOYOTA_CROWN_ID ? TOYOTA_CROWN_SILVER : AMG_ONE_RACE_BLUE;
        const bodyMatchers =
            carId === TOYOTA_CROWN_ID
                ? ['body', 'blue']
                : [
                      'body_color',
                      'piano_black',
                      'piano_black_0',
                      'piano_black_1',
                      'piano_black_2',
                      'black',
                      'black_m_nc_black_0',
                      'black_under_black_0',
                      'material',
                      'mizo',
                  ];

        model.traverse((child) => {
            if (!(child instanceof THREE.Mesh) || !child.material) return;
            if (Array.isArray(child.material)) return;

            const material = child.material as THREE.MeshStandardMaterial;
            const materialName = (material.name || '').toLowerCase();
            const isBodyMaterial = bodyMatchers.some((matcher) =>
                materialName.includes(matcher)
            );
            if (!isBodyMaterial) return;

            material.color.copy(bodyColor);
            material.metalness = 1;
            material.roughness = 0.18;
            material.envMapIntensity = 1.1;
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
        this.applyModelMetadata(model);
    }

    applyModelMetadata(model: THREE.Group) {
        const wheelRig = (model.userData.raceWheelRig || []) as WheelRig[];
        this.wheelRig = wheelRig;
        this.frontWheelRig = wheelRig.filter((wheel) => wheel.front);
        this.rearWheelRig = wheelRig.filter((wheel) => wheel.rear);

        this.wheelRadius =
            Number(model.userData.raceWheelRadius) || this.currentTuning.wheelRadiusMeters;
        this.rideHeight =
            Number(model.userData.raceRideHeight) ||
            THREE.MathUtils.clamp(this.wheelRadius * 0.98, 0.16, 0.52);
        this.bodyRadius = Number(model.userData.raceBodyRadius) || this.bodyRadius;

        const bodySize = model.userData.raceBodySize as number[] | undefined;
        if (Array.isArray(bodySize) && bodySize.length === 3) {
            this.bodySize.set(bodySize[0], bodySize[1], bodySize[2]);
        }
    }

    resetWheelVisuals() {
        this.wheelRig.forEach((wheel) => {
            wheel.object.quaternion.copy(wheel.baseQuaternion);
        });
    }

    setActive(active: boolean) {
        this.active = active;
        this.input.setEnabled(active);
        this.smoke.setActive(active);
        if (!active) {
            this.speedMps = 0;
            this.lateralSpeed = 0;
            this.driftAmount = 0;
            this.slipRatio = 0;
            this.verticalVelocity = 0;
            this.steerAngle = 0;
            this.steerVisualAngle = 0;
            this.wheelSpinAngle = 0;
            this.smokeSpawnCooldown = 0;
            this.input.reset();
            this.resetWheelVisuals();
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
        this.lateralSpeed = 0;
        this.driftAmount = 0;
        this.slipRatio = 0;
        this.verticalVelocity = 0;
        this.steerAngle = 0;
        this.steerVisualAngle = 0;
        this.wheelSpinAngle = 0;
        this.gear = 1;
        this.rpm = this.currentTuning.idleRpm;
        this.smokeSpawnCooldown = 0;
        this.smoke.clear();
        this.groundToCollider(0);
        this.updateTransform(1);
        this.resetWheelVisuals();
    }

    update(deltaSeconds: number) {
        if (!this.active) return;

        this.input.update(deltaSeconds);
        const controls = this.input.getState();

        this.updateLongitudinalSpeed(
            deltaSeconds,
            controls.throttle,
            controls.brake,
            controls.handbrake
        );
        this.updateSteering(
            deltaSeconds,
            controls.steer,
            controls.handbrake,
            controls.throttle
        );
        this.updatePosition(deltaSeconds);
        this.groundToCollider(deltaSeconds);
        this.updateTransform(deltaSeconds);
        this.updateDrivetrain(deltaSeconds, controls.throttle, controls.brake);
        this.updateWheelVisuals(deltaSeconds);
        this.updateDriftSmoke(deltaSeconds);
    }

    updateLongitudinalSpeed(
        deltaSeconds: number,
        throttle: number,
        brake: number,
        handbrake: number
    ) {
        const speedSign = Math.sign(this.speedMps);
        const speedAbs = Math.abs(this.speedMps);
        const speedRatio = speedAbs / Math.max(1, this.maxForwardSpeedMps);

        const firstGear = this.currentTuning.gearRatios[0] || 1;
        const currentRatio =
            this.gear > 0
                ? this.currentTuning.gearRatios[this.gear - 1] || firstGear
                : this.currentTuning.reverseRatio;
        const gearPull = THREE.MathUtils.clamp(currentRatio / firstGear, 0.28, 1.18);

        const rpmRange = Math.max(
            1,
            this.currentTuning.redlineRpm - this.currentTuning.idleRpm
        );
        const rpmNorm = THREE.MathUtils.clamp(
            (this.rpm - this.currentTuning.idleRpm) / rpmRange,
            0,
            1
        );
        const torqueCurve = 0.58 + Math.sin(rpmNorm * Math.PI) * 0.5;
        const launchBoost = 1 + Math.max(0, 1 - speedRatio) * 0.34;

        const drivetrainGrip =
            this.currentTuning.drivetrain === 'AWD'
                ? 1
                : this.currentTuning.drivetrain === 'RWD'
                ? 0.97
                : 0.93;
        const throttleAccel =
            throttle *
            this.engineAccelBase *
            gearPull *
            torqueCurve *
            launchBoost *
            drivetrainGrip;

        let acceleration = 0;
        if (throttle > 0.01 && brake < 0.35) {
            acceleration += throttleAccel;
        }

        if (brake > 0.01) {
            if (this.speedMps > 0.4) {
                acceleration -= brake * this.currentTuning.brakeDecel;
            } else {
                acceleration -= brake * this.reverseAccel;
            }
        }

        if (throttle <= 0.01 && brake <= 0.01) {
            acceleration -= speedSign * (this.engineBrakeDecel + speedAbs * 0.015);
        }

        const aero = this.aeroDrag * this.speedMps * speedAbs;
        const rolling = this.rollingResistance * speedSign;
        acceleration -= aero + rolling;

        if (!this.grounded) {
            acceleration *= 0.38;
        }

        this.speedMps += acceleration * deltaSeconds;

        if (handbrake > 0.2 && speedAbs > 8) {
            const handbrakeDamping =
                this.currentTuning.drivetrain === 'RWD' ? 0.68 : 0.44;
            this.speedMps *= 1 - handbrake * handbrakeDamping * deltaSeconds;
        }

        this.speedMps = THREE.MathUtils.clamp(
            this.speedMps,
            -this.maxReverseSpeedMps,
            this.maxForwardSpeedMps
        );

        if (Math.abs(this.speedMps) < 0.04 && throttle < 0.05 && brake < 0.05) {
            this.speedMps = 0;
        }
    }

    updateSteering(
        deltaSeconds: number,
        steer: number,
        handbrake: number,
        throttle: number
    ) {
        const speed = Math.abs(this.speedMps);
        const speedFactor = THREE.MathUtils.clamp(speed / 52, 0, 1);
        const maxSteerAngle = THREE.MathUtils.degToRad(
            this.currentTuning.maxSteerAngleDeg
        ) * STEERING_SENSITIVITY_SCALE;
        const steerScale = THREE.MathUtils.lerp(1, 0.5, speedFactor);
        const targetSteerAngle = steer * maxSteerAngle * steerScale;
        const steerLerp = THREE.MathUtils.clamp(
            deltaSeconds * 12 * STEERING_SENSITIVITY_SCALE,
            0,
            1
        );
        this.steerAngle = THREE.MathUtils.lerp(
            this.steerAngle,
            targetSteerAngle,
            steerLerp
        );

        if (speed < 0.2) {
            this.lateralSpeed = THREE.MathUtils.lerp(this.lateralSpeed, 0, steerLerp);
            this.driftAmount = Math.max(0, this.driftAmount - deltaSeconds * 4);
            return;
        }

        const wheelBase = Math.max(2.2, this.bodySize.z * 0.62);
        let yawRate =
            (this.speedMps / wheelBase) *
            Math.tan(this.steerAngle);

        const driftEligible =
            this.currentTuning.drivetrain === 'RWD' &&
            handbrake > 0.2 &&
            throttle > 0.2 &&
            speed > DRIFT_ENTRY_SPEED_MPS &&
            Math.abs(steer) > 0.18;

        if (driftEligible) {
            this.driftAmount = Math.min(1, this.driftAmount + deltaSeconds * 2.5);
            this.lateralSpeed +=
                steer *
                speed *
                (0.78 + this.driftAmount * 1.26) *
                deltaSeconds;
            yawRate +=
                steer *
                (0.84 + this.driftAmount * 1.32);
        } else {
            const releaseSpeed = speed > DRIFT_RELEASE_SPEED_MPS ? 1.2 : 2.4;
            this.driftAmount = Math.max(0, this.driftAmount - deltaSeconds * releaseSpeed);
        }

        const baseLateralGrip =
            this.currentTuning.drivetrain === 'AWD'
                ? 6.9
                : this.currentTuning.drivetrain === 'FWD'
                ? 7.4
                : 5.6;
        const driftGripScale = THREE.MathUtils.lerp(1, 0.14, this.driftAmount);
        const handbrakeGripScale =
            this.currentTuning.drivetrain === 'RWD'
                ? THREE.MathUtils.lerp(1, 0.24, handbrake)
                : THREE.MathUtils.lerp(1, 0.45, handbrake);
        const damping = baseLateralGrip * driftGripScale * handbrakeGripScale;
        this.lateralSpeed = THREE.MathUtils.lerp(
            this.lateralSpeed,
            0,
            THREE.MathUtils.clamp(deltaSeconds * damping, 0, 1)
        );

        const counterSteer =
            -Math.sign(this.lateralSpeed) *
            Math.min(1.4, Math.abs(this.lateralSpeed) * 0.078) *
            (1 - this.driftAmount * 0.45);
        yawRate += counterSteer;

        this.yaw += yawRate * deltaSeconds;
    }

    updatePosition(deltaSeconds: number) {
        this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).normalize();
        this.tmpVectorA
            .copy(this.forward)
            .projectOnPlane(this.surfaceNormal)
            .normalize();

        if (this.tmpVectorA.lengthSq() > 0.0001) {
            this.forward.copy(this.tmpVectorA);
        }

        this.tmpVectorB
            .crossVectors(this.surfaceNormal, this.forward)
            .normalize();

        this.velocity
            .copy(this.forward)
            .multiplyScalar(this.speedMps)
            .addScaledVector(this.tmpVectorB, this.lateralSpeed);

        this.position.addScaledVector(this.velocity, deltaSeconds);

        const speedAbs = Math.abs(this.speedMps);
        this.slipRatio = THREE.MathUtils.clamp(
            Math.abs(this.lateralSpeed) / Math.max(2, speedAbs + 1),
            0,
            1
        );
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
            this.position.y = hit.point.y + this.rideHeight;
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

    updateDrivetrain(deltaSeconds: number, throttle: number, brake: number) {
        const wheelRpm =
            (Math.abs(this.speedMps) / (Math.PI * 2 * this.wheelRadius)) * 60;

        if (this.speedMps < -0.5) {
            this.gear = -1;
            const reverseRpm =
                this.currentTuning.idleRpm +
                wheelRpm *
                    this.currentTuning.reverseRatio *
                    this.currentTuning.finalDrive;
            this.rpm = THREE.MathUtils.clamp(
                reverseRpm,
                this.currentTuning.idleRpm,
                this.currentTuning.redlineRpm * 0.86
            );
            return;
        }

        if (this.gear < 1) {
            this.gear = 1;
        }

        const maxGear = this.currentTuning.gearRatios.length;
        const currentRatio =
            this.currentTuning.gearRatios[this.gear - 1] ||
            this.currentTuning.gearRatios[0];
        let rpmTarget =
            this.currentTuning.idleRpm +
            wheelRpm * currentRatio * this.currentTuning.finalDrive;

        if (rpmTarget > this.currentTuning.shiftUpRpm && this.gear < maxGear) {
            this.gear++;
            UIEventBus.dispatch('race:gearShift', {
                gear: this.gear,
                carId: this.currentCarId,
            });
        } else if (
            rpmTarget < this.currentTuning.shiftDownRpm &&
            this.gear > 1 &&
            throttle < 0.72 &&
            brake < 0.85
        ) {
            this.gear--;
            UIEventBus.dispatch('race:gearShift', {
                gear: this.gear,
                carId: this.currentCarId,
            });
        }

        const shiftedRatio =
            this.currentTuning.gearRatios[this.gear - 1] ||
            this.currentTuning.gearRatios[0];
        rpmTarget =
            this.currentTuning.idleRpm +
            wheelRpm * shiftedRatio * this.currentTuning.finalDrive;
        rpmTarget = THREE.MathUtils.clamp(
            rpmTarget,
            this.currentTuning.idleRpm,
            this.currentTuning.redlineRpm
        );

        const rpmLerp = THREE.MathUtils.clamp(deltaSeconds * 12, 0, 1);
        this.rpm = THREE.MathUtils.lerp(this.rpm, rpmTarget, rpmLerp);
    }

    updateWheelVisuals(deltaSeconds: number) {
        if (!this.wheelRig.length) return;

        this.wheelSpinAngle +=
            (this.speedMps / Math.max(0.1, this.wheelRadius)) * deltaSeconds;
        this.steerVisualAngle = THREE.MathUtils.lerp(
            this.steerVisualAngle,
            this.steerAngle,
            THREE.MathUtils.clamp(deltaSeconds * 14, 0, 1)
        );

        const steerQuaternion = this.tmpQuatA.setFromAxisAngle(
            new THREE.Vector3(0, 1, 0),
            this.steerVisualAngle
        );

        this.wheelRig.forEach((wheel) => {
            const spinQuaternion = this.tmpQuatB.setFromAxisAngle(
                new THREE.Vector3(1, 0, 0),
                this.wheelSpinAngle * wheel.spinSign
            );

            wheel.object.quaternion.copy(wheel.baseQuaternion);
            if (wheel.front) {
                wheel.object.quaternion.multiply(steerQuaternion);
            }
            wheel.object.quaternion.multiply(spinQuaternion);
        });
    }

    updateDriftSmoke(deltaSeconds: number) {
        this.smokeSpawnCooldown -= deltaSeconds;
        const driftIntensity = this.getDriftIntensity();

        if (
            this.grounded &&
            driftIntensity > 0.28 &&
            this.smokeSpawnCooldown <= 0
        ) {
            this.getRearWheelWorldPositions().forEach((position) => {
                this.smoke.emit(position, driftIntensity, Math.abs(this.speedMps));
            });
            this.smokeSpawnCooldown = SMOKE_SPAWN_INTERVAL;
        }

        this.smoke.update(deltaSeconds);
    }

    getRearWheelWorldPositions() {
        if (this.rearWheelRig.length > 0) {
            return this.rearWheelRig.map((wheel) =>
                wheel.object.getWorldPosition(new THREE.Vector3())
            );
        }

        const rearOffset = Math.max(1.1, this.bodySize.z * 0.3);
        const sideOffset = Math.max(0.5, this.bodySize.x * 0.22);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.carPivot.quaternion);
        const rear = this.forward.clone().multiplyScalar(-rearOffset);
        const side = new THREE.Vector3()
            .crossVectors(up, this.forward)
            .normalize()
            .multiplyScalar(sideOffset);

        return [
            this.position
                .clone()
                .add(rear)
                .add(side)
                .addScaledVector(up, 0.08),
            this.position
                .clone()
                .add(rear)
                .addScaledVector(side, -1)
                .addScaledVector(up, 0.08),
        ];
    }

    getDriftIntensity() {
        return THREE.MathUtils.clamp(
            this.slipRatio * 0.9 + this.driftAmount * 0.95,
            0,
            1
        );
    }

    getCameraAnchor() {
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.carPivot.quaternion);
        const anchorHeight = Math.max(0.8, this.bodySize.y * 0.58);
        return this.position.clone().addScaledVector(up, anchorHeight);
    }

    getCameraBodyRadius() {
        return this.bodyRadius;
    }

    getTelemetry(): VehicleTelemetry {
        const speedMagnitude = this.velocity.length();
        return {
            speedMps: this.speedMps,
            speedKph: speedMagnitude * 3.6,
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
            drivetrain: this.currentTuning.drivetrain,
            slipRatio: this.slipRatio,
            driftIntensity: this.getDriftIntensity(),
        };
    }
}
