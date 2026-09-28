import * as THREE from 'three';
import Application from '../../Application';
import Resources from '../../Utils/Resources';
import {
    createAsphaltTextures,
    createGrassTexture,
} from '../Visuals/proceduralTextures';

const COLLIDER_LAYER = 1;
const DEFAULT_UV_SCALE = 0.0015;
const DEFAULT_SAMPLES = 1200;
const ROOT_MARKER = 'nordschleifeTrackRoot';
const START_PAD_EXTRA_WIDTH_SCALE = 0.55;
const START_PAD_BLEND = 0.045;
const START_PAD_FLAT_BLEND = 0.08;
const START_PAD_BANK_BLEND = 0.12;
const TRACK_LENGTH_SCALE = 0.475;
// the source heights span ~560m (the real ring climbs ~300m) and the lap is
// squeezed to 0.475 of its length, so raw heights gave 30-120% grades. this
// keeps them near the real ring's 5-17%
const TRACK_ELEVATION_SCALE = 0.3;
const GROUND_PROBE_HEIGHT = 5000;
// the road is 16 m (the real ring is ~9 m, the old one here was 36 m) with
// grass verges out to the barriers. the collider covers road and verges.
// the track json widths say the same (16 and 23)
const ROAD_WIDTH = 16;
const VERGE_WIDTH = 3.5;
const BARRIER_INSET = 0.15;
const EDGE_LINE_WIDTH = 0.22;
const EDGE_LINE_INSET = 0.35;
const KERB_WIDTH = 1.3;
// corners tighter than this get a kerb on the inside, tighter still on the
// outside at the exit too
const KERB_INSIDE_RADIUS = 300;
const KERB_OUTSIDE_RADIUS = 170;
const KERB_MIN_LENGTH = 24;
const KERB_EXTEND = 10;
const FRAME_SAMPLES = 4096;
const FRAME_SEARCH_SPAN = 48;
const MARKING_LIFT = 0.02;
const KERB_LIFT = 0.025;
const VERGE_DROP = 0.012;
const ASPHALT_REPEAT_METERS = 32;

export type TrackSurface = 'asphalt' | 'kerb' | 'grass' | 'off';

// where a point sits relative to the track, reused between queries
export type TrackFrame = {
    index: number;
    distance: number;
    lateral: number;
    roadHalfWidth: number;
    barrierOffset: number;
    tangentX: number;
    tangentZ: number;
    leftX: number;
    leftZ: number;
    kerbLeft: boolean;
    kerbRight: boolean;
    point: THREE.Vector3;
};

type TrackAssetData = {
    name?: string;
    closed?: boolean;
    samples?: number;
    width?: number;
    uvScale?: number;
    offset?: number[];
    points: number[][];
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
    colliderMesh: THREE.Mesh;
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
    frameWidthScale: Float32Array;
    kerbLeft: Uint8Array;
    kerbRight: Uint8Array;
    frameHint: number;

    constructor(parent: THREE.Object3D) {
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

        const urlParams = new URLSearchParams(window.location.search);
        this.debugColliderRayEnabled =
            urlParams.has('debug') ||
            urlParams.has('debugColliderRay') ||
            urlParams.has('debugRay');

        const visualData = this.getTrackAsset('nordschleifeVisualData');
        const colliderData = this.getTrackAsset('nordschleifeColliderData');

        this.root = new THREE.Group();
        this.root.name = 'nordschleife-track-root';
        this.root.userData[ROOT_MARKER] = true;

        this.visualCurve = this.createCurveFromAsset(visualData);
        this.colliderCurve = this.createCurveFromAsset(colliderData);
        this.length = this.colliderCurve.getLength();

        const frameCount = FRAME_SAMPLES;
        this.framePoints = new Float32Array(frameCount * 3);
        this.frameTangents = new Float32Array(frameCount * 2);
        this.frameCurvature = new Float32Array(frameCount);
        this.frameWidthScale = new Float32Array(frameCount);
        this.kerbLeft = new Uint8Array(frameCount);
        this.kerbRight = new Uint8Array(frameCount);
        this.buildFrames();
        this.buildKerbZones();

        const visualSamples = Math.max(
            64,
            visualData.samples ?? DEFAULT_SAMPLES
        );
        const colliderSamples = Math.max(
            64,
            colliderData.samples ?? DEFAULT_SAMPLES
        );
        this.visualMesh = this.createRoadMesh(visualSamples);
        this.vergeMesh = this.createVergeMesh(visualSamples);
        this.edgeMarkings = this.createEdgeLineMesh(visualSamples);
        this.kerbMesh = this.createKerbMesh();
        this.colliderMesh = this.createColliderMesh(colliderSamples);

        this.root.add(this.visualMesh);
        this.root.add(this.vergeMesh);
        this.root.add(this.edgeMarkings);
        if (this.kerbMesh) this.root.add(this.kerbMesh);
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

    createCurveFromAsset(data: TrackAssetData) {
        const offset = this.getOffset(data.offset);
        const points = data.points.map(
            (point) =>
                new THREE.Vector3(
                    point[0] + offset.x,
                    point[1] + offset.y,
                    point[2] + offset.z
                )
        );
        const center = new THREE.Vector3();
        points.forEach((point) => center.add(point));
        center.multiplyScalar(1 / Math.max(1, points.length));

        points.forEach((point) => {
            point.x = center.x + (point.x - center.x) * TRACK_LENGTH_SCALE;
            point.y = center.y + (point.y - center.y) * TRACK_ELEVATION_SCALE;
            point.z = center.z + (point.z - center.z) * TRACK_LENGTH_SCALE;
        });
        this.flattenStartPadElevation(points);

        return new THREE.CatmullRomCurve3(
            points,
            data.closed ?? true,
            'centripetal',
            0.5
        );
    }

    flattenStartPadElevation(points: THREE.Vector3[]) {
        if (points.length < 4) return;

        const startSampleCount = Math.min(10, points.length);
        const startY =
            points
                .slice(0, startSampleCount)
                .reduce((sum, point) => sum + point.y, 0) / startSampleCount;
        const lastIndex = Math.max(1, points.length - 1);

        points.forEach((point, index) => {
            const t = index / lastIndex;
            const wrappedDistance = Math.min(t, 1 - t);
            const normalized = THREE.MathUtils.clamp(
                1 - wrappedDistance / START_PAD_FLAT_BLEND,
                0,
                1
            );
            const strength = normalized * normalized * (3 - 2 * normalized);
            point.y = THREE.MathUtils.lerp(point.y, startY, strength);
        });
    }

    getRoadHalfWidth(t: number) {
        return ROAD_WIDTH * 0.5 * this.getStartPadWidthScale(t);
    }

    getVergeHalfWidth(t: number) {
        return this.getRoadHalfWidth(t) + VERGE_WIDTH;
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
            this.frameWidthScale[i] = this.getStartPadWidthScale(t);
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
        // the start straight stays clean
        const padSamples = Math.round(count * START_PAD_BLEND);
        for (let k = -padSamples; k <= padSamples; k++) {
            const index = ((k % count) + count) % count;
            this.kerbLeft[index] = 0;
            this.kerbRight[index] = 0;
        }
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
        const widthScale = this.frameWidthScale[best];
        const roadHalf = ROAD_WIDTH * 0.5 * widthScale;

        target.index = best;
        target.distance = (best / count) * this.length + along;
        target.lateral = (x - px) * leftX + (z - pz) * leftZ;
        target.roadHalfWidth = roadHalf;
        target.barrierOffset = roadHalf + VERGE_WIDTH - BARRIER_INSET;
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
            roadHalfWidth: ROAD_WIDTH * 0.5,
            barrierOffset: ROAD_WIDTH * 0.5 + VERGE_WIDTH - BARRIER_INSET,
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
        if (side <= frame.roadHalfWidth + VERGE_WIDTH) return 'grass';
        return 'off';
    }

    getSampleCount() {
        return FRAME_SAMPLES;
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
        const bankAngle =
            Math.sin(t * Math.PI * 16) *
            0.045 *
            this.getBankStrengthAtDistance(t);
        normal.set(0, 1, 0).applyAxisAngle(tangent, bankAngle).normalize();
        side.crossVectors(normal, tangent).normalize();
    }

    // a flat strip between two lateral offsets (positive is left), lifted
    // along the road normal. v runs with distance
    createRibbonGeometry(
        curve: THREE.Curve<THREE.Vector3>,
        samples: number,
        edges: RibbonEdges,
        lift: number,
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
                .addScaledVector(normal, lift);
            b.copy(point)
                .addScaledVector(side, outer)
                .addScaledVector(normal, lift);
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
    createRoadMesh(samples: number) {
        const geometry = this.createRibbonGeometry(
            this.visualCurve,
            samples,
            (t) => [this.getRoadHalfWidth(t), -this.getRoadHalfWidth(t)],
            0,
            1 / ASPHALT_REPEAT_METERS
        );
        const { map, roughnessMap } = createAsphaltTextures();
        map.anisotropy = this.getTextureAnisotropy();
        roughnessMap.anisotropy = this.getTextureAnisotropy();
        const material = new THREE.MeshStandardMaterial({
            map,
            roughnessMap,
            roughness: 1,
            metalness: 0,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 2,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'nordschleife-visual';
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        mesh.frustumCulled = false;
        return mesh;
    }

    createVergeMesh(samples: number) {
        const left = this.createRibbonGeometry(
            this.visualCurve,
            samples,
            (t) => [this.getVergeHalfWidth(t), this.getRoadHalfWidth(t)],
            -VERGE_DROP,
            1 / 7
        );
        const right = this.createRibbonGeometry(
            this.visualCurve,
            samples,
            (t) => [-this.getRoadHalfWidth(t), -this.getVergeHalfWidth(t)],
            -VERGE_DROP,
            1 / 7
        );
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
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'nordschleife-verge';
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        return mesh;
    }

    createEdgeLineMesh(samples: number) {
        const inner = (t: number) => this.getRoadHalfWidth(t) - EDGE_LINE_INSET;
        const left = this.createRibbonGeometry(
            this.visualCurve,
            samples,
            (t) => [inner(t), inner(t) - EDGE_LINE_WIDTH],
            MARKING_LIFT,
            0.05
        );
        const right = this.createRibbonGeometry(
            this.visualCurve,
            samples,
            (t) => [-inner(t) + EDGE_LINE_WIDTH, -inner(t)],
            MARKING_LIFT,
            0.05
        );
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

    createColliderMesh(samples: number) {
        const geometry = this.createRibbonGeometry(
            this.colliderCurve,
            samples,
            (t) => [this.getVergeHalfWidth(t), -this.getVergeHalfWidth(t)],
            0,
            DEFAULT_UV_SCALE
        );
        const material = new THREE.MeshBasicMaterial({
            color: 0x00ff88,
            wireframe: true,
            transparent: true,
            opacity: 0.15,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'nordschleife-collider';
        mesh.visible = false;
        mesh.layers.set(COLLIDER_LAYER);
        mesh.frustumCulled = false;
        return mesh;
    }

    getStartPadWidthScale(t: number) {
        const wrappedDistance = Math.min(t, 1 - t);
        const normalized = THREE.MathUtils.clamp(
            1 - wrappedDistance / START_PAD_BLEND,
            0,
            1
        );
        return 1 + START_PAD_EXTRA_WIDTH_SCALE * normalized * normalized;
    }

    getBankStrengthAtDistance(t: number) {
        const wrappedDistance = Math.min(t, 1 - t);
        const normalized = THREE.MathUtils.clamp(
            wrappedDistance / START_PAD_BANK_BLEND,
            0,
            1
        );
        return normalized * normalized * (3 - 2 * normalized);
    }

    getTextureAnisotropy() {
        const renderer = this.application.renderer?.instance;
        if (!renderer?.capabilities?.getMaxAnisotropy) {
            return 1;
        }
        return Math.min(8, renderer.capabilities.getMaxAnisotropy());
    }

    getOffset(offset?: number[]) {
        return new THREE.Vector3(
            offset?.[0] || 0,
            offset?.[1] || 0,
            offset?.[2] || 0
        );
    }

    warnIfDuplicateTrackRoots() {
        let rootCount = 0;
        this.scene.traverse((child) => {
            if (child.userData?.[ROOT_MARKER]) {
                rootCount++;
            }
        });

        if (rootCount !== 1) {
            console.warn(
                `[Racing] Expected exactly one Nordschleife track root, found ${rootCount}.`
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
            false
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
            false
        )[0];
        if (!hit) return null;
        if (normal) {
            normal
                .copy(hit.face?.normal || this.groundDown)
                .transformDirection(this.colliderMesh.matrixWorld);
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
