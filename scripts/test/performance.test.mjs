// the racing line and the performance index on a made up circuit: the line
// cuts the corners and stays on the road, and the index orders setups the
// way their lap times do
//
//   npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import './ts-hooks.mjs';

const { buildRacingLine } = await import('../../src/Application/Racing/Track/racingLine.ts');
const perf = await import('../../src/Application/Racing/Vehicle/performance.ts');
const { buildPhysicsSpec } = await import('../../src/Application/Racing/Vehicle/carPhysics.ts');
const { carOptionsById } = await import('../../src/Application/carOptions.ts');
const garage = await import('../../src/Application/Racing/Garage/garage.ts');

const geometry = JSON.parse(
    fs.readFileSync(new URL('../race-car-geometry.json', import.meta.url), 'utf8')
);

// a 1.6 km rounded rectangle, 12 m wide: two 500 m straights, two 300 m ones
// and four 40 m radius corners, sampled every 2 m
const circuit = () => {
    const points = [];
    const r = 40;
    const legs = [500, 300, 500, 300];
    let x = 0;
    let z = 0;
    let heading = 0;
    const push = () => points.push([x, 0, z, Math.sin(heading), Math.cos(heading)]);
    for (const leg of legs) {
        for (let d = 0; d < leg; d += 2) {
            push();
            x += Math.sin(heading) * 2;
            z += Math.cos(heading) * 2;
        }
        const steps = Math.round((Math.PI / 2) * r / 2);
        for (let s = 0; s < steps; s++) {
            push();
            heading -= Math.PI / 2 / steps;
            x += Math.sin(heading) * 2;
            z += Math.cos(heading) * 2;
        }
    }
    const count = points.length;
    return {
        length: count * 2,
        framePoints: Float32Array.from(points.flatMap(([px, py, pz]) => [px, py, pz])),
        frameTangents: Float32Array.from(points.flatMap(([, , , tx, tz]) => [tx, tz])),
        frameWidth: new Float32Array(count).fill(12),
    };
};

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

test('the racing line cuts the corners and stays on the road', () => {
    const frames = circuit();
    const line = buildRacingLine(frames);
    const room = 6 - 1.4;
    let maxOffset = 0;
    let tightest = Infinity;
    for (let i = 0; i < line.count; i++) {
        assert.ok(Math.abs(line.offset[i]) <= room + 1e-4, `off the road at ${i}`);
        maxOffset = Math.max(maxOffset, Math.abs(line.offset[i]));
        if (Math.abs(line.curvature[i]) > 1e-4) tightest = Math.min(tightest, 1 / Math.abs(line.curvature[i]));
    }
    assert.ok(maxOffset > room - 0.1, 'uses the width');
    // the corners open up from the road's 40 m
    assert.ok(tightest > 45, `tightest ${tightest.toFixed(1)} m`);
    assert.ok(line.length < frames.length, 'shorter than the centre line');
});

test('the index orders setups by their ideal lap', () => {
    const line = buildRacingLine(circuit());
    const lap = (s) => perf.simulateLap(perf.measureEnvelope(s), line).time;
    const stock = lap(spec('bmw-e92-m3'));
    const slicks = lap(spec('bmw-e92-m3', { tires: 'slick' }));
    const power = lap(spec('bmw-e92-m3', { power: 1.15 }));
    const hyper = lap(spec('koenigsegg-jesko'));
    const crown = lap(spec('toyota-crown-platinum'));
    assert.ok(slicks < stock - 0.5, `slicks ${slicks.toFixed(1)} vs ${stock.toFixed(1)}`);
    assert.ok(power < stock, `more power ${power.toFixed(1)}`);
    assert.ok(hyper < stock && stock < crown, `${hyper.toFixed(1)} ${stock.toFixed(1)} ${crown.toFixed(1)}`);
    assert.ok(perf.performanceIndex(hyper) >= perf.performanceIndex(stock));
});

test('classes follow the index like Forza', () => {
    const cases = [
        [100, 'D'],
        [500, 'D'],
        [501, 'C'],
        [650, 'B'],
        [701, 'A'],
        [801, 'S1'],
        [901, 'S2'],
        [998, 'S2'],
        [999, 'X'],
    ];
    for (const [pi, cls] of cases) assert.equal(perf.performanceClass(pi), cls, String(pi));
    assert.equal(perf.performanceIndex(100), 999);
    assert.equal(perf.performanceIndex(100_000), 100);
});

test('the bars stay between 0 and 10 and follow the car', () => {
    const e92 = perf.performanceBars(perf.measureEnvelope(spec('bmw-e92-m3')));
    const jesko = perf.performanceBars(perf.measureEnvelope(spec('koenigsegg-jesko')));
    for (const bars of [e92, jesko]) {
        for (const value of Object.values(bars)) assert.ok(value >= 0 && value <= 10, String(value));
    }
    for (const key of Object.keys(e92)) assert.ok(jesko[key] >= e92[key], key);
});
