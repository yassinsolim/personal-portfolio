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

export type CarLook = {
    // hex like #1f4fa8, null keeps the factory color
    paint: string | null;
    finish: PaintFinish;
    rims: string | null;
    calipers: string | null;
    // 'stock' or the id of the car whose rims these are
    wheels: string;
    spoiler: Spoiler;
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
    // false takes the electronic top speed limiter out
    speedLimiter: boolean;
    // angle kit: more steering lock, for countersteering big slides
    angleKit: boolean;
    // 'stock' or an engine from engines.ts, and what feeds and follows it
    engine: string;
    induction: Induction;
    exhaust: Exhaust;
};

export const STOCK_LOOK: CarLook = {
    paint: null,
    finish: 'stock',
    rims: null,
    calipers: null,
    wheels: 'stock',
    spoiler: 'none',
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
    speedLimiter: true,
    angleKit: false,
    engine: 'stock',
    induction: 'stock',
    exhaust: 'stock',
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
    ride: [-1, 1],
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
    const aero = AERO[look.spoiler];
    const stiffness = (tune.springsFront + tune.springsRear) / 2;
    const clA = spec.clA + aero.cl;
    const power = tune.power;
    return {
        ...spec,
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
    tune.speedLimiter &&
    !tune.angleKit &&
    isStockEngine(tune);

// what changes the physics: the tune, aero and ride height. paint and wheels
// are only looks
export const isStockSetup = (tune: CarTune, look: CarLook) =>
    isStockTune(tune) && look.spoiler === 'none' && look.ride === 0;

// a short code for the tuned board, one base 36 digit per setting. a removed
// speed limiter adds a digit at the end and an angle kit an 'a', so older
// codes keep their meaning
export const tuneCode = (tune: CarTune, look: CarLook) => {
    const q = (value: number, min: number, max: number) =>
        Math.round(
            ((clamp(value, min, max) - min) / (max - min)) * 35
        ).toString(36);
    return [
        q(tune.power, ...LIMITS.power),
        ['street', 'sport', 'semi', 'slick', 'drift']
            .indexOf(tune.tires)
            .toString(36),
        q(tune.springsFront, ...LIMITS.springs),
        q(tune.springsRear, ...LIMITS.springs),
        q(tune.damping, ...LIMITS.damping),
        q(tune.diff, ...LIMITS.diff),
        q(tune.gearing, ...LIMITS.gearing),
        q(tune.brakeBias, ...LIMITS.brakeBias),
        q(look.ride, ...LIMITS.ride),
        ['none', 'ducktail', 'wing'].indexOf(look.spoiler).toString(36),
        tune.speedLimiter ? '' : '1',
        tune.angleKit ? 'a' : '',
        // an x and one digit each for the engine, induction and exhaust
        isStockEngine(tune)
            ? ''
            : `x${(ENGINE_IDS.indexOf(tune.engine) + 1).toString(36)}${INDUCTIONS.indexOf(
                  tune.induction
              ).toString(36)}${EXHAUSTS.indexOf(tune.exhaust).toString(36)}`,
    ].join('');
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

// the look in ~30 characters for telemetry: paint.finish.rims.calipers.wheels.spoiler.ride
export const encodeLook = (look: CarLook) =>
    [
        look.paint ? look.paint.slice(1) : '',
        FINISH_LIST.indexOf(look.finish),
        look.rims ? look.rims.slice(1) : '',
        look.calipers ? look.calipers.slice(1) : '',
        look.wheels === 'stock' ? '' : look.wheels,
        SPOILER_LIST.indexOf(look.spoiler),
        Math.round(look.ride * 10),
    ].join('.');

export const decodeLook = (code: string): CarLook => {
    const [paint, finish, rims, calipers, wheels, spoiler, ride] = String(
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
        ride: Number(ride) / 10 || 0,
    });
};
