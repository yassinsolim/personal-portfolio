// rewind: a frame holds everything the driving model carries from one step to
// the next, so driving on from a restored frame is the same drive as before.
// the buffer keeps 10 s, plays back at real time then twice as fast, and
// letting go drops what came after the frame on screen
//
//   npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import './ts-hooks.mjs';

const { default: RewindBuffer, snapshotFields, restoreFields, REWIND_SECONDS } = await import(
    '../../src/Application/Racing/Rewind.ts'
);
const { default: VehiclePhysics } = await import(
    '../../src/Application/Racing/Vehicle/VehiclePhysics.ts'
);
const { buildPhysicsSpec } = await import('../../src/Application/Racing/Vehicle/carPhysics.ts');
const { ASSIST_PRESETS } = await import('../../src/Application/Racing/Vehicle/assists.ts');
const { carOptionsById } = await import('../../src/Application/carOptions.ts');

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

const makeCar = (id) => {
    const g = geometry[id];
    const car = new VehiclePhysics(
        buildPhysicsSpec(carOptionsById[id], {
            wheelbase: g.wheelbase,
            trackFront: g.trackFront,
            trackRear: g.trackRear,
            wheelRadius: g.modelWheelRadius,
        })
    );
    Object.assign(car.assists, ASSIST_PRESETS.sport, { autoGears: true });
    car.reset(0, 0);
    return car;
};

// flat out, then a long turn on the power: wheelspin, shifts, a slide
const controls = (i) => ({
    throttle: 1,
    brake: 0,
    handbrake: 0,
    steer: i > 240 ? 0.6 : 0,
});
const drive = (car, from, to) => {
    for (let i = from; i < to; i++) {
        const c = controls(i);
        car.step(DT, c, FLAT, c.steer);
    }
};
const pose = (car) => [car.vx, car.vy, car.yawRate, car.yaw, car.gear, car.engineRpm, ...car.wheelOmega];

test('fields go back into the same objects', () => {
    const target = {
        speed: 3,
        on: true,
        list: [1, 2],
        where: new THREE.Vector3(1, 2, 3),
        turn: new THREE.Quaternion(),
        name: 'kept',
        nested: { a: 1 },
        tmpScratch: new THREE.Vector3(),
    };
    const where = target.where;
    const list = target.list;
    const frame = snapshotFields(target, (key) => key.startsWith('tmp'));
    assert.deepEqual(Object.keys(frame).sort(), ['list', 'on', 'speed', 'turn', 'where']);
    target.speed = 9;
    target.on = false;
    target.list.push(5);
    target.where.set(7, 7, 7);
    target.turn.set(0, 1, 0, 0);
    restoreFields(target, frame);
    assert.equal(target.speed, 3);
    assert.equal(target.on, true);
    assert.equal(target.where, where);
    assert.deepEqual(target.where.toArray(), [1, 2, 3]);
    assert.equal(target.list, list);
    assert.deepEqual(target.list, [1, 2]);
    assert.deepEqual(target.turn.toArray(), [0, 0, 0, 1]);
});

test('driving on from a restored frame is the same drive', () => {
    const car = makeCar('bmw-e92-m3');
    drive(car, 0, 300);
    const frame = snapshotFields(car);
    drive(car, 300, 420);
    const straight = pose(car);
    // somewhere else entirely, then back to the frame
    drive(car, 420, 600);
    restoreFields(car, frame);
    drive(car, 300, 420);
    assert.deepEqual(pose(car), straight);
});

test('the buffer keeps 10 s and plays back faster the longer it is held', () => {
    const buffer = new RewindBuffer();
    const make = (at) => ({ at, extra: {} });
    for (let i = 0; i < 60 * 12; i++) buffer.record(1000 / 60, make);
    const span = buffer.frames[buffer.frames.length - 1].at - buffer.frames[0].at;
    assert.ok(span <= REWIND_SECONDS * 1000 && span > REWIND_SECONDS * 1000 - 50, `${span}`);
    // about 30 a second
    assert.ok(Math.abs(buffer.frames.length - 30 * REWIND_SECONDS) <= 2, `${buffer.frames.length}`);
    const end = buffer.frames[buffer.frames.length - 1].at;
    for (let i = 0; i < 60; i++) buffer.scrub(1 / 60);
    // 0.6 s at real time, then 0.4 s at double
    assert.ok(Math.abs(end - buffer.playhead - 1400) < 20, `${end - buffer.playhead}`);
    const frame = buffer.release();
    assert.ok(frame.at <= end - 1380);
    assert.equal(buffer.frames[buffer.frames.length - 1], frame);
    assert.equal(buffer.playhead, null);
    // recording goes on from the frame's time
    buffer.record(40, make);
    assert.ok(Math.abs(buffer.frames[buffer.frames.length - 1].at - (frame.at + 40)) < 1e-6);
    // held to the end it stops at the oldest frame
    for (let i = 0; i < 60 * 20; i++) buffer.scrub(1 / 60);
    assert.equal(buffer.playhead, buffer.frames[0].at);
    assert.equal(buffer.left(), 0);
});
