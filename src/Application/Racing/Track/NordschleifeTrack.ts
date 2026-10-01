import * as THREE from 'three';
import Application from '../../Application';
import Resources from '../../Utils/Resources';
import { drain, type Steps } from '../slicing';
import {
    createAsphaltTextures,
    createConcreteTexture,
    createGrassTexture,
} from '../Visuals/proceduralTextures';

const COLLIDER_LAYER = 1;
const ROOT_MARKER = 'nordschleifeTrackRoot';
const GROUND_PROBE_HEIGHT = 5000;
// the real ring from openstreetmap and the glo-30 dem, full length and full
// elevation (scripts/track/build_nordschleife.py). widths come from the data,
// 9.5 m on most of the lap, grass out to the barriers
const DEFAULT_ROAD_WIDTH = 9.5;
const VERGE_WIDTH = 3;
// the armco comes from osm per side, but never closer than this to the
// asphalt (room for the kerbs) or further than VERGE_MAX
const VERGE_MIN = 1.3;
const VERGE_MAX = 16;
// where another stretch of the lap passes within reach (the karussell's way
// in and out, adenauer forst), each verge stops short of halfway to it, so
// the two corridors never overlap. stretches this far apart along the lap
// count as other
const VERGE_APART = 150;
const VERGE_GAP = 1.5;
// on the inside of a corner a verge wider than about the radius folds the
// ribbons over themselves, so it's kept to this share of it
const VERGE_RADIUS_SHARE = 0.6;
// meters a verge may widen per meter along the lap, so its edge never bulges
// between the skirt's rings
const VERGE_SLOPE = 0.15;
const BARRIER_INSET = 0.15;
const EDGE_LINE_WIDTH = 0.18;
const EDGE_LINE_INSET = 0.3;
const KERB_WIDTH = 1.1;
// corners tighter than this get a kerb on the inside, tighter still on the
// outside at the exit too
const KERB_INSIDE_RADIUS = 160;
const KERB_OUTSIDE_RADIUS = 90;
const KERB_MIN_LENGTH = 18;
const KERB_EXTEND = 8;
// about 2.5 m apart over the 20.8 km lap
const FRAME_SAMPLES = 8192;
const FRAME_SEARCH_SPAN = 64;
// width and bank changes between sections blend over this
const SECTION_BLEND_METERS = 50;
// the ground collider is cut in chunks so a raycast only tests the one or two
// under the car instead of the whole lap
const COLLIDER_CHUNKS = 160;
// ribbon samples per meter of lap
const RIBBON_SAMPLES_PER_METER = 0.5;
const MARKING_LIFT = 0.02;
const KERB_LIFT = 0.025;
// the verges sit this far under the road plane (the terrain skirt meets
// their outer edge, so it reads this too)
export const VERGE_DROP = 0.012;
const ASPHALT_REPEAT_METERS = 32;
// depth bias units for the asphalt and verges, see createRoadMesh
const ROAD_DEPTH_PULL = -2;
// map cell size the ribbons are cut into for culling, meters
const RIBBON_CELL = 1200;

// one mesh per map cell, by triangle centroid. the pieces share the vertex
// buffers and only differ in index, with their own bounds for culling
export const splitByCell = (mesh: THREE.Mesh, cell: number) => {
    const geometry = mesh.geometry;
    const group = new THREE.Group();
    group.name = mesh.name;
    const index = geometry.getIndex();
    const position = geometry.getAttribute('position');
    if (!index) {
        group.add(mesh);
        return group;
    }
    const buckets = new Map<string, number[]>();
    for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i);
        const b = index.getX(i + 1);
        const c = index.getX(i + 2);
        const x = (position.getX(a) + position.getX(b) + position.getX(c)) / 3;
        const z = (position.getZ(a) + position.getZ(b) + position.getZ(c)) / 3;
        const key = `${Math.floor(x / cell)}:${Math.floor(z / cell)}`;
        const list = buckets.get(key);
        if (list) list.push(a, b, c);
        else buckets.set(key, [a, b, c]);
    }
    const box = new THREE.Box3();
    const point = new THREE.Vector3();
    buckets.forEach((list, key) => {
        const part = new THREE.BufferGeometry();
        Object.entries(geometry.attributes).forEach(([name, attribute]) =>
            part.setAttribute(name, attribute)
        );
        part.setIndex(list);
        box.makeEmpty();
        list.forEach((v) =>
            box.expandByPoint(point.fromBufferAttribute(position, v))
        );
        part.boundingBox = box.clone();
        part.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
        const piece = new THREE.Mesh(part, mesh.material);
        piece.name = `${mesh.name}-${key}`;
        piece.receiveShadow = mesh.receiveShadow;
        piece.castShadow = mesh.castShadow;
        piece.renderOrder = mesh.renderOrder;
        group.add(piece);
    });
    return group;
};

export type TrackSurface = 'asphalt' | 'kerb' | 'grass' | 'off';

// where a point sits relative to the track, reused between queries
export type TrackFrame = {
    index: number;
    distance: number;
    lateral: number;
    roadHalfWidth: number;
    // armco line on the side the point is on, and on each side
    barrierOffset: number;
    barrierLeft: number;
    barrierRight: number;
    tangentX: number;
    tangentZ: number;
    leftX: number;
    leftZ: number;
    kerbLeft: boolean;
    kerbRight: boolean;
    point: THREE.Vector3;
};

export type TrackSection = { name: string; distance: number };
export type TrackBridge = {
    distance: number;
    angle: number;
    kind: string | null;
    name: string | null;
};
// a landmark on the skyline from osm, its footprint around x, z
export type TrackLandmark = {
    name: string;
    kind: 'castle' | 'tower';
    x: number;
    z: number;
    height: number;
    outline: [number, number][];
};
// an osm road passing under one of the lap's bridges, on the lidar ground:
// x, y, z every 4 m for 70 m each side of the span
export type TrackUnderpass = {
    span: number;
    ref: string | null;
    name: string | null;
    highway: string;
    width: number;
    points: [number, number, number][];
};
// stretches where the lap itself is a bridge, meters along the lap
export type TrackSpan = {
    start: number;
    end: number;
};
export type TrackTerrainData = {
    x: number;
    z: number;
    cell: number;
    cols: number;
    rows: number;
    heights: Float32Array;
    forest: Uint8Array;
};

export type TrackAssetData = {
    name: string;
    closed: boolean;
    length: number;
    points: number[][];
    sections: TrackSection[];
    widths: [number, number][];
    banksDeg: [number, number][];
    // measured camber per point (dgm1 lidar), degrees, left edge higher is
    // positive. when it's there it replaces the corner banks
    rollDeg?: number[];
    // meters between points along the raw polyline
    spacing: number;
    concrete: [number, boolean][];
    // the osm armco per side, meters from the centerline, null where unmapped
    barriers?: [number, number | null, number | null][];
    bridges: TrackBridge[];
    // catch fence runs near the lap (osm), x, z every 6 m
    fences?: [number, number][][];
    landmarks?: TrackLandmark[];
    spans?: TrackSpan[];
    underpasses?: TrackUnderpass[];
    terrain: {
        x: number;
        z: number;
        cell: number;
        cols: number;
        rows: number;
        heightsDm: string;
        forest: string;
    };
};

const decodeBase64 = (text: string) => {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
};

type RibbonEdges = (t: number) => [number, number];

export default class NordschleifeTrack {
    application: Application;
    resources: Resources;
    scene: THREE.Scene;
    root: THREE.Group;
    visualMesh: THREE.Mesh;
    vergeMesh: THREE.Mesh;
    edgeMarkings: THREE.Mesh;
    kerbMesh: THREE.Mesh | null;
    concreteMesh: THREE.Mesh | null;
    colliderMesh: THREE.Group;
    visualCurve: THREE.CatmullRomCurve3;
    colliderCurve: THREE.CatmullRomCurve3;
    colliderRaycaster: THREE.Raycaster;
    groundRaycaster: THREE.Raycaster;
    groundProbe: THREE.Vector3;
    groundDown: THREE.Vector3;
    debugColliderRayEnabled: boolean;
    debugRayLine: THREE.Line | null;
    debugRayPoints: THREE.Vector3[];
    debugHitMarker: THREE.Mesh | null;
    length: number;
    framePoints: Float32Array;
    frameTangents: Float32Array;
    frameCurvature: Float32Array;
    frameWidth: Float32Array;
    // road and verge half width out to the armco, left and right
    frameVergeLeft: Float32Array;
    frameVergeRight: Float32Array;
    frameBank: Float32Array;
    // vertical curvature of the road profile, 1/m, negative over crests
    frameCrest: Float32Array;
    frameConcrete: Uint8Array;
    sections: TrackSection[];
    bridges: TrackBridge[];
    fences: [number, number][][];
    landmarks: TrackLandmark[];
    spans: TrackSpan[];
    underpasses: TrackUnderpass[];
    distanceScale: number;
    terrain: TrackTerrainData;
    kerbLeft: Uint8Array;
    kerbRight: Uint8Array;
    frameHint: number;

    // built when constructed, or with defer by running pending
    pending: Steps;

    // the ring from its json by default, or another lap's data (the drift park)
    constructor(parent: THREE.Object3D, defer = false, data: TrackAssetData | null = null) {
        this.pending = this.build(parent, data);
        if (!defer) drain(this.pending);
    }

    private *build(parent: THREE.Object3D, given: TrackAssetData | null): Steps {
        this.application = new Application();
        this.resources = this.application.resources;
        this.scene = this.application.scene;
        this.colliderRaycaster = new THREE.Raycaster();
        this.groundRaycaster = new THREE.Raycaster();
        this.groundRaycaster.layers.set(COLLIDER_LAYER);
        this.groundRaycaster.far = GROUND_PROBE_HEIGHT * 2;
        this.groundProbe = new THREE.Vector3();
        this.groundDown = new THREE.Vector3(0, -1, 0);
        this.debugRayLine = null;
        this.debugHitMarker = null;
        this.debugRayPoints = [new THREE.Vector3(), new THREE.Vector3()];
        this.frameHint = -1;
        this.distanceScale = 1;

        const urlParams = new URLSearchParams(window.location.search);
        this.debugColliderRayEnabled =
            urlParams.has('debug') ||
            urlParams.has('debugColliderRay') ||
            urlParams.has('debugRay');

        const data = given || this.getTrackAsset('nordschleifeData');

        this.root = new THREE.Group();
        this.root.name = given
            ? `${data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-track-root`
            : 'nordschleife-track-root';
        this.root.userData[ROOT_MARKER] = data.name;

        this.colliderCurve = this.createCurveFromAsset(data);
        this.visualCurve = this.colliderCurve;
        this.length = this.colliderCurve.getLength();
        this.sections = data.sections;
        this.bridges = data.bridges;
        this.fences = data.fences || [];
        this.landmarks = data.landmarks || [];
        this.spans = data.spans || [];
        this.underpasses = data.underpasses || [];
        this.terrain = {
            x: data.terrain.x,
            z: data.terrain.z,
            cell: data.terrain.cell,
            cols: data.terrain.cols,
            rows: data.terrain.rows,
            heights: Float32Array.from(
                new Uint16Array(decodeBase64(data.terrain.heightsDm).buffer),
                (dm) => dm / 10
            ),
            forest: decodeBase64(data.terrain.forest),
        };
        yield 'track:data';

        const frameCount = FRAME_SAMPLES;
        this.framePoints = new Float32Array(frameCount * 3);
        this.frameTangents = new Float32Array(frameCount * 2);
        this.frameCurvature = new Float32Array(frameCount);
        this.frameWidth = new Float32Array(frameCount);
        this.frameVergeLeft = new Float32Array(frameCount);
        this.frameVergeRight = new Float32Array(frameCount);
        this.frameBank = new Float32Array(frameCount);
        this.frameCrest = new Float32Array(frameCount);
        this.frameConcrete = new Uint8Array(frameCount);
        this.kerbLeft = new Uint8Array(frameCount);
        this.kerbRight = new Uint8Array(frameCount);
        this.buildFrames();
        yield 'track:frames';
        yield* this.buildProfiles(data);
        yield 'track:vergeSlopes';
        this.buildKerbZones();
        yield 'track:kerbZones';

        const samples = this.getRibbonSamples();
        yield 'track:samples';
        this.visualMesh = yield* this.createRoadMesh(samples);
        yield 'track:road';
        this.concreteMesh = this.createConcreteMesh();
        yield 'track:concrete';
        this.vergeMesh = yield* this.createVergeMesh(samples);
        yield 'track:verge';
        this.edgeMarkings = yield* this.createEdgeLineMesh(samples);
        yield 'track:edges';
        this.kerbMesh = this.createKerbMesh();
        yield 'track:kerbs';
        this.colliderMesh = this.createColliderMesh();
        yield 'track:collider';

        // each lap long ribbon is cut into map cells so only what's in view
        // is drawn, it used to be the whole 20 km every frame
        [
            this.visualMesh,
            this.concreteMesh,
            this.vergeMesh,
            this.edgeMarkings,
            this.kerbMesh,
        ].forEach((mesh) => {
            if (mesh) this.root.add(splitByCell(mesh, RIBBON_CELL));
        });
        yield 'track:split';
        this.root.add(this.colliderMesh);
        parent.add(this.root);

        this.warnIfDuplicateTrackRoots();
        this.setupDebugColliderRay();
    }

    getTrackAsset(name: string): TrackAssetData {
        const source = this.resources.items.json[name];
        if (
            !source ||
            !Array.isArray(source.points) ||
            source.points.length < 4
        ) {
            throw new Error(
                `[NordschleifeTrack] Missing valid track data: ${name}`
            );
        }
        return source as TrackAssetData;
    }

    // the points are 4 m apart already, the curve only smooths between them
    createCurveFromAsset(data: TrackAssetData) {
        const points = data.points.map(
            (point) => new THREE.Vector3(point[0], point[1], point[2])
        );
        const curve = new THREE.CatmullRomCurve3(
            points,
            data.closed ?? true,
            'centripetal',
            0.5
        );
        // the default 200 divisions would put getPointAt tens of meters off
        curve.arcLengthDivisions = points.length * 4;
        return curve;
    }

    // per frame road width, bank and surface from the section keyframes, each
    // change blended over SECTION_BLEND_METERS
    *buildProfiles(data: TrackAssetData): Steps {
        const count = FRAME_SAMPLES;
        const spacing = this.length / count;
        // the data's distances are along the raw polyline, the curve is a hair
        // shorter
        const scale = this.length / Math.max(1, data.length);
        this.distanceScale = scale;
        const sample = (keys: [number, number][], distance: number) => {
            let k = 0;
            while (k + 1 < keys.length && keys[k + 1][0] * scale <= distance)
                k++;
            const value = keys[k][1];
            const start = keys[k][0] * scale;
            const nextKey = keys[(k + 1) % keys.length];
            const next =
                k + 1 < keys.length
                    ? nextKey[0] * scale
                    : this.length + keys[0][0] * scale;
            const half = SECTION_BLEND_METERS / 2;
            const previous = keys[(k - 1 + keys.length) % keys.length][1];
            if (distance - start < half) {
                const f = 0.5 + (distance - start) / SECTION_BLEND_METERS;
                return THREE.MathUtils.lerp(previous, value, f);
            }
            if (next - distance < half) {
                const f = 0.5 - (next - distance) / SECTION_BLEND_METERS;
                return THREE.MathUtils.lerp(value, nextKey[1], f);
            }
            return value;
        };
        // the measured camber is per data point, the lidar says which way
        // (off camber corners too)
        const roll =
            data.rollDeg && data.rollDeg.length === data.points.length
                ? data.rollDeg
                : null;
        const sampleRoll = (distance: number) => {
            if (!roll) return 0;
            const f = distance / scale / data.spacing;
            const i = Math.floor(f);
            const k = f - i;
            const n = roll.length;
            return (
                roll[((i % n) + n) % n] * (1 - k) +
                roll[(((i + 1) % n) + n) % n] * k
            );
        };
        const concrete = data.concrete.map(
            ([distance, on]) => [distance, on ? 1 : 0] as [number, number]
        );
        // bank leans into the corner, so its sign follows the curvature over
        // a longer window than the kerbs use
        const window = Math.max(1, Math.round(25 / spacing));
        for (let i = 0; i < count; i++) {
            const distance = i * spacing;
            this.frameWidth[i] =
                sample(data.widths, distance) || DEFAULT_ROAD_WIDTH;
            let curvature = 0;
            for (let k = -window; k <= window; k++) {
                curvature +=
                    this.frameCurvature[(((i + k) % count) + count) % count];
            }
            const bank = THREE.MathUtils.degToRad(
                sample(data.banksDeg, distance)
            );
            // positive curvature turns left, and a left turn leans left, which
            // is a negative roll about the tangent
            this.frameBank[i] = roll
                ? THREE.MathUtils.degToRad(sampleRoll(distance))
                : -Math.sign(curvature) * bank;
            this.frameConcrete[i] = sample(concrete, distance) > 0.5 ? 1 : 0;
        }
        yield 'track:profiles';
        yield* this.buildVerges(data, scale);
    }

    // the armco line from osm, linear between its keyframes and kept between
    // VERGE_MIN and VERGE_MAX off the asphalt. unmapped stretches keep the
    // old rule of a VERGE_WIDTH verge
    *buildVerges(data: TrackAssetData, scale: number): Steps {
        const count = FRAME_SAMPLES;
        const spacing = this.length / count;
        const keys = data.barriers || [];
        let k = 0;
        for (let i = 0; i < count; i++) {
            const distance = (i * spacing) / scale;
            while (k + 1 < keys.length && keys[k + 1][0] <= distance) k++;
            const half = this.frameWidth[i] * 0.5;
            [1, 2].forEach((side) => {
                let barrier: number | null = null;
                if (keys.length) {
                    const a = keys[k];
                    const b = keys[(k + 1) % keys.length];
                    const end = k + 1 < keys.length ? b[0] : data.length + b[0];
                    const va = a[side];
                    const vb = b[side];
                    if (va !== null && vb !== null) {
                        const f = THREE.MathUtils.clamp(
                            (distance - a[0]) / Math.max(1e-6, end - a[0]),
                            0,
                            1
                        );
                        barrier = va + (vb - va) * f;
                    } else barrier = va ?? vb;
                }
                const verge =
                    barrier === null
                        ? half + VERGE_WIDTH
                        : THREE.MathUtils.clamp(
                              barrier + BARRIER_INSET,
                              half + VERGE_MIN,
                              half + VERGE_MAX
                          );
                (side === 1 ? this.frameVergeLeft : this.frameVergeRight)[i] =
                    verge;
            });
        }
        yield 'track:verges';
        yield* this.limitVergesNearOtherStretches();
        // only ever narrows, so every limit above still holds
        const step = VERGE_SLOPE * (this.length / count);
        [this.frameVergeLeft, this.frameVergeRight].forEach((verges) => {
            for (let pass = 0; pass < 2; pass++) {
                for (let i = 1; i <= count * 2; i++) {
                    const a = (i - 1) % count;
                    const b = i % count;
                    verges[b] = Math.min(verges[b], verges[a] + step);
                }
                for (let i = count * 2; i >= 1; i--) {
                    const a = i % count;
                    const b = (i - 1) % count;
                    verges[b] = Math.min(verges[b], verges[a] + step);
                }
            }
        });
    }

    *limitVergesNearOtherStretches(): Steps {
        const count = FRAME_SAMPLES;
        const points = this.framePoints;
        const cell = 20;
        const grid = new Map<string, number[]>();
        const key = (x: number, z: number) =>
            `${Math.floor(x / cell)}:${Math.floor(z / cell)}`;
        for (let i = 0; i < count; i++) {
            const k = key(points[i * 3], points[i * 3 + 2]);
            const list = grid.get(k);
            if (list) list.push(i);
            else grid.set(k, [i]);
        }
        const apart = Math.round((VERGE_APART / this.length) * count);
        const reach = Math.ceil((VERGE_MAX * 2 + 20) / cell);
        for (let i = 0; i < count; i++) {
            if (i % 512 === 0) yield 'track:vergeLimits';
            const x = points[i * 3];
            const z = points[i * 3 + 2];
            const cx = Math.floor(x / cell);
            const cz = Math.floor(z / cell);
            let nearest = Infinity;
            for (let dx = -reach; dx <= reach; dx++) {
                for (let dz = -reach; dz <= reach; dz++) {
                    const list = grid.get(`${cx + dx}:${cz + dz}`);
                    if (!list) continue;
                    for (const j of list) {
                        const along = Math.abs(i - j);
                        if (Math.min(along, count - along) < apart) continue;
                        const d = Math.hypot(
                            points[j * 3] - x,
                            points[j * 3 + 2] - z
                        );
                        if (d < nearest) nearest = d;
                    }
                }
            }
            const half = this.frameWidth[i] * 0.5;
            // inside of the corner: left when it turns left
            let curvature = 0;
            const window = Math.max(1, Math.round((10 / this.length) * count));
            for (let k = -window; k <= window; k++)
                curvature += this.frameCurvature[(i + k + count) % count];
            curvature /= window * 2 + 1;
            if (Math.abs(curvature) > 1e-4) {
                const inside = Math.max(
                    half + VERGE_MIN,
                    VERGE_RADIUS_SHARE / Math.abs(curvature)
                );
                const verges =
                    curvature > 0 ? this.frameVergeLeft : this.frameVergeRight;
                verges[i] = Math.min(verges[i], inside);
            }
            if (nearest === Infinity) continue;
            const limit = Math.max(half + VERGE_MIN, nearest / 2 - VERGE_GAP);
            this.frameVergeLeft[i] = Math.min(this.frameVergeLeft[i], limit);
            this.frameVergeRight[i] = Math.min(this.frameVergeRight[i], limit);
        }
    }

    frameValue(values: Float32Array, t: number) {
        const count = FRAME_SAMPLES;
        const f = (((t % 1) + 1) % 1) * count;
        const i = Math.floor(f) % count;
        const j = (i + 1) % count;
        return THREE.MathUtils.lerp(values[i], values[j], f - Math.floor(f));
    }

    getRoadHalfWidth(t: number) {
        return this.frameValue(this.frameWidth, t) * 0.5;
    }

    // out to the armco on the left (side > 0) or right (side < 0), or the
    // wider of the two
    getVergeHalfWidth(t: number, side = 0) {
        if (side > 0) return this.frameValue(this.frameVergeLeft, t);
        if (side < 0) return this.frameValue(this.frameVergeRight, t);
        return Math.max(
            this.frameValue(this.frameVergeLeft, t),
            this.frameValue(this.frameVergeRight, t)
        );
    }

    getSectionAt(distance: number) {
        const d = ((distance % this.length) + this.length) % this.length;
        let current = this.sections[this.sections.length - 1];
        for (const section of this.sections) {
            if (section.distance * this.distanceScale <= d) current = section;
        }
        return current;
    }

    // evenly spaced samples of the physics curve with tangents, curvature and
    // width, for fast lookups while driving
    buildFrames() {
        const count = FRAME_SAMPLES;
        const point = new THREE.Vector3();
        const tangent = new THREE.Vector3();
        for (let i = 0; i < count; i++) {
            const t = i / count;
            this.colliderCurve.getPointAt(t, point);
            this.colliderCurve.getTangentAt(t, tangent);
            const horizontal = Math.hypot(tangent.x, tangent.z) || 1;
            this.framePoints[i * 3] = point.x;
            this.framePoints[i * 3 + 1] = point.y;
            this.framePoints[i * 3 + 2] = point.z;
            this.frameTangents[i * 2] = tangent.x / horizontal;
            this.frameTangents[i * 2 + 1] = tangent.z / horizontal;
        }
        const spacing = this.length / count;
        const span = Math.max(1, Math.round(12 / spacing));
        for (let i = 0; i < count; i++) {
            const a = (((i - span) % count) + count) % count;
            const b = (i + span) % count;
            const headingA = Math.atan2(
                this.frameTangents[a * 2],
                this.frameTangents[a * 2 + 1]
            );
            const headingB = Math.atan2(
                this.frameTangents[b * 2],
                this.frameTangents[b * 2 + 1]
            );
            let turn = headingB - headingA;
            turn = Math.atan2(Math.sin(turn), Math.cos(turn));
            // positive curves left, same sign as yaw
            this.frameCurvature[i] = turn / (2 * span * spacing);
        }
        // over about 8 m either side, which is what a car's length feels
        const crestSpan = Math.max(1, Math.round(8 / spacing));
        for (let i = 0; i < count; i++) {
            const a = (((i - crestSpan) % count) + count) % count;
            const b = (i + crestSpan) % count;
            const h = crestSpan * spacing;
            this.frameCrest[i] =
                (this.framePoints[a * 3 + 1] -
                    2 * this.framePoints[i * 3 + 1] +
                    this.framePoints[b * 3 + 1]) /
                (h * h);
        }
    }

    buildKerbZones() {
        const count = FRAME_SAMPLES;
        const spacing = this.length / count;
        const smooth = new Float32Array(count);
        const window = Math.max(1, Math.round(15 / spacing));
        for (let i = 0; i < count; i++) {
            let sum = 0;
            for (let k = -window; k <= window; k++) {
                sum += this.frameCurvature[(((i + k) % count) + count) % count];
            }
            smooth[i] = sum / (window * 2 + 1);
        }
        const mark = (
            target: Uint8Array,
            test: (curvature: number) => boolean
        ) => {
            const raw = new Uint8Array(count);
            for (let i = 0; i < count; i++) {
                raw[i] = test(smooth[i]) ? 1 : 0;
            }
            // drop short runs, then extend each run a little both ways
            const minRun = Math.round(KERB_MIN_LENGTH / spacing);
            const extend = Math.round(KERB_EXTEND / spacing);
            let i = 0;
            while (i < count) {
                if (!raw[i]) {
                    i++;
                    continue;
                }
                let j = i;
                while (j < count && raw[j]) j++;
                if (j - i >= minRun) {
                    for (let k = i - extend; k < j + extend; k++) {
                        target[((k % count) + count) % count] = 1;
                    }
                }
                i = j;
            }
        };
        mark(this.kerbLeft, (k) => k > 1 / KERB_INSIDE_RADIUS);
        mark(this.kerbRight, (k) => k < -1 / KERB_INSIDE_RADIUS);
        // outside kerbs on the tighter corners
        mark(this.kerbLeft, (k) => k < -1 / KERB_OUTSIDE_RADIUS);
        mark(this.kerbRight, (k) => k > 1 / KERB_OUTSIDE_RADIUS);
    }

    // nearest track frame to a world position. searches near the last hit
    // first, so it's cheap when called every step
    queryFrame(
        x: number,
        z: number,
        target: TrackFrame,
        hint = this.frameHint
    ): TrackFrame {
        const count = FRAME_SAMPLES;
        let best = hint >= 0 ? hint : 0;
        let bestDistance = Infinity;
        const scan = (from: number, to: number) => {
            for (let k = from; k <= to; k++) {
                const i = ((k % count) + count) % count;
                const dx = this.framePoints[i * 3] - x;
                const dz = this.framePoints[i * 3 + 2] - z;
                const d = dx * dx + dz * dz;
                if (d < bestDistance) {
                    bestDistance = d;
                    best = i;
                }
            }
        };
        if (hint >= 0) scan(hint - FRAME_SEARCH_SPAN, hint + FRAME_SEARCH_SPAN);
        if (hint < 0 || bestDistance > 60 * 60) scan(0, count - 1);
        this.frameHint = best;

        // project onto the segment toward the closer neighbour
        const next = (best + 1) % count;
        const prev = (best - 1 + count) % count;
        const bx = this.framePoints[best * 3];
        const bz = this.framePoints[best * 3 + 2];
        const tx = this.frameTangents[best * 2];
        const tz = this.frameTangents[best * 2 + 1];
        const along = (x - bx) * tx + (z - bz) * tz;
        const other = along >= 0 ? next : prev;
        const spacing = this.length / count;
        const f = THREE.MathUtils.clamp(Math.abs(along) / spacing, 0, 1);
        const px = THREE.MathUtils.lerp(bx, this.framePoints[other * 3], f);
        const py = THREE.MathUtils.lerp(
            this.framePoints[best * 3 + 1],
            this.framePoints[other * 3 + 1],
            f
        );
        const pz = THREE.MathUtils.lerp(bz, this.framePoints[other * 3 + 2], f);
        const leftX = tz;
        const leftZ = -tx;
        const roadHalf = this.frameWidth[best] * 0.5;

        target.index = best;
        target.distance = (best / count) * this.length + along;
        target.lateral = (x - px) * leftX + (z - pz) * leftZ;
        target.roadHalfWidth = roadHalf;
        target.barrierLeft = this.frameVergeLeft[best] - BARRIER_INSET;
        target.barrierRight = this.frameVergeRight[best] - BARRIER_INSET;
        target.barrierOffset =
            target.lateral >= 0 ? target.barrierLeft : target.barrierRight;
        target.tangentX = tx;
        target.tangentZ = tz;
        target.leftX = leftX;
        target.leftZ = leftZ;
        target.kerbLeft = this.kerbLeft[best] === 1;
        target.kerbRight = this.kerbRight[best] === 1;
        target.point.set(px, py, pz);
        return target;
    }

    createFrame(): TrackFrame {
        return {
            index: 0,
            distance: 0,
            lateral: 0,
            roadHalfWidth: DEFAULT_ROAD_WIDTH * 0.5,
            barrierOffset:
                DEFAULT_ROAD_WIDTH * 0.5 + VERGE_WIDTH - BARRIER_INSET,
            barrierLeft: DEFAULT_ROAD_WIDTH * 0.5 + VERGE_WIDTH - BARRIER_INSET,
            barrierRight:
                DEFAULT_ROAD_WIDTH * 0.5 + VERGE_WIDTH - BARRIER_INSET,
            tangentX: 0,
            tangentZ: 1,
            leftX: 1,
            leftZ: 0,
            kerbLeft: false,
            kerbRight: false,
            point: new THREE.Vector3(),
        };
    }

    // what's under a point at a lateral offset from a frame
    getSurface(frame: TrackFrame, lateral: number): TrackSurface {
        const side = Math.abs(lateral);
        if (side <= frame.roadHalfWidth) {
            const onKerb =
                side >= frame.roadHalfWidth - KERB_WIDTH &&
                (lateral > 0 ? frame.kerbLeft : frame.kerbRight);
            return onKerb ? 'kerb' : 'asphalt';
        }
        const barrier = lateral > 0 ? frame.barrierLeft : frame.barrierRight;
        if (side <= barrier + BARRIER_INSET) return 'grass';
        return 'off';
    }

    getSampleCount() {
        return FRAME_SAMPLES;
    }

    // stations the road and verge ribbons are built on, 2 m apart. anything
    // that has to meet a ribbon edge exactly (the terrain skirt) uses these
    getRibbonSamples() {
        return Math.round(this.length * RIBBON_SAMPLES_PER_METER);
    }

    // banked frame of the curve at t, shared by every ribbon so they line up
    getRibbonFrame(
        curve: THREE.Curve<THREE.Vector3>,
        t: number,
        point: THREE.Vector3,
        tangent: THREE.Vector3,
        normal: THREE.Vector3,
        side: THREE.Vector3,
        previousSide: THREE.Vector3
    ) {
        curve.getPointAt(t, point);
        curve.getTangentAt(t, tangent).normalize();
        normal.set(0, 1, 0);
        side.crossVectors(normal, tangent);
        if (side.lengthSq() < 1e-6) {
            side.copy(previousSide);
        } else {
            side.normalize();
            if (side.dot(previousSide) < 0) side.multiplyScalar(-1);
            previousSide.copy(side);
        }
        const bankAngle = this.frameValue(this.frameBank, t);
        normal.set(0, 1, 0).applyAxisAngle(tangent, bankAngle).normalize();
        side.crossVectors(normal, tangent).normalize();
    }

    // a flat strip between two lateral offsets (positive is left), lifted
    // along the road normal. v runs with distance
    createRibbonGeometry(
        curve: THREE.Curve<THREE.Vector3>,
        samples: number,
        edges: RibbonEdges,
        // one lift for both edges, or one per edge in the order edges gives
        lift: number | [number, number],
        vScale: number,
        range: [number, number] = [0, 1]
    ) {
        const point = new THREE.Vector3();
        const tangent = new THREE.Vector3();
        const normal = new THREE.Vector3();
        const side = new THREE.Vector3(1, 0, 0);
        const previousSide = new THREE.Vector3(1, 0, 0);
        const previousPoint = new THREE.Vector3();
        const a = new THREE.Vector3();
        const b = new THREE.Vector3();
        const vertices: number[] = [];
        const uvs: number[] = [];
        const indices: number[] = [];
        let distance = 0;
        const [start, end] = range;
        const [liftA, liftB] = typeof lift === 'number' ? [lift, lift] : lift;
        const steps = Math.max(1, Math.ceil(samples * (end - start)));
        for (let i = 0; i <= steps; i++) {
            const raw = start + ((end - start) * i) / steps;
            const t = ((raw % 1) + 1) % 1;
            this.getRibbonFrame(
                curve,
                t,
                point,
                tangent,
                normal,
                side,
                previousSide
            );
            const [inner, outer] = edges(t);
            a.copy(point)
                .addScaledVector(side, inner)
                .addScaledVector(normal, liftA);
            b.copy(point)
                .addScaledVector(side, outer)
                .addScaledVector(normal, liftB);
            vertices.push(a.x, a.y, a.z, b.x, b.y, b.z);
            if (i > 0) distance += point.distanceTo(previousPoint);
            previousPoint.copy(point);
            const v = distance * vScale;
            uvs.push(0, v, 1, v);
        }
        for (let i = 0; i < steps; i++) {
            const i0 = i * 2;
            indices.push(i0, i0 + 1, i0 + 3, i0, i0 + 3, i0 + 2);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setIndex(indices);
        geometry.setAttribute(
            'position',
            new THREE.Float32BufferAttribute(vertices, 3)
        );
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.computeVertexNormals();
        // winding flips with the edge order, so make every normal face up
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
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        return geometry;
    }

    // the asphalt texture covers the road's width and 32 m of its length
    *createRoadMesh(samples: number): Generator<string | void, THREE.Mesh, void> {
        const geometry = this.createRibbonGeometry(
            this.visualCurve,
            samples,
            (t) => [this.getRoadHalfWidth(t), -this.getRoadHalfWidth(t)],
            0,
            1 / ASPHALT_REPEAT_METERS
        );
        yield 'track:roadRibbon';
        const { map, roughnessMap } = createAsphaltTextures();
        map.anisotropy = this.getTextureAnisotropy();
        roughnessMap.anisotropy = this.getTextureAnisotropy();
        // the ground under the road is carved well below it, but far away the
        // depth buffer can't tell them apart. a constant pull toward the
        // camera (units only: a slope term grows huge at grazing angles) lets
        // the road win those ties and is sub millimeter near the car. kerbs,
        // lines and decals are pulled further, so they still draw on top
        const material = new THREE.MeshStandardMaterial({
            map,
            roughnessMap,
            roughness: 1,
            metalness: 0,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: 0,
            polygonOffsetUnits: ROAD_DEPTH_PULL,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'nordschleife-visual';
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        mesh.frustumCulled = false;
        return mesh;
    }

    // the inner edge is the asphalt's own edge (no lift, so the vertices are
    // the same numbers) and only the outer edge drops. dropping both along a
    // banked normal slid the inner edge sideways and left a hairline gap
    *createVergeMesh(samples: number): Generator<string | void, THREE.Mesh, void> {
        const left = this.createRibbonGeometry(
            this.visualCurve,
            samples,
            (t) => [this.getVergeHalfWidth(t, 1), this.getRoadHalfWidth(t)],
            [-VERGE_DROP, 0],
            1 / 7
        );
        yield 'track:vergeLeft';
        const right = this.createRibbonGeometry(
            this.visualCurve,
            samples,
            (t) => [-this.getRoadHalfWidth(t), -this.getVergeHalfWidth(t, -1)],
            [0, -VERGE_DROP],
            1 / 7
        );
        yield 'track:vergeRight';
        const geometry = this.mergeRibbons([left, right]);
        const grass = createGrassTexture();
        // the verge strip is 3.5 m wide, keep the grass detail about 7 m
        grass.repeat.set(VERGE_WIDTH / 7, 1);
        const material = new THREE.MeshStandardMaterial({
            color: 0x86a45a,
            map: grass,
            roughness: 1,
            metalness: 0,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: 0,
            polygonOffsetUnits: ROAD_DEPTH_PULL,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'nordschleife-verge';
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        return mesh;
    }

    *createEdgeLineMesh(samples: number): Generator<string | void, THREE.Mesh, void> {
        const inner = (t: number) => this.getRoadHalfWidth(t) - EDGE_LINE_INSET;
        const left = this.createRibbonGeometry(
            this.visualCurve,
            samples,
            (t) => [inner(t), inner(t) - EDGE_LINE_WIDTH],
            MARKING_LIFT,
            0.05
        );
        yield 'track:edgeLeft';
        const right = this.createRibbonGeometry(
            this.visualCurve,
            samples,
            (t) => [-inner(t) + EDGE_LINE_WIDTH, -inner(t)],
            MARKING_LIFT,
            0.05
        );
        yield 'track:edgeRight';
        const material = new THREE.MeshStandardMaterial({
            color: 0xe8e8e2,
            roughness: 0.6,
            metalness: 0,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -4,
            polygonOffsetUnits: -8,
        });
        const mesh = new THREE.Mesh(this.mergeRibbons([left, right]), material);
        mesh.name = 'nordschleife-edge-lines';
        mesh.receiveShadow = true;
        mesh.renderOrder = 2;
        mesh.frustumCulled = false;
        return mesh;
    }

    getKerbRuns(flags: Uint8Array) {
        const count = FRAME_SAMPLES;
        const runs: [number, number][] = [];
        let start = -1;
        for (let i = 0; i <= count; i++) {
            const on = i < count && flags[i] === 1;
            if (on && start < 0) start = i;
            if (!on && start >= 0) {
                runs.push([start / count, i / count]);
                start = -1;
            }
        }
        return runs;
    }

    createKerbMesh() {
        const spacing = this.length / FRAME_SAMPLES;
        const parts: THREE.BufferGeometry[] = [];
        const add = (flags: Uint8Array, left: boolean) => {
            this.getKerbRuns(flags).forEach((range) => {
                const samples = Math.max(
                    4,
                    Math.round(((range[1] - range[0]) * this.length) / 2)
                );
                parts.push(
                    this.createRibbonGeometry(
                        this.visualCurve,
                        Math.round(samples / (range[1] - range[0])),
                        (t) => {
                            const edge = this.getRoadHalfWidth(t);
                            return left
                                ? [edge, edge - KERB_WIDTH]
                                : [-edge + KERB_WIDTH, -edge];
                        },
                        KERB_LIFT,
                        // red and white blocks, 2 m each
                        0.25,
                        range
                    )
                );
            });
        };
        add(this.kerbLeft, true);
        add(this.kerbRight, false);
        if (!parts.length || spacing <= 0) return null;
        const material = new THREE.MeshStandardMaterial({
            map: this.createKerbTexture(),
            roughness: 0.7,
            metalness: 0,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -6,
            polygonOffsetUnits: -12,
        });
        const mesh = new THREE.Mesh(this.mergeRibbons(parts), material);
        mesh.name = 'nordschleife-kerbs';
        mesh.receiveShadow = true;
        mesh.renderOrder = 3;
        mesh.frustumCulled = false;
        return mesh;
    }

    createKerbTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 8;
        canvas.height = 64;
        const context = canvas.getContext('2d');
        if (!context) return new THREE.Texture();
        context.fillStyle = '#c8261f';
        context.fillRect(0, 0, 8, 32);
        context.fillStyle = '#ecebe6';
        context.fillRect(0, 32, 8, 32);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.magFilter = THREE.NearestFilter;
        texture.anisotropy = this.getTextureAnisotropy();
        return texture;
    }

    mergeRibbons(parts: THREE.BufferGeometry[]) {
        const positions: number[] = [];
        const normals: number[] = [];
        const uvs: number[] = [];
        const indices: number[] = [];
        let offset = 0;
        parts.forEach((part) => {
            const position = part.getAttribute('position');
            const normal = part.getAttribute('normal');
            const uv = part.getAttribute('uv');
            for (let i = 0; i < position.count; i++) {
                positions.push(
                    position.getX(i),
                    position.getY(i),
                    position.getZ(i)
                );
                normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
                uvs.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
            }
            const index = part.getIndex();
            if (index) {
                for (let i = 0; i < index.count; i++)
                    indices.push(index.getX(i) + offset);
            }
            offset += position.count;
            part.dispose();
        });
        const geometry = new THREE.BufferGeometry();
        geometry.setIndex(indices);
        geometry.setAttribute(
            'position',
            new THREE.Float32BufferAttribute(positions, 3)
        );
        geometry.setAttribute(
            'normal',
            new THREE.Float32BufferAttribute(normals, 3)
        );
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        return geometry;
    }

    createColliderMesh() {
        const group = new THREE.Group();
        group.name = 'nordschleife-collider';
        const material = new THREE.MeshBasicMaterial({
            color: 0x00ff88,
            wireframe: true,
            transparent: true,
            opacity: 0.15,
        });
        // 2 m samples so the collider follows the visual ribbon closely
        const samples = Math.round(this.length / 2);
        for (let chunk = 0; chunk < COLLIDER_CHUNKS; chunk++) {
            const range: [number, number] = [
                chunk / COLLIDER_CHUNKS,
                (chunk + 1) / COLLIDER_CHUNKS,
            ];
            const geometry = this.createRibbonGeometry(
                this.colliderCurve,
                samples,
                (t) => [
                    this.getVergeHalfWidth(t, 1),
                    -this.getVergeHalfWidth(t, -1),
                ],
                0,
                0,
                range
            );
            const mesh = new THREE.Mesh(geometry, material);
            mesh.name = `nordschleife-collider-${chunk}`;
            mesh.visible = false;
            mesh.layers.set(COLLIDER_LAYER);
            group.add(mesh);
        }
        group.updateMatrixWorld(true);
        return group;
    }

    // the karussell's banked concrete, drawn over the asphalt
    createConcreteMesh() {
        const runs = this.getKerbRuns(this.frameConcrete);
        if (!runs.length) return null;
        const parts = runs.map((range) =>
            this.createRibbonGeometry(
                this.visualCurve,
                Math.round(this.length * RIBBON_SAMPLES_PER_METER * 2),
                (t) => [this.getRoadHalfWidth(t), -this.getRoadHalfWidth(t)],
                0.01,
                1 / 3,
                range
            )
        );
        const material = new THREE.MeshStandardMaterial({
            map: createConcreteTexture(),
            roughness: 0.85,
            metalness: 0,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -4,
        });
        const mesh = new THREE.Mesh(this.mergeRibbons(parts), material);
        mesh.name = 'nordschleife-concrete';
        mesh.receiveShadow = true;
        mesh.renderOrder = 1;
        return mesh;
    }

    getTextureAnisotropy() {
        const renderer = this.application.renderer?.instance;
        if (!renderer?.capabilities?.getMaxAnisotropy) {
            return 1;
        }
        return Math.min(8, renderer.capabilities.getMaxAnisotropy());
    }

    warnIfDuplicateTrackRoots() {
        const name = this.root.userData[ROOT_MARKER];
        let rootCount = 0;
        this.scene.traverse((child) => {
            if (child.userData?.[ROOT_MARKER] === name) {
                rootCount++;
            }
        });

        if (rootCount !== 1) {
            console.warn(
                `[Racing] Expected exactly one ${name} track root, found ${rootCount}.`
            );
        }
    }

    setupDebugColliderRay() {
        if (!this.debugColliderRayEnabled) return;

        const rayMaterial = new THREE.LineBasicMaterial({
            color: 0x00ff7f,
            depthTest: false,
            depthWrite: false,
        });
        const rayGeometry = new THREE.BufferGeometry().setFromPoints(
            this.debugRayPoints
        );

        this.debugRayLine = new THREE.Line(rayGeometry, rayMaterial);
        this.debugRayLine.name = 'nordschleife-collider-ray-debug';
        this.root.add(this.debugRayLine);

        this.debugHitMarker = new THREE.Mesh(
            new THREE.SphereGeometry(30, 16, 16),
            new THREE.MeshBasicMaterial({
                color: 0xff5f5f,
                depthTest: false,
                depthWrite: false,
            })
        );
        this.debugHitMarker.name = 'nordschleife-collider-hit-debug';
        this.root.add(this.debugHitMarker);
    }

    updateDebugColliderRay() {
        if (
            !this.debugColliderRayEnabled ||
            !this.debugRayLine ||
            !this.debugHitMarker
        ) {
            return;
        }

        const t = (this.application.time.elapsed * 0.00002) % 1;
        const curvePoint = this.colliderCurve.getPointAt(t);
        const origin = curvePoint.clone().add(new THREE.Vector3(0, 5000, 0));
        const direction = new THREE.Vector3(0, -1, 0);

        this.colliderRaycaster.layers.set(COLLIDER_LAYER);
        this.colliderRaycaster.set(origin, direction);
        this.colliderRaycaster.far = 12000;

        const hits = this.colliderRaycaster.intersectObject(
            this.colliderMesh,
            true
        );
        const end = hits[0]
            ? hits[0].point.clone()
            : origin.clone().addScaledVector(direction, 12000);

        this.debugRayPoints[0].copy(origin);
        this.debugRayPoints[1].copy(end);

        (this.debugRayLine.geometry as THREE.BufferGeometry).setFromPoints(
            this.debugRayPoints
        );
        this.debugHitMarker.position.copy(end);
    }

    getColliderMesh() {
        return this.colliderMesh;
    }

    // road height (and surface normal) under a point, for things that ride the
    // track without their own physics, like ghost replays
    sampleGround(x: number, z: number, normal?: THREE.Vector3) {
        this.groundRaycaster.set(
            this.groundProbe.set(x, GROUND_PROBE_HEIGHT, z),
            this.groundDown
        );
        const hit = this.groundRaycaster.intersectObject(
            this.colliderMesh,
            true
        )[0];
        if (!hit) return null;
        if (normal) {
            normal
                .copy(hit.face?.normal || this.groundDown)
                .transformDirection(hit.object.matrixWorld);
            if (normal.y < 0) normal.negate();
        }
        return hit.point.y;
    }

    getColliderLayer() {
        return COLLIDER_LAYER;
    }

    getCurve() {
        return this.colliderCurve;
    }

    update() {
        this.updateDebugColliderRay();
    }
}
