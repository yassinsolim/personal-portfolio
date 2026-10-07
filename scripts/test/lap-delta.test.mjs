// the live gap to the best lap: a clean lap that beats the best becomes the
// reference, the gap reads behind or ahead at the same spot, and dirty or
// part laps never become the best. the lap timer's exact progress sits
// between its samples
//
//   npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import './ts-hooks.mjs';

const store = new Map();
globalThis.window = {
    localStorage: {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => store.set(key, String(value)),
        removeItem: (key) => store.delete(key),
    },
    location: { search: '' },
};

const { default: LapDelta } = await import('../../src/Application/Racing/Lap/LapDelta.ts');
const { default: LapTimer } = await import('../../src/Application/Racing/Lap/LapTimer.ts');

// a lap at a steady pace: lapMs over the whole lap, updated every frame
const drive = (delta, lapMs, { from = 0, to = 1, frames = 2000 } = {}) => {
    for (let i = 0; i <= frames; i++) {
        const progress = from + ((to - from) * i) / frames;
        delta.update(progress, progress * lapMs);
    }
};

test('a clean lap becomes the best and the gap reads against it', () => {
    store.clear();
    const delta = new LapDelta();
    assert.equal(delta.setKey('bmw-e92-m3', false), true);
    assert.equal(delta.setKey('bmw-e92-m3', false), false);
    drive(delta, 480_000);
    assert.equal(delta.gap(), null, 'nothing to compare yet');
    delta.complete(480_000, true);
    assert.equal(delta.bestLapMs, 480_000);

    // 1% slower all the way: 2.4 s down at the line, 1.2 s at half way
    drive(delta, 484_800, { to: 0.5 });
    assert.ok(Math.abs(delta.gap() - 2_400) < 30, `half way ${delta.gap()}`);
    drive(delta, 484_800, { from: 0.5 });
    assert.ok(Math.abs(delta.gap() - 4_800) < 30, `at the line ${delta.gap()}`);
    delta.complete(484_800, true);
    assert.equal(delta.bestLapMs, 480_000, 'a slower lap keeps the best');

    // the best is kept per car and setup, and survives a reload
    const again = new LapDelta();
    again.setKey('bmw-e92-m3', false);
    assert.equal(again.bestLapMs, 480_000);
    again.setKey('bmw-e92-m3', true);
    assert.equal(again.bestLapMs, 0, 'tuned has its own best');
});

test('dirty and part laps never become the best', () => {
    store.clear();
    const delta = new LapDelta();
    delta.setKey('amg-one', false);
    drive(delta, 400_000);
    delta.complete(400_000, false);
    assert.equal(delta.bestLapMs, 0, 'a dirty lap');
    drive(delta, 390_000, { to: 0.6 });
    delta.complete(390_000, true);
    assert.equal(delta.bestLapMs, 0, 'only part of the lap was driven');
});

test('backing up holds the gap until the car is past where it was', () => {
    store.clear();
    const delta = new LapDelta();
    delta.setKey('amg-one', false);
    drive(delta, 400_000);
    delta.complete(400_000, true);
    drive(delta, 400_000, { to: 0.3 });
    const before = delta.gap();
    // a reset puts the car 50 m back and costs 3 s
    delta.update(0.2975, 0.3 * 400_000 + 3_000);
    assert.equal(delta.gap(), before);
    delta.update(0.31, 0.31 * 400_000 + 3_000);
    assert.ok(Math.abs(delta.gap() - 3_000) < 30, `after ${delta.gap()}`);
});

test('the lap timer places the car between its samples', () => {
    const points = [];
    for (let i = 0; i < 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        points.push(new THREE.Vector3(Math.cos(a) * 1000, 0, Math.sin(a) * 1000));
    }
    const timer = new LapTimer(new THREE.CatmullRomCurve3(points, true), 400);
    let previous = -1;
    for (let i = 0; i < 300; i++) {
        const t = 0.1 + (i / 300) * 0.8;
        const p = timer.curve.getPointAt(t);
        const index = timer.getClosestSampleIndex(p);
        const exact = timer.exactProgress(p, index);
        assert.ok(Math.abs(exact - t) < 0.0005, `${exact} at ${t}`);
        assert.ok(exact > previous);
        previous = exact;
    }
});
