// a stored lap's numbers for the lap card and the replay: speed at a moment,
// top speed, distance and the thinned line, from the samples alone
//
//   npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import './ts-hooks.mjs';

const { indexAt, pointAt, speedAt, summarizeReplay, realEndMs } = await import(
    '../../src/Application/Racing/Ghost/replayStats.ts'
);
const { default: WatchClock } = await import('../../src/Application/Racing/Ghost/watchClock.ts');

test('the watch clock plays at a rate, stops at the end and starts over on play', () => {
    const clock = new WatchClock(10000);
    clock.advance(1);
    assert.equal(clock.timeMs, 1000);
    assert.equal(clock.control({ rate: 4 }), false);
    clock.advance(1);
    assert.equal(clock.timeMs, 5000);
    clock.control({ rate: 3 });
    assert.equal(clock.rate, 4, 'only the offered rates');
    clock.advance(10);
    assert.equal(clock.timeMs, 10000);
    assert.equal(clock.playing, false);
    assert.equal(clock.control({ playing: true }), true);
    assert.equal(clock.timeMs, 0);
    assert.equal(clock.playing, true);
    clock.control({ playing: false });
    clock.advance(1);
    assert.equal(clock.timeMs, 0, 'paused');
    assert.equal(clock.control({ seekMs: 99999 }), true);
    assert.equal(clock.timeMs, 10000);
    clock.control({ skipMs: -10000000 });
    assert.equal(clock.timeMs, 0);
    clock.control({ skipMs: 2500 });
    assert.equal(clock.timeMs, 2500);
});

// 50 m/s along x for 10 s, a sample every 60 ms, then the copy of the first
// pose a recorded lap closes on
const straight = () => {
    const samples = [];
    for (let t = 0; t <= 10000; t += 60) samples.push({ t, x: (50 * t) / 1000, z: 0 });
    samples.push({ ...samples[0], t: 10050 });
    return samples;
};

test('finds the sample at or before a time', () => {
    const samples = straight();
    assert.equal(indexAt(samples, -5), 0);
    assert.equal(indexAt(samples, 0), 0);
    assert.equal(indexAt(samples, 59), 0);
    assert.equal(indexAt(samples, 60), 1);
    assert.equal(indexAt(samples, 999999), samples.length - 1);
    assert.equal(pointAt(samples, 90).x, 4.5);
    assert.equal(realEndMs(samples), samples[samples.length - 2].t);
});

test('speed is steady along the lap and ignores the jump back to the start', () => {
    const samples = straight();
    for (const t of [0, 2500, 5000, 9990, 10050]) {
        assert.ok(Math.abs(speedAt(samples, t) - 50) < 0.5, `${t} ms: ${speedAt(samples, t)}`);
    }
});

test('the summary has the top speed, the distance driven and a thinned line', () => {
    // 250 m, 3 s parked, 250 m more, then the closing copy of the start
    const parked = [];
    for (let t = 0; t <= 5000; t += 50) parked.push({ t, x: (50 * t) / 1000, z: 0 });
    for (let t = 8000; t <= 13000; t += 50) parked.push({ t, x: 250 + (50 * (t - 8000)) / 1000, z: 0 });
    parked.push({ ...parked[0], t: 13050 });
    const summary = summarizeReplay(parked, 40);
    assert.equal(summary.topKph, 180);
    assert.equal(summary.distanceM, 500);
    assert.ok(summary.path.length > 30 && summary.path.length <= 41, `${summary.path.length} points`);
    assert.deepEqual(summary.path[0], [0, 0]);
    assert.deepEqual(summary.path[summary.path.length - 1], [500, 0], 'ends at the last real sample');
    assert.ok(speedAt(parked, 6500) < 0.5, 'parked');
});
