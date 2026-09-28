import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import Application from '../../Application';
import Resources from '../../Utils/Resources';
import UIEventBus from '../../UI/EventBus';
import { applyBmwM5GlassTint } from '../../Utils/BmwM5GlassTint';
import { applyCarFinish } from '../../Utils/CarFinish';
import { addContactShadow } from '../../World/CarContactShadow';
import { getCheapSkyCube, toCheapCarMaterial } from '../Visuals/cheapMaterials';
import DrivingInput from '../Input/DrivingInput';
import NordschleifeTrack from '../Track/NordschleifeTrack';
import DriftSmoke from '../Effects/DriftSmoke';
import VehiclePhysics, {
    type PhysicsControls,
    type PhysicsSurface,
} from './VehiclePhysics';
import {
    buildPhysicsSpec,
    defaultWheelGeometry,
    type WheelGeometry,
} from './carPhysics';
import type { TrackFrame, TrackSurface } from '../Track/NordschleifeTrack';
import {
    ASSIST_PRESETS,
    readAssistSettings,
    writeAssistSettings,
    type AssistPreset,
} from './assists';
import {
    carOptionsById,
    defaultCarId,
    getStoredCarId,
    type CarRaceConfig,
    type DrivetrainType,
} from '../../carOptions';
import { legacyColor } from '../../Utils/LegacyColor';

const SPAWN_T = 0.003;
// real gravity for the vertical motion. the old squeezed track needed 32 to
// keep cars on its 30-120% grades, which also meant no crest could throw a car
const GRAVITY = 9.81;
const AIR_DENSITY = 1.225;
const CREST_MIN_CURVATURE = 0.003;
// a barely-there launch just skims the road, a real jump needs some margin
const CREST_LAUNCH_MARGIN = 1.25;
const AIRBORNE_PITCH_FOLLOW = 0.3;
const RAYCAST_HEIGHT = 320;
const RAYCAST_DISTANCE = 1200;
const LONG_AXIS_THRESHOLD = 1.12;
const SMOKE_SPAWN_INTERVAL = 0.03;
const MAX_SPEED_MPS = 400 / 3.6;
const MAX_REVERSE_SPEED_MPS = 34 / 3.6;
// grip and drag per surface. kerbs lose a little, grass a lot
const SURFACE_GRIP: Record<TrackSurface, number> = {
    asphalt: 1,
    kerb: 0.9,
    grass: 0.55,
    off: 0.4,
};
const SURFACE_DRAG: Record<TrackSurface, number> = {
    asphalt: 0,
    kerb: 0.004,
    grass: 0.07,
    off: 0.1,
};
const BARRIER_RESTITUTION = 0.22;
const BARRIER_FRICTION = 0.35;
// cars reflect the sky a bit under full strength, the probe has no occluders
// so at 1 the lower body glows
const RACE_ENV_INTENSITY = 0.55;
const RACE_EMISSIVE_MAX = 0.45;
const WHEEL_VISUAL_STEER_LIMIT = THREE.MathUtils.degToRad(38);
const WHEEL_RADIUS_PLAUSIBLE_MIN = 0.12;
const WHEEL_RADIUS_PLAUSIBLE_MAX = 1.4;
const MAX_SINGLE_WHEEL_RADIUS = 0.6;
// the collider is 5m panels, so the road has to drop this far under the car's
// ballistic path before a crest counts as a jump, or every panel edge hops
const CREST_LAUNCH_TOLERANCE = 0.06;
const MAX_GROUND_FOLLOW_GRADE = 1.2;
const GROUND_FOLLOW_STEP_ALLOWANCE = 0.25;
const MAX_GROUND_VERTICAL_SPEED = 25;
const WHEEL_PROBE_CLEARANCE_BIAS = 0;
const MAX_WHEEL_ANTI_SINK_LIFT = 0.018;
const HIGH_SPEED_PREDICTIVE_LOOKAHEAD_MIN = 0.7;
const HIGH_SPEED_PREDICTIVE_LOOKAHEAD_MAX = 4.8;
const SUSPENSION_TRAVEL_METERS = 0.42;
const SURFACE_NORMAL_BLEND_SPEED_MPS = 16;
const SURFACE_NORMAL_LERP_MIN = 1.2;
// the normal blend and the body slerp stack, so both need to be quick at speed
// or the body trails the road's pitch and wheels sink or lift on grade changes
const SURFACE_NORMAL_LERP_MAX = 12;
const SURFACE_FORWARD_BLEND_SPEED_MPS = 18;
const SURFACE_FORWARD_LERP_MIN = 4.5;
const SURFACE_FORWARD_LERP_MAX = 9.5;
const GRADE_PITCH_HALF_WHEELBASE_MIN = 0.85;
const GRADE_PITCH_HALF_WHEELBASE_MAX = 2.15;
const GRADE_PITCH_HALF_WHEELBASE_SCALE = 0.31;
const LOW_SPEED_UPRIGHT_BLEND_FADE_MPS = 14;
const LOW_SPEED_UPRIGHT_BLEND_MAX = 0;
const MIN_SURFACE_NORMAL_Y = 0.72;
const MIN_ORIENTATION_NORMAL_Y = 0.72;
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
const AMG_ONE_ID = 'amg-one';
const BMW_E92_M3_ID = 'bmw-e92-m3';
const AMG_C63S_COUPE_ID = 'amg-c63s-coupe';
const BMW_F90_M5_COMPETITION_ID = 'bmw-f90-m5-competition';
const BMW_M8_COMPETITION_COUPE_ID = 'bmw-m8-competition-coupe';
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
const AMG_ONE_RACE_BLUE = legacyColor(0x050f2f);
const BMW_E92_RIM_SILVER = legacyColor(0xd3d8de);
const BMW_M8_FROZEN_MARINA_BAY_BLUE = legacyColor(0x040924);
const BMW_F90_M5_METALLIC_MARINA_BAY_BLUE = legacyColor(0x040924);
const TOYOTA_CROWN_SILVER = legacyColor(0x8f9296);
const WHEEL_NAME_HINT_REGEX =
    /(^|[^a-z])(wheel|tire|tyre|rim)([^a-z]|$)/i;
const WHEEL_MATERIAL_HINT_REGEX =
    /(wheel|tire|tyre|rim|rubber|michelin)/i;
const NON_WHEEL_NAME_HINT_REGEX =
    /(trim|decal|dirt|dust|mud|grime|glass|window|windshield|body|door|hood|trunk|mirror|bumper|panel|steering|brake|disc|disk|rotor|caliper|hub|suspension)/i;
const BRAKE_WHEEL_PART_HINT_REGEX = /(brake|disc|disk|rotor|caliper|hub)/i;
const FIXED_BRAKE_PART_HINT_REGEX = /(brake|caliper|disc|disk|rotor)/i;
const WHEEL_LINKED_ATTACHMENT_HINT_REGEX = /(rim|spoke)/i;
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
    wheelContactCount: number;
    suspensionCompression: number[];
    surfaceNormal: [number, number, number];
    lateralG: number;
    longitudinalG: number;
    bodySlipDeg: number;
    steerAngle: number;
    frontSlide: number;
    rearSlide: number;
    wheelSurfaces: TrackSurface[];
    onKerb: boolean;
    onGrass: boolean;
    barrierContact: number;
    impact: number;
    shifting: boolean;
    limiter: boolean;
    abs: boolean;
    tractionControl: boolean;
    stability: boolean;
    driftAssist: boolean;
    driftTargetDeg: number;
    trackDistance: number;
    trackLateral: number;
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
    steerAxis: THREE.Vector3;
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

type GroundContact = {
    hit: any;
    offsetX: number;
    offsetZ: number;
    compression: number;
    predictive?: boolean;
};

export default class RaceVehicle {
    application: Application;
    resources: Resources;
    input: DrivingInput;
    track: NordschleifeTrack;
    // the track's chunked collider, or a flat pad in the test benches
    colliderMesh: THREE.Object3D;
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
    stepStartY: number;
    yaw: number;
    steerAngle: number;
    steerVisualAngle: number;
    wheelSpinAngle: number;
    rideHeight: number;
    wheelRadius: number;
    physics: VehiclePhysics;
    trackFrame: TrackFrame;
    wheelFrame: TrackFrame;
    wheelSurfaces: TrackSurface[];
    barrierContact: number;
    impact: number;
    frontSpinAngle: number;
    rearSpinAngle: number;
    physicsSurface: PhysicsSurface;
    barrierPoint: THREE.Vector3;
    startResets: number;
    // test benches drive on a flat pad away from the track and turn this off
    trackBound: boolean;
    wheelContactPoints: THREE.Vector3[];
    // grid slot at the start line in a lobby, 0 is pole
    spawnSlot: number;
    // weak gpu: cars get phong materials when they're prepared
    cheapMaterials: boolean;
    bodyRadius: number;
    bodySize: THREE.Vector3;
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    surfaceNormal: THREE.Vector3;
    surfaceForward: THREE.Vector3;
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
    wheelContactCount: number;
    suspensionCompression: number[];
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
    tmpVectorG: THREE.Vector3;
    tmpVectorH: THREE.Vector3;
    tmpVectorI: THREE.Vector3;
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
        this.stepStartY = 0;
        this.yaw = 0;
        this.steerAngle = 0;
        this.steerVisualAngle = 0;
        this.wheelSpinAngle = 0;
        this.rideHeight = this.currentTuning.wheelRadiusMeters + 0.02;
        this.wheelRadius = this.currentTuning.wheelRadiusMeters;
        this.trackFrame = this.track.createFrame();
        this.wheelFrame = this.track.createFrame();
        this.wheelSurfaces = ['asphalt', 'asphalt', 'asphalt', 'asphalt'];
        this.barrierContact = 0;
        this.impact = 0;
        this.frontSpinAngle = 0;
        this.rearSpinAngle = 0;
        this.physicsSurface = {
            grounded: true,
            slopeForward: 0,
            slopeLeft: 0,
            normalScale: 1,
            grip: [1, 1, 1, 1],
            drag: [0, 0, 0, 0],
        };
        this.barrierPoint = new THREE.Vector3();
        this.startResets = 0;
        this.trackBound = true;
        this.wheelContactPoints = [0, 1, 2, 3].map(() => new THREE.Vector3());
        this.spawnSlot = 0;
        this.cheapMaterials = false;
        this.physics = new VehiclePhysics(
            buildPhysicsSpec(
                carOptionsById[this.currentCarId] ||
                    carOptionsById[defaultCarId],
                defaultWheelGeometry(
                    carOptionsById[this.currentCarId] ||
                        carOptionsById[defaultCarId],
                    this.currentTuning.wheelRadiusMeters
                )
            )
        );
        this.physics.onShift = (gear) => {
            UIEventBus.dispatch('race:gearShift', {
                gear,
                carId: this.currentCarId,
            });
        };
        this.bodyRadius = 2.4;
        this.bodySize = new THREE.Vector3(4.7, 1.4, 2.1);
        this.position = new THREE.Vector3();
        this.velocity = new THREE.Vector3();
        this.surfaceNormal = new THREE.Vector3(0, 1, 0);
        this.surfaceForward = new THREE.Vector3(0, 0, 1);
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
        this.wheelContactCount = 0;
        this.suspensionCompression = [0, 0, 0, 0];
        this.wheelRig = [];
        this.frontWheelRig = [];
        this.rearWheelRig = [];

        this.tmpVectorA = new THREE.Vector3();
        this.tmpVectorB = new THREE.Vector3();
        this.tmpVectorC = new THREE.Vector3();
        this.tmpVectorD = new THREE.Vector3();
        this.tmpVectorE = new THREE.Vector3();
        this.tmpVectorF = new THREE.Vector3();
        this.tmpVectorG = new THREE.Vector3();
        this.tmpVectorH = new THREE.Vector3();
        this.tmpVectorI = new THREE.Vector3();
        this.tmpMatrix = new THREE.Matrix4();
        this.tmpQuatA = new THREE.Quaternion();
        this.tmpQuatB = new THREE.Quaternion();
        this.tmpQuatC = new THREE.Quaternion();
        this.tmpQuatD = new THREE.Quaternion();
        this.tmpQuatE = new THREE.Quaternion();
        this.tmpQuatG = new THREE.Quaternion();

        this.setCarTuning(this.currentCarId);
        this.setupAssists();
        this.setupCarSwitcher();
        this.setModel(this.currentCarId);
        this.resetToStart();
    }

    setupAssists() {
        const apply = (preset: AssistPreset, autoGears: boolean) => {
            Object.assign(this.physics.assists, ASSIST_PRESETS[preset], {
                autoGears,
            });
        };
        const stored = readAssistSettings();
        apply(stored.preset, stored.autoGears);
        UIEventBus.on(
            'race:assists',
            (payload: { preset?: string; autoGears?: boolean } | undefined) => {
                const current = readAssistSettings();
                const preset =
                    payload?.preset && payload.preset in ASSIST_PRESETS
                        ? (payload.preset as AssistPreset)
                        : current.preset;
                const autoGears =
                    typeof payload?.autoGears === 'boolean'
                        ? payload.autoGears
                        : current.autoGears;
                apply(preset, autoGears);
                writeAssistSettings({ preset, autoGears });
            }
        );
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

        const configuredWheelRadius = this.currentTuning.wheelRadiusMeters;
        this.wheelRadius =
            Number.isFinite(configuredWheelRadius) && configuredWheelRadius > 0
                ? configuredWheelRadius
                : WHEEL_RADIUS_PLAUSIBLE_MIN;
        this.rideHeight = THREE.MathUtils.clamp(this.wheelRadius * 0.98, 0.16, 0.52);

        if (this.physics) {
            this.physics.setSpec(
                buildPhysicsSpec(
                    option,
                    defaultWheelGeometry(option, this.wheelRadius)
                )
            );
        }

        this.rpm = THREE.MathUtils.clamp(
            this.rpm,
            this.currentTuning.idleRpm,
            this.currentTuning.redlineRpm
        );
        if (this.gear > 0) {
            const maxGear = Math.max(1, this.currentTuning.gearRatios.length);
            this.gear = Number.isFinite(this.gear)
                ? THREE.MathUtils.clamp(Math.floor(this.gear), 1, maxGear)
                : 1;
        }
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

    // switch to the weak gpu car materials: models already prepared are
    // built again, the one on screen swapped for its new version
    useCheapMaterials() {
        if (this.cheapMaterials) return;
        this.cheapMaterials = true;
        this.cachedModels.clear();
        if (this.currentCarId && this.carModel)
            this.setModel(this.currentCarId);
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

        // weak gpus race the low detail car (scripts/optimize-models.mjs --lite)
        const cheap = this.cheapMaterials;
        const path = cheap
            ? option.modelPath.replace(/\.glb$/, '.lite.glb')
            : option.modelPath;
        const loadPromise = new Promise<THREE.Group>((resolve, reject) => {
            this.resources.loaders.gltfLoader.load(
                path,
                (gltf) => {
                    if (!cheap)
                        this.resources.items.gltfModel[option.resourceName] =
                            gltf;
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
                // a full model finishing after the switch to lite isn't kept
                if (cheap === this.cheapMaterials)
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
        // the preloaded model is the full detail one
        if (this.cheapMaterials) return null;

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
        if (carId === BMW_F90_M5_COMPETITION_ID) {
            this.linkBmwM5CompetitionWheelDetails(model, wheelRig);
        }
        if (carId === AMG_ONE_ID) {
            this.linkAmgOneAxleTires(model, wheelRig);
            wheelRig = this.collapseAmgOneAxleWheelRig(wheelRig);
            this.normalizeLinkedWheelClusterCenters(wheelRig);
        }
        this.applyWheelFinishStyling(model, carId, wheelRig);
        const wheelRadius = this.getDetectedWheelRadius(wheelRig);
        const rideHeight = THREE.MathUtils.clamp(wheelRadius * 0.98, 0.16, 0.52);

        const bbox = new THREE.Box3().setFromObject(model);
        const contactBottom =
            this.getGeometricContactBottom(model, wheelRig) ??
            this.getWheelContactBottom(wheelRig) ??
            bbox.min.y;
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

        if (this.cheapMaterials) {
            const envMap = getCheapSkyCube();
            model.traverse((child) => {
                const mesh = child as THREE.Mesh;
                if (!mesh.isMesh || Array.isArray(mesh.material)) return;
                mesh.material = toCheapCarMaterial(mesh.material, envMap);
            });
        }
        this.mergeStaticMeshes(model, wheelRig);

        // soft darkening right under the car, the sun shadow alone reads as
        // floating at the contact patches
        addContactShadow(
            this.application.renderer.instance,
            model,
            -rideHeight + (option?.race.groundOffsetMeters || 0),
            0.025
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

    // lowest real geometry under each wheel. detected radii often come from the
    // rim or a merged axle, which floated or sank whole cars by several cm
    getGeometricContactBottom(model: THREE.Object3D, wheels: WheelRig[]) {
        model.updateMatrixWorld(true);
        const box = new THREE.Box3();
        const point = new THREE.Vector3();
        const bottoms: number[] = [];
        const lowestVertex = (object: THREE.Object3D) => {
            let min = Infinity;
            object.traverse((child) => {
                if (!(child instanceof THREE.Mesh) || !child.visible) return;
                const position = child.geometry?.getAttribute('position');
                if (!position) return;
                for (let i = 0; i < position.count; i++) {
                    point
                        .fromBufferAttribute(position, i)
                        .applyMatrix4(child.matrixWorld);
                    min = Math.min(min, point.y);
                }
            });
            return min;
        };

        const columns: {
            x: number;
            z: number;
            top: number;
            halfX: number;
            halfZ: number;
            min: number;
        }[] = [];
        wheels.forEach((wheel) => {
            if (!(wheel.radius > 0)) return;
            if (wheel.radius > MAX_SINGLE_WHEEL_RADIUS) {
                // a merged axle (amg one): a column there would span the whole
                // underbody, so use the axle's own rim and tire meshes
                const min = Math.min(
                    lowestVertex(wheel.object),
                    ...wheel.linkedVisuals.map((linked) =>
                        lowestVertex(linked.object)
                    )
                );
                if (Number.isFinite(min)) bottoms.push(min);
                return;
            }
            // rig centers are scaled model space, not rotated with the model
            const center = wheel.localCenter
                .clone()
                .applyQuaternion(model.quaternion);
            columns.push({
                x: center.x,
                z: center.z,
                top: center.y,
                halfX: wheel.radius * 1.2,
                halfZ: wheel.radius * 0.35,
                min: Infinity,
            });
        });

        model.traverse((child) => {
            if (!columns.length) return;
            if (!(child instanceof THREE.Mesh) || !child.visible) return;
            const position = child.geometry?.getAttribute('position');
            if (!position) return;
            box.setFromObject(child);
            const near = columns.filter(
                (column) =>
                    box.min.y < column.top &&
                    box.max.x >= column.x - column.halfX &&
                    box.min.x <= column.x + column.halfX &&
                    box.max.z >= column.z - column.halfZ &&
                    box.min.z <= column.z + column.halfZ
            );
            if (!near.length) return;
            for (let i = 0; i < position.count; i++) {
                point
                    .fromBufferAttribute(position, i)
                    .applyMatrix4(child.matrixWorld);
                near.forEach((column) => {
                    if (
                        point.y < column.min &&
                        Math.abs(point.x - column.x) <= column.halfX &&
                        Math.abs(point.z - column.z) <= column.halfZ
                    ) {
                        column.min = point.y;
                    }
                });
            }
        });

        columns.forEach((column) => {
            if (Number.isFinite(column.min)) bottoms.push(column.min);
        });
        if (bottoms.length < 2) return null;
        return bottoms.reduce((sum, value) => sum + value, 0) / bottoms.length;
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

    linkAmgOneAxleTires(model: THREE.Object3D, wheelRig: WheelRig[]) {
        const linkAxle = (front: boolean, tireMeshNames: string[]) => {
            const axleWheel =
                wheelRig.find((wheel) => wheel.front === front && wheel.left) ||
                wheelRig.find((wheel) => wheel.front === front);
            if (!axleWheel) return;

            const primaryBox = new THREE.Box3().setFromObject(axleWheel.object);
            if (primaryBox.isEmpty()) return;
            const primaryCenterWorld = primaryBox.getCenter(new THREE.Vector3());
            const existing = new Set([
                axleWheel.object.uuid,
                ...axleWheel.linkedVisuals.map((linked) => linked.object.uuid),
            ]);

            tireMeshNames.forEach((name) => {
                const tireMesh = model.getObjectByName(name);
                if (!tireMesh || existing.has(tireMesh.uuid)) return;
                axleWheel.linkedVisuals.push({
                    object: tireMesh,
                    spinCenter: this.getWheelLinkedSpinCenter(
                        tireMesh,
                        primaryCenterWorld
                    ),
                    basePosition: tireMesh.position.clone(),
                    baseQuaternion: tireMesh.quaternion.clone(),
                });
                existing.add(tireMesh.uuid);
            });
        };

        linkAxle(true, [
            'rubber_tread_0',
            'rubber_rubber_side_0',
        ]);
        linkAxle(false, [
            'rubber1_tread_0',
            'rubber1_rubber_side_0',
        ]);
    }

    linkBmwM5CompetitionWheelDetails(model: THREE.Object3D, wheelRig: WheelRig[]) {
        if (!wheelRig.length) return;

        model.updateMatrixWorld(true);
        const wheelCenters = wheelRig.map((wheel) => {
            const box = new THREE.Box3().setFromObject(wheel.object);
            return {
                wheel,
                center: box.isEmpty()
                    ? wheel.object.getWorldPosition(new THREE.Vector3())
                    : box.getCenter(new THREE.Vector3()),
            };
        });
        const linked = new Set<string>();
        wheelRig.forEach((wheel) => {
            linked.add(wheel.object.uuid);
            wheel.linkedVisuals.forEach((visual) => linked.add(visual.object.uuid));
        });

        model.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;
            if (linked.has(child.uuid)) return;

            const name = child.name || '';
            const materialName = Array.isArray(child.material)
                ? child.material.map((material) => material?.name || '').join(' ')
                : child.material?.name || '';
            const haystack = `${name} ${materialName}`;
            if (/brake/i.test(name)) return;
            const isM5RimDetail =
                /BMW_M5CSRewardRecycled_2022_Wheel1A_3D_3DWheel1A_Material/i.test(
                    haystack
                );
            const isM5RotatingHubOrDisk = /bSM_(Hub|Disk)_/i.test(name);
            if (!isM5RimDetail && !isM5RotatingHubOrDisk) return;

            const box = new THREE.Box3().setFromObject(child);
            if (box.isEmpty()) return;
            const center = box.getCenter(new THREE.Vector3());
            let nearest = wheelCenters[0];
            let nearestDistance = Infinity;
            wheelCenters.forEach((candidate) => {
                const distance = center.distanceTo(candidate.center);
                if (distance < nearestDistance) {
                    nearest = candidate;
                    nearestDistance = distance;
                }
            });
            if (!nearest || nearestDistance > 0.48) return;

            nearest.wheel.linkedVisuals.push({
                object: child,
                spinCenter: this.getWheelLinkedSpinCenter(
                    child,
                    nearest.center
                ),
                basePosition: child.position.clone(),
                baseQuaternion: child.quaternion.clone(),
            });
            linked.add(child.uuid);
        });
    }

    collapseAmgOneAxleWheelRig(wheelRig: WheelRig[]) {
        const collapseAxle = (front: boolean) => {
            const axleWheels = wheelRig.filter((wheel) => wheel.front === front);
            const primary =
                axleWheels.find((wheel) => wheel.left) || axleWheels[0] || null;
            if (!primary) return null;

            const existing = new Set<string>([
                primary.object.uuid,
                ...primary.linkedVisuals.map((linked) => linked.object.uuid),
            ]);

            axleWheels.forEach((wheel) => {
                if (wheel === primary) return;
                if (!existing.has(wheel.object.uuid)) {
                    const wheelCenterWorld = wheel.object.parent
                        ? wheel.object.parent.localToWorld(wheel.spinCenter.clone())
                        : wheel.object.getWorldPosition(this.tmpVectorA);
                    primary.linkedVisuals.push({
                        object: wheel.object,
                        spinCenter: this.getWheelLinkedSpinCenter(
                            wheel.object,
                            wheelCenterWorld
                        ),
                        basePosition: wheel.basePosition.clone(),
                        baseQuaternion: wheel.baseQuaternion.clone(),
                    });
                    existing.add(wheel.object.uuid);
                }
                wheel.linkedVisuals.forEach((linked) => {
                    if (existing.has(linked.object.uuid)) return;
                    primary.linkedVisuals.push({
                        object: linked.object,
                        spinCenter: linked.spinCenter.clone(),
                        basePosition: linked.basePosition.clone(),
                        baseQuaternion: linked.baseQuaternion.clone(),
                    });
                    existing.add(linked.object.uuid);
                });
            });

            return primary;
        };

        const front = collapseAxle(true);
        const rear = collapseAxle(false);
        return [front, rear].filter(Boolean) as WheelRig[];
    }

    normalizeLinkedWheelClusterCenters(wheelRig: WheelRig[]) {
        const clusterBox = new THREE.Box3();
        const itemBox = new THREE.Box3();
        const clusterCenterWorld = new THREE.Vector3();

        wheelRig.forEach((wheel) => {
            clusterBox.makeEmpty();
            itemBox.setFromObject(wheel.object);
            if (!itemBox.isEmpty()) {
                clusterBox.union(itemBox);
            }
            wheel.linkedVisuals.forEach((linked) => {
                itemBox.setFromObject(linked.object);
                if (!itemBox.isEmpty()) {
                    clusterBox.union(itemBox);
                }
            });
            if (clusterBox.isEmpty()) return;

            clusterBox.getCenter(clusterCenterWorld);
            if (wheel.object.parent) {
                wheel.spinCenter = wheel.object.parent.worldToLocal(
                    clusterCenterWorld.clone()
                );
            }
            wheel.linkedVisuals.forEach((linked) => {
                if (!linked.object.parent) return;
                linked.spinCenter = linked.object.parent.worldToLocal(
                    clusterCenterWorld.clone()
                );
            });
        });
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
            if (this.isFixedBrakePartObject(child) || this.isBrakeLikeWheelPartObject(child)) {
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
            if (this.isFixedBrakePartObject(child) || this.isBrakeLikeWheelPartObject(child)) {
                return;
            }

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

                const nodeIsWheelGroup =
                    node === matchedNode && !(node instanceof THREE.Mesh);
                mappedWheels.push({
                    object: node,
                    linkedVisuals: nodeIsWheelGroup
                        ? []
                        : this.collectWheelLinkedVisuals(
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
                    steerAxis: new THREE.Vector3(0, 1, 0),
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
                steerAxis: new THREE.Vector3(0, 1, 0),
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

        if (
            !(mappedNode instanceof THREE.Mesh) &&
            !this.isBrakeLikeWheelPartObject(mappedNode)
        ) {
            const mappedName = (mappedNode.name || '').toLowerCase();
            const mappedBox = new THREE.Box3().setFromObject(mappedNode);
            let meshChildCount = 0;
            mappedNode.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    meshChildCount += 1;
                }
            });

            if (!mappedBox.isEmpty() && meshChildCount > 1) {
                mappedBox.getSize(size);
                const mappedRadius = Math.max(size.x, size.y, size.z) * 0.5;
                const wheelGroupRadiusPlausible =
                    Number.isFinite(mappedRadius) &&
                    mappedRadius >= WHEEL_RADIUS_PLAUSIBLE_MIN &&
                    mappedRadius <= WHEEL_RADIUS_PLAUSIBLE_MAX * 2;
                const canUseMappedWheelGroup =
                    mappedName.includes('arm4_vt_wheel') ||
                    (this.currentCarId === BMW_M8_COMPETITION_COUPE_ID &&
                        (mappedName.includes('3dwheel front') ||
                            mappedName.includes('3dwheel rear') ||
                            mappedName.includes('3dwheel_front') ||
                            mappedName.includes('3dwheel_rear')));
                if (
                    wheelGroupRadiusPlausible &&
                    canUseMappedWheelGroup
                ) {
                    return mappedNode;
                }
            }
        }

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
                steerAxis: new THREE.Vector3(0, 1, 0),
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
        const modelUpWorld = this.tmpVectorB.copy(modelDownWorld).multiplyScalar(-1);

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
            if (!wheel.steerAxis) {
                wheel.steerAxis = new THREE.Vector3(0, 1, 0);
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
            this.setObjectParentLocalDirection(
                wheel.object,
                modelUpWorld,
                wheel.steerAxis
            );
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

    setObjectParentLocalDirection(
        object: THREE.Object3D,
        worldDirection: THREE.Vector3,
        target: THREE.Vector3
    ) {
        target.copy(worldDirection).normalize();
        const parent = object.parent;
        if (!parent || target.lengthSq() <= 1e-8) {
            target.set(0, 1, 0);
            return target;
        }

        parent.getWorldQuaternion(this.tmpQuatB);
        target.applyQuaternion(this.tmpQuatB.invert()).normalize();
        if (target.lengthSq() <= 1e-8) {
            target.set(0, 1, 0);
        }
        return target;
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

    // a copy per mesh: the finish code tints some meshes by name (m5 side
    // windows), which must not reach others that share the source material.
    // merging matches materials by what they look like, not by object
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

    // a car model is dozens to a thousand meshes, most of them trim sharing a
    // few materials. merging them per material cuts the draw calls (and the
    // shadow pass) to a handful. each wheel and linked part is merged within
    // itself, since it spins and steers as one piece
    mergeStaticMeshes(model: THREE.Object3D, wheelRig: WheelRig[]) {
        model.updateMatrixWorld(true);
        // linked visuals are wheel parts that live elsewhere in the model and
        // follow their wheel rigidly, one draw each (the m5 has 113). as
        // children of the wheel they move the same and can merge with it
        wheelRig.forEach((wheel) => {
            wheel.linkedVisuals.forEach((linked) =>
                wheel.object.attach(linked.object)
            );
            wheel.linkedVisuals.length = 0;
        });
        const roots = new Set<THREE.Object3D>();
        wheelRig.forEach((wheel) => roots.add(wheel.object));
        model.updateMatrixWorld(true);
        this.mergeUnder(model, roots);
        roots.forEach((root) => this.mergeUnder(root, roots));
    }

    // on a weak gpu every opaque untextured unlit part of a car can share one
    // vertex colored material, the e92 alone is ~40 of those
    isPlainCheap(material: THREE.Material) {
        const m = material as THREE.MeshPhongMaterial;
        if (!this.cheapMaterials || !m.isMeshPhongMaterial) return false;
        if (m.transparent || m.alphaTest > 0) return false;
        if (m.map || m.normalMap || m.alphaMap || m.emissiveMap) return false;
        return m.emissive.r + m.emissive.g + m.emissive.b < 1e-3;
    }

    bakeColor(geometry: THREE.BufferGeometry, color: THREE.Color) {
        const colors = geometry.getAttribute('color') as THREE.BufferAttribute;
        for (let i = 0; i < colors.count; i++) {
            colors.setXYZ(
                i,
                colors.getX(i) * color.r,
                colors.getY(i) * color.g,
                colors.getZ(i) * color.b
            );
        }
    }

    // the shared one takes the average shine of its parts, weighted by size
    plainCheapMaterial(meshes: THREE.Mesh[]) {
        let weight = 0;
        let reflectivity = 0;
        let shininess = 0;
        let specular = 0;
        meshes.forEach((mesh) => {
            const m = mesh.material as THREE.MeshPhongMaterial;
            const w = mesh.geometry.getAttribute('position').count;
            weight += w;
            reflectivity += m.reflectivity * w;
            shininess += m.shininess * w;
            specular += m.specular.r * w;
        });
        const first = meshes[0].material as THREE.MeshPhongMaterial;
        return new THREE.MeshPhongMaterial({
            name: 'car-plain',
            vertexColors: true,
            side: first.side,
            envMap: first.envMap,
            combine: THREE.MixOperation,
            reflectivity: reflectivity / weight,
            shininess: shininess / weight,
            specular: new THREE.Color().setScalar(specular / weight),
        });
    }

    // exports often repeat a material per primitive, so match on what it
    // looks like rather than which object it is
    materialSignature(material: THREE.Material) {
        const m = material as THREE.MeshPhysicalMaterial;
        const tex = (t?: THREE.Texture | null) =>
            t ? t.source?.uuid || t.uuid : '-';
        return [
            m.type,
            m.color?.getHexString(),
            m.emissive?.getHexString(),
            m.emissiveIntensity,
            m.roughness,
            m.metalness,
            m.opacity,
            m.transparent,
            m.side,
            m.alphaTest,
            m.depthWrite,
            m.vertexColors,
            m.clearcoat,
            m.clearcoatRoughness,
            m.transmission,
            m.envMapIntensity,
            m.polygonOffset,
            tex(m.map),
            tex(m.normalMap),
            tex(m.roughnessMap),
            tex(m.metalnessMap),
            tex(m.emissiveMap),
            tex(m.alphaMap),
            tex(m.aoMap),
        ].join(':');
    }

    // what a material reads from its geometry, the rest can be dropped
    attributesFor(material: THREE.Material) {
        const m = material as THREE.MeshStandardMaterial;
        const needed: Record<string, number> = { position: 3, normal: 3 };
        if (
            m.map ||
            m.normalMap ||
            m.roughnessMap ||
            m.metalnessMap ||
            m.alphaMap ||
            m.emissiveMap ||
            m.bumpMap
        ) {
            needed.uv = 2;
        }
        if (m.aoMap || m.lightMap) needed.uv1 = 2;
        if (m.vertexColors) needed.color = 3;
        return needed;
    }

    // same attribute set on every part so they merge: extras dropped, missing
    // uvs zeroed, missing colors white, missing normals computed
    normalizeAttributes(
        geometry: THREE.BufferGeometry,
        needed: Record<string, number>
    ) {
        Object.keys(geometry.attributes).forEach((name) => {
            if (!(name in needed)) geometry.deleteAttribute(name);
        });
        geometry.morphAttributes = {};
        const count = geometry.getAttribute('position').count;
        Object.entries(needed).forEach(([name, size]) => {
            const existing = geometry.getAttribute(name) as
                THREE.BufferAttribute | undefined;
            if (
                existing &&
                existing.itemSize === size &&
                !(existing as unknown as THREE.InterleavedBufferAttribute)
                    .isInterleavedBufferAttribute &&
                existing.array instanceof Float32Array &&
                !existing.normalized
            ) {
                return;
            }
            if (existing) {
                // interleaved, normalized or integer data: plain floats instead
                const values = new Float32Array(count * size);
                for (let i = 0; i < count; i++) {
                    for (let k = 0; k < size; k++)
                        values[i * size + k] = existing.getComponent(i, k);
                }
                geometry.setAttribute(
                    name,
                    new THREE.BufferAttribute(values, size)
                );
                return;
            }
            if (name === 'normal') {
                geometry.computeVertexNormals();
                return;
            }
            const fill = name === 'color' ? 1 : 0;
            geometry.setAttribute(
                name,
                new THREE.BufferAttribute(
                    new Float32Array(count * size).fill(fill),
                    size
                )
            );
        });
        return geometry;
    }

    // merge the meshes below root, stopping at any other root in the set
    mergeUnder(root: THREE.Object3D, roots: Set<THREE.Object3D>) {
        const ownerOf = (object: THREE.Object3D) => {
            for (
                let node: THREE.Object3D | null = object;
                node;
                node = node.parent
            ) {
                if (node === root) return true;
                if (roots.has(node)) return false;
            }
            return false;
        };
        const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
        const groups = new Map<string, THREE.Mesh[]>();
        root.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh)
                return;
            if ((mesh as THREE.InstancedMesh).isInstancedMesh) return;
            if (Array.isArray(mesh.material) || !mesh.visible) return;
            const geometry = mesh.geometry;
            if (Object.keys(geometry.morphAttributes).length) return;
            // a root that is a mesh itself stays as it is, hiding it would
            // hide what's merged under it too
            if (mesh === root || roots.has(mesh)) return;
            if (!ownerOf(mesh.parent || mesh)) return;
            if (!geometry.getAttribute('position')) return;
            // transparent parts sort per object (glass over lights), merging
            // them would scramble that order
            if (mesh.material.transparent) return;
            // plain parts group by how shiny they are, so tires stay matte
            const phong = mesh.material as THREE.MeshPhongMaterial;
            const look = this.isPlainCheap(mesh.material)
                ? `plain:${phong.side}:${Math.round(phong.reflectivity * 10)}:${Math.round(phong.shininess / 30)}`
                : this.materialSignature(mesh.material);
            const key = `${look}|${mesh.castShadow}|${mesh.renderOrder}`;
            const list = groups.get(key);
            if (list) list.push(mesh);
            else groups.set(key, [mesh]);
        });
        const matrix = new THREE.Matrix4();
        groups.forEach((meshes) => {
            if (meshes.length < 2) return;
            const indexed = meshes.every((mesh) => mesh.geometry.index);
            const plain = this.isPlainCheap(
                meshes[0].material as THREE.Material
            );
            const needed = plain
                ? { position: 3, normal: 3, color: 3 }
                : this.attributesFor(meshes[0].material as THREE.Material);
            const parts = meshes.map((mesh) => {
                matrix.multiplyMatrices(toRoot, mesh.matrixWorld);
                const source = mesh.material as THREE.MeshPhongMaterial;
                const clone = mesh.geometry.clone();
                // vertex colors only count where the material used them
                if (plain && !source.vertexColors)
                    clone.deleteAttribute('color');
                // floats first: quantized positions would clip when moved
                let geometry = this.normalizeAttributes(clone, needed);
                if (plain) this.bakeColor(geometry, source.color);
                if (!indexed && geometry.index)
                    geometry = geometry.toNonIndexed();
                return geometry.applyMatrix4(matrix);
            });
            const merged = mergeGeometries(parts);
            parts.forEach((part) => part.dispose());
            if (!merged) return;
            const first = meshes[0];
            const mesh = new THREE.Mesh(
                merged,
                plain ? this.plainCheapMaterial(meshes) : first.material
            );
            mesh.name = `${first.name || 'car'}-merged`;
            mesh.castShadow = first.castShadow;
            mesh.receiveShadow = first.receiveShadow;
            mesh.renderOrder = first.renderOrder;
            root.add(mesh);
            meshes.forEach((original) => original.removeFromParent());
        });
    }

    applyMaterialTweaks(model: THREE.Object3D, carId: string) {
        model.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;
            // the sun is low, so the car throws a long shadow down the road
            child.castShadow = true;
            child.receiveShadow = true;

            if (!child.material || Array.isArray(child.material)) return;
            const material = child.material as THREE.MeshStandardMaterial;
            this.applyTextureQuality(material);
            // no own env map: race mode lights and reflects the cars with the
            // sky (scene.environment) instead of the room
            material.envMap = null;
            material.envMapIntensity = 1;
            material.needsUpdate = true;
        });
        if (carId !== MERCEDES_GT63S_EDITION_ONE_ID) {
            this.applyRaceMaterialStyling(model, carId);
        }
        applyCarFinish(model, carOptionsById[carId]);
        // a mirror sharp clearcoat turns the sun into a white blowout across
        // the roof. a slightly softer coat still reads as fresh paint
        model.traverse((child) => {
            if (!(child instanceof THREE.Mesh) || Array.isArray(child.material)) return;
            const material = child.material;
            if (material instanceof THREE.MeshPhysicalMaterial && material.clearcoat > 0) {
                material.clearcoatRoughness = Math.max(material.clearcoatRoughness, 0.22);
                material.roughness = Math.max(material.roughness, 0.26);
            }
            if (material instanceof THREE.MeshStandardMaterial) {
                material.envMapIntensity = RACE_ENV_INTENSITY;
                // lights and badges are tuned for the unlit room, through
                // the race bloom they flare into a white haze over the body
                if (material.emissive && material.emissive.getHex() !== 0) {
                    material.emissiveIntensity = Math.min(material.emissiveIntensity, RACE_EMISSIVE_MAX);
                }
            }
        });
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

    applyRaceMaterialStyling(model: THREE.Object3D, carId: string) {
        let bodyColor: THREE.Color;
        let bodyMatchers: string[] = [];
        let roughness = 0.18;
        let metalness = 1;
        let envMapIntensity = 1.1;
        let clearBaseColorMap = false;

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
            bodyColor = BMW_F90_M5_METALLIC_MARINA_BAY_BLUE;
            bodyMatchers = ['m5_metallic', 'mat_m5_metallic'];
            roughness = 0.12;
            metalness = 1;
            envMapIntensity = 1.35;
        } else if (carId === BMW_M8_COMPETITION_COUPE_ID) {
            bodyColor = BMW_M8_FROZEN_MARINA_BAY_BLUE;
            bodyMatchers = ['m8competition_2020paint'];
            roughness = 0.38;
            metalness = 0.85;
            envMapIntensity = 0.85;
            clearBaseColorMap = true;
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

            if (clearBaseColorMap) {
                material.map = null;
            }
            material.color.copy(bodyColor);
            material.metalness = metalness;
            material.roughness = roughness;
            material.envMapIntensity = envMapIntensity;
            material.needsUpdate = true;
        });

        if (carId === BMW_F90_M5_COMPETITION_ID) {
            applyBmwM5GlassTint(model);
        }
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
        const shouldAnimateWheels =
            this.currentCarId === AMG_ONE_ID || this.isWheelRigSpatiallyValid(wheelRig);
        this.wheelRig = shouldAnimateWheels ? wheelRig : [];
        this.frontWheelRig = this.wheelRig.filter((wheel) => wheel.front);
        this.rearWheelRig = this.wheelRig.filter((wheel) => wheel.rear);
        this.configureWheelSpinAxes(this.wheelRig, this.carModel || undefined);

        const modelWheelRadius = Number(model.userData.raceWheelRadius);
        this.wheelRadius =
            Number.isFinite(modelWheelRadius) && modelWheelRadius > 0
                ? modelWheelRadius
                : this.wheelRadius;
        this.rideHeight =
            Number(model.userData.raceRideHeight) ||
            THREE.MathUtils.clamp(this.wheelRadius * 0.98, 0.16, 0.52);
        this.bodyRadius = Number(model.userData.raceBodyRadius) || this.bodyRadius;

        const bodySize = model.userData.raceBodySize as number[] | undefined;
        if (Array.isArray(bodySize) && bodySize.length === 3) {
            this.bodySize.set(bodySize[0], bodySize[1], bodySize[2]);
        }
        const option =
            carOptionsById[this.currentCarId] || carOptionsById[defaultCarId];
        this.physics.setSpec(
            buildPhysicsSpec(option, this.getWheelGeometry(model))
        );
    }

    // wheelbase and track from the wheel rig, in the pivot frame (meters)
    getWheelGeometry(model: THREE.Group): WheelGeometry {
        const option =
            carOptionsById[this.currentCarId] || carOptionsById[defaultCarId];
        const fallback = defaultWheelGeometry(option, this.wheelRadius);
        const rig = (model.userData.raceWheelRig || []) as WheelRig[];
        const toPivot = (wheel: WheelRig) =>
            wheel.localCenter
                .clone()
                .applyQuaternion(model.quaternion)
                .add(model.position);
        const fronts = rig.filter((wheel) => wheel.front).map(toPivot);
        const rears = rig.filter((wheel) => !wheel.front).map(toPivot);
        if (fronts.length < 2 || rears.length < 2) return fallback;
        const meanZ = (list: THREE.Vector3[]) =>
            list.reduce((sum, point) => sum + point.z, 0) / list.length;
        const width = (list: THREE.Vector3[]) =>
            Math.max(...list.map((point) => point.x)) -
            Math.min(...list.map((point) => point.x));
        const wheelbase = Math.abs(meanZ(fronts) - meanZ(rears));
        const trackFront = width(fronts);
        const trackRear = width(rears);
        const plausible =
            wheelbase > 2 &&
            wheelbase < 3.6 &&
            trackFront > 1.2 &&
            trackFront < 2 &&
            trackRear > 1.2 &&
            trackRear < 2;
        if (!plausible) return fallback;
        return {
            wheelbase,
            trackFront,
            trackRear,
            wheelRadius: this.wheelRadius,
        };
    }

    isWheelRigSpatiallyValid(wheels: WheelRig[]) {
        if (wheels.length < 4) return false;
        const xValues = wheels.map((wheel) => wheel.localCenter.x);
        const zValues = wheels.map((wheel) => wheel.localCenter.z);
        const xRange = Math.max(...xValues) - Math.min(...xValues);
        const zRange = Math.max(...zValues) - Math.min(...zValues);
        return xRange >= 0.65 && zRange >= 1.2;
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
            this.wheelContactCount = 0;
            this.suspensionCompression = [0, 0, 0, 0];
            this.clearSafeStateHistory();
            this.speedMps = 0;
            this.lateralSpeed = 0;
            this.driftAmount = 0;
            this.slipRatio = 0;
            this.verticalVelocity = 0;
            this.steerAngle = 0;
            this.steerVisualAngle = 0;
            this.wheelSpinAngle = 0;
            this.frontSpinAngle = 0;
            this.rearSpinAngle = 0;
            this.smokeSpawnCooldown = 0;
            this.barrierContact = 0;
            this.impact = 0;
            this.physics.reset(this.yaw, 0);
            this.input.reset();
            this.resetWheelVisuals();
        }
    }

    resetToStart() {
        this.startResets += 1;
        const curve = this.track.getCurve();
        const point = curve.getPointAt(SPAWN_T);
        const tangent = curve.getTangentAt(SPAWN_T).normalize();
        const startForwardOffset =
            this.currentTuning.startForwardOffsetMeters || 0;

        this.forward.set(tangent.x, 0, tangent.z).normalize();
        // in a lobby each player gets a grid slot: two abreast, 9 m rows
        const left = new THREE.Vector3(this.forward.z, 0, -this.forward.x);
        const lateral = this.spawnSlot % 2 === 0 ? 2.4 : -2.4;
        const row = Math.floor(this.spawnSlot / 2);
        this.position
            .copy(point)
            .add(new THREE.Vector3(0, 180, 0))
            .addScaledVector(this.forward, startForwardOffset - row * 9)
            .addScaledVector(left, this.spawnSlot > 0 ? lateral : 0);
        this.yaw = Math.atan2(this.forward.x, this.forward.z);

        this.surfaceNormal.set(0, 1, 0);
        this.surfaceForward.copy(this.forward);
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
        this.wheelContactCount = 0;
        this.suspensionCompression = [0, 0, 0, 0];
        this.clearSafeStateHistory();
        this.steerAngle = 0;
        this.steerVisualAngle = 0;
        this.wheelSpinAngle = 0;
        this.frontSpinAngle = 0;
        this.rearSpinAngle = 0;
        this.gear = 1;
        this.rpm = this.currentTuning.idleRpm;
        this.barrierContact = 0;
        this.impact = 0;
        this.physics.reset(this.yaw, 0);
        this.track.frameHint = -1;
        this.smokeSpawnCooldown = 0;
        this.smoke.clear();
        this.carPivot.quaternion.identity();
        this.orientationTarget.identity();
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
        this.syncSurfaceForwardToHeading();
        this.yaw = snapshot.yaw;
        this.speedMps = THREE.MathUtils.clamp(
            snapshot.speedMps * speedScale,
            -MAX_REVERSE_SPEED_MPS,
            MAX_SPEED_MPS
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
        const hit = this.raycaster.intersectObject(this.colliderMesh, true)[0];
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
        this.syncSurfaceForwardToHeading();
        this.yaw = this.fallAnchorYaw;
        this.speedMps = THREE.MathUtils.clamp(
            this.fallAnchorSpeedMps,
            -MAX_REVERSE_SPEED_MPS,
            MAX_SPEED_MPS
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
            this.syncSurfaceForwardToHeading();
            this.yaw = this.lastSafeYaw;
            this.speedMps = THREE.MathUtils.clamp(
                this.lastSafeSpeedMps * 0.94,
                -MAX_REVERSE_SPEED_MPS,
                MAX_SPEED_MPS
            );
        }

        this.lateralSpeed = 0;
        this.verticalVelocity = 0;
        this.driftAmount = 0;
        this.slipRatio = 0;
        this.steerAngle = 0;
        this.steerVisualAngle = 0;
        this.physics.reset(this.yaw, this.speedMps);
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
        this.carPivot.quaternion.identity();
        this.orientationTarget.identity();
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
            !Number.isFinite(this.lateralSpeed) ||
            !Number.isFinite(this.verticalVelocity) ||
            !Number.isFinite(this.yaw) ||
            !Number.isFinite(this.surfaceNormal.x) ||
            !Number.isFinite(this.surfaceNormal.y) ||
            !Number.isFinite(this.surfaceNormal.z) ||
            !Number.isFinite(this.surfaceForward.x) ||
            !Number.isFinite(this.surfaceForward.y) ||
            !Number.isFinite(this.surfaceForward.z) ||
            !Number.isFinite(this.forward.x) ||
            !Number.isFinite(this.forward.y) ||
            !Number.isFinite(this.forward.z) ||
            !Number.isFinite(this.carPivot.quaternion.x) ||
            !Number.isFinite(this.carPivot.quaternion.y) ||
            !Number.isFinite(this.carPivot.quaternion.z) ||
            !Number.isFinite(this.carPivot.quaternion.w)
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
        // the physics moves the car along the ground, but height comes from
        // grounding (or the ballistic path), which works from here
        this.stepStartY = this.position.y;

        this.input.update(dt);
        const controls = this.input.getState();
        const shift = this.input.consumeShift();
        if (shift !== 0) {
            // shifting by hand switches the gearbox to manual
            if (this.physics.assists.autoGears) {
                UIEventBus.dispatch('race:assists', { autoGears: false });
            }
            this.physics.requestShift(shift);
        }

        this.stepPhysics(dt, controls);
        this.groundToCollider(dt);
        this.applyBarriers();

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
        this.syncDrivetrain();
        this.updateWheelVisuals(dt, controls.throttle);
        this.updateDriftSmoke(dt);
        this.input.rumble(this.getDriftIntensity(), this.impact);
    }

    // gravity along the road and grip under each wheel, for the tire model
    buildPhysicsSurface(): PhysicsSurface {
        const surface = this.physicsSurface;
        const normal = this.surfaceNormal;
        const sin = Math.sin(this.yaw);
        const cos = Math.cos(this.yaw);
        const alongSlope = 9.81 * normal.y;
        surface.grounded = this.grounded;
        surface.slopeForward = alongSlope * (normal.x * sin + normal.z * cos);
        surface.slopeLeft = alongSlope * (normal.x * cos - normal.z * sin);
        surface.normalScale = Math.max(0.3, normal.y);
        if (!this.trackBound) {
            for (let i = 0; i < 4; i++) {
                this.wheelSurfaces[i] = 'asphalt';
                surface.grip[i] = 1;
                surface.drag[i] = 0;
            }
            return surface;
        }

        const frame = this.track.queryFrame(
            this.position.x,
            this.position.z,
            this.trackFrame
        );
        const forwardAcross = sin * frame.leftX + cos * frame.leftZ;
        const leftAcross = cos * frame.leftX - sin * frame.leftZ;
        const spec = this.physics.spec;
        const a = spec.wheelbase * (1 - spec.weightFront);
        const b = spec.wheelbase * spec.weightFront;
        for (let i = 0; i < 4; i++) {
            const x = i < 2 ? a : -b;
            const track = i < 2 ? spec.trackFront : spec.trackRear;
            const y = (i % 2 === 0 ? 0.5 : -0.5) * track;
            const lateral = frame.lateral + x * forwardAcross + y * leftAcross;
            const kind = this.track.getSurface(frame, lateral);
            this.wheelSurfaces[i] = kind;
            surface.grip[i] = SURFACE_GRIP[kind];
            surface.drag[i] = SURFACE_DRAG[kind];
        }
        return surface;
    }

    stepPhysics(dt: number, controls: PhysicsControls) {
        const surface = this.buildPhysicsSurface();
        this.physics.step(dt, controls, surface, controls.steer);
        this.yaw = this.physics.yaw;
        this.position.x += this.physics.displacementX;
        this.position.z += this.physics.displacementZ;
        this.syncFromPhysics();
    }

    syncFromPhysics() {
        const physics = this.physics;
        this.speedMps = physics.vx;
        this.lateralSpeed = physics.vy;
        this.steerAngle = physics.steerAngle;
        const sin = Math.sin(this.yaw);
        const cos = Math.cos(this.yaw);
        this.forward.set(sin, 0, cos);
        this.tmpVectorA.copy(this.forward).projectOnPlane(this.surfaceNormal);
        if (this.tmpVectorA.lengthSq() > 0.0001) {
            this.forward.copy(this.tmpVectorA.normalize());
        }
        this.velocity.set(
            physics.vx * sin + physics.vy * cos,
            0,
            physics.vx * cos - physics.vy * sin
        );
        const rear = physics.getRearSlideIntensity();
        const front = physics.getFrontSlideIntensity();
        this.driftAmount = rear;
        this.slipRatio = Math.max(rear, front * 0.8);
    }

    // the barriers stand at the outer edge of the verges. corners of the body
    // that cross one get pushed back, with an impulse at the contact point so
    // glancing hits turn the car along the wall instead of stopping it dead
    applyBarriers() {
        if (!this.trackBound) {
            this.barrierContact = 0;
            return;
        }
        const frame = this.track.queryFrame(
            this.position.x,
            this.position.z,
            this.trackFrame
        );
        const sin = Math.sin(this.yaw);
        const cos = Math.cos(this.yaw);
        const forwardAcross = sin * frame.leftX + cos * frame.leftZ;
        const leftAcross = cos * frame.leftX - sin * frame.leftZ;
        const halfLength = this.bodySize.z * 0.48;
        const halfWidth = this.bodySize.x * 0.47;
        let contact = 0;
        let impact = 0;
        for (const side of [1, -1]) {
            let deepest = 0;
            let pointX = 0;
            let pointY = 0;
            for (const x of [halfLength, -halfLength]) {
                for (const y of [halfWidth, -halfWidth]) {
                    const lateral =
                        frame.lateral + x * forwardAcross + y * leftAcross;
                    const depth =
                        side > 0
                            ? lateral - frame.barrierOffset
                            : -frame.barrierOffset - lateral;
                    if (depth > deepest) {
                        deepest = depth;
                        pointX = x;
                        pointY = y;
                    }
                }
            }
            if (deepest <= 0) continue;
            contact = side;
            this.position.x -= side * frame.leftX * deepest;
            this.position.z -= side * frame.leftZ * deepest;
            // wall normal pointing back onto the road, in the body frame
            const normalX = -side * frame.leftX;
            const normalZ = -side * frame.leftZ;
            const nx = normalX * sin + normalZ * cos;
            const ny = normalX * cos - normalZ * sin;
            const velocity = this.physics.pointVelocity(pointX, pointY);
            const into = velocity.x * nx + velocity.y * ny;
            if (into < 0) {
                const mass = this.physics.effectiveMass(pointX, pointY, nx, ny);
                const normalImpulse = -(1 + BARRIER_RESTITUTION) * into * mass;
                const tx = -ny;
                const ty = nx;
                const along = velocity.x * tx + velocity.y * ty;
                const tangentMass = this.physics.effectiveMass(
                    pointX,
                    pointY,
                    tx,
                    ty
                );
                const frictionImpulse = THREE.MathUtils.clamp(
                    -along * tangentMass,
                    -BARRIER_FRICTION * normalImpulse,
                    BARRIER_FRICTION * normalImpulse
                );
                this.physics.applyImpulse(
                    pointX,
                    pointY,
                    nx * normalImpulse + tx * frictionImpulse,
                    ny * normalImpulse + ty * frictionImpulse
                );
                impact = Math.max(
                    impact,
                    normalImpulse / this.physics.spec.massKg
                );
            }
            this.barrierPoint
                .copy(this.position)
                .addScaledVector(this.tmpVectorB.set(sin, 0, cos), pointX)
                .addScaledVector(this.tmpVectorC.set(cos, 0, -sin), pointY);
        }
        this.barrierContact = contact;
        this.impact = Math.max(this.impact * 0.5, impact);
        if (contact !== 0) this.syncFromPhysics();
    }

    syncDrivetrain() {
        const physics = this.physics;
        this.gear = physics.gear < 0 ? -1 : physics.pendingGear;
        this.rpm = physics.engineRpm;
    }

    // drops the car on the road here, facing along the track, stopped
    resetToTrack() {
        const frame = this.track.queryFrame(
            this.position.x,
            this.position.z,
            this.trackFrame,
            -1
        );
        const margin = Math.max(0, frame.roadHalfWidth - 2.5);
        const lateral = THREE.MathUtils.clamp(frame.lateral, -margin, margin);
        const position = frame.point.clone();
        position.x += frame.leftX * lateral;
        position.z += frame.leftZ * lateral;
        this.teleport(position, Math.atan2(frame.tangentX, frame.tangentZ), 0);
    }

    // for tests and resets: put the car at a point on the ground, with a
    // heading and a forward speed
    teleport(position: THREE.Vector3, yaw: number, speed = 0) {
        this.position.copy(position);
        this.position.y += this.rideHeight + 0.6;
        this.yaw = yaw;
        this.forward.set(Math.sin(yaw), 0, Math.cos(yaw));
        this.surfaceNormal.set(0, 1, 0);
        this.surfaceForward.copy(this.forward);
        this.speedMps = speed;
        this.lateralSpeed = 0;
        this.verticalVelocity = 0;
        this.driftAmount = 0;
        this.slipRatio = 0;
        this.airborneTime = 0;
        this.upsideDownTime = 0;
        this.recoveryCooldown = 0;
        this.postRecoveryCheckpointLockout = 0;
        this.fallAnchorValid = false;
        this.fallRecoveryFailures = 0;
        this.clearSafeStateHistory();
        this.lastSafePosition.copy(this.position);
        this.fallAnchorPosition.copy(this.position);
        this.barrierContact = 0;
        this.impact = 0;
        this.physics.reset(yaw, speed);
        this.track.frameHint = -1;
        this.carPivot.quaternion.identity();
        this.orientationTarget.identity();
        this.stepStartY = this.position.y;
        this.groundToCollider(0);
        this.syncFromPhysics();
        this.updateTransform(1);
        this.captureSafeCheckpoint(true);
        this.resetWheelVisuals();
    }

    clampNormalMinY(normal: THREE.Vector3, minY: number) {
        if (normal.y >= minY) return;

        const horizontalLength = Math.sqrt(normal.x * normal.x + normal.z * normal.z);
        if (horizontalLength <= 1e-8) {
            normal.set(0, 1, 0);
            return;
        }

        const targetHorizontalLength = Math.sqrt(Math.max(0, 1 - minY * minY));
        const horizontalScale = targetHorizontalLength / horizontalLength;
        normal.set(normal.x * horizontalScale, minY, normal.z * horizontalScale);
        normal.normalize();
    }

    syncSurfaceForwardToHeading() {
        this.tmpVectorG.copy(this.forward).projectOnPlane(this.surfaceNormal);
        if (this.tmpVectorG.lengthSq() <= 1e-8) {
            this.tmpVectorG.copy(this.forward);
        }
        if (this.tmpVectorG.lengthSq() <= 1e-8) {
            this.tmpVectorG.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        }
        this.surfaceForward.copy(this.tmpVectorG.normalize());
    }

    blendSurfaceForward(targetForward: THREE.Vector3, deltaSeconds: number) {
        if (targetForward.lengthSq() <= 1e-8) {
            this.syncSurfaceForwardToHeading();
            return;
        }

        if (this.surfaceForward.lengthSq() <= 1e-8) {
            this.surfaceForward.copy(targetForward).normalize();
            return;
        }

        if (this.surfaceForward.dot(targetForward) < -0.2) {
            this.surfaceForward.copy(targetForward).normalize();
            return;
        }

        const forwardSpeedFactor = THREE.MathUtils.clamp(
            Math.abs(this.speedMps) / SURFACE_FORWARD_BLEND_SPEED_MPS,
            0,
            1
        );
        const forwardLerp =
            deltaSeconds <= 0
                ? 1
                : THREE.MathUtils.clamp(
                      deltaSeconds *
                          THREE.MathUtils.lerp(
                              SURFACE_FORWARD_LERP_MIN,
                              SURFACE_FORWARD_LERP_MAX,
                              forwardSpeedFactor
                          ),
                      0,
                      1
                  );
        this.surfaceForward.lerp(targetForward, forwardLerp).normalize();
    }

    buildGroundOrientationTargets(groundNormal: THREE.Vector3) {
        const heading = this.tmpVectorG.copy(this.forward);
        if (heading.lengthSq() <= 1e-8) {
            heading.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        }
        if (heading.lengthSq() <= 1e-8) {
            return false;
        }
        heading.normalize();

        const horizontalHeading = this.tmpVectorI.copy(heading).setY(0);
        if (horizontalHeading.lengthSq() <= 1e-8) {
            horizontalHeading.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        }
        if (horizontalHeading.lengthSq() <= 1e-8) {
            horizontalHeading.set(0, 0, 1);
        }
        horizontalHeading.normalize();

        const halfWheelBase = THREE.MathUtils.clamp(
            this.bodySize.z * GRADE_PITCH_HALF_WHEELBASE_SCALE,
            GRADE_PITCH_HALF_WHEELBASE_MIN,
            GRADE_PITCH_HALF_WHEELBASE_MAX
        );
        const frontHit = this.raycastGroundAt(
            this.position.x + horizontalHeading.x * halfWheelBase,
            this.position.z + horizontalHeading.z * halfWheelBase
        );
        const rearHit = this.raycastGroundAt(
            this.position.x - horizontalHeading.x * halfWheelBase,
            this.position.z - horizontalHeading.z * halfWheelBase
        );

        const targetForward = this.tmpVectorG;
        if (frontHit && rearHit) {
            targetForward.subVectors(frontHit.point, rearHit.point);
        } else {
            targetForward.copy(heading).projectOnPlane(groundNormal);
        }

        if (targetForward.lengthSq() <= 1e-8) {
            targetForward.copy(heading).projectOnPlane(groundNormal);
        }
        if (targetForward.lengthSq() <= 1e-8) {
            return false;
        }
        if (targetForward.dot(horizontalHeading) < 0) {
            targetForward.multiplyScalar(-1);
        }
        targetForward.normalize();

        const side = this.tmpVectorI.crossVectors(groundNormal, targetForward);
        if (side.lengthSq() <= 1e-8) {
            side.crossVectors(this.tmpVectorH.set(0, 1, 0), targetForward);
        }
        if (side.lengthSq() <= 1e-8) {
            side.set(1, 0, 0).applyQuaternion(this.carPivot.quaternion);
        }
        side.normalize();

        const targetNormal = this.tmpVectorH.crossVectors(targetForward, side);
        if (targetNormal.lengthSq() <= 1e-8) {
            targetNormal.copy(groundNormal);
        } else {
            targetNormal.normalize();
        }
        if (targetNormal.y < 0) {
            targetNormal.multiplyScalar(-1);
        }
        this.clampNormalMinY(targetNormal, MIN_SURFACE_NORMAL_Y);

        return true;
    }

    getGroundProbeOffsets() {
        const halfWheelBase = THREE.MathUtils.clamp(
            this.bodySize.z * 0.34,
            1.0,
            2.3
        );
        const halfTrack = THREE.MathUtils.clamp(this.bodySize.x * 0.36, 0.72, 1.25);
        return [
            { x: -halfTrack, z: halfWheelBase },
            { x: halfTrack, z: halfWheelBase },
            { x: -halfTrack, z: -halfWheelBase },
            { x: halfTrack, z: -halfWheelBase },
        ];
    }

    getHitWorldNormal(hit: any, target: THREE.Vector3) {
        target
            .copy(hit?.face?.normal || this.tmpVectorD.set(0, 1, 0))
            .transformDirection(hit.object.matrixWorld)
            .normalize();
        if (target.y < 0) {
            target.multiplyScalar(-1);
        }
        this.clampNormalMinY(target, MIN_SURFACE_NORMAL_Y);
        return target;
    }

    sampleGroundContacts() {
        const heading = this.tmpVectorG.copy(this.forward);
        if (heading.lengthSq() <= 1e-8) {
            heading.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        }
        heading.setY(0);
        if (heading.lengthSq() <= 1e-8) {
            heading.set(0, 0, 1);
        }
        heading.normalize();

        const side = this.tmpVectorI.crossVectors(this.surfaceNormal, heading);
        if (side.lengthSq() <= 1e-8) {
            side.set(heading.z, 0, -heading.x);
        }
        side.normalize();

        const contacts: GroundContact[] = [];
        const offsets = this.getGroundProbeOffsets();
        this.suspensionCompression = [0, 0, 0, 0];

        offsets.forEach((offset, index) => {
            const x = this.position.x + side.x * offset.x + heading.x * offset.z;
            const z = this.position.z + side.z * offset.x + heading.z * offset.z;
            const hit = this.raycastGroundAt(x, z);
            if (!hit) return;
            const targetY = hit.point.y + this.rideHeight + WHEEL_PROBE_CLEARANCE_BIAS;
            const compression = THREE.MathUtils.clamp(
                (targetY + SUSPENSION_TRAVEL_METERS - this.position.y) /
                    SUSPENSION_TRAVEL_METERS,
                0,
                1
            );
            this.suspensionCompression[index] = compression;
            contacts.push({
                hit,
                offsetX: offset.x,
                offsetZ: offset.z,
                compression,
            });
        });

        const lookahead = THREE.MathUtils.clamp(
            Math.abs(this.speedMps) * 0.045,
            HIGH_SPEED_PREDICTIVE_LOOKAHEAD_MIN,
            HIGH_SPEED_PREDICTIVE_LOOKAHEAD_MAX
        );
        if (Math.abs(this.speedMps) > 18) {
            const predictedHit = this.raycastGroundAt(
                this.position.x + heading.x * lookahead,
                this.position.z + heading.z * lookahead
            );
            if (predictedHit) {
                contacts.push({
                    hit: predictedHit,
                    offsetX: 0,
                    offsetZ: lookahead,
                    compression: 0,
                    predictive: true,
                });
            }
        }

        return contacts;
    }

    // stays on the road while it can. when the road drops away faster than
    // gravity can pull the car down (a crest at speed) it goes ballistic, and
    // lands where the road catches up
    followGround(targetY: number, deltaSeconds: number, wasGrounded: boolean) {
        if (deltaSeconds <= 0) {
            this.position.y = targetY;
            this.verticalVelocity = 0;
            this.grounded = true;
            this.airborneTime = 0;
            return true;
        }

        const startY = this.stepStartY;
        const fallVelocity = this.verticalVelocity - GRAVITY * deltaSeconds;
        const fallY = startY + fallVelocity * deltaSeconds;
        const leavesRoad =
            wasGrounded && targetY < fallY - CREST_LAUNCH_TOLERANCE;
        // a crest throws the car when the speed needs more pull than gravity
        // gives to follow it (v^2 * curvature > g), from the track's smooth
        // profile rather than the raycast, which is too noisy for this
        const crest = this.trackBound
            ? this.track.frameCrest[this.trackFrame.index] || 0
            : 0;
        // only real crests (tighter than ~330 m), and downforce holds the car
        // down too, so fast cars stay planted over the dem's small ripples
        const speed2 = this.speedMps * this.speedMps;
        const spec = this.physics.spec;
        const downforce = (0.5 * AIR_DENSITY * spec.clA * speed2) / spec.massKg;
        const crestLaunch =
            wasGrounded &&
            crest < -CREST_MIN_CURVATURE &&
            speed2 * -crest > CREST_LAUNCH_MARGIN * (GRAVITY + downforce);
        const stillFlying =
            !wasGrounded && fallY > targetY && !this.wheelTouchesDown(fallY);
        if (leavesRoad || stillFlying || crestLaunch) {
            this.grounded = false;
            this.verticalVelocity = fallVelocity;
            this.position.y = fallY;
            this.airborneTime += deltaSeconds;
            return false;
        }

        // a sudden jump in the target is a bad hit, not a slope
        const maxRise =
            Math.abs(this.speedMps) * deltaSeconds * MAX_GROUND_FOLLOW_GRADE +
            GROUND_FOLLOW_STEP_ALLOWANCE;
        const nextY = Math.min(targetY, startY + maxRise);
        // the road can't throw the car faster than this, whatever the step
        this.verticalVelocity = wasGrounded
            ? THREE.MathUtils.clamp(
                  (nextY - startY) / deltaSeconds,
                  -MAX_GROUND_VERTICAL_SPEED,
                  MAX_GROUND_VERTICAL_SPEED
              )
            : 0;
        this.position.y = nextY;
        this.grounded = true;
        this.airborneTime = 0;
        return true;
    }

    // in the air: does a wheel corner reach the road at this height? lands
    // the car on its first corner instead of letting a pitched nose dig in
    wheelTouchesDown(centerY: number) {
        const lift = centerY - this.position.y;
        const points = this.getWheelContactPoints();
        for (const point of points) {
            const hit = this.raycastGroundAt(point.x, point.z);
            if (hit && point.y + lift <= hit.point.y + 0.01) return true;
        }
        return false;
    }

    groundToCollider(deltaSeconds: number) {
        this.tmpVectorA.copy(this.position).add(new THREE.Vector3(0, RAYCAST_HEIGHT, 0));
        this.tmpVectorB.set(0, -1, 0);

        this.raycaster.layers.set(this.track.getColliderLayer());
        this.raycaster.set(this.tmpVectorA, this.tmpVectorB);
        this.raycaster.far = RAYCAST_DISTANCE;

        const hits = this.raycaster.intersectObject(this.colliderMesh, true);
        const hit = hits[0];
        const wasGrounded = this.grounded;

        if (hit) {
            const contacts = this.sampleGroundContacts();
            contacts.push({
                hit,
                offsetX: 0,
                offsetZ: 0,
                compression: 1,
            });
            const physicalContacts = contacts.filter((contact) => !contact.predictive);
            const wheelTargets = physicalContacts.map(
                (contact) =>
                    contact.hit.point.y + this.rideHeight + WHEEL_PROBE_CLEARANCE_BIAS
            );
            const centerTargetY = hit.point.y + this.rideHeight + WHEEL_PROBE_CLEARANCE_BIAS;
            const maxWheelTargetY = wheelTargets.length
                ? Math.max(...wheelTargets)
                : centerTargetY;
            const antiSinkLift = THREE.MathUtils.clamp(
                maxWheelTargetY - centerTargetY,
                0,
                MAX_WHEEL_ANTI_SINK_LIFT
            );
            const targetGroundY = centerTargetY + antiSinkLift;
            if (!this.followGround(targetGroundY, deltaSeconds, wasGrounded)) {
                this.wheelContactCount = 0;
                this.suspensionCompression = [0, 0, 0, 0];
                return;
            }
            this.wheelContactCount = physicalContacts.length;

            const frontHits: GroundContact[] = [];
            const rearHits: GroundContact[] = [];
            const leftHits: GroundContact[] = [];
            const rightHits: GroundContact[] = [];
            physicalContacts.forEach((contact) => {
                if (contact.offsetZ > 0.2) frontHits.push(contact);
                if (contact.offsetZ < -0.2) rearHits.push(contact);
                if (contact.offsetX < -0.1) leftHits.push(contact);
                if (contact.offsetX > 0.1) rightHits.push(contact);
            });
            this.getHitWorldNormal(hit, this.tmpVectorC);
            this.clampNormalMinY(this.tmpVectorC, MIN_SURFACE_NORMAL_Y);

            const normalSpeedFactor = THREE.MathUtils.clamp(
                Math.abs(this.speedMps) / SURFACE_NORMAL_BLEND_SPEED_MPS,
                0,
                1
            );
            // touching down after a jump lines the car up with the road at
            // once, or its nose digs in while the pitch catches up
            const normalLerp = wasGrounded
                ? THREE.MathUtils.clamp(
                      deltaSeconds *
                          THREE.MathUtils.lerp(
                              SURFACE_NORMAL_LERP_MIN,
                              SURFACE_NORMAL_LERP_MAX,
                              normalSpeedFactor
                          ),
                      0,
                      1
                  )
                : 1;
            let hasGroundOrientationTarget = false;
            if (frontHits.length && rearHits.length) {
                const frontPoint = new THREE.Vector3();
                const rearPoint = new THREE.Vector3();
                frontHits.forEach((contact) => frontPoint.add(contact.hit.point));
                rearHits.forEach((contact) => rearPoint.add(contact.hit.point));
                frontPoint.multiplyScalar(1 / frontHits.length);
                rearPoint.multiplyScalar(1 / rearHits.length);
                this.tmpVectorG.subVectors(frontPoint, rearPoint);
                if (this.tmpVectorG.lengthSq() > 1e-8) {
                    this.tmpVectorG.normalize();
                    if (this.tmpVectorG.dot(this.forward) < 0) {
                        this.tmpVectorG.multiplyScalar(-1);
                    }
                    const leftPoint = new THREE.Vector3();
                    const rightPoint = new THREE.Vector3();
                    leftHits.forEach((contact) => leftPoint.add(contact.hit.point));
                    rightHits.forEach((contact) => rightPoint.add(contact.hit.point));
                    if (leftHits.length && rightHits.length) {
                        leftPoint.multiplyScalar(1 / leftHits.length);
                        rightPoint.multiplyScalar(1 / rightHits.length);
                        this.tmpVectorI.subVectors(rightPoint, leftPoint);
                    } else {
                        this.tmpVectorI.crossVectors(this.tmpVectorC, this.tmpVectorG);
                    }
                    if (this.tmpVectorI.lengthSq() > 1e-8) {
                        this.tmpVectorI.normalize();
                        this.tmpVectorH.crossVectors(this.tmpVectorG, this.tmpVectorI);
                        if (this.tmpVectorH.y < 0) {
                            this.tmpVectorH.multiplyScalar(-1);
                        }
                        if (this.tmpVectorH.lengthSq() > 1e-8) {
                            this.tmpVectorH.normalize();
                            this.clampNormalMinY(this.tmpVectorH, MIN_SURFACE_NORMAL_Y);
                            hasGroundOrientationTarget = true;
                        }
                    }
                }
            }
            if (!hasGroundOrientationTarget) {
                hasGroundOrientationTarget =
                    this.buildGroundOrientationTargets(this.tmpVectorC);
            }
            const targetNormal = hasGroundOrientationTarget
                ? this.tmpVectorH
                : this.tmpVectorC;

            this.surfaceNormal.lerp(targetNormal, normalLerp).normalize();
            const targetForward = hasGroundOrientationTarget
                ? this.tmpVectorG
                : this.tmpVectorD.copy(this.forward).projectOnPlane(this.surfaceNormal);
            this.blendSurfaceForward(targetForward, deltaSeconds);
            return;
        }

        if (wasGrounded) {
            this.captureFallAnchor();
        }

        this.grounded = false;
        this.wheelContactCount = 0;
        this.suspensionCompression = [0, 0, 0, 0];
        this.airborneTime += deltaSeconds;
        this.verticalVelocity -= GRAVITY * deltaSeconds;
        if (deltaSeconds > 0) {
            this.position.y =
                this.stepStartY + this.verticalVelocity * deltaSeconds;
        }
        this.tmpVectorC.copy(this.forward).setY(0);
        if (this.tmpVectorC.lengthSq() > 1e-8) {
            this.tmpVectorC
                .normalize()
                .multiplyScalar(Math.max(1, Math.abs(this.speedMps)));
            // in the air a car mostly keeps its attitude, nosing all the way
            // down with the fall would dig the front in on landing
            this.tmpVectorC.y = this.verticalVelocity * AIRBORNE_PITCH_FOLLOW;
            this.blendSurfaceForward(this.tmpVectorC.normalize(), deltaSeconds);
        }
        this.tmpVectorD.set(1, 0, 0).applyQuaternion(this.carPivot.quaternion);
        if (this.tmpVectorD.lengthSq() > 1e-8 && this.surfaceForward.lengthSq() > 1e-8) {
            this.tmpVectorD.normalize();
            this.tmpVectorE.crossVectors(this.surfaceForward, this.tmpVectorD);
            if (this.tmpVectorE.lengthSq() > 1e-8) {
                this.tmpVectorE.normalize();
                if (this.tmpVectorE.y < 0) {
                    this.tmpVectorE.multiplyScalar(-1);
                }
                this.surfaceNormal
                    .lerp(this.tmpVectorE, THREE.MathUtils.clamp(deltaSeconds * 3, 0, 1))
                    .normalize();
                return;
            }
        }
        this.surfaceNormal
            .lerp(this.tmpVectorD.set(0, 1, 0), THREE.MathUtils.clamp(deltaSeconds * 2, 0, 1))
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
        this.clampNormalMinY(orientationNormal, MIN_ORIENTATION_NORMAL_Y);

        const visualForwardSource = this.tmpVectorG.copy(this.surfaceForward);
        if (visualForwardSource.lengthSq() <= 1e-8) {
            visualForwardSource.copy(this.forward);
        }

        const planarForward = this.tmpVectorA
            .copy(visualForwardSource)
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
            deltaSeconds * THREE.MathUtils.lerp(5, 16, rotationSpeedFactor),
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

    updateWheelVisuals(deltaSeconds: number, throttle = 0) {
        if (!this.wheelRig.length) return;

        if (this.currentCarId === BMW_F90_M5_COMPETITION_ID) {
            this.updateLegacyWheelVisuals(deltaSeconds);
            return;
        }

        this.advanceWheelSpin(deltaSeconds);
        const visualSteerAngle =
            this.getWheelVisualSteerDirectionMultiplier() * this.steerVisualAngle;

        this.wheelRig.forEach((wheel) => {
            const spinAngle =
                (wheel.front ? this.frontSpinAngle : this.rearSpinAngle) *
                wheel.spinSign;
            const spinQuaternion = this.tmpQuatB.setFromAxisAngle(
                wheel.spinAxis,
                spinAngle
            );
            const steerQuaternion = this.tmpQuatA.setFromAxisAngle(
                wheel.steerAxis || this.tmpVectorD.set(0, 1, 0),
                visualSteerAngle
            );

            wheel.object.position.copy(wheel.basePosition);
            wheel.object.quaternion.copy(wheel.baseQuaternion);
            if (wheel.front) {
                this.rotateObjectParentAroundCenter(
                    wheel.object,
                    wheel.spinCenter,
                    steerQuaternion
                );
            }
            const wheelWorldQuaternionBeforeSpin = wheel.object.getWorldQuaternion(
                this.tmpQuatE
            );
            const wheelSpinAxisWorld = this.tmpVectorE
                .copy(wheel.spinAxis)
                .applyQuaternion(wheelWorldQuaternionBeforeSpin)
                .normalize();
            const wheelSteerAxisWorld = this.tmpVectorH
                .copy(wheel.steerAxis || this.tmpVectorD.set(0, 1, 0))
                .applyQuaternion(wheelWorldQuaternionBeforeSpin)
                .normalize();
            this.rotateWheelLocalAroundCenter(wheel, spinQuaternion);

            wheel.linkedVisuals.forEach((linked) => {
                linked.object.position.copy(linked.basePosition);
                linked.object.quaternion.copy(linked.baseQuaternion);
                if (wheel.front) {
                    this.setObjectParentLocalDirection(
                        linked.object,
                        wheelSteerAxisWorld,
                        this.tmpVectorI
                    );
                    const linkedSteerQuaternion = this.tmpQuatG.setFromAxisAngle(
                        this.tmpVectorI,
                        visualSteerAngle
                    );
                    this.rotateObjectParentAroundCenter(
                        linked.object,
                        linked.spinCenter,
                        linkedSteerQuaternion
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

    updateLegacyWheelVisuals(deltaSeconds: number) {
        this.advanceWheelSpin(deltaSeconds);

        const steerQuaternion = this.tmpQuatA.setFromAxisAngle(
            new THREE.Vector3(0, 1, 0),
            this.steerVisualAngle
        );

        this.wheelRig.forEach((wheel) => {
            const spinAngle =
                (wheel.front ? this.frontSpinAngle : this.rearSpinAngle) *
                wheel.spinSign;
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

    // wheels turn at the tire model's own speeds, so wheelspin and lockups
    // show. steer follows the road wheel angle
    advanceWheelSpin(deltaSeconds: number) {
        const omega = this.physics.wheelOmega;
        const front = (omega[0] + omega[1]) * 0.5;
        const rear = (omega[2] + omega[3]) * 0.5;
        this.frontSpinAngle += front * deltaSeconds;
        this.rearSpinAngle += rear * deltaSeconds;
        this.wheelSpinAngle = (this.frontSpinAngle + this.rearSpinAngle) * 0.5;
        const target = THREE.MathUtils.clamp(
            this.steerAngle,
            -WHEEL_VISUAL_STEER_LIMIT,
            WHEEL_VISUAL_STEER_LIMIT
        );
        this.steerVisualAngle = THREE.MathUtils.lerp(
            this.steerVisualAngle,
            target,
            THREE.MathUtils.clamp(deltaSeconds * 20, 0, 1)
        );
    }

    getWheelVisualSteerDirectionMultiplier() {
        if (
            this.currentCarId === AMG_C63S_COUPE_ID ||
            this.currentCarId === BMW_F90_M5_COMPETITION_ID ||
            this.currentCarId === BMW_M8_COMPETITION_COUPE_ID ||
            this.currentCarId === MERCEDES_GT63S_EDITION_ONE_ID
        ) {
            return -1;
        }
        return 1;
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

    rotateObjectParentAroundCenter(
        object: THREE.Object3D,
        spinCenter: THREE.Vector3,
        parentRotation: THREE.Quaternion
    ) {
        object.position
            .sub(spinCenter)
            .applyQuaternion(parentRotation)
            .add(spinCenter);
        object.quaternion.premultiply(parentRotation);
    }

    updateDriftSmoke(deltaSeconds: number) {
        this.smokeSpawnCooldown -= deltaSeconds;
        const rear = this.physics.getRearSlideIntensity();
        const front = this.physics.getFrontSlideIntensity();
        const onAsphalt = (index: number) =>
            this.wheelSurfaces[index] === 'asphalt' ||
            this.wheelSurfaces[index] === 'kerb';

        if (this.grounded && this.smokeSpawnCooldown <= 0) {
            const speed = Math.hypot(this.speedMps, this.lateralSpeed);
            if (rear > 0.18 && (onAsphalt(2) || onAsphalt(3))) {
                this.getRearWheelWorldPositions().forEach((position) => {
                    this.smoke.emit(position, rear, speed);
                });
            }
            // lockups smoke the fronts
            if (front > 0.4 && (onAsphalt(0) || onAsphalt(1))) {
                this.getFrontWheelWorldPositions().forEach((position) => {
                    this.smoke.emit(position, front * 0.7, speed);
                });
            }
            // dust off the grass
            if (speed > 6 && this.wheelSurfaces.some((kind) => kind === 'grass')) {
                const points = this.getWheelContactPoints();
                this.wheelSurfaces.forEach((kind, index) => {
                    if (kind !== 'grass') return;
                    this.smoke.emit(
                        points[index],
                        Math.min(1, 0.3 + speed / 40),
                        speed,
                        'dust'
                    );
                });
            }
            this.smokeSpawnCooldown = SMOKE_SPAWN_INTERVAL;
        }

        this.smoke.update(deltaSeconds);
    }

    getFrontWheelWorldPositions() {
        if (this.frontWheelRig.length > 0) {
            return this.frontWheelRig.map((wheel) =>
                wheel.object.getWorldPosition(new THREE.Vector3())
            );
        }
        const frontOffset = Math.max(1.1, this.bodySize.z * 0.3);
        const sideOffset = Math.max(0.5, this.bodySize.x * 0.22);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(
            this.carPivot.quaternion
        );
        const side = new THREE.Vector3()
            .crossVectors(up, this.forward)
            .normalize()
            .multiplyScalar(sideOffset);
        const base = this.position
            .clone()
            .addScaledVector(this.forward, frontOffset)
            .addScaledVector(up, 0.08);
        return [base.clone().add(side), base.clone().sub(side)];
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

    // tire contact points on the road, fl fr rl rr, from the physics geometry
    getWheelContactPoints() {
        const spec = this.physics.spec;
        const a = spec.wheelbase * (1 - spec.weightFront);
        const b = spec.wheelbase * spec.weightFront;
        const q = this.carPivot.quaternion;
        const forward = this.tmpVectorE.set(0, 0, 1).applyQuaternion(q);
        const left = this.tmpVectorF.set(1, 0, 0).applyQuaternion(q);
        const up = this.tmpVectorG.set(0, 1, 0).applyQuaternion(q);
        const points = this.wheelContactPoints;
        for (let i = 0; i < 4; i++) {
            const x = i < 2 ? a : -b;
            const track = i < 2 ? spec.trackFront : spec.trackRear;
            const y = (i % 2 === 0 ? 0.5 : -0.5) * track;
            points[i]
                .copy(this.position)
                .addScaledVector(forward, x)
                .addScaledVector(left, y)
                .addScaledVector(up, -this.rideHeight);
        }
        return points;
    }

    getDriftIntensity() {
        return THREE.MathUtils.clamp(
            Math.max(
                this.physics.getRearSlideIntensity(),
                this.physics.getFrontSlideIntensity() * 0.6
            ),
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
        const physics = this.physics;
        const speedMagnitude = Math.hypot(physics.vx, physics.vy);
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
            wheelContactCount: this.wheelContactCount,
            suspensionCompression: [...this.suspensionCompression],
            surfaceNormal: [
                this.surfaceNormal.x,
                this.surfaceNormal.y,
                this.surfaceNormal.z,
            ],
            lateralG: physics.accelLat / 9.81,
            longitudinalG: physics.accelLong / 9.81,
            bodySlipDeg: THREE.MathUtils.radToDeg(physics.getBodySlip()),
            steerAngle: physics.steerAngle,
            frontSlide: physics.getFrontSlideIntensity(),
            rearSlide: physics.getRearSlideIntensity(),
            wheelSurfaces: this.wheelSurfaces.slice(),
            onKerb: this.wheelSurfaces.includes('kerb'),
            onGrass: this.wheelSurfaces.includes('grass'),
            barrierContact: this.barrierContact,
            impact: this.impact,
            shifting: physics.shiftTimer > 0,
            limiter: physics.limiterActive,
            abs: physics.absActive,
            tractionControl: physics.tcsActive,
            stability: physics.stabilityActive,
            // the sport drift assist is holding a slide, and its target body
            // slip in degrees (negative is a left hand drift)
            driftAssist: physics.driftActive,
            driftTargetDeg: (physics.driftTarget * 180) / Math.PI,
            trackDistance: this.trackFrame.distance,
            trackLateral: this.trackFrame.lateral,
        };
    }
}
