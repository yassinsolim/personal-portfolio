// brake kits: they sanitize, count as a tune, keep older board codes as they
// were, and bite harder: a race kit stops a car the stock brakes can't hold
// at the tire limit shorter, and changes nothing where the tires are the limit
//
//   npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import './ts-hooks.mjs';

const { buildPhysicsSpec } = await import(
    '../../src/Application/Racing/Vehicle/carPhysics.ts'
);
const { predictStop } = await import(
    '../../src/Application/Racing/Vehicle/VehiclePhysics.ts'
);
const { carOptionsById } = await import('../../src/Application/carOptions.ts');
const garage = await import('../../src/Application/Racing/Garage/garage.ts');

const geometry = JSON.parse(
    fs.readFileSync(new URL('../race-car-geometry.json', import.meta.url), 'utf8')
);
const spec = (id, patch = {}) => {
    const g = geometry[id];
    return garage.applyTune(
        buildPhysicsSpec(carOptionsById[id], {
            wheelbase: g.wheelbase,
            trackFront: g.trackFront,
            trackRear: g.trackRear,
            wheelRadius: g.modelWheelRadius,
        }),
        garage.sanitizeTune({ ...garage.STOCK_TUNE, ...patch }),
        garage.STOCK_LOOK,
        id
    );
};

test('brake kits sanitize and count as a tune', () => {
    assert.equal(garage.sanitizeTune({}).brakes, 'stock');
    assert.equal(garage.sanitizeTune({ brakes: 'race' }).brakes, 'race');
    assert.equal(garage.sanitizeTune({ brakes: 'carbon' }).brakes, 'stock');
    // only the sport and race kits have the pressure adjuster
    assert.equal(garage.sanitizeTune({ brakes: 'street', brakePressure: 1.2 }).brakePressure, 1);
    assert.equal(garage.sanitizeTune({ brakes: 'sport', brakePressure: 0.83 }).brakePressure, 0.8);
    assert.equal(garage.sanitizeTune({ brakes: 'race', brakePressure: 9 }).brakePressure, 1.3);
    assert.equal(garage.isStockTune(garage.sanitizeTune({ brakes: 'street' })), false);
    assert.equal(garage.isStockTune(garage.sanitizeTune({ brakePressure: 0.8 })), true);
});

test('stock brakes keep older board codes and every kit has its own', () => {
    const plain = { ...garage.STOCK_TUNE, power: 1.1 };
    const before = garage.tuneCode(plain, garage.STOCK_LOOK);
    const codes = new Set([before]);
    for (const brakes of garage.BRAKE_KITS) {
        for (const brakePressure of [0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3]) {
            const tune = garage.sanitizeTune({ ...plain, brakes, brakePressure });
            const code = garage.tuneCode(tune, garage.STOCK_LOOK);
            assert.equal(code.length, before.length, code);
            codes.add(code);
        }
    }
    // stock and street have no adjuster: 1 + 1 + 7 + 7 settings
    assert.equal(codes.size, 16);
    assert.equal(
        garage.tuneCode(garage.sanitizeTune(plain), garage.STOCK_LOOK),
        before
    );
});

test('a bigger kit bites harder', () => {
    const stock = spec('bmw-e92-m3');
    const race = spec('bmw-e92-m3', { brakes: 'race' });
    const gentle = spec('bmw-e92-m3', { brakes: 'sport', brakePressure: 0.7 });
    assert.ok(Math.abs(race.brakeTorque / stock.brakeTorque - 1.5) < 1e-9);
    assert.ok(Math.abs(gentle.brakeTorque / stock.brakeTorque - 0.91) < 1e-9);
});

test('stopping distances follow the tires, and the brakes once they limit', () => {
    const stock = predictStop(spec('bmw-e92-m3'), 100 / 3.6);
    assert.ok(stock > 29 && stock < 37, `e92 100-0 ${stock.toFixed(1)} m`);
    // on road tires stock brakes already hold the tires at their limit
    const race = predictStop(spec('bmw-e92-m3', { brakes: 'race' }), 100 / 3.6);
    assert.ok(race <= stock + 0.05 && race > stock - 1, `race kit ${race.toFixed(1)} m`);
    const slicks = predictStop(spec('bmw-e92-m3', { tires: 'slick' }), 100 / 3.6);
    assert.ok(slicks < stock - 1, `slicks ${slicks.toFixed(1)} m`);
    // a downforce car at speed asks more than the stock brakes give
    const valkyrie = predictStop(spec('aston-martin-valkyrie'), 200 / 3.6);
    const valkyrieRace = predictStop(
        spec('aston-martin-valkyrie', { brakes: 'race' }),
        200 / 3.6
    );
    assert.ok(
        valkyrieRace < valkyrie - 4,
        `valkyrie 200-0 ${valkyrie.toFixed(1)} -> ${valkyrieRace.toFixed(1)} m`
    );
    // turning the pressure down gives distance away where the brakes limit
    const soft = predictStop(
        spec('aston-martin-valkyrie', { brakes: 'sport', brakePressure: 0.7 }),
        200 / 3.6
    );
    assert.ok(soft > valkyrie + 2, `sport kit at 70% ${soft.toFixed(1)} m`);
});
