// the drift park: its generated lap closes on itself and builds like the
// ring (frames, verges to its walls, ground), and drifts score the way the
// HUD says: a chain builds sideways, banks when straight, is lost to a wall,
// the grass or a spin
//
//   npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import './dom-shim.mjs';
import './ts-hooks.mjs';

const THREE = await import('three');
const { buildDriftParkData, DRIFT_PARK_ORIGIN, DRIFT_PARK_SPLITS } = await import(
    '../../src/Application/Racing/Track/driftPark.ts'
);
const { default: DriftScore, DRIFT_SCORE } = await import(
    '../../src/Application/Racing/Lap/DriftScore.ts'
);

const data = buildDriftParkData();

test('the drift park lap closes, 4 m a point, about 1.6 km', () => {
    const points = data.points;
    assert.ok(data.length > 1500 && data.length < 1800, `${data.length} m`);
    let worst = 0;
    for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        const gap = Math.hypot(b[0] - a[0], b[2] - a[2]);
        worst = Math.max(worst, Math.abs(gap - data.spacing));
        assert.equal(a[1], DRIFT_PARK_ORIGIN.y);
    }
    // the last point runs back into the first like any other
    assert.ok(worst < 0.2, `spacing off by ${worst.toFixed(3)} m`);
    const names = data.sections.map((s) => s.name);
    DRIFT_PARK_SPLITS.forEach((name) => assert.ok(names.includes(name), name));
    data.sections.forEach((s, i) => {
        if (i) assert.ok(s.distance > data.sections[i - 1].distance);
    });
});

test('the drift park builds: wide road, walls 21 m out, flat ground', async () => {
    globalThis.__testApplication = {
        resources: { items: { json: {} } },
        scene: new THREE.Scene(),
        renderer: null,
        time: { elapsed: 0, delta: 16 },
    };
    const { default: Track } = await import(
        '../../src/Application/Racing/Track/NordschleifeTrack.ts'
    );
    const track = new Track(globalThis.__testApplication.scene, false, data);
    track.root.updateMatrixWorld(true);
    assert.ok(Math.abs(track.length - data.length) < 5);
    assert.equal(track.root.name, 'drift-park-track-root');
    const frame = track.createFrame();
    let narrowest = Infinity;
    for (let i = 0; i < 400; i++) {
        const p = track.getCurve().getPointAt(i / 400);
        track.frameHint = -1;
        track.queryFrame(p.x, p.z, frame);
        assert.ok(Math.abs(frame.lateral) < 0.5, `lateral ${frame.lateral}`);
        assert.equal(frame.roadHalfWidth, 12);
        narrowest = Math.min(narrowest, frame.barrierLeft, frame.barrierRight);
        if (i % 40 === 0) {
            const y = track.sampleGround(p.x, p.z);
            assert.ok(Math.abs(y - DRIFT_PARK_ORIGIN.y) < 0.3, `ground ${y}`);
        }
    }
    // walls everywhere at least the road and some run-off out
    assert.ok(narrowest > 15, `walls ${narrowest.toFixed(1)} m out`);
    assert.equal(track.getSurface(frame, 0), 'asphalt');
    assert.equal(track.getSurface(frame, 16), 'grass');
});

const run = (score, seconds, input) => {
    let event = null;
    for (let t = 0; t < seconds; t += 1 / 60) event = score.update(1 / 60, input) || event;
    return event;
};
const sideways = { angle: 35, speedKph: 80, onRoad: true, impact: 0 };
const straight = { angle: 2, speedKph: 80, onRoad: true, impact: 0 };

test('a chain builds while sideways and banks once straight', () => {
    const score = new DriftScore();
    run(score, 5, sideways);
    assert.ok(score.chain > 300, `chain ${score.chain}`);
    assert.equal(score.multiplier, 1 + DRIFT_SCORE.step * 2);
    assert.equal(score.total, 0);
    const before = score.chainPoints;
    // a short straight is still the same chain
    run(score, 0.5, straight);
    assert.equal(score.total, 0);
    const event = run(score, 0.5, straight);
    assert.equal(event.kind, 'banked');
    assert.equal(event.points, before);
    assert.equal(score.total, before);
    assert.equal(score.chain, 0);
});

test('more angle and speed score faster, holding longer multiplies', () => {
    const slow = new DriftScore();
    run(slow, 2, { ...sideways, angle: 18, speedKph: 45 });
    const fast = new DriftScore();
    run(fast, 2, { ...sideways, angle: 40, speedKph: 95 });
    assert.ok(fast.chain > slow.chain * 2);
    const long = new DriftScore();
    run(long, 30, sideways);
    assert.equal(long.multiplier, DRIFT_SCORE.maxMultiplier);
});

test('a wall, the grass or a spin loses the chain, a grass touch does not', () => {
    const wall = new DriftScore();
    run(wall, 3, sideways);
    const event = wall.update(1 / 60, { ...sideways, impact: 2 });
    assert.equal(event.kind, 'lost');
    assert.equal(event.reason, 'wall');
    assert.equal(wall.total, 0);

    const touch = new DriftScore();
    run(touch, 3, sideways);
    run(touch, 0.2, { ...sideways, onRoad: false });
    run(touch, 1, sideways);
    assert.ok(touch.chain > 0);
    const grass = run(touch, 0.5, { ...sideways, onRoad: false });
    assert.equal(grass.reason, 'grass');

    const spin = new DriftScore();
    run(spin, 3, sideways);
    assert.equal(spin.update(1 / 60, { ...sideways, angle: 140 }).reason, 'spin');
});

test('the end of the lap counts the chain still building', () => {
    const score = new DriftScore();
    run(score, 4, sideways);
    run(score, 1, straight);
    const banked = score.total;
    run(score, 3, sideways);
    const open = score.chainPoints;
    assert.equal(score.finish(), banked + open);
});
