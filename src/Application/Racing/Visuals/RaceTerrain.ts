import * as THREE from 'three';
import type NordschleifeTrack from '../Track/NordschleifeTrack';
import TrackField, { fbm, type TrackNearest } from './TrackField';
import { createGrassTexture } from './proceduralTextures';

// ground around the track: the real eifel from the dem, blended into the road
// near it. the grid stays under the road and verges, and a skirt strip runs
// from each barrier down onto the grid so there's never a gap or a cliff
const MARGIN = 850;
const SKIRT_COLUMNS = [0, 2.5, 7, 15, 27, 44];
const SKIRT_TUCK = 0.3;
const UNDER_ROAD = 1.4;
const DETAIL_METERS = 7;

export type TerrainQuality = 'high' | 'low';

const smoothstep = (edge0: number, edge1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
};

// quads per side of a culling tile
const TILE_QUADS = 40;
const srgbToLinear = (value: number) => Math.pow(value, 2.2);

export default class RaceTerrain {
    track: NordschleifeTrack;
    field: TrackField;
    root: THREE.Group;
    ground: THREE.Group;
    skirt: THREE.Mesh;
    material: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;
    barrier: number;
    private nearest: TrackNearest;

    constructor(
        parent: THREE.Object3D,
        track: NordschleifeTrack,
        quality: TerrainQuality
    ) {
        this.track = track;
        this.field = new TrackField(track, MARGIN);
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
                : new THREE.MeshLambertMaterial({
                      vertexColors: true,
                      map: detail,
                  });
        this.ground = this.buildGround(quality === 'high' ? 24 : 40);
        this.skirt = this.buildSkirt();
        this.root.add(this.ground);
        this.root.add(this.skirt);
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

    buildGround(cell: number) {
        const field = this.field;
        const cols = Math.ceil((field.maxX - field.minX) / cell) + 1;
        const rows = Math.ceil((field.maxZ - field.minZ) / cell) + 1;
        const positions = new Float32Array(cols * rows * 3);
        const colors = new Float32Array(cols * rows * 3);
        const uvs = new Float32Array(cols * rows * 2);
        const color = new THREE.Color();
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const i = row * cols + col;
                const x = field.minX + col * cell;
                const z = field.minZ + row * cell;
                const y = this.gridHeightAt(x, z);
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
        // normals over the whole grid so tiles meet without seams
        geometry.setIndex(new THREE.BufferAttribute(all, 1));
        geometry.computeVertexNormals();

        // tiles share the vertex buffers and only differ in index, so each can
        // be frustum culled on its own
        const group = new THREE.Group();
        group.name = 'race-terrain-ground';
        const tileCols = Math.ceil((cols - 1) / TILE_QUADS);
        const tileRows = Math.ceil((rows - 1) / TILE_QUADS);
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
            }
        }
        return group;
    }

    // from the barrier line out onto the terrain, on the same banked frame as
    // the road ribbons so the inner edge meets the verge exactly
    buildSkirt() {
        const track = this.track;
        const curve = track.visualCurve;
        const samples = Math.round(track.length / 5);
        const columns = SKIRT_COLUMNS.length;
        const positions: number[] = [];
        const colors: number[] = [];
        const uvs: number[] = [];
        const indices: number[] = [];
        const point = new THREE.Vector3();
        const tangent = new THREE.Vector3();
        const normal = new THREE.Vector3();
        const side = new THREE.Vector3(1, 0, 0);
        const previousSide = new THREE.Vector3(1, 0, 0);
        const edge = new THREE.Vector3();
        const flat = new THREE.Vector3();
        const color = new THREE.Color();
        let vertex = 0;
        [1, -1].forEach((sign) => {
            previousSide.set(1, 0, 0);
            const start = vertex;
            for (let i = 0; i <= samples; i++) {
                const t = i / samples;
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
                    .addScaledVector(normal, -0.012);
                flat.set(side.x, 0, side.z).normalize().multiplyScalar(sign);
                for (let c = 0; c < columns; c++) {
                    const out = SKIRT_COLUMNS[c];
                    const x = edge.x + flat.x * out;
                    const z = edge.z + flat.z * out;
                    let y = edge.y;
                    if (c > 0) {
                        const ground = this.heightAt(x, z) - SKIRT_TUCK;
                        const blend = smoothstep(
                            0,
                            SKIRT_COLUMNS[columns - 1],
                            out
                        );
                        y = edge.y + (ground - edge.y) * blend;
                    }
                    positions.push(x, y, z);
                    this.colorAt(x, z, color);
                    colors.push(color.r, color.g, color.b);
                    uvs.push(x / DETAIL_METERS, z / DETAIL_METERS);
                }
            }
            for (let i = 0; i < samples; i++) {
                for (let c = 0; c < columns - 1; c++) {
                    const a = start + i * columns + c;
                    const b = a + 1;
                    const d = a + columns;
                    const e = d + 1;
                    indices.push(a, d, b, b, d, e);
                }
            }
            vertex = start + (samples + 1) * columns;
        });
        const geometry = new THREE.BufferGeometry();
        geometry.setIndex(indices);
        geometry.setAttribute(
            'position',
            new THREE.Float32BufferAttribute(positions, 3)
        );
        geometry.setAttribute(
            'color',
            new THREE.Float32BufferAttribute(colors, 3)
        );
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
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
        geometry.computeBoundingSphere();
        const mesh = new THREE.Mesh(geometry, this.material.clone());
        (mesh.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
        mesh.name = 'race-terrain-skirt';
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        return mesh;
    }
}
