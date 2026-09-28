// terrain vs road clearance: walks the whole lap and, at every station and
// lateral offset across the road and its verges, compares the rendered road
// surface with the highest terrain surface above that point. works on any
// meshes (every tile, skirt piece or lod level), so it checks what is drawn,
// not the height functions that built it
import * as THREE from 'three';

// highest surface of a set of meshes at any x,z. every triangle is binned on
// a 2d grid in world space
export class SurfaceField {
    constructor(meshes, bin = 8) {
        const triangles = [];
        const owners = [];
        const a = new THREE.Vector3();
        const b = new THREE.Vector3();
        const c = new THREE.Vector3();
        meshes.forEach((mesh, owner) => {
            mesh.updateWorldMatrix(true, false);
            const position = mesh.geometry.getAttribute('position');
            const index = mesh.geometry.getIndex();
            const count = index ? index.count : position.count;
            for (let i = 0; i + 2 < count; i += 3) {
                const ia = index ? index.getX(i) : i;
                const ib = index ? index.getX(i + 1) : i + 1;
                const ic = index ? index.getX(i + 2) : i + 2;
                a.fromBufferAttribute(position, ia).applyMatrix4(
                    mesh.matrixWorld
                );
                b.fromBufferAttribute(position, ib).applyMatrix4(
                    mesh.matrixWorld
                );
                c.fromBufferAttribute(position, ic).applyMatrix4(
                    mesh.matrixWorld
                );
                const d = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
                if (Math.abs(d) < 1e-9) continue;
                triangles.push(
                    c.x,
                    c.z,
                    (b.z - c.z) / d,
                    (c.x - b.x) / d,
                    (c.z - a.z) / d,
                    (a.x - c.x) / d,
                    a.y,
                    b.y,
                    c.y,
                    Math.min(a.x, b.x, c.x),
                    Math.max(a.x, b.x, c.x),
                    Math.min(a.z, b.z, c.z),
                    Math.max(a.z, b.z, c.z)
                );
                owners.push(owner);
            }
        });
        this.meshes = meshes;
        this.data = Float64Array.from(triangles);
        this.owners = Int32Array.from(owners);
        this.count = owners.length;
        this.bin = bin;
        let minX = Infinity;
        let minZ = Infinity;
        let maxX = -Infinity;
        let maxZ = -Infinity;
        for (let t = 0; t < this.count; t++) {
            const o = t * 13;
            minX = Math.min(minX, this.data[o + 9]);
            maxX = Math.max(maxX, this.data[o + 10]);
            minZ = Math.min(minZ, this.data[o + 11]);
            maxZ = Math.max(maxZ, this.data[o + 12]);
        }
        this.minX = minX;
        this.minZ = minZ;
        this.cols = Math.max(1, Math.ceil((maxX - minX) / bin) + 1);
        this.rows = Math.max(1, Math.ceil((maxZ - minZ) / bin) + 1);
        const cells = this.cols * this.rows;
        const counts = new Int32Array(cells + 1);
        const each = (t, visit) => {
            const o = t * 13;
            const c0 = Math.floor((this.data[o + 9] - minX) / bin);
            const c1 = Math.floor((this.data[o + 10] - minX) / bin);
            const r0 = Math.floor((this.data[o + 11] - minZ) / bin);
            const r1 = Math.floor((this.data[o + 12] - minZ) / bin);
            for (let r = r0; r <= r1; r++)
                for (let col = c0; col <= c1; col++) visit(r * this.cols + col);
        };
        for (let t = 0; t < this.count; t++)
            each(t, (cell) => counts[cell + 1]++);
        for (let i = 0; i < cells; i++) counts[i + 1] += counts[i];
        const fill = counts.slice(0, cells);
        this.offsets = counts;
        this.items = new Int32Array(counts[cells]);
        for (let t = 0; t < this.count; t++)
            each(t, (cell) => (this.items[fill[cell]++] = t));
    }

    // highest surface at x,z, and the mesh it belongs to. -Infinity if none
    heightAt(x, z, hit = { y: -Infinity, mesh: null }) {
        hit.y = -Infinity;
        hit.mesh = null;
        const col = Math.floor((x - this.minX) / this.bin);
        const row = Math.floor((z - this.minZ) / this.bin);
        if (col < 0 || row < 0 || col >= this.cols || row >= this.rows)
            return hit;
        const cell = row * this.cols + col;
        const data = this.data;
        for (let k = this.offsets[cell]; k < this.offsets[cell + 1]; k++) {
            const t = this.items[k];
            const o = t * 13;
            if (x < data[o + 9] - 1e-6 || x > data[o + 10] + 1e-6) continue;
            if (z < data[o + 11] - 1e-6 || z > data[o + 12] + 1e-6) continue;
            const dx = x - data[o];
            const dz = z - data[o + 1];
            const w1 = data[o + 2] * dx + data[o + 3] * dz;
            const w2 = data[o + 4] * dx + data[o + 5] * dz;
            const w3 = 1 - w1 - w2;
            if (w1 < -1e-7 || w2 < -1e-7 || w3 < -1e-7) continue;
            const y = w1 * data[o + 6] + w2 * data[o + 7] + w3 * data[o + 8];
            if (y > hit.y) {
                hit.y = y;
                hit.mesh = this.meshes[this.owners[t]];
            }
        }
        return hit;
    }
}

export const meshesUnder = (object) => {
    const meshes = [];
    object.traverse((child) => {
        if (child.isMesh && child.geometry?.getAttribute('position'))
            meshes.push(child);
    });
    return meshes;
};

// the drawn road: asphalt plus the grass verges out to the barriers. kerbs,
// lines and the karussell concrete sit on top of the asphalt, so the asphalt
// is the lowest drawn road surface
export const roadSurface = (track) =>
    new SurfaceField(
        ['nordschleife-visual', 'nordschleife-verge'].flatMap((name) => {
            const group = track.root.getObjectByName(name);
            if (!group) throw new Error(`missing road mesh ${name}`);
            return meshesUnder(group);
        })
    );

// every level the terrain can draw (RaceTerrain.levels: ground tiles, skirt,
// each lod step), or one per direct child of the root on older code
export const terrainLevels = (terrain, prefix) =>
    (typeof terrain.levels === 'function'
        ? terrain.levels()
        : terrain.root.children.map((child) => ({
              name: child.name,
              meshes: meshesUnder(child),
          }))
    )
        .map((level) => ({
            name: `${prefix}/${level.name}`,
            meshes: level.meshes,
            field: new SurfaceField(level.meshes),
        }))
        .filter((level) => level.field.count > 0);

const BARRIER_LINE = 0.15;
// the asphalt edge samples sit this far inside it: the ribbons' 2 m chords
// cut a couple of cm inside the curve on tight corners, and on a bank the
// verge's drop along the tilted normal leaves a hairline between the two
const EDGE_INSIDE = 0.05;

// walks the lap: every `step` meters, lateral offsets every `lateralStep`
// across the asphalt and verges up to the barrier line
export function checkClearance(track, road, levels, options = {}) {
    const step = options.step ?? 1;
    const lateralStep = options.lateralStep ?? 0.5;
    const margin = options.margin ?? 0.3;
    const window = options.window ?? 40;
    const keep = options.keep ?? 12;
    const curve = track.visualCurve;
    const point = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const side = new THREE.Vector3(1, 0, 0);
    const previousSide = new THREE.Vector3(1, 0, 0);
    const sample = new THREE.Vector3();
    const roadHit = { y: -Infinity, mesh: null };
    const terrainHit = { y: -Infinity, mesh: null };
    const stations = Math.floor(track.length / step);
    const results = levels.map((level) => ({
        name: level.name,
        samples: 0,
        violations: 0,
        minGap: Infinity,
        spots: new Map(),
    }));
    let missingRoad = 0;
    const missingAt = [];
    for (let s = 0; s < stations; s++) {
        const t = s / stations;
        const distance = t * track.length;
        track.getRibbonFrame(
            curve,
            t,
            point,
            tangent,
            normal,
            side,
            previousSide
        );
        const roadHalf = track.getRoadHalfWidth(t);
        const reach = track.getVergeHalfWidth(t) - BARRIER_LINE;
        const laterals = [
            reach,
            roadHalf - EDGE_INSIDE,
            EDGE_INSIDE - roadHalf,
        ];
        for (let l = -reach; l < reach; l += lateralStep) {
            if (Math.abs(Math.abs(l) - roadHalf) > EDGE_INSIDE)
                laterals.push(l);
        }
        for (const lateral of laterals) {
            sample.copy(point).addScaledVector(side, lateral);
            road.heightAt(sample.x, sample.z, roadHit);
            let roadY = roadHit.y;
            if (roadY === -Infinity) {
                missingRoad++;
                if (missingAt.length < 10) {
                    missingAt.push({
                        distance: +distance.toFixed(1),
                        lateral: +lateral.toFixed(3),
                    });
                }
                roadY = sample.y;
            }
            const band = Math.abs(lateral) <= roadHalf ? 'road' : 'verge';
            levels.forEach((level, i) => {
                level.field.heightAt(sample.x, sample.z, terrainHit);
                if (terrainHit.y === -Infinity) return;
                const result = results[i];
                const gap = roadY - terrainHit.y;
                result.samples++;
                if (gap < result.minGap) result.minGap = gap;
                if (gap < margin) result.violations++;
                const key = Math.floor(distance / window);
                const spot = result.spots.get(key);
                if (!spot || gap < spot.gap) {
                    result.spots.set(key, {
                        distance: Math.round(distance),
                        section: track.getSectionAt(distance)?.name ?? '',
                        lateral: +lateral.toFixed(2),
                        band,
                        gap: +gap.toFixed(3),
                        roadY: +roadY.toFixed(2),
                        terrainY: +terrainHit.y.toFixed(2),
                        mesh: terrainHit.mesh?.name ?? '',
                        x: +sample.x.toFixed(1),
                        z: +sample.z.toFixed(1),
                    });
                }
            });
        }
    }
    return {
        margin,
        step,
        lateralStep,
        missingRoad,
        missingAt,
        levels: results.map((result) => {
            const worst = [...result.spots.values()]
                .sort((p, q) => p.gap - q.gap)
                .slice(0, keep);
            const spotsUnderMargin = [...result.spots.values()].filter(
                (spot) => spot.gap < margin
            ).length;
            return {
                name: result.name,
                samples: result.samples,
                violations: result.violations,
                spotsUnderMargin,
                minGap: +result.minGap.toFixed(3),
                worst,
            };
        }),
    };
}
