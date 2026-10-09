// planar vehicle dynamics for race mode: four tires with combined slip and
// load sensitivity, weight transfer, an engine with a torque curve and a
// gearbox, differentials, brakes, aero, and optional driver assists.
//
// body frame: x forward, y to the left, yaw positive turns left. RaceVehicle
// owns height and surface orientation (grounding), this owns motion along
// the ground. no three.js here, it's plain numbers so it can be tested and
// stepped at a high rate cheaply.

export type DriveLayout = 'RWD' | 'AWD' | 'FWD';
export type GearboxKind = 'manual' | 'dct' | 'mct' | 'amt' | 'automatic';

export type PhysicsSpec = {
    massKg: number;
    wheelbase: number;
    trackFront: number;
    trackRear: number;
    // static share of the weight on the front axle
    weightFront: number;
    cgHeight: number;
    yawInertia: number;
    wheelRadius: number;
    wheelInertia: number;
    engineInertia: number;
    // peak friction coefficient, and how much the rear tires add on top
    tireGrip: number;
    tireGripRear: number;
    slipAnglePeak: number;
    slipRatioPeak: number;
    // magic formula shape: higher falls off harder past the peak
    tireShape: number;
    loadSensitivity: number;
    rollShareFront: number;
    // how fast weight moves across the car, seconds (springs and dampers)
    loadFilterTime: number;
    cdA: number;
    clA: number;
    aeroFront: number;
    rollingResistance: number;
    drive: DriveLayout;
    frontTorqueShare: number;
    lsdLock: number;
    // published peaks, for show and for the engine braking scale
    powerW: number;
    powerRpm: number;
    torqueNm: number;
    torqueRpm: number;
    // full load torque every torqueStep rpm from 0, Nm
    torqueTable: number[];
    torqueStep: number;
    idleRpm: number;
    // where the rev limiter cuts
    redlineRpm: number;
    shiftUpRpm: number;
    shiftDownRpm: number;
    gearRatios: number[];
    finalDrive: number;
    reverseRatio: number;
    transmission: GearboxKind;
    shiftTime: number;
    // share of drive torque that gets through while a gear changes
    shiftTorque: number;
    launchRpm: number;
    // torque converter multiplication at stall, 1 for clutches
    converterRatio: number;
    drivelineEfficiency: number;
    brakeTorque: number;
    // the garage brake kit and pressure over the stock torque (already in
    // brakeTorque), unset when stock
    brakeKit?: number;
    brakeBias: number;
    handbrakeTorque: number;
    maxSteer: number;
    // electronic top speed limiter, m/s, Infinity when there's none
    speedLimit: number;
    // turbos or a supercharger from the garage: share of extra torque at full
    // boost, the rpm where it starts and is all there, and the spool time (s)
    boost?: { gain: number; spoolStart: number; spoolFull: number; time: number };
};

export type PhysicsControls = {
    throttle: number;
    brake: number;
    handbrake: number;
    // -1..1, positive turns left
    steer: number;
};

export type PhysicsSurface = {
    grounded: boolean;
    // gravity along the heading and to the left from the road's slope, m/s^2
    slopeForward: number;
    slopeLeft: number;
    // share of the weight pressing into the road
    normalScale: number;
    // per wheel, fl fr rl rr: 1 is asphalt
    grip: number[];
    // per wheel extra rolling drag (grass)
    drag: number[];
};

export type AssistSettings = {
    abs: boolean;
    tractionControl: boolean;
    stability: boolean;
    countersteer: boolean;
    // holds a slide at the angle the steering asks for (sport)
    drift: boolean;
    autoGears: boolean;
};

export const DEFAULT_ASSISTS: AssistSettings = {
    abs: true,
    tractionControl: true,
    stability: true,
    countersteer: true,
    drift: false,
    autoGears: true,
};

const GRAVITY = 9.81;
const AIR_DENSITY = 1.225;
// drift assist, angles in radians. per instance so the harness can tune it
const DRIFT_GEAR_RPM = 0.64;
// mid slide it only shifts back down once the lower gear is well inside its
// range, or a slide at a gear's edge hunts between the two
const DRIFT_DOWNSHIFT_RPM = 0.54;
const DRIFT_FRONT_SHARE = 0.1;
// share of the asked for yaw rate the stability control lets a car fall short
// of on the power before it eases the throttle
const UNDERSTEER_SLACK = 0.3;
// body slip (rad) past which it starts taking the power off a slide
const POWER_SLIDE_SLIP = 0.08;
export const DRIFT_TUNING = {
    startSlip: 0.12,
    endSlip: 0.05,
    // seconds a drift on the power may sit under it before it ends
    lowGrace: 0.35,
    baseAngle: 0.45,
    extraAngle: 0.17,
    // rad/s the held angle moves: steering into the corner, the other way
    // (at full lock), and settling back to the base hands off
    aimUp: 1,
    aimDown: 1,
    aimSettle: 0.45,
    // the other way trims it down to this. held this long on the power it
    // carries on across, and past this on the far side it swings over
    trimAngle: 0.18,
    crossDelay: 0.5,
    aimCross: 2.4,
    flipAngle: 0.1,
    steerGain: 0.8,
    // damping on how fast the slip angle changes, seconds. without it the car
    // snaps back through straight into a slide the other way
    steerDamping: 0.25,
    // throttle eases by this per radian over the target, down to the floor
    throttleGain: 2.5,
    throttleFloor: 0.55,
    rearGripDrop: 0.16,
    // rear grip given back as the throttle comes off, so lifting straightens
    // even a loose drift build
    liftGrip: 0.25,
    // extra rear grip given up while the angle is under target, so a small
    // flick can still grow into the drift
    buildGripDrop: 0.3,
    // share of the target angle held with the throttle off: lifting winds
    // the slide down, feathering holds it in between
    liftTarget: 0.6,
    // seconds the drift throttle takes to follow the pedal
    driveTime: 0.4,
    // share of the build-up grip drop that stays with the throttle off
    buildFloor: 0.6,
    // and per rad/s the angle is falling away under the target, which
    // catches a slide that's snapping back while the throttle is feathered
    catchGripDrop: 0.6,
    // a transition needs this much throttle, and has this long to land
    switchDrive: 0.35,
    switchTime: 1.1,
    // share of the throttle floor given up on a big overshoot
    overLift: 0.7,
    // seconds of slip rate it looks ahead, and the yaw acceleration (rad/s2)
    // it catches a predicted overshoot with
    catchLead: 0.25,
    catchAccel: 3,
    // m/s2 the path bends toward the inside with the steer full into it, and
    // opens up with it the other way
    pathAccel: 3,
    pathOut: 3,
    // m/s over the speed it began at (or slowed to) before the engine eases
    // off, the m/s that takes it down to the floor share. the pedal still
    // holds the angle, the car just doesn't run away wide
    capMargin: 2.5,
    capSpan: 4,
    capFloor: 0.2,
    gearRpm: DRIFT_GEAR_RPM,
    downshiftRpm: DRIFT_DOWNSHIFT_RPM,
};
const INNER_STEP = 1 / 600;
// slip denominators don't go below this, which keeps the tires stable (and
// damped) when the car is nearly stopped
const SLIP_SPEED_FLOOR = 1.5;
const RELAXATION_LENGTH = 0.3;
const SHIFT_COOLDOWN = 0.3;
const REVERSE_ENGAGE_SPEED = 0.8;
const REVERSE_ENGAGE_DELAY = 0.25;
// the brake only backs the car up once it has stopped and stays held a moment,
// braking to a stop through a hairpin used to roll straight into reverse
const REVERSE_STOP_SPEED = 0.3;
const REVERSE_HOLD = 0.5;
// rear brake limit without abs, as a share of what the rear tires hold, at
// the stock bias and forward of it
const REAR_VALVE = 0.9;
const VALVE_BIAS = 0.64;
// abs lets a tire slip as far as what's left of its grip ellipse (in peak
// slips) once it's also cornering, never under ABS_FLOOR of the straight
// line slip, so the fronts keep steering under the brakes
const ABS_ELLIPSE = 1.15;
const ABS_FLOOR = 0.3;
// with abs, braking keeps the front wheels this many peak slip angles either
// side of where the front axle is going: past it they only scrub
const BRAKING_STEER_REACH = 1.15;
// stability control damps yaw past this share of what the tires can carry
// the car round at its speed, at this rate (1/s), at most this hard (rad/s2)
const YAW_MARGIN = 1.1;
const YAW_DAMPING = 8;
const YAW_DAMPING_MAX = 4;
const RAD_PER_S_TO_RPM = 60 / (Math.PI * 2);
// tires grip a bit harder braking and accelerating than cornering
const LONGITUDINAL_GRIP = 1.1;
// wall hits treat the car as harder to spin than it is, which reads better
// than a pinball bounce off a clipped barrier
const IMPACT_INERTIA_SCALE = 3;

// the rev limiter cuts the fuel this long each time the revs reach it
const LIMITER_CUT = 0.06;
// the speed limiter fades the torque out from this far under the limit (m/s)
// to nothing just over it, so the car settles on the limit
const SPEED_LIMIT_BAND = 0.3;

const clamp = (value: number, min: number, max: number) =>
    value < min ? min : value > max ? max : value;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const moveToward = (value: number, target: number, maxDelta: number) =>
    value < target
        ? Math.min(target, value + maxDelta)
        : Math.max(target, value - maxDelta);

// full load torque at an rpm without any garage boost, from the sampled curve
const tableTorqueAt = (spec: PhysicsSpec, rpm: number) => {
    const table = spec.torqueTable;
    const x = clamp(rpm, spec.idleRpm, spec.redlineRpm) / spec.torqueStep;
    const i = Math.min(table.length - 2, Math.floor(x));
    return lerp(table[i], table[i + 1], x - i);
};

const boostShare = (spec: PhysicsSpec, rpm: number) => {
    const b = spec.boost;
    if (!b) return 0;
    const t = clamp((rpm - b.spoolStart) / Math.max(1, b.spoolFull - b.spoolStart), 0, 1);
    return t * t * (3 - 2 * t);
};

// full load torque at an rpm once any boost has built, from the sampled curve
export const torqueAt = (spec: PhysicsSpec, rpm: number) =>
    tableTorqueAt(spec, rpm) * (1 + (spec.boost ? spec.boost.gain * boostShare(spec, rpm) : 0));

// peak torque and power of the curve the car actually drives with
export const peakOutput = (spec: PhysicsSpec) => {
    let torqueNm = 0;
    let powerW = 0;
    spec.torqueTable.forEach((_, i) => {
        const rpm = i * spec.torqueStep;
        if (rpm < spec.idleRpm || rpm > spec.redlineRpm) return;
        const torque = torqueAt(spec, rpm);
        torqueNm = Math.max(torqueNm, torque);
        powerW = Math.max(powerW, (torque * rpm) / RAD_PER_S_TO_RPM);
    });
    return { torqueNm, powerW };
};

// engine rpm with the clutch in at a road speed (m/s) in a gear
export const rpmAtSpeed = (spec: PhysicsSpec, speed: number, gear: number) =>
    (Math.abs(speed) / spec.wheelRadius) *
    spec.gearRatios[clamp(gear, 1, spec.gearRatios.length) - 1] *
    spec.finalDrive *
    RAD_PER_S_TO_RPM;

// where the car tops out on the flat, m/s: the speed limiter, the rev
// limiter in top gear, or where aero drag takes all the drive the best gear
// can give, whichever comes first. the tire model's rolling resistance only
// acts while a wheel's speed is changing, so it isn't counted here either
export const predictTopSpeed = (spec: PhysicsSpec) => {
    const air = 0.5 * AIR_DENSITY;
    let limitedBy: 'limiter' | 'drag' | 'revs' = 'drag';
    let speed = 1;
    for (; speed < 150; speed += 0.02) {
        if (speed >= spec.speedLimit) {
            return { speed: spec.speedLimit, limitedBy: 'limiter' as const };
        }
        const resist = air * spec.cdA * speed * speed;
        let best = 0;
        let anyGear = false;
        for (let gear = 1; gear <= spec.gearRatios.length; gear++) {
            const rpm = rpmAtSpeed(spec, speed, gear);
            if (rpm >= spec.redlineRpm) continue;
            anyGear = true;
            const ratio = spec.gearRatios[gear - 1] * spec.finalDrive;
            best = Math.max(
                best,
                (torqueAt(spec, rpm) * ratio * spec.drivelineEfficiency) /
                    spec.wheelRadius
            );
        }
        if (!anyGear) {
            limitedBy = 'revs';
            break;
        }
        if (best < resist) break;
    }
    return { speed, limitedBy };
};

export default class VehiclePhysics {
    spec: PhysicsSpec;
    assists: AssistSettings;
    yaw: number;
    vx: number;
    vy: number;
    yawRate: number;
    steerAngle: number;
    // the wheel angle the driver asks for, before any assist steers
    steerRequest = 0;
    wheelOmega: number[];
    slipAngle: number[];
    slipRatio: number[];
    load: number[];
    forceLong: number[];
    forceLat: number[];
    engineRpm: number;
    gear: number;
    pendingGear: number;
    shiftTimer: number;
    shiftCooldown: number;
    reverseTimer: number;
    limiterTimer: number;
    accelLong: number;
    accelLat: number;
    displacementX: number;
    displacementZ: number;
    tcsScale: number;
    absScale: number[];
    absActive: boolean;
    tcsActive: boolean;
    stabilityActive: boolean;
    // the drift assist is holding a slide, and at what body slip (rad)
    driftActive: boolean;
    driftTarget: number;
    driftThrottle: number;
    driftSteer: number;
    driftTuning: typeof DRIFT_TUNING;
    private driftShortfall = 0;
    // which way the held drift goes (1 left), the body slip last step, and
    // how long a transition to the other side has left to land
    driftSide = 1;
    private driftBeta = 0;
    driftSwitch = 0;
    // the slip angle the steer asks for on that side, below zero on its way
    // over to the other, and how long the steer has held it at the trim
    driftAim = 0;
    private driftHold = 0;
    // the speed a held drift is kept under, and the engine share that keeps it
    private driftCap = 0;
    private driftGovern = 1;
    // seconds the angle has sat under the end slip
    private driftLow = 0;
    // -1..1 yaw moment the hold catches an overshoot with
    private driftCatch = 0;
    // m/s2 across the velocity, toward the inside of the drift
    private driftPath = 0;
    // rad/s the slip angle is shrinking by under the target
    private driftFalling = 0;
    // the handbrake asks for a slide: standard's stability and traction
    // control step back and the drift hold takes it until the car is straight
    driftWindow = false;
    private straightTime = 0;
    // the throttle smoothed, so taps on a key feather the slide
    driftDrive = 0;
    limiterActive: boolean;
    engineTorqueNow: number;
    // 0 to 1, how much of the garage turbos' boost has built
    boost = 0;
    manualShiftRequest: number;
    handbrakeInput: number;
    // the brake pedal (or the throttle backing up), 0 to 1
    brakeInput = 0;
    onShift: ((gear: number, previous: number) => void) | null;
    private wheelX: number[];
    private wheelY: number[];
    private shapeB: number;

    constructor(spec: PhysicsSpec) {
        this.spec = spec;
        this.assists = { ...DEFAULT_ASSISTS };
        this.yaw = 0;
        this.vx = 0;
        this.vy = 0;
        this.yawRate = 0;
        this.steerAngle = 0;
        this.wheelOmega = [0, 0, 0, 0];
        this.slipAngle = [0, 0, 0, 0];
        this.slipRatio = [0, 0, 0, 0];
        this.load = [0, 0, 0, 0];
        this.forceLong = [0, 0, 0, 0];
        this.forceLat = [0, 0, 0, 0];
        this.engineRpm = spec.idleRpm;
        this.gear = 1;
        this.pendingGear = 1;
        this.shiftTimer = 0;
        this.shiftCooldown = 0;
        this.reverseTimer = 0;
        this.limiterTimer = 0;
        this.accelLong = 0;
        this.accelLat = 0;
        this.displacementX = 0;
        this.displacementZ = 0;
        this.tcsScale = 1;
        this.absScale = [1, 1, 1, 1];
        this.absActive = false;
        this.tcsActive = false;
        this.stabilityActive = false;
        this.limiterActive = false;
        this.driftActive = false;
        this.driftTarget = 0;
        this.driftThrottle = 1;
        this.driftSteer = 0;
        this.driftTuning = { ...DRIFT_TUNING };
        this.engineTorqueNow = 0;
        this.manualShiftRequest = 0;
        this.handbrakeInput = 0;
        this.onShift = null;
        this.wheelX = [0, 0, 0, 0];
        this.wheelY = [0, 0, 0, 0];
        this.shapeB = 1;
        this.setSpec(spec);
    }

    setSpec(spec: PhysicsSpec) {
        this.spec = spec;
        const a = spec.wheelbase * (1 - spec.weightFront);
        const b = spec.wheelbase * spec.weightFront;
        this.wheelX = [a, a, -b, -b];
        this.wheelY = [
            spec.trackFront / 2,
            -spec.trackFront / 2,
            spec.trackRear / 2,
            -spec.trackRear / 2,
        ];
        // puts the peak of sin(C atan(B s)) at s = 1
        this.shapeB = Math.tan(Math.PI / (2 * spec.tireShape));
        this.gear = clamp(this.gear, -1, spec.gearRatios.length);
        if (this.gear === 0) this.gear = 1;
        this.engineRpm = clamp(this.engineRpm, spec.idleRpm, spec.redlineRpm);
    }

    reset(yaw: number, speed = 0) {
        this.yaw = yaw;
        this.vx = speed;
        this.vy = 0;
        this.yawRate = 0;
        this.steerAngle = 0;
        this.steerRequest = 0;
        const omega = speed / this.spec.wheelRadius;
        this.wheelOmega = [omega, omega, omega, omega];
        this.slipAngle = [0, 0, 0, 0];
        this.slipRatio = [0, 0, 0, 0];
        this.forceLong = [0, 0, 0, 0];
        this.forceLat = [0, 0, 0, 0];
        this.accelLong = 0;
        this.accelLat = 0;
        this.shiftTimer = 0;
        this.shiftCooldown = 0;
        this.reverseTimer = 0;
        this.limiterTimer = 0;
        this.boost = 0;
        this.tcsScale = 1;
        this.absScale = [1, 1, 1, 1];
        this.manualShiftRequest = 0;
        this.driftActive = false;
        this.driftWindow = false;
        this.driftSwitch = 0;
        this.driftDrive = 0;
        this.gear = speed > 0.5 ? this.gearForSpeed(speed) : 1;
        this.pendingGear = this.gear;
        this.engineRpm = Math.max(
            this.spec.idleRpm,
            this.rpmForSpeed(speed, this.gear)
        );
        this.updateStaticLoads(1);
    }

    getSpeed() {
        return Math.hypot(this.vx, this.vy);
    }

    // body slip angle: how far the velocity points away from the nose
    getBodySlip() {
        const speed = this.getSpeed();
        if (speed < 2) return 0;
        return Math.atan2(this.vy, Math.abs(this.vx));
    }

    gearRatio(gear: number) {
        const { spec } = this;
        if (gear < 0) return -spec.reverseRatio * spec.finalDrive;
        if (gear === 0) return 0;
        return spec.gearRatios[gear - 1] * spec.finalDrive;
    }

    rpmForSpeed(speed: number, gear: number) {
        return (
            (Math.abs(speed) / this.spec.wheelRadius) *
            Math.abs(this.gearRatio(gear)) *
            RAD_PER_S_TO_RPM
        );
    }

    gearForSpeed(speed: number) {
        const { spec } = this;
        for (let gear = 1; gear <= spec.gearRatios.length; gear++) {
            if (this.rpmForSpeed(speed, gear) < spec.shiftUpRpm * 0.92) {
                return gear;
            }
        }
        return spec.gearRatios.length;
    }

    // full throttle engine torque at an rpm, from the car's torque curve and
    // the boost built so far
    engineTorque(rpm: number) {
        const b = this.spec.boost;
        if (!b) return torqueAt(this.spec, rpm);
        return tableTorqueAt(this.spec, rpm) * (1 + b.gain * this.boost);
    }

    // turbos spool toward what the pedal and revs ask for, and dump it fast
    updateBoost(dt: number, throttle: number) {
        const b = this.spec.boost;
        if (!b) {
            this.boost = 0;
            return;
        }
        const target = throttle * boostShare(this.spec, this.engineRpm);
        const tau = target > this.boost ? b.time : b.time * 0.35;
        this.boost += (target - this.boost) * (1 - Math.exp(-dt / Math.max(0.01, tau)));
    }

    engineBraking(rpm: number) {
        const { spec } = this;
        return -(0.06 + 0.12 * (rpm / spec.redlineRpm)) * spec.torqueNm;
    }

    requestShift(direction: number) {
        this.manualShiftRequest = Math.sign(direction);
    }

    startShift(gear: number) {
        if (gear === this.gear && this.shiftTimer <= 0) return;
        const previous = this.gear;
        this.pendingGear = gear;
        this.shiftTimer = gear < 0 || previous < 0 ? 0.05 : this.spec.shiftTime;
        this.shiftCooldown = this.shiftTimer + SHIFT_COOLDOWN;
        if (this.onShift) this.onShift(gear, previous);
    }

    updateGearbox(dt: number, controls: PhysicsControls, drivenOmega: number) {
        const { spec } = this;
        this.shiftCooldown = Math.max(0, this.shiftCooldown - dt);
        if (this.shiftTimer > 0) {
            this.shiftTimer -= dt;
            if (this.shiftTimer <= 0) {
                this.shiftTimer = 0;
                this.gear = this.pendingGear;
            }
            return;
        }

        const forwardSpeed = this.vx;
        // stopped with the brake held: back up, with the auto box. the pedals
        // swap in reverse. a manual box gets it from first, one down at a stop
        if (this.gear > 0) {
            if (
                this.assists.autoGears &&
                Math.abs(forwardSpeed) < REVERSE_STOP_SPEED &&
                controls.brake > 0.2 &&
                controls.throttle < 0.05
            ) {
                this.reverseTimer += dt;
                if (this.reverseTimer > REVERSE_HOLD) {
                    this.reverseTimer = 0;
                    this.startShift(-1);
                    return;
                }
            } else {
                this.reverseTimer = 0;
            }
        } else if (this.gear < 0) {
            if (this.manualShiftRequest > 0) {
                this.manualShiftRequest = 0;
                this.startShift(1);
                return;
            }
            this.manualShiftRequest = 0;
            if (
                forwardSpeed > -REVERSE_ENGAGE_SPEED &&
                controls.throttle > 0.1
            ) {
                this.reverseTimer += dt;
                if (this.reverseTimer > REVERSE_ENGAGE_DELAY) {
                    this.reverseTimer = 0;
                    this.startShift(1);
                }
            } else {
                this.reverseTimer = 0;
            }
            return;
        }

        const gears = spec.gearRatios.length;
        if (this.manualShiftRequest !== 0) {
            const request = this.manualShiftRequest;
            this.manualShiftRequest = 0;
            if (
                request < 0 &&
                this.gear === 1 &&
                Math.abs(forwardSpeed) < REVERSE_STOP_SPEED
            ) {
                this.startShift(-1);
                return;
            }
            const next = clamp(this.gear + request, 1, gears);
            if (next !== this.gear) {
                // don't let a manual downshift over-rev the engine
                const rpm =
                    Math.abs(drivenOmega) * Math.abs(this.gearRatio(next));
                if (rpm * RAD_PER_S_TO_RPM < spec.redlineRpm * 1.02) {
                    this.startShift(next);
                }
            }
            return;
        }
        if (!this.assists.autoGears || this.shiftCooldown > 0) return;

        const rpm = Math.abs(drivenOmega) * Math.abs(this.gearRatio(this.gear));
        const rpmNow = rpm * RAD_PER_S_TO_RPM;
        // mid drift the box goes by road speed, not the spinning wheels: the
        // lowest gear that keeps road speed under 64% of the redline, so
        // there's rpm left to spin the rear. on the handbrake it doesn't shift
        // at all
        if (controls.handbrake > 0.1) return;
        const sliding =
            this.driftActive ||
            (Math.abs(this.getBodySlip()) > 0.15 && this.getSpeed() > 5);
        if (sliding) {
            const speed = this.getSpeed();
            let want = 1;
            while (
                want < gears &&
                this.rpmForSpeed(speed, want) >
                    spec.redlineRpm * this.driftTuning.gearRpm
            ) {
                want++;
            }
            if (
                want < this.gear &&
                this.rpmForSpeed(speed, this.gear - 1) >
                    spec.redlineRpm * this.driftTuning.downshiftRpm
            ) {
                want = this.gear;
            }
            if (want !== this.gear) {
                this.startShift(this.gear + Math.sign(want - this.gear));
            }
            return;
        }
        if (this.gear < gears && rpmNow > spec.shiftUpRpm) {
            this.startShift(this.gear + 1);
            return;
        }
        if (this.gear > 1) {
            // wheels locked by the handbrake or a stab of brake aren't the
            // road speed, so downshifts go by whichever is faster
            const omega = Math.max(
                Math.abs(drivenOmega),
                Math.abs(this.vx) / spec.wheelRadius
            );
            const current =
                omega * Math.abs(this.gearRatio(this.gear)) * RAD_PER_S_TO_RPM;
            const lower =
                omega *
                Math.abs(this.gearRatio(this.gear - 1)) *
                RAD_PER_S_TO_RPM;
            const braking =
                controls.brake > 0.3 && lower < spec.shiftUpRpm * 0.86;
            const kickdown =
                controls.throttle > 0.95 &&
                lower < spec.shiftUpRpm * 0.78 &&
                current < spec.shiftDownRpm * 1.6;
            if (current < spec.shiftDownRpm || braking || kickdown) {
                this.startShift(this.gear - 1);
            }
        }
    }

    // road wheel angle for a steer input. full input is the angle for the
    // tightest turn the tires can hold at this speed, plus a little margin to
    // push past it. both axles slip about the same at the limit, so that's
    // close to the geometric angle for the turn, not that plus a slip angle
    updateSteering(dt: number, steerInput: number) {
        const { spec } = this;
        const speed = this.getSpeed();
        const grip = spec.tireGrip * GRAVITY;
        const kinematic = Math.atan(
            (spec.wheelbase * grip) / Math.max(speed * speed, 1)
        );
        // on the handbrake the car needs more range to flick it in, and while
        // it slides you can countersteer as far as the front axle's travel.
        // steering further into a slide stays at the normal limit
        const base = Math.min(
            spec.maxSteer,
            kinematic * 1.05 +
                spec.slipAnglePeak * 0.35 +
                this.handbrakeInput * 0.15 * clamp((30 - speed) / 15, 0, 1)
        );
        const frontTravel =
            this.vx > 2
                ? Math.atan2(
                      this.vy + this.yawRate * this.wheelX[0],
                      Math.max(Math.abs(this.vx), 1)
                  )
                : 0;
        const countersteering =
            Math.abs(frontTravel) > 0.03 &&
            Math.sign(steerInput) === Math.sign(frontTravel);
        const limit = countersteering
            ? Math.min(spec.maxSteer, base + Math.abs(frontTravel) * 1.1)
            : base;
        let target = steerInput * limit;
        if (this.assists.abs && this.brakeInput > 0.1 && this.vx > 5) {
            const reach = spec.slipAnglePeak * BRAKING_STEER_REACH;
            target = clamp(target, frontTravel - reach, frontTravel + reach);
        }
        this.steerRequest = target;
        this.driftThrottle = 1;

        if (this.updateDrift(steerInput, speed, frontTravel, dt)) {
            target = this.driftSteer;
        } else if (this.assists.countersteer && speed > 4 && this.vx > 2) {
            // steer toward where the car is going by about the body slip
            // angle while the rear is out. that puts the front tires past the
            // front axle's own travel, so they push the nose back and stop the
            // rotation instead of just following it
            const beta = this.getBodySlip();
            const oversteer = beta * this.yawRate < 0 ? 1 : 0.35;
            const amount =
                clamp((Math.abs(beta) - 0.05) / 0.12, 0, 1) * oversteer;
            if (amount > 0) {
                target += beta * 1.1 * amount;
            }
        }
        target = clamp(target, -spec.maxSteer, spec.maxSteer);
        this.steerAngle = moveToward(this.steerAngle, target, 5 * dt);
    }

    // drift assist: once the rear is out, the steering moves the slip angle it
    // holds (~26 degrees hands off, up to ~35 and a tighter line into the
    // corner, trimmed and a wider line the other way, held there on the power
    // it swings into a drift the other way) and the throttle scales it
    // (lifting winds it down). the front wheels are aimed where the front
    // axle is going plus a correction toward that angle, and the throttle is
    // eased when the angle overshoots, so the car doesn't swap ends
    updateDrift(
        steerInput: number,
        speed: number,
        frontTravel: number,
        dt: number
    ) {
        const beta = this.getBodySlip();
        const oversteer = beta * this.yawRate < 0;
        const hold =
            this.assists.drift ||
            (this.driftWindow && this.assists.stability);
        if (!hold || speed < 5 || this.vx < 2) {
            this.driftActive = false;
            return false;
        }
        const tuning = this.driftTuning;
        if (!this.driftActive) {
            const start = Math.abs(beta);
            this.driftBeta = beta;
            if (!(oversteer && start > tuning.startSlip && speed > 7)) {
                return false;
            }
            this.driftActive = true;
            // a left drift has the velocity to the right of the nose, beta < 0
            this.driftSide = -Math.sign(beta) || 1;
            this.driftSwitch = 0;
            this.driftAim = clamp(start, tuning.startSlip, tuning.baseAngle);
            this.driftHold = 0;
            this.driftCap = speed + tuning.capMargin;
            this.driftLow = 0;
        }
        this.driftCap = Math.min(this.driftCap, speed + tuning.capMargin);
        this.driftGovern = clamp(
            1 - (speed - this.driftCap) / tuning.capSpan,
            tuning.capFloor,
            1
        );
        // the steer moves the angle it holds rather than setting it: into the
        // corner deepens it, the other way trims it, and held there on the
        // power carries it on through straight into a drift the other way.
        // a tap is a correction, hands off it settles back to the base angle
        let side = this.driftSide;
        const maxAngle = tuning.baseAngle + tuning.extraAngle;
        const into = Math.max(0, steerInput * side);
        const against = Math.max(0, -steerInput * side);
        const powered = this.driftDrive > tuning.switchDrive;
        let crossing = false;
        if (against > 0.05) {
            this.driftHold += against * dt;
            if (this.driftHold > tuning.crossDelay && powered) {
                crossing = against > 0.3;
                this.driftAim -= tuning.aimCross * against * dt;
            } else if (this.driftAim > tuning.trimAngle) {
                this.driftAim = Math.max(
                    tuning.trimAngle,
                    this.driftAim - tuning.aimDown * against * dt
                );
            }
        } else {
            this.driftHold = 0;
            this.driftAim =
                into > 0.05
                    ? moveToward(this.driftAim, maxAngle, tuning.aimUp * into * dt)
                    : moveToward(
                          this.driftAim,
                          tuning.baseAngle,
                          tuning.aimSettle * dt
                      );
        }
        if (this.driftAim < -tuning.flipAngle && powered) {
            side = this.driftSide = -side;
            this.driftAim = -this.driftAim;
            this.driftHold = 0;
            this.driftSwitch = tuning.switchTime;
        }
        this.driftSwitch = Math.max(0, this.driftSwitch - dt);
        // the slip angle on the drift's side, negative while it swings over
        const angle = -beta * side;
        const angleRate =
            dt > 0 ? (-(beta - this.driftBeta) * side) / dt : 0;
        this.driftBeta = beta;
        // straight ends it, unless the steer is carrying it over to the other
        // side. on the power it gets a moment to come back from a dip
        this.driftLow = angle < tuning.endSlip ? this.driftLow + dt : 0;
        const grace = powered ? tuning.lowGrace : 0;
        if (this.driftSwitch <= 0 && this.driftLow > grace && !crossing) {
            this.driftActive = false;
            return false;
        }
        const turn = side;
        this.driftPath =
            turn * (tuning.pathAccel * into - tuning.pathOut * against);
        const targetAngle =
            clamp(this.driftAim, -maxAngle, maxAngle) *
            lerp(tuning.liftTarget, 1, this.driftDrive);
        this.driftTarget = targetAngle * -turn;
        const error = targetAngle - angle;
        // where the angle is headed a moment from now. headed past the target
        // it lifts and catches the swing with a yaw moment, the way a
        // driver's countersteer would, so a transition lands on the other
        // side instead of spinning. headed under it, the rear lets go early
        const predicted = targetAngle - (angle + angleRate * tuning.catchLead);
        const ahead = Math.min(error, predicted);
        this.driftCatch = -turn * clamp((-ahead - 0.05) / 0.25, 0, 1);
        this.driftShortfall = Math.max(0, predicted);
        this.driftFalling = predicted > 0 ? Math.max(0, -angleRate) : 0;
        const correction = clamp(
            tuning.steerGain * error - tuning.steerDamping * angleRate,
            -0.35,
            0.35
        );
        const steer = frontTravel + correction * turn;
        this.driftSteer = clamp(steer, -this.spec.maxSteer, this.spec.maxSteer);
        // too much angle: ease off. too little: full throttle keeps the rear
        // spinning. a big overshoot, like the swing out of a transition,
        // lifts further
        const over = clamp((-ahead - 0.1) / 0.2, 0, 1);
        this.driftThrottle = clamp(
            1 + ahead * tuning.throttleGain,
            tuning.throttleFloor * (1 - tuning.overLift * over),
            1
        );
        return true;
    }

    updateStaticLoads(normalScale: number) {
        const { spec } = this;
        const weight = spec.massKg * GRAVITY * normalScale;
        const front = weight * spec.weightFront;
        const rear = weight - front;
        this.load = [front / 2, front / 2, rear / 2, rear / 2];
    }

    updateLoads(surface: PhysicsSurface) {
        const { spec } = this;
        if (!surface.grounded) {
            this.load = [0, 0, 0, 0];
            return;
        }
        const speed2 = this.vx * this.vx;
        const downforce = 0.5 * AIR_DENSITY * spec.clA * speed2;
        const weight = spec.massKg * GRAVITY * surface.normalScale;
        const longShift =
            (spec.massKg * this.accelLong * spec.cgHeight) / spec.wheelbase;
        const front =
            weight * spec.weightFront + downforce * spec.aeroFront - longShift;
        const rear =
            weight * (1 - spec.weightFront) +
            downforce * (1 - spec.aeroFront) +
            longShift;
        // accelerating left loads the right side
        const latFront =
            (spec.massKg *
                this.accelLat *
                spec.cgHeight *
                spec.rollShareFront) /
            spec.trackFront;
        const latRear =
            (spec.massKg *
                this.accelLat *
                spec.cgHeight *
                (1 - spec.rollShareFront)) /
            spec.trackRear;
        this.load[0] = Math.max(0, front / 2 - latFront);
        this.load[1] = Math.max(0, front / 2 + latFront);
        this.load[2] = Math.max(0, rear / 2 - latRear);
        this.load[3] = Math.max(0, rear / 2 + latRear);
    }

    // drive torque at the wheels (before the differential), and the engine
    // rpm that goes with it
    updateEngine(dt: number, throttle: number, drivenOmega: number) {
        const { spec } = this;
        const ratio = this.gearRatio(
            this.shiftTimer > 0 ? this.pendingGear : this.gear
        );
        const wheelRpm = Math.abs(drivenOmega * ratio) * RAD_PER_S_TO_RPM;
        let torque: number;
        this.limiterTimer = Math.max(0, this.limiterTimer - dt);
        this.updateBoost(dt, throttle);

        if (this.shiftTimer > 0) {
            // revs swing to the new gear while it changes. a dual clutch
            // keeps most of the drive through the handover, an automatic
            // some, a manual or single clutch box none
            const target = Math.max(spec.idleRpm, wheelRpm);
            this.engineRpm = moveToward(this.engineRpm, target, 24000 * dt);
            torque =
                throttle > 0.05 && spec.shiftTorque > 0
                    ? this.engineTorque(this.engineRpm) *
                      throttle *
                      spec.shiftTorque
                    : 0;
            this.limiterActive = false;
        } else {
            // pulling away in first or reverse the clutch slips up to the
            // launch revs, and mid slide too, the way a driver kicks the
            // clutch to keep the rears spinning after a shift. otherwise it
            // only slips to keep the engine off idle, so the revs follow the
            // wheels
            const launching = Math.abs(this.gear) === 1 || this.driftActive;
            const launchRpm =
                launching && throttle > 0.05
                    ? lerp(spec.idleRpm * 1.15, spec.launchRpm, throttle)
                    : spec.idleRpm;
            if (wheelRpm < launchRpm) {
                // clutch or converter slipping: the engine holds its launch
                // revs and pushes with whatever torque it makes there
                this.engineRpm = moveToward(
                    this.engineRpm,
                    launchRpm,
                    9000 * dt
                );
                torque =
                    throttle > 0.05
                        ? this.engineTorque(this.engineRpm) * throttle
                        : 0;
                // a converter multiplies it, most at stall, none once the
                // turbine catches up with the engine
                if (torque > 0 && spec.converterRatio > 1) {
                    const slip = clamp(
                        1 - wheelRpm / Math.max(1, this.engineRpm),
                        0,
                        1
                    );
                    torque *= 1 + (spec.converterRatio - 1) * slip;
                }
            } else {
                this.engineRpm = wheelRpm;
                if (throttle > 0.05) {
                    torque = this.engineTorque(wheelRpm) * throttle;
                } else {
                    torque = this.engineBraking(wheelRpm);
                }
            }

            if (this.engineRpm >= spec.redlineRpm) {
                this.limiterTimer = LIMITER_CUT;
            }
            this.limiterActive = this.limiterTimer > 0;
            if (this.limiterActive && torque > 0) torque = 0;
        }
        this.engineRpm = clamp(
            this.engineRpm,
            spec.idleRpm * 0.9,
            spec.redlineRpm * 1.02
        );

        // electronic speed limiter
        if (torque > 0 && this.vx > spec.speedLimit - SPEED_LIMIT_BAND) {
            torque *= clamp(
                (spec.speedLimit + SPEED_LIMIT_BAND - this.vx) /
                    (2 * SPEED_LIMIT_BAND),
                0,
                1
            );
        }
        // and a sane top speed in reverse
        if (this.gear < 0 && this.vx < -9 && torque > 0) torque = 0;
        this.engineTorqueNow = torque;
        return torque * ratio * spec.drivelineEfficiency;
    }

    step(
        dt: number,
        controls: PhysicsControls,
        surface: PhysicsSurface,
        steerInput: number
    ) {
        this.displacementX = 0;
        this.displacementZ = 0;
        if (!(dt > 0)) return;
        this.handbrakeInput = clamp(controls.handbrake, 0, 1);
        this.brakeInput = clamp(this.gear < 0 ? controls.throttle : controls.brake, 0, 1);
        this.updateDriftWindow(dt, controls);
        this.updateSteering(dt, steerInput);
        const steps = Math.max(1, Math.ceil(dt / INNER_STEP));
        const h = dt / steps;
        for (let i = 0; i < steps; i++) {
            this.substep(h, controls, surface);
        }
    }

    updateDriftWindow(dt: number, controls: PhysicsControls) {
        const speed = this.getSpeed();
        if (this.handbrakeInput > 0.5 && speed > 6 && this.vx > 2) {
            this.driftWindow = true;
            this.straightTime = 0;
        } else if (this.driftWindow) {
            const straight =
                (Math.abs(this.getBodySlip()) < 0.07 &&
                    this.driftSwitch <= 0) ||
                speed < 4;
            this.straightTime = straight ? this.straightTime + dt : 0;
            if (this.straightTime > 0.6) this.driftWindow = false;
        }
        this.driftDrive +=
            (clamp(controls.throttle, 0, 1) - this.driftDrive) *
            clamp(dt / this.driftTuning.driveTime, 0, 1);
    }

    substep(dt: number, controls: PhysicsControls, surface: PhysicsSurface) {
        const { spec } = this;
        const reverse = this.gear < 0;
        // in reverse the pedals swap: brake backs up, throttle brakes
        let throttle = clamp(
            reverse ? controls.brake : controls.throttle,
            0,
            1
        );
        let brake = clamp(reverse ? controls.throttle : controls.brake, 0, 1);
        const handbrake = clamp(controls.handbrake, 0, 1);
        // a held drift takes the smoothed pedal, so taps on a key feather it
        if (this.driftActive && !reverse) throttle = this.driftDrive;
        if (throttle > 0.05 && brake > 0.35) throttle = 0;
        if (this.driftActive) throttle *= this.driftThrottle * this.driftGovern;
        // held in a drift, the rear gives up a little grip with the throttle,
        // the way heat and clutch kicks keep a lower torque car sliding
        const tuning = this.driftTuning;
        const shortfall = clamp(this.driftShortfall / 0.2, 0, 1);
        const drive = this.driftDrive * this.driftThrottle;
        const hold = lerp(tuning.buildFloor, 1, drive);
        const lifted = 1 - this.driftDrive;
        const rearDriftGrip =
            1 +
            tuning.liftGrip * lifted * lifted -
            tuning.rearGripDrop * drive -
            (tuning.buildGripDrop * shortfall +
                tuning.catchGripDrop * Math.min(1, this.driftFalling)) *
                hold;

        // with the drift assist on, all wheel drive runs its drift mode and
        // sends nearly everything to the rear, so the power turns the car
        // instead of pushing it wide
        const driftMode = this.assists.drift || this.driftWindow;
        const driveFront =
            spec.drive === 'FWD'
                ? 1
                : spec.drive === 'AWD'
                ? driftMode
                    ? Math.min(spec.frontTorqueShare, DRIFT_FRONT_SHARE)
                    : spec.frontTorqueShare
                : 0;
        const driveRear = 1 - driveFront;
        const drivenOmega =
            driveFront * (this.wheelOmega[0] + this.wheelOmega[1]) * 0.5 +
            driveRear * (this.wheelOmega[2] + this.wheelOmega[3]) * 0.5;

        this.updateGearbox(dt, controls, drivenOmega);

        // assists that act on the throttle
        const bodySlip = this.getBodySlip();
        const speed = this.getSpeed();
        this.stabilityActive = false;
        let stabilityMoment = 0;
        if (
            this.assists.stability &&
            !this.driftWindow &&
            speed > 8 &&
            surface.grounded
        ) {
            const excess = Math.abs(bodySlip) - 0.13;
            // pushing wide on the power: the nose turns well short of what
            // the wheel asks for, so the throttle eases until it bites
            const wanted =
                (this.vx * Math.tan(this.steerRequest)) / spec.wheelbase;
            const deficit =
                Math.abs(wanted) > 0.05
                    ? 1 - (this.yawRate * Math.sign(wanted)) / Math.abs(wanted)
                    : 0;
            const sliding = bodySlip * this.yawRate < 0;
            if (excess > 0 && sliding) {
                this.stabilityActive = true;
                stabilityMoment =
                    -Math.sign(this.yawRate) *
                    Math.min(excess * 5.5, 1) *
                    spec.yawInertia *
                    3.2;
            }
            // the nose swinging round faster than the tires can carry the car
            // (a snap turn in, a pendulum off a quick change of direction) is
            // damped back. a held corner stays under it
            const support = this.load[0] + this.load[1] + this.load[2] + this.load[3];
            const carried = (spec.tireGrip * support * YAW_MARGIN) / spec.massKg / speed;
            const overYaw = Math.abs(this.yawRate) - carried;
            if (overYaw > 0) {
                this.stabilityActive = true;
                stabilityMoment -=
                    Math.sign(this.yawRate) *
                    Math.min(overYaw * YAW_DAMPING, YAW_DAMPING_MAX) *
                    spec.yawInertia;
            }
            // the power comes off before the rear is far out, a slide held
            // on the throttle runs wide
            const powerSlide = sliding
                ? Math.max(0, Math.abs(bodySlip) - POWER_SLIDE_SLIP)
                : 0;
            const pushing =
                throttle > 0.2 ? Math.max(0, deficit - UNDERSTEER_SLACK) : 0;
            if (powerSlide > 0 || pushing > 0) {
                this.stabilityActive = true;
                throttle *= Math.min(
                    Math.max(0.25, 1 - powerSlide * 6),
                    Math.max(0.3, 1 - pushing * 2.5)
                );
            }
        }
        if (this.assists.tractionControl && !this.driftWindow) {
            // in reverse the wheels spin up backwards
            const spin = reverse ? -1 : 1;
            const frontSpin = Math.max(
                spin * this.slipRatio[0],
                spin * this.slipRatio[1]
            );
            const rearSpin = Math.max(
                spin * this.slipRatio[2],
                spin * this.slipRatio[3]
            );
            const drivenSlip = Math.max(
                driveFront > 0 ? frontSpin : 0,
                driveRear > 0 ? rearSpin : 0
            );
            // holds the driven wheels near their peak slip, cutting harder
            // the further past it they spin
            const target = spec.slipRatioPeak * 1.15;
            if (drivenSlip > target && throttle > 0.05) {
                const excess = (drivenSlip - target) / target;
                this.tcsScale = Math.max(
                    0.15,
                    this.tcsScale - dt * (3 + excess * 18)
                );
            } else {
                this.tcsScale = Math.min(1, this.tcsScale + dt * 6);
            }
            this.tcsActive = this.tcsScale < 0.97 && throttle > 0.05;
            throttle *= this.tcsScale;
        } else {
            this.tcsScale = 1;
            this.tcsActive = false;
        }

        // pulling the handbrake declutches, like a driver would, so the rears
        // can lock and the engine revs free
        const declutched = handbrake > 0.5;
        let driveTorque: number;
        if (declutched) {
            const free = lerp(spec.idleRpm, spec.redlineRpm * 0.8, throttle);
            this.engineRpm = moveToward(this.engineRpm, free, 7000 * dt);
            this.engineTorqueNow = 0;
            driveTorque = 0;
        } else {
            driveTorque = this.updateEngine(dt, throttle, drivenOmega);
        }
        this.updateLoads(surface);

        // differential: fixed center split, viscous limited slip per axle
        const wheelTorque = [0, 0, 0, 0];
        const splitAxle = (left: number, right: number, torque: number) => {
            const lock = clamp(
                spec.lsdLock * (this.wheelOmega[right] - this.wheelOmega[left]),
                -Math.abs(torque) * 0.45 - 150,
                Math.abs(torque) * 0.45 + 150
            );
            wheelTorque[left] += torque * 0.5 + lock;
            wheelTorque[right] += torque * 0.5 - lock;
        };
        if (driveFront > 0) splitAxle(0, 1, driveTorque * driveFront);
        if (driveRear > 0) splitAxle(2, 3, driveTorque * driveRear);

        // engine inertia rides on the driven wheels while the clutch is in
        const ratio = Math.abs(this.gearRatio(this.gear));
        const engaged = this.shiftTimer <= 0 && ratio > 0 && !declutched;
        const reflected = engaged ? spec.engineInertia * ratio * ratio : 0;

        let forceX = 0;
        let forceY = 0;
        let moment =
            stabilityMoment +
            (this.driftActive
                ? this.driftCatch * spec.yawInertia * tuning.catchAccel
                : 0);
        this.absActive = false;
        const radius = spec.wheelRadius;
        // the handbrake fades out at speed, so a stray press at 200 km/h
        // unsettles the car instead of spinning it
        const handbrakeFade = clamp((this.vx - 22) / 30, 0, 1);
        const handbrakeTorque =
            spec.handbrakeTorque *
            (1 - handbrakeFade * handbrakeFade * (3 - 2 * handbrakeFade) * 0.7);
        const C = spec.tireShape;
        const B = this.shapeB;
        const tanPeak = Math.tan(spec.slipAnglePeak);
        const nominalLoad = (spec.massKg * GRAVITY) / 4;
        // the abs steps by the stock brakes' torque, so a bigger kit bites
        // sooner but doesn't overshoot further on every cycle
        const absStep = 1 / (spec.brakeKit ?? 1);

        for (let i = 0; i < 4; i++) {
            const front = i < 2;
            const x = this.wheelX[i];
            const y = this.wheelY[i];
            const delta = front ? this.steerAngle : 0;
            const cos = Math.cos(delta);
            const sin = Math.sin(delta);
            const vxw = this.vx - this.yawRate * y;
            const vyw = this.vy + this.yawRate * x;
            const vl = vxw * cos + vyw * sin;
            const vt = -vxw * sin + vyw * cos;
            const denom = Math.max(Math.abs(vl), SLIP_SPEED_FLOOR);
            const omega = this.wheelOmega[i];

            const alpha = Math.atan2(vt, denom);
            const relax = clamp(
                dt * (Math.abs(vl) / RELAXATION_LENGTH + 60),
                0,
                1
            );
            this.slipAngle[i] += (alpha - this.slipAngle[i]) * relax;
            const kappa = (omega * radius - vl) / denom;
            this.slipRatio[i] = kappa;

            const load = this.load[i];
            const loadRatio = load / nominalLoad;
            const grip =
                (front ? spec.tireGrip : spec.tireGrip * spec.tireGripRear) *
                (surface.grip[i] ?? 1) *
                clamp(1 - spec.loadSensitivity * (loadRatio - 1), 0.7, 1.2) *
                (front || !this.driftActive ? 1 : rearDriftGrip);
            const sx = kappa / spec.slipRatioPeak;
            const sy = Math.tan(this.slipAngle[i]) / tanPeak;
            const s = Math.hypot(sx, sy);
            let fl = 0;
            let ft = 0;
            let stiffness = 0;
            if (load > 0 && s > 1e-6) {
                const shape = Math.sin(C * Math.atan(B * s));
                const force = grip * load * shape;
                let alongL = sx / s;
                let alongT = -sy / s;
                // a tire braked far past its peak (locked) pushes against the
                // way its contact patch slides, not along where it points
                const locked =
                    front || handbrake < 0.1 ? clamp((-sx - 2) / 2, 0, 1) : 0;
                const slideL = omega * radius - vl;
                const slide = Math.hypot(slideL, vt);
                if (locked > 0 && slide > 1e-6) {
                    alongL = lerp(alongL, slideL / slide, locked);
                    alongT = lerp(alongT, -vt / slide, locked);
                    const n = Math.hypot(alongL, alongT) || 1;
                    alongL /= n;
                    alongT /= n;
                }
                fl = force * alongL * LONGITUDINAL_GRIP;
                ft = force * alongT;
                // slope of the force curve, for the implicit wheel update
                const bs = B * s;
                const dShape =
                    (C * Math.cos(C * Math.atan(bs)) * B) / (1 + bs * bs);
                stiffness =
                    Math.max(0, grip * load * dShape) / spec.slipRatioPeak;
            } else if (load > 0) {
                stiffness = (grip * load * C * B) / spec.slipRatioPeak;
            }
            // rolling resistance and grass drag
            const rolling =
                (spec.rollingResistance + (surface.drag[i] ?? 0)) *
                load *
                Math.tanh(vl / 0.4);
            fl -= rolling;

            // wheel spin, linearized implicitly so stiff tires stay stable
            const inertia =
                spec.wheelInertia +
                (reflected * (front ? driveFront : driveRear)) / 2;
            const k = (stiffness * radius) / denom;
            const damp = 1 + (dt * radius * k) / inertia;
            let brakeTorque =
                brake *
                spec.brakeTorque *
                (front ? spec.brakeBias : 1 - spec.brakeBias) *
                0.5;
            // without abs the rear brakes sense the load like a road car's
            // valve: they ease off as weight comes off the rear, so the fronts
            // lock first and the car plows on instead of swapping ends. a
            // rearward bias still locks them
            if (!front && !this.assists.abs) {
                const valve =
                    REAR_VALVE +
                    Math.max(0, VALVE_BIAS - spec.brakeBias) * 6;
                brakeTorque = Math.min(
                    brakeTorque,
                    grip * load * radius * valve
                );
            }
            if (!front) brakeTorque += handbrake * handbrakeTorque;
            if (
                this.assists.abs &&
                brakeTorque > 0 &&
                (front || handbrake < 0.1)
            ) {
                const cornering = Math.min(Math.abs(sy), ABS_ELLIPSE);
                const room = Math.sqrt(ABS_ELLIPSE * ABS_ELLIPSE - cornering * cornering);
                const limit = spec.slipRatioPeak * clamp(room, ABS_FLOOR, 1.2);
                if (kappa < -limit && Math.abs(vl) > 2) {
                    // a kit past the stock torque drops straight back to it
                    const held = Math.min(this.absScale[i], absStep);
                    this.absScale[i] = Math.max(
                        0.2 * absStep,
                        held - dt * 30 * absStep
                    );
                } else {
                    this.absScale[i] = Math.min(
                        1,
                        this.absScale[i] + dt * 12 * absStep
                    );
                }
                if (this.absScale[i] < 0.95) this.absActive = true;
                brakeTorque *= this.absScale[i];
            } else {
                this.absScale[i] = 1;
            }
            const free =
                omega + (dt * (wheelTorque[i] - radius * fl)) / inertia / damp;
            const brakeStep = (dt * brakeTorque) / inertia / damp;
            let next: number;
            if (free > 0) next = Math.max(0, free - brakeStep);
            else next = Math.min(0, free + brakeStep);
            // force consistent with the implicit spin update
            const applied = fl + (k / radius) * (next - omega) * radius;
            const limit = grip * load * 1.1;
            fl = clamp(
                applied,
                -limit - Math.abs(rolling),
                limit + Math.abs(rolling)
            );
            if (load <= 0) fl = 0;
            this.wheelOmega[i] = next;
            this.forceLong[i] = fl;
            this.forceLat[i] = ft;

            const fx = fl * cos - ft * sin;
            const fy = fl * sin + ft * cos;
            forceX += fx;
            forceY += fy;
            moment += x * fy - y * fx;
        }

        // aero drag and the road's slope
        const drag = 0.5 * AIR_DENSITY * spec.cdA;
        forceX -= drag * this.vx * Math.abs(this.vx);
        forceY -= drag * 2.5 * this.vy * Math.abs(this.vy);
        if (surface.grounded) {
            forceX += spec.massKg * surface.slopeForward;
            forceY += spec.massKg * surface.slopeLeft;
        }
        // steering into a held drift bends the path toward the inside, a
        // force across the velocity so it costs no speed
        const speedNow = Math.hypot(this.vx, this.vy);
        if (this.driftActive && surface.grounded && speedNow > 3) {
            const push = this.driftPath * spec.massKg;
            forceX -= (this.vy / speedNow) * push;
            forceY += (this.vx / speedNow) * push;
        }

        const ax = forceX / spec.massKg;
        const ay = forceY / spec.massKg;
        this.vx += (ax + this.yawRate * this.vy) * dt;
        this.vy += (ay - this.yawRate * this.vx) * dt;
        if (surface.grounded) {
            this.yawRate += (moment / spec.yawInertia) * dt;
        } else {
            this.yawRate *= Math.max(0, 1 - dt * 0.8);
        }
        const loadBlend = clamp(dt / spec.loadFilterTime, 0, 1);
        this.accelLong += (ax - this.accelLong) * loadBlend;
        this.accelLat += (ay - this.accelLat) * loadBlend;

        // parked: no creep, no jitter
        if (
            surface.grounded &&
            Math.abs(this.vx) < 0.12 &&
            Math.abs(this.vy) < 0.12 &&
            throttle < 0.02 &&
            Math.abs(surface.slopeForward) < 1.5
        ) {
            this.vx *= 0.8;
            this.vy *= 0.8;
            this.yawRate *= 0.8;
        }

        this.yaw += this.yawRate * dt;
        const sinYaw = Math.sin(this.yaw);
        const cosYaw = Math.cos(this.yaw);
        this.displacementX += (this.vx * sinYaw + this.vy * cosYaw) * dt;
        this.displacementZ += (this.vx * cosYaw - this.vy * sinYaw) * dt;
    }

    // collision impulse at a point on the body (body frame), along a world
    // normal given in the body frame. used for barriers
    applyImpulse(
        pointX: number,
        pointY: number,
        impulseX: number,
        impulseY: number
    ) {
        const { spec } = this;
        this.vx += impulseX / spec.massKg;
        this.vy += impulseY / spec.massKg;
        this.yawRate +=
            (pointX * impulseY - pointY * impulseX) /
            (spec.yawInertia * IMPACT_INERTIA_SCALE);
        // the tires can't keep spinning at the old road speed through a hit
        const rollOmega = this.vx / spec.wheelRadius;
        for (let i = 0; i < 4; i++) {
            this.wheelOmega[i] = lerp(this.wheelOmega[i], rollOmega, 0.5);
        }
    }

    // velocity of a body point in the body frame
    pointVelocity(pointX: number, pointY: number) {
        return {
            x: this.vx - this.yawRate * pointY,
            y: this.vy + this.yawRate * pointX,
        };
    }

    effectiveMass(
        pointX: number,
        pointY: number,
        normalX: number,
        normalY: number
    ) {
        const { spec } = this;
        const cross = pointX * normalY - pointY * normalX;
        return (
            1 /
            (1 / spec.massKg +
                (cross * cross) / (spec.yawInertia * IMPACT_INERTIA_SCALE))
        );
    }

    // how much the rear is sliding or spinning, 0..1, for smoke and squeal
    getRearSlideIntensity() {
        const { spec } = this;
        const lateral = Math.max(
            Math.abs(this.slipAngle[2]),
            Math.abs(this.slipAngle[3])
        );
        const spin = Math.max(
            Math.abs(this.slipRatio[2]),
            Math.abs(this.slipRatio[3])
        );
        const slide = clamp(
            (lateral - spec.slipAnglePeak * 0.9) / (spec.slipAnglePeak * 2.2),
            0,
            1
        );
        const wheelspin = clamp(
            (spin - spec.slipRatioPeak * 1.2) / (spec.slipRatioPeak * 3),
            0,
            1
        );
        return Math.max(slide, wheelspin);
    }

    getFrontSlideIntensity() {
        const { spec } = this;
        const lateral = Math.max(
            Math.abs(this.slipAngle[0]),
            Math.abs(this.slipAngle[1])
        );
        const lock = Math.max(-this.slipRatio[0], -this.slipRatio[1], 0);
        const slide = clamp(
            (lateral - spec.slipAnglePeak * 1.05) / (spec.slipAnglePeak * 2),
            0,
            1
        );
        const lockup = clamp(
            (lock - spec.slipRatioPeak * 1.3) / (spec.slipRatioPeak * 3),
            0,
            1
        );
        return Math.max(slide, lockup);
    }
}

const FLAT_GROUND: PhysicsSurface = {
    grounded: true,
    slopeForward: 0,
    slopeLeft: 0,
    normalScale: 1,
    grip: [1, 1, 1, 1],
    drag: [0, 0, 0, 0],
};
const STOP_STEP = 1 / 60;

// how far the car takes to stop from a speed (m/s) on the flat, flat out on
// the brake with abs from the first moment, worked out by driving the model
export const predictStop = (spec: PhysicsSpec, speed: number) => {
    const car = new VehiclePhysics(spec);
    car.reset(0, speed);
    const controls = { throttle: 0, brake: 1, handbrake: 0, steer: 0 };
    let distance = 0;
    for (let t = 0; t < 30 && car.vx > 0.3; t += STOP_STEP) {
        car.step(STOP_STEP, controls, FLAT_GROUND, 0);
        distance += car.vx * STOP_STEP;
    }
    return distance;
};
