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
const DRIFT_VISUAL_MAX_ANGLE_RAD = THREE.MathUtils.degToRad(68);
const SMOKE_SPAWN_INTERVAL = 0.03;
const STEERING_SENSITIVITY_SCALE = 0.132;
const LOW_SPEED_STEER_BOOST = 2.05;
const LOW_SPEED_STEER_BOOST_FADE_MPS = 24;
const LOW_SPEED_STEER_RESPONSE_BOOST = 1.9;
const DRIFT_FULL_SPEED_MPS = 23;
const WHEEL_RADIUS_PLAUSIBLE_MIN = 0.12;
const WHEEL_RADIUS_PLAUSIBLE_MAX = 1.4;
const LOW_SPEED_GROUNDING_BLEND_SPEED_MPS = 10;
const LOW_SPEED_GROUNDING_LERP_MIN = 3.5;
const LOW_SPEED_GROUNDING_LERP_MAX = 30;
const LOW_SPEED_GROUNDING_MAX_STEP_MIN = 0.006;
const LOW_SPEED_GROUNDING_MAX_STEP_MAX = 0.09;
const SURFACE_NORMAL_BLEND_SPEED_MPS = 16;
const SURFACE_NORMAL_LERP_MIN = 1.5;
const SURFACE_NORMAL_LERP_MAX = 8.2;
const LOW_SPEED_UPRIGHT_BLEND_FADE_MPS = 14;
const LOW_SPEED_UPRIGHT_BLEND_MAX = 0.74;
const MIN_SURFACE_NORMAL_Y = 0.72;
const MIN_ORIENTATION_NORMAL_Y = 0.84;
const AIRBORNE_ACCEL_MULTIPLIER_TRANSIENT = 0.82;
const AIRBORNE_ACCEL_MULTIPLIER_SUSTAINED = 0.5;
const AIRBORNE_TRANSIENT_WINDOW_S = 0.32;
const SAFE_CHECKPOINT_MIN_INTERVAL_S = 0.08;
const FALL_RECOVERY_DELAY_S = 1.35;
const FALL_RECOVERY_LOOKBACK_S = 2.2;
const FALL_RECOVERY_COOLDOWN_S = 1.1;
const FALL_RECOVERY_LOOKBACK_STEP_S = 1.15;
const FALL_RECOVERY_MAX_FAILURES = 5;
const FALL_RECOVERY_MIN_DISTANCE_M = 10;
const FALL_RECOVERY_REPEAT_RADIUS_M = 8;
const POST_RECOVERY_CHECKPOINT_GRACE_S = 1.2;
const SAFE_STATE_HISTORY_RETENTION_S = 8;
const SAFE_STATE_HISTORY_MAX_ENTRIES = 120;
const SAFE_STATE_MIN_SNAPSHOT_INTERVAL_S = 0.14;
const SAFE_STATE_MIN_SNAPSHOT_DISTANCE = 0.6;
const UPSIDE_DOWN_RECOVERY_UP_THRESHOLD = -0.2;
const UPSIDE_DOWN_RECOVERY_DELAY_S = 0.6;
const FRONT_WHEEL_VISUAL_STEER_MULTIPLIER = 1.45;
const LOW_SPEED_VISUAL_STEER_BOOST = 1.65;
const SHARED_TOP_SPEED_KPH = 300;
const SHARED_ZERO_TO_HUNDRED_SEC = 3.55;
const SHARED_BRAKE_DECEL = 42;
const SHARED_AERO_DRAG = 0.00014;
const SHARED_ROLLING_RESISTANCE = 0.34;
const SHARED_MAX_STEER_ANGLE_DEG = 34;
const AMG_ONE_ID = 'amg-one';
const BMW_E92_M3_ID = 'bmw-e92-m3';
const BMW_F90_M5_COMPETITION_ID = 'bmw-f90-m5-competition';
const MERCEDES_GT63S_EDITION_ONE_ID = 'mercedes-gt63s-edition-one';
const TOYOTA_CROWN_ID = 'toyota-crown-platinum';
const TOYOTA_SPLIT_GROUP_FRONT_LEFT = 'toyota_split_wheel_front_left';
const TOYOTA_SPLIT_GROUP_FRONT_RIGHT = 'toyota_split_wheel_front_right';
const TOYOTA_SPLIT_GROUP_REAR_LEFT = 'toyota_split_wheel_rear_left';
const TOYOTA_SPLIT_GROUP_REAR_RIGHT = 'toyota_split_wheel_rear_right';
// Toyota GLB exports axle-pair wheel meshes. Split each axle by lateral axis.
const TOYOTA_SPLIT_FRONT_SOURCE_HINTS = ['220_black_0', '260_black_0'];
const TOYOTA_SPLIT_REAR_SOURCE_HINTS = ['228_black_0', '276_black_0'];
const TOYOTA_SPLIT_FRONT_ATTACHMENT_SOURCE_HINTS = [
    '523_refl_black_0',
    '531_refl_black_0',
];
const TOYOTA_SPLIT_REAR_ATTACHMENT_SOURCE_HINTS = [
    '539_refl_black_0',
    '547_refl_black_0',
];
const TOYOTA_CORNER_FRONT_LEFT_ATTACHMENT_HINTS = ['316_black_0'];
const TOYOTA_CORNER_FRONT_RIGHT_ATTACHMENT_HINTS = [
    '356_black_0',
    '523_refl_black_0_1',
];
const TOYOTA_CORNER_REAR_LEFT_ATTACHMENT_HINTS = ['340_black_0'];
const TOYOTA_CORNER_REAR_RIGHT_ATTACHMENT_HINTS = [
    '348_black_0',
    '539_refl_black_0_1',
];
const TOYOTA_SUPPRESSED_STATIC_WHEEL_HINTS = [
    '316_black_0',
    '356_black_0',
    '340_black_0',
    '348_black_0',
    '523_refl_black_0_1',
    '539_refl_black_0_1',
];
const AMG_ONE_RACE_BLUE = new THREE.Color(0x050f2f);
const BMW_E92_RIM_SILVER = new THREE.Color(0xd3d8de);
const BMW_F90_M5_TANZANITE_BLUE = new THREE.Color(0x0c2c84);
const TOYOTA_CROWN_SILVER = new THREE.Color(0x8f9296);
const GT63_DECAL_HINTS = [
    'stripe',
    'decal',
    'livery',
    'edition',
    'mizo',
    'satin metallic blue',
    'satin metallic red',
    'satin metallic dark',
];
const WHEEL_NAME_HINT_REGEX =
    /(^|[^a-z])(wheel|tire|tyre|rim)([^a-z]|$)/i;
const WHEEL_MATERIAL_HINT_REGEX =
    /(wheel|tire|tyre|rim|rubber|michelin)/i;
const NON_WHEEL_NAME_HINT_REGEX =
    /(trim|decal|dirt|dust|mud|grime|glass|window|windshield|body|door|hood|trunk|mirror|bumper|panel|steering|brake|disc|disk|rotor|caliper|hub|suspension)/i;
const BRAKE_WHEEL_PART_HINT_REGEX = /(brake|disc|disk|rotor|caliper|hub)/i;
const FIXED_BRAKE_PART_HINT_REGEX = /(brake|caliper)/i;
const WHEEL_LINKED_ATTACHMENT_HINT_REGEX = /(hub|disc|disk|rotor|rim|spoke)/i;
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
    linkedVisuals: Array<{
        object: THREE.Object3D;
        spinCenter: THREE.Vector3;
        basePosition: THREE.Vector3;
        baseQuaternion: THREE.Quaternion;
    }>;
    front: boolean;
    rear: boolean;
    left: boolean;
    mappedCorner: boolean;
    localCenter: THREE.Vector3;
    spinCenter: THREE.Vector3;
    basePosition: THREE.Vector3;
    baseQuaternion: THREE.Quaternion;
    spinAxis: THREE.Vector3;
    spinSign: number;
    radius: number;
};

export type LinkedWheelVisualMeta = {
    objectName: string;
    spinCenter: [number, number, number];
    basePosition: [number, number, number];
    baseQuaternion: [number, number, number, number];
};

export type WheelVisualMeta = {
    objectName: string;
    front: boolean;
    spinCenter: [number, number, number];
    basePosition: [number, number, number];
    baseQuaternion: [number, number, number, number];
    spinAxis: [number, number, number];
    spinSign: number;
    linkedVisuals: LinkedWheelVisualMeta[];
};

type WheelNodeMap = NonNullable<CarRaceConfig['wheelNodeMap']>;

type SafeStateSnapshot = {
    time: number;
    position: THREE.Vector3;
    forward: THREE.Vector3;
    surfaceNormal: THREE.Vector3;
    yaw: number;
    speedMps: number;
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
    airborneTime: number;
    upsideDownTime: number;
    recoveryCooldown: number;
    recoveryClock: number;
    postRecoveryCheckpointLockout: number;
    lastRecoveryAt: number;
    lastRecoveryPosition: THREE.Vector3;
    safeCheckpointTimer: number;
    lastSafePosition: THREE.Vector3;
    lastSafeForward: THREE.Vector3;
    lastSafeSurfaceNormal: THREE.Vector3;
    lastSafeYaw: number;
    lastSafeSpeedMps: number;
    safeStateHistory: SafeStateSnapshot[];
    fallAnchorValid: boolean;
    fallAnchorPosition: THREE.Vector3;
    fallAnchorForward: THREE.Vector3;
    fallAnchorYaw: number;
    fallAnchorSpeedMps: number;
    fallRecoveryFailures: number;
    wheelRig: WheelRig[];
    frontWheelRig: WheelRig[];
    rearWheelRig: WheelRig[];
    smoke: DriftSmoke;
    smokeSpawnCooldown: number;
    tmpVectorA: THREE.Vector3;
    tmpVectorB: THREE.Vector3;
    tmpVectorC: THREE.Vector3;
    tmpVectorD: THREE.Vector3;
    tmpVectorE: THREE.Vector3;
    tmpVectorF: THREE.Vector3;
    tmpMatrix: THREE.Matrix4;
    tmpQuatA: THREE.Quaternion;
    tmpQuatB: THREE.Quaternion;
    tmpQuatC: THREE.Quaternion;
    tmpQuatD: THREE.Quaternion;
    tmpQuatE: THREE.Quaternion;
    tmpQuatG: THREE.Quaternion;

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
        this.maxForwardSpeedMps = SHARED_TOP_SPEED_KPH / 3.6;
        this.maxReverseSpeedMps = MAX_REVERSE_SPEED_KPH / 3.6;
        this.engineAccelBase = 8;
        this.reverseAccel = 5.5;
        this.engineBrakeDecel = 2.2;
        this.aeroDrag = SHARED_AERO_DRAG;
        this.rollingResistance = SHARED_ROLLING_RESISTANCE;
        this.bodyRadius = 2.4;
        this.bodySize = new THREE.Vector3(4.7, 1.4, 2.1);
        this.position = new THREE.Vector3();
        this.velocity = new THREE.Vector3();
        this.surfaceNormal = new THREE.Vector3(0, 1, 0);
        this.forward = new THREE.Vector3(0, 0, 1);
        this.orientationTarget = new THREE.Quaternion();
        this.airborneTime = 0;
        this.upsideDownTime = 0;
        this.recoveryCooldown = 0;
        this.recoveryClock = 0;
        this.postRecoveryCheckpointLockout = 0;
        this.lastRecoveryAt = -Infinity;
        this.lastRecoveryPosition = new THREE.Vector3();
        this.safeCheckpointTimer = 0;
        this.lastSafePosition = new THREE.Vector3();
        this.lastSafeForward = new THREE.Vector3(0, 0, 1);
        this.lastSafeSurfaceNormal = new THREE.Vector3(0, 1, 0);
        this.lastSafeYaw = 0;
        this.lastSafeSpeedMps = 0;
        this.safeStateHistory = [];
        this.fallAnchorValid = false;
        this.fallAnchorPosition = new THREE.Vector3();
        this.fallAnchorForward = new THREE.Vector3(0, 0, 1);
        this.fallAnchorYaw = 0;
        this.fallAnchorSpeedMps = 0;
        this.fallRecoveryFailures = 0;
        this.wheelRig = [];
        this.frontWheelRig = [];
        this.rearWheelRig = [];

        this.tmpVectorA = new THREE.Vector3();
        this.tmpVectorB = new THREE.Vector3();
        this.tmpVectorC = new THREE.Vector3();
        this.tmpVectorD = new THREE.Vector3();
        this.tmpVectorE = new THREE.Vector3();
        this.tmpVectorF = new THREE.Vector3();
        this.tmpMatrix = new THREE.Matrix4();
        this.tmpQuatA = new THREE.Quaternion();
        this.tmpQuatB = new THREE.Quaternion();
        this.tmpQuatC = new THREE.Quaternion();
        this.tmpQuatD = new THREE.Quaternion();
        this.tmpQuatE = new THREE.Quaternion();
        this.tmpQuatG = new THREE.Quaternion();

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
        this.maxForwardSpeedMps = SHARED_TOP_SPEED_KPH / 3.6;
        this.maxReverseSpeedMps = MAX_REVERSE_SPEED_KPH / 3.6;

        this.wheelRadius = this.currentTuning.wheelRadiusMeters;
        this.rideHeight = THREE.MathUtils.clamp(this.wheelRadius * 0.98, 0.16, 0.52);

        const zeroToHundred = SHARED_ZERO_TO_HUNDRED_SEC;
        this.engineAccelBase = 27.7778 / zeroToHundred;
        this.reverseAccel = this.engineAccelBase * 0.56;
        this.engineBrakeDecel = THREE.MathUtils.lerp(1.8, 3.1, this.engineAccelBase / 10);
        this.aeroDrag = SHARED_AERO_DRAG;
        this.rollingResistance = SHARED_ROLLING_RESISTANCE;

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

        this.ensurePreparedModel(carId).then((model) => {
            if (!model) return;
            this.swapModelIfCurrent(carId, model);
        });
    }

    ensurePreparedModel(carId: string): Promise<THREE.Group | null> {
        const prepared = this.getPreparedModel(carId);
        if (prepared) return Promise.resolve(prepared);

        const option = carOptionsById[carId];
        if (!option) return Promise.resolve(null);

        const existingPromise = this.loadingPromises.get(carId);
        if (existingPromise) {
            return existingPromise
                .then((model) => model)
                .catch(() => null);
        }

        const loadPromise = new Promise<THREE.Group>((resolve, reject) => {
            this.resources.loaders.gltfLoader.load(
                option.modelPath,
                (gltf) => {
                    this.resources.items.gltfModel[option.resourceName] = gltf;
                    const loadedModel = this.prepareModel(gltf.scene.clone(true), carId);
                    resolve(loadedModel);
                },
                undefined,
                (error) => {
                    reject(error);
                }
            );
        });

        this.loadingPromises.set(carId, loadPromise);
        loadPromise
            .then((loadedModel) => {
                this.cachedModels.set(carId, loadedModel);
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

        return loadPromise
            .then((loadedModel) => loadedModel)
            .catch(() => null);
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
        const mappedWheelNodeMap = option?.race.wheelNodeMap;
        const hasMappedWheelCorners = this.hasExplicitWheelNodeCorners(
            mappedWheelNodeMap
        );
        const rawLength = this.getModelLength(model);
        const scale = option && rawLength > 0 ? option.lengthMeters / rawLength : 1;
        model.scale.setScalar(scale);
        model.rotation.set(
            0,
            hasMappedWheelCorners ? 0 : this.getVisualForwardOffsetY(model),
            0
        );

        if (
            option?.race.visualForwardAxis === 'negativeZ' &&
            !hasMappedWheelCorners
        ) {
            model.rotation.y += Math.PI;
        }

        this.alignModelLongitudinalAxisFromWheelMap(
            model,
            mappedWheelNodeMap
        );
        model.updateMatrixWorld(true);
        this.alignVisualFrontToPositiveZ(model);
        if (option?.race.visualYawOffsetDeg) {
            model.rotation.y += THREE.MathUtils.degToRad(
                option.race.visualYawOffsetDeg
            );
        }
        model.updateMatrixWorld(true);

        let wheelNodeMapForRig = mappedWheelNodeMap;
        if (carId === TOYOTA_CROWN_ID) {
            wheelNodeMapForRig =
                this.ensureToyotaSplitWheelNodeMap(model, mappedWheelNodeMap) ||
                mappedWheelNodeMap;
        }

        let wheelRig = this.buildWheelRig(model, wheelNodeMapForRig);
        for (let attempt = 0; attempt < 2; attempt++) {
            const correctionY =
                this.getModelForwardCorrectionFromMappedWheels(wheelRig);
            if (Math.abs(correctionY) <= 1e-4) break;
            model.rotation.y += correctionY;
            model.updateMatrixWorld(true);
            wheelRig = this.buildWheelRig(model, wheelNodeMapForRig);
        }
        wheelRig = this.filterValidWheelRig(carId, wheelRig);
        this.applyWheelFinishStyling(model, carId, wheelRig);
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
        model.userData.raceWheelMeta = this.buildWheelVisualMetadata(wheelRig);
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

    buildWheelVisualMetadata(wheels: WheelRig[]): WheelVisualMeta[] {
        return wheels.map((wheel) => ({
            objectName: wheel.object.name || '',
            front: wheel.front,
            spinCenter: [
                wheel.spinCenter.x,
                wheel.spinCenter.y,
                wheel.spinCenter.z,
            ],
            basePosition: [
                wheel.basePosition.x,
                wheel.basePosition.y,
                wheel.basePosition.z,
            ],
            baseQuaternion: [
                wheel.baseQuaternion.x,
                wheel.baseQuaternion.y,
                wheel.baseQuaternion.z,
                wheel.baseQuaternion.w,
            ],
            spinAxis: [wheel.spinAxis.x, wheel.spinAxis.y, wheel.spinAxis.z],
            spinSign: wheel.spinSign,
            linkedVisuals: wheel.linkedVisuals.map((linked) => ({
                objectName: linked.object.name || '',
                spinCenter: [
                    linked.spinCenter.x,
                    linked.spinCenter.y,
                    linked.spinCenter.z,
                ],
                basePosition: [
                    linked.basePosition.x,
                    linked.basePosition.y,
                    linked.basePosition.z,
                ],
                baseQuaternion: [
                    linked.baseQuaternion.x,
                    linked.baseQuaternion.y,
                    linked.baseQuaternion.z,
                    linked.baseQuaternion.w,
                ],
            })),
        }));
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

    alignModelLongitudinalAxisFromWheelMap(
        model: THREE.Object3D,
        wheelNodeMap?: WheelNodeMap
    ) {
        if (!wheelNodeMap) return;

        const explicitCorners: Array<{
            front: boolean;
            names?: string[];
        }> = [
            {
                front: true,
                names: wheelNodeMap.frontLeft,
            },
            {
                front: true,
                names: wheelNodeMap.frontRight,
            },
            {
                front: false,
                names: wheelNodeMap.rearLeft,
            },
            {
                front: false,
                names: wheelNodeMap.rearRight,
            },
        ];

        const hasExplicitCorners = explicitCorners.some(
            (entry) => (entry.names || []).length > 0
        );
        if (!hasExplicitCorners) return;

        const mappedCenters: Array<{
            front: boolean;
            center: THREE.Vector3;
        }> = [];
        const center = new THREE.Vector3();
        model.updateMatrixWorld(true);

        for (const corner of explicitCorners) {
            const matchedNode = this.findNodeByHints(model, corner.names || []);
            if (!matchedNode) continue;
            const node = this.resolveMappedWheelNode(matchedNode, model);
            if (!node) continue;

            const box = new THREE.Box3().setFromObject(node);
            if (box.isEmpty()) continue;

            box.getCenter(center);
            this.toScaledModelSpace(center, model);
            mappedCenters.push({
                front: corner.front,
                center: center.clone(),
            });
        }

        if (mappedCenters.length < 4) return;

        const frontCenters = mappedCenters.filter((entry) => entry.front);
        const rearCenters = mappedCenters.filter((entry) => !entry.front);
        if (frontCenters.length < 2 || rearCenters.length < 2) return;

        const frontAverageX =
            frontCenters.reduce((sum, entry) => sum + entry.center.x, 0) /
            frontCenters.length;
        const rearAverageX =
            rearCenters.reduce((sum, entry) => sum + entry.center.x, 0) /
            rearCenters.length;
        const frontAverageZ =
            frontCenters.reduce((sum, entry) => sum + entry.center.z, 0) /
            frontCenters.length;
        const rearAverageZ =
            rearCenters.reduce((sum, entry) => sum + entry.center.z, 0) /
            rearCenters.length;
        const longitudinalDeltaX = frontAverageX - rearAverageX;
        const longitudinalDeltaZ = frontAverageZ - rearAverageZ;

        if (Math.abs(longitudinalDeltaX) <= Math.abs(longitudinalDeltaZ) * 1.02) {
            return;
        }

        // Rotate X-forward rigs so +Z remains the single steering/yaw frame.
        model.rotation.y += longitudinalDeltaX >= 0 ? -Math.PI / 2 : Math.PI / 2;
    }

    getModelForwardCorrectionFromMappedWheels(wheels: WheelRig[]) {
        const mappedFront = wheels.filter(
            (wheel) => wheel.mappedCorner && wheel.front
        );
        const mappedRear = wheels.filter(
            (wheel) => wheel.mappedCorner && wheel.rear
        );

        if (!mappedFront.length || !mappedRear.length) return 0;

        const frontAverage =
            mappedFront.reduce((sum, wheel) => sum + wheel.localCenter.z, 0) /
            mappedFront.length;
        const rearAverage =
            mappedRear.reduce((sum, wheel) => sum + wheel.localCenter.z, 0) /
            mappedRear.length;
        const frontAverageX =
            mappedFront.reduce((sum, wheel) => sum + wheel.localCenter.x, 0) /
            mappedFront.length;
        const rearAverageX =
            mappedRear.reduce((sum, wheel) => sum + wheel.localCenter.x, 0) /
            mappedRear.length;
        const longitudinalDeltaZ = frontAverage - rearAverage;
        const longitudinalDeltaX = frontAverageX - rearAverageX;
        const dominantDelta =
            Math.abs(longitudinalDeltaZ) >= Math.abs(longitudinalDeltaX)
                ? longitudinalDeltaZ
                : longitudinalDeltaX;

        // X-dominant rigs are handled before this phase. Keep this pass to front/back only.
        if (Math.abs(longitudinalDeltaX) > Math.abs(longitudinalDeltaZ) * 1.02) {
            return 0;
        }

        if (dominantDelta < 0) {
            return Math.PI;
        }

        return 0;
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

    getWheelSpinCenter(node: THREE.Object3D, box: THREE.Box3) {
        const centerWorld = box.getCenter(new THREE.Vector3());
        if (!node.parent) return centerWorld;
        return node.parent.worldToLocal(centerWorld.clone());
    }

    getWheelLinkedSpinCenter(
        linkedNode: THREE.Object3D,
        wheelCenterWorld: THREE.Vector3
    ) {
        if (!linkedNode.parent) return wheelCenterWorld.clone();
        return linkedNode.parent.worldToLocal(wheelCenterWorld.clone());
    }

    collectWheelLinkedVisuals(
        cornerNode: THREE.Object3D,
        primaryNode: THREE.Object3D,
        primaryRadius: number,
        model: THREE.Object3D
    ) {
        const primaryBox = new THREE.Box3().setFromObject(primaryNode);
        if (primaryBox.isEmpty()) return [] as WheelRig['linkedVisuals'];
        const primaryCenterWorld = primaryBox.getCenter(new THREE.Vector3());

        if (this.isToyotaSplitWheelObject(cornerNode, primaryNode)) {
            return this.collectToyotaSplitLinkedVisuals(
                cornerNode,
                primaryNode,
                primaryRadius,
                model,
                primaryCenterWorld
            );
        }

        const linked = new Map<
            string,
            {
                object: THREE.Object3D;
                spinCenter: THREE.Vector3;
                basePosition: THREE.Vector3;
                baseQuaternion: THREE.Quaternion;
            }
        >();
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        const primaryCenter = primaryCenterWorld.clone();
        this.toScaledModelSpace(primaryCenter, model);
        const maxCenterDistance = Math.max(0.22, primaryRadius * 0.86);

        cornerNode.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;
            if (child.uuid === primaryNode.uuid) return;

            const childName = (child.name || '').toLowerCase();
            const wheelLikeMaterial = this.meshHasWheelLikeMaterial(child);
            const wheelLinkedAttachmentMaterial =
                this.meshHasWheelLinkedAttachmentMaterial(child);
            const wheelLinkedAttachmentName =
                this.isWheelLinkedAttachmentName(childName);
            const wheelLikeName =
                this.isWheelName(childName) ||
                this.isWheelHubLikeName(childName) ||
                wheelLinkedAttachmentName;
            if (
                NON_WHEEL_NAME_HINT_REGEX.test(childName) &&
                !this.isWheelHubLikeName(childName) &&
                !wheelLinkedAttachmentName &&
                !wheelLinkedAttachmentMaterial
            ) {
                return;
            }
            if (this.isFixedBrakePartObject(child)) return;
            if (
                !wheelLikeMaterial &&
                !wheelLikeName &&
                !wheelLinkedAttachmentMaterial
            ) {
                return;
            }

            const box = new THREE.Box3().setFromObject(child);
            if (box.isEmpty()) return;

            box.getSize(size);
            const radius = Math.max(size.x, size.y, size.z) * 0.5;
            if (!this.isWheelRadiusPlausible(radius)) return;
            const minLinkedRadius = wheelLikeMaterial
                ? primaryRadius * 0.2
                : wheelLinkedAttachmentName || wheelLinkedAttachmentMaterial
                ? primaryRadius * 0.09
                : primaryRadius * 0.34;
            if (radius < minLinkedRadius) return;

            box.getCenter(center);
            this.toScaledModelSpace(center, model);
            if (center.distanceTo(primaryCenter) > maxCenterDistance) return;

            linked.set(child.uuid, {
                object: child,
                spinCenter: this.getWheelLinkedSpinCenter(
                    child,
                    primaryCenterWorld
                ),
                basePosition: child.position.clone(),
                baseQuaternion: child.quaternion.clone(),
            });
        });

        if (linked.size < 3) {
            const fallbackPoolRoot =
                cornerNode.parent || primaryNode.parent || model;
            this.collectWheelLinkedVisualsFromPool(
                fallbackPoolRoot,
                primaryNode,
                primaryRadius,
                primaryCenter,
                primaryCenterWorld,
                model,
                linked
            );
        }

        return Array.from(linked.values());
    }

    collectWheelLinkedVisualsFromPool(
        poolRoot: THREE.Object3D,
        primaryNode: THREE.Object3D,
        primaryRadius: number,
        primaryCenter: THREE.Vector3,
        primaryCenterWorld: THREE.Vector3,
        model: THREE.Object3D,
        linked: Map<
            string,
            {
                object: THREE.Object3D;
                spinCenter: THREE.Vector3;
                basePosition: THREE.Vector3;
                baseQuaternion: THREE.Quaternion;
            }
        >
    ) {
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        const minRadius = primaryRadius * 0.32;
        const maxRadius = primaryRadius * 2.4;
        const maxCenterDistance = Math.max(0.34, primaryRadius * 1.8);
        const maxVerticalDelta = Math.max(0.24, primaryRadius * 1.1);

        poolRoot.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;
            if (child.uuid === primaryNode.uuid) return;
            if (this.isFixedBrakePartObject(child)) return;

            const childName = (child.name || '').toLowerCase();
            const wheelLikeMaterial = this.meshHasWheelLikeMaterial(child);
            const wheelLinkedAttachmentMaterial =
                this.meshHasWheelLinkedAttachmentMaterial(child);
            const wheelLinkedAttachmentName =
                this.isWheelLinkedAttachmentName(childName);
            const wheelLikeName =
                this.isWheelName(childName) || wheelLinkedAttachmentName;
            if (
                NON_WHEEL_NAME_HINT_REGEX.test(childName) &&
                !wheelLikeMaterial &&
                !this.isWheelHubLikeName(childName) &&
                !wheelLinkedAttachmentName &&
                !wheelLinkedAttachmentMaterial
            ) {
                return;
            }
            if (
                !wheelLikeMaterial &&
                !wheelLikeName &&
                !wheelLinkedAttachmentMaterial
            ) {
                return;
            }

            const box = new THREE.Box3().setFromObject(child);
            if (box.isEmpty()) return;
            box.getSize(size);

            const radius = Math.max(size.x, size.y, size.z) * 0.5;
            if (!this.isWheelRadiusPlausible(radius)) return;
            const linkedMinRadius =
                wheelLikeMaterial || wheelLikeName
                    ? minRadius
                    : primaryRadius * 0.09;
            if (radius < linkedMinRadius || radius > maxRadius) return;

            box.getCenter(center);
            this.toScaledModelSpace(center, model);
            if (center.distanceTo(primaryCenter) > maxCenterDistance) return;
            if (Math.abs(center.y - primaryCenter.y) > maxVerticalDelta) return;

            linked.set(child.uuid, {
                object: child,
                spinCenter: this.getWheelLinkedSpinCenter(
                    child,
                    primaryCenterWorld
                ),
                basePosition: child.position.clone(),
                baseQuaternion: child.quaternion.clone(),
            });
        });
    }

    collectToyotaSplitLinkedVisuals(
        cornerNode: THREE.Object3D,
        primaryNode: THREE.Object3D,
        primaryRadius: number,
        model: THREE.Object3D,
        primaryCenterWorld: THREE.Vector3
    ) {
        const linked = new Map<
            string,
            {
                object: THREE.Object3D;
                spinCenter: THREE.Vector3;
                basePosition: THREE.Vector3;
                baseQuaternion: THREE.Quaternion;
            }
        >();
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        const primaryCenter = new THREE.Vector3();
        const primaryBox = new THREE.Box3().setFromObject(primaryNode);
        if (primaryBox.isEmpty()) return [] as WheelRig['linkedVisuals'];

        primaryBox.getCenter(primaryCenter);
        this.toScaledModelSpace(primaryCenter, model);


        cornerNode.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;
            if (child.uuid === primaryNode.uuid) return;

            const childName = (child.name || '').toLowerCase();
            if (childName.startsWith('toyota_split_wheel_')) return;
            if (this.isFixedBrakePartObject(child)) return;

            const box = new THREE.Box3().setFromObject(child);
            if (box.isEmpty()) return;

            box.getSize(size);
            const radius = Math.max(size.x, size.y, size.z) * 0.5;
            if (!this.isWheelRadiusPlausible(radius)) return;
            const minLinkedRadius = primaryRadius * 0.04;
            if (radius < minLinkedRadius) return;

            box.getCenter(center);
            this.toScaledModelSpace(center, model);

            linked.set(child.uuid, {
                object: child,
                spinCenter: this.getWheelLinkedSpinCenter(
                    child,
                    primaryCenterWorld
                ),
                basePosition: child.position.clone(),
                baseQuaternion: child.quaternion.clone(),
            });
        });

        return Array.from(linked.values());
    }

    isToyotaSplitWheelObject(cornerNode: THREE.Object3D, primaryNode: THREE.Object3D) {
        const names = [
            cornerNode?.name || '',
            primaryNode?.name || '',
            primaryNode?.parent?.name || '',
        ]
            .map((name) => String(name || '').toLowerCase())
            .filter(Boolean);

        return names.some(
            (name) => name.includes('__toyota_') || name.startsWith('toyota_split_wheel_')
        );
    }

    ensureToyotaSplitWheelNodeMap(
        model: THREE.Object3D,
        fallbackWheelNodeMap?: WheelNodeMap
    ): WheelNodeMap | undefined {
        const existingGroups = [
            TOYOTA_SPLIT_GROUP_FRONT_LEFT,
            TOYOTA_SPLIT_GROUP_FRONT_RIGHT,
            TOYOTA_SPLIT_GROUP_REAR_LEFT,
            TOYOTA_SPLIT_GROUP_REAR_RIGHT,
        ].every((name) => Boolean(model.getObjectByName(name)));

        if (!existingGroups) {
            const created = this.createToyotaSplitWheelGroups(
                model,
                fallbackWheelNodeMap
            );
            if (!created) {
                return fallbackWheelNodeMap;
            }
        }

        return {
            frontLeft: [TOYOTA_SPLIT_GROUP_FRONT_LEFT],
            frontRight: [TOYOTA_SPLIT_GROUP_FRONT_RIGHT],
            rearLeft: [TOYOTA_SPLIT_GROUP_REAR_LEFT],
            rearRight: [TOYOTA_SPLIT_GROUP_REAR_RIGHT],
            candidates: [
                TOYOTA_SPLIT_GROUP_FRONT_LEFT,
                TOYOTA_SPLIT_GROUP_FRONT_RIGHT,
                TOYOTA_SPLIT_GROUP_REAR_LEFT,
                TOYOTA_SPLIT_GROUP_REAR_RIGHT,
            ],
        };
    }

    createToyotaSplitWheelGroups(
        model: THREE.Object3D,
        fallbackWheelNodeMap?: WheelNodeMap
    ) {
        const cornerCenters = this.getMappedWheelCornerCenters(
            model,
            fallbackWheelNodeMap
        );
        if (!cornerCenters) {
            return false;
        }

        const frontAverage = new THREE.Vector3()
            .copy(cornerCenters.frontLeft)
            .add(cornerCenters.frontRight)
            .multiplyScalar(0.5);
        const rearAverage = new THREE.Vector3()
            .copy(cornerCenters.rearLeft)
            .add(cornerCenters.rearRight)
            .multiplyScalar(0.5);
        const leftAverage = new THREE.Vector3()
            .copy(cornerCenters.frontLeft)
            .add(cornerCenters.rearLeft)
            .multiplyScalar(0.5);
        const rightAverage = new THREE.Vector3()
            .copy(cornerCenters.frontRight)
            .add(cornerCenters.rearRight)
            .multiplyScalar(0.5);

        const frontRearDeltaX = frontAverage.x - rearAverage.x;
        const frontRearDeltaZ = frontAverage.z - rearAverage.z;
        const leftRightDeltaX = leftAverage.x - rightAverage.x;
        const leftRightDeltaZ = leftAverage.z - rightAverage.z;
        const longitudinalAxis: 'x' | 'z' =
            Math.abs(frontRearDeltaX) >= Math.abs(frontRearDeltaZ) ? 'x' : 'z';
        const lateralAxis: 'x' | 'z' = longitudinalAxis === 'x' ? 'z' : 'x';
        const leftPositiveDirection =
            lateralAxis === 'x' ? leftRightDeltaX >= 0 : leftRightDeltaZ >= 0;

        const frontSourceMatch = this.findFirstNodeByHintPriority(
            model,
            TOYOTA_SPLIT_FRONT_SOURCE_HINTS
        );
        const rearSourceMatch = this.findFirstNodeByHintPriority(
            model,
            TOYOTA_SPLIT_REAR_SOURCE_HINTS
        );
        if (!frontSourceMatch || !rearSourceMatch) {
            return false;
        }

        const frontSourceNode = this.resolveMappedWheelNode(frontSourceMatch, model);
        const rearSourceNode = this.resolveMappedWheelNode(rearSourceMatch, model);
        if (
            !(frontSourceNode instanceof THREE.Mesh) ||
            !(rearSourceNode instanceof THREE.Mesh)
        ) {
            return false;
        }

        const frontAxleSplit = this.splitToyotaWheelMeshByAxis(
            frontSourceNode,
            model,
            lateralAxis,
            leftPositiveDirection
        );
        const rearAxleSplit = this.splitToyotaWheelMeshByAxis(
            rearSourceNode,
            model,
            lateralAxis,
            leftPositiveDirection
        );
        if (!frontAxleSplit || !rearAxleSplit) {
            return false;
        }

        const frontLeftGroup = new THREE.Group();
        frontLeftGroup.name = TOYOTA_SPLIT_GROUP_FRONT_LEFT;
        const frontRightGroup = new THREE.Group();
        frontRightGroup.name = TOYOTA_SPLIT_GROUP_FRONT_RIGHT;
        const rearLeftGroup = new THREE.Group();
        rearLeftGroup.name = TOYOTA_SPLIT_GROUP_REAR_LEFT;
        const rearRightGroup = new THREE.Group();
        rearRightGroup.name = TOYOTA_SPLIT_GROUP_REAR_RIGHT;
        const consumedSplitSourceNodes = new Set<string>([
            frontSourceNode.uuid,
            rearSourceNode.uuid,
        ]);

        frontAxleSplit.frontMesh.name = `${frontSourceNode.name}__toyota_front_left`;
        frontAxleSplit.rearMesh.name = `${frontSourceNode.name}__toyota_front_right`;
        rearAxleSplit.frontMesh.name = `${rearSourceNode.name}__toyota_rear_left`;
        rearAxleSplit.rearMesh.name = `${rearSourceNode.name}__toyota_rear_right`;

        frontLeftGroup.add(frontAxleSplit.frontMesh);
        frontRightGroup.add(frontAxleSplit.rearMesh);
        rearLeftGroup.add(rearAxleSplit.frontMesh);
        rearRightGroup.add(rearAxleSplit.rearMesh);
        this.addToyotaSplitAttachmentMeshes(
            model,
            TOYOTA_SPLIT_FRONT_ATTACHMENT_SOURCE_HINTS,
            'front',
            lateralAxis,
            leftPositiveDirection,
            frontLeftGroup,
            frontRightGroup,
            consumedSplitSourceNodes
        );
        this.addToyotaSplitAttachmentMeshes(
            model,
            TOYOTA_SPLIT_REAR_ATTACHMENT_SOURCE_HINTS,
            'rear',
            lateralAxis,
            leftPositiveDirection,
            rearLeftGroup,
            rearRightGroup,
            consumedSplitSourceNodes
        );
        this.attachToyotaCornerAttachmentNodes(
            model,
            TOYOTA_CORNER_FRONT_LEFT_ATTACHMENT_HINTS,
            frontLeftGroup,
            consumedSplitSourceNodes
        );
        this.attachToyotaCornerAttachmentNodes(
            model,
            TOYOTA_CORNER_FRONT_RIGHT_ATTACHMENT_HINTS,
            frontRightGroup,
            consumedSplitSourceNodes
        );
        this.attachToyotaCornerAttachmentNodes(
            model,
            TOYOTA_CORNER_REAR_LEFT_ATTACHMENT_HINTS,
            rearLeftGroup,
            consumedSplitSourceNodes
        );
        this.attachToyotaCornerAttachmentNodes(
            model,
            TOYOTA_CORNER_REAR_RIGHT_ATTACHMENT_HINTS,
            rearRightGroup,
            consumedSplitSourceNodes
        );
        this.hideToyotaSuppressedStaticWheelNodes(
            model,
            TOYOTA_SUPPRESSED_STATIC_WHEEL_HINTS
        );
        model.add(frontLeftGroup, frontRightGroup, rearLeftGroup, rearRightGroup);

        frontSourceNode.visible = false;
        rearSourceNode.visible = false;
        model.updateMatrixWorld(true);
        return true;
    }

    addToyotaSplitAttachmentMeshes(
        model: THREE.Object3D,
        sourceHints: string[],
        axleLabel: 'front' | 'rear',
        lateralAxis: 'x' | 'z',
        leftPositiveDirection: boolean,
        leftGroup: THREE.Group,
        rightGroup: THREE.Group,
        consumedSplitSourceNodes: Set<string>
    ) {
        sourceHints.forEach((hint, index) => {
            const sourceMatch = this.findNodeByHints(model, [hint]);
            if (!sourceMatch) return;
            const sourceNode = this.resolveMappedWheelNode(sourceMatch, model);
            if (!(sourceNode instanceof THREE.Mesh)) return;
            if (consumedSplitSourceNodes.has(sourceNode.uuid)) return;

            const split = this.splitToyotaWheelMeshByAxis(
                sourceNode,
                model,
                lateralAxis,
                leftPositiveDirection
            );
            if (!split) return;

            consumedSplitSourceNodes.add(sourceNode.uuid);
            split.frontMesh.name = `${sourceNode.name}__toyota_${axleLabel}_left_${index}`;
            split.rearMesh.name = `${sourceNode.name}__toyota_${axleLabel}_right_${index}`;
            leftGroup.add(split.frontMesh);
            rightGroup.add(split.rearMesh);
            sourceNode.visible = false;
        });
    }

    attachToyotaCornerAttachmentNodes(
        model: THREE.Object3D,
        sourceHints: string[],
        targetGroup: THREE.Group,
        consumedSplitSourceNodes: Set<string>
    ) {
        sourceHints.forEach((hint) => {
            const sourceMatch = this.findNodeByHints(model, [hint]);
            if (!sourceMatch) return;
            const sourceNode = this.resolveMappedWheelNode(sourceMatch, model);
            if (!(sourceNode instanceof THREE.Mesh)) return;
            if (consumedSplitSourceNodes.has(sourceNode.uuid)) return;
            if (!sourceNode.parent) return;

            consumedSplitSourceNodes.add(sourceNode.uuid);
            targetGroup.attach(sourceNode);
        });
    }

    hideToyotaSuppressedStaticWheelNodes(model: THREE.Object3D, sourceHints: string[]) {
        const normalizedHints = sourceHints.map((hint) =>
            this.normalizeNameToken(hint)
        );
        model.traverse((child) => {
            const childName = this.normalizeNameToken(child.name || '');
            if (!childName) return;
            if (
                normalizedHints.some(
                    (hint) => childName === hint || childName.includes(hint)
                )
            ) {
                child.visible = false;
            }
        });
    }

    findFirstNodeByHintPriority(model: THREE.Object3D, hints: string[]) {
        for (const hint of hints) {
            const matched = this.findNodeByHints(model, [hint]);
            if (matched) {
                return matched;
            }
        }
        return null;
    }

    getMappedWheelCornerCenters(
        model: THREE.Object3D,
        wheelNodeMap?: WheelNodeMap
    ) {
        if (!wheelNodeMap) return null;

        const box = new THREE.Box3();
        const center = new THREE.Vector3();
        const readCenter = (hints?: string[]) => {
            const matchedNode = this.findNodeByHints(model, hints || []);
            if (!matchedNode) return null;
            const node = this.resolveMappedWheelNode(matchedNode, model);
            if (!node) return null;
            box.setFromObject(node);
            if (box.isEmpty()) return null;
            box.getCenter(center);
            this.toScaledModelSpace(center, model);
            return center.clone();
        };

        const frontLeft = readCenter(wheelNodeMap.frontLeft);
        const frontRight = readCenter(wheelNodeMap.frontRight);
        const rearLeft = readCenter(wheelNodeMap.rearLeft);
        const rearRight = readCenter(wheelNodeMap.rearRight);
        if (!frontLeft || !frontRight || !rearLeft || !rearRight) {
            return null;
        }

        return {
            frontLeft,
            frontRight,
            rearLeft,
            rearRight,
        };
    }

    splitToyotaWheelMeshByAxis(
        mesh: THREE.Mesh,
        model: THREE.Object3D,
        preferredAxis: 'x' | 'z',
        frontPositiveDirection: boolean
    ) {
        const geometry = mesh.geometry as THREE.BufferGeometry;
        const nonIndexedGeometry = geometry.index
            ? geometry.toNonIndexed()
            : geometry.clone();
        const position = nonIndexedGeometry.getAttribute('position');
        if (!(position instanceof THREE.BufferAttribute)) {
            return null;
        }

        const triangleCount = Math.floor(position.count / 3);
        if (triangleCount < 2) return null;

        mesh.updateMatrixWorld(true);
        model.updateMatrixWorld(true);
        const sourceToModel = new THREE.Matrix4()
            .copy(model.matrixWorld)
            .invert()
            .multiply(mesh.matrixWorld);
        const sourceBox = new THREE.Box3().setFromObject(mesh);
        if (sourceBox.isEmpty()) return null;
        const sourceCenterModel = sourceBox.getCenter(new THREE.Vector3());
        model.worldToLocal(sourceCenterModel);

        const triA = new THREE.Vector3();
        const triB = new THREE.Vector3();
        const triC = new THREE.Vector3();
        const splitByAxis = (axis: 'x' | 'z') => {
            const splitValue =
                axis === 'x' ? sourceCenterModel.x : sourceCenterModel.z;
            const frontTriangleStarts: number[] = [];
            const rearTriangleStarts: number[] = [];

            for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex++) {
                const i0 = triangleIndex * 3;
                const i1 = i0 + 1;
                const i2 = i0 + 2;

                triA
                    .set(position.getX(i0), position.getY(i0), position.getZ(i0))
                    .applyMatrix4(sourceToModel);
                triB
                    .set(position.getX(i1), position.getY(i1), position.getZ(i1))
                    .applyMatrix4(sourceToModel);
                triC
                    .set(position.getX(i2), position.getY(i2), position.getZ(i2))
                    .applyMatrix4(sourceToModel);
                const centroid =
                    axis === 'x'
                        ? (triA.x + triB.x + triC.x) / 3
                        : (triA.z + triB.z + triC.z) / 3;

                if (centroid >= splitValue) {
                    frontTriangleStarts.push(i0);
                } else {
                    rearTriangleStarts.push(i0);
                }
            }

            return {
                axis,
                frontTriangleStarts,
                rearTriangleStarts,
            };
        };

        const fallbackAxis = preferredAxis === 'x' ? 'z' : 'x';
        const preferredSplit = splitByAxis(preferredAxis);
        const fallbackSplit = splitByAxis(fallbackAxis);
        let split =
            preferredSplit.frontTriangleStarts.length >= 4 &&
            preferredSplit.rearTriangleStarts.length >= 4
                ? preferredSplit
                : fallbackSplit;

        if (
            split.frontTriangleStarts.length < 4 ||
            split.rearTriangleStarts.length < 4
        ) {
            return null;
        }

        const sourceAttributes = Object.entries(nonIndexedGeometry.attributes).filter(
            ([, attribute]) => attribute instanceof THREE.BufferAttribute
        ) as Array<[string, THREE.BufferAttribute]>;
        if (!sourceAttributes.length) {
            return null;
        }

        const buildSplitGeometry = (triangleStarts: number[]) => {
            const splitGeometry = new THREE.BufferGeometry();
            for (const [attributeName, attribute] of sourceAttributes) {
                const itemSize = attribute.itemSize;
                const valueCount = triangleStarts.length * 3 * itemSize;
                const ArrayType = (attribute.array as any).constructor as {
                    new (length: number): ArrayLike<number>;
                };
                const values = new ArrayType(valueCount) as any;
                let writeOffset = 0;

                for (const triangleStart of triangleStarts) {
                    for (let vertexOffset = 0; vertexOffset < 3; vertexOffset++) {
                        const vertexIndex = triangleStart + vertexOffset;
                        const sourceOffset = vertexIndex * itemSize;
                        for (let component = 0; component < itemSize; component++) {
                            values[writeOffset++] =
                                (attribute.array as any)[sourceOffset + component];
                        }
                    }
                }

                splitGeometry.setAttribute(
                    attributeName,
                    new THREE.BufferAttribute(
                        values,
                        itemSize,
                        attribute.normalized
                    )
                );
            }
            splitGeometry.computeBoundingBox();
            splitGeometry.computeBoundingSphere();
            return splitGeometry;
        };

        let frontGeometry = buildSplitGeometry(split.frontTriangleStarts);
        let rearGeometry = buildSplitGeometry(split.rearTriangleStarts);
        const splitPosition = new THREE.Vector3();
        const splitQuaternion = new THREE.Quaternion();
        const splitScale = new THREE.Vector3();
        sourceToModel.decompose(splitPosition, splitQuaternion, splitScale);
        const toModelCenter = (splitGeometry: THREE.BufferGeometry) => {
            const center = splitGeometry.boundingBox
                ? splitGeometry.boundingBox.getCenter(new THREE.Vector3())
                : new THREE.Vector3();
            return center.applyMatrix4(sourceToModel);
        };

        const frontCenterModel = toModelCenter(frontGeometry);
        const rearCenterModel = toModelCenter(rearGeometry);
        const frontCoord =
            split.axis === 'x' ? frontCenterModel.x : frontCenterModel.z;
        const rearCoord =
            split.axis === 'x' ? rearCenterModel.x : rearCenterModel.z;
        const frontIsPositive = frontCoord >= rearCoord;
        if (frontIsPositive !== frontPositiveDirection) {
            const temp = frontGeometry;
            frontGeometry = rearGeometry;
            rearGeometry = temp;
        }

        const frontMesh = new THREE.Mesh(frontGeometry, mesh.material);
        frontMesh.castShadow = mesh.castShadow;
        frontMesh.receiveShadow = mesh.receiveShadow;
        frontMesh.position.copy(splitPosition);
        frontMesh.quaternion.copy(splitQuaternion);
        frontMesh.scale.copy(splitScale);
        frontMesh.updateMatrixWorld(true);

        const rearMesh = new THREE.Mesh(rearGeometry, mesh.material);
        rearMesh.castShadow = mesh.castShadow;
        rearMesh.receiveShadow = mesh.receiveShadow;
        rearMesh.position.copy(splitPosition);
        rearMesh.quaternion.copy(splitQuaternion);
        rearMesh.scale.copy(splitScale);
        rearMesh.updateMatrixWorld(true);

        return {
            frontMesh,
            rearMesh,
        };
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
                const matchedNode = this.findNodeByHints(model, corner.names || []);
                if (!matchedNode) continue;
                const node = this.resolveMappedWheelNode(matchedNode, model);
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
                    linkedVisuals: this.collectWheelLinkedVisuals(
                        matchedNode,
                        node,
                        radius,
                        model
                    ),
                    front: corner.front,
                    rear: !corner.front,
                    left: corner.left,
                    mappedCorner: true,
                    localCenter: center.clone(),
                    spinCenter: this.getWheelSpinCenter(node, box),
                    basePosition: node.position.clone(),
                    baseQuaternion: node.quaternion.clone(),
                    spinAxis: new THREE.Vector3(1, 0, 0),
                    spinSign: corner.left ? 1 : -1,
                    radius,
                });
            }

            if (mappedWheels.length >= 4) {
                this.configureWheelSpinAxes(mappedWheels, model);
                return mappedWheels;
            }
        }

        if (!wheelNodeMap.candidates || wheelNodeMap.candidates.length === 0) {
            return [];
        }

        for (const hint of wheelNodeMap.candidates) {
            const matchedNode = this.findNodeByHints(model, [hint]);
            if (!matchedNode) continue;
            const node = this.resolveMappedWheelNode(matchedNode, model);
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
            if (!this.isWheelRadiusMatchTuning(radius)) continue;

            box.getCenter(center);
            this.toScaledModelSpace(center, model);

            candidateWheels.push({
                object: node,
                linkedVisuals: [],
                front: false,
                rear: false,
                left: false,
                mappedCorner: false,
                localCenter: center.clone(),
                spinCenter: this.getWheelSpinCenter(node, box),
                basePosition: node.position.clone(),
                baseQuaternion: node.quaternion.clone(),
                spinAxis: new THREE.Vector3(1, 0, 0),
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
        this.configureWheelSpinAxes(combined, model);
        return combined;
    }

    findNodeByHints(
        model: THREE.Object3D,
        hints: string[]
    ): THREE.Object3D | null {
        if (!hints.length) return null;

        const loweredHints = hints.map((hint) => hint.toLowerCase());
        const normalizedHints = loweredHints.map((hint) =>
            this.normalizeNameToken(hint)
        );
        let exactMatch: THREE.Object3D | null = null;
        let containsMatch: THREE.Object3D | null = null;

        model.traverse((child) => {
            if (exactMatch) return;
            const childName = (child.name || '').toLowerCase();
            if (!childName) return;
            const normalizedChildName = this.normalizeNameToken(childName);

            for (let i = 0; i < loweredHints.length; i++) {
                const hint = loweredHints[i];
                const normalizedHint = normalizedHints[i];

                if (childName === hint) {
                    exactMatch = child;
                    return;
                }
                if (
                    normalizedHint &&
                    normalizedChildName === normalizedHint
                ) {
                    exactMatch = child;
                    return;
                }
                if (!containsMatch && childName.includes(hint)) {
                    containsMatch = child;
                }
                if (
                    !containsMatch &&
                    normalizedHint &&
                    normalizedChildName.includes(normalizedHint)
                ) {
                    containsMatch = child;
                }
            }
        });

        return exactMatch || containsMatch;
    }

    normalizeNameToken(value: string) {
        return String(value || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '');
    }

    hasExplicitWheelNodeCorners(wheelNodeMap?: WheelNodeMap) {
        if (!wheelNodeMap) return false;
        return (
            (wheelNodeMap.frontLeft || []).length > 0 ||
            (wheelNodeMap.frontRight || []).length > 0 ||
            (wheelNodeMap.rearLeft || []).length > 0 ||
            (wheelNodeMap.rearRight || []).length > 0
        );
    }

    isBrakeLikeWheelPartName(name: string) {
        const lowered = String(name || '').toLowerCase();
        if (!lowered) return false;
        if (this.isWheelHubLikeName(lowered)) {
            return false;
        }
        return BRAKE_WHEEL_PART_HINT_REGEX.test(lowered);
    }

    isFixedBrakePartName(name: string) {
        const lowered = String(name || '').toLowerCase();
        if (!lowered) return false;
        return FIXED_BRAKE_PART_HINT_REGEX.test(lowered);
    }

    isWheelHubLikeName(name: string) {
        const lowered = String(name || '').toLowerCase();
        if (!lowered.includes('hub')) return false;
        return (
            lowered.includes('tire_hub') ||
            lowered.includes('wheel_hub') ||
            lowered.includes('rim_hub') ||
            lowered.includes('hubcap')
        );
    }

    isBrakeLikeWheelPartObject(node: THREE.Object3D) {
        if (this.isBrakeLikeWheelPartName(node.name || '')) {
            return true;
        }

        if (!(node instanceof THREE.Mesh) || !node.material) {
            return false;
        }

        const materials = Array.isArray(node.material)
            ? node.material
            : [node.material];
        return materials.some((material) =>
            this.isBrakeLikeWheelPartName(material?.name || '')
        );
    }

    isFixedBrakePartObject(node: THREE.Object3D) {
        if (this.isFixedBrakePartName(node.name || '')) {
            return true;
        }

        if (!(node instanceof THREE.Mesh) || !node.material) {
            return false;
        }

        const materials = Array.isArray(node.material)
            ? node.material
            : [node.material];
        return materials.some((material) =>
            this.isFixedBrakePartName(material?.name || '')
        );
    }

    isWheelLinkedAttachmentName(name: string) {
        const lowered = String(name || '').toLowerCase();
        if (!lowered) return false;
        return WHEEL_LINKED_ATTACHMENT_HINT_REGEX.test(lowered);
    }

    resolveMappedWheelNode(
        mappedNode: THREE.Object3D,
        model: THREE.Object3D
    ): THREE.Object3D | null {
        let bestMesh: THREE.Mesh | null = null;
        let bestRadius = -Infinity;
        const size = new THREE.Vector3();

        const considerMesh = (mesh: THREE.Mesh) => {
            const meshName = (mesh.name || '').toLowerCase();
            if (this.isBrakeLikeWheelPartObject(mesh)) return;
            if (NON_WHEEL_NAME_HINT_REGEX.test(meshName)) return;

            const box = new THREE.Box3().setFromObject(mesh);
            if (box.isEmpty()) return;

            box.getSize(size);
            const radius = Math.max(size.x, size.y, size.z) * 0.5;
            if (!this.isWheelRadiusPlausible(radius)) return;

            if (!bestMesh || radius > bestRadius) {
                bestMesh = mesh;
                bestRadius = radius;
            }
        };

        if (mappedNode instanceof THREE.Mesh) {
            considerMesh(mappedNode);
        }

        mappedNode.traverse((child) => {
            if (child === mappedNode) return;
            if (!(child instanceof THREE.Mesh)) return;
            considerMesh(child);
        });

        if (bestMesh) {
            return bestMesh;
        }

        if (this.isBrakeLikeWheelPartObject(mappedNode)) {
            return null;
        }

        const fallbackBox = new THREE.Box3().setFromObject(mappedNode);
        if (fallbackBox.isEmpty()) {
            return null;
        }
        fallbackBox.getSize(size);
        const fallbackRadius = Math.max(size.x, size.y, size.z) * 0.5;
        if (!this.isWheelRadiusPlausible(fallbackRadius)) {
            return null;
        }

        return mappedNode;
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
                spinCenter: THREE.Vector3;
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
            if (!this.isWheelRadiusMatchTuning(radius)) return;

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
                spinCenter: this.getWheelSpinCenter(node, box),
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
                linkedVisuals: [],
                front,
                rear: !front,
                left,
                mappedCorner: false,
                localCenter: candidate.center.clone(),
                spinCenter: candidate.spinCenter.clone(),
                basePosition: candidate.object.position.clone(),
                baseQuaternion: candidate.object.quaternion.clone(),
                spinAxis: new THREE.Vector3(1, 0, 0),
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
            this.configureWheelSpinAxes(combined, model);
            return combined;
        }
        return [];
    }

    reclassifyWheelRigByGeometry(wheels: WheelRig[]) {
        if (wheels.length < 4) return;

        const xValues = wheels.map((wheel) => wheel.localCenter.x);
        const zValues = wheels.map((wheel) => wheel.localCenter.z);
        const xRange = Math.max(...xValues) - Math.min(...xValues);
        const zRange = Math.max(...zValues) - Math.min(...zValues);
        const longitudinalUsesZ = zRange >= xRange;

        const longitudinalValues = wheels.map((wheel) =>
            longitudinalUsesZ ? wheel.localCenter.z : wheel.localCenter.x
        );
        const lateralValues = wheels.map((wheel) =>
            longitudinalUsesZ ? wheel.localCenter.x : wheel.localCenter.z
        );
        const longitudinalMedian = this.getMedian(longitudinalValues);
        const lateralMedian = this.getMedian(lateralValues);

        let frontPositive = true;
        const mappedFront = wheels.filter((wheel) => wheel.front);
        const mappedRear = wheels.filter((wheel) => wheel.rear);
        if (mappedFront.length >= 1 && mappedRear.length >= 1) {
            const frontAverage =
                mappedFront.reduce((sum, wheel) => {
                    const value = longitudinalUsesZ
                        ? wheel.localCenter.z
                        : wheel.localCenter.x;
                    return sum + value;
                }, 0) / mappedFront.length;
            const rearAverage =
                mappedRear.reduce((sum, wheel) => {
                    const value = longitudinalUsesZ
                        ? wheel.localCenter.z
                        : wheel.localCenter.x;
                    return sum + value;
                }, 0) / mappedRear.length;
            if (Math.abs(frontAverage - rearAverage) > 1e-6) {
                frontPositive = frontAverage >= rearAverage;
            }
        }

        wheels.forEach((wheel) => {
            const longitudinal = longitudinalUsesZ
                ? wheel.localCenter.z
                : wheel.localCenter.x;
            const lateral = longitudinalUsesZ
                ? wheel.localCenter.x
                : wheel.localCenter.z;

            const front = frontPositive
                ? longitudinal >= longitudinalMedian
                : longitudinal <= longitudinalMedian;
            wheel.front = front;
            wheel.rear = !front;
            wheel.left = lateral <= lateralMedian;
            wheel.spinSign = wheel.left ? 1 : -1;
        });
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

    configureWheelSpinAxes(wheels: WheelRig[], model?: THREE.Object3D) {
        if (!wheels.length) return;
        const spinDirectionMultiplier =
            this.currentTuning.wheelSpinDirectionMultiplier === -1 ? -1 : 1;

        const modelObject = model || this.carModel;
        const modelQuaternion = this.tmpQuatA.identity();
        if (modelObject) {
            modelObject.getWorldQuaternion(modelQuaternion);
        }

        const xValues = wheels.map((wheel) => wheel.localCenter.x);
        const zValues = wheels.map((wheel) => wheel.localCenter.z);
        const xRange = Math.max(...xValues) - Math.min(...xValues);
        const zRange = Math.max(...zValues) - Math.min(...zValues);
        const longitudinalUsesZ = zRange >= xRange;
        let leftWheels = wheels.filter((wheel) => wheel.left);
        let rightWheels = wheels.filter((wheel) => !wheel.left);
        let frontWheels = wheels.filter((wheel) => wheel.front);
        let rearWheels = wheels.filter((wheel) => wheel.rear);

        // Fallback when wheel corner flags are missing or invalid.
        if (
            leftWheels.length === 0 ||
            rightWheels.length === 0 ||
            frontWheels.length === 0 ||
            rearWheels.length === 0
        ) {
            const lateralValues = wheels.map((wheel) =>
                longitudinalUsesZ ? wheel.localCenter.x : wheel.localCenter.z
            );
            const longitudinalValues = wheels.map((wheel) =>
                longitudinalUsesZ ? wheel.localCenter.z : wheel.localCenter.x
            );
            const lateralMedian = this.getMedian(lateralValues);
            const longitudinalMedian = this.getMedian(longitudinalValues);

            wheels.forEach((wheel) => {
                const lateral = longitudinalUsesZ
                    ? wheel.localCenter.x
                    : wheel.localCenter.z;
                const longitudinal = longitudinalUsesZ
                    ? wheel.localCenter.z
                    : wheel.localCenter.x;
                wheel.left = lateral <= lateralMedian;
                wheel.front = longitudinal >= longitudinalMedian;
                wheel.rear = !wheel.front;
            });
            leftWheels = wheels.filter((wheel) => wheel.left);
            rightWheels = wheels.filter((wheel) => !wheel.left);
            frontWheels = wheels.filter((wheel) => wheel.front);
            rearWheels = wheels.filter((wheel) => wheel.rear);
        }

        const modelRightWorld = this.tmpVectorC
            .set(1, 0, 0)
            .applyQuaternion(modelQuaternion)
            .normalize();
        const modelForwardWorld = this.tmpVectorD
            .set(0, 0, 1)
            .applyQuaternion(modelQuaternion)
            .normalize();

        const averageLocalAxis = (subset: WheelRig[], axis: 'x' | 'z') => {
            if (!subset.length) return 0;
            const sum = subset.reduce((acc, wheel) => {
                return acc + (axis === 'x' ? wheel.localCenter.x : wheel.localCenter.z);
            }, 0);
            return sum / subset.length;
        };

        if (leftWheels.length && rightWheels.length) {
            const lateralDeltaX =
                averageLocalAxis(rightWheels, 'x') -
                averageLocalAxis(leftWheels, 'x');
            const lateralDeltaZ =
                averageLocalAxis(rightWheels, 'z') -
                averageLocalAxis(leftWheels, 'z');
            const lateralUsesX =
                Math.abs(lateralDeltaX) >= Math.abs(lateralDeltaZ);
            const lateralDelta = lateralUsesX ? lateralDeltaX : lateralDeltaZ;
            if (Math.abs(lateralDelta) > 1e-6) {
                const sign = lateralDelta >= 0 ? 1 : -1;
                this.tmpVectorA.set(
                    lateralUsesX ? sign : 0,
                    0,
                    lateralUsesX ? 0 : sign
                );
                modelRightWorld
                    .copy(this.tmpVectorA)
                    .applyQuaternion(modelQuaternion)
                    .normalize();
            }
        }

        if (frontWheels.length && rearWheels.length) {
            const longitudinalDeltaX =
                averageLocalAxis(frontWheels, 'x') -
                averageLocalAxis(rearWheels, 'x');
            const longitudinalDeltaZ =
                averageLocalAxis(frontWheels, 'z') -
                averageLocalAxis(rearWheels, 'z');
            const longitudinalUsesX =
                Math.abs(longitudinalDeltaX) >= Math.abs(longitudinalDeltaZ);
            const longitudinalDelta = longitudinalUsesX
                ? longitudinalDeltaX
                : longitudinalDeltaZ;
            if (Math.abs(longitudinalDelta) > 1e-6) {
                const sign = longitudinalDelta >= 0 ? 1 : -1;
                this.tmpVectorB.set(
                    longitudinalUsesX ? sign : 0,
                    0,
                    longitudinalUsesX ? 0 : sign
                );
                modelForwardWorld
                    .copy(this.tmpVectorB)
                    .applyQuaternion(modelQuaternion)
                    .normalize();
            }
        }

        if (Math.abs(modelRightWorld.dot(modelForwardWorld)) > 0.96) {
            modelRightWorld.set(1, 0, 0).applyQuaternion(modelQuaternion).normalize();
            modelForwardWorld
                .set(0, 0, 1)
                .applyQuaternion(modelQuaternion)
                .normalize();
        }

        const modelDownWorld = this.tmpVectorA
            .crossVectors(modelRightWorld, modelForwardWorld)
            .normalize();
        if (modelDownWorld.lengthSq() <= 1e-8) {
            modelDownWorld.set(0, -1, 0).applyQuaternion(modelQuaternion).normalize();
        }

        const axisCandidates = [
            new THREE.Vector3(1, 0, 0),
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(0, 0, 1),
        ];
        const worldAxis = new THREE.Vector3();
        const bestWorldAxis = new THREE.Vector3();
        const contactVelocity = new THREE.Vector3();

        wheels.forEach((wheel) => {
            if (!wheel.spinAxis) {
                wheel.spinAxis = new THREE.Vector3(1, 0, 0);
            }
            let bestAxis = axisCandidates[0];
            let bestScore = -Infinity;

            wheel.object.getWorldQuaternion(this.tmpQuatB);
            axisCandidates.forEach((axis) => {
                worldAxis.copy(axis).applyQuaternion(this.tmpQuatB).normalize();
                const lateralAlignment = Math.abs(worldAxis.dot(modelRightWorld));
                contactVelocity
                    .crossVectors(worldAxis, modelDownWorld)
                    .normalize();
                const forwardAlignment =
                    contactVelocity.lengthSq() > 1e-8
                        ? Math.abs(contactVelocity.dot(modelForwardWorld))
                        : 0;
                const score = forwardAlignment * 0.82 + lateralAlignment * 0.18;

                if (score > bestScore) {
                    bestScore = score;
                    bestAxis = axis;
                    bestWorldAxis.copy(worldAxis);
                }
            });

            wheel.spinAxis.copy(bestAxis).normalize();
            let spinSign = wheel.left ? 1 : -1;

            if (bestScore > 0.2) {
                contactVelocity
                    .crossVectors(bestWorldAxis, modelDownWorld)
                    .normalize();
                if (contactVelocity.lengthSq() > 1e-8) {
                    spinSign =
                        contactVelocity.dot(modelForwardWorld) <= 0 ? 1 : -1;
                }
            }

            wheel.spinSign = spinSign * spinDirectionMultiplier;
        });
    }

    getDetectedWheelRadius(wheels: WheelRig[]) {
        if (!wheels.length) return this.currentTuning.wheelRadiusMeters;
        const average =
            wheels.reduce((sum, wheel) => sum + wheel.radius, 0) / wheels.length;
        const tunedRadius = this.currentTuning.wheelRadiusMeters;
        const delta = Math.abs(average - tunedRadius);
        if (delta > tunedRadius * 0.14) {
            return tunedRadius;
        }
        const blended = THREE.MathUtils.lerp(tunedRadius, average, 0.35);
        return THREE.MathUtils.clamp(
            blended,
            tunedRadius * 0.9,
            tunedRadius * 1.1
        );
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
        // Keep wheel centers in scaled model-local units for stable rig geometry checks.
        center.multiplyScalar(model.scale.x || 1);
    }

    isWheelRadiusPlausible(radius: number) {
        return (
            Number.isFinite(radius) &&
            radius >= WHEEL_RADIUS_PLAUSIBLE_MIN &&
            radius <= WHEEL_RADIUS_PLAUSIBLE_MAX
        );
    }

    isWheelRadiusMatchTuning(radius: number) {
        const tunedRadius = this.currentTuning.wheelRadiusMeters;
        if (!Number.isFinite(radius) || radius <= 0) {
            return false;
        }
        if (radius < tunedRadius * 0.4) {
            return false;
        }
        if (radius > tunedRadius * 1.7) {
            return false;
        }
        return true;
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

    meshHasWheelLikeMaterial(mesh: THREE.Mesh) {
        if (!mesh.material) return false;
        const materials = Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material];
        return materials.some((material) =>
            this.isWheelMaterialName(material?.name || '')
        );
    }

    meshHasWheelLinkedAttachmentMaterial(mesh: THREE.Mesh) {
        if (!mesh.material) return false;
        const materials = Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material];
        return materials.some((material) =>
            this.isWheelLinkedAttachmentName(material?.name || '')
        );
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

            if (
                child.material &&
                !Array.isArray(child.material)
            ) {
                const material = child.material as THREE.MeshStandardMaterial;
                this.applyTextureQuality(material);
            }

            if (carId === MERCEDES_GT63S_EDITION_ONE_ID) {
                this.applyGt63DecalDepthFix(child);
                return;
            }

            if (!child.material || Array.isArray(child.material)) return;
            const material = child.material as THREE.MeshStandardMaterial;
            if (envMap) {
                material.envMap = envMap;
                material.envMapIntensity = 0.9;
            }
            material.needsUpdate = true;
        });
        if (carId === MERCEDES_GT63S_EDITION_ONE_ID) {
            return;
        }
        this.applyRaceMaterialStyling(model, carId);
    }

    applyTextureQuality(material: THREE.MeshStandardMaterial) {
        const renderer = this.application.renderer?.instance;
        const maxAnisotropy = renderer?.capabilities?.getMaxAnisotropy
            ? renderer.capabilities.getMaxAnisotropy()
            : 1;
        const anisotropy = Math.min(8, maxAnisotropy);
        const maps = [
            material.map,
            material.normalMap,
            material.roughnessMap,
            material.metalnessMap,
            material.alphaMap,
            material.emissiveMap,
            material.aoMap,
        ];
        maps.forEach((map) => {
            if (!map) return;
            map.anisotropy = anisotropy;
            map.needsUpdate = true;
        });
    }

    applyGt63DecalDepthFix(mesh: THREE.Mesh) {
        if (!mesh.material || Array.isArray(mesh.material)) {
            return;
        }
        const material = mesh.material as THREE.MeshStandardMaterial;
        const materialName = (material.name || '').toLowerCase();
        const meshName = (mesh.name || '').toLowerCase();
        const isDecalLike = GT63_DECAL_HINTS.some(
            (hint) => materialName.includes(hint) || meshName.includes(hint)
        );
        if (!isDecalLike) {
            return;
        }

        material.polygonOffset = true;
        material.polygonOffsetFactor = -4;
        material.polygonOffsetUnits = -8;
        material.depthWrite = false;
        material.needsUpdate = true;
        mesh.renderOrder = 4;
    }

    applyRaceMaterialStyling(model: THREE.Object3D, carId: string) {
        let bodyColor: THREE.Color;
        let bodyMatchers: string[] = [];
        let roughness = 0.18;

        if (carId === TOYOTA_CROWN_ID) {
            bodyColor = TOYOTA_CROWN_SILVER;
            bodyMatchers = ['body', 'blue'];
        } else if (carId === AMG_ONE_ID) {
            bodyColor = AMG_ONE_RACE_BLUE;
            bodyMatchers = [
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
        } else if (carId === BMW_F90_M5_COMPETITION_ID) {
            bodyColor = BMW_F90_M5_TANZANITE_BLUE;
            bodyMatchers = ['m5_metallic', 'mat_m5_metallic'];
            roughness = 0.22;
        } else {
            return;
        }

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
            material.roughness = roughness;
            material.envMapIntensity = 1.1;
            material.needsUpdate = true;
        });
    }

    applyWheelFinishStyling(model: THREE.Object3D, carId: string, wheelRig: WheelRig[]) {
        if (carId !== BMW_E92_M3_ID || wheelRig.length === 0) {
            return;
        }

        wheelRig.forEach((wheel) => {
            this.applyE92ChromeFinishForObject(wheel.object);
            wheel.linkedVisuals.forEach((linked) => {
                this.applyE92ChromeFinishForObject(linked.object);
            });
        });

        model.traverse((child) => {
            if (!(child instanceof THREE.Mesh) || !child.material) return;
            const name = (child.name || '').toLowerCase();
            if (!name.includes('e92_wheel_05a_19x9')) return;
            this.applyE92ChromeFinishForObject(child);
        });
    }

    applyE92ChromeFinishForObject(object: THREE.Object3D) {
        if (!(object instanceof THREE.Mesh) || !object.material) {
            return;
        }

        const objectName = (object.name || '').toLowerCase();
        if (
            objectName.includes('tire') ||
            objectName.includes('tyre') ||
            objectName.includes('rubber')
        ) {
            return;
        }

        if (Array.isArray(object.material)) {
            object.material.forEach((material) =>
                this.applyE92ChromeFinishForMaterial(material, objectName)
            );
            return;
        }

        this.applyE92ChromeFinishForMaterial(object.material, objectName);
    }

    applyE92ChromeFinishForMaterial(material: THREE.Material, objectName: string) {
        if (!(material instanceof THREE.MeshStandardMaterial)) {
            return;
        }

        const materialName = (material.name || '').toLowerCase();
        if (
            materialName.includes('tire') ||
            materialName.includes('tyre') ||
            materialName.includes('rubber')
        ) {
            return;
        }

        const likelyRimMaterial =
            materialName.includes('wheel') ||
            materialName.includes('rim') ||
            materialName.includes('chrome') ||
            materialName.includes('alloy') ||
            materialName.includes('spoke') ||
            objectName.includes('wheel_05a_19x9');

        if (!likelyRimMaterial) {
            return;
        }

        material.color.copy(BMW_E92_RIM_SILVER);
        material.metalness = Math.max(material.metalness, 0.95);
        material.roughness = Math.min(material.roughness, 0.2);
        material.envMapIntensity = Math.max(material.envMapIntensity || 0, 1.18);
        material.needsUpdate = true;
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
        this.configureWheelSpinAxes(this.wheelRig, this.carModel || undefined);

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
            wheel.object.position.copy(wheel.basePosition);
            wheel.object.quaternion.copy(wheel.baseQuaternion);
            wheel.linkedVisuals.forEach((linked) => {
                linked.object.position.copy(linked.basePosition);
                linked.object.quaternion.copy(linked.baseQuaternion);
            });
        });
    }

    setActive(active: boolean) {
        this.active = active;
        this.input.setEnabled(active);
        this.smoke.setActive(active);
        if (!active) {
            this.airborneTime = 0;
            this.upsideDownTime = 0;
            this.recoveryCooldown = 0;
            this.recoveryClock = 0;
            this.postRecoveryCheckpointLockout = 0;
            this.lastRecoveryAt = -Infinity;
            this.lastRecoveryPosition.set(0, 0, 0);
            this.safeCheckpointTimer = 0;
            this.fallAnchorValid = false;
            this.fallRecoveryFailures = 0;
            this.clearSafeStateHistory();
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
        const startForwardOffset =
            this.currentTuning.startForwardOffsetMeters || 0;

        this.forward.set(tangent.x, 0, tangent.z).normalize();
        this.position
            .copy(point)
            .add(new THREE.Vector3(0, 180, 0))
            .addScaledVector(this.forward, startForwardOffset);
        this.yaw = Math.atan2(this.forward.x, this.forward.z);

        this.surfaceNormal.set(0, 1, 0);
        this.speedMps = 0;
        this.lateralSpeed = 0;
        this.driftAmount = 0;
        this.slipRatio = 0;
        this.verticalVelocity = 0;
        this.airborneTime = 0;
        this.upsideDownTime = 0;
        this.recoveryCooldown = 0;
        this.recoveryClock = 0;
        this.postRecoveryCheckpointLockout = 0;
        this.lastRecoveryAt = -Infinity;
        this.lastRecoveryPosition.set(0, 0, 0);
        this.safeCheckpointTimer = 0;
        this.fallAnchorValid = false;
        this.fallRecoveryFailures = 0;
        this.clearSafeStateHistory();
        this.steerAngle = 0;
        this.steerVisualAngle = 0;
        this.wheelSpinAngle = 0;
        this.gear = 1;
        this.rpm = this.currentTuning.idleRpm;
        this.smokeSpawnCooldown = 0;
        this.smoke.clear();
        this.groundToCollider(0);
        this.updateTransform(1);
        this.captureSafeCheckpoint(true);
        this.resetWheelVisuals();
    }

    captureSafeCheckpoint(force = false) {
        if (!force) {
            if (!this.grounded) return;
            if (this.surfaceNormal.y < 0.84) return;
        }

        const hit = this.raycastGroundAt(this.position.x, this.position.z);
        if (hit) {
            const hitNormal = this.tmpVectorC
                .copy(hit.face?.normal || this.tmpVectorD.set(0, 1, 0))
                .transformDirection(hit.object.matrixWorld)
                .normalize();
            if (hitNormal.y < 0) {
                hitNormal.multiplyScalar(-1);
            }
            if (!force && hitNormal.y < 0.8) {
                return;
            }
            this.lastSafePosition
                .set(this.position.x, hit.point.y + this.rideHeight + 0.03, this.position.z);
            this.lastSafeSurfaceNormal.copy(hitNormal).normalize();
        } else {
            if (!force) return;
            this.lastSafePosition.copy(this.position);
            this.lastSafeSurfaceNormal.copy(this.surfaceNormal).normalize();
        }

        this.lastSafeForward.copy(this.forward).normalize();
        this.lastSafeYaw = this.yaw;
        this.lastSafeSpeedMps = this.speedMps;
        this.safeCheckpointTimer = 0;
        this.recordSafeStateSnapshot(force);
    }

    clearSafeStateHistory() {
        this.safeStateHistory.length = 0;
    }

    recordSafeStateSnapshot(force = false) {
        const now = this.recoveryClock;
        const last = this.safeStateHistory[this.safeStateHistory.length - 1];
        if (!force && last) {
            const timeDelta = now - last.time;
            const distanceSq = last.position.distanceToSquared(this.lastSafePosition);
            if (
                timeDelta < SAFE_STATE_MIN_SNAPSHOT_INTERVAL_S &&
                distanceSq <
                    SAFE_STATE_MIN_SNAPSHOT_DISTANCE * SAFE_STATE_MIN_SNAPSHOT_DISTANCE
            ) {
                return;
            }
        }

        this.safeStateHistory.push({
            time: now,
            position: this.lastSafePosition.clone(),
            forward: this.lastSafeForward.clone(),
            surfaceNormal: this.lastSafeSurfaceNormal.clone(),
            yaw: this.lastSafeYaw,
            speedMps: this.lastSafeSpeedMps,
        });
        this.pruneSafeStateHistory();
    }

    pruneSafeStateHistory() {
        const minTime = this.recoveryClock - SAFE_STATE_HISTORY_RETENTION_S;
        while (
            this.safeStateHistory.length > 0 &&
            this.safeStateHistory[0].time < minTime
        ) {
            this.safeStateHistory.shift();
        }
        while (this.safeStateHistory.length > SAFE_STATE_HISTORY_MAX_ENTRIES) {
            this.safeStateHistory.shift();
        }
    }

    getSafeStateForLookback(lookbackSeconds: number) {
        if (this.safeStateHistory.length === 0) return null;
        const targetTime = Math.max(0, this.recoveryClock - lookbackSeconds);
        for (let i = this.safeStateHistory.length - 1; i >= 0; i--) {
            const snapshot = this.safeStateHistory[i];
            if (snapshot.time <= targetTime) {
                return snapshot;
            }
        }
        return this.safeStateHistory[0];
    }

    isValidRecoveryNormal(normal: THREE.Vector3) {
        return Number.isFinite(normal.x) && Number.isFinite(normal.y) && normal.y >= 0.74;
    }

    tryApplyRecoverySnapshot(snapshot: SafeStateSnapshot, speedScale: number) {
        const hit = this.raycastGroundAt(snapshot.position.x, snapshot.position.z);
        if (!hit) {
            return false;
        }

        const hitNormal = this.tmpVectorC
            .copy(hit.face?.normal || this.tmpVectorD.set(0, 1, 0))
            .transformDirection(hit.object.matrixWorld)
            .normalize();
        if (hitNormal.y < 0) {
            hitNormal.multiplyScalar(-1);
        }
        if (!this.isValidRecoveryNormal(hitNormal)) {
            return false;
        }

        this.position.set(
            snapshot.position.x,
            hit.point.y + this.rideHeight + 0.03,
            snapshot.position.z
        );
        this.forward.copy(snapshot.forward).normalize();
        this.surfaceNormal.copy(hitNormal).normalize();
        this.yaw = snapshot.yaw;
        this.speedMps = THREE.MathUtils.clamp(
            snapshot.speedMps * speedScale,
            -this.maxReverseSpeedMps,
            this.maxForwardSpeedMps
        );
        return true;
    }

    tryRestoreFromSafeHistoryLookback(
        lookbackSeconds: number,
        minDistanceMeters = 0
    ): boolean {
        if (this.safeStateHistory.length === 0) return false;

        const repeatRecovery =
            this.recoveryClock - this.lastRecoveryAt < 4.5 &&
            this.lastRecoveryPosition.lengthSq() > 0.0001;
        const minDistanceSq = minDistanceMeters * minDistanceMeters;
        const repeatDistanceSq =
            FALL_RECOVERY_REPEAT_RADIUS_M * FALL_RECOVERY_REPEAT_RADIUS_M;
        const targetTime = Math.max(0, this.recoveryClock - lookbackSeconds);

        let startIndex = -1;
        for (let i = this.safeStateHistory.length - 1; i >= 0; i--) {
            if (this.safeStateHistory[i].time <= targetTime) {
                startIndex = i;
                break;
            }
        }
        if (startIndex < 0) {
            startIndex = 0;
        }

        for (let i = startIndex; i >= 0; i--) {
            const snapshot = this.safeStateHistory[i];
            if (snapshot.position.distanceToSquared(this.position) < minDistanceSq) {
                continue;
            }
            if (
                repeatRecovery &&
                snapshot.position.distanceToSquared(this.lastRecoveryPosition) <
                    repeatDistanceSq
            ) {
                continue;
            }
            if (this.tryApplyRecoverySnapshot(snapshot, 0.9)) {
                return true;
            }
        }

        if (minDistanceMeters > 0) {
            return this.tryRestoreFromSafeHistoryLookback(lookbackSeconds, 0);
        }
        return false;
    }

    captureFallAnchor() {
        this.fallAnchorValid = true;
        this.fallAnchorPosition.copy(this.position);
        this.fallAnchorForward.copy(this.forward).normalize();
        this.fallAnchorYaw = this.yaw;
        this.fallAnchorSpeedMps = this.speedMps;
    }

    raycastGroundAt(x: number, z: number) {
        const probeStartY =
            Math.max(
                this.position.y,
                this.lastSafePosition.y || this.position.y,
                this.fallAnchorPosition.y || this.position.y
            ) +
            RAYCAST_HEIGHT +
            900;
        this.tmpVectorA.set(x, probeStartY, z);
        this.tmpVectorB.set(0, -1, 0);
        this.raycaster.layers.set(this.track.getColliderLayer());
        this.raycaster.set(this.tmpVectorA, this.tmpVectorB);
        this.raycaster.far = RAYCAST_DISTANCE + 2000;
        const hit = this.raycaster.intersectObject(this.colliderMesh, false)[0];
        return hit || null;
    }

    tryRestoreFromFallAnchor() {
        if (!this.fallAnchorValid) return false;

        const hit = this.raycastGroundAt(
            this.fallAnchorPosition.x,
            this.fallAnchorPosition.z
        );
        if (!hit) {
            this.fallRecoveryFailures++;
            return false;
        }

        const hitNormal = this.tmpVectorC
            .copy(hit.face?.normal || this.tmpVectorD.set(0, 1, 0))
            .transformDirection(hit.object.matrixWorld)
            .normalize();
        if (hitNormal.y < 0) {
            hitNormal.multiplyScalar(-1);
        }
        if (!this.isValidRecoveryNormal(hitNormal)) {
            this.fallRecoveryFailures++;
            return false;
        }

        this.position.set(
            this.fallAnchorPosition.x,
            hit.point.y + this.rideHeight + 0.03,
            this.fallAnchorPosition.z
        );
        this.forward.copy(this.fallAnchorForward).normalize();
        this.surfaceNormal.copy(hitNormal).normalize();
        this.yaw = this.fallAnchorYaw;
        this.speedMps = THREE.MathUtils.clamp(
            this.fallAnchorSpeedMps,
            -this.maxReverseSpeedMps,
            this.maxForwardSpeedMps
        );
        this.fallRecoveryFailures = 0;
        return true;
    }

    restoreFromSafeCheckpoint(reason: 'fall' | 'flip' | 'invalid') {
        let restored = false;
        if (reason === 'fall') {
            const recentRecoveryWindow = this.recoveryClock - this.lastRecoveryAt < 4.5;
            this.fallRecoveryFailures = recentRecoveryWindow
                ? this.fallRecoveryFailures + 1
                : Math.max(this.fallRecoveryFailures, 1);

            if (this.fallRecoveryFailures >= FALL_RECOVERY_MAX_FAILURES) {
                this.resetToStart();
                return;
            }

            const dynamicLookback = THREE.MathUtils.clamp(
                FALL_RECOVERY_LOOKBACK_S +
                    this.fallRecoveryFailures * FALL_RECOVERY_LOOKBACK_STEP_S,
                FALL_RECOVERY_LOOKBACK_S,
                SAFE_STATE_HISTORY_RETENTION_S - 0.2
            );
            restored = this.tryRestoreFromSafeHistoryLookback(
                dynamicLookback,
                FALL_RECOVERY_MIN_DISTANCE_M
            );
            if (!restored) {
                restored = this.tryRestoreFromFallAnchor();
            }
        }

        if (!restored) {
            const hasCheckpoint = this.lastSafePosition.lengthSq() > 0.0001;
            if (!hasCheckpoint) {
                this.resetToStart();
                return;
            }
            this.position
                .copy(this.lastSafePosition)
                .addScaledVector(this.lastSafeSurfaceNormal, 0.2);
            this.forward.copy(this.lastSafeForward).normalize();
            this.surfaceNormal.copy(this.lastSafeSurfaceNormal).normalize();
            this.yaw = this.lastSafeYaw;
            this.speedMps = THREE.MathUtils.clamp(
                this.lastSafeSpeedMps * 0.94,
                -this.maxReverseSpeedMps,
                this.maxForwardSpeedMps
            );
        }

        this.lateralSpeed = 0;
        this.verticalVelocity = 0;
        this.driftAmount = 0;
        this.slipRatio = 0;
        this.steerAngle = 0;
        this.steerVisualAngle = 0;
        this.airborneTime = 0;
        this.upsideDownTime = 0;
        this.recoveryCooldown = FALL_RECOVERY_COOLDOWN_S;
        this.postRecoveryCheckpointLockout = POST_RECOVERY_CHECKPOINT_GRACE_S;
        this.lastRecoveryAt = this.recoveryClock;
        this.lastRecoveryPosition.copy(this.position);
        this.fallAnchorValid = false;
        this.grounded = true;
        this.smokeSpawnCooldown = 0.08;
        this.input.reset();
        this.updateTransform(1 / 60);
        this.resetWheelVisuals();
        if (reason !== 'fall') {
            this.fallRecoveryFailures = 0;
        }

        if (reason === 'flip' || reason === 'invalid') {
            this.captureSafeCheckpoint(true);
        }
    }

    shouldRecoverFromFall() {
        if (this.recoveryCooldown > 0) return false;
        if (this.grounded) return false;
        return this.airborneTime >= FALL_RECOVERY_DELAY_S;
    }

    hasInvalidState() {
        return (
            !Number.isFinite(this.position.x) ||
            !Number.isFinite(this.position.y) ||
            !Number.isFinite(this.position.z) ||
            !Number.isFinite(this.speedMps) ||
            !Number.isFinite(this.yaw)
        );
    }

    shouldRecoverFromFlip(throttle: number, brake: number, deltaSeconds: number) {
        if (this.recoveryCooldown > 0) return false;
        if (!this.grounded) return false;
        if (Math.abs(this.speedMps) > 1.5) return false;
        if (throttle > 0.2 || brake > 0.2) return false;

        const carUp = this.tmpVectorF
            .set(0, 1, 0)
            .applyQuaternion(this.carPivot.quaternion)
            .normalize();
        if (carUp.y <= UPSIDE_DOWN_RECOVERY_UP_THRESHOLD) {
            this.upsideDownTime += deltaSeconds;
        } else {
            this.upsideDownTime = 0;
        }
        return this.upsideDownTime >= UPSIDE_DOWN_RECOVERY_DELAY_S;
    }

    update(deltaSeconds: number) {
        if (!this.active) return;

        const dt = THREE.MathUtils.clamp(
            Number.isFinite(deltaSeconds) ? deltaSeconds : 0,
            0,
            0.1
        );
        this.recoveryClock += dt;
        this.recoveryCooldown = Math.max(0, this.recoveryCooldown - dt);
        this.postRecoveryCheckpointLockout = Math.max(
            0,
            this.postRecoveryCheckpointLockout - dt
        );
        this.safeCheckpointTimer += dt;

        this.input.update(dt);
        const controls = this.input.getState();

        this.updateLongitudinalSpeed(
            dt,
            controls.throttle,
            controls.brake,
            controls.handbrake
        );
        this.updateSteering(
            dt,
            controls.steer,
            controls.handbrake,
            controls.throttle
        );
        this.updatePosition(dt);
        this.groundToCollider(dt);

        if (this.hasInvalidState()) {
            this.restoreFromSafeCheckpoint('invalid');
            return;
        }
        if (this.shouldRecoverFromFall()) {
            this.restoreFromSafeCheckpoint('fall');
            return;
        }
        if (!this.grounded) {
            this.upsideDownTime = 0;
        }
        if (this.shouldRecoverFromFlip(controls.throttle, controls.brake, dt)) {
            this.restoreFromSafeCheckpoint('flip');
            return;
        }

        if (
            this.grounded &&
            this.postRecoveryCheckpointLockout <= 0 &&
            this.safeCheckpointTimer >= SAFE_CHECKPOINT_MIN_INTERVAL_S
        ) {
            this.captureSafeCheckpoint();
            if (this.fallRecoveryFailures > 0) {
                this.fallRecoveryFailures = Math.max(0, this.fallRecoveryFailures - 1);
            }
        }

        this.updateTransform(dt);
        this.updateDrivetrain(dt, controls.throttle, controls.brake);
        this.updateWheelVisuals(dt);
        this.updateDriftSmoke(dt);
    }

    updateLongitudinalSpeed(
        deltaSeconds: number,
        throttle: number,
        brake: number,
        handbrake: number
    ) {
        const speedSign = Math.sign(this.speedMps);
        const speedAbs = Math.abs(this.speedMps);
        const speedRatio = THREE.MathUtils.clamp(
            speedAbs / Math.max(1, this.maxForwardSpeedMps),
            0,
            1
        );
        const gearPull = THREE.MathUtils.lerp(
            1.12,
            0.44,
            Math.pow(speedRatio, 0.62)
        );
        const torqueCurve = THREE.MathUtils.lerp(
            1.04,
            0.72,
            Math.pow(speedRatio, 0.85)
        );
        const launchBoost = 1 + Math.max(0, 1 - speedRatio) * 0.18;
        const drivetrainGrip = 1;
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
                acceleration -= brake * SHARED_BRAKE_DECEL;
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
            const airborneFactor =
                this.airborneTime <= AIRBORNE_TRANSIENT_WINDOW_S
                    ? AIRBORNE_ACCEL_MULTIPLIER_TRANSIENT
                    : AIRBORNE_ACCEL_MULTIPLIER_SUSTAINED;
            acceleration *= airborneFactor;
        }

        this.speedMps += acceleration * deltaSeconds;

        if (handbrake > 0.2 && speedAbs > 6) {
            const handbrakeDamping = this.usesRwdDriftTuning() ? 0.56 : 0.4;
            const driftDampingScale =
                this.driftAmount > 0.2 && throttle > 0.35 ? 0.35 : 1;
            this.speedMps *=
                1 - handbrake * handbrakeDamping * driftDampingScale * deltaSeconds;
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
            SHARED_MAX_STEER_ANGLE_DEG
        ) * STEERING_SENSITIVITY_SCALE;
        const steerScale = THREE.MathUtils.lerp(1, 0.5, speedFactor);
        const lowSpeedBoostT = THREE.MathUtils.clamp(
            speed / LOW_SPEED_STEER_BOOST_FADE_MPS,
            0,
            1
        );
        const lowSpeedSteerBoost = THREE.MathUtils.lerp(
            LOW_SPEED_STEER_BOOST,
            1,
            lowSpeedBoostT
        );
        const steerResponseBoost = THREE.MathUtils.lerp(
            LOW_SPEED_STEER_RESPONSE_BOOST,
            1,
            lowSpeedBoostT
        );
        const targetSteerAngle =
            steer * maxSteerAngle * steerScale * lowSpeedSteerBoost;
        const steerLerp = THREE.MathUtils.clamp(
            deltaSeconds * 12 * STEERING_SENSITIVITY_SCALE * steerResponseBoost,
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
        const driftCapability = this.getDriftCapability();
        const usesRwdDriftTuning = driftCapability > 0.001;

        const driftSpeedNorm = THREE.MathUtils.clamp(
            (speed - DRIFT_ENTRY_SPEED_MPS) /
                Math.max(1e-3, DRIFT_FULL_SPEED_MPS - DRIFT_ENTRY_SPEED_MPS),
            0,
            1
        );
        const driftSteerNorm = THREE.MathUtils.clamp(
            (Math.abs(steer) - 0.12) / 0.88,
            0,
            1
        );
        const driftHandbrakeNorm = THREE.MathUtils.clamp((handbrake - 0.18) / 0.82, 0, 1);
        const driftThrottleNorm = THREE.MathUtils.clamp((throttle - 0.15) / 0.85, 0, 1);
        const driftInputNorm = Math.min(driftHandbrakeNorm, driftThrottleNorm);
        const driftTarget = usesRwdDriftTuning
            ? driftSpeedNorm * driftSteerNorm * driftInputNorm * driftCapability
            : 0;
        const driftBuildRate =
            THREE.MathUtils.lerp(1.4, 3.1, driftTarget) *
            THREE.MathUtils.lerp(0.7, 1, driftCapability);
        const driftReleaseRate =
            speed > DRIFT_RELEASE_SPEED_MPS
                ? THREE.MathUtils.lerp(2.4, 4.2, 1 - driftTarget)
                : THREE.MathUtils.lerp(4.2, 6, 1 - driftTarget);
        const driftRate =
            driftTarget >= this.driftAmount ? driftBuildRate : driftReleaseRate;
        this.driftAmount = THREE.MathUtils.lerp(
            this.driftAmount,
            driftTarget,
            THREE.MathUtils.clamp(deltaSeconds * driftRate, 0, 1)
        );

        if (this.driftAmount > 0.001) {
            const driftPower = THREE.MathUtils.lerp(0.74, 1.12, driftCapability);
            const driftSlipTarget =
                -steer * speed * (0.3 + this.driftAmount * 1.05) * driftPower;
            const driftSlipLerp = THREE.MathUtils.clamp(
                deltaSeconds * (2.2 + this.driftAmount * 2.4),
                0,
                1
            );
            this.lateralSpeed = THREE.MathUtils.lerp(
                this.lateralSpeed,
                driftSlipTarget,
                driftSlipLerp
            );
            yawRate += steer * (0.35 + this.driftAmount * 1.15) * driftPower;
        }

        const baseLateralGrip = usesRwdDriftTuning
            ? driftCapability >= 0.95
                ? 5.4
                : 6.15
            : this.currentTuning.drivetrain === 'FWD'
            ? 7.4
            : 6.9;
        const driftGripScale = THREE.MathUtils.lerp(1, 0.09, this.driftAmount);
        const handbrakeGripScale = usesRwdDriftTuning
            ? THREE.MathUtils.lerp(1, driftCapability >= 0.95 ? 0.2 : 0.34, handbrake)
            : THREE.MathUtils.lerp(1, 0.45, handbrake);
        const damping = baseLateralGrip * driftGripScale * handbrakeGripScale;
        this.lateralSpeed = THREE.MathUtils.lerp(
            this.lateralSpeed,
            0,
            THREE.MathUtils.clamp(deltaSeconds * damping, 0, 1)
        );
        const maxLateralSpeed = Math.max(
            2.2,
            speed * THREE.MathUtils.lerp(0.45, 1.12, this.driftAmount)
        );
        this.lateralSpeed = THREE.MathUtils.clamp(
            this.lateralSpeed,
            -maxLateralSpeed,
            maxLateralSpeed
        );

        // During drift, bias yaw from rear slip so the car rotates around the front axle.
        const rearSlipYaw =
            (-this.lateralSpeed /
                Math.max(1.2, wheelBase * 0.78)) *
            THREE.MathUtils.lerp(0.06, 0.24, this.driftAmount);
        yawRate += rearSlipYaw;

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
        const wasGrounded = this.grounded;

        if (hit) {
            this.grounded = true;
            this.airborneTime = 0;
            const targetGroundY = hit.point.y + this.rideHeight;
            if (!wasGrounded || deltaSeconds <= 0) {
                this.position.y = targetGroundY;
            } else {
                const speedFactor = THREE.MathUtils.clamp(
                    Math.abs(this.speedMps) / LOW_SPEED_GROUNDING_BLEND_SPEED_MPS,
                    0,
                    1
                );
                const groundLerp = THREE.MathUtils.clamp(
                    deltaSeconds *
                        THREE.MathUtils.lerp(
                            LOW_SPEED_GROUNDING_LERP_MIN,
                            LOW_SPEED_GROUNDING_LERP_MAX,
                            speedFactor
                        ),
                    0,
                    1
                );
                const smoothedTargetY = THREE.MathUtils.lerp(
                    this.position.y,
                    targetGroundY,
                    groundLerp
                );
                const maxStepPerFrame = THREE.MathUtils.lerp(
                    LOW_SPEED_GROUNDING_MAX_STEP_MIN,
                    LOW_SPEED_GROUNDING_MAX_STEP_MAX,
                    speedFactor
                );
                const maxStep =
                    maxStepPerFrame *
                    THREE.MathUtils.clamp(deltaSeconds * 60, 0.2, 2.5);
                const nextDeltaY = THREE.MathUtils.clamp(
                    smoothedTargetY - this.position.y,
                    -maxStep,
                    maxStep
                );
                this.position.y += nextDeltaY;

                if (
                    speedFactor >= 0.98 ||
                    Math.abs(targetGroundY - this.position.y) <= 0.0015
                ) {
                    this.position.y = targetGroundY;
                }
            }
            this.verticalVelocity = 0;

            this.tmpVectorC
                .copy(hit.face?.normal || new THREE.Vector3(0, 1, 0))
                .transformDirection(hit.object.matrixWorld)
                .normalize();
            if (this.tmpVectorC.y < 0) {
                this.tmpVectorC.multiplyScalar(-1);
            }
            if (this.tmpVectorC.y < MIN_SURFACE_NORMAL_Y) {
                const correctionT = THREE.MathUtils.clamp(
                    (MIN_SURFACE_NORMAL_Y - this.tmpVectorC.y) / MIN_SURFACE_NORMAL_Y,
                    0,
                    1
                );
                this.tmpVectorC
                    .lerp(this.tmpVectorD.set(0, 1, 0), correctionT)
                    .normalize();
            }

            const normalSpeedFactor = THREE.MathUtils.clamp(
                Math.abs(this.speedMps) / SURFACE_NORMAL_BLEND_SPEED_MPS,
                0,
                1
            );
            const normalLerp = THREE.MathUtils.clamp(
                deltaSeconds *
                    THREE.MathUtils.lerp(
                        SURFACE_NORMAL_LERP_MIN,
                        SURFACE_NORMAL_LERP_MAX,
                        normalSpeedFactor
                    ),
                0,
                1
            );
            this.surfaceNormal.lerp(this.tmpVectorC, normalLerp).normalize();
            return;
        }

        if (wasGrounded) {
            this.captureFallAnchor();
        }

        this.grounded = false;
        this.airborneTime += deltaSeconds;
        this.verticalVelocity -= GRAVITY * deltaSeconds;
        this.position.y += this.verticalVelocity * deltaSeconds;
        this.surfaceNormal
            .lerp(new THREE.Vector3(0, 1, 0), THREE.MathUtils.clamp(deltaSeconds * 2, 0, 1))
            .normalize();
    }

    updateTransform(deltaSeconds: number) {
        const speedAbs = Math.abs(this.speedMps);
        const uprightBlendFactor = THREE.MathUtils.clamp(
            1 - speedAbs / LOW_SPEED_UPRIGHT_BLEND_FADE_MPS,
            0,
            1
        );
        const orientationNormal = this.tmpVectorD.copy(this.surfaceNormal);
        if (uprightBlendFactor > 0) {
            orientationNormal
                .lerp(
                    this.tmpVectorE.set(0, 1, 0),
                    uprightBlendFactor * LOW_SPEED_UPRIGHT_BLEND_MAX
                )
                .normalize();
        }
        if (orientationNormal.y < MIN_ORIENTATION_NORMAL_Y) {
            const uprightCorrection = THREE.MathUtils.clamp(
                (MIN_ORIENTATION_NORMAL_Y - orientationNormal.y) /
                    Math.max(1e-4, 1 - MIN_ORIENTATION_NORMAL_Y),
                0,
                1
            );
            orientationNormal
                .lerp(this.tmpVectorE.set(0, 1, 0), uprightCorrection)
                .normalize();
        }

        const planarForward = this.tmpVectorA
            .copy(this.forward)
            .projectOnPlane(orientationNormal);
        if (planarForward.lengthSq() <= 1e-8) {
            planarForward
                .set(0, 0, 1)
                .applyQuaternion(this.carPivot.quaternion)
                .projectOnPlane(orientationNormal);
        }
        if (planarForward.lengthSq() <= 1e-8) {
            planarForward.set(0, 0, 1);
        }
        planarForward.normalize();

        if (this.driftAmount > 0.04 && this.velocity.lengthSq() > 9) {
            this.tmpVectorC
                .copy(this.velocity)
                .projectOnPlane(orientationNormal)
                .normalize();
            if (this.tmpVectorC.lengthSq() > 0.0001) {
                const slipAngle = this.getSignedAngleAroundNormal(
                    planarForward,
                    this.tmpVectorC,
                    orientationNormal
                );
                const clampedSlipAngle = THREE.MathUtils.clamp(
                    slipAngle,
                    -DRIFT_VISUAL_MAX_ANGLE_RAD,
                    DRIFT_VISUAL_MAX_ANGLE_RAD
                );
                const driftVisualBlend = THREE.MathUtils.clamp(
                    this.driftAmount * 0.42,
                    0,
                    0.42
                );
                planarForward
                    .applyAxisAngle(
                        orientationNormal,
                        clampedSlipAngle * driftVisualBlend
                    )
                    .normalize();
            }
        }

        const side = this.tmpVectorB.crossVectors(orientationNormal, planarForward);
        if (side.lengthSq() <= 1e-8) {
            side.set(1, 0, 0);
        }
        side.normalize();

        const finalForward = this.tmpVectorC
            .crossVectors(side, orientationNormal)
            .normalize();
        if (finalForward.dot(planarForward) < 0) {
            side.multiplyScalar(-1);
            finalForward.multiplyScalar(-1);
        }

        this.tmpMatrix.makeBasis(side, orientationNormal, finalForward);
        this.orientationTarget.setFromRotationMatrix(this.tmpMatrix);

        const rotationSpeedFactor = THREE.MathUtils.clamp(
            Math.abs(this.speedMps) / 14,
            0,
            1
        );
        const rotLerp = THREE.MathUtils.clamp(
            deltaSeconds * THREE.MathUtils.lerp(5, 10, rotationSpeedFactor),
            0,
            1
        );
        this.carPivot.quaternion.slerp(this.orientationTarget, rotLerp);
        this.carPivot.position.copy(this.position);
    }

    getSignedAngleAroundNormal(
        from: THREE.Vector3,
        to: THREE.Vector3,
        normal: THREE.Vector3
    ) {
        const angle = from.angleTo(to);
        if (angle < 1e-5) return 0;

        this.tmpVectorF.crossVectors(from, to);
        const sign = Math.sign(this.tmpVectorF.dot(normal)) || 1;
        return angle * sign;
    }

    usesRwdDriftTuning() {
        return (
            this.currentTuning.drivetrain === 'RWD' ||
            this.currentTuning.allowRwdDrift === true
        );
    }

    getDriftCapability() {
        if (this.currentTuning.drivetrain === 'RWD') return 1;
        if (this.currentTuning.allowRwdDrift === true) return 0.72;
        return 0;
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
        const lowSpeedVisualBoostT = THREE.MathUtils.clamp(
            Math.abs(this.speedMps) / LOW_SPEED_STEER_BOOST_FADE_MPS,
            0,
            1
        );
        const visualSteerBoost = THREE.MathUtils.lerp(
            LOW_SPEED_VISUAL_STEER_BOOST,
            1,
            lowSpeedVisualBoostT
        );
        const maxVisualSteerAngle =
            THREE.MathUtils.degToRad(SHARED_MAX_STEER_ANGLE_DEG) *
            STEERING_SENSITIVITY_SCALE *
            FRONT_WHEEL_VISUAL_STEER_MULTIPLIER *
            visualSteerBoost;
        const targetVisualSteerAngle = THREE.MathUtils.clamp(
            this.steerAngle *
                FRONT_WHEEL_VISUAL_STEER_MULTIPLIER *
                visualSteerBoost,
            -maxVisualSteerAngle,
            maxVisualSteerAngle
        );
        this.steerVisualAngle = THREE.MathUtils.lerp(
            this.steerVisualAngle,
            targetVisualSteerAngle,
            THREE.MathUtils.clamp(deltaSeconds * 14, 0, 1)
        );

        const steerQuaternion = this.tmpQuatA.setFromAxisAngle(
            new THREE.Vector3(0, 1, 0),
            this.steerVisualAngle
        );

        this.wheelRig.forEach((wheel) => {
            const spinAngle = this.wheelSpinAngle * wheel.spinSign;
            const spinQuaternion = this.tmpQuatB.setFromAxisAngle(
                wheel.spinAxis,
                spinAngle
            );

            wheel.object.position.copy(wheel.basePosition);
            wheel.object.quaternion.copy(wheel.baseQuaternion);
            if (wheel.front) {
                this.rotateWheelLocalAroundCenter(wheel, steerQuaternion);
            }
            const wheelWorldQuaternionBeforeSpin = wheel.object.getWorldQuaternion(
                this.tmpQuatE
            );
            const wheelSpinAxisWorld = this.tmpVectorE
                .copy(wheel.spinAxis)
                .applyQuaternion(wheelWorldQuaternionBeforeSpin)
                .normalize();
            this.rotateWheelLocalAroundCenter(wheel, spinQuaternion);

            wheel.linkedVisuals.forEach((linked) => {
                linked.object.position.copy(linked.basePosition);
                linked.object.quaternion.copy(linked.baseQuaternion);
                if (wheel.front) {
                    this.rotateObjectLocalAroundCenter(
                        linked.object,
                        linked.spinCenter,
                        steerQuaternion
                    );
                }
                const linkedWorldOrigin =
                    linked.object.getWorldPosition(this.tmpVectorA);
                const linkedWorldAxisTip = this.tmpVectorB
                    .copy(linkedWorldOrigin)
                    .add(wheelSpinAxisWorld);
                const linkedLocalOrigin = linked.object.worldToLocal(
                    this.tmpVectorC.copy(linkedWorldOrigin)
                );
                const linkedLocalAxisTip = linked.object.worldToLocal(
                    this.tmpVectorD.copy(linkedWorldAxisTip)
                );
                const linkedSpinAxisLocal = this.tmpVectorF
                    .copy(linkedLocalAxisTip)
                    .sub(linkedLocalOrigin);
                if (linkedSpinAxisLocal.lengthSq() <= 1e-10) {
                    linkedSpinAxisLocal.copy(wheel.spinAxis);
                } else {
                    linkedSpinAxisLocal.normalize();
                }
                const linkedSpinQuaternion = this.tmpQuatG.setFromAxisAngle(
                    linkedSpinAxisLocal,
                    spinAngle
                );
                this.rotateObjectLocalAroundCenter(
                    linked.object,
                    linked.spinCenter,
                    linkedSpinQuaternion
                );
            });
        });
    }

    rotateWheelLocalAroundCenter(wheel: WheelRig, localRotation: THREE.Quaternion) {
        this.rotateObjectLocalAroundCenter(
            wheel.object,
            wheel.spinCenter,
            localRotation
        );
    }

    rotateObjectLocalAroundCenter(
        object: THREE.Object3D,
        spinCenter: THREE.Vector3,
        localRotation: THREE.Quaternion
    ) {
        this.tmpQuatC.copy(object.quaternion);
        object.quaternion.multiply(localRotation);
        this.tmpQuatD.copy(object.quaternion).multiply(this.tmpQuatC.invert());
        object.position.sub(spinCenter).applyQuaternion(this.tmpQuatD).add(spinCenter);
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

    getCameraFollowDistanceOffset() {
        return this.currentTuning.cameraFollowDistanceOffsetMeters || 0;
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
