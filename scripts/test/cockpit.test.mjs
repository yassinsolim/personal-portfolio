// the cockpit cam's steering wheel: its frame from a wheel's vertices, and the
// cut that takes a wheel out of the cabin's mesh (the parts wholly inside the
// cylinder round the column go, a part reaching out of it stays whole)
//
//   npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import './ts-hooks.mjs';

const { CABIN, cutWheel, outsideView, wheelFrame } = await import(
    '../../src/Application/Racing/Vehicle/cockpit.ts'
);

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

// a rim raked back 25 degrees with one spoke out to the side, in centimetres
// under a scale, at a car's wheel spot
const RAKE = THREE.MathUtils.degToRad(25);
const raked = (radius = 0.18, turn = new THREE.Euler(RAKE, 0, 0)) => {
    const rim = new THREE.TorusGeometry(radius, 0.015, 8, 32);
    const spoke = new THREE.BoxGeometry(radius, 0.04, 0.02).translate(radius / 2, 0, 0);
    rim.deleteAttribute('uv');
    spoke.deleteAttribute('uv');
    const geometry = mergeGeometries([rim, spoke])
        .applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(turn))
        .translate(...CENTER)
        .scale(100, 100, 100);
    const mesh = new THREE.Mesh(geometry);
    mesh.scale.setScalar(0.01);
    new THREE.Group().add(mesh).updateMatrixWorld(true);
    return mesh;
};

test('a wheel turns about the middle of its rim, its axis up the column', () => {
    const frame = wheelFrame([raked()]);
    assert.ok(frame);
    assert.ok(frame.center.distanceTo(new THREE.Vector3(...CENTER)) < 0.002, `center ${frame.center.toArray()}`);
    // toward the driver (-z) and up, as a raked column runs
    const column = new THREE.Vector3(0, Math.sin(RAKE), -Math.cos(RAKE));
    assert.ok(frame.axis.dot(column) > 0.999, `axis ${frame.axis.toArray()}`);
    assert.ok(Math.abs(frame.radius - 0.195) < 0.005, `radius ${frame.radius}`);
});

test('parts that are no steering wheel give no frame', () => {
    assert.equal(wheelFrame([raked(0.4)]), null);
    assert.equal(wheelFrame([raked(0.05)]), null);
    assert.equal(wheelFrame([raked(0.18, new THREE.Euler(0, Math.PI / 2, 0))]), null);
    assert.equal(wheelFrame([new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3))]), null);
});

test("a remote player's clone of the car keeps its tint while the player sits inside", () => {
    const glass = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.12 });
    glass.userData = { tintZone: 'windshield', tintOpacity: 0.5 };
    const car = new THREE.Group();
    car.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glass));
    const cabin = new THREE.Group();
    cabin.name = CABIN;
    car.add(cabin);
    const clone = car.clone(true);
    outsideView(clone);
    const own = clone.children[0].material;
    assert.notEqual(own, glass);
    assert.equal(own.opacity, 0.5);
    assert.equal(glass.opacity, 0.12);
    assert.equal(clone.getObjectByName(CABIN).visible, false);
});
