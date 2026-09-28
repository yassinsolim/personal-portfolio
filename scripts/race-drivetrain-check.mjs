// drivetrain check: full throttle runs with the game's real driving model
// (VehiclePhysics, carPhysics, the garage tune) for every car, stock and with
// a few tunes, printed next to the published figures. exits 1 when something
// is outside the tolerances below.
//
//   node scripts/race-drivetrain-check.mjs
//   node scripts/race-drivetrain-check.mjs --cars bmw-e92-m3,amg-one --json out.json
//
// runs on a flat road at the game's 60 hz step, standard assists (traction
// control on, like a launch control start), auto gears for the sprints and
// manual shifts at the limiter for the per gear speeds. wheelbase and track
// come from race-car-geometry.json, measured from the models the way
// RaceVehicle does it, so the numbers match the in-browser harness.
import './lib/ts-hooks.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REFERENCE } from './race-drivetrain-reference.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (file) => path.join(here, '../src/Application', file);

const { default: VehiclePhysics, predictTopSpeed, rpmAtSpeed } = await import(
    src('Racing/Vehicle/VehiclePhysics.ts')
);
const { buildPhysicsSpec, carRollingRadius } = await import(
    src('Racing/Vehicle/carPhysics.ts')
);
const { rollingRadius } = await import(src('Racing/Vehicle/tyres.ts'));
const { carOptionsById } = await import(src('carOptions.ts'));
const { applyTune, STOCK_TUNE, STOCK_LOOK } = await import(
    src('Racing/Garage/garage.ts')
);
const { ASSIST_PRESETS } = await import(src('Racing/Vehicle/assists.ts'));

const GEOMETRY = JSON.parse(
    fs.readFileSync(path.join(here, 'race-car-geometry.json'), 'utf8')
);

// tolerances, see docs/cars-drivetrain.md
export const TOLERANCE = {
    // time to a speed against the maker's claim, and against a road test
    timeMfr: 0.1,
    timeTest: 0.12,
    // top speed against the published figure
    topSpeed: 0.015,
    // revs at 100 km/h in top gear against the published ratios and tyre
    cruiseRpm: 0.01,
    // speed of the driven wheels at the limiter in each gear
    gearWheel: 0.015,
    // road speed at the limiter in each gear: below the wheels by the
    // wheelspin in the low gears, never above
    gearRoadLow: 0.08,
    gearRoadHigh: 0.015,
    // top speed with the limiter out against the drag and revs prediction
    unlimited: 0.02,
    // a tune's revs and gear speeds against the stock ones scaled by the
    // final drive change
    tuneScale: 0.015,
};

const DT = 1 / 60;
const FLAT = {
    grounded: true,
    slopeForward: 0,
    slopeLeft: 0,
    normalScale: 1,
    grip: [1, 1, 1, 1],
    drag: [0, 0, 0, 0],
};
const MPS = 1 / 3.6;

export const TUNES = {
    stock: { tune: {}, look: {} },
    shortFinal: { tune: { gearing: 1 }, look: {}, label: 'final drive +10%' },
    longFinal: { tune: { gearing: -1 }, look: {}, label: 'final drive -10%' },
    power: { tune: { power: 1.15 }, look: {}, label: 'engine map 115%' },
    unlimited: { tune: { speedLimiter: false }, look: {}, label: 'no limiter' },
    unlimitedPower: {
        tune: { speedLimiter: false, power: 1.15 },
        look: {},
        label: 'no limiter, 115%',
    },
    unlimitedWing: {
        tune: { speedLimiter: false },
        look: { spoiler: 'wing' },
        label: 'no limiter, GT wing',
    },
};

const makeCar = (id, setup = TUNES.stock) => {
    const option = carOptionsById[id];
    const g = GEOMETRY[id];
    const geometry = {
        wheelbase: g.wheelbase,
        trackFront: g.trackFront,
        trackRear: g.trackRear,
        wheelRadius: g.modelWheelRadius,
    };
    const spec = applyTune(
        buildPhysicsSpec(option, geometry),
        { ...STOCK_TUNE, ...setup.tune },
        { ...STOCK_LOOK, ...setup.look }
    );
    const car = new VehiclePhysics(spec);
    Object.assign(car.assists, ASSIST_PRESETS.standard, { autoGears: true });
    car.reset(0, 0);
    return car;
};

const controls = () => ({ throttle: 0, brake: 0, handbrake: 0, steer: 0 });

const drivenWheelSpeed = (car) => {
    const { spec } = car;
    const front =
        spec.drive === 'FWD' ? 1 : spec.drive === 'AWD' ? spec.frontTorqueShare : 0;
    const w = car.wheelOmega;
    return (
        (front * (w[0] + w[1]) * 0.5 + (1 - front) * (w[2] + w[3]) * 0.5) *
        spec.wheelRadius
    );
};

// full throttle from rest with the automatic gearbox: times to speeds, the
// top speed, and where it shifted
const sprint = (car, seconds, marks) => {
    const input = controls();
    for (let i = 0; i < 30; i++) car.step(DT, input, FLAT, 0);
    input.throttle = 1;
    const times = {};
    let t = 0;
    let top = 0;
    let maxRpm = 0;
    let overLimiter = 0;
    for (let i = 0; i < seconds * 60; i++) {
        car.step(DT, input, FLAT, 0);
        t += DT;
        const kph = car.getSpeed() * 3.6;
        top = Math.max(top, kph);
        maxRpm = Math.max(maxRpm, car.engineRpm);
        if (car.engineRpm > car.spec.redlineRpm * 1.021) overLimiter++;
        for (const mark of marks) {
            if (times[mark] === undefined && kph >= mark) times[mark] = t;
        }
    }
    return { times, topKph: top, maxRpm, overLimiter };
};

// full throttle in each gear until the limiter has cut for a moment, then a
// manual upshift. gears that can't reach the limiter (drag, the speed
// limiter) come back as not reached
const gearSpeeds = (car) => {
    car.assists.autoGears = false;
    const input = controls();
    for (let i = 0; i < 30; i++) car.step(DT, input, FLAT, 0);
    input.throttle = 1;
    const gears = car.spec.gearRatios.length;
    const out = [];
    let gear = 1;
    let limiterTime = 0;
    let road = 0;
    let wheel = 0;
    let stall = 0;
    let best = 0;
    for (let i = 0; i < 60 * 240 && gear <= gears; i++) {
        car.step(DT, input, FLAT, 0);
        if (car.shiftTimer > 0 || car.gear !== gear) continue;
        const speed = car.getSpeed();
        road = Math.max(road, speed);
        wheel = Math.max(wheel, drivenWheelSpeed(car));
        if (car.limiterActive) limiterTime += DT;
        if (speed > best + 0.05) {
            best = speed;
            stall = 0;
        } else {
            stall += DT;
        }
        const done = limiterTime > 0.25 || stall > 4;
        if (!done) continue;
        out.push({
            gear,
            reached: limiterTime > 0.25,
            roadKph: road * 3.6,
            wheelKph: wheel * 3.6,
        });
        gear++;
        limiterTime = 0;
        road = 0;
        wheel = 0;
        stall = 0;
        best = 0;
        if (gear <= gears) car.requestShift(1);
    }
    return out;
};

// holds 100 km/h in top gear on part throttle and reads the revs
const cruiseRpm = (car) => {
    const top = car.spec.gearRatios.length;
    const target = 100 * MPS;
    car.assists.autoGears = false;
    car.reset(0, target);
    car.gear = top;
    car.pendingGear = top;
    car.engineRpm = rpmAtSpeed(car.spec, target, top);
    const input = controls();
    let rpm = 0;
    let speed = 0;
    let n = 0;
    for (let i = 0; i < 60 * 8; i++) {
        input.throttle = Math.max(0, Math.min(1, 0.25 + (target - car.getSpeed()) * 0.8));
        car.step(DT, input, FLAT, 0);
        if (i > 60 * 5) {
            rpm += car.engineRpm;
            speed += car.getSpeed();
            n++;
        }
    }
    // scaled to exactly 100 km/h
    return (rpm / n) * (target / (speed / n));
};

const within = (value, expected, tolerance) =>
    Number.isFinite(value) &&
    Math.abs(value - expected) <= Math.abs(expected) * tolerance;

export const runDrivetrainChecks = ({ cars } = {}) => {
    const ids = cars || Object.keys(REFERENCE);
    const failures = [];
    const report = {};
    const fail = (id, what) => failures.push(`${id}: ${what}`);

    for (const id of ids) {
        const ref = REFERENCE[id];
        const option = carOptionsById[id];
        if (!ref || !option) {
            fail(id, 'no reference or car option');
            continue;
        }
        const race = option.race;
        const row = { id, stock: {}, tunes: {} };
        report[id] = row;

        // the game's data against the published figures
        const same = (a, b) => Math.abs(a - b) < 1e-9;
        if (ref.gearRatios.length !== race.gearRatios.length ||
            ref.gearRatios.some((r, i) => !same(r, race.gearRatios[i]))) {
            fail(id, `gear ratios ${race.gearRatios} are not the published ${ref.gearRatios}`);
        }
        if (!same(ref.finalDrive, race.finalDrive)) {
            fail(id, `final drive ${race.finalDrive} is not the published ${ref.finalDrive}`);
        }
        if (ref.redlineRpm !== null && ref.redlineRpm !== race.redlineRpm) {
            fail(id, `redline ${race.redlineRpm} is not the published ${ref.redlineRpm}`);
        }
        if (ref.idleRpm !== null && ref.idleRpm !== race.idleRpm) {
            fail(id, `idle ${race.idleRpm} is not the published ${ref.idleRpm}`);
        }
        if (ref.speedLimitKph !== race.speedLimitKph) {
            fail(id, `speed limiter ${race.speedLimitKph} is not ${ref.speedLimitKph}`);
        }
        const refRadius = rollingRadius(ref.tyreRear, ref.revsPerMile);
        const radius = carRollingRadius(option);
        if (Math.abs(refRadius - radius) > 1e-6) {
            fail(id, `rolling radius ${radius.toFixed(4)} m, the published tyre gives ${refRadius.toFixed(4)} m`);
        }

        // what the published data says the car does
        const limiter = race.redlineRpm;
        const realGear = ref.gearRatios.map(
            (g) => (limiter / 60) * 2 * Math.PI * refRadius / (g * ref.finalDrive) * 3.6
        );
        const realCruise =
            ((100 * MPS) / refRadius) *
            ref.gearRatios[ref.gearRatios.length - 1] *
            ref.finalDrive *
            (60 / (2 * Math.PI));
        row.real = {
            times: ref.times,
            topKph: ref.topSpeedKph,
            cruiseRpm: realCruise,
            gearKph: realGear,
        };

        // stock
        const marks = [100, 200, ...ref.times.map((m) => m.kph)];
        const stockSprint = sprint(makeCar(id), 90, marks);
        const stockGears = gearSpeeds(makeCar(id, TUNES.unlimited));
        const stockCruise = cruiseRpm(makeCar(id));
        row.stock = {
            times: stockSprint.times,
            topKph: stockSprint.topKph,
            cruiseRpm: stockCruise,
            gears: stockGears,
            maxRpm: stockSprint.maxRpm,
        };

        for (const mark of ref.times) {
            const sim = stockSprint.times[mark.kph];
            const tol = mark.kind === 'mfr' ? TOLERANCE.timeMfr : TOLERANCE.timeTest;
            if (!within(sim, mark.s, tol)) {
                fail(id, `0-${Math.round(mark.kph)} km/h ${sim?.toFixed(2)} s, ${mark.kind} ${mark.s} s (±${tol * 100}%)`);
            }
        }
        if (!within(stockSprint.topKph, ref.topSpeedKph, TOLERANCE.topSpeed)) {
            fail(id, `top speed ${stockSprint.topKph.toFixed(1)} km/h, published ${ref.topSpeedKph}`);
        }
        if (stockSprint.overLimiter > 0) {
            fail(id, `revs went past the limiter (${Math.round(stockSprint.maxRpm)} rpm)`);
        }
        if (!within(stockCruise, realCruise, TOLERANCE.cruiseRpm)) {
            fail(id, `${Math.round(stockCruise)} rpm at 100 km/h in top, published gearing gives ${Math.round(realCruise)}`);
        }
        for (const g of stockGears) {
            if (!g.reached) continue;
            const real = realGear[g.gear - 1];
            if (!within(g.wheelKph, real, TOLERANCE.gearWheel)) {
                fail(id, `gear ${g.gear} wheels ${g.wheelKph.toFixed(1)} km/h at the limiter, published gearing ${real.toFixed(1)}`);
            }
            if (g.roadKph > real * (1 + TOLERANCE.gearRoadHigh) ||
                g.roadKph < real * (1 - TOLERANCE.gearRoadLow)) {
                fail(id, `gear ${g.gear} ${g.roadKph.toFixed(1)} km/h at the limiter, published gearing ${real.toFixed(1)}`);
            }
        }
        if (!stockGears[0]?.reached) fail(id, 'never reached the limiter in first');

        // tunes
        for (const [name, setup] of Object.entries(TUNES)) {
            if (name === 'stock') continue;
            const car = makeCar(id, setup);
            const run = sprint(car, name.startsWith('unlimited') ? 150 : 90, [100, 200]);
            const predicted = predictTopSpeed(car.spec);
            const tuneRow = {
                label: setup.label,
                times: run.times,
                topKph: run.topKph,
                predictedKph: predicted.speed * 3.6,
                limitedBy: predicted.limitedBy,
                cruiseRpm: cruiseRpm(makeCar(id, setup)),
            };
            if (name === 'shortFinal' || name === 'longFinal') {
                tuneRow.gears = gearSpeeds(
                    makeCar(id, { tune: { ...setup.tune, speedLimiter: false }, look: {} })
                );
            }
            row.tunes[name] = tuneRow;
        }
        const tunes = row.tunes;
        for (const [name, factor] of [['shortFinal', 1.1], ['longFinal', 0.9]]) {
            const tune = tunes[name];
            if (!within(tune.cruiseRpm, stockCruise * factor, TOLERANCE.tuneScale)) {
                fail(id, `${tune.label}: ${Math.round(tune.cruiseRpm)} rpm at 100 km/h, stock ${Math.round(stockCruise)} x ${factor}`);
            }
            for (const g of tune.gears) {
                const stock = stockGears.find((s) => s.gear === g.gear);
                if (!g.reached || !stock?.reached) continue;
                if (!within(g.wheelKph, stock.wheelKph / factor, TOLERANCE.tuneScale)) {
                    fail(id, `${tune.label}: gear ${g.gear} ${g.wheelKph.toFixed(1)} km/h, stock ${stock.wheelKph.toFixed(1)} / ${factor}`);
                }
            }
        }
        if (!(tunes.power.times[200] < stockSprint.times[200] * 0.98)) {
            fail(id, `engine map 115% isn't quicker to 200 (${tunes.power.times[200]?.toFixed(2)} s vs ${stockSprint.times[200]?.toFixed(2)} s)`);
        }
        for (const name of ['unlimited', 'unlimitedPower', 'unlimitedWing']) {
            const tune = tunes[name];
            if (tune.limitedBy === 'limiter') {
                fail(id, `${tune.label}: still on the speed limiter`);
            }
            if (!within(tune.topKph, tune.predictedKph, TOLERANCE.unlimited)) {
                fail(id, `${tune.label}: top speed ${tune.topKph.toFixed(1)} km/h, drag and gearing predict ${tune.predictedKph.toFixed(1)}`);
            }
        }
        if (tunes.unlimited.topKph < stockSprint.topKph - 0.5) {
            fail(id, 'taking the limiter out lowered the top speed');
        }
        // power and drag only move the top speed when drag sets it, not
        // when the car runs into the rev limiter in top gear
        const topGearKph = realGear[realGear.length - 1];
        const dragLimited = (tune) =>
            tune.limitedBy === 'drag' && tune.predictedKph < topGearKph * 0.97;
        if (dragLimited(tunes.unlimited) &&
            !(tunes.unlimitedPower.topKph > tunes.unlimited.topKph + 1)) {
            fail(id, 'more power did not raise the drag limited top speed');
        }
        if (dragLimited(tunes.unlimited) &&
            !(tunes.unlimitedWing.topKph < tunes.unlimited.topKph - 1)) {
            fail(id, 'the wing did not lower the drag limited top speed');
        }
    }
    return { failures, report };
};

// ------------------------------------------------------------ printing

const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '-');
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '-');
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

const refTime = (ref, kph) => ref.times.find((m) => Math.abs(m.kph - kph) < 0.5);

export const formatReport = ({ report, failures }) => {
    const lines = [];
    lines.push('stock cars, simulated / published (times in s, speeds in km/h)');
    lines.push(
        [pad('car', 28), lpad('0-100', 13), lpad('0-200', 13), lpad('top', 13), lpad('rpm@100 top', 13), '  other reference times'].join(' ')
    );
    for (const row of Object.values(report)) {
        if (!row.real) continue;
        const ref = REFERENCE[row.id];
        const r100 = refTime(ref, 100);
        const r200 = refTime(ref, 200);
        const others = ref.times
            .filter((m) => m !== r100 && m !== r200)
            .map((m) => `0-${Math.round(m.kph)} ${f2(row.stock.times[m.kph])}/${m.s} ${m.kind}`)
            .join(', ');
        lines.push(
            [
                pad(row.id, 28),
                lpad(`${f2(row.stock.times[100])}/${r100 ? r100.s : '-'}`, 13),
                lpad(`${f2(row.stock.times[200])}/${r200 ? r200.s : '-'}`, 13),
                lpad(`${f1(row.stock.topKph)}/${row.real.topKph}`, 13),
                lpad(`${Math.round(row.stock.cruiseRpm)}/${Math.round(row.real.cruiseRpm)}`, 13),
                '  ' + others,
            ].join(' ')
        );
    }
    lines.push('');
    lines.push('max speed per gear at the limiter, road speed (driven wheels) / published gearing; - is not reached (drag)');
    for (const row of Object.values(report)) {
        if (!row.real) continue;
        const cells = row.real.gearKph.map((real, i) => {
            const g = row.stock.gears.find((x) => x.gear === i + 1);
            if (!g || !g.reached) return `${i + 1}: -/${real.toFixed(0)}`;
            return `${i + 1}: ${g.roadKph.toFixed(0)} (${g.wheelKph.toFixed(0)})/${real.toFixed(0)}`;
        });
        lines.push(`${pad(row.id, 28)} ${cells.join('  ')}`);
    }
    lines.push('');
    lines.push('tunes (top speed with the limiter out: simulated, and predicted from drag and gearing)');
    lines.push(
        [pad('car', 28), pad('tune', 20), lpad('0-100', 7), lpad('0-200', 7), lpad('top', 16), lpad('rpm@100', 8), '  gear speeds (driven wheels)'].join(' ')
    );
    for (const row of Object.values(report)) {
        if (!row.tunes) continue;
        lines.push(
            [pad(row.id, 28), pad('stock', 20), lpad(f2(row.stock.times[100]), 7), lpad(f2(row.stock.times[200]), 7), lpad(f1(row.stock.topKph), 16), lpad(Math.round(row.stock.cruiseRpm), 8), '  ' + row.stock.gears.map((g) => (g.reached ? g.wheelKph.toFixed(0) : '-')).join(' ')].join(' ')
        );
        for (const tune of Object.values(row.tunes)) {
            const top = tune.limitedBy === 'limiter'
                ? f1(tune.topKph)
                : `${f1(tune.topKph)} (${f1(tune.predictedKph)} ${tune.limitedBy})`;
            lines.push(
                [pad('', 28), pad(tune.label, 20), lpad(f2(tune.times[100]), 7), lpad(f2(tune.times[200]), 7), lpad(top, 16), lpad(Math.round(tune.cruiseRpm), 8), tune.gears ? '  ' + tune.gears.map((g) => (g.reached ? g.wheelKph.toFixed(0) : '-')).join(' ') : ''].join(' ')
            );
        }
    }
    lines.push('');
    if (failures.length) {
        lines.push(`${failures.length} outside tolerance:`);
        failures.forEach((failure) => lines.push(`  ${failure}`));
    } else {
        lines.push('all within tolerance');
    }
    return lines.join('\n');
};

const main = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (main) {
    const args = process.argv.slice(2);
    const opt = (name) => {
        const i = args.indexOf(`--${name}`);
        return i < 0 ? undefined : args[i + 1];
    };
    const cars = opt('cars')?.split(',');
    const result = runDrivetrainChecks({ cars });
    console.log(formatReport(result));
    const json = opt('json');
    if (json) fs.writeFileSync(json, JSON.stringify(result, null, 1));
    process.exitCode = result.failures.length ? 1 : 0;
}
