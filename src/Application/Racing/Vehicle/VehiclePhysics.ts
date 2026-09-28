// planar vehicle dynamics for race mode: four tires with combined slip and
// load sensitivity, weight transfer, an engine with a torque curve and a
// gearbox, differentials, brakes, aero, and optional driver assists.
//
// body frame: x forward, y to the left, yaw positive turns left. RaceVehicle
// owns height and surface orientation (grounding), this owns motion along
// the ground. no three.js here, it's plain numbers so it can be tested and
// stepped at a high rate cheaply.

export type DriveLayout = 'RWD' | 'AWD' | 'FWD';

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
    powerW: number;
    powerRpm: number;
    torqueNm: number;
    torqueRpm: number;
    idleRpm: number;
    redlineRpm: number;
    shiftUpRpm: number;
    shiftDownRpm: number;
    gearRatios: number[];
    finalDrive: number;
    reverseRatio: number;
    shiftTime: number;
    launchRpm: number;
    drivelineEfficiency: number;
    brakeTorque: number;
    brakeBias: number;
    handbrakeTorque: number;
    maxSteer: number;
    vmax: number;
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
const DRIFT_GEAR_RPM = 0.62;
export const DRIFT_TUNING = {
    startSlip: 0.12,
    endSlip: 0.05,
    baseAngle: 0.35,
    extraAngle: 0.25,
    exitAngle: 0.3,
    steerGain: 0.8,
    // damping on how fast the slip angle changes, seconds. without it the car
    // snaps back through straight into a slide the other way
    steerDamping: 0.25,
    // throttle eases by this per radian over the target, down to the floor
    throttleGain: 2.5,
    throttleFloor: 0.55,
    rearGripDrop: 0.16,
    // extra rear grip given up while the angle is under target, so a small
    // flick can still grow into the drift
    buildGripDrop: 0.2,
};
const INNER_STEP = 1 / 600;
// slip denominators don't go below this, which keeps the tires stable (and
// damped) when the car is nearly stopped
const SLIP_SPEED_FLOOR = 1.5;
const RELAXATION_LENGTH = 0.3;
const SHIFT_COOLDOWN = 0.3;
const REVERSE_ENGAGE_SPEED = 0.8;
const REVERSE_ENGAGE_DELAY = 0.25;
const RAD_PER_S_TO_RPM = 60 / (Math.PI * 2);
// tires grip a bit harder braking and accelerating than cornering
const LONGITUDINAL_GRIP = 1.1;
// wall hits treat the car as harder to spin than it is, which reads better
// than a pinball bounce off a clipped barrier
const IMPACT_INERTIA_SCALE = 3;

const clamp = (value: number, min: number, max: number) =>
    value < min ? min : value > max ? max : value;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const moveToward = (value: number, target: number, maxDelta: number) =>
    value < target
        ? Math.min(target, value + maxDelta)
        : Math.max(target, value - maxDelta);

export default class VehiclePhysics {
    spec: PhysicsSpec;
    assists: AssistSettings;
    yaw: number;
    vx: number;
    vy: number;
    yawRate: number;
    steerAngle: number;
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
    private driftAngle: number;
    private driftShortfall = 0;
    limiterActive: boolean;
    engineTorqueNow: number;
    manualShiftRequest: number;
    handbrakeInput: number;
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
        this.driftAngle = 0;
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
        this.tcsScale = 1;
        this.absScale = [1, 1, 1, 1];
        this.manualShiftRequest = 0;
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

    // full throttle engine torque at an rpm: flat from the torque rpm, capped
    // by peak power above it, and softer below it
    engineTorque(rpm: number) {
        const { spec } = this;
        const r = clamp(rpm, spec.idleRpm, spec.redlineRpm);
        let torque = spec.torqueNm;
        if (r < spec.torqueRpm) {
            const t =
                (r - spec.idleRpm) / Math.max(1, spec.torqueRpm - spec.idleRpm);
            torque *= lerp(0.6, 1, t * t * (3 - 2 * t));
        }
        const past = Math.max(0, r - spec.powerRpm);
        const powerShape =
            1 - (0.1 * past) / Math.max(1, spec.redlineRpm - spec.powerRpm);
        const omega = Math.max(1, r / RAD_PER_S_TO_RPM);
        return Math.min(torque, (spec.powerW * powerShape) / omega);
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
        // stopped with the brake held: back up. the pedals swap in reverse
        if (this.gear > 0) {
            if (
                forwardSpeed < REVERSE_ENGAGE_SPEED &&
                controls.brake > 0.2 &&
                controls.throttle < 0.05
            ) {
                this.reverseTimer += dt;
                if (this.reverseTimer > REVERSE_ENGAGE_DELAY) {
                    this.reverseTimer = 0;
                    this.startShift(-1);
                    return;
                }
            } else {
                this.reverseTimer = 0;
            }
        } else if (this.gear < 0) {
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
            const next = clamp(this.gear + this.manualShiftRequest, 1, gears);
            this.manualShiftRequest = 0;
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
        // gear that puts road speed around 70% of the redline, so there's rpm
        // left to spin the rear. on the handbrake it doesn't shift at all
        if (controls.handbrake > 0.1) return;
        if (this.driftActive) {
            let want = 1;
            while (
                want < gears &&
                this.rpmForSpeed(this.getSpeed(), want) >
                    spec.redlineRpm * DRIFT_GEAR_RPM
            ) {
                want++;
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
            const lower =
                Math.abs(drivenOmega) *
                Math.abs(this.gearRatio(this.gear - 1)) *
                RAD_PER_S_TO_RPM;
            const braking =
                controls.brake > 0.3 && lower < spec.shiftUpRpm * 0.86;
            const kickdown =
                controls.throttle > 0.95 &&
                lower < spec.shiftUpRpm * 0.78 &&
                rpmNow < spec.shiftDownRpm * 1.6;
            if (rpmNow < spec.shiftDownRpm || braking || kickdown) {
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

    // drift assist: once the rear is out, the steering picks the slip angle
    // (straight ~20 degrees, into the corner up to ~34, out of it winds the
    // slide down) and the front wheels are aimed where the front axle is
    // going plus a correction toward that angle. the throttle is eased when
    // the angle overshoots, so the car doesn't swap ends
    updateDrift(
        steerInput: number,
        speed: number,
        frontTravel: number,
        dt: number
    ) {
        const beta = this.getBodySlip();
        const oversteer = beta * this.yawRate < 0;
        if (!this.assists.drift || speed < 5 || this.vx < 2) {
            this.driftActive = false;
            return false;
        }
        const tuning = this.driftTuning;
        const angle = Math.abs(beta);
        const angleRate = dt > 0 ? (angle - this.driftAngle) / dt : 0;
        this.driftAngle = angle;
        if (!this.driftActive) {
            if (!(oversteer && angle > tuning.startSlip && speed > 7)) {
                return false;
            }
            this.driftActive = true;
        } else if (angle < tuning.endSlip) {
            this.driftActive = false;
            return false;
        }
        // the corner the car is drifting through: a left drift has the
        // velocity to the right of the nose, so beta < 0
        const turn = -Math.sign(beta) || 1;
        const into = Math.max(0, steerInput * turn);
        const out = Math.max(0, -steerInput * turn);
        const targetAngle = clamp(
            tuning.baseAngle +
                tuning.extraAngle * into -
                tuning.exitAngle * out,
            0.02,
            0.62
        );
        this.driftTarget = targetAngle * -turn;
        const error = targetAngle - angle;
        this.driftShortfall = Math.max(0, error);
        const correction = clamp(
            tuning.steerGain * error - tuning.steerDamping * angleRate,
            -0.35,
            0.35
        );
        const steer = frontTravel + correction * turn;
        this.driftSteer = clamp(steer, -this.spec.maxSteer, this.spec.maxSteer);
        // too much angle: ease off. too little: full throttle keeps the rear
        // spinning
        this.driftThrottle = clamp(
            1 + error * tuning.throttleGain,
            tuning.throttleFloor,
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

        if (this.shiftTimer > 0) {
            // torque is cut while the gear changes, revs swing to the new gear
            const target = Math.max(spec.idleRpm, wheelRpm);
            this.engineRpm = moveToward(this.engineRpm, target, 24000 * dt);
            this.engineTorqueNow = 0;
            return 0;
        }

        this.limiterTimer = Math.max(0, this.limiterTimer - dt);
        const launchRpm =
            throttle > 0.05
                ? lerp(spec.idleRpm * 1.15, spec.launchRpm, throttle)
                : spec.idleRpm;
        let torque: number;
        if (wheelRpm < launchRpm) {
            // clutch slipping: the engine holds its launch revs and pushes
            // with whatever torque it makes there
            this.engineRpm = moveToward(this.engineRpm, launchRpm, 9000 * dt);
            torque =
                throttle > 0.05
                    ? this.engineTorque(this.engineRpm) * throttle
                    : 0;
        } else {
            this.engineRpm = wheelRpm;
            if (throttle > 0.05) {
                torque = this.engineTorque(wheelRpm) * throttle;
            } else {
                torque = this.engineBraking(wheelRpm);
            }
        }

        if (this.engineRpm >= spec.redlineRpm) {
            this.limiterTimer = 0.06;
        }
        this.limiterActive = this.limiterTimer > 0;
        if (this.limiterActive && torque > 0) torque = 0;
        this.engineRpm = clamp(
            this.engineRpm,
            spec.idleRpm * 0.9,
            spec.redlineRpm * 1.02
        );

        // electronic speed limiter, and a sane top speed in reverse
        if (this.vx > spec.vmax && torque > 0) {
            torque *= clamp(1 - (this.vx - spec.vmax) * 0.8, 0, 1);
        }
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
        this.updateSteering(dt, steerInput);
        const steps = Math.max(1, Math.ceil(dt / INNER_STEP));
        const h = dt / steps;
        for (let i = 0; i < steps; i++) {
            this.substep(h, controls, surface);
        }
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
        if (throttle > 0.05 && brake > 0.35) throttle = 0;
        if (this.driftActive) throttle *= this.driftThrottle;
        // held in a drift, the rear gives up a little grip with the throttle,
        // the way heat and clutch kicks keep a lower torque car sliding
        const tuning = this.driftTuning;
        const shortfall = clamp(this.driftShortfall / 0.2, 0, 1);
        const rearDriftGrip =
            1 -
            (tuning.rearGripDrop + tuning.buildGripDrop * shortfall) * throttle;

        const driveFront =
            spec.drive === 'FWD'
                ? 1
                : spec.drive === 'AWD'
                ? spec.frontTorqueShare
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
        if (this.assists.stability && speed > 8 && surface.grounded) {
            const excess = Math.abs(bodySlip) - 0.13;
            if (excess > 0 && bodySlip * this.yawRate < 0) {
                this.stabilityActive = true;
                stabilityMoment =
                    -Math.sign(this.yawRate) *
                    Math.min(excess * 5.5, 1) *
                    spec.yawInertia *
                    3.2;
                throttle *= Math.max(0.25, 1 - excess * 5);
            }
        }
        if (this.assists.tractionControl) {
            const drivenSlip = Math.max(
                driveFront > 0
                    ? Math.max(this.slipRatio[0], this.slipRatio[1])
                    : 0,
                driveRear > 0
                    ? Math.max(this.slipRatio[2], this.slipRatio[3])
                    : 0
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
        let moment = stabilityMoment;
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
                fl = ((force * sx) / s) * LONGITUDINAL_GRIP;
                ft = (-force * sy) / s;
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
            if (!front) brakeTorque += handbrake * handbrakeTorque;
            if (
                this.assists.abs &&
                brakeTorque > 0 &&
                (front || handbrake < 0.1)
            ) {
                if (kappa < -spec.slipRatioPeak * 1.2 && Math.abs(vl) > 2) {
                    this.absScale[i] = Math.max(
                        0.2,
                        this.absScale[i] - dt * 30
                    );
                } else {
                    this.absScale[i] = Math.min(1, this.absScale[i] + dt * 12);
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
