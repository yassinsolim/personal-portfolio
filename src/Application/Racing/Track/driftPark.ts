// the drift park: a wide, flat course made here rather than downloaded, in
// the same shape of data as the ring's json, so its road, land, trees and
// trackside come out of the same builders. clockwise and 1.6 km: a long
// right, esses, a hairpin, a kink, a snake and a 175 degree bowl onto the
// straight, the road 24 m wide with grass out to walls 21 m either side
import type { TrackAssetData, TrackSection } from './NordschleifeTrack';

export const DRIFT_PARK_NAME = 'Drift Park';
// far from the ring, so nothing of one is ever near the other
export const DRIFT_PARK_ORIGIN = { x: 26000, y: 420, z: 0 };
// the lap's sectors split at these sections
export const DRIFT_PARK_SPLITS = ['Hairpin', 'Back Straight'];
const ROAD_WIDTH = 24;
const BARRIER = 21;
const SPACING = 4;
// straights [meters] and arcs [radius, degrees], positive turns right. it
// closes on itself (worked out offline), the rounding is spread along it
const LAYOUT: number[][] = [
    [218.493],
    [82.96, 99.622],
    [71.142],
    [40.998, -89.34],
    [48.922, 100.794],
    [114.24],
    [39.171, 140.41],
    [76.292],
    [58.461, -61.854],
    [48.939],
    [67.293, 71.704],
    [46.404, -76.111],
    [150.472],
    [78.222, 174.774],
    [114.155],
];
// sections by the layout piece they start on
const NAMES: Array<[number, string]> = [
    [0, 'Start'],
    [1, 'Long Right'],
    [3, 'The Esses'],
    [6, 'Hairpin'],
    [8, 'Kink'],
    [10, 'Snake'],
    [12, 'Back Straight'],
    [13, 'The Bowl'],
];
// the land: flat out past the walls, then rising into wooded hills
const TERRAIN_CELL = 30;
const TERRAIN_MARGIN = 720;
const FLAT_REACH = 70;
const HILL_HEIGHT = 22;
const FOREST_FROM = 150;

const smooth = (t: number) => {
    const k = Math.min(1, Math.max(0, t));
    return k * k * (3 - 2 * k);
};

// a dense walk along the layout, a meter or less a step
const walk = () => {
    const path: Array<[number, number]> = [[0, 0]];
    const starts: number[] = [];
    let x = 0;
    let z = 0;
    let heading = 0;
    let distance = 0;
    LAYOUT.forEach(([a, degrees]) => {
        starts.push(distance);
        if (degrees === undefined) {
            const n = Math.max(1, Math.ceil(a));
            for (let i = 0; i < n; i++) {
                x += (Math.cos(heading) * a) / n;
                z += (Math.sin(heading) * a) / n;
                path.push([x, z]);
            }
            distance += a;
            return;
        }
        const turn = (degrees * Math.PI) / 180;
        const arc = Math.abs(turn) * a;
        const n = Math.max(2, Math.ceil(arc));
        for (let i = 0; i < n; i++) {
            heading += turn / n;
            const mid = heading - turn / n / 2;
            x += (Math.cos(mid) * arc) / n;
            z += (Math.sin(mid) * arc) / n;
            path.push([x, z]);
        }
        distance += arc;
    });
    return { path, starts };
};

const toBase64 = (bytes: Uint8Array) => {
    let text = '';
    for (let i = 0; i < bytes.length; i += 4096)
        text += String.fromCodePoint(...bytes.subarray(i, i + 4096));
    return btoa(text);
};

export const buildDriftParkData = (): TrackAssetData => {
    const { path, starts } = walk();
    // cumulative length, and the end's miss of the start spread along it
    const along = new Float64Array(path.length);
    for (let i = 1; i < path.length; i++)
        along[i] =
            along[i - 1] +
            Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    const length = along[path.length - 1];
    const [missX, missZ] = path[path.length - 1];
    const at = (s: number) => {
        let i = 1;
        while (i < path.length - 1 && along[i] < s) i++;
        const t = (s - along[i - 1]) / Math.max(1e-9, along[i] - along[i - 1]);
        const share = s / length;
        return [
            path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t - missX * share,
            path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t - missZ * share,
        ];
    };
    const count = Math.round(length / SPACING);
    const flat: Array<[number, number]> = [];
    for (let k = 0; k < count; k++) flat.push(at((k * length) / count) as [number, number]);
    const { x: ox, y: oy, z: oz } = DRIFT_PARK_ORIGIN;
    const points = flat.map(([x, z]) => [
        Math.round((x + ox) * 100) / 100,
        oy,
        Math.round((z + oz) * 100) / 100,
    ]);
    const sections: TrackSection[] = NAMES.map(([piece, name]) => ({
        name,
        distance: Math.round(starts[piece] * 10) / 10,
    }));

    // the land around it on the ring's 30 m grid
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    flat.forEach(([x, z]) => {
        minX = Math.min(minX, x);
        minZ = Math.min(minZ, z);
        maxX = Math.max(maxX, x);
        maxZ = Math.max(maxZ, z);
    });
    const x0 = Math.floor((minX - TERRAIN_MARGIN) / TERRAIN_CELL) * TERRAIN_CELL;
    const z0 = Math.floor((minZ - TERRAIN_MARGIN) / TERRAIN_CELL) * TERRAIN_CELL;
    const cols = Math.ceil((maxX + TERRAIN_MARGIN - x0) / TERRAIN_CELL) + 1;
    const rows = Math.ceil((maxZ + TERRAIN_MARGIN - z0) / TERRAIN_CELL) + 1;
    const heights = new Uint16Array(cols * rows);
    const forest = new Uint8Array(cols * rows);
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const x = x0 + col * TERRAIN_CELL;
            const z = z0 + row * TERRAIN_CELL;
            let nearest = Infinity;
            for (let k = 0; k < flat.length; k += 2)
                nearest = Math.min(nearest, Math.hypot(flat[k][0] - x, flat[k][1] - z));
            const rise = smooth((nearest - FLAT_REACH) / 420);
            const roll =
                Math.sin(x * 0.0061 + 1.3) * Math.cos(z * 0.0047 - 0.4) * 0.5 +
                Math.sin((x + z) * 0.0113) * 0.25;
            const height = oy - 0.3 + rise * (HILL_HEIGHT * (0.75 + roll * 0.5));
            heights[row * cols + col] = Math.round(height * 10);
            // woods past the park, in clumps
            const clump =
                0.6 +
                0.4 * Math.sin(x * 0.019 + Math.cos(z * 0.013) * 2) *
                    Math.cos(z * 0.017 - 0.7);
            const density = smooth((nearest - FOREST_FROM) / 120) * clump;
            forest[row * cols + col] = Math.round(Math.min(1, Math.max(0, density)) * 255);
        }
    }

    return {
        name: DRIFT_PARK_NAME,
        closed: true,
        length: Math.round(length * 100) / 100,
        points,
        sections,
        widths: [[0, ROAD_WIDTH]],
        banksDeg: [[0, 0]],
        spacing: length / count,
        concrete: [[0, false]],
        barriers: [[0, BARRIER, BARRIER]],
        bridges: [],
        terrain: {
            x: x0 + ox,
            z: z0 + oz,
            cell: TERRAIN_CELL,
            cols,
            rows,
            heightsDm: toBase64(new Uint8Array(heights.buffer)),
            forest: toBase64(forest),
        },
    };
};
