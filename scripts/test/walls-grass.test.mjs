// walls and grass cost time: a wall hit takes speed by how hard the car went
// in, riding along a wall bleeds it fast, and grass is slippery, uneven and
// slow, so staying on the road is always quicker
//
//   npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import './ts-hooks.mjs';

const { default: VehiclePhysics } = await import('../../src/Application/Racing/Vehicle/VehiclePhysics.ts');
const { buildPhysicsSpec } = await import('../../src/Application/Racing/Vehicle/carPhysics.ts');
const { ASSIST_PRESETS } = await import('../../src/Application/Racing/Vehicle/assists.ts');
const { carOptionsById } = await import('../../src/Application/carOptions.ts');
const garage = await import('../../src/Application/Racing/Garage/garage.ts');
const { SURFACE_GRIP, SURFACE_DRAG, grassPatch } = await import(
    '../../src/Application/Racing/Vehicle/surfaceGrip.ts'
);

const geometry = JSON.parse(fs.readFileSync(new URL('../race-car-geometry.json', import.meta.url), 'utf8'));
const DT = 1 / 60;
const ground = (grip, drag) => ({
    grounded: true,
    slopeForward: 0,
    slopeLeft: 0,
    normalScale: 1,
    grip: [grip, grip, grip, grip],
    drag: [drag, drag, drag, drag],
});
const ASPHALT = ground(1, 0);
const GRASS = ground(SURFACE_GRIP.grass, SURFACE_DRAG.grass);

const makeCar = (kph = 0, id = 'bmw-e92-m3') => {
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
    car.reset(0, kph / 3.6);
    return car;
};
const kph = (car) => Math.hypot(car.vx, car.vy) * 3.6;
const drive = (car, controls, surface, seconds, each) => {
    for (let t = 0; t < seconds; t += DT) {
        car.step(DT, controls, surface, controls.steer);
        each?.(t);
    }
};

test('a wall hit takes speed by how hard the car went in', () => {
    // the front left corner into a wall on the left at an angle to it
    const lost = (degrees) => {
        const car = makeCar(200);
        const angle = (degrees * Math.PI) / 180;
        car.wallContact(2, 0.9, -Math.sin(angle), -Math.cos(angle));
        return 1 - kph(car) / 200;
    };
    const graze = lost(3);
    const hit = lost(10);
    const crash = lost(30);
    assert.ok(graze > 0.2 && graze < 0.45, `a 3 degree graze lost ${(graze * 100).toFixed(0)}%`);
    assert.ok(hit > 0.55, `a 10 degree hit lost ${(hit * 100).toFixed(0)}%`);
    assert.ok(crash > 0.85, `a 30 degree crash lost ${(crash * 100).toFixed(0)}%`);

    const leaving = makeCar(200);
    assert.equal(leaving.wallContact(2, 0.9, Math.sin(0.1), -Math.cos(0.1)), 0);
    assert.equal(Math.round(kph(leaving)), 200);
});

test('riding along a wall bleeds speed, whatever the step rate', () => {
    // pressed into a wall on the left at 1 g, as steering into it does
    const ride = (dt) => {
        const car = makeCar(200);
        for (let t = 0; t < 1; t += dt) {
            car.vy += 9.81 * dt;
            car.wallContact(0, 0.9, 0, -1);
        }
        return kph(car);
    };
    const after = ride(1 / 60);
    assert.ok(after < 100, `a second on the wall left ${after.toFixed(0)} km/h of 200`);
    assert.ok(Math.abs(ride(1 / 240) - after) < 6, 'the step rate barely matters');

    // brushing it costs a little
    const brush = makeCar(200);
    for (let t = 0; t < 1; t += DT) {
        brush.vy += 0.5 * DT;
        brush.wallContact(0, 0.9, 0, -1);
    }
    assert.ok(kph(brush) > 180, `a light brush left ${kph(brush).toFixed(0)} km/h`);
});

test('grass grip is patchy, never more than half the road, and changes smoothly', () => {
    let min = Infinity;
    let max = -Infinity;
    let jump = 0;
    let last = grassPatch(0, -120);
    for (let i = 1; i <= 4000; i++) {
        const x = i * 0.05;
        const value = grassPatch(x, x * 0.37 - 120);
        min = Math.min(min, value);
        max = Math.max(max, value);
        jump = Math.max(jump, Math.abs(value - last));
        last = value;
    }
    assert.ok(min >= 0.7 && max <= 1.2, `patches ran ${min.toFixed(2)} to ${max.toFixed(2)}`);
    assert.ok(max - min > 0.3, 'patches differ');
    assert.ok(jump < 0.05, `grip jumped ${jump.toFixed(3)} in 5 cm`);
    assert.ok(SURFACE_GRIP.grass * 1.2 < 0.5, 'its best patch is under half the road');
});

test('on grass a car slows on its own, stops late and corners at a fraction', () => {
    const coast = (surface) => {
        const car = makeCar(150);
        drive(car, { throttle: 0, brake: 0, handbrake: 0, steer: 0 }, surface, 3);
        return kph(car);
    };
    assert.ok(coast(ASPHALT) - coast(GRASS) > 25, `grass took ${(coast(ASPHALT) - coast(GRASS)).toFixed(0)} km/h more in 3 s`);

    const stop = (surface) => {
        const car = makeCar(100);
        let meters = 0;
        drive(car, { throttle: 0, brake: 1, handbrake: 0, steer: 0 }, surface, 8, () => {
            meters += Math.max(0, car.vx) * DT;
        });
        return meters;
    };
    assert.ok(stop(GRASS) > stop(ASPHALT) * 1.4, `stopping took ${stop(GRASS).toFixed(0)} m against ${stop(ASPHALT).toFixed(0)} m`);

    const corner = (surface) => {
        const car = makeCar(90);
        let lateral = 0;
        drive(car, { throttle: 0.4, brake: 0, handbrake: 0, steer: 1 }, surface, 2.5, (t) => {
            if (t > 1.5) lateral = Math.max(lateral, Math.abs(car.vx * car.yawRate) / 9.81);
        });
        return lateral;
    };
    assert.ok(corner(GRASS) < corner(ASPHALT) * 0.5, `grass cornered at ${corner(GRASS).toFixed(2)} g against ${corner(ASPHALT).toFixed(2)} g`);
});
