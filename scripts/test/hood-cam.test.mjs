// the hood cam's spot from a car's shape: on the hood just ahead of where the
// glass starts, whatever frame the car sits in, and a thin wiper on the center
// line doesn't move it
//
//   npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import './ts-hooks.mjs';

const { probeHood } = await import('../../src/Application/Racing/Camera/hoodProbe.ts');

// a front engined coupe in boxes: the body's top at 0.6, a cabin up to 1.0
// from 0.5 back to -1.2, and a wiper standing on the hood in the middle
const coupe = () => {
    const pivot = new THREE.Group();
    const model = new THREE.Group();
    pivot.add(model);
    const box = (w, h, d, x, y, z) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d));
        mesh.position.set(x, y, z);
        model.add(mesh);
    };
    box(2, 0.9, 4.6, 0, 0.15, 0);
    box(1.6, 0.4, 1.7, 0, 0.8, -0.35);
    box(0.04, 0.3, 0.04, 0, 0.75, 0.9);
    return { pivot, model };
};

test('the hood cam sits on the hood, just ahead of the glass', () => {
    const { pivot, model } = coupe();
    const spot = probeHood(pivot, model, 4.6, 0.33);
    assert.ok(spot);
    assert.ok(Math.abs(spot.along - 0.68) < 0.05, `along ${spot.along}`);
    assert.ok(Math.abs(spot.up - 0.7) < 0.02, `up ${spot.up}`);
});

test('the spot is in the pivot frame wherever the car is', () => {
    const { pivot, model } = coupe();
    pivot.position.set(120, 5, -40);
    pivot.rotation.set(0.05, 0.7, -0.03);
    model.position.set(0, -0.1, 0.2);
    const spot = probeHood(pivot, model, 4.6, 0.33);
    assert.ok(spot);
    assert.ok(Math.abs(spot.along - 0.88) < 0.05, `along ${spot.along}`);
    assert.ok(Math.abs(spot.up - 0.6) < 0.02, `up ${spot.up}`);
});
