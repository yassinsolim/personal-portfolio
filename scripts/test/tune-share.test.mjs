// tune sharing: a board code reads back into the exact setup it was made
// from, for every setting on its garage step, and junk doesn't read
//
//   npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import './ts-hooks.mjs';

const garage = await import('../../src/Application/Racing/Garage/garage.ts');
const { ENGINE_IDS } = await import('../../src/Application/Racing/Garage/engines.ts');

// a seeded random so a failure repeats
let seed = 7;
const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
};
const pick = (list) => list[Math.floor(random() * list.length)];
const steps = (min, max, step) => {
    const out = [];
    for (let v = min; v <= max + 1e-9; v += step) out.push(Number(v.toFixed(2)) + 0);
    return out;
};

test('a board code reads back into the setup it came from', () => {
    for (let i = 0; i < 2000; i++) {
        const brakes = pick(garage.BRAKE_KITS);
        const tune = garage.sanitizeTune({
            power: pick(steps(0.85, 1.15, 0.01)),
            tires: pick(['street', 'sport', 'semi', 'slick', 'drift']),
            springsFront: pick(steps(-1, 1, 0.1)),
            springsRear: pick(steps(-1, 1, 0.1)),
            damping: pick(steps(-1, 1, 0.1)),
            diff: pick(steps(-1, 1, 0.1)),
            gearing: pick(steps(-1, 1, 0.1)),
            brakeBias: pick(steps(0.54, 0.74, 0.01)),
            brakes,
            brakePressure: pick(steps(0.7, 1.3, 0.1)),
            speedLimiter: random() < 0.5,
            angleKit: random() < 0.5,
            engine: random() < 0.5 ? 'stock' : pick(ENGINE_IDS),
            induction: pick(['stock', 'na', 'twin', 'quad', 'super']),
            exhaust: pick(['stock', 'sport', 'straight']),
        });
        const look = {
            ...garage.STOCK_LOOK,
            ride: pick(steps(-1, 1, 0.1)),
            spoiler: pick(['none', 'ducktail', 'wing']),
        };
        const code = garage.tuneCode(tune, look);
        const shared = garage.decodeTune(code);
        assert.ok(shared, code);
        assert.deepEqual(shared.tune, tune, code);
        assert.equal(shared.ride, look.ride, code);
        assert.equal(shared.spoiler, look.spoiler, code);
        assert.equal(garage.tuneCode(shared.tune, { ...look, ride: shared.ride }), code);
    }
});

test('codes that do not read give nothing', () => {
    for (const code of ['', 'abc', 'zzzzzzzzzzzzzzzzz', 'NOTOK12345', '0123456789b', '0123456789x12']) {
        assert.equal(garage.decodeTune(code), null, code);
    }
});
