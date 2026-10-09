// the default (standard) handling on the keys at speed: a quick lane change
// stays settled instead of swinging the tail, and full steer on the power
// from 200 km/h turns the car without snapping it sideways. flat asphalt,
// keys ramped like DrivingInput
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
const { carOptions, carOptionsById } = await import('../../src/Application/carOptions.ts');
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
const toward = (v, t, d) => (v < t ? Math.min(t, v + d) : Math.max(t, v - d));
const deg = (r) => (r * 180) / Math.PI;

const makeCar = (id) => {
    const g = geometry[id];
    const spec = garage.applyTune(
        buildPhysicsSpec(carOptionsById[id], {
            wheelbase: g.wheelbase,
            trackFront: g.trackFront,
            trackRear: g.trackRear,
            wheelRadius: g.modelWheelRadius,
        }),
        garage.STOCK_TUNE,
        garage.STOCK_LOOK
    );
    const car = new VehiclePhysics(spec);
    Object.assign(car.assists, ASSIST_PRESETS.standard, { autoGears: true });
    car.reset(0, 0);
    return car;
};

const drive = (car, held, seconds, each) => {
    const s = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
    for (let t = 0; t < seconds; t += DT) {
        const keys = held(t);
        const w = keys.w ? 1 : 0;
        s.throttle = toward(s.throttle, w, DT * (w > s.throttle ? 7 : 11));
        const steer = (keys.a ? 1 : 0) - (keys.d ? 1 : 0);
        const rates = steerRates(1, car.getSpeed());
        let rate = rates.rise;
        if (steer === 0) rate = rates.release;
        else if (s.steer !== 0 && Math.sign(steer) !== Math.sign(s.steer)) rate = rates.reverse;
        s.steer = toward(s.steer, steer, DT * rate);
        car.step(DT, s, FLAT, s.steer);
        each?.(t);
    }
};

const upTo = (car, kph) => {
    for (let t = 0; t < 40 && car.getSpeed() * 3.6 < kph; t += DT) {
        car.step(DT, { throttle: 1, brake: 0, steer: 0, handbrake: 0 }, FLAT, 0);
    }
};

test('a quick lane change at 200 km/h on the keys stays settled', () => {
    for (const id of ['bmw-e92-m3', 'toyota-supra-mk4', 'amg-one', 'koenigsegg-jesko']) {
        const car = makeCar(id);
        upTo(car, 200);
        let slip = 0;
        let late = 0;
        // right for 0.3 s, left for 0.3 s, then hands off on the throttle
        drive(
            car,
            (t) => (t < 0.3 ? { d: true, w: true } : t < 0.6 ? { a: true, w: true } : { w: true }),
            3,
            (t) => {
                slip = Math.max(slip, Math.abs(deg(car.getBodySlip())));
                if (t > 1.6) late = Math.max(late, Math.abs(deg(car.yawRate)));
            }
        );
        assert.ok(slip < 4.5, `${id}: tail out ${slip.toFixed(1)} deg`);
        assert.ok(late < 1.5, `${id}: still turning ${late.toFixed(1)} deg/s`);
    }
});

test('full steer on the power from 200 km/h turns every car without a snap', () => {
    for (const { id } of carOptions) {
        const car = makeCar(id);
        upTo(car, 200);
        let slip = 0;
        drive(
            car,
            () => ({ d: true, w: true }),
            3,
            () => {
                slip = Math.max(slip, Math.abs(deg(car.getBodySlip())));
            }
        );
        assert.ok(slip < 9, `${id}: tail out ${slip.toFixed(1)} deg`);
    }
});
