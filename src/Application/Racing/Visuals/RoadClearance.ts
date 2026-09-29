import * as THREE from 'three';
import type NordschleifeTrack from '../Track/NordschleifeTrack';

// keeps every drawn terrain surface under the road. the asphalt and verges
// are sampled across their full width at each ribbon station and halfway
// between, on the same banked frames the ribbons are built from, so the
// karussell's bank and every crest and dip are in there. a surface is carved
// by lowering its vertices just enough that no sample sits less than
// CARVE_DEPTH above it. heights only ever go down, so one pass settles every
// sample: a later step can't lift a point an earlier one already cleared.
// any terrain level (grid tiles at any cell size, the skirt, lod levels) goes
// through carveGrid or carveTriangles before its normals and bounds are made

export const CARVE_DEPTH = 1.4;
// meters between samples across the road
const LATERAL_STEP = 0.75;
// the outermost samples sit this far inside the verge's outer edge, where
// the skirt is attached
const EDGE_INSET = 0.05;
const TRIANGLE_BIN = 8;

export type SampleVisitor = (x: number, z: number, ceiling: number) => void;
export type SampleSource = (visit: SampleVisitor) => void;

export default class RoadClearance {
    stations: number;
    // point, banked side vector, road and verge half widths per ribbon station
    frames: Float32Array;

    constructor(track: NordschleifeTrack) {
        const stations = track.getRibbonSamples();
        this.stations = stations;
        this.frames = new Float32Array(stations * 8);
        const point = new THREE.Vector3();
        const tangent = new THREE.Vector3();
        const normal = new THREE.Vector3();
        const side = new THREE.Vector3(1, 0, 0);
        const previousSide = new THREE.Vector3(1, 0, 0);
        for (let i = 0; i < stations; i++) {
            const t = i / stations;
            track.getRibbonFrame(
                track.visualCurve,
                t,
                point,
                tangent,
                normal,
                side,
                previousSide
            );
            const o = i * 8;
            this.frames[o] = point.x;
            this.frames[o + 1] = point.y;
            this.frames[o + 2] = point.z;
            this.frames[o + 3] = side.x;
            this.frames[o + 4] = side.y;
            this.frames[o + 5] = side.z;
            this.frames[o + 6] = track.getRoadHalfWidth(t);
            this.frames[o + 7] = track.getVergeHalfWidth(t);
        }
    }

    // every road sample with the highest the ground may be there. a mask (one
    // entry per ribbon station) limits it to part of the lap
    forEachSample(visit: SampleVisitor, mask?: Uint8Array) {
        const f = this.frames;
        const stations = this.stations;
        for (let i = 0; i < stations; i++) {
            if (mask && !mask[i]) continue;
            const a = i * 8;
            const b = ((i + 1) % stations) * 8;
            for (let half = 0; half < 2; half++) {
                const k = half * 0.5;
                const lerp = (offset: number) =>
                    f[a + offset] + (f[b + offset] - f[a + offset]) * k;
                const px = lerp(0);
                const py = lerp(1);
                const pz = lerp(2);
                const sx = lerp(3);
                const sy = lerp(4);
                const sz = lerp(5);
                const roadHalf = lerp(6);
                const reach = lerp(7) - EDGE_INSET;
                const lanes = Math.ceil((reach * 2) / LATERAL_STEP);
                for (let n = 0; n <= lanes + 2; n++) {
                    const lateral =
                        n <= lanes
                            ? -reach + ((reach * 2) / lanes) * n
                            : n === lanes + 1
                              ? roadHalf
                              : -roadHalf;
                    visit(
                        px + sx * lateral,
                        pz + sz * lateral,
                        py + sy * lateral - CARVE_DEPTH
                    );
                }
            }
        }
    }

    // a regular grid, split into triangles along the diagonal from (row,
    // col + 1) to (row + 1, col) like RaceTerrain.buildGround does. mobility
    // (0..1 per vertex) says which vertices should take the drop: the ones
    // hidden under the road and skirt, so the ground in view barely moves
    carveGrid(
        positions: Float32Array,
        cols: number,
        rows: number,
        cell: number,
        minX: number,
        minZ: number,
        mobility: Float32Array,
        // other surfaces to clear instead of the lap, like the underpasses
        each: SampleSource = (visit) => this.forEachSample(visit)
    ) {
        let lowered = 0;
        each((x, z, ceiling) => {
            const fx = (x - minX) / cell;
            const fz = (z - minZ) / cell;
            const col = Math.floor(fx);
            const row = Math.floor(fz);
            if (col < 0 || row < 0 || col >= cols - 1 || row >= rows - 1)
                return;
            const u = fx - col;
            const v = fz - row;
            const a = row * cols + col;
            const b = a + 1;
            const c = a + cols;
            if (u + v <= 1) {
                lowered += lower(
                    positions,
                    mobility,
                    ceiling,
                    a,
                    b,
                    c,
                    1 - u - v,
                    u,
                    v
                );
            } else {
                lowered += lower(
                    positions,
                    mobility,
                    ceiling,
                    c + 1,
                    b,
                    c,
                    u + v - 1,
                    1 - v,
                    1 - u
                );
            }
        });
        return lowered;
    }

    // any triangle soup. only the listed triangles are carved (all of them if
    // none are given). mobility 0 pins a vertex, like the skirt's inner edge
    // that is shared with the verge
    carveTriangles(
        positions: Float32Array,
        index: ArrayLike<number>,
        mobility: Float32Array,
        triangles?: ArrayLike<number>,
        mask?: Uint8Array,
        each: SampleSource = (visit) => this.forEachSample(visit, mask)
    ) {
        const lookup = new TriangleIndex(positions, index, triangles);
        if (!lookup.count) return 0;
        let lowered = 0;
        each((x, z, ceiling) => {
            lookup.forEachAt(x, z, (ia, ib, ic, wa, wb, wc) => {
                lowered += lower(
                    positions,
                    mobility,
                    ceiling,
                    ia,
                    ib,
                    ic,
                    wa,
                    wb,
                    wc
                );
            });
        });
        return lowered;
    }
}

type TriangleVisitor = (
    ia: number,
    ib: number,
    ic: number,
    wa: number,
    wb: number,
    wc: number
) => void;

// finds the triangles over a point, binned on a grid in x and z. positions
// are read live, so heights can change after it's built (not x or z)
export class TriangleIndex {
    positions: Float32Array;
    index: ArrayLike<number>;
    count: number;
    minX: number;
    minZ: number;
    cols: number;
    rows: number;
    offsets: Int32Array;
    items: Int32Array;
    bin: number;

    constructor(
        positions: Float32Array,
        index: ArrayLike<number>,
        triangles?: ArrayLike<number>,
        bin = TRIANGLE_BIN
    ) {
        this.positions = positions;
        this.index = index;
        this.bin = bin;
        const list =
            triangles ??
            Int32Array.from(
                { length: Math.floor(index.length / 3) },
                (_, i) => i
            );
        this.count = list.length;
        let minX = Infinity;
        let minZ = Infinity;
        let maxX = -Infinity;
        let maxZ = -Infinity;
        const bounds = new Float32Array(list.length * 4);
        for (let k = 0; k < list.length; k++) {
            let x0 = Infinity;
            let x1 = -Infinity;
            let z0 = Infinity;
            let z1 = -Infinity;
            for (let j = 0; j < 3; j++) {
                const v = index[list[k] * 3 + j];
                x0 = Math.min(x0, positions[v * 3]);
                x1 = Math.max(x1, positions[v * 3]);
                z0 = Math.min(z0, positions[v * 3 + 2]);
                z1 = Math.max(z1, positions[v * 3 + 2]);
            }
            bounds.set([x0, x1, z0, z1], k * 4);
            minX = Math.min(minX, x0);
            maxX = Math.max(maxX, x1);
            minZ = Math.min(minZ, z0);
            maxZ = Math.max(maxZ, z1);
        }
        this.minX = minX;
        this.minZ = minZ;
        this.cols = list.length ? Math.floor((maxX - minX) / bin) + 1 : 0;
        this.rows = list.length ? Math.floor((maxZ - minZ) / bin) + 1 : 0;
        const cells = this.cols * this.rows;
        const counts = new Int32Array(cells + 1);
        const visitBins = (k: number, visit: (cell: number) => void) => {
            const c0 = Math.floor((bounds[k * 4] - minX) / bin);
            const c1 = Math.floor((bounds[k * 4 + 1] - minX) / bin);
            const r0 = Math.floor((bounds[k * 4 + 2] - minZ) / bin);
            const r1 = Math.floor((bounds[k * 4 + 3] - minZ) / bin);
            for (let r = r0; r <= r1; r++)
                for (let c = c0; c <= c1; c++) visit(r * this.cols + c);
        };
        for (let k = 0; k < list.length; k++)
            visitBins(k, (cell) => counts[cell + 1]++);
        for (let i = 0; i < cells; i++) counts[i + 1] += counts[i];
        const fill = counts.slice(0, cells);
        this.offsets = counts;
        this.items = new Int32Array(counts[cells]);
        for (let k = 0; k < list.length; k++)
            visitBins(k, (cell) => (this.items[fill[cell]++] = list[k]));
    }

    // every triangle whose footprint holds x,z, with the point's weights
    forEachAt(x: number, z: number, visit: TriangleVisitor) {
        const c = Math.floor((x - this.minX) / this.bin);
        const r = Math.floor((z - this.minZ) / this.bin);
        if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return;
        const bin = r * this.cols + c;
        const p = this.positions;
        const index = this.index;
        for (let k = this.offsets[bin]; k < this.offsets[bin + 1]; k++) {
            const t = this.items[k];
            const ia = index[t * 3];
            const ib = index[t * 3 + 1];
            const ic = index[t * 3 + 2];
            const ax = p[ia * 3];
            const az = p[ia * 3 + 2];
            const bx = p[ib * 3];
            const bz = p[ib * 3 + 2];
            const cx = p[ic * 3];
            const cz = p[ic * 3 + 2];
            const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
            if (Math.abs(d) < 1e-9) continue;
            const wa = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
            const wb = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
            const wc = 1 - wa - wb;
            if (wa < -1e-6 || wb < -1e-6 || wc < -1e-6) continue;
            visit(ia, ib, ic, wa, wb, wc);
        }
    }

    // the highest surface over x,z, -Infinity where there's none
    heightAt(x: number, z: number) {
        let best = -Infinity;
        const p = this.positions;
        this.forEachAt(x, z, (ia, ib, ic, wa, wb, wc) => {
            best = Math.max(
                best,
                wa * p[ia * 3 + 1] + wb * p[ib * 3 + 1] + wc * p[ic * 3 + 1]
            );
        });
        return best;
    }
}

// drops a triangle's vertices so its surface at the weighted point comes down
// to the ceiling. the drop is shared by weight and mobility, which is the
// smallest change that does it
const lower = (
    positions: Float32Array,
    mobility: Float32Array,
    ceiling: number,
    ia: number,
    ib: number,
    ic: number,
    wa: number,
    wb: number,
    wc: number
) => {
    const y =
        wa * positions[ia * 3 + 1] +
        wb * positions[ib * 3 + 1] +
        wc * positions[ic * 3 + 1];
    const over = y - ceiling;
    if (over <= 0) return 0;
    const ma = mobility[ia] * wa;
    const mb = mobility[ib] * wb;
    const mc = mobility[ic] * wc;
    const weight = ma * wa + mb * wb + mc * wc;
    if (weight <= 1e-9) return 0;
    const k = over / weight;
    positions[ia * 3 + 1] -= k * ma;
    positions[ib * 3 + 1] -= k * mb;
    positions[ic * 3 + 1] -= k * mc;
    return 1;
};
