// the roads under the lap's bridges stay open: builds the terrain at every
// quality and fails if any level it can draw (ground tiles, lod steps, the
// skirt) comes within MARGIN of an underpass road's surface anywhere across
// its width, and checks the skirt really stops under each bridge
//
//   npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTrack, buildTerrain, terrainQualities } from './race-world.mjs';
import { terrainLevels } from './terrain-clearance.mjs';

const MARGIN = 0.2;

const track = await loadTrack();
const qualities = await terrainQualities();

test('the track data has its underpasses', () => {
    assert.ok(track.spans.length >= 4, 'spans');
    assert.ok(track.underpasses.length >= 4, 'underpasses');
    track.underpasses.forEach((road) => {
        assert.ok(road.points.length >= 4, `${road.ref} points`);
        assert.ok(road.width >= 5, `${road.ref} width`);
    });
});

for (const quality of qualities) {
    test(`underpass roads are clear of the terrain (${quality})`, async (t) => {
        const terrain = await buildTerrain(quality);
        const levels = terrainLevels(terrain, quality);
        const bad = [];
        const worst = new Map();
        track.underpasses.forEach((road) => {
            const half = road.width / 2;
            const points = road.points;
            for (let i = 0; i + 1 < points.length; i++) {
                const [x0, y0, z0] = points[i];
                const [x1, y1, z1] = points[i + 1];
                const length = Math.hypot(x1 - x0, z1 - z0);
                const nx = -(z1 - z0) / length;
                const nz = (x1 - x0) / length;
                for (let f = 0; f <= 1; f += 0.25) {
                    const x = x0 + (x1 - x0) * f;
                    const y = y0 + (y1 - y0) * f;
                    const z = z0 + (z1 - z0) * f;
                    for (let l = -half; l <= half + 1e-6; l += 0.5) {
                        const sx = x + nx * l;
                        const sz = z + nz * l;
                        levels.forEach((level) => {
                            const hit = level.field.heightAt(sx, sz);
                            if (hit.y === -Infinity) return;
                            const gap = y - hit.y;
                            const key = `${level.name} ${road.ref}`;
                            if (!worst.has(key) || gap < worst.get(key))
                                worst.set(key, gap);
                            if (gap < MARGIN)
                                bad.push(`${key} gap ${gap.toFixed(2)} m`);
                        });
                    }
                }
            }
        });
        [...worst].forEach(([key, gap]) =>
            t.diagnostic(`${key}: min gap ${gap.toFixed(2)} m`)
        );
        assert.deepEqual(bad.slice(0, 8), []);
    });

    test(`the skirt stops under the lap's bridges (${quality})`, async () => {
        const terrain = await buildTerrain(quality);
        const skirt = terrainLevels(terrain, quality).find((level) =>
            level.name.endsWith('/skirt')
        );
        const curve = track.visualCurve;
        const covered = [];
        track.spans.forEach((span) => {
            const d = ((span.start + span.end) / 2) * track.distanceScale;
            const p = curve.getPointAt(d / track.length);
            const dir = curve.getTangentAt(d / track.length);
            // just outside the verge on both sides, under the deck
            const reach = track.getVergeHalfWidth(d / track.length) + 1.5;
            [1, -1].forEach((sign) => {
                const x = p.x - dir.z * sign * reach;
                const z = p.z + dir.x * sign * reach;
                if (skirt.field.heightAt(x, z).y !== -Infinity)
                    covered.push(`${span.start} m side ${sign}`);
            });
        });
        assert.deepEqual(covered, []);
    });
}
