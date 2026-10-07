// braking while turning: up to speed, full steering one way, then full brake
// with the steering held. the car should keep turning the way it's steered
// with abs, plow on without it (fronts locked) instead of spinning, and only
// back up once it has stopped. flat asphalt, keys ramped like DrivingInput
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
const { steerRates } = await import(
    '../../src/Application/Racing/Input/steering.ts'
);
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
const CARS = ['bmw-e92-m3', 'toyota-supra-mk4', 'amg-one'];
const toward = (v, t, d) => (v < t ? Math.min(t, v + d) : Math.max(t, v - d));
const deg = (r) => (r * 180) / Math.PI;

const makeCar = (id, preset, autoGears, tune = garage.STOCK_TUNE) => {
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
    Object.assign(car.assists, ASSIST_PRESETS[preset], { autoGears });
    car.reset(0, 0);
    return car;
};

// keys in, ramped the way DrivingInput does it
const keyboard = () => {
    const s = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
    const rates = steerRates(1);
    return (keys) => {
        const w = keys.w ? 1 : 0;
        s.throttle = toward(s.throttle, w, DT * (w > s.throttle ? 7 : 11));
        const b = keys.s ? 1 : 0;
        s.brake = toward(s.brake, b, DT * (b > s.brake ? 7 : 11));
        const steer = (keys.a ? 1 : 0) - (keys.d ? 1 : 0);
        let rate = rates.rise;
        if (steer === 0) rate = rates.release;
        else if (s.steer !== 0 && Math.sign(steer) !== Math.sign(s.steer)) {
            rate = rates.reverse;
        }
        s.steer = toward(s.steer, steer, DT * rate);
        return s;
    };
};

const upToSpeed = (car, keys, kph) => {
    for (let t = 0; t < 30 && car.getSpeed() * 3.6 < kph; t += DT) {
        if (
            !car.assists.autoGears &&
            car.engineRpm > car.spec.shiftUpRpm * 0.97 &&
            car.shiftTimer <= 0
        ) {
            car.requestShift(1);
        }
        const c = keys({ w: true });
        car.step(DT, c, FLAT, c.steer);
    }
};

// full left for 0.6 s, then the brake on top until it stops
const brakeInTurn = (id, preset, autoGears, kph) => {
    const car = makeCar(id, preset, autoGears);
    const keys = keyboard();
    upToSpeed(car, keys, kph);
    let travel0 = car.yaw + Math.atan2(car.vy, car.vx);
    let left = 0;
    let right = 0;
    let minYaw = 0;
    let maxSlip = 0;
    for (let t = 0; t < 6 && car.gear > 0; t += DT) {
        const braking = t >= 0.6;
        const c = keys({ a: true, s: braking });
        car.step(DT, c, FLAT, c.steer);
        const travel = car.yaw + Math.atan2(car.vy, car.vx);
        const d = Math.atan2(
            Math.sin(travel - travel0),
            Math.cos(travel - travel0)
        );
        travel0 = travel;
        if (car.vx < 1) continue;
        if (d > 0) left += d;
        else right -= d;
        if (braking) minYaw = Math.min(minYaw, car.yawRate);
        if (car.getSpeed() > 3) {
            maxSlip = Math.max(maxSlip, Math.abs(deg(car.getBodySlip())));
        }
    }
    return { left: deg(left), right: deg(right), minYaw, maxSlip };
};

test('braking in a full lock turn keeps turning the way it is steered', () => {
    for (const id of CARS) {
        for (const preset of ['standard', 'sport']) {
            for (const auto of [true, false]) {
                const r = brakeInTurn(id, preset, auto, 100);
                const label = `${id} ${preset} ${auto ? 'auto' : 'manual'}`;
                assert.ok(r.left > 45, `${label}: turned ${r.left.toFixed(0)}`);
                assert.ok(r.right < 2, `${label}: ${r.right.toFixed(1)} back`);
                assert.ok(r.minYaw > -0.05, `${label}: yaw ${r.minYaw}`);
            }
        }
    }
});

test('locking the fronts without abs plows on instead of spinning', () => {
    for (const id of CARS) {
        for (const kph of [100, 140]) {
            for (const auto of [true, false]) {
                const r = brakeInTurn(id, 'off', auto, kph);
                const label = `${id} ${kph}kph ${auto ? 'auto' : 'manual'}`;
                assert.ok(r.maxSlip < 12, `${label}: slip ${r.maxSlip}`);
                assert.ok(r.left > r.right, `${label}: turned back`);
            }
        }
    }
});

// brake to a stop in a straight line, then keep holding it
const holdBrakeAfterStop = (car, keys, holdFor) => {
    upToSpeed(car, keys, 40);
    let stoppedAt = null;
    let reverseAt = null;
    for (let t = 0; t < 8; t += DT) {
        const holding = stoppedAt === null || t - stoppedAt < holdFor;
        const c = keys({ s: holding });
        car.step(DT, c, FLAT, c.steer);
        if (stoppedAt === null && car.getSpeed() < 0.3) stoppedAt = t;
        if (car.gear < 0 && reverseAt === null) reverseAt = t;
    }
    return { stoppedAt, reverseAt };
};

test('the auto box backs up only once stopped with the brake held', () => {
    for (const id of CARS) {
        const held = holdBrakeAfterStop(
            makeCar(id, 'standard', true),
            keyboard(),
            3
        );
        assert.ok(held.reverseAt !== null, `${id}: never backed up`);
        assert.ok(
            held.reverseAt - held.stoppedAt > 0.45,
            `${id}: reverse ${(held.reverseAt - held.stoppedAt).toFixed(2)} s after stopping`
        );
        const released = holdBrakeAfterStop(
            makeCar(id, 'standard', true),
            keyboard(),
            0.3
        );
        assert.equal(released.reverseAt, null, `${id}: backed up after a stop`);
    }
});

test('a manual box backs up one down from first at a stop, not off the brake', () => {
    for (const id of CARS) {
        const car = makeCar(id, 'standard', false);
        const keys = keyboard();
        const held = holdBrakeAfterStop(car, keys, 3);
        assert.equal(held.reverseAt, null, `${id}: the brake backed it up`);
        while (car.gear > 1) {
            car.requestShift(-1);
            for (let i = 0; i < 30; i++) car.step(DT, keys({}), FLAT, 0);
        }
        car.requestShift(-1);
        for (let i = 0; i < 30; i++) car.step(DT, keys({}), FLAT, 0);
        assert.equal(car.gear, -1, `${id}: one down in first`);
        car.requestShift(1);
        for (let i = 0; i < 30; i++) car.step(DT, keys({}), FLAT, 0);
        assert.equal(car.gear, 1, `${id}: one up in reverse`);
    }
});

test('traction control holds wheelspin backing up too', () => {
    for (const id of CARS) {
        const car = makeCar(id, 'standard', true);
        const keys = keyboard();
        upToSpeed(car, keys, 40);
        for (let t = 0; t < 8 && car.gear > 0; t += DT) {
            const c = keys({ s: true });
            car.step(DT, c, FLAT, c.steer);
        }
        assert.equal(car.gear, -1, `${id}: in reverse`);
        let worst = 0;
        for (let t = 0; t < 1.5; t += DT) {
            const c = keys({ s: true });
            car.step(DT, c, FLAT, c.steer);
            worst = Math.min(worst, car.slipRatio[2], car.slipRatio[3]);
        }
        assert.ok(car.vx < -2, `${id}: backing up`);
        assert.ok(worst > -0.5, `${id}: wheelspin ${worst.toFixed(2)}`);
    }
});
