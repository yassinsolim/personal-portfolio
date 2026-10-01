// drifting on the keyboard: a handbrake flick under the standard assists
// starts a slide that taps on the throttle key hold, a tap the other way trims
// it, holding the other way on the power swings it over, lifting ends it, and
// the drift build's parts reach the driving model. flat asphalt, the plain
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
// returns seconds spent sideways (10 to 70 degrees) each way, how often it
// changed sides, how far the path turned (degrees), and whether it spun
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
    const travel = () => car.yaw + Math.atan2(car.vy, car.vx);
    let heading = travel();
    let turned = 0;
    let sideways = 0;
    let right = 0;
    let flips = 0;
    let side = 1;
    let spun = false;
    let wild = false;
    for (let t = 0; t < 8; t += DT) {
        const c = keys(hold(t));
        car.step(DT, c, FLAT, c.steer);
        const angle = (-car.getBodySlip() * 180) / Math.PI;
        const now = travel();
        turned += now - heading;
        heading = now;
        const moving = car.getSpeed() > 6;
        if (angle > 10 && angle < 70 && moving) sideways += DT;
        if (angle < -10 && angle > -70 && moving) right += DT;
        if (Math.abs(angle) > 8 && Math.sign(angle) !== side) {
            flips++;
            side = Math.sign(angle);
        }
        if (angle > 100 || angle < -25) spun = true;
        if (Math.abs(angle) > 100) wild = true;
    }
    return {
        sideways,
        right,
        flips,
        turned: (turned * 180) / Math.PI,
        spun,
        wild,
    };
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

for (const id of ['bmw-f82-m4', 'bmw-e92-m3', 'amg-one']) {
    test(`${id}: held the other way on the power it swings into the other drift`, () => {
        const swing = flick(makeCar(id, 'standard'), (t) => ({
            a: t < 3,
            d: t >= 3,
            w: t % 0.5 < 0.3,
        }));
        assert.ok(swing.right > 2, `right side ${swing.right.toFixed(2)} s`);
        assert.equal(swing.wild, false);
        // and back and forth on a held throttle, a slalom of drifts
        const slalom = flick(makeCar(id, 'standard'), (t) => {
            const left = Math.floor(t / 2) % 2 === 0;
            return { a: left, d: !left, w: true };
        });
        assert.ok(slalom.flips >= 2, `changed sides ${slalom.flips} times`);
        assert.ok(slalom.right > 0.5, `right side ${slalom.right.toFixed(2)} s`);
        assert.equal(slalom.wild, false);
    });

    test(`${id}: taps and short holds the other way only trim the drift`, () => {
        // a tap every 1.5 s, the way a correction goes
        const taps = flick(makeCar(id, 'standard'), (t) => ({
            d: t % 1.5 > 1.3,
            w: t % 0.5 < 0.3,
        }));
        assert.ok(taps.right < 0.3, `right side ${taps.right.toFixed(2)} s`);
        assert.ok(taps.sideways > 4, `held ${taps.sideways.toFixed(2)} s`);
        assert.equal(taps.wild, false);
        // half a second the other way, then hands off
        const hold = flick(makeCar(id, 'standard'), (t) => ({
            d: t > 2 && t < 2.5,
            w: t % 0.5 < 0.3,
        }));
        assert.ok(hold.right < 0.3, `right side ${hold.right.toFixed(2)} s`);
        assert.ok(hold.sideways > 5, `held ${hold.sideways.toFixed(2)} s`);
    });
}

test('a drift held on the throttle keeps its speed, the line stays put', () => {
    const car = makeCar('bmw-f82-m4', 'standard');
    const held = flick(car, () => ({ a: true, w: true }));
    assert.ok(held.sideways > 7, `held ${held.sideways.toFixed(2)} s`);
    assert.ok(car.getSpeed() * 3.6 < 100, `${(car.getSpeed() * 3.6).toFixed(0)} km/h`);
});

test('lifting straightens the drift build too', () => {
    const tune = garage.sanitizeTune({ ...garage.STOCK_TUNE, ...garage.DRIFT_BUILD });
    const car = makeCar('bmw-f82-m4', 'standard', tune);
    const lift = flick(car, () => ({}));
    assert.ok(lift.sideways < 1.5, `lift held ${lift.sideways.toFixed(2)} s`);
    assert.equal(lift.spun, false);
});

test('the other way off the power straightens up instead', () => {
    const car = makeCar('bmw-f82-m4', 'standard');
    const lift = flick(car, (t) => ({
        a: t < 3,
        d: t >= 3,
        w: t < 3 && t % 0.5 < 0.3,
    }));
    assert.ok(lift.right < 0.3, `right side ${lift.right.toFixed(2)} s`);
    assert.equal(lift.wild, false);
});

test('steering into the drift tightens the line', () => {
    const taps = (t) => t % 0.5 < 0.25;
    const neutral = flick(makeCar('bmw-f82-m4', 'standard'), (t) => ({
        w: taps(t),
    }));
    const into = flick(makeCar('bmw-f82-m4', 'standard'), (t) => ({
        a: true,
        w: taps(t),
    }));
    assert.ok(
        into.turned > neutral.turned + 30,
        `into ${into.turned.toFixed(0)} vs ${neutral.turned.toFixed(0)} degrees`
    );
});

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
