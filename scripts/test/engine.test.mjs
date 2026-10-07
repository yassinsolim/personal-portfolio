// node --test scripts/test/engine.test.mjs
// the garage engine bay: swaps, forced induction and exhaust on top of the
// stock spec, and how they mark a car tuned
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './ts-hooks.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (file) => path.join(here, '../../src/Application', file);
const garage = await import(src('Racing/Garage/garage.ts'));
const engines = await import(src('Racing/Garage/engines.ts'));
const { buildPhysicsSpec, defaultWheelGeometry } = await import(src('Racing/Vehicle/carPhysics.ts'));
const { peakOutput, torqueAt } = await import(src('Racing/Vehicle/VehiclePhysics.ts'));
const { carOptionsById } = await import(src('carOptions.ts'));

const stockSpec = (id) => {
    const option = carOptionsById[id];
    return buildPhysicsSpec(option, defaultWheelGeometry(option, option.race.wheelRadiusMeters));
};
const tuned = (id, patch) =>
    garage.applyTune(stockSpec(id), garage.sanitizeTune({ ...garage.STOCK_TUNE, ...patch }), garage.STOCK_LOOK, id);

test('engine choices sanitize and count as a tune', () => {
    assert.equal(garage.sanitizeTune({ engine: 'l539' }).engine, 'l539');
    assert.equal(garage.sanitizeTune({ engine: 'nope' }).engine, 'stock');
    assert.equal(garage.sanitizeTune({ induction: 'quad' }).induction, 'quad');
    assert.equal(garage.sanitizeTune({ exhaust: 'loud' }).exhaust, 'stock');
    const swap = garage.sanitizeTune({ engine: 'f140' });
    assert.equal(garage.isStockTune(swap), false);
    // every engine is in the stock car map's reach and has a sound bank
    engines.ENGINE_IDS.forEach((id) => assert.ok(engines.ENGINES[id].sound, id));
});

test('tune codes stay inside the board tag (16 characters)', () => {
    const everything = garage.sanitizeTune({
        ...garage.STOCK_TUNE,
        power: 1.1,
        speedLimiter: false,
        angleKit: true,
        engine: engines.ENGINE_IDS[engines.ENGINE_IDS.length - 1],
        induction: 'super',
        exhaust: 'straight',
        brakes: 'race',
        brakePressure: 0.7,
    });
    const code = garage.tuneCode(everything, { ...garage.STOCK_LOOK, spoiler: 'wing', ride: -1 });
    assert.ok(/^[0-9a-z]{1,16}$/.test(code), code);
    const plain = garage.tuneCode({ ...garage.STOCK_TUNE, power: 1.1 }, garage.STOCK_LOOK);
    assert.ok(!plain.includes('x'), 'older codes keep their meaning');
});

test('a v12 swap brings its curve, revs and weight', () => {
    const stock = stockSpec('bmw-e92-m3');
    const swapped = tuned('bmw-e92-m3', { engine: 'l539' });
    assert.equal(swapped.redlineRpm, 8500);
    assert.equal(swapped.massKg, stock.massKg + 235 - 202);
    assert.ok(Math.abs(peakOutput(swapped).powerW / 1000 - 544) < 8, `${peakOutput(swapped).powerW / 1000} kW`);
    assert.ok(swapped.shiftUpRpm > stock.shiftUpRpm);
    // picking the car's own engine by name changes nothing
    const own = tuned('bmw-e92-m3', { engine: 's65' });
    assert.equal(own.redlineRpm, stock.redlineRpm);
    assert.deepEqual(own.torqueTable, stock.torqueTable);
});

test('turbos add boost with lag, taking them off costs power', () => {
    const na = stockSpec('bmw-e92-m3');
    const twin = tuned('bmw-e92-m3', { induction: 'twin' });
    const quad = tuned('bmw-e92-m3', { induction: 'quad' });
    assert.ok(twin.boost && quad.boost);
    assert.ok(peakOutput(quad).powerW > peakOutput(twin).powerW);
    assert.ok(peakOutput(twin).powerW > peakOutput(na).powerW * 1.25);
    // quad turbos build their boost later than twins
    assert.ok(quad.boost.spoolFull > twin.boost.spoolFull);
    assert.ok(torqueAt(quad, 2000) < torqueAt(twin, 4500));
    const deturbo = tuned('bmw-f82-m4', { induction: 'na' });
    assert.ok(peakOutput(deturbo).powerW < peakOutput(stockSpec('bmw-f82-m4')).powerW * 0.75);
});

test('the engine sound follows the swap and the induction', () => {
    const sound = engines.engineSound('bmw-e92-m3', { engine: 'v10', induction: 'quad', exhaust: 'straight' });
    assert.equal(sound.sound, 'lamborghini-huracan');
    assert.equal(sound.redlineRpm, 8500);
    assert.equal(sound.turbo, 'quad');
    const stock = engines.engineSound('bmw-f82-m4', garage.STOCK_TUNE);
    assert.equal(stock.sound, 'bmw-f82-m4');
    assert.equal(stock.turbo, 'stock');
    assert.equal(engines.engineSound('bmw-f82-m4', { engine: 'stock', induction: 'na', exhaust: 'stock' }).turbo, 'none');
});
