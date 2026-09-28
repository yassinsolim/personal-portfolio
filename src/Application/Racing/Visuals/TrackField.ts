import type NordschleifeTrack from '../Track/NordschleifeTrack';

// answers "how far is this point from the road, and how high is the road
// near it" for any point on the map, fast enough to shape a whole terrain
// grid and place thousands of trees. uses the track's evenly spaced samples
// with a spatial hash near the road, and the real ground (the dem with the
// canopy taken off, from the track data) everywhere

const CELL = 48;

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

        // the terrain grid can't reach past the dem it's sampled from
        const terrain = track.terrain;
        this.minX = Math.max(this.minX, terrain.x);
        this.minZ = Math.max(this.minZ, terrain.z);
        this.maxX = Math.min(
            this.maxX,
            terrain.x + (terrain.cols - 1) * terrain.cell
        );
        this.maxZ = Math.min(
            this.maxZ,
            terrain.z + (terrain.rows - 1) * terrain.cell
        );
    }

    // bilinear lookup in one of the track data's grids
    sampleGrid(values: ArrayLike<number>, x: number, z: number) {
        const terrain = this.track.terrain;
        const fx = (x - terrain.x) / terrain.cell;
        const fz = (z - terrain.z) / terrain.cell;
        const col = Math.max(0, Math.min(terrain.cols - 2, Math.floor(fx)));
        const row = Math.max(0, Math.min(terrain.rows - 2, Math.floor(fz)));
        const tx = Math.max(0, Math.min(1, fx - col));
        const tz = Math.max(0, Math.min(1, fz - row));
        const i = row * terrain.cols + col;
        const a = values[i];
        const b = values[i + 1];
        const c = values[i + terrain.cols];
        const d = values[i + terrain.cols + 1];
        return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
    }

    cellKey(cx: number, cz: number) {
        return (cx + 4096) * 8192 + (cz + 4096);
    }

    // the real ground height
    baseHeight(x: number, z: number) {
        return this.sampleGrid(this.track.terrain.heights, x, z);
    }

    // 0..1, how wooded the real map is here
    woods(x: number, z: number) {
        return this.sampleGrid(this.track.terrain.forest, x, z) / 255;
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

    // how far the nearest sample is that sits at least `apart` samples away
    // along the lap from `index`: another stretch of road, like the far side
    // of a hairpin. Infinity if there's none within reach
    distanceToOther(
        x: number,
        z: number,
        index: number,
        apart: number,
        reach = 2
    ) {
        const cx = Math.floor(x / CELL);
        const cz = Math.floor(z / CELL);
        let bestDistance = Infinity;
        for (let dz = -reach; dz <= reach; dz++) {
            for (let dx = -reach; dx <= reach; dx++) {
                const list = this.cells.get(this.cellKey(cx + dx, cz + dz));
                if (!list) continue;
                for (let k = 0; k < list.length; k++) {
                    const i = list[k];
                    const along = Math.abs(i - index);
                    if (Math.min(along, this.count - along) < apart) continue;
                    const ddx = this.points[i * 3] - x;
                    const ddz = this.points[i * 3 + 2] - z;
                    bestDistance = Math.min(
                        bestDistance,
                        ddx * ddx + ddz * ddz
                    );
                }
            }
        }
        return Math.sqrt(bestDistance);
    }
}
