// trackside objects keep off the road: builds the real fences, landmarks and
// graffiti (RaceTracksideExtras) on the real terrain, then checks that no fence
// or landmark vertex stands over the asphalt or the verges, and that every
// graffiti vertex lies on the asphalt, just above its surface
//
//   npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTrack, buildTerrain, THREE } from './race-world.mjs';
import { meshesUnder, roadSurface } from './terrain-clearance.mjs';

// graffiti is painted a little above the tarmac so it doesn't z-fight
const PAINT_MIN = -0.02;
const PAINT_MAX = 0.12;

const track = await loadTrack();
const road = roadSurface(track);
const asphalt = roadSurface(track);
const { default: RaceTracksideExtras } = await import(
    '../../src/Application/Racing/Visuals/RaceTracksideExtras.ts'
);

const vertices = (mesh, visit) => {
    mesh.updateWorldMatrix(true, false);
    const position = mesh.geometry.getAttribute('position');
    const v = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
        v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
        visit(v);
    }
};

const build = async (lite) => {
    const terrain = await buildTerrain(lite ? 'low' : 'high');
    const parent = new THREE.Group();
    const extras = new RaceTracksideExtras(parent, track, terrain, lite);
    parent.updateMatrixWorld(true);
    return extras;
};

test('fences and landmarks stand off the road and verges', async () => {
    const extras = await build(false);
    const meshes = meshesUnder(extras.root).filter((mesh) => !/graffiti/.test(mesh.name));
    assert.ok(
        meshes.some((mesh) => /fence/.test(mesh.name)),
        'expected catch fences'
    );
    const hit = { y: -Infinity, mesh: null };
    const onRoad = [];
    let checked = 0;
    for (const mesh of meshes) {
        vertices(mesh, (v) => {
            checked++;
            road.heightAt(v.x, v.z, hit);
            if (hit.y !== -Infinity && onRoad.length < 5) {
                onRoad.push(`${mesh.name} at ${Math.round(v.x)}, ${Math.round(v.z)}`);
            }
        });
    }
    assert.ok(checked > 1000, 'expected fence and landmark geometry');
    assert.deepEqual(onRoad, [], 'trackside objects over the road or verges');
});

for (const lite of [false, true]) {
    test(`graffiti lies on the asphalt (${lite ? 'weak gpu' : 'full'})`, async () => {
        const extras = await build(lite);
        const paint = meshesUnder(extras.root).filter((mesh) => /graffiti/.test(mesh.name));
        assert.ok(paint.length > 0, 'expected graffiti');
        const hit = { y: -Infinity, mesh: null };
        const bad = [];
        let checked = 0;
        for (const mesh of paint) {
            vertices(mesh, (v) => {
                checked++;
                asphalt.heightAt(v.x, v.z, hit);
                const off = hit.y === -Infinity ? null : v.y - hit.y;
                if ((off === null || off < PAINT_MIN || off > PAINT_MAX) && bad.length < 5) {
                    bad.push(`${Math.round(v.x)}, ${Math.round(v.z)}: ${off === null ? 'off the road' : `${off.toFixed(3)} m`}`);
                }
            });
        }
        assert.ok(checked >= 4 * 30, 'expected every graffiti piece');
        assert.deepEqual(bad, [], 'graffiti off the tarmac or not on its surface');
    });
}
