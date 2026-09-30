// drifting on the keyboard: a handbrake flick under the standard assists
// starts a slide that taps on the throttle key hold, lifting ends it, and the
// drift build's parts reach the driving model. flat asphalt, the plain
// driving model, keys ramped like DrivingInput
//
//   npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import './ts-hooks.mjs';

const { default: VehiclePhysics } = await import(
    '../../src/Application/Racing/Vehicle/VehiclePhysics.ts'
);
const { buildPhysicsSpec } = await import(
    '../../src/Application/Racing/Vehicle/carPhysics.ts'
);
const { ASSIST_PRESETS } = await import(
    '../../src/Application/Racing/Vehicle/assists.ts'
);
const { carOptionsById } = await import('../../src/Application/carOptions.ts');
const garage = await import('../../src/Application/Racing/Garage/garage.ts');

const geometry = JSON.parse(
    fs.readFileSync(new URL('../race-car-geometry.json', import.meta.url), 'utf8')
);
const DT = 1 / 60;
const FLAT = {
    grounded: true,
    slopeForward: 0,
    slopeLeft: 0,
    normalScale: 1,
    grip: [1, 1, 1, 1],
    drag: [0, 0, 0, 0],
};
const toward = (v, t, d) => (v < t ? Math.min(t, v + d) : Math.max(t, v - d));

const makeCar = (id, preset, tune = garage.STOCK_TUNE) => {
    const g = geometry[id];
    const spec = garage.applyTune(
        buildPhysicsSpec(carOptionsById[id], {
            wheelbase: g.wheelbase,
            trackFront: g.trackFront,
            trackRear: g.trackRear,
            wheelRadius: g.modelWheelRadius,
        }),
        tune,
        garage.STOCK_LOOK
    );
    const car = new VehiclePhysics(spec);
    Object.assign(car.assists, ASSIST_PRESETS[preset], { autoGears: true });
    car.reset(0, 0);
    return car;
};

// keys in, ramped the way DrivingInput does it
const keyboard = () => {
    const s = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
    return (keys) => {
        const w = keys.w ? 1 : 0;
        s.throttle = toward(s.throttle, w, DT * (w > s.throttle ? 7 : 11));
        const steer = (keys.a ? 1 : 0) - (keys.d ? 1 : 0);
        s.steer = toward(s.steer, steer, DT * (steer === 0 ? 9 : 5.5));
        const h = keys.space ? 1 : 0;
        s.handbrake = toward(s.handbrake, h, DT * (h > s.handbrake ? 16 : 12));
        return s;
    };
};

// 80 km/h, turn in and flick the handbrake, then the hold inputs for 8 s.
// returns seconds spent sideways (10 to 70 degrees) and whether it spun
const flick = (car, hold) => {
    const keys = keyboard();
    while (car.getSpeed() * 3.6 < 80) {
        const c = keys({ w: true });
        car.step(DT, c, FLAT, c.steer);
    }
    for (let t = 0; t < 1.2; t += DT) {
        const c = keys({ a: true, space: t > 0.1 && t < 0.4, w: t > 0.4 });
        car.step(DT, c, FLAT, c.steer);
        if (t > 0.4 && -car.getBodySlip() > 0.31) break;
    }
    let sideways = 0;
    let spun = false;
    for (let t = 0; t < 8; t += DT) {
        const c = keys(hold(t));
        car.step(DT, c, FLAT, c.steer);
        const angle = (-car.getBodySlip() * 180) / Math.PI;
        if (angle > 10 && angle < 70 && car.getSpeed() > 6) sideways += DT;
        if (angle > 100 || angle < -25) spun = true;
    }
    return { sideways, spun };
};

for (const id of ['bmw-f82-m4', 'bmw-e92-m3', 'amg-one']) {
    test(`${id}: handbrake flick, key taps hold the drift (standard)`, () => {
        const car = makeCar(id, 'standard');
        const taps = flick(car, (t) => ({ w: t % 0.5 < 0.25 }));
        assert.ok(taps.sideways > 5, `taps held ${taps.sideways.toFixed(2)} s`);
        assert.equal(taps.spun, false);
        const into = flick(makeCar(id, 'standard'), (t) => ({
            a: true,
            w: t % 0.5 < 0.25,
        }));
        assert.ok(into.sideways > 7, `into held ${into.sideways.toFixed(2)} s`);
        assert.equal(into.spun, false);
    });
}

test('lifting off ends the drift without a spin', () => {
    const car = makeCar('bmw-f82-m4', 'standard');
    const lift = flick(car, () => ({}));
    assert.ok(lift.sideways < 1.5, `lift held ${lift.sideways.toFixed(2)} s`);
    assert.equal(lift.spun, false);
    assert.equal(car.driftWindow, false);
});

test('without the handbrake standard keeps its stability control', () => {
    const car = makeCar('bmw-f82-m4', 'standard');
    const keys = keyboard();
    let worst = 0;
    for (let t = 0; t < 10; t += DT) {
        const c = keys({ w: true, a: t > 3 });
        car.step(DT, c, FLAT, c.steer);
        worst = Math.max(worst, Math.abs(car.getBodySlip()));
        assert.equal(car.driftWindow, false);
    }
    assert.ok(worst < 0.25, `slipped ${worst.toFixed(3)} rad`);
});

test('the drift build: drift tires, angle kit, a looser rear', () => {
    const option = carOptionsById['bmw-f82-m4'];
    const g = geometry['bmw-f82-m4'];
    const spec = buildPhysicsSpec(option, {
        wheelbase: g.wheelbase,
        trackFront: g.trackFront,
        trackRear: g.trackRear,
        wheelRadius: g.modelWheelRadius,
    });
    const tune = garage.sanitizeTune({ ...garage.STOCK_TUNE, ...garage.DRIFT_BUILD });
    assert.equal(tune.tires, 'drift');
    assert.equal(tune.angleKit, true);
    assert.equal(garage.isStockTune(tune), false);
    assert.ok(garage.tuneCode(tune, garage.STOCK_LOOK).endsWith('a'));
    const built = garage.applyTune(spec, tune, garage.STOCK_LOOK);
    assert.ok(built.maxSteer > spec.maxSteer + 0.3);
    assert.ok(built.tireGrip * built.tireGripRear < spec.tireGrip * spec.tireGripRear * 0.9);
    // old saves without the new fields load as stock
    const old = garage.sanitizeTune({ tires: 'sport' });
    assert.equal(old.angleKit, false);
    assert.equal(garage.isStockTune(old), true);
});
