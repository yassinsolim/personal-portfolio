// the garage's engine bay: swaps between the engines of the game's cars and
// the supercar engines, forced induction and the exhaust. an engine brings
// its own recorded sound bank (static/sounds/race/<sound>.json) and torque
// curve; the car keeps its gearbox, so the shift points move with the revs
import { carOptionsById } from '../../carOptions';
import { sampleTorqueCurve } from '../Vehicle/carPhysics';
import type { PhysicsSpec } from '../Vehicle/VehiclePhysics';

export type Induction = 'stock' | 'na' | 'twin' | 'quad' | 'super';
export type Exhaust = 'stock' | 'sport' | 'straight';

export type EngineDef = {
    label: string;
    detail: string;
    sound: string;
    // comes with turbos (or a turbo) from the factory
    turbo: boolean;
    massKg: number;
    // the car it comes in, whose curve, idle and redline it brings
    car: string;
};

// the hybrids are the whole package, engine and motors together
export const ENGINES: Record<string, EngineDef> = {
    s65: { label: 'BMW S65 V8', detail: '4.0 L V8, 8,400 rpm', sound: 'bmw-e92-m3', turbo: false, massKg: 202, car: 'bmw-e92-m3' },
    s55: { label: 'BMW S55 inline six', detail: '3.0 L twin turbo', sound: 'bmw-f82-m4', turbo: true, massKg: 190, car: 'bmw-f82-m4' },
    s63: { label: 'BMW S63 V8', detail: '4.4 L twin turbo', sound: 'bmw-f90-m5-competition', turbo: true, massKg: 229, car: 'bmw-f90-m5-competition' },
    m156: { label: 'AMG M156 V8', detail: '6.2 L, naturally aspirated', sound: 'amg-c63-507', turbo: false, massKg: 199, car: 'amg-c63-507' },
    m177: { label: 'AMG M177 V8', detail: '4.0 L twin turbo', sound: 'amg-c63s-coupe', turbo: true, massKg: 209, car: 'amg-c63s-coupe' },
    pu106: { label: 'AMG One F1 V6', detail: '1.6 L turbo hybrid, 11,000 rpm', sound: 'amg-one', turbo: true, massKg: 260, car: 'amg-one' },
    t24a: { label: 'Toyota T24A four', detail: '2.4 L turbo hybrid', sound: 'toyota-crown-platinum', turbo: true, massKg: 160, car: 'toyota-crown-platinum' },
    v10: { label: 'Lamborghini V10', detail: '5.2 L, naturally aspirated, 8,500 rpm', sound: 'lamborghini-huracan', turbo: false, massKg: 220, car: 'lamborghini-huracan' },
    l539: { label: 'Lamborghini V12', detail: '6.5 L, naturally aspirated, 8,500 rpm', sound: 'lamborghini-aventador-s', turbo: false, massKg: 235, car: 'lamborghini-aventador-s' },
    f140: { label: 'Ferrari V12 hybrid', detail: '6.3 L V12 with HY-KERS, 9,250 rpm', sound: 'ferrari-laferrari', turbo: false, massKg: 245, car: 'ferrari-laferrari' },
    m838: { label: 'McLaren V8 hybrid', detail: '3.8 L twin turbo flat-plane with IPAS', sound: 'mclaren-p1', turbo: true, massKg: 230, car: 'mclaren-p1' },
    v918: { label: 'Porsche 918 V8 hybrid', detail: '4.6 L flat-plane with two motors, 9,150 rpm', sound: 'porsche-918-spyder', turbo: false, massKg: 250, car: 'porsche-918-spyder' },
    w16: { label: 'Bugatti W16', detail: '8.0 L, four turbos, 1,600 PS', sound: 'bugatti-chiron-super-sport', turbo: true, massKg: 420, car: 'bugatti-chiron-super-sport' },
    kv8: { label: 'Koenigsegg V8', detail: '5.0 L twin turbo flat-plane, 1,600 hp on E85', sound: 'koenigsegg-jesko', turbo: true, massKg: 200, car: 'koenigsegg-jesko' },
    m158: { label: 'AMG M158 V12', detail: '6.0 L twin turbo, built for Pagani', sound: 'pagani-huayra', turbo: true, massKg: 260, car: 'pagani-huayra' },
    m840: { label: 'McLaren M840TR V8', detail: '4.0 L twin turbo flat-plane', sound: 'mclaren-senna', turbo: true, massKg: 200, car: 'mclaren-senna' },
    f154: { label: 'Ferrari V8 hybrid', detail: '4.0 L twin turbo flat-plane with three motors', sound: 'ferrari-sf90-stradale', turbo: true, massKg: 300, car: 'ferrari-sf90-stradale' },
    cv12: { label: 'Cosworth V12 hybrid', detail: '6.5 L, naturally aspirated, 11,100 rpm', sound: 'aston-martin-valkyrie', turbo: false, massKg: 240, car: 'aston-martin-valkyrie' },
};

export const ENGINE_IDS = Object.keys(ENGINES);

// what each car has from the factory
export const STOCK_ENGINE: Record<string, string> = {
    'amg-one': 'pu106',
    'bmw-e92-m3': 's65',
    'amg-c63-507': 'm156',
    'amg-c63s-coupe': 'm177',
    'bmw-f82-m4': 's55',
    'bmw-f90-m5-competition': 's63',
    'bmw-m8-competition-coupe': 's63',
    'mercedes-gt63s-edition-one': 'm177',
    'toyota-crown-platinum': 't24a',
    'ferrari-laferrari': 'f140',
    'mclaren-p1': 'm838',
    'porsche-918-spyder': 'v918',
    'lamborghini-aventador-s': 'l539',
    'lamborghini-huracan': 'v10',
    'bugatti-chiron-super-sport': 'w16',
    'koenigsegg-jesko': 'kv8',
    'pagani-huayra': 'm158',
    'mclaren-senna': 'm840',
    'ferrari-sf90-stradale': 'f154',
    'aston-martin-valkyrie': 'cv12',
};

const engineOf = (carId: string, engine: string) =>
    engine !== 'stock' && ENGINES[engine] ? engine : STOCK_ENGINE[carId] || 's65';

const shapeOf = (def: EngineDef) => {
    const race = carOptionsById[def.car]?.race;
    return {
        curve: race?.physics.torqueCurve || [],
        idleRpm: race?.idleRpm || 800,
        redlineRpm: race?.redlineRpm || 7000,
    };
};

const smooth = (a: number, b: number, v: number) => {
    const t = Math.min(1, Math.max(0, (v - a) / Math.max(1e-6, b - a)));
    return t * t * (3 - 2 * t);
};

// extra torque at full boost, where it builds (shares of the redline) and
// how long the turbos take to spool. an engine that already has turbos only
// takes the gain on top of its own curve
const BOOST: Record<Exclude<Induction, 'stock' | 'na'>, { na: number; turbo: number; spool: [number, number]; time: number }> = {
    twin: { na: 0.42, turbo: 0, spool: [0.3, 0.5], time: 0.45 },
    quad: { na: 0.8, turbo: 0.3, spool: [0.4, 0.62], time: 0.8 },
    super: { na: 0.3, turbo: 0.12, spool: [0.05, 0.3], time: 0.05 },
};
// a turbo engine with its turbos taken off
const DETURBO = 0.68;
const EXHAUST_POWER: Record<Exhaust, number> = { stock: 1, sport: 1.02, straight: 1.04 };

export type EngineTune = { engine: string; induction: Induction; exhaust: Exhaust };

export const isStockEngine = (tune: EngineTune) =>
    tune.engine === 'stock' && tune.induction === 'stock' && tune.exhaust === 'stock';

// the engine choices on top of a car's stock spec
export const applyEngine = (spec: PhysicsSpec, carId: string, tune: EngineTune): PhysicsSpec => {
    if (isStockEngine(tune)) return spec;
    const stockId = STOCK_ENGINE[carId];
    const id = engineOf(carId, tune.engine);
    const def = ENGINES[id];
    let out = spec;
    if (id !== stockId && def) {
        const shape = shapeOf(def);
        const table = sampleTorqueCurve(shape.curve, shape.redlineRpm * 1.05);
        let torqueNm = 0;
        let torqueRpm = 0;
        let powerW = 0;
        let powerRpm = 0;
        shape.curve.forEach(([rpm, nm]) => {
            if (nm > torqueNm) [torqueNm, torqueRpm] = [nm, rpm];
            const w = (nm * rpm * Math.PI) / 30;
            if (w > powerW) [powerW, powerRpm] = [w, rpm];
        });
        const stockMass = ENGINES[stockId]?.massKg ?? def.massKg;
        const massKg = spec.massKg + def.massKg - stockMass;
        const revs = shape.redlineRpm / spec.redlineRpm;
        out = {
            ...spec,
            massKg,
            yawInertia: (spec.yawInertia * massKg) / spec.massKg,
            powerW,
            powerRpm,
            torqueNm,
            torqueRpm,
            torqueTable: table,
            idleRpm: shape.idleRpm,
            redlineRpm: shape.redlineRpm,
            shiftUpRpm: shape.redlineRpm - (spec.redlineRpm - spec.shiftUpRpm),
            shiftDownRpm: spec.shiftDownRpm * revs,
            launchRpm: Math.min(shape.redlineRpm * 0.7, spec.launchRpm * revs),
        };
    }
    const turbo = def?.turbo ?? false;
    let scale = EXHAUST_POWER[tune.exhaust];
    let boost: PhysicsSpec['boost'];
    if (tune.induction === 'na' && turbo) scale *= DETURBO;
    if (tune.induction === 'twin' || tune.induction === 'quad' || tune.induction === 'super') {
        const b = BOOST[tune.induction];
        const gain = turbo ? b.turbo : b.na;
        if (gain > 0) {
            boost = {
                gain,
                spoolStart: b.spool[0] * out.redlineRpm,
                spoolFull: b.spool[1] * out.redlineRpm,
                time: b.time,
            };
        }
    }
    if (scale === 1 && !boost) return out;
    // the published peaks follow the full boost curve
    let torqueNm = 0;
    let powerW = 0;
    out.torqueTable.forEach((nm, i) => {
        const rpm = i * out.torqueStep;
        if (rpm < out.idleRpm || rpm > out.redlineRpm) return;
        const full = nm * scale * (1 + (boost ? boost.gain * smooth(boost.spoolStart, boost.spoolFull, rpm) : 0));
        torqueNm = Math.max(torqueNm, full);
        powerW = Math.max(powerW, (full * rpm * Math.PI) / 30);
    });
    return {
        ...out,
        torqueTable: out.torqueTable.map((nm) => nm * scale),
        torqueNm,
        powerW,
        boost,
    };
};

// what the race audio plays for a car with this tune
export type EngineSound = {
    sound: string;
    idleRpm: number;
    redlineRpm: number;
    // 'stock' keeps the bank's own turbo, 'none' takes it out
    turbo: 'stock' | 'none' | 'twin' | 'quad';
    supercharger: boolean;
    exhaust: Exhaust;
};

export const engineSound = (carId: string, tune: EngineTune): EngineSound => {
    const id = engineOf(carId, tune.engine);
    const def = ENGINES[id];
    const shape = def ? shapeOf(def) : { idleRpm: 800, redlineRpm: 7000 };
    const turbo = def?.turbo ?? false;
    const swapped = id !== STOCK_ENGINE[carId];
    let mode: EngineSound['turbo'] = 'stock';
    if (tune.induction === 'na' && turbo) mode = 'none';
    else if (tune.induction === 'twin' && !turbo) mode = 'twin';
    else if (tune.induction === 'quad') mode = 'quad';
    return {
        sound: def?.sound || carId,
        idleRpm: swapped ? shape.idleRpm : carOptionsById[carId]?.race.idleRpm || shape.idleRpm,
        redlineRpm: swapped ? shape.redlineRpm : carOptionsById[carId]?.race.redlineRpm || shape.redlineRpm,
        turbo: mode,
        supercharger: tune.induction === 'super',
        exhaust: tune.exhaust,
    };
};
