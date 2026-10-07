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

test('the default steers quicker than the old fixed ramps', () => {
    // the old ramps: 5.5 in, 9 back, 13 across, and a 1.35 stick curve
    const rates = steerRates(1);
    assert.ok(rates.rise > 5.5);
    assert.ok(rates.release >= 9);
    assert.ok(rates.reverse > 13);
    assert.ok(stickCurve(1) < 1.35);
});

test('more sensitivity is quicker and a flatter stick, within limits', () => {
    let last = steerRates(STEERING_MIN);
    let lastCurve = stickCurve(STEERING_MIN);
    for (let s = STEERING_MIN + 0.1; s <= STEERING_MAX + 1e-9; s += 0.1) {
        const rates = steerRates(s);
        assert.ok(rates.rise > last.rise && rates.reverse > last.reverse);
        const curve = stickCurve(s);
        assert.ok(curve <= lastCurve && curve >= 0.8 && curve <= 1.4);
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
