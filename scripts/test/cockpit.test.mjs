// the cockpit cam's steering wheel cut: the parts wholly inside the cylinder
// round the column leave the cabin's mesh for a mesh of their own, and a part
// reaching out of it (here the column) stays whole
//
//   npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import './ts-hooks.mjs';

const { cutWheel } = await import('../../src/Application/Racing/Vehicle/cockpit.ts');

const CENTER = [0.37, 0.5, 0.3];
const triangles = (geometry) =>
    (geometry.index ? geometry.index.count : geometry.getAttribute('position').count) / 3;

// one cabin mesh: a rim facing the driver (-z), and the column running from
// its middle forward into the dash, in centimetres under a scale like the
// exports
const cabin = () => {
    const rim = new THREE.TorusGeometry(0.18, 0.015, 8, 24).translate(...CENTER);
    const column = new THREE.CylinderGeometry(0.03, 0.03, 0.3, 12, 6, true)
        .rotateX(Math.PI / 2)
        .translate(CENTER[0], CENTER[1], CENTER[2] + 0.15);
    const geometry = mergeGeometries([rim, column]).scale(100, 100, 100);
    const material = new THREE.MeshStandardMaterial({ name: 'InteriorA' });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.setScalar(0.01);
    const model = new THREE.Group();
    model.add(mesh);
    model.updateMatrixWorld(true);
    return { model, mesh, rim: triangles(rim), column: triangles(column) };
};

const cut = {
    center: CENTER,
    axis: [0, 0, -1],
    radius: 0.21,
    along: [-0.05, 0.05],
    material: /InteriorA/,
};

test('the rim leaves the cabin mesh, the column stays', () => {
    const { model, mesh, rim, column } = cabin();
    const before = mesh.geometry;
    const pieces = cutWheel(model, cut);
    assert.equal(pieces.length, 1);
    assert.equal(triangles(pieces[0].geometry), rim);
    assert.equal(triangles(mesh.geometry), column);
    assert.equal(pieces[0].parent, mesh.parent);
    // a clone of the model shares its geometries, so they're never changed
    assert.notEqual(mesh.geometry, before);
    assert.equal(triangles(before), rim + column);
});

test('the cut piece stays where the rim was', () => {
    const { model } = cabin();
    const [piece] = cutWheel(model, cut);
    piece.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(piece);
    const middle = box.getCenter(new THREE.Vector3());
    assert.ok(middle.distanceTo(new THREE.Vector3(...CENTER)) < 1e-3, `middle ${middle.toArray()}`);
    assert.ok(Math.abs(box.max.x - box.min.x - 0.39) < 1e-3, `width ${box.max.x - box.min.x}`);
});

test('nothing is cut from another material or outside the cylinder', () => {
    const { model, mesh, rim, column } = cabin();
    assert.equal(cutWheel(model, { ...cut, material: /Paint/ }).length, 0);
    assert.equal(cutWheel(model, { ...cut, radius: 0.1 }).length, 0);
    assert.equal(triangles(mesh.geometry), rim + column);
});
