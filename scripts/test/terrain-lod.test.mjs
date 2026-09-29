// terrain lod layout: tiles cover the grid once and every quality has tiles
// that can go coarse, neighboring tiles use the same vertices along every
// shared edge at whatever steps the camera picks (no cracks), no tile goes
// coarser than its cap, and the light path's batched ground holds exactly the
// visible tiles as they're currently stitched. the clearance of every level
// and stitched edge is checked in terrain-road.test.mjs
//
//   npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    loadTrack,
    buildTerrain,
    terrainQualities,
    THREE,
} from './race-world.mjs';

const track = await loadTrack();
const qualities = await terrainQualities();

// camera spots: chase views along the lap, and some from high above
const views = () => {
    const out = [];
    const curve = track.visualCurve;
    for (let i = 0; i < 40; i++) {
        const t = i / 40;
        const p = curve.getPointAt(t);
        const g = curve.getTangentAt(t);
        out.push([p.x - g.x * 8, p.y + 3, p.z - g.z * 8, g.x, g.z, 60]);
    }
    for (let i = 0; i < 20; i++) {
        const t = (i + 0.5) / 20;
        const p = curve.getPointAt(t);
        const g = curve.getTangentAt(t);
        out.push([p.x - g.x * 600, p.y + 400, p.z - g.z * 600, g.x, g.z, 900]);
    }
    return out;
};

const aim = (camera, [x, y, z, gx, gz, ahead]) => {
    camera.position.set(x, y, z);
    camera.lookAt(x + gx * ahead, y - (y > 200 ? 0 : 2), z + gz * ahead);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
};

const edgeVertices = (tile, cols, pick) => {
    const index = tile.mesh.geometry.getIndex().array;
    const set = new Set();
    for (const v of index) {
        const row = Math.floor(v / cols);
        const col = v % cols;
        if (pick(row, col)) set.add(v);
    }
    return [...set].sort((a, b) => a - b).join(',');
};

for (const quality of qualities) {
    test(`tiles cover the grid once and can go coarse (${quality})`, async () => {
        const terrain = await buildTerrain(quality);
        const { cols, rows, cell } = terrain.grid;
        let quads = 0;
        terrain.tiles.forEach((tile) => {
            quads += (tile.r1 - tile.r0) * (tile.c1 - tile.c0);
        });
        assert.equal(quads, (cols - 1) * (rows - 1), 'tiles cover the grid');
        const free = terrain.tiles.filter((tile) => tile.cap > 1).length;
        assert.ok(
            free / terrain.tiles.length > 0.25,
            `${free} of ${terrain.tiles.length} tiles can go coarse`
        );
        assert.ok(terrain.tileQuads * cell <= 1000, 'tile size');
    });

    test(`stitched edges match at every step (${quality})`, async () => {
        const terrain = await buildTerrain(quality);
        const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 9000);
        const cols = terrain.grid.cols;
        const at = (tr, tc) => terrain.tiles[tr * terrain.tileCols + tc];
        const cracks = [];
        const steps = new Set();
        for (const view of views()) {
            aim(camera, view);
            terrain.updateLod(camera);
            terrain.tiles.forEach((tile, i) => {
                steps.add(tile.step);
                assert.ok(tile.step <= tile.cap, 'step within cap');
                const tr = Math.floor(i / terrain.tileCols);
                const tc = i % terrain.tileCols;
                if (tr + 1 < terrain.tileRows) {
                    const below = at(tr + 1, tc);
                    const a = edgeVertices(tile, cols, (r) => r === tile.r1);
                    const b = edgeVertices(below, cols, (r) => r === below.r0);
                    if (a !== b) cracks.push(`${tr},${tc} below`);
                }
                if (tc + 1 < terrain.tileCols) {
                    const right = at(tr, tc + 1);
                    const a = edgeVertices(tile, cols, (r, c) => c === tile.c1);
                    const b = edgeVertices(
                        right,
                        cols,
                        (r, c) => c === right.c0
                    );
                    if (a !== b) cracks.push(`${tr},${tc} right`);
                }
            });
        }
        assert.deepEqual(cracks.slice(0, 8), []);
        assert.ok(steps.size > 1, `only step ${[...steps]} was used`);
    });

    test(`the batched ground holds the visible tiles (${quality})`, async (t) => {
        const terrain = await buildTerrain(quality);
        if (!terrain.batch) {
            t.diagnostic('no batch at this quality');
            return;
        }
        const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 1000);
        const frustum = new THREE.Frustum();
        const matrix = new THREE.Matrix4();
        let drawn = 0;
        let full = 0;
        for (const view of views()) {
            aim(camera, view);
            terrain.lodCheckedAt = 0;
            terrain.update(camera);
            matrix.multiplyMatrices(
                camera.projectionMatrix,
                camera.matrixWorldInverse
            );
            frustum.setFromProjectionMatrix(matrix);
            const expected = [];
            terrain.tiles.forEach((tile, i) => {
                if (terrain.batch.visible[i])
                    expected.push(...tile.mesh.geometry.getIndex().array);
                else
                    assert.ok(
                        !frustum.intersectsSphere(
                            tile.mesh.geometry.boundingSphere
                        ),
                        `tile ${i} is in view but not in the batch`
                    );
            });
            const range = terrain.batch.mesh.geometry.drawRange;
            const got = terrain.batch.index.array.subarray(
                range.start,
                range.start + range.count
            );
            assert.equal(got.length, expected.length, 'batch size');
            assert.ok(
                got.every((v, i) => v === expected[i]),
                'batch matches the tiles'
            );
            drawn += got.length / 3;
            full += terrain.batch.index.array.length / 3;
        }
        t.diagnostic(
            `batch draws ${Math.round((drawn / full) * 100)}% of the grid on average`
        );
    });
}
