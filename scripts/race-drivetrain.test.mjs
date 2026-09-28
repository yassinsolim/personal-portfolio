// node --test scripts/race-drivetrain.test.mjs (npm run test:drivetrain)
//
// every car against its published gearing, limiter and times, the tunes
// against stock, and the pieces the garage relies on. the tolerances are in
// race-drivetrain-check.mjs and docs/cars-drivetrain.md
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDrivetrainChecks, formatReport } from './race-drivetrain-check.mjs';
import { REFERENCE } from './race-drivetrain-reference.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (file) => path.join(here, '../src/Application', file);

for (const id of Object.keys(REFERENCE)) {
    test(`${id}: rpm, speed per gear, times and tunes`, () => {
        const result = runDrivetrainChecks({ cars: [id] });
        assert.deepEqual(result.failures, [], formatReport(result));
    });
}

test('rolling radius from a tyre size or its measured revs per mile', async () => {
    const { rollingRadius, tyreDiameter } = await import(src('Racing/Vehicle/tyres.ts'));
    assert.ok(Math.abs(tyreDiameter('265/40 ZR18') - 0.6692) < 1e-4);
    // 746 revs per mile is 2.157 m a turn
    assert.ok(Math.abs(rollingRadius('285/35 ZR20', 746) - 0.34334) < 1e-4);
    assert.ok(Math.abs(rollingRadius('255/30 R19') - 0.97 * 0.6356 / 2) < 1e-4);
});

test('the speed limiter is a tune flag like the others', async () => {
    const garage = await import(src('Racing/Garage/garage.ts'));
    const { buildPhysicsSpec, defaultWheelGeometry } = await import(src('Racing/Vehicle/carPhysics.ts'));
    const { carOptionsById } = await import(src('carOptions.ts'));
    const { STOCK_TUNE, STOCK_LOOK } = garage;

    assert.equal(garage.sanitizeTune({}).speedLimiter, true);
    assert.equal(garage.sanitizeTune({ speedLimiter: false }).speedLimiter, false);
    assert.equal(garage.sanitizeTune({ speedLimiter: 'no' }).speedLimiter, true);

    const off = { ...STOCK_TUNE, speedLimiter: false };
    assert.equal(garage.isStockTune(STOCK_TUNE), true);
    assert.equal(garage.isStockTune(off), false);
    assert.equal(garage.isStockSetup(off, STOCK_LOOK), false);
    // older codes keep their meaning, a removed limiter adds a digit
    const stockCode = garage.tuneCode(STOCK_TUNE, STOCK_LOOK);
    assert.equal(stockCode.length, 10);
    assert.equal(garage.tuneCode(off, STOCK_LOOK), `${stockCode}1`);

    const option = carOptionsById['bmw-f82-m4'];
    const spec = buildPhysicsSpec(option, defaultWheelGeometry(option, 0.34));
    assert.equal(garage.applyTune(spec, STOCK_TUNE, STOCK_LOOK), spec);
    assert.equal(Math.round(spec.speedLimit * 3.6), 250);
    assert.equal(garage.applyTune(spec, off, STOCK_LOOK).speedLimit, Infinity);
    // the engine map scales the whole curve
    const strong = garage.applyTune(spec, { ...STOCK_TUNE, power: 1.1 }, STOCK_LOOK);
    assert.ok(Math.abs(strong.torqueTable[100] - spec.torqueTable[100] * 1.1) < 1e-9);
});
