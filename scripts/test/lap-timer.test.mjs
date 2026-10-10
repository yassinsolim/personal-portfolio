// the first lap's clock: armed at 0 on the grid, running from the first
// movement (throttle or reverse, ground speed, or creeping on the slope), never
// armed away from the start, re-armed by a reset, and later laps still timed
// across the line. runs LapTimer on the real track curve
//
//   npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTrack } from './race-world.mjs';

const { default: LapTimer, ARM_PROGRESS, ARM_START_SPEED_MPS, ARM_CREEP_METERS } =
    await import('../../src/Application/Racing/Lap/LapTimer.ts');

const track = await loadTrack();
const curve = track.getCurve();
const length = curve.getLength();
// where the grid spawns the car, 0.003 of the lap past the line
const SPAWN_T = 0.003;
const at = (t) => curve.getPointAt(((t % 1) + 1) % 1);
const heading = (t) => curve.getTangentAt(((t % 1) + 1) % 1).setY(0).normalize();

const fresh = () => new LapTimer(curve);

test('armed on the grid, the clock stays at 0 while nothing moves', () => {
    const timer = fresh();
    const spawn = at(SPAWN_T);
    const start = timer.arm(1000, spawn);
    assert.equal(start.armed, true);
    assert.equal(start.lapRunning, false);
    assert.equal(start.lapTimeMs, 0);
    for (let now = 1000; now < 61000; now += 16) {
        const u = timer.update(now, spawn, 0, heading(SPAWN_T), false);
        assert.equal(u.lapRunning, false);
        assert.equal(u.lapTimeMs, 0);
        assert.equal(u.armed, true);
    }
});

test('throttle or reverse input starts it on that step', () => {
    const timer = fresh();
    const spawn = at(SPAWN_T);
    timer.arm(0, spawn);
    timer.update(4000, spawn, 0, heading(SPAWN_T), false);
    const go = timer.update(5000, spawn, 0, heading(SPAWN_T), true);
    assert.equal(go.lapRunning, true);
    assert.equal(go.armed, undefined);
    assert.equal(go.lapTimeMs, 0);
    assert.equal(timer.lapStartMs, 5000);
    assert.equal(timer.update(6500, spawn, 3, heading(SPAWN_T)).lapTimeMs, 1500);
});

test('ground speed over the threshold starts it, rolling back included', () => {
    for (const speed of [ARM_START_SPEED_MPS + 0.2, -(ARM_START_SPEED_MPS + 0.2)]) {
        const timer = fresh();
        const spawn = at(SPAWN_T);
        timer.arm(0, spawn);
        assert.equal(timer.update(100, spawn, ARM_START_SPEED_MPS * 0.5, heading(SPAWN_T)).lapRunning, false);
        assert.equal(timer.update(200, spawn, speed, heading(SPAWN_T)).lapRunning, true);
        assert.equal(timer.lapStartMs, 200);
    }
});

test('creeping on the slope starts it once it has gone the creep distance', () => {
    const timer = fresh();
    const spawn = at(SPAWN_T);
    const dir = heading(SPAWN_T);
    timer.arm(0, spawn);
    const near = spawn.clone().addScaledVector(dir, -(ARM_CREEP_METERS * 0.6));
    assert.equal(timer.update(1000, near, 0.2, dir).lapRunning, false);
    const far = spawn.clone().addScaledVector(dir, -(ARM_CREEP_METERS + 0.3));
    assert.equal(timer.update(2000, far, 0.2, dir).lapRunning, true);
});

test('away from the start it never arms: the lap waits for the line', () => {
    const timer = fresh();
    const mid = at(0.5);
    const start = timer.arm(0, mid);
    assert.equal(start.armed, false);
    assert.equal(timer.update(1000, mid, 30, heading(0.5), true).lapRunning, false);
    assert.ok(ARM_PROGRESS * length < 400, 'arming stays near the line');
});

test('a reset re-arms at 0', () => {
    const timer = fresh();
    const spawn = at(SPAWN_T);
    timer.arm(0, spawn);
    timer.update(100, spawn, 0, heading(SPAWN_T), true);
    assert.equal(timer.update(20000, at(0.01), 40, heading(0.01)).lapRunning, true);
    const again = timer.arm(30000, spawn);
    assert.equal(again.armed, true);
    assert.equal(timer.update(40000, spawn, 0, heading(SPAWN_T)).lapTimeMs, 0);
});

// drives the lap on the curve from the spawn, 4 m steps at 50 m/s
const driveLap = (timer, startMs, laps = 1) => {
    const results = [];
    const step = 4 / length;
    const dt = (4 / 50) * 1000;
    let now = startMs;
    for (let t = SPAWN_T; t < SPAWN_T + laps + 0.002; t += step) {
        now += dt;
        const u = timer.update(now, at(t), 50, heading(t), true);
        if (u.completedLapTimeMs) results.push({ at: now, ...u });
    }
    return results;
};

test('the first lap is timed from the first movement and counts as valid', () => {
    const timer = fresh();
    const spawn = at(SPAWN_T);
    timer.arm(0, spawn);
    // two seconds on the grid before the throttle
    for (let now = 0; now <= 2000; now += 16) timer.update(now, spawn, 0, heading(SPAWN_T), false);
    timer.update(2000, spawn, 0, heading(SPAWN_T), true);
    const [lap] = driveLap(timer, 2000);
    assert.ok(lap, 'the lap completes at the line');
    assert.equal(lap.validLap, true);
    // the clock ran from 2000 ms, not from when it was armed
    assert.equal(lap.completedLapTimeMs, lap.at - 2000);
    assert.ok(lap.completedLapTimeMs >= 180000, 'a full lap is over the 3 minute floor');
});

test('later laps keep timing across the line', () => {
    const timer = fresh();
    timer.arm(0, at(SPAWN_T));
    timer.update(0, at(SPAWN_T), 0, heading(SPAWN_T), true);
    const laps = driveLap(timer, 0, 2);
    assert.equal(laps.length, 2);
    assert.equal(laps[1].completedLapTimeMs, laps[1].at - laps[0].at);
    assert.ok(Math.abs(laps[1].completedLapTimeMs - length / 50 * 1000) < 2000);
});

// 4 m steps from one point of the lap to another, either way, at speed m/s
const drive = (timer, from, to, startMs, speed = 50) => {
    const sign = Math.sign(to - from);
    const step = (4 / length) * sign;
    let now = startMs;
    let lap = null;
    for (let t = from; sign > 0 ? t < to : t > to; t += step) {
        now += (4 / speed) * 1000;
        const dir = heading(t);
        if (sign < 0) dir.negate();
        const u = timer.update(now, at(t), speed, dir, true);
        if (u.completedLapTimeMs && !lap) lap = u;
    }
    return { now, lap };
};

// the 5:02 that topped the tuned board: off the grid, back over the line and
// the wrong way down the straight, round, and over the line again. the lap's
// end was only reached backwards, so it isn't a lap
test('backing over the line and coming back after 3 minutes is not a lap', () => {
    const timer = fresh();
    timer.arm(0, at(SPAWN_T));
    timer.update(0, at(SPAWN_T), 0, heading(SPAWN_T), true);
    const back = drive(timer, SPAWN_T, SPAWN_T - 0.16, 0, 20);
    assert.equal(back.lap, null, 'backing over the line times nothing');
    const { lap } = drive(timer, SPAWN_T - 0.16, SPAWN_T + 0.01, back.now);
    assert.ok(lap, 'the line still stops the clock');
    assert.ok(lap.completedLapTimeMs >= 180000);
    assert.equal(lap.validLap, false);
});

test('a lap begun on the line still has to go all the way round', () => {
    const timer = fresh();
    timer.arm(0, at(SPAWN_T));
    timer.update(0, at(SPAWN_T), 0, heading(SPAWN_T), true);
    const [first] = driveLap(timer, 0);
    assert.equal(first.validLap, true);
    // just past the line: back over it, sit out three minutes, come forward
    const back = drive(timer, SPAWN_T + 0.002, -0.02, first.at, 20);
    let now = back.now;
    for (let i = 0; i < 200; i++) {
        now += 1000;
        timer.update(now, at(-0.02), 0, heading(-0.02), false);
    }
    const { lap } = drive(timer, -0.02, 0.005, now);
    assert.ok(lap, 'the line stops the clock');
    assert.ok(lap.completedLapTimeMs >= 180000);
    assert.equal(lap.validLap, false);
});

test('backing up mid lap and driving on still counts', () => {
    const timer = fresh();
    timer.arm(0, at(SPAWN_T));
    timer.update(0, at(SPAWN_T), 0, heading(SPAWN_T), true);
    const out = drive(timer, SPAWN_T, 0.5, 0);
    const back = drive(timer, 0.5, 0.49, out.now, 10);
    const { lap } = drive(timer, 0.49, 1.005, back.now);
    assert.ok(lap);
    assert.equal(lap.validLap, true);
});
