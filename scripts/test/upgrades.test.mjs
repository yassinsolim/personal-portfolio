// the chassis upgrades: weight reduction takes mass and inertia off, a
// drivetrain swap changes where the torque goes (and only when the car
// doesn't already have that layout), the wing angle trades drag for
// downforce, and all of them put the car on the tuned board
//
//   npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import './ts-hooks.mjs';

const { buildPhysicsSpec } = await import('../../src/Application/Racing/Vehicle/carPhysics.ts');
const { carOptionsById } = await import('../../src/Application/carOptions.ts');
const garage = await import('../../src/Application/Racing/Garage/garage.ts');

const geometry = JSON.parse(
    fs.readFileSync(new URL('../race-car-geometry.json', import.meta.url), 'utf8')
);
const stock = (id) => {
    const g = geometry[id];
    return buildPhysicsSpec(carOptionsById[id], {
        wheelbase: g.wheelbase,
        trackFront: g.trackFront,
        trackRear: g.trackRear,
        wheelRadius: g.modelWheelRadius,
    });
};
const spec = (id, tune = {}, look = {}) =>
    garage.applyTune(
        stock(id),
        garage.sanitizeTune({ ...garage.STOCK_TUNE, ...tune }),
        garage.sanitizeLook({ ...garage.STOCK_LOOK, ...look }),
        id
    );

test('the new settings sanitize and count as a tune', () => {
    assert.equal(garage.sanitizeTune({}).weight, 'stock');
    assert.equal(garage.sanitizeTune({ weight: 'race' }).weight, 'race');
    assert.equal(garage.sanitizeTune({ weight: 'feather' }).weight, 'stock');
    assert.equal(garage.sanitizeTune({ drivetrain: 'awd' }).drivetrain, 'awd');
    assert.equal(garage.sanitizeTune({ drivetrain: '4wd' }).drivetrain, 'stock');
    assert.equal(garage.sanitizeLook({ spoiler: 'wing', wingAngle: 0.7 }).wingAngle, 0.5);
    assert.equal(garage.sanitizeLook({ wingAngle: 9 }).wingAngle, 1);
    assert.equal(garage.isStockTune(garage.sanitizeTune({ weight: 'sport' })), false);
    assert.equal(garage.isStockTune(garage.sanitizeTune({ drivetrain: 'rwd' })), false);
});

test('weight reduction takes mass and inertia off', () => {
    const base = stock('bmw-e92-m3');
    const sport = spec('bmw-e92-m3', { weight: 'sport' });
    const race = spec('bmw-e92-m3', { weight: 'race' });
    assert.ok(Math.abs(sport.massKg / base.massKg - 0.95) < 1e-9);
    assert.ok(Math.abs(race.massKg / base.massKg - 0.9) < 1e-9);
    assert.ok(Math.abs(race.yawInertia / base.yawInertia - 0.9) < 1e-9);
    assert.equal(race.drive, base.drive);
});

test('a drivetrain swap moves the torque, only to a layout the car lacks', () => {
    const e92 = stock('bmw-e92-m3');
    assert.equal(e92.drive, 'RWD');
    const awd = spec('bmw-e92-m3', { drivetrain: 'awd' });
    assert.equal(awd.drive, 'AWD');
    assert.equal(awd.frontTorqueShare, 0.35);
    assert.ok(awd.massKg > e92.massKg);
    assert.ok(awd.weightFront > e92.weightFront);
    // already rear drive: nothing to swap
    const same = spec('bmw-e92-m3', { drivetrain: 'rwd' });
    assert.equal(same.drive, 'RWD');
    assert.equal(same.massKg, e92.massKg);

    const chiron = stock('bugatti-chiron-super-sport');
    assert.equal(chiron.drive, 'AWD');
    const rwd = spec('bugatti-chiron-super-sport', { drivetrain: 'rwd' });
    assert.equal(rwd.drive, 'RWD');
    assert.equal(rwd.frontTorqueShare, 0);
    assert.ok(rwd.massKg < chiron.massKg);
});

test('the wing angle trades drag for downforce', () => {
    const low = spec('bmw-e92-m3', {}, { spoiler: 'wing', wingAngle: -1 });
    const mid = spec('bmw-e92-m3', {}, { spoiler: 'wing', wingAngle: 0 });
    const high = spec('bmw-e92-m3', {}, { spoiler: 'wing', wingAngle: 1 });
    assert.ok(low.clA < mid.clA && mid.clA < high.clA);
    assert.ok(low.cdA < mid.cdA && mid.cdA < high.cdA);
    // more of it at the back moves the balance rearward
    assert.ok(high.aeroFront < mid.aeroFront);
    // without the wing the angle does nothing
    const ducktail = spec('bmw-e92-m3', {}, { spoiler: 'ducktail', wingAngle: 1 });
    const plain = spec('bmw-e92-m3', {}, { spoiler: 'ducktail' });
    assert.equal(ducktail.clA, plain.clA);
});
