import * as THREE from 'three';
import type NordschleifeTrack from '../Track/NordschleifeTrack';
import type RaceTerrain from './RaceTerrain';
import type { TrackNearest } from './TrackField';
import { getFoliageAtlas, SPECIES, type Species } from './foliageTextures';
import { TREE_BUILDERS, TREE_HALF_WIDTH } from './treeGeometry';
import type { PresetSettings } from './qualityPresets';
import { drain, type Steps } from '../slicing';

// the eifel woods along the ring: norway spruce first, then beech, some scots
// pine and birch. near trees are real geometry (instanced per chunk of the
// lap, alpha tested cards, swaying in the wind). past NEAR_RANGE each tree is
// a baked billboard. both fade by the tree's distance with the same dither,
// so the swap is a crossfade instead of a pop
const CHUNKS = 32;
// near trees are refilled per tree from a grid of this size whenever the
// camera has moved REFILL_DISTANCE, so only trees actually in range are drawn
const CELL_SIZE = 60;
const REFILL_DISTANCE = 10;
// each refill writes the set that was drawn longest ago. rewriting a buffer
// the gpu may still be reading from the last frame stalls the pipeline
const RING = 3;
// most trees of one kind that can be in range at once
const NEAR_CAPACITY = 3000;
// shadow casters sit on their own layer, which only the sun's shadow camera
// renders. the visible near trees don't cast, so nothing is drawn twice
export const TREE_SHADOW_LAYER = 3;
const VARIANTS = 2;
const TREE_CLEARANCE = 5.5;
const FOREST_DEPTH = 200;
const NEAR_RANGE = 180;
const FADE = 40;
// a 30 m tree in a 22 degree sun throws a 75 m shadow, past this it can't
// reach the road around the car
const SHADOW_RANGE = 110;
const IMPOSTOR_CELL_WIDTH = 256;
const IMPOSTOR_CELL_HEIGHT = 512;

const MIX: { species: Species; share: number; height: [number, number] }[] = [
    { species: 'spruce', share: 0.56, height: [21, 35] },
    { species: 'beech', share: 0.24, height: [19, 29] },
    { species: 'pine', share: 0.1, height: [17, 26] },
    { species: 'birch', share: 0.1, height: [13, 21] },
];

export type ForestQuality = 'high' | 'low';

type Tree = {
    x: number;
    y: number;
    z: number;
    s: number;
    r: number;
    tint: number;
    kind: number;
};

const rng = (seed: number) => {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

// interleaved gradient noise, the same pattern for both lods so they add up
const DITHER = /* glsl */ `
float treeDither(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
`;

// double sided cards flip their back normal, which would darken half the
// crown. flip it back: the crown normals already point outward
const UNFLIP = /* glsl */ `
#include <normal_fragment_begin>
#ifdef DOUBLE_SIDED
    normal *= faceDirection;
#endif
`;

// where the trees go, in chunks along the lap. a step every so often, so
// the hover build can spread it over frames
function* placing(
    track: NordschleifeTrack,
    terrain: RaceTerrain,
    target: number
): Generator<string | void, Tree[][], void> {
    const chunks: Tree[][] = [];
    for (let i = 0; i < CHUNKS; i++) chunks.push([]);
    const random = rng(4242);
    const samples = track.getSampleCount();
    const points = track.framePoints;
    const tangents = track.frameTangents;
    const nearest: TrackNearest = { distance: 0, roadY: 0, index: -1 };
    const field = terrain.field;
    const perSide = Math.max(
        2,
        Math.round(target / (samples / 2) / 2 / 0.55)
    );
    let placed = 0;
    for (let i = 0; i < samples && placed < target; i += 2) {
        if (i % 512 === 0) yield 'forest:place';
        const px = points[i * 3];
        const pz = points[i * 3 + 2];
        const tx = tangents[i * 2];
        const tz = tangents[i * 2 + 1];
        const barrier = track.getVergeHalfWidth(i / samples);
        for (const sign of [1, -1]) {
            for (let k = 0; k < perSide; k++) {
                const depth = Math.pow(random(), 1.6) * FOREST_DEPTH;
                const lateral = sign * (barrier + TREE_CLEARANCE + depth);
                const along = (random() - 0.5) * 8;
                const x = px + tz * lateral + tx * along;
                const z = pz - tx * lateral + tz * along;
                // where the real map has woods, plus the odd lone tree
                const density = terrain.forestDensity(x, z);
                if (random() > Math.max(density * 0.95, 0.025)) continue;
                field.nearest(x, z, nearest, 1);
                if (nearest.distance < barrier + TREE_CLEARANCE - 0.5)
                    continue;
                let pick = random();
                let kind = 0;
                for (let m = 0; m < MIX.length; m++) {
                    if (pick < MIX[m].share || m === MIX.length - 1) {
                        kind = m;
                        break;
                    }
                    pick -= MIX[m].share;
                }
                const [lo, hi] = MIX[kind].height;
                chunks[Math.floor((i / samples) * CHUNKS) % CHUNKS].push({
                    x,
                    y: terrain.groundAt(x, z) - 0.4,
                    z,
                    s: lo + random() * (hi - lo),
                    r: random() * Math.PI * 2,
                    tint: random(),
                    kind: kind * VARIANTS + Math.floor(random() * VARIANTS),
                });
                placed++;
            }
        }
    }
    return chunks;
}

export default class RaceForest {
    root: THREE.Group;
    nearSets: THREE.InstancedMesh[][];
    shadowSets: THREE.InstancedMesh[][];
    nearSlot: number;
    shadowSlot: number;
    trees: Tree[];
    matrices: Float32Array;
    colors: Float32Array;
    grid: Map<number, number[]>;
    lastEye: THREE.Vector3;
    lastFocus: THREE.Vector3;
    dirty: boolean;
    impostorMeshes: THREE.Mesh[];
    nearMaterial: THREE.MeshLambertMaterial;
    impostorMaterial: THREE.MeshLambertMaterial;
    uniforms: {
        uWindTime: THREE.IUniform<number>;
        uNearRange: THREE.IUniform<number>;
        uFade: THREE.IUniform<number>;
    };
    impostorTarget: THREE.WebGLRenderTarget;
    count: number;
    shadowRange: number;

    // built when constructed, or with defer by running pending
    pending: Steps;

    constructor(
        parent: THREE.Object3D,
        renderer: THREE.WebGLRenderer,
        track: NordschleifeTrack,
        terrain: RaceTerrain,
        quality: ForestQuality,
        defer = false
    ) {
        this.pending = this.build(parent, renderer, track, terrain, quality);
        if (!defer) drain(this.pending);
    }

    private *build(
        parent: THREE.Object3D,
        renderer: THREE.WebGLRenderer,
        track: NordschleifeTrack,
        terrain: RaceTerrain,
        quality: ForestQuality
    ): Steps {
        this.root = new THREE.Group();
        this.root.name = 'race-forest';
        parent.add(this.root);
        this.nearSets = [];
        this.shadowSets = [];
        this.nearSlot = 0;
        this.shadowSlot = 0;
        this.grid = new Map();
        this.lastEye = new THREE.Vector3(Infinity, 0, 0);
        this.lastFocus = new THREE.Vector3(Infinity, 0, 0);
        this.dirty = true;
        this.impostorMeshes = [];
        this.shadowRange = SHADOW_RANGE;
        this.uniforms = {
            uWindTime: { value: 0 },
            uNearRange: { value: NEAR_RANGE },
            uFade: { value: FADE },
        };

        const atlas = getFoliageAtlas();
        yield 'forest:atlas';
        this.nearMaterial = this.createNearMaterial(atlas);
        const kinds: { species: Species; geometry: THREE.BufferGeometry }[] =
            [];
        SPECIES.forEach((species, s) => {
            for (let v = 0; v < VARIANTS; v++) {
                kinds.push({
                    species,
                    geometry: TREE_BUILDERS[species](1000 + s * 97 + v * 13),
                });
            }
        });
        yield 'forest:kinds';
        this.impostorTarget = this.bakeImpostors(renderer, kinds, atlas);
        this.impostorMaterial = this.createImpostorMaterial(
            this.impostorTarget.texture
        );
        yield 'forest:bake';

        // the real lap is 20.8 km, so this is about the density of the woods
        // along it
        const trees = yield* placing(
            track,
            terrain,
            quality === 'high' ? 32000 : 8000
        );
        yield 'forest:place';
        this.count = trees.reduce((sum, chunk) => sum + chunk.length, 0);
        for (let index = 0; index < trees.length; index++) {
            this.buildImpostorChunk(trees[index], kinds, index);
            yield 'forest:chunk';
        }
        this.trees = trees.flat();
        this.matrices = new Float32Array(this.trees.length * 16);
        this.colors = new Float32Array(this.trees.length * 3);
        this.buildNearSets(kinds);
        yield 'forest:near';
    }

    placeTrees(track: NordschleifeTrack, terrain: RaceTerrain, target: number) {
        return drain(placing(track, terrain, target));
    }

    tint(tree: Tree, color: THREE.Color) {
        const shade = 0.8 + tree.tint * 0.35;
        return color.setRGB(
            shade * (0.94 + tree.tint * 0.1),
            shade,
            shade * 0.92
        );
    }

    cellKey(cx: number, cz: number) {
        return (cx + 32768) * 65536 + (cz + 32768);
    }

    // every tree's matrix is baked once, the per frame work is copying the
    // ones in range into the instance buffers
    buildNearSets(kinds: { geometry: THREE.BufferGeometry }[]) {
        const matrix = new THREE.Matrix4();
        const quaternion = new THREE.Quaternion();
        const up = new THREE.Vector3(0, 1, 0);
        const scale = new THREE.Vector3();
        const position = new THREE.Vector3();
        const color = new THREE.Color();
        const perKind = kinds.map(() => 0);
        this.trees.forEach((tree, i) => {
            quaternion.setFromAxisAngle(up, tree.r);
            scale.set(tree.s, tree.s, tree.s);
            position.set(tree.x, tree.y, tree.z);
            matrix.compose(position, quaternion, scale);
            matrix.toArray(this.matrices, i * 16);
            this.tint(tree, color).toArray(this.colors, i * 3);
            perKind[tree.kind]++;
            const key = this.cellKey(
                Math.floor(tree.x / CELL_SIZE),
                Math.floor(tree.z / CELL_SIZE)
            );
            const cell = this.grid.get(key);
            if (cell) cell.push(i);
            else this.grid.set(key, [i]);
        });
        for (let r = 0; r < RING; r++) {
            const near: THREE.InstancedMesh[] = [];
            const shadow: THREE.InstancedMesh[] = [];
            kinds.forEach((kind, k) => {
                const capacity = Math.max(
                    1,
                    Math.min(NEAR_CAPACITY, perKind[k])
                );
                const visible = new THREE.InstancedMesh(
                    kind.geometry,
                    this.nearMaterial,
                    capacity
                );
                visible.name = `race-forest-near-${r}-${k}`;
                visible.raycast = () => {};
                visible.count = 0;
                visible.frustumCulled = false;
                visible.castShadow = false;
                visible.receiveShadow = false;
                visible.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
                visible.setColorAt(0, color);
                visible.instanceColor?.setUsage(THREE.DynamicDrawUsage);
                near.push(visible);
                this.root.add(visible);
                const caster = new THREE.InstancedMesh(
                    kind.geometry,
                    this.nearMaterial,
                    capacity
                );
                caster.name = `race-forest-shadow-${r}-${k}`;
                caster.raycast = () => {};
                caster.count = 0;
                caster.frustumCulled = false;
                caster.castShadow = true;
                caster.receiveShadow = false;
                caster.layers.set(TREE_SHADOW_LAYER);
                caster.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
                shadow.push(caster);
                this.root.add(caster);
            });
            this.nearSets.push(near);
            this.shadowSets.push(shadow);
        }
    }

    showSet(sets: THREE.InstancedMesh[][], slot: number) {
        sets.forEach((set, r) =>
            set.forEach((mesh) => (mesh.visible = r === slot))
        );
    }

    fill(
        meshes: THREE.InstancedMesh[],
        center: THREE.Vector3,
        range: number,
        withColor: boolean
    ) {
        meshes.forEach((mesh) => (mesh.count = 0));
        if (range <= 0) return;
        const range2 = range * range;
        const c0x = Math.floor((center.x - range) / CELL_SIZE);
        const c1x = Math.floor((center.x + range) / CELL_SIZE);
        const c0z = Math.floor((center.z - range) / CELL_SIZE);
        const c1z = Math.floor((center.z + range) / CELL_SIZE);
        for (let cx = c0x; cx <= c1x; cx++) {
            for (let cz = c0z; cz <= c1z; cz++) {
                const cell = this.grid.get(this.cellKey(cx, cz));
                if (!cell) continue;
                for (const i of cell) {
                    const tree = this.trees[i];
                    const dx = tree.x - center.x;
                    const dz = tree.z - center.z;
                    if (dx * dx + dz * dz > range2) continue;
                    const mesh = meshes[tree.kind];
                    if (mesh.count >= mesh.instanceMatrix.count) continue;
                    const slot = mesh.count++;
                    (mesh.instanceMatrix.array as Float32Array).set(
                        this.matrices.subarray(i * 16, i * 16 + 16),
                        slot * 16
                    );
                    if (withColor && mesh.instanceColor) {
                        (mesh.instanceColor.array as Float32Array).set(
                            this.colors.subarray(i * 3, i * 3 + 3),
                            slot * 3
                        );
                    }
                }
            }
        }
        meshes.forEach((mesh) => {
            if (!mesh.count) return;
            mesh.instanceMatrix.clearUpdateRanges();
            mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16);
            mesh.instanceMatrix.needsUpdate = true;
            if (withColor && mesh.instanceColor) {
                mesh.instanceColor.clearUpdateRanges();
                mesh.instanceColor.addUpdateRange(0, mesh.count * 3);
                mesh.instanceColor.needsUpdate = true;
            }
        });
    }

    buildImpostorChunk(
        trees: Tree[],
        kinds: { species: Species }[],
        index: number
    ) {
        if (!trees.length) return;
        const count = trees.length;
        const positions = new Float32Array(count * 12);
        const centers = new Float32Array(count * 12);
        const sizes = new Float32Array(count * 8);
        const uvs = new Float32Array(count * 8);
        const colors = new Float32Array(count * 12);
        const indices = new Uint32Array(count * 6);
        const corners = [
            [-0.5, 0],
            [0.5, 0],
            [0.5, 1],
            [-0.5, 1],
        ];
        const color = new THREE.Color();
        const box = new THREE.Box3();
        const point = new THREE.Vector3();
        const cells = kinds.length;
        trees.forEach((tree, t) => {
            const halfWidth = TREE_HALF_WIDTH[kinds[tree.kind].species];
            const u0 = tree.kind / cells;
            const u1 = (tree.kind + 1) / cells;
            this.tint(tree, color);
            corners.forEach(([cx, cy], c) => {
                const v = t * 4 + c;
                positions[v * 3] = cx;
                positions[v * 3 + 1] = cy;
                centers[v * 3] = tree.x;
                centers[v * 3 + 1] = tree.y;
                centers[v * 3 + 2] = tree.z;
                sizes[v * 2] = halfWidth * 2 * tree.s;
                sizes[v * 2 + 1] = 1.04 * tree.s;
                uvs[v * 2] = cx < 0 ? u0 : u1;
                uvs[v * 2 + 1] = cy;
                colors[v * 3] = color.r;
                colors[v * 3 + 1] = color.g;
                colors[v * 3 + 2] = color.b;
            });
            indices.set(
                [t * 4, t * 4 + 1, t * 4 + 2, t * 4, t * 4 + 2, t * 4 + 3],
                t * 6
            );
            box.expandByPoint(point.set(tree.x, tree.y, tree.z));
            box.expandByPoint(point.set(tree.x, tree.y + tree.s, tree.z));
        });
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
            'position',
            new THREE.BufferAttribute(positions, 3)
        );
        geometry.setAttribute('aCenter', new THREE.BufferAttribute(centers, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 2));
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        // positions are billboard corners, so the bounds come from the trees
        box.expandByScalar(20);
        geometry.boundingBox = box.clone();
        geometry.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
        const mesh = new THREE.Mesh(geometry, this.impostorMaterial);
        mesh.name = `race-forest-far-${index}`;
        // corner offsets aren't world positions, a raycast would hit nonsense
        mesh.raycast = () => {};
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        this.impostorMeshes.push(mesh);
        this.root.add(mesh);
    }

    // a side view of every tree variant into one strip, albedo times the baked
    // occlusion. lit again in the scene like everything else
    bakeImpostors(
        renderer: THREE.WebGLRenderer,
        kinds: { species: Species; geometry: THREE.BufferGeometry }[],
        atlas: THREE.Texture
    ) {
        const target = new THREE.WebGLRenderTarget(
            IMPOSTOR_CELL_WIDTH * kinds.length,
            IMPOSTOR_CELL_HEIGHT,
            {
                generateMipmaps: true,
                minFilter: THREE.LinearMipmapLinearFilter,
                magFilter: THREE.LinearFilter,
            }
        );
        const material = new THREE.MeshBasicMaterial({
            map: atlas,
            vertexColors: true,
            alphaTest: 0.5,
            side: THREE.DoubleSide,
        });
        const scene = new THREE.Scene();
        const previousTarget = renderer.getRenderTarget();
        const previousColor = renderer.getClearColor(new THREE.Color());
        const previousAlpha = renderer.getClearAlpha();
        renderer.setRenderTarget(target);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        target.scissorTest = true;
        kinds.forEach((kind, k) => {
            const halfWidth = TREE_HALF_WIDTH[kind.species];
            const camera = new THREE.OrthographicCamera(
                -halfWidth,
                halfWidth,
                0.52,
                -0.52,
                0.1,
                10
            );
            camera.position.set(0, 0.5, 5);
            camera.lookAt(0, 0.5, 0);
            camera.updateMatrixWorld();
            const mesh = new THREE.Mesh(kind.geometry, material);
            scene.add(mesh);
            target.viewport.set(
                k * IMPOSTOR_CELL_WIDTH,
                0,
                IMPOSTOR_CELL_WIDTH,
                IMPOSTOR_CELL_HEIGHT
            );
            target.scissor.copy(target.viewport);
            renderer.setRenderTarget(target);
            renderer.render(scene, camera);
            scene.remove(mesh);
        });
        target.scissorTest = false;
        target.viewport.set(0, 0, target.width, target.height);
        target.scissor.set(0, 0, target.width, target.height);
        renderer.setRenderTarget(previousTarget);
        renderer.setClearColor(previousColor, previousAlpha);
        material.dispose();
        return target;
    }

    createNearMaterial(atlas: THREE.Texture) {
        // lambert: foliage has no useful specular, and the standard sheen at
        // grazing angles frosts backlit crowns white
        const material = new THREE.MeshLambertMaterial({
            map: atlas,
            vertexColors: true,
            alphaTest: 0.4,
            alphaToCoverage: true,
            side: THREE.DoubleSide,
        });
        material.onBeforeCompile = (shader) => {
            Object.assign(shader.uniforms, this.uniforms);
            shader.vertexShader = shader.vertexShader
                .replace(
                    '#include <common>',
                    `#include <common>
attribute vec2 aWind;
uniform float uWindTime;
uniform float uNearRange;
uniform float uFade;
varying float vTreeDistance;`
                )
                .replace(
                    '#include <begin_vertex>',
                    `#include <begin_vertex>
#ifdef USE_INSTANCING
    vec3 treeOrigin = instanceMatrix[3].xyz;
#else
    vec3 treeOrigin = vec3(0.0);
#endif
    vTreeDistance = distance(cameraPosition, treeOrigin);
    float treePhase = dot(treeOrigin.xz, vec2(0.071, 0.113));
    float gust = 0.65 + 0.35 * sin(uWindTime * 0.31 + treeOrigin.x * 0.004);
    transformed.x += sin(uWindTime * 1.25 + treePhase) * aWind.x * 0.009 * gust;
    transformed.z += sin(uWindTime * 0.97 + treePhase * 1.7) * aWind.x * 0.006 * gust;
    float flutter = step(0.0001, aWind.y) * (0.3 + aWind.x);
    transformed += normal * sin(uWindTime * 5.3 + aWind.y) * flutter * 0.0025;
    // past the band the billboard has it, skip the whole tree
    if (vTreeDistance > uNearRange + uFade) transformed = vec3(0.0);`
                );
            shader.fragmentShader = shader.fragmentShader
                .replace(
                    '#include <common>',
                    `#include <common>
uniform float uNearRange;
uniform float uFade;
varying float vTreeDistance;
${DITHER}`
                )
                .replace(
                    '#include <clipping_planes_fragment>',
                    `#include <clipping_planes_fragment>
    if (smoothstep(uNearRange - uFade, uNearRange, vTreeDistance) > treeDither(gl_FragCoord.xy)) discard;`
                )
                .replace('#include <normal_fragment_begin>', UNFLIP);
        };
        material.customProgramCacheKey = () => 'race-forest-near';
        return material;
    }

    createImpostorMaterial(texture: THREE.Texture) {
        const material = new THREE.MeshLambertMaterial({
            map: texture,
            vertexColors: true,
            alphaTest: 0.35,
            side: THREE.DoubleSide,
        });
        material.onBeforeCompile = (shader) => {
            Object.assign(shader.uniforms, this.uniforms);
            shader.vertexShader = shader.vertexShader
                .replace(
                    '#include <common>',
                    `#include <common>
attribute vec3 aCenter;
attribute vec2 aSize;
uniform float uNearRange;
uniform float uFade;
varying float vTreeDistance;`
                )
                .replace(
                    '#include <beginnormal_vertex>',
                    `vec3 bbToCam = cameraPosition - aCenter;
    bbToCam.y = 0.0;
    bbToCam = normalize(bbToCam + vec3(0.0001, 0.0, 0.0));
    vec3 bbRight = vec3(bbToCam.z, 0.0, -bbToCam.x);
    vec3 objectNormal = normalize(bbToCam * 0.5 + vec3(0.0, 0.85, 0.0));`
                )
                .replace(
                    '#include <begin_vertex>',
                    `vec3 transformed = aCenter + bbRight * (position.x * aSize.x) + vec3(0.0, position.y * aSize.y, 0.0);
    vTreeDistance = distance(cameraPosition, aCenter);
    // inside the band the real tree has it
    if (vTreeDistance < uNearRange - uFade) transformed = aCenter;`
                );
            shader.fragmentShader = shader.fragmentShader
                .replace(
                    '#include <common>',
                    `#include <common>
uniform float uNearRange;
uniform float uFade;
varying float vTreeDistance;
${DITHER}`
                )
                .replace(
                    '#include <clipping_planes_fragment>',
                    `#include <clipping_planes_fragment>
    if (smoothstep(uNearRange - uFade, uNearRange, vTreeDistance) <= treeDither(gl_FragCoord.xy)) discard;`
                )
                .replace('#include <normal_fragment_begin>', UNFLIP);
        };
        material.customProgramCacheKey = () => 'race-forest-far';
        return material;
    }

    // refill the near and shadow sets once the camera or car has moved a bit
    update(camera: THREE.Camera, focus: THREE.Vector3, elapsedSeconds: number) {
        this.uniforms.uWindTime.value = elapsedSeconds;
        const eye = camera.position;
        if (
            this.dirty ||
            eye.distanceToSquared(this.lastEye) >
                REFILL_DISTANCE * REFILL_DISTANCE
        ) {
            // a little past the fade band so trees are in before they show
            const range =
                this.uniforms.uNearRange.value +
                this.uniforms.uFade.value +
                REFILL_DISTANCE;
            this.nearSlot = (this.nearSlot + 1) % RING;
            this.fill(this.nearSets[this.nearSlot], eye, range, true);
            this.showSet(this.nearSets, this.nearSlot);
            this.lastEye.copy(eye);
        }
        if (
            this.dirty ||
            focus.distanceToSquared(this.lastFocus) >
                REFILL_DISTANCE * REFILL_DISTANCE
        ) {
            this.shadowSlot = (this.shadowSlot + 1) % RING;
            this.fill(
                this.shadowSets[this.shadowSlot],
                focus,
                this.shadowRange,
                false
            );
            this.showSet(this.shadowSets, this.shadowSlot);
            this.lastFocus.copy(focus);
        }
        this.dirty = false;
    }

    applyPreset(settings: PresetSettings) {
        this.uniforms.uNearRange.value = settings.nearTreeRange;
        this.uniforms.uFade.value = Math.min(
            FADE,
            settings.nearTreeRange * 0.3
        );
        this.shadowRange = settings.treeShadowRange;
        this.dirty = true;
    }
}
