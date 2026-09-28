import type NordschleifeTrack from '../Track/NordschleifeTrack';

// answers "how far is this point from the road, and how high is the road
// near it" for any point on the map, fast enough to shape a whole terrain
// grid and place thousands of trees. uses the track's evenly spaced samples
// with a spatial hash near the road and a smooth height field far from it

const CELL = 48;
const BASE_STEP = 90;
const BASE_SAMPLE_STRIDE = 8;

export type TrackNearest = {
    distance: number;
    roadY: number;
    index: number;
};

const hash2 = (x: number, y: number) => {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const smooth = (t: number) => t * t * (3 - 2 * t);

// value noise, 0..1
export const valueNoise = (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = smooth(x - xi);
    const yf = smooth(y - yi);
    const a = hash2(xi, yi);
    const b = hash2(xi + 1, yi);
    const c = hash2(xi, yi + 1);
    const d = hash2(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
};

export const fbm = (x: number, y: number, octaves = 4) => {
    let sum = 0;
    let amplitude = 0.5;
    let frequency = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
        sum += valueNoise(x * frequency, y * frequency) * amplitude;
        norm += amplitude;
        amplitude *= 0.5;
        frequency *= 2.03;
    }
    return sum / norm;
};

export default class TrackField {
    track: NordschleifeTrack;
    count: number;
    points: Float32Array;
    cells: Map<number, number[]>;
    minX: number;
    minZ: number;
    maxX: number;
    maxZ: number;
    baseCols: number;
    baseRows: number;
    baseHeights: Float32Array;

    constructor(track: NordschleifeTrack, margin: number) {
        this.track = track;
        this.points = track.framePoints;
        this.count = track.getSampleCount();
        this.cells = new Map();
        let minX = Infinity;
        let minZ = Infinity;
        let maxX = -Infinity;
        let maxZ = -Infinity;
        for (let i = 0; i < this.count; i++) {
            const x = this.points[i * 3];
            const z = this.points[i * 3 + 2];
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minZ = Math.min(minZ, z);
            maxZ = Math.max(maxZ, z);
            const key = this.cellKey(
                Math.floor(x / CELL),
                Math.floor(z / CELL)
            );
            const list = this.cells.get(key);
            if (list) list.push(i);
            else this.cells.set(key, [i]);
        }
        this.minX = minX - margin;
        this.minZ = minZ - margin;
        this.maxX = maxX + margin;
        this.maxZ = maxZ + margin;

        // far from the road the ground follows the road's height smoothly:
        // inverse distance weighting of a subset of samples on a coarse grid
        this.baseCols = Math.ceil((this.maxX - this.minX) / BASE_STEP) + 1;
        this.baseRows = Math.ceil((this.maxZ - this.minZ) / BASE_STEP) + 1;
        this.baseHeights = new Float32Array(this.baseCols * this.baseRows);
        for (let row = 0; row < this.baseRows; row++) {
            for (let col = 0; col < this.baseCols; col++) {
                const x = this.minX + col * BASE_STEP;
                const z = this.minZ + row * BASE_STEP;
                let weight = 0;
                let height = 0;
                for (let i = 0; i < this.count; i += BASE_SAMPLE_STRIDE) {
                    const dx = this.points[i * 3] - x;
                    const dz = this.points[i * 3 + 2] - z;
                    const w = 1 / (dx * dx + dz * dz + 400);
                    weight += w;
                    height += this.points[i * 3 + 1] * w;
                }
                this.baseHeights[row * this.baseCols + col] = height / weight;
            }
        }
    }

    cellKey(cx: number, cz: number) {
        return (cx + 4096) * 8192 + (cz + 4096);
    }

    baseHeight(x: number, z: number) {
        const fx = (x - this.minX) / BASE_STEP;
        const fz = (z - this.minZ) / BASE_STEP;
        const col = Math.max(0, Math.min(this.baseCols - 2, Math.floor(fx)));
        const row = Math.max(0, Math.min(this.baseRows - 2, Math.floor(fz)));
        const tx = Math.max(0, Math.min(1, fx - col));
        const tz = Math.max(0, Math.min(1, fz - row));
        const i = row * this.baseCols + col;
        const a = this.baseHeights[i];
        const b = this.baseHeights[i + 1];
        const c = this.baseHeights[i + this.baseCols];
        const d = this.baseHeights[i + this.baseCols + 1];
        return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
    }

    // nearest road sample within a couple of cells, or a far result
    nearest(x: number, z: number, target: TrackNearest, reach = 2) {
        const cx = Math.floor(x / CELL);
        const cz = Math.floor(z / CELL);
        let best = -1;
        let bestDistance = Infinity;
        for (let dz = -reach; dz <= reach; dz++) {
            for (let dx = -reach; dx <= reach; dx++) {
                const list = this.cells.get(this.cellKey(cx + dx, cz + dz));
                if (!list) continue;
                for (let k = 0; k < list.length; k++) {
                    const i = list[k];
                    const ddx = this.points[i * 3] - x;
                    const ddz = this.points[i * 3 + 2] - z;
                    const d = ddx * ddx + ddz * ddz;
                    if (d < bestDistance) {
                        bestDistance = d;
                        best = i;
                    }
                }
            }
        }
        if (best < 0) {
            target.distance = Infinity;
            target.roadY = this.baseHeight(x, z);
            target.index = -1;
            return target;
        }
        target.distance = Math.sqrt(bestDistance);
        target.roadY = this.points[best * 3 + 1];
        target.index = best;
        return target;
    }
}
