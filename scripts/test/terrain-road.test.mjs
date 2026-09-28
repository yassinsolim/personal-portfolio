// the road always wins: builds the real track and the terrain at every
// quality, walks the lap every meter across the asphalt and verges (0.5 m
// apart, out to the barrier line) and fails if any level the terrain can
// draw (RaceTerrain.levels: ground tiles, skirt, each lod step) comes within
// MARGIN of the road there, or if a mesh under the terrain root isn't in a
// level. also checks trees stand on the ground that's drawn. prints the
// worst spots of each level
//
//   npm test
//   node scripts/test/terrain-road-report.mjs    for the full tables
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTrack, buildTerrain, terrainQualities } from './race-world.mjs';
import {
    SurfaceField,
    checkClearance,
    meshesUnder,
    roadSurface,
    terrainLevels,
} from './terrain-clearance.mjs';

// the carve puts the ground 1.4 m under the road, this leaves room for lod
// levels that only approximate it
const MARGIN = 1.0;
// a tree base may sit at most this far over the drawn ground
const TREE_FLOAT = 0.1;

const track = await loadTrack();
const road = roadSurface(track);
const qualities = await terrainQualities();

test('asphalt and verges share their edge vertices', () => {
    const road = track.visualMesh.geometry.getAttribute('position').array;
    const verge = track.vergeMesh.geometry.getAttribute('position').array;
    // road: left edge, right edge per station. verges: the left strip
    // (outer, inner) for every station, then the right one (inner, outer)
    const stations = road.length / 6;
    assert.equal(verge.length, road.length * 2, 'ribbon station counts');
    const right = stations * 6;
    let gaps = 0;
    let worst = 0;
    for (let i = 0; i < stations; i++) {
        for (let k = 0; k < 3; k++) {
            const left = Math.abs(road[i * 6 + k] - verge[i * 6 + 3 + k]);
            const rightGap = Math.abs(
                road[i * 6 + 3 + k] - verge[right + i * 6 + k]
            );
            if (left || rightGap) gaps++;
            worst = Math.max(worst, left, rightGap);
        }
    }
    assert.equal(gaps, 0, `edge coordinates apart, worst ${worst} m`);
});

for (const quality of qualities) {
    test(`terrain stays ${MARGIN} m under the road (${quality})`, async (t) => {
        const terrain = await buildTerrain(quality);
        const levels = terrainLevels(terrain, quality);
        assert.ok(
            levels.length >= 2,
            'expected at least the ground and the skirt'
        );
        // anything drawn under the terrain root has to be in a level
        const listed = new Set(levels.flatMap((level) => level.meshes));
        const unlisted = meshesUnder(terrain.root)
            .filter((mesh) => !listed.has(mesh))
            .map((mesh) => mesh.name);
        assert.deepEqual(unlisted, [], 'terrain meshes missing from levels()');
        const report = checkClearance(track, road, levels, { margin: MARGIN });
        for (const level of report.levels) {
            t.diagnostic(
                `${level.name}: min gap ${level.minGap} m over ${level.samples} samples`
            );
            for (const spot of level.worst.slice(0, 5)) {
                t.diagnostic(
                    `  ${spot.gap} m at ${spot.distance} m (${spot.section}), lateral ${spot.lateral} ${spot.band}, ${spot.mesh}`
                );
            }
        }
        // the road ribbons themselves have to be there to compare against
        assert.equal(
            report.missingRoad,
            0,
            'samples with no road surface drawn'
        );
        assert.deepEqual(
            report.levels
                .filter((level) => level.violations > 0)
                .map(
                    (level) =>
                        `${level.name}: ${level.violations} samples under ${MARGIN} m, ` +
                        `worst ${level.minGap} m at ${level.worst[0].distance} m (${level.worst[0].section})`
                ),
            []
        );
    });

    test(`trees stand on the drawn ground (${quality})`, async () => {
        const terrain = await buildTerrain(quality);
        const { default: RaceForest } = await import(
            '../../src/Application/Racing/Visuals/RaceForest.ts'
        );
        // placement only, without the renderer the forest needs for its billboards
        const trees = RaceForest.prototype.placeTrees
            .call({}, track, terrain, quality === 'high' ? 32000 : 8000)
            .flat();
        assert.ok(trees.length > 1000, 'expected a forest');
        const ground = new SurfaceField(meshesUnder(terrain.root));
        const hit = { y: -Infinity, mesh: null };
        const floating = [];
        for (const tree of trees) {
            ground.heightAt(tree.x, tree.z, hit);
            if (hit.y === -Infinity) continue;
            const float = tree.y - hit.y;
            if (float > TREE_FLOAT)
                floating.push({
                    x: Math.round(tree.x),
                    z: Math.round(tree.z),
                    float: +float.toFixed(2),
                });
        }
        floating.sort((a, b) => b.float - a.float);
        assert.deepEqual(
            floating.slice(0, 5),
            [],
            `${floating.length} trees float over the ground`
        );
    });
}
