// garage choices per car: the look (paint, wheels, body mods) and the tune
// that feeds the driving model. both persist per car and the look is sent to
// the other players. a car with any tune or aero or ride height change sets
// laps on the tuned board, stock cars on the stock one
import type { PhysicsSpec } from '../Vehicle/VehiclePhysics';
import { applyEngine, ENGINE_IDS, isStockEngine } from './engines';
import type { Exhaust, Induction } from './engines';

export type { Exhaust, Induction };

export type PaintFinish =
    'stock' | 'gloss' | 'metallic' | 'pearl' | 'matte' | 'chrome';
export type Spoiler = 'none' | 'ducktail' | 'wing';
export type TireCompound = 'street' | 'sport' | 'semi' | 'slick' | 'drift';
export type BrakeKit = 'stock' | 'street' | 'sport' | 'race';
export type WeightReduction = 'stock' | 'sport' | 'race';
// a swap to the layout the car doesn't have, 'stock' keeps its own
export type Drivetrain = 'stock' | 'rwd' | 'awd';

export type CarLook = {
    // hex like #1f4fa8, null keeps the factory color
    paint: string | null;
    finish: PaintFinish;
    rims: string | null;
    calipers: string | null;
    // 'stock' or the id of the car whose rims these are
    wheels: string;
    spoiler: Spoiler;
    // the gt wing's angle, -1 low drag to +1 most downforce
    wingAngle: number;
    // -1 slammed to +1 raised, about 3 cm each way
    ride: number;
};

export type CarTune = {
    // engine map, power and torque scale
    power: number;
    tires: TireCompound;
    // -1 soft to +1 stiff
    springsFront: number;
    springsRear: number;
    damping: number;
    // -1 open to +1 locked, around the car's own limited slip
    diff: number;
    // -1 long to +1 short final drive
    gearing: number;
    // share of brake force on the front axle
    brakeBias: number;
    // calipers, rotors and pads, and the line pressure the sport and race
    // kits let you set (1 is stock)
    brakes: BrakeKit;
    brakePressure: number;
    // false takes the electronic top speed limiter out
    speedLimiter: boolean;
    // angle kit: more steering lock, for countersteering big slides
    angleKit: boolean;
    // 'stock' or an engine from engines.ts, and what feeds and follows it
    engine: string;
    induction: Induction;
    exhaust: Exhaust;
    weight: WeightReduction;
    drivetrain: Drivetrain;
};

export const STOCK_LOOK: CarLook = {
    paint: null,
    finish: 'stock',
    rims: null,
    calipers: null,
    wheels: 'stock',
    spoiler: 'none',
    wingAngle: 0,
    ride: 0,
};

export const STOCK_BRAKE_BIAS = 0.64;

export const STOCK_TUNE: CarTune = {
    power: 1,
    tires: 'sport',
    springsFront: 0,
    springsRear: 0,
    damping: 0,
    diff: 0,
    gearing: 0,
    brakeBias: STOCK_BRAKE_BIAS,
    brakes: 'stock',
    brakePressure: 1,
    speedLimiter: true,
    angleKit: false,
    engine: 'stock',
    induction: 'stock',
    exhaust: 'stock',
    weight: 'stock',
    drivetrain: 'stock',
};

// what the drift build button sets: drift tires, a locked diff, a stiffer
// rear, shorter gearing and the angle kit
export const DRIFT_BUILD: Partial<CarTune> = {
    tires: 'drift',
    diff: 1,
    springsFront: 0.2,
    springsRear: 0.6,
    gearing: 0.4,
    angleKit: true,
};

const ANGLE_KIT_LOCK = (56 * Math.PI) / 180;

export const LIMITS = {
    power: [0.85, 1.15],
    springs: [-1, 1],
    damping: [-1, 1],
    diff: [-1, 1],
    gearing: [-1, 1],
    brakeBias: [0.54, 0.74],
    brakePressure: [0.7, 1.3],
    ride: [-1, 1],
    wingAngle: [-1, 1],
} as const;

const TIRES: Record<
    TireCompound,
    { grip: number; rear: number; peak: number; shape: number }
> = {
    street: { grip: 0.92, rear: 1, peak: 0.01, shape: -0.1 },
    sport: { grip: 1, rear: 1, peak: 0, shape: 0 },
    semi: { grip: 1.06, rear: 1, peak: -0.005, shape: 0.05 },
    slick: { grip: 1.12, rear: 1, peak: -0.01, shape: 0.12 },
    // a hard rear compound that lets go early and slides predictably: less
    // grip at the back, a wider peak and a flatter fall past it
    drift: { grip: 0.97, rear: 0.86, peak: 0.03, shape: -0.2 },
};

// rear downforce and drag each body kit adds (clA, cdA in m^2)
const AERO: Record<Spoiler, { cl: number; cd: number }> = {
    none: { cl: 0, cd: 0 },
    ducktail: { cl: 0.06, cd: 0.01 },
    wing: { cl: 0.22, cd: 0.05 },
};
// the wing's angle, all the way either way: half the downforce again on or
// off, and drag with it
const WING_CL = 0.11;
const WING_CD = 0.025;
const aeroOf = (look: CarLook) => {
    const aero = AERO[look.spoiler];
    if (look.spoiler !== 'wing') return aero;
    return {
        cl: aero.cl + WING_CL * look.wingAngle,
        cd: aero.cd + WING_CD * look.wingAngle,
    };
};

// lighter panels, glass and seats, then a stripped interior and a cage
export const WEIGHTS: WeightReduction[] = ['stock', 'sport', 'race'];
const WEIGHT_MASS: Record<WeightReduction, number> = {
    stock: 1,
    sport: 0.95,
    race: 0.9,
};
// an all wheel drive swap sends about a third of the torque forward, and its
// shafts and front diff weigh about 3.5% more, mostly up front. going to
// rear drive takes them out
export const DRIVETRAINS: Drivetrain[] = ['stock', 'rwd', 'awd'];
const AWD_FRONT_SHARE = 0.35;
const AWD_MASS = 1.035;
const RWD_MASS = 0.975;

export const swapOf = (drive: PhysicsSpec['drive'], drivetrain: Drivetrain) =>
    (drivetrain === 'awd' && drive !== 'AWD') ||
    (drivetrain === 'rwd' && drive !== 'RWD')
        ? drivetrain
        : null;

// brake torque on the same pedal. stock brakes already lock the tires, so
// like in forza a bigger kit bites harder on part pedal and pays off once
// grippier tires, downforce or big speed ask more than stock can give
export const BRAKE_KITS: BrakeKit[] = ['stock', 'street', 'sport', 'race'];
const BRAKE_TORQUE: Record<BrakeKit, number> = {
    stock: 1,
    street: 1.15,
    sport: 1.3,
    race: 1.5,
};
export const brakePressureTunable = (brakes: BrakeKit) =>
    brakes === 'sport' || brakes === 'race';

const RIDE_METERS = 0.03;
const INDUCTIONS: Induction[] = ['stock', 'na', 'twin', 'quad', 'super'];
const EXHAUSTS: Exhaust[] = ['stock', 'sport', 'straight'];
// junk falls back to the middle of the range, which is stock for every setting
const clamp = (value: number, min: number, max: number) =>
    Number.isFinite(value)
        ? Math.min(max, Math.max(min, value))
        : (min + max) / 2;
const isHex = (value: unknown) =>
    typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

export const rideOffsetMeters = (look: CarLook) =>
    clamp(look.ride, -1, 1) * RIDE_METERS;

export const sanitizeLook = (raw: unknown): CarLook => {
    const source = (
        raw && typeof raw === 'object' ? raw : {}
    ) as Partial<CarLook>;
    return {
        paint: isHex(source.paint)
            ? (source.paint as string).toLowerCase()
            : null,
        finish: (
            ['stock', 'gloss', 'metallic', 'pearl', 'matte', 'chrome'] as const
        ).includes(source.finish as PaintFinish)
            ? (source.finish as PaintFinish)
            : 'stock',
        rims: isHex(source.rims) ? (source.rims as string).toLowerCase() : null,
        calipers: isHex(source.calipers)
            ? (source.calipers as string).toLowerCase()
            : null,
        wheels:
            typeof source.wheels === 'string' &&
            /^[a-z0-9-]{1,40}$/.test(source.wheels)
                ? source.wheels
                : 'stock',
        spoiler: (['none', 'ducktail', 'wing'] as const).includes(
            source.spoiler as Spoiler
        )
            ? (source.spoiler as Spoiler)
            : 'none',
        // in half steps
        wingAngle: Math.round(clamp(Number(source.wingAngle ?? 0), -1, 1) * 2) / 2,
        ride: clamp(Number(source.ride ?? 0), -1, 1),
    };
};

export const sanitizeTune = (raw: unknown): CarTune => {
    const source = (
        raw && typeof raw === 'object' ? raw : {}
    ) as Partial<CarTune>;
    const num = (
        value: unknown,
        fallback: number,
        [min, max]: readonly [number, number]
    ) => clamp(Number(value ?? fallback), min, max);
    const brakes = BRAKE_KITS.includes(source.brakes as BrakeKit)
        ? (source.brakes as BrakeKit)
        : 'stock';
    return {
        power: num(source.power, 1, LIMITS.power),
        tires: (['street', 'sport', 'semi', 'slick', 'drift'] as const).includes(
            source.tires as TireCompound
        )
            ? (source.tires as TireCompound)
            : 'sport',
        springsFront: num(source.springsFront, 0, LIMITS.springs),
        springsRear: num(source.springsRear, 0, LIMITS.springs),
        damping: num(source.damping, 0, LIMITS.damping),
        diff: num(source.diff, 0, LIMITS.diff),
        gearing: num(source.gearing, 0, LIMITS.gearing),
        brakeBias: num(source.brakeBias, STOCK_BRAKE_BIAS, LIMITS.brakeBias),
        brakes,
        // in tenths, and only on the kits that have the adjuster
        brakePressure: brakePressureTunable(brakes)
            ? Math.round(
                  num(source.brakePressure, 1, LIMITS.brakePressure) * 10
              ) / 10
            : 1,
        speedLimiter: source.speedLimiter !== false,
        angleKit: source.angleKit === true,
        engine:
            typeof source.engine === 'string' && ENGINE_IDS.includes(source.engine)
                ? source.engine
                : 'stock',
        induction: INDUCTIONS.includes(source.induction as Induction)
            ? (source.induction as Induction)
            : 'stock',
        exhaust: EXHAUSTS.includes(source.exhaust as Exhaust)
            ? (source.exhaust as Exhaust)
            : 'stock',
        weight: WEIGHTS.includes(source.weight as WeightReduction)
            ? (source.weight as WeightReduction)
            : 'stock',
        drivetrain: DRIVETRAINS.includes(source.drivetrain as Drivetrain)
            ? (source.drivetrain as Drivetrain)
            : 'stock',
    };
};

// the tune on top of the car's stock spec. a stock tune and look return the
// spec unchanged, so stock cars drive exactly as before
export const applyTune = (
    stock: PhysicsSpec,
    tune: CarTune,
    look: CarLook,
    carId = ''
): PhysicsSpec => {
    if (isStockSetup(tune, look)) return stock;
    const spec = applyEngine(stock, carId, tune);
    const tires = TIRES[tune.tires];
    const aero = aeroOf(look);
    const stiffness = (tune.springsFront + tune.springsRear) / 2;
    const clA = spec.clA + aero.cl;
    const power = tune.power;
    const swap = swapOf(spec.drive, tune.drivetrain);
    const mass =
        WEIGHT_MASS[tune.weight] *
        (swap === 'awd' ? AWD_MASS : swap === 'rwd' ? RWD_MASS : 1);
    return {
        ...spec,
        // less mass, and less of it out at the ends to swing
        massKg: spec.massKg * mass,
        yawInertia: spec.yawInertia * mass,
        weightFront: Math.min(
            0.7,
            Math.max(
                0.3,
                spec.weightFront + (swap === 'awd' ? 0.01 : swap === 'rwd' ? -0.01 : 0)
            )
        ),
        drive: swap === 'awd' ? 'AWD' : swap === 'rwd' ? 'RWD' : spec.drive,
        frontTorqueShare:
            swap === 'awd'
                ? AWD_FRONT_SHARE
                : swap === 'rwd'
                  ? 0
                  : spec.frontTorqueShare,
        // the map scales the whole curve. the top speed follows from the
        // physics: the limiter holds it, or drag, or the revs in top gear
        powerW: spec.powerW * power,
        torqueNm: spec.torqueNm * power,
        torqueTable: spec.torqueTable.map((torque) => torque * power),
        speedLimit: tune.speedLimiter ? spec.speedLimit : Infinity,
        tireGrip: spec.tireGrip * tires.grip,
        tireGripRear: spec.tireGripRear * tires.rear,
        slipAnglePeak: spec.slipAnglePeak + tires.peak,
        tireShape: spec.tireShape + tires.shape,
        // stiffer front than rear takes more of the roll up front (understeer)
        rollShareFront: clamp(
            spec.rollShareFront +
                0.035 * (tune.springsFront - tune.springsRear),
            0.38,
            0.72
        ),
        // stiffer springs and dampers move the weight over sooner
        loadFilterTime:
            spec.loadFilterTime *
            (1 - 0.25 * stiffness) *
            (1 - 0.3 * tune.damping),
        lsdLock: spec.lsdLock * Math.pow(2, tune.diff),
        finalDrive: spec.finalDrive * (1 + 0.1 * tune.gearing),
        brakeBias: tune.brakeBias,
        brakeTorque:
            spec.brakeTorque * BRAKE_TORQUE[tune.brakes] * tune.brakePressure,
        brakeKit: BRAKE_TORQUE[tune.brakes] * tune.brakePressure,
        maxSteer: tune.angleKit
            ? Math.max(spec.maxSteer, ANGLE_KIT_LOCK)
            : spec.maxSteer,
        // lower sits the weight lower
        cgHeight: Math.max(0.3, spec.cgHeight + rideOffsetMeters(look) * 0.8),
        clA,
        // the wing's downforce is all at the back
        aeroFront: clA > 0 ? (spec.aeroFront * spec.clA) / clA : spec.aeroFront,
        cdA: spec.cdA + aero.cd,
    };
};

export const isStockTune = (tune: CarTune) =>
    tune.power === 1 &&
    tune.tires === 'sport' &&
    tune.springsFront === 0 &&
    tune.springsRear === 0 &&
    tune.damping === 0 &&
    tune.diff === 0 &&
    tune.gearing === 0 &&
    Math.abs(tune.brakeBias - STOCK_BRAKE_BIAS) < 1e-6 &&
    tune.brakes === 'stock' &&
    tune.brakePressure === 1 &&
    tune.speedLimiter &&
    !tune.angleKit &&
    tune.weight === 'stock' &&
    tune.drivetrain === 'stock' &&
    isStockEngine(tune);

// what changes the physics: the tune, aero and ride height. paint and wheels
// are only looks
export const isStockSetup = (tune: CarTune, look: CarLook) =>
    isStockTune(tune) && look.spoiler === 'none' && look.ride === 0;

// a short code for the tuned board, one base 36 digit per setting. a removed
// speed limiter adds a digit at the end and an angle kit an 'a', so older
// codes keep their meaning. the brake pressure rides in the tire digit, and
// the brake kit and weight reduction in the spoiler one, all 0 when stock,
// which keeps the code inside the board's 16 characters. a drivetrain swap or
// a wing off its middle angle needs more: then a y and two digits hold the
// limiter, the angle kit, the swap and the wing, and an engine swap is a z
// and two digits. setups without those still write the old codes
export const tuneCode = (tune: CarTune, look: CarLook) => {
    const q = (value: number, min: number, max: number) =>
        Math.round(
            ((clamp(value, min, max) - min) / (max - min)) * 35
        ).toString(36);
    // tenths off stock as 0, 1, 2.. for 1, 0.9, 1.1, 0.8, 1.2, 0.7, 1.3
    const step = Math.round((tune.brakePressure - 1) * 10);
    const pressure = step >= 0 ? step * 2 : -step * 2 - 1;
    const base = [
        q(tune.power, ...LIMITS.power),
        (
            ['street', 'sport', 'semi', 'slick', 'drift'].indexOf(tune.tires) +
            5 * pressure
        ).toString(36),
        q(tune.springsFront, ...LIMITS.springs),
        q(tune.springsRear, ...LIMITS.springs),
        q(tune.damping, ...LIMITS.damping),
        q(tune.diff, ...LIMITS.diff),
        q(tune.gearing, ...LIMITS.gearing),
        q(tune.brakeBias, ...LIMITS.brakeBias),
        q(look.ride, ...LIMITS.ride),
        (
            ['none', 'ducktail', 'wing'].indexOf(look.spoiler) +
            3 * BRAKE_KITS.indexOf(tune.brakes) +
            12 * WEIGHTS.indexOf(tune.weight)
        ).toString(36),
    ].join('');
    const engine = ENGINE_IDS.indexOf(tune.engine) + 1;
    const induction = INDUCTIONS.indexOf(tune.induction);
    const exhaust = EXHAUSTS.indexOf(tune.exhaust);
    // the wing's angle in half steps, 2 is the middle
    const wing = look.spoiler === 'wing' ? Math.round(look.wingAngle * 2) + 2 : 2;
    const drivetrain = DRIVETRAINS.indexOf(tune.drivetrain);
    if (!drivetrain && wing === 2) {
        return [
            base,
            tune.speedLimiter ? '' : '1',
            tune.angleKit ? 'a' : '',
            // an x and one digit each for the engine, induction and exhaust
            isStockEngine(tune)
                ? ''
                : `x${engine.toString(36)}${induction.toString(36)}${exhaust.toString(36)}`,
        ].join('');
    }
    const flags =
        (tune.speedLimiter ? 0 : 1) +
        2 * (tune.angleKit ? 1 : 0) +
        4 * drivetrain +
        12 * wing;
    return [
        base,
        `y${flags.toString(36).padStart(2, '0')}`,
        isStockEngine(tune)
            ? ''
            : `z${engine.toString(36)}${(induction + 5 * exhaust).toString(36)}`,
    ].join('');
};

// a board code back to its setup, null when it doesn't read. every setting
// sits on its garage slider's step, which takes the code's rounding back out
export const decodeTune = (
    code: string
): { tune: CarTune; ride: number; spoiler: Spoiler; wingAngle: number } | null => {
    const match =
        /^([0-9a-z]{10})(?:(1?)(a?)(?:x([0-9a-z]{3}))?|y([0-9a-z]{2})(?:z([0-9a-z]{2}))?)$/.exec(
            String(code || '')
        );
    if (!match) return null;
    const [, base, limiter, angle, engine, extra, shortEngine] = match;
    const d = [...base].map((digit) => parseInt(digit, 36));
    const at = (
        digit: number,
        [min, max]: readonly [number, number],
        step: number
    ) =>
        Number(
            (
                Math.round((min + (digit / 35) * (max - min)) / step) * step
            ).toFixed(2)
        );
    const zigzag = Math.floor(d[1] / 5);
    const flags = extra ? parseInt(extra, 36) : -1;
    const wing = flags >= 0 ? Math.floor(flags / 12) : 2;
    if (wing > 4) return null;
    let swap: number[] = [];
    if (engine) swap = [...engine].map((digit) => parseInt(digit, 36));
    if (shortEngine) {
        const [id, rest] = [...shortEngine].map((digit) => parseInt(digit, 36));
        swap = [id, rest % 5, Math.floor(rest / 5)];
    }
    const tune = sanitizeTune({
        power: at(d[0], LIMITS.power, 0.01),
        tires: (['street', 'sport', 'semi', 'slick', 'drift'] as const)[d[1] % 5],
        springsFront: at(d[2], LIMITS.springs, 0.1),
        springsRear: at(d[3], LIMITS.springs, 0.1),
        damping: at(d[4], LIMITS.damping, 0.1),
        diff: at(d[5], LIMITS.diff, 0.1),
        gearing: at(d[6], LIMITS.gearing, 0.1),
        brakeBias: at(d[7], LIMITS.brakeBias, 0.01),
        brakes: BRAKE_KITS[Math.floor(d[9] / 3) % 4],
        brakePressure:
            1 + (zigzag % 2 ? -(zigzag + 1) / 2 : zigzag / 2) / 10,
        speedLimiter: flags >= 0 ? flags % 2 === 0 : !limiter,
        angleKit: flags >= 0 ? Math.floor(flags / 2) % 2 === 1 : Boolean(angle),
        engine: swap.length ? ENGINE_IDS[swap[0] - 1] || 'stock' : 'stock',
        induction: swap.length ? INDUCTIONS[swap[1]] : 'stock',
        exhaust: swap.length ? EXHAUSTS[swap[2]] : 'stock',
        weight: WEIGHTS[Math.floor(d[9] / 12)],
        drivetrain: flags >= 0 ? DRIVETRAINS[Math.floor(flags / 4) % 3] : 'stock',
    });
    const spoiler = (['none', 'ducktail', 'wing'] as const)[d[9] % 3];
    return {
        tune,
        ride: at(d[8], LIMITS.ride, 0.1),
        spoiler,
        wingAngle: spoiler === 'wing' ? (wing - 2) / 2 : 0,
    };
};

const LOOK_KEY = 'yassinverse:garageLook:';
const TUNE_KEY = 'yassinverse:garageTune:';

const read = (key: string) => {
    try {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
};

let persistAsked = false;
const write = (key: string, value: unknown) => {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
        // a saved setup asks the browser to keep the site's storage when it
        // clears space (safari can drop it after a week without a visit)
        if (!persistAsked) {
            persistAsked = true;
            void navigator.storage?.persist?.().catch(() => undefined);
        }
    } catch {
        // storage full or blocked
    }
};

export const loadLook = (carId: string) => sanitizeLook(read(LOOK_KEY + carId));
// what the homepage car can only wear off the race's prepared model
export const needsRaceModel = (look: CarLook) =>
    look.wheels !== 'stock' || look.spoiler !== 'none' || look.ride !== 0 || Boolean(look.rims);
export const loadTune = (carId: string) => sanitizeTune(read(TUNE_KEY + carId));
export const saveLook = (carId: string, look: CarLook) =>
    write(LOOK_KEY + carId, look);
export const saveTune = (carId: string, tune: CarTune) =>
    write(TUNE_KEY + carId, tune);

export const sameLook = (a: CarLook, b: CarLook) =>
    JSON.stringify(a) === JSON.stringify(b);

const FINISH_LIST: PaintFinish[] = [
    'stock',
    'gloss',
    'metallic',
    'pearl',
    'matte',
    'chrome',
];
const SPOILER_LIST: Spoiler[] = ['none', 'ducktail', 'wing'];

// the look in ~30 characters for telemetry:
// paint.finish.rims.calipers.wheels.spoiler.ride.wing (older clients stop at ride)
export const encodeLook = (look: CarLook) => {
    const fields: Array<string | number> = [
        look.paint ? look.paint.slice(1) : '',
        FINISH_LIST.indexOf(look.finish),
        look.rims ? look.rims.slice(1) : '',
        look.calipers ? look.calipers.slice(1) : '',
        look.wheels === 'stock' ? '' : look.wheels,
        SPOILER_LIST.indexOf(look.spoiler),
        Math.round(look.ride * 10),
    ];
    if (look.spoiler === 'wing' && look.wingAngle) fields.push(Math.round(look.wingAngle * 2));
    return fields.join('.');
};

export const decodeLook = (code: string): CarLook => {
    const [paint, finish, rims, calipers, wheels, spoiler, ride, wing] = String(
        code || ''
    )
        .slice(0, 80)
        .split('.');
    return sanitizeLook({
        paint: paint ? `#${paint}` : null,
        finish: FINISH_LIST[Number(finish)] || 'stock',
        rims: rims ? `#${rims}` : null,
        calipers: calipers ? `#${calipers}` : null,
        wheels: wheels || 'stock',
        spoiler: SPOILER_LIST[Number(spoiler)] || 'none',
        wingAngle: Number(wing) / 2 || 0,
        ride: Number(ride) / 10 || 0,
    });
};
