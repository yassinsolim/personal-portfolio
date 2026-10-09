import test from 'node:test';
import assert from 'node:assert/strict';

const { STEERING_KEY, STEERING_MAX, STEERING_MIN, clampSteering, readSteering, steerRates, stickCurve } =
    await import('../../src/Application/Racing/Input/steering.ts');

test('the steering setting stays in range', () => {
    assert.equal(clampSteering(0.1), STEERING_MIN);
    assert.equal(clampSteering(5), STEERING_MAX);
    assert.equal(clampSteering(1.2), 1.2);
    assert.equal(clampSteering(Number.NaN), 1);
});

test('the default keys take a sixth of a second in town and a third at 200 km/h', () => {
    const town = steerRates(1, 10);
    const fast = steerRates(1, 200 / 3.6);
    assert.ok(Math.abs(1 / town.rise - 1 / 6) < 0.01, `${1 / town.rise} s in town`);
    assert.ok(Math.abs(1 / fast.rise - 1 / 3) < 0.02, `${1 / fast.rise} s at 200`);
    // swapping sides slows the same way, letting go stays quick
    assert.ok(fast.reverse < town.reverse * 0.55);
    assert.ok(fast.release === town.release && town.release >= 9);
    // gentler than the old default (8 in, 16 across) everywhere
    assert.ok(town.rise < 8 && town.reverse < 16);
    // the stick is finer in the middle than it was (1.1)
    assert.ok(stickCurve(1) >= 1.4);
});

test('more sensitivity is quicker and a flatter stick, within limits', () => {
    let last = steerRates(STEERING_MIN, 30);
    let lastCurve = stickCurve(STEERING_MIN);
    for (let s = STEERING_MIN + 0.1; s <= STEERING_MAX + 1e-9; s += 0.1) {
        const rates = steerRates(s, 30);
        assert.ok(rates.rise > last.rise && rates.reverse > last.reverse);
        const curve = stickCurve(s);
        assert.ok(curve <= lastCurve && curve >= 1 && curve <= 1.8);
        last = rates;
        lastCurve = curve;
    }
});

test('the saved setting is read back, and a broken one falls back', () => {
    const store = new Map();
    globalThis.window = {
        localStorage: {
            getItem: (key) => (store.has(key) ? store.get(key) : null),
        },
    };
    try {
        assert.equal(readSteering(), 1);
        store.set(STEERING_KEY, '1.3');
        assert.equal(readSteering(), 1.3);
        store.set(STEERING_KEY, '9');
        assert.equal(readSteering(), STEERING_MAX);
        store.set(STEERING_KEY, 'fast');
        assert.equal(readSteering(), 1);
    } finally {
        delete globalThis.window;
    }
});
