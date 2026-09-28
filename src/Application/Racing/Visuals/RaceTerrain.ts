import * as THREE from 'three';
import type NordschleifeTrack from '../Track/NordschleifeTrack';
import { VERGE_DROP } from '../Track/NordschleifeTrack';
import TrackField, { fbm, type TrackNearest } from './TrackField';
import RoadClearance, { CARVE_DEPTH, TriangleIndex } from './RoadClearance';
import { createGrassTexture } from './proceduralTextures';

// ground around the track: the real eifel from the dem, blended into the road
// near it. the grid stays under the road and verges, and a skirt strip runs
// from each barrier down onto the grid so there's never a gap or a cliff.
// every surface is carved under the road (RoadClearance) before it's drawn,
// scripts/test/terrain-road.test.mjs checks that for every quality
const MARGIN = 850;
const SKIRT_COLUMNS = [0, 2.5, 7, 15, 27, 44];
const SKIRT_TUCK = 0.3;
const UNDER_ROAD = CARVE_DEPTH;
const DETAIL_METERS = 7;
// matched to the pbr path's shaded slopes at senkenlinks and kesselchen
const WEAK_SKY_FILL = 0x060a16;
// the skirt's outer columns sit on every third ribbon station
const SKIRT_STRIDE = 3;
// another stretch of the lap closer than this (and at least CROWD_ALONG away
// along it) can be under this skirt, so the skirt there gets carved too
const CROWD_REACH = 70;
const CROWD_ALONG = 100;

export type TerrainQuality = 'high' | 'low';
// every quality the game builds, tests walk them all
export const TERRAIN_QUALITIES: TerrainQuality[] = ['high', 'low'];
// grid cell per quality, meters
export const GROUND_CELL: Record<TerrainQuality, number> = {
    high: 24,
    low: 56,
};

const smoothstep = (edge0: number, edge1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
};

// quads per side of a culling tile
const TILE_QUADS = 40;
// level of detail: grid step per tile by distance from the camera (meters to
// the tile's box). 40 quads divide by all of these
const LOD_STEPS = [1, 2, 4];
const LOD_RANGES = [700, 1600];
const LOD_CHECK_MS = 250;

type TileRange = { r0: number; c0: number; r1: number; c1: number };

// partial tiles at the field edge only take steps that divide them
const fitStep = (tile: TileRange, step: number) => {
    while (
        step > 1 &&
        ((tile.r1 - tile.r0) % step || (tile.c1 - tile.c0) % step)
    )
        step /= 2;
    return step;
};

type Tile = {
    mesh: THREE.Mesh;
    lodIndex: Record<string, THREE.BufferAttribute>;
    // coarsest step this tile may take: 1 where the road is near
    cap: number;
    r0: number;
    c0: number;
    r1: number;
    c1: number;
    box: THREE.Box3;
    step: number;
    key: string;
};
// skirt pieces along the lap, for culling
const SKIRT_CHUNKS = 20;
const srgbToLinear = (value: number) => Math.pow(value, 2.2);

export default class RaceTerrain {
    track: NordschleifeTrack;
    field: TrackField;
    root: THREE.Group;
    ground: THREE.Group;
    tiles: Tile[] = [];
    gridCols = 0;
    tileCols = 0;
    tileRows = 0;
    lodCheckedAt = 0;
    skirt: THREE.Group;
    material: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;
    barrier: number;
    clearance: RoadClearance;
    // the carved ground grid, for lookups while the skirt is built
    grid: {
        positions: Float32Array;
        cols: number;
        rows: number;
        cell: number;
    };
    skirtSurface: { positions: Float32Array; index: ArrayLike<number> } | null =
        null;
    private skirtLookup: TriangleIndex | null = null;
    private nearest: TrackNearest;

    constructor(
        parent: THREE.Object3D,
        track: NordschleifeTrack,
        quality: TerrainQuality
    ) {
        this.track = track;
        this.field = new TrackField(track, MARGIN);
        this.clearance = new RoadClearance(track);
        this.nearest = { distance: 0, roadY: 0, index: -1 };
        this.barrier = track.getVergeHalfWidth(0.5);
        this.root = new THREE.Group();
        this.root.name = 'race-terrain';
        parent.add(this.root);

        const detail = createGrassTexture();
        detail.anisotropy = 8;
        // grass is fully rough anyway, lambert is the cheap version for weak gpus
        this.material =
            quality === 'high'
                ? new THREE.MeshStandardMaterial({
                      vertexColors: true,
                      map: detail,
                      roughness: 0.96,
                      metalness: 0,
                  })
                : // weak gpus: the vertex colors alone, no detail texture.
                  // lambert skips the sky environment, whose grazing sheen
                  // is what keeps shaded slopes cool green on the pbr path,
                  // so a faint sky emissive stands in for it (free, the
                  // uniform is always in the shader)
                  new THREE.MeshLambertMaterial({
                      vertexColors: true,
                      emissive: WEAK_SKY_FILL,
                  });
        this.ground = this.buildGround(GROUND_CELL[quality]);
        this.skirt = this.buildSkirt();
        this.root.add(this.ground);
        this.root.add(this.skirt);
    }

    // every surface the terrain can draw, one entry per level, for the
    // terrain vs road test (scripts/test/terrain-road.test.mjs). an lod step
    // or stitched edge that can be on screen goes in here too, as meshes
    // with that level's index
    levels(): { name: string; meshes: THREE.Mesh[] }[] {
        // the tiles as drawn, then each coarser step and every stitched
        // border, as meshes over the same vertices
        const lod = (name: string, index: (tile: Tile) => Uint32Array) => ({
            name,
            meshes: this.tiles.map((tile) => {
                const geometry = new THREE.BufferGeometry();
                geometry.setAttribute(
                    'position',
                    tile.mesh.geometry.getAttribute('position')
                );
                geometry.setIndex(new THREE.BufferAttribute(index(tile), 1));
                return new THREE.Mesh(geometry);
            }),
        });
        return [
            { name: 'ground', meshes: this.ground.children as THREE.Mesh[] },
            ...LOD_STEPS.filter((step) => step > 1).map((step) =>
                lod(`ground-lod${step}`, (tile) => {
                    const fit = Math.min(tile.cap, fitStep(tile, step));
                    return this.tileTriangles(tile, fit, fit, fit, fit, fit);
                })
            ),
            lod('ground-stitched', (tile) => this.coarseTriangles(tile)),
            { name: 'skirt', meshes: this.skirt.children as THREE.Mesh[] },
        ];
    }

    // shared with the forest, so trees stand on the ground
    forestDensity(x: number, z: number) {
        return this.field.woods(x, z);
    }

    heightAt(x: number, z: number) {
        const near = this.field.nearest(x, z, this.nearest, 2);
        const d = near.distance;
        const ground = this.field.baseHeight(x, z);
        // the road cuts and fills through the real ground, so it takes over
        // close in and hands back to the dem over the next hundred meters
        const base =
            d === Infinity
                ? ground
                : near.roadY +
                  (ground - near.roadY) *
                      smoothstep(this.barrier + 8, this.barrier + 110, d);
        const banks =
            (fbm(x * 0.02, z * 0.02, 2) - 0.5) *
            2.4 *
            (d === Infinity
                ? 1
                : smoothstep(this.barrier + 12, this.barrier + 60, d));
        return base + banks;
    }

    // the grid itself sits well under the road near it, the skirt covers that
    gridHeightAt(x: number, z: number) {
        const h = this.heightAt(x, z);
        const near = this.nearest;
        if (near.distance === Infinity) return h;
        const push =
            1 -
            smoothstep(
                this.barrier + 16,
                this.barrier + SKIRT_COLUMNS[5],
                near.distance
            );
        const cap = near.roadY - UNDER_ROAD;
        return h > cap ? h - (h - cap) * push : h;
    }

    // the top of the ground as it's drawn, grid or skirt. trees stand on
    // this, heightAt can be under the skirt or over the pushed grid
    groundAt(x: number, z: number) {
        const grid = this.groundGridAt(x, z);
        if (!this.skirtSurface) return grid;
        this.skirtLookup ??= new TriangleIndex(
            this.skirtSurface.positions,
            this.skirtSurface.index,
            undefined,
            16
        );
        return Math.max(grid, this.skirtLookup.heightAt(x, z));
    }

    // the drawn grid's height at a point, triangle by triangle like it's
    // rendered (the carve and the push make it differ from heightAt)
    groundGridAt(x: number, z: number) {
        const { positions, cols, rows, cell } = this.grid;
        const fx = Math.min(
            cols - 1.001,
            Math.max(0, (x - this.field.minX) / cell)
        );
        const fz = Math.min(
            rows - 1.001,
            Math.max(0, (z - this.field.minZ) / cell)
        );
        const col = Math.floor(fx);
        const row = Math.floor(fz);
        const u = fx - col;
        const v = fz - row;
        const a = row * cols + col;
        const y = (i: number) => positions[i * 3 + 1];
        if (u + v <= 1)
            return y(a) * (1 - u - v) + y(a + 1) * u + y(a + cols) * v;
        return (
            y(a + cols + 1) * (u + v - 1) +
            y(a + 1) * (1 - v) +
            y(a + cols) * (1 - u)
        );
    }

    // how readily a grid vertex takes the carve, by its distance from the
    // road: freely under the road and skirt, hardly at all where it's in view
    carveMobility(distance: number) {
        return (
            1 -
            0.95 *
                smoothstep(
                    this.barrier + 24,
                    this.barrier + SKIRT_COLUMNS[SKIRT_COLUMNS.length - 1],
                    distance
                )
        );
    }

    colorAt(x: number, z: number, target: THREE.Color) {
        const variation = fbm(x * 0.012 + 3.3, z * 0.012 - 1.1, 3);
        const patches = fbm(x * 0.0035 - 9.2, z * 0.0035 + 4.4, 2);
        const forest = this.forestDensity(x, z);
        // meadow, drier patches, and darker ground under the forest
        let r = 0.42 + (variation - 0.5) * 0.08 + (patches - 0.5) * 0.06;
        let g = 0.54 + (variation - 0.5) * 0.1;
        let b = 0.24 + (variation - 0.5) * 0.05;
        r = r * (1 - forest * 0.45);
        g = g * (1 - forest * 0.4);
        b = b * (1 - forest * 0.35);
        target.setRGB(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));
        return target;
    }

    // picks each tile's grid step from the camera distance, and where a tile
    // meets a coarser one its edge vertices snap to the coarser spacing, so
    // both edges run along the same line and nothing cracks open between them
    update(camera: THREE.Camera) {
        const now = performance.now();
        if (now - this.lodCheckedAt < LOD_CHECK_MS || !this.tiles.length)
            return;
        this.lodCheckedAt = now;
        const eye = camera.position;
        this.tiles.forEach((tile) => {
            const distance = tile.box.distanceToPoint(eye);
            let level = LOD_RANGES.findIndex((range) => distance < range);
            if (level < 0) level = LOD_STEPS.length - 1;
            const step = Math.min(tile.cap, fitStep(tile, LOD_STEPS[level]));
            tile.step = step;
        });
        const at = (tr: number, tc: number) =>
            tr < 0 || tc < 0 || tr >= this.tileRows || tc >= this.tileCols
                ? null
                : this.tiles[tr * this.tileCols + tc];
        this.tiles.forEach((tile, i) => {
            const tr = Math.floor(i / this.tileCols);
            const tc = i % this.tileCols;
            const edge = (other: Tile | null) =>
                Math.max(tile.step, other ? other.step : tile.step);
            const top = edge(at(tr - 1, tc));
            const bottom = edge(at(tr + 1, tc));
            const left = edge(at(tr, tc - 1));
            const right = edge(at(tr, tc + 1));
            const key = `${tile.step}:${top}:${bottom}:${left}:${right}`;
            if (key === tile.key) return;
            tile.key = key;
            tile.mesh.geometry.setIndex(
                this.tileIndex(tile, tile.step, top, bottom, left, right)
            );
        });
    }

    tileIndex(
        tile: Tile,
        step: number,
        top: number,
        bottom: number,
        left: number,
        right: number
    ) {
        const cache = tile.lodIndex;
        const key = `${step}:${top}:${bottom}:${left}:${right}`;
        if (cache[key]) return cache[key];
        const attribute = new THREE.BufferAttribute(
            this.tileTriangles(tile, step, top, bottom, left, right),
            1
        );
        cache[key] = attribute;
        return attribute;
    }

    // the triangles of one lod variant of a tile. edgesOnly keeps the strip
    // along the tile's border, the only part that stitching changes
    tileTriangles(
        tile: TileRange,
        step: number,
        top: number,
        bottom: number,
        left: number,
        right: number,
        edgesOnly = false
    ) {
        const cols = this.gridCols;
        const snap = (
            value: number,
            origin: number,
            spacing: number,
            end: number
        ) =>
            Math.min(
                end,
                origin + Math.round((value - origin) / spacing) * spacing
            );
        const vertex = (row: number, col: number) => {
            // edge vertices move onto the neighbor's coarser grid
            if (row === tile.r0 && top > step)
                col = snap(col, tile.c0, top, tile.c1);
            else if (row === tile.r1 && bottom > step)
                col = snap(col, tile.c0, bottom, tile.c1);
            if (col === tile.c0 && left > step)
                row = snap(row, tile.r0, left, tile.r1);
            else if (col === tile.c1 && right > step)
                row = snap(row, tile.r0, right, tile.r1);
            return row * cols + col;
        };
        const index: number[] = [];
        for (let row = tile.r0; row < tile.r1; row += step) {
            for (let col = tile.c0; col < tile.c1; col += step) {
                if (
                    edgesOnly &&
                    row !== tile.r0 &&
                    row + step !== tile.r1 &&
                    col !== tile.c0 &&
                    col + step !== tile.c1
                )
                    continue;
                const a = vertex(row, col);
                const b = vertex(row, col + step);
                const c = vertex(row + step, col);
                const d = vertex(row + step, col + step);
                if (a !== c && a !== b && b !== c) index.push(a, c, b);
                if (b !== c && b !== d && c !== d) index.push(b, c, d);
            }
        }
        return new Uint32Array(index);
    }

    // every triangle a tile can draw at a step coarser than the grid, within
    // its cap and its neighbors': the uniform levels, and the border strip
    // for each way its edges can snap. levels() hands these to the road test
    coarseTriangles(tile: Tile) {
        const parts: Uint32Array[] = [];
        const i = this.tiles.indexOf(tile);
        const tr = Math.floor(i / this.tileCols);
        const tc = i % this.tileCols;
        // an edge only snaps as far as the tile across it can go
        const capAt = (r: number, c: number) =>
            r < 0 || c < 0 || r >= this.tileRows || c >= this.tileCols
                ? 1
                : this.tiles[r * this.tileCols + c].cap;
        const across = [
            capAt(tr - 1, tc),
            capAt(tr + 1, tc),
            capAt(tr, tc - 1),
            capAt(tr, tc + 1),
        ];
        LOD_STEPS.filter((step) => step <= tile.cap).forEach((step) => {
            if (step > 1)
                parts.push(
                    this.tileTriangles(tile, step, step, step, step, step)
                );
            const [tops, bottoms, lefts, rights] = across.map((cap) =>
                LOD_STEPS.filter((s) => s >= step && s <= Math.max(step, cap))
            );
            tops.forEach((top) =>
                bottoms.forEach((bottom) =>
                    lefts.forEach((left) =>
                        rights.forEach((right) => {
                            if (Math.max(top, bottom, left, right) === step)
                                return;
                            parts.push(
                                this.tileTriangles(
                                    tile,
                                    step,
                                    top,
                                    bottom,
                                    left,
                                    right,
                                    true
                                )
                            );
                        })
                    )
                )
            );
        });
        const total = parts.reduce((n, part) => n + part.length, 0);
        const out = new Uint32Array(total);
        let k = 0;
        parts.forEach((part) => {
            out.set(part, k);
            k += part.length;
        });
        return out;
    }

    buildGround(cell: number) {
        const field = this.field;
        const cols = Math.ceil((field.maxX - field.minX) / cell) + 1;
        const rows = Math.ceil((field.maxZ - field.minZ) / cell) + 1;
        const positions = new Float32Array(cols * rows * 3);
        const colors = new Float32Array(cols * rows * 3);
        const uvs = new Float32Array(cols * rows * 2);
        const mobility = new Float32Array(cols * rows);
        const color = new THREE.Color();
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const i = row * cols + col;
                const x = field.minX + col * cell;
                const z = field.minZ + row * cell;
                const y = this.gridHeightAt(x, z);
                mobility[i] = this.carveMobility(this.nearest.distance);
                positions[i * 3] = x;
                positions[i * 3 + 1] = y;
                positions[i * 3 + 2] = z;
                this.colorAt(x, z, color);
                colors[i * 3] = color.r;
                colors[i * 3 + 1] = color.g;
                colors[i * 3 + 2] = color.b;
                uvs[i * 2] = x / DETAIL_METERS;
                uvs[i * 2 + 1] = z / DETAIL_METERS;
            }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
            'position',
            new THREE.BufferAttribute(positions, 3)
        );
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        const all = new Uint32Array((cols - 1) * (rows - 1) * 6);
        const quad = (
            target: Uint32Array,
            k: number,
            row: number,
            col: number
        ) => {
            const a = row * cols + col;
            const b = a + 1;
            const c = a + cols;
            const d = c + 1;
            target[k] = a;
            target[k + 1] = c;
            target[k + 2] = b;
            target[k + 3] = b;
            target[k + 4] = c;
            target[k + 5] = d;
        };
        let k = 0;
        for (let row = 0; row < rows - 1; row++) {
            for (let col = 0; col < cols - 1; col++, k += 6)
                quad(all, k, row, col);
        }
        // normals over the whole grid so tiles meet without seams, taken
        // before the carve so it only moves hidden ground, not the shading
        geometry.setIndex(new THREE.BufferAttribute(all, 1));
        geometry.computeVertexNormals();
        // the push above keeps most of the grid under the road, but a big
        // cell reaches past it and the karussell's bank drops the inside
        // below the centerline. the carve covers both, on the triangles as
        // they're drawn
        this.clearance.carveGrid(
            positions,
            cols,
            rows,
            cell,
            field.minX,
            field.minZ,
            mobility
        );
        this.grid = { positions, cols, rows, cell };

        // tiles share the vertex buffers and only differ in index, so each can
        // be frustum culled on its own
        const group = new THREE.Group();
        group.name = 'race-terrain-ground';
        const tileCols = Math.ceil((cols - 1) / TILE_QUADS);
        const tileRows = Math.ceil((rows - 1) / TILE_QUADS);
        this.gridCols = cols;
        this.tileCols = tileCols;
        this.tileRows = tileRows;
        this.tiles = [];
        const box = new THREE.Box3();
        const point = new THREE.Vector3();
        for (let tr = 0; tr < tileRows; tr++) {
            for (let tc = 0; tc < tileCols; tc++) {
                const r0 = tr * TILE_QUADS;
                const c0 = tc * TILE_QUADS;
                const r1 = Math.min(rows - 1, r0 + TILE_QUADS);
                const c1 = Math.min(cols - 1, c0 + TILE_QUADS);
                const index = new Uint32Array((r1 - r0) * (c1 - c0) * 6);
                box.makeEmpty();
                let n = 0;
                for (let row = r0; row < r1; row++) {
                    for (let col = c0; col < c1; col++, n += 6)
                        quad(index, n, row, col);
                }
                for (let row = r0; row <= r1; row++) {
                    for (let col = c0; col <= c1; col++) {
                        const i = row * cols + col;
                        box.expandByPoint(point.fromArray(positions, i * 3));
                    }
                }
                const tile = new THREE.BufferGeometry();
                tile.setIndex(new THREE.BufferAttribute(index, 1));
                ['position', 'normal', 'color', 'uv'].forEach((name) =>
                    tile.setAttribute(name, geometry.getAttribute(name))
                );
                tile.boundingBox = box.clone();
                tile.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
                const mesh = new THREE.Mesh(tile, this.material);
                mesh.name = `race-terrain-tile-${tr}-${tc}`;
                mesh.receiveShadow = true;
                group.add(mesh);
                this.tiles.push({
                    mesh,
                    lodIndex: {},
                    cap: fitStep(
                        { r0, c0, r1, c1 },
                        LOD_STEPS[LOD_STEPS.length - 1]
                    ),
                    r0,
                    c0,
                    r1,
                    c1,
                    box: box.clone(),
                    step: 1,
                    key: '1:1:1:1:1',
                });
            }
        }
        this.capRoadTiles(cell);
        return group;
    }

    // a coarse triangle over the road would have to be carved into a crater
    // to stay under it, so tiles within one coarse cell of the road keep the
    // full grid. the stitched border strip a finer tile draws next to a
    // coarser one lies within a cell of that neighbor, so the road can't be
    // under it either: the neighbor would be a road tile and never coarse
    capRoadTiles(cell: number) {
        const reach = LOD_STEPS[LOD_STEPS.length - 1];
        const field = this.field;
        const quads = TILE_QUADS;
        this.clearance.forEachSample((x, z) => {
            const col = (x - field.minX) / cell;
            const row = (z - field.minZ) / cell;
            const tc0 = Math.floor((col - reach) / quads);
            const tc1 = Math.floor((col + reach) / quads);
            const tr0 = Math.floor((row - reach) / quads);
            const tr1 = Math.floor((row + reach) / quads);
            for (
                let tr = Math.max(0, tr0);
                tr <= Math.min(this.tileRows - 1, tr1);
                tr++
            ) {
                for (
                    let tc = Math.max(0, tc0);
                    tc <= Math.min(this.tileCols - 1, tc1);
                    tc++
                ) {
                    this.tiles[tr * this.tileCols + tc].cap = 1;
                }
            }
        });
    }

    // from the barrier line out onto the terrain, on the same banked frames
    // as the road ribbons. the inner edge takes every ribbon station, so it
    // is the verge's outer edge exactly (no gap, and no overlap to flicker).
    // the outer columns take every SKIRT_STRIDE-th station, and the first
    // strip is stitched between the two
    buildSkirt() {
        const track = this.track;
        const curve = track.visualCurve;
        const stations = track.getRibbonSamples();
        const rings = Math.ceil(stations / SKIRT_STRIDE);
        const outer = SKIRT_COLUMNS.length - 1;
        const reach = SKIRT_COLUMNS[outer];
        const perSide = stations + 1 + (rings + 1) * outer;
        const positions = new Float32Array(perSide * 2 * 3);
        const colors = new Float32Array(perSide * 2 * 3);
        const uvs = new Float32Array(perSide * 2 * 2);
        // the inner edge is shared with the verge, so the carve can't move it
        const mobility = new Float32Array(perSide * 2).fill(1);
        // outer end vertex, and the height that tucks it under the drawn grid
        const tucks: number[] = [];
        const ringStation = (j: number) => Math.min(stations, j * SKIRT_STRIDE);
        const edgeVertex = (side: number, s: number) => side * perSide + s;
        const ringVertex = (side: number, j: number, c: number) =>
            side * perSide + stations + 1 + j * outer + c - 1;
        const point = new THREE.Vector3();
        const tangent = new THREE.Vector3();
        const normal = new THREE.Vector3();
        const side = new THREE.Vector3(1, 0, 0);
        const previousSide = new THREE.Vector3(1, 0, 0);
        const edge = new THREE.Vector3();
        const flat = new THREE.Vector3();
        const color = new THREE.Color();
        const write = (v: number, x: number, y: number, z: number) => {
            positions[v * 3] = x;
            positions[v * 3 + 1] = y;
            positions[v * 3 + 2] = z;
            this.colorAt(x, z, color);
            colors[v * 3] = color.r;
            colors[v * 3 + 1] = color.g;
            colors[v * 3 + 2] = color.b;
            uvs[v * 2] = x / DETAIL_METERS;
            uvs[v * 2 + 1] = z / DETAIL_METERS;
        };
        [1, -1].forEach((sign, sideIndex) => {
            previousSide.set(1, 0, 0);
            for (let s = 0; s <= stations; s++) {
                // same t and frame sequence as createRibbonGeometry
                const t = (((s / stations) % 1) + 1) % 1;
                track.getRibbonFrame(
                    curve,
                    t,
                    point,
                    tangent,
                    normal,
                    side,
                    previousSide
                );
                const vergeHalf = track.getVergeHalfWidth(t);
                edge.copy(point)
                    .addScaledVector(side, sign * vergeHalf)
                    .addScaledVector(normal, -VERGE_DROP);
                const inner = edgeVertex(sideIndex, s);
                write(inner, edge.x, edge.y, edge.z);
                mobility[inner] = 0;
                if (s % SKIRT_STRIDE !== 0 && s !== stations) continue;
                const j = s === stations ? rings : s / SKIRT_STRIDE;
                flat.set(side.x, 0, side.z).normalize().multiplyScalar(sign);
                for (let c = 1; c <= outer; c++) {
                    const out = SKIRT_COLUMNS[c];
                    const x = edge.x + flat.x * out;
                    const z = edge.z + flat.z * out;
                    const ground = this.heightAt(x, z) - SKIRT_TUCK;
                    const blend = smoothstep(0, reach, out);
                    const v = ringVertex(sideIndex, j, c);
                    write(v, x, edge.y + (ground - edge.y) * blend, z);
                    if (c === outer)
                        tucks.push(v, this.groundGridAt(x, z) - SKIRT_TUCK);
                }
            }
        });

        // triangles per side and ring, in lap order
        const index: number[] = [];
        const segmentStart: number[] = [];
        for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
            for (let j = 0; j < rings; j++) {
                segmentStart.push(index.length / 3);
                const s0 = ringStation(j);
                const s1 = ringStation(j + 1);
                const mid = s0 + Math.floor((s1 - s0) / 2);
                const r0 = ringVertex(sideIndex, j, 1);
                const r1 = ringVertex(sideIndex, j + 1, 1);
                for (let s = s0; s < s1; s++) {
                    if (s === mid) index.push(r0, edgeVertex(sideIndex, s), r1);
                    index.push(
                        edgeVertex(sideIndex, s),
                        edgeVertex(sideIndex, s + 1),
                        s < mid ? r0 : r1
                    );
                }
                for (let c = 1; c < outer; c++) {
                    const a = ringVertex(sideIndex, j, c);
                    const b = a + 1;
                    const d = ringVertex(sideIndex, j + 1, c);
                    const e = d + 1;
                    index.push(a, d, b, b, d, e);
                }
            }
        }
        segmentStart.push(index.length / 3);

        const geometry = new THREE.BufferGeometry();
        geometry.setIndex(index);
        geometry.setAttribute(
            'position',
            new THREE.BufferAttribute(positions, 3)
        );
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        // normals from the shape before the tuck and the carve, like the grid
        geometry.computeVertexNormals();
        // both sides wind the same way in their own frame, so make every
        // normal face up
        const normals = geometry.getAttribute(
            'normal'
        ) as THREE.BufferAttribute;
        for (let i = 0; i < normals.count; i++) {
            if (normals.getY(i) < 0) {
                normals.setXYZ(
                    i,
                    -normals.getX(i),
                    -normals.getY(i),
                    -normals.getZ(i)
                );
            }
        }
        // the far end tucks under the grid as it's drawn, so it never ends in
        // a ledge over pushed or carved ground
        for (let k = 0; k < tucks.length; k += 2) {
            const v = tucks[k];
            positions[v * 3 + 1] = Math.min(positions[v * 3 + 1], tucks[k + 1]);
        }
        // where another stretch of the lap comes close (the karussell's way
        // in and out), the skirt can reach over that road, so carve it there
        const frames = track.getSampleCount();
        const apart = Math.round((CROWD_ALONG / track.length) * frames);
        const crowded = new Uint8Array(rings);
        for (let j = 0; j < rings; j++) {
            const f = Math.round((ringStation(j) / stations) * frames) % frames;
            const near = this.field.distanceToOther(
                track.framePoints[f * 3],
                track.framePoints[f * 3 + 2],
                f,
                apart
            );
            if (near > CROWD_REACH) continue;
            for (let k = j - 2; k <= j + 2; k++)
                crowded[(k + rings) % rings] = 1;
        }
        // crowding goes both ways, so the other road's samples are all at
        // crowded stations too
        const carve: number[] = [];
        const mask = new Uint8Array(stations);
        for (let j = 0; j < rings; j++) {
            if (!crowded[j]) continue;
            mask.fill(1, ringStation(j), ringStation(j + 1));
            for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
                const segment = sideIndex * rings + j;
                for (
                    let t = segmentStart[segment];
                    t < segmentStart[segment + 1];
                    t++
                )
                    carve.push(t);
            }
        }
        this.clearance.carveTriangles(positions, index, mobility, carve, mask);

        this.skirtSurface = { positions, index: geometry.getIndex()!.array };
        this.skirtLookup = null;
        // cut along the lap so only the stretch in view is drawn. the chunks
        // share the vertex buffers and only differ in index
        const material = this.material.clone();
        material.side = THREE.DoubleSide;
        const group = new THREE.Group();
        group.name = 'race-terrain-skirt';
        const perChunk = Math.ceil(rings / SKIRT_CHUNKS);
        const box = new THREE.Box3();
        const corner = new THREE.Vector3();
        for (let chunk = 0; chunk < SKIRT_CHUNKS; chunk++) {
            const j0 = chunk * perChunk;
            const j1 = Math.min(rings, j0 + perChunk);
            if (j1 <= j0) break;
            const part: number[] = [];
            box.makeEmpty();
            for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
                const from = segmentStart[sideIndex * rings + j0] * 3;
                const to = segmentStart[sideIndex * rings + j1] * 3;
                for (let k = from; k < to; k++) {
                    part.push(index[k]);
                    box.expandByPoint(
                        corner.fromArray(positions, index[k] * 3)
                    );
                }
            }
            const piece = new THREE.BufferGeometry();
            ['position', 'normal', 'color', 'uv'].forEach((name) =>
                piece.setAttribute(name, geometry.getAttribute(name))
            );
            piece.setIndex(part);
            piece.boundingBox = box.clone();
            piece.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
            const mesh = new THREE.Mesh(piece, material);
            mesh.name = `race-terrain-skirt-${chunk}`;
            mesh.receiveShadow = true;
            group.add(mesh);
        }
        return group;
    }
}
