import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import type { SVGResultPaths } from 'three/examples/jsm/loaders/SVGLoader.js';
import Application from '../Application';
import UIEventBus from '../UI/EventBus';

const TRACK_SVG_PATH = 'textures/track/nurburgring.svg';
const TRACK_SURFACE_Y = 0;
const TRACK_POSITION = new THREE.Vector3(0, 0, -70000);
const TRACK_SCALE_MULTIPLIER = 1;
const TRACK_NAME = 'Nurburgring Nordschleife';
const TRACK_LENGTH_METERS = 20830;
const TRACK_WIDTH_METERS = 12;
const CURB_WIDTH_METERS = 1.5;
const CENTER_LINE_WIDTH_METERS = 0.35;
const ROAD_SURFACE_OFFSET_METERS = 0.08;
const CURB_SURFACE_OFFSET_METERS = 0.16;
const CENTER_LINE_OFFSET_METERS = 0.12;
const EDGE_LINE_OFFSET_METERS = 0.1;
const EDGE_LINE_OPACITY = 0.85;
const CURB_STRIPE_LENGTH_METERS = 3.2;
const TRACK_SAMPLE_COUNT = 6000;
const ELEVATION_KEYFRAMES = [
    { t: 0, h: 0 },
    { t: 0.08, h: 12 },
    { t: 0.18, h: 6 },
    { t: 0.32, h: 24 },
    { t: 0.46, h: -4 },
    { t: 0.6, h: 18 },
    { t: 0.74, h: 8 },
    { t: 0.88, h: 20 },
    { t: 1, h: 0 },
];
const ELEVATION_SCALE = 1;
const ROAD_BASE_COLOR = new THREE.Color(0x25272a);
const ROAD_VARIATION = 0.18;
const CURB_RED = new THREE.Color(0xc4302b);
const CURB_WHITE = new THREE.Color(0xf1f1f1);
const EDGE_LINE_COLOR = new THREE.Color(0xf3f3f3);
const GROUND_COLOR = new THREE.Color(0x162316);
const GROUND_DROP_METERS = 2.2;
const SKY_TOP_COLOR = new THREE.Color(0x7bb5ff);
const SKY_BOTTOM_COLOR = new THREE.Color(0xe7edf6);
const FOG_COLOR = new THREE.Color(0xa9b8c6);
const FOG_NEAR = 12000;
const FOG_FAR = 150000;
const SUN_COLOR = new THREE.Color(0xfff1d5);
const SUN_INTENSITY = 1.25;
const AMBIENT_INTENSITY = 0.6;
const SKY_RADIUS = 220000;
const TREE_SPACING_STEP = 6;
const TREE_MAX_COUNT = 1200;
const TREE_OFFSET_METERS = 16;
const TREE_JITTER_METERS = 8;
const GUARDRAIL_STEP = 16;
const GUARDRAIL_MAX_COUNT = 420;
const GUARDRAIL_OFFSET_METERS = 1.2;

type RibbonBuild = {
    geometry: THREE.BufferGeometry;
    centerline: THREE.Vector3[];
    tangent: THREE.Vector3;
    size: THREE.Vector2;
    left: THREE.Vector3[];
    right: THREE.Vector3[];
};

type RibbonOptions = {
    metersPerUnit?: number;
    colorFn?: (
        distanceMeters: number,
        point: THREE.Vector2,
        index: number
    ) => THREE.Color;
    elevationFn?: (
        distanceMeters: number,
        point: THREE.Vector2,
        index: number
    ) => number;
};

const noise2D = (x: number, y: number) => {
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return n - Math.floor(n);
};

const getRoadColor = (point: THREE.Vector2) => {
    const noise = noise2D(point.x * 0.12, point.y * 0.12);
    const shade = 1 - ROAD_VARIATION * 0.5 + noise * ROAD_VARIATION;
    return ROAD_BASE_COLOR.clone().multiplyScalar(shade);
};

const getCurbColor = (distanceMeters: number) => {
    const stripeIndex = Math.floor(
        distanceMeters / CURB_STRIPE_LENGTH_METERS
    );
    return stripeIndex % 2 === 0 ? CURB_RED.clone() : CURB_WHITE.clone();
};

const smoothstep = (edge0: number, edge1: number, x: number) => {
    const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
};

const getElevationMeters = (t: number) => {
    if (!ELEVATION_KEYFRAMES.length) return 0;
    const clamped = THREE.MathUtils.clamp(t, 0, 1);
    let index = 0;
    for (let i = 0; i < ELEVATION_KEYFRAMES.length - 1; i++) {
        if (clamped >= ELEVATION_KEYFRAMES[i].t) {
            index = i;
        }
    }
    const a = ELEVATION_KEYFRAMES[index];
    const b =
        ELEVATION_KEYFRAMES[Math.min(index + 1, ELEVATION_KEYFRAMES.length - 1)];
    if (a === b) return a.h * ELEVATION_SCALE;
    const localT = smoothstep(a.t, b.t, clamped);
    return THREE.MathUtils.lerp(a.h, b.h, localT) * ELEVATION_SCALE;
};

const random01 = (seed: number) => {
    const n = Math.sin(seed) * 43758.5453;
    return n - Math.floor(n);
};

export default class RaceTrack {
    application: Application;
    scene: THREE.Scene;
    group: THREE.Group;
    ready: boolean;
    active: boolean;
    startPosition: THREE.Vector3;
    startDirection: THREE.Vector3;
    groundY: number;
    name: string;
    unitsPerMeter: number;
    centerlineWorld: THREE.Vector3[];
    roadSurfaceOffsetWorld: number;
    sky: THREE.Mesh | null;
    sunLight: THREE.DirectionalLight | null;
    ambientLight: THREE.HemisphereLight | null;
    trackFog: THREE.FogBase | null;
    previousFog: THREE.FogBase | null | undefined;

    constructor(unitsPerMeter: number = 25) {
        this.application = new Application();
        this.scene = this.application.scene;
        this.group = new THREE.Group();
        this.ready = false;
        this.active = false;
        this.startPosition = new THREE.Vector3();
        this.startDirection = new THREE.Vector3(0, 0, 1);
        this.groundY = TRACK_POSITION.y + TRACK_SURFACE_Y;
        this.name = TRACK_NAME;
        this.unitsPerMeter = unitsPerMeter;
        this.centerlineWorld = [];
        this.roadSurfaceOffsetWorld = 0;
        this.sky = null;
        this.sunLight = null;
        this.ambientLight = null;
        this.trackFog = null;
        this.previousFog = undefined;

        this.loadTrack();
    }

    async loadTrack() {
        try {
            const response = await fetch(TRACK_SVG_PATH);
            if (!response.ok) {
                throw new Error(`Track SVG failed: ${response.status}`);
            }

            const svgText = await response.text();
            const loader = new SVGLoader();
            const svgData = loader.parse(svgText);

            if (!svgData.paths.length) {
                throw new Error('Track SVG contained no paths.');
            }

            const primaryPath = this.getPrimaryPath(svgData.paths);
            if (!primaryPath) {
                throw new Error('Track SVG contained no usable path.');
            }

            const points = this.getSpacedPoints(
                primaryPath,
                TRACK_SAMPLE_COUNT
            );
            if (points.length < 4) {
                throw new Error('Track path sampling failed.');
            }

            const trackLength = this.getPathLength(points);
            const metersPerSvgUnit = TRACK_LENGTH_METERS / trackLength;
            const scale =
                this.unitsPerMeter * metersPerSvgUnit * TRACK_SCALE_MULTIPLIER;
            const trackWidthSvg = TRACK_WIDTH_METERS / metersPerSvgUnit;
            const curbWidthSvg = CURB_WIDTH_METERS / metersPerSvgUnit;
            const centerLineWidthSvg =
                CENTER_LINE_WIDTH_METERS / metersPerSvgUnit;
            const roadOffsetSvg =
                ROAD_SURFACE_OFFSET_METERS / metersPerSvgUnit;
            const curbOffsetSvg =
                CURB_SURFACE_OFFSET_METERS / metersPerSvgUnit;
            const centerOffsetSvg =
                CENTER_LINE_OFFSET_METERS / metersPerSvgUnit;
            const edgeOffsetSvg =
                EDGE_LINE_OFFSET_METERS / metersPerSvgUnit;
            const groundOffsetSvg = -GROUND_DROP_METERS / metersPerSvgUnit;

            const elevationFn = (distanceMeters: number) =>
                getElevationMeters(distanceMeters / TRACK_LENGTH_METERS);
            const ribbon = this.buildRibbon(points, trackWidthSvg, {
                metersPerUnit: metersPerSvgUnit,
                colorFn: (_distance, point) => getRoadColor(point),
                elevationFn,
            });
            const curb = this.buildRibbon(
                points,
                trackWidthSvg + curbWidthSvg * 2,
                {
                    metersPerUnit: metersPerSvgUnit,
                    colorFn: (distanceMeters) => getCurbColor(distanceMeters),
                    elevationFn,
                }
            );
            const centerLine = this.buildRibbon(points, centerLineWidthSvg, {
                metersPerUnit: metersPerSvgUnit,
                elevationFn,
            });

            const roadMesh = new THREE.Mesh(
                ribbon.geometry,
                new THREE.MeshStandardMaterial({
                    color: 0xffffff,
                    roughness: 0.88,
                    metalness: 0.05,
                    vertexColors: true,
                    side: THREE.DoubleSide,
                    polygonOffset: true,
                    polygonOffsetFactor: -2,
                    polygonOffsetUnits: -2,
                })
            );
            roadMesh.position.y = TRACK_SURFACE_Y + roadOffsetSvg;
            roadMesh.receiveShadow = true;

            const curbMesh = new THREE.Mesh(
                curb.geometry,
                new THREE.MeshStandardMaterial({
                    color: 0xffffff,
                    roughness: 0.75,
                    metalness: 0.05,
                    vertexColors: true,
                    side: THREE.DoubleSide,
                    polygonOffset: true,
                    polygonOffsetFactor: -1,
                    polygonOffsetUnits: -1,
                })
            );
            curbMesh.position.y = TRACK_SURFACE_Y + curbOffsetSvg;
            curbMesh.receiveShadow = true;

            const centerMesh = new THREE.Mesh(
                centerLine.geometry,
                new THREE.MeshStandardMaterial({
                    color: 0xf2f2f2,
                    roughness: 0.55,
                    metalness: 0,
                    side: THREE.DoubleSide,
                })
            );
            centerMesh.position.y = TRACK_SURFACE_Y + centerOffsetSvg;
            centerMesh.receiveShadow = true;

            this.group.add(curbMesh);
            this.group.add(roadMesh);
            this.group.add(centerMesh);

            const edgeMaterial = new THREE.LineBasicMaterial({
                color: EDGE_LINE_COLOR,
                transparent: true,
                opacity: EDGE_LINE_OPACITY,
            });
            const leftEdge = new THREE.LineLoop(
                new THREE.BufferGeometry().setFromPoints(ribbon.left),
                edgeMaterial
            );
            const rightEdge = new THREE.LineLoop(
                new THREE.BufferGeometry().setFromPoints(ribbon.right),
                edgeMaterial
            );
            leftEdge.position.y = TRACK_SURFACE_Y + edgeOffsetSvg;
            rightEdge.position.y = TRACK_SURFACE_Y + edgeOffsetSvg;
            leftEdge.renderOrder = 2;
            rightEdge.renderOrder = 2;
            this.group.add(leftEdge);
            this.group.add(rightEdge);

            const groundSize = Math.max(ribbon.size.x, ribbon.size.y) * 1.8;
            const ground = new THREE.Mesh(
                new THREE.PlaneGeometry(groundSize, groundSize),
                new THREE.MeshStandardMaterial({
                    color: GROUND_COLOR,
                    roughness: 1,
                    metalness: 0,
                })
            );
            ground.rotation.x = -Math.PI / 2;
            ground.position.y = TRACK_SURFACE_Y + groundOffsetSvg;
            ground.receiveShadow = true;
            this.group.add(ground);

            this.createTrackDetails(ribbon, metersPerSvgUnit, roadOffsetSvg);

            this.group.scale.setScalar(scale);
            this.group.position.copy(TRACK_POSITION);
            this.scene.add(this.group);
            this.group.updateMatrixWorld(true);

            this.centerlineWorld = ribbon.centerline.map((point) =>
                point.clone().multiplyScalar(scale).add(this.group.position)
            );
            this.roadSurfaceOffsetWorld =
                (TRACK_SURFACE_Y + roadOffsetSvg) * scale;

            const startLocal = ribbon.centerline[0].clone();
            const startWorld = startLocal
                .clone()
                .multiplyScalar(scale)
                .add(this.group.position);
            startWorld.y += this.roadSurfaceOffsetWorld;
            this.startPosition.copy(startWorld);

            const direction = this.getStartDirectionWorld();
            direction.y = 0;
            if (direction.lengthSq() > 0) {
                direction.normalize();
            }
            this.startDirection.copy(direction);

            this.groundY = this.startPosition.y;
            this.group.visible = this.active;
            this.setupEnvironment();
            this.ready = true;

            UIEventBus.dispatch('trackReady', { name: this.name });
        } catch (error) {
            this.createFallbackTrack();
        }
    }

    getPrimaryPath(paths: SVGResultPaths[]) {
        let best: SVGResultPaths | null = null;
        let bestLength = 0;
        for (const path of paths) {
            const points = this.getSpacedPoints(path, 1200);
            if (points.length < 2) continue;
            const length = this.getPathLength(points);
            if (length > bestLength) {
                bestLength = length;
                best = path;
            }
        }
        return best;
    }

    getSpacedPoints(path: SVGResultPaths, count: number) {
        const rawPath = path as any;
        let points: THREE.Vector2[] = [];
        if (rawPath?.getSpacedPoints) {
            points = rawPath.getSpacedPoints(count);
        } else if (rawPath?.subPaths?.length && rawPath.subPaths[0]?.getSpacedPoints) {
            points = rawPath.subPaths[0].getSpacedPoints(count);
        }
        const filtered: THREE.Vector2[] = [];
        const epsilon = 0.0001;
        points.forEach((point: THREE.Vector2) => {
            const prev = filtered[filtered.length - 1];
            if (!prev || prev.distanceTo(point) > epsilon) {
                filtered.push(point);
            }
        });
        if (filtered.length > 2) {
            const first = filtered[0];
            const last = filtered[filtered.length - 1];
            if (first.distanceTo(last) < epsilon) {
                filtered.pop();
            }
        }
        return filtered;
    }

    getPathLength(points: THREE.Vector2[]) {
        let length = 0;
        for (let i = 0; i < points.length; i++) {
            const next = points[(i + 1) % points.length];
            length += points[i].distanceTo(next);
        }
        return length;
    }

    buildRibbon(
        points: THREE.Vector2[],
        width: number,
        options: RibbonOptions = {}
    ): RibbonBuild {
        const halfWidth = width / 2;
        const center = new THREE.Vector2();
        points.forEach((point) => center.add(point));
        center.divideScalar(points.length);

        const sizeBox = new THREE.Box2();
        points.forEach((point) => sizeBox.expandByPoint(point));
        const size = sizeBox.getSize(new THREE.Vector2());

        const left: THREE.Vector2[] = [];
        const right: THREE.Vector2[] = [];
        const segmentDistances: number[] = [];
        const heightSvgByIndex: number[] = [];
        let distanceAcc = 0;
        for (let i = 0; i < points.length; i++) {
            segmentDistances.push(distanceAcc);
            const next = points[(i + 1) % points.length];
            distanceAcc += points[i].distanceTo(next);
        }
        if (options.elevationFn) {
            for (let i = 0; i < points.length; i++) {
                const distanceMeters =
                    segmentDistances[i] * (options.metersPerUnit || 1);
                const heightMeters = options.elevationFn(
                    distanceMeters,
                    points[i],
                    i
                );
                const heightSvg =
                    heightMeters / (options.metersPerUnit || 1);
                heightSvgByIndex.push(heightSvg);
            }
        } else {
            for (let i = 0; i < points.length; i++) {
                heightSvgByIndex.push(0);
            }
        }
        for (let i = 0; i < points.length; i++) {
            const prev = points[(i - 1 + points.length) % points.length];
            const curr = points[i];
            const next = points[(i + 1) % points.length];
            const tangent = next.clone().sub(prev);
            if (tangent.lengthSq() === 0) {
                tangent.copy(next.clone().sub(curr));
            }
            tangent.normalize();
            const normal = new THREE.Vector2(-tangent.y, tangent.x);
            left.push(curr.clone().addScaledVector(normal, halfWidth));
            right.push(curr.clone().addScaledVector(normal, -halfWidth));
        }

        const positions: number[] = [];
        const colors: number[] = [];
        const centerline: THREE.Vector3[] = [];
        const leftWorld: THREE.Vector3[] = [];
        const rightWorld: THREE.Vector3[] = [];

        const toWorld = (point: THREE.Vector2, index: number) =>
            new THREE.Vector3(
                point.x - center.x,
                heightSvgByIndex[index] || 0,
                -(point.y - center.y)
            );

        for (let i = 0; i < points.length; i++) {
            centerline.push(toWorld(points[i], i));
            leftWorld.push(toWorld(left[i], i));
            rightWorld.push(toWorld(right[i], i));
        }

        for (let i = 0; i < left.length; i++) {
            const next = (i + 1) % left.length;
            const l0 = toWorld(left[i], i);
            const r0 = toWorld(right[i], i);
            const l1 = toWorld(left[next], next);
            const r1 = toWorld(right[next], next);

            positions.push(
                l0.x,
                l0.y,
                l0.z,
                r0.x,
                r0.y,
                r0.z,
                l1.x,
                l1.y,
                l1.z,
                r0.x,
                r0.y,
                r0.z,
                r1.x,
                r1.y,
                r1.z,
                l1.x,
                l1.y,
                l1.z
            );

            if (options.colorFn) {
                const segmentLength = points[i].distanceTo(points[next]);
                const distanceMeters =
                    (segmentDistances[i] + segmentLength * 0.5) *
                    (options.metersPerUnit || 1);
                const color = options.colorFn(distanceMeters, points[i], i);
                for (let v = 0; v < 6; v++) {
                    colors.push(color.r, color.g, color.b);
                }
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
            'position',
            new THREE.BufferAttribute(new Float32Array(positions), 3)
        );
        if (colors.length) {
            geometry.setAttribute(
                'color',
                new THREE.BufferAttribute(new Float32Array(colors), 3)
            );
        }
        geometry.computeVertexNormals();

        const tangent = centerline[1]
            .clone()
            .sub(centerline[0])
            .normalize();

        return {
            geometry,
            centerline,
            tangent,
            size,
            left: leftWorld,
            right: rightWorld,
        };
    }

    createTrackDetails(
        ribbon: RibbonBuild,
        metersPerSvgUnit: number,
        roadOffsetSvg: number
    ) {
        this.createTreeLines(ribbon, metersPerSvgUnit, roadOffsetSvg);
        this.createGuardrails(ribbon, metersPerSvgUnit, roadOffsetSvg);
    }

    createTreeLines(
        ribbon: RibbonBuild,
        metersPerSvgUnit: number,
        roadOffsetSvg: number
    ) {
        const centerline = ribbon.centerline;
        const left = ribbon.left;
        if (!centerline.length) return;

        const offsetSvg =
            (TRACK_WIDTH_METERS * 0.5 + TREE_OFFSET_METERS) / metersPerSvgUnit;
        const jitterSvg = TREE_JITTER_METERS / metersPerSvgUnit;
        const trunkHeight = 6 / metersPerSvgUnit;
        const trunkRadius = 0.25 / metersPerSvgUnit;
        const canopyHeight = 5 / metersPerSvgUnit;
        const canopyRadius = 1.8 / metersPerSvgUnit;
        const groundOffset = -roadOffsetSvg * 0.7;

        const stepCount = Math.floor(centerline.length / TREE_SPACING_STEP);
        const maxInstances = Math.min(stepCount * 2, TREE_MAX_COUNT);
        if (maxInstances <= 0) return;

        const trunkGeometry = new THREE.CylinderGeometry(
            trunkRadius,
            trunkRadius * 0.9,
            trunkHeight,
            6
        );
        const canopyGeometry = new THREE.ConeGeometry(
            canopyRadius,
            canopyHeight,
            8
        );
        const trunkMaterial = new THREE.MeshStandardMaterial({
            color: 0x3a2b1f,
            roughness: 1,
            metalness: 0,
        });
        const canopyMaterial = new THREE.MeshStandardMaterial({
            color: 0x1d3a1d,
            roughness: 1,
            metalness: 0,
        });

        const trunkMesh = new THREE.InstancedMesh(
            trunkGeometry,
            trunkMaterial,
            maxInstances
        );
        const canopyMesh = new THREE.InstancedMesh(
            canopyGeometry,
            canopyMaterial,
            maxInstances
        );
        trunkMesh.castShadow = true;
        trunkMesh.receiveShadow = true;
        canopyMesh.castShadow = true;
        canopyMesh.receiveShadow = true;

        const dummy = new THREE.Object3D();
        let instanceIndex = 0;

        for (let i = 0; i < centerline.length; i += TREE_SPACING_STEP) {
            const nextIndex = (i + 1) % centerline.length;
            const tangent = centerline[nextIndex]
                .clone()
                .sub(centerline[i]);
            tangent.y = 0;
            if (tangent.lengthSq() === 0) continue;
            tangent.normalize();
            const normal = left[i].clone().sub(centerline[i]).normalize();

            for (const side of [-1, 1]) {
                if (instanceIndex >= maxInstances) break;
                const seed = i * 3.77 + side * 9.13;
                if (random01(seed) < 0.35) continue;

                const jitter = (random01(seed + 1.2) - 0.5) * jitterSvg;
                const along = (random01(seed + 3.3) - 0.5) * jitterSvg * 0.6;
                const scale = 0.8 + random01(seed + 4.8) * 0.7;

                const base = centerline[i]
                    .clone()
                    .addScaledVector(normal, (offsetSvg + jitter) * side)
                    .addScaledVector(tangent, along);
                base.y += groundOffset;

                const rotation = random01(seed + 6.1) * Math.PI * 2;

                dummy.position.set(
                    base.x,
                    base.y + (trunkHeight * scale) / 2,
                    base.z
                );
                dummy.rotation.set(0, rotation, 0);
                dummy.scale.set(scale, scale, scale);
                dummy.updateMatrix();
                trunkMesh.setMatrixAt(instanceIndex, dummy.matrix);

                dummy.position.set(
                    base.x,
                    base.y + trunkHeight * scale + (canopyHeight * scale) / 2,
                    base.z
                );
                dummy.rotation.set(0, rotation, 0);
                dummy.scale.set(scale, scale, scale);
                dummy.updateMatrix();
                canopyMesh.setMatrixAt(instanceIndex, dummy.matrix);

                instanceIndex += 1;
            }
            if (instanceIndex >= maxInstances) break;
        }

        trunkMesh.count = instanceIndex;
        canopyMesh.count = instanceIndex;
        trunkMesh.instanceMatrix.needsUpdate = true;
        canopyMesh.instanceMatrix.needsUpdate = true;
        this.group.add(trunkMesh);
        this.group.add(canopyMesh);
    }

    createGuardrails(
        ribbon: RibbonBuild,
        metersPerSvgUnit: number,
        roadOffsetSvg: number
    ) {
        const centerline = ribbon.centerline;
        const left = ribbon.left;
        if (!centerline.length) return;

        const offsetSvg =
            (TRACK_WIDTH_METERS * 0.5 + GUARDRAIL_OFFSET_METERS) /
            metersPerSvgUnit;
        const railLength = 6 / metersPerSvgUnit;
        const railHeight = 0.7 / metersPerSvgUnit;
        const railDepth = 0.12 / metersPerSvgUnit;
        const railY = roadOffsetSvg + railHeight * 0.55;

        const maxInstances = Math.min(
            Math.floor(centerline.length / GUARDRAIL_STEP),
            GUARDRAIL_MAX_COUNT
        );
        if (maxInstances <= 0) return;

        const geometry = new THREE.BoxGeometry(
            railLength,
            railHeight,
            railDepth
        );
        const material = new THREE.MeshStandardMaterial({
            color: 0xb3b6bd,
            roughness: 0.4,
            metalness: 0.2,
        });
        const mesh = new THREE.InstancedMesh(
            geometry,
            material,
            maxInstances
        );
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        const dummy = new THREE.Object3D();
        let instanceIndex = 0;

        for (let i = 0; i < centerline.length; i += GUARDRAIL_STEP) {
            if (instanceIndex >= maxInstances) break;
            const seed = i * 5.13;
            if (random01(seed) < 0.55) continue;

            const nextIndex = (i + 1) % centerline.length;
            const tangent = centerline[nextIndex]
                .clone()
                .sub(centerline[i]);
            tangent.y = 0;
            if (tangent.lengthSq() === 0) continue;
            tangent.normalize();

            const normal = left[i].clone().sub(centerline[i]).normalize();
            const side = random01(seed + 1.9) > 0.5 ? 1 : -1;

            const base = centerline[i]
                .clone()
                .addScaledVector(normal, offsetSvg * side);
            base.y += railY;

            dummy.position.copy(base);
            dummy.quaternion.setFromUnitVectors(
                new THREE.Vector3(1, 0, 0),
                tangent
            );
            dummy.updateMatrix();
            mesh.setMatrixAt(instanceIndex, dummy.matrix);
            instanceIndex += 1;
        }

        mesh.count = instanceIndex;
        mesh.instanceMatrix.needsUpdate = true;
        this.group.add(mesh);
    }

    setupEnvironment() {
        if (this.sky || this.sunLight || this.ambientLight) {
            this.applyEnvironmentVisibility();
            return;
        }

        const skyGeometry = new THREE.SphereGeometry(SKY_RADIUS, 32, 16);
        const skyColors: number[] = [];
        const skyPositions = skyGeometry.getAttribute('position');
        for (let i = 0; i < skyPositions.count; i++) {
            const y = skyPositions.getY(i);
            const t = THREE.MathUtils.clamp((y / SKY_RADIUS + 1) * 0.5, 0, 1);
            const color = SKY_BOTTOM_COLOR.clone().lerp(SKY_TOP_COLOR, t);
            skyColors.push(color.r, color.g, color.b);
        }
        skyGeometry.setAttribute(
            'color',
            new THREE.Float32BufferAttribute(skyColors, 3)
        );
        const skyMaterial = new THREE.MeshBasicMaterial({
            side: THREE.BackSide,
            vertexColors: true,
            depthWrite: false,
        });
        this.sky = new THREE.Mesh(skyGeometry, skyMaterial);
        this.sky.position.copy(TRACK_POSITION);
        this.sky.frustumCulled = false;
        this.scene.add(this.sky);

        this.sunLight = new THREE.DirectionalLight(
            SUN_COLOR,
            SUN_INTENSITY
        );
        this.sunLight.position.set(
            TRACK_POSITION.x + 50000,
            55000,
            TRACK_POSITION.z - 20000
        );
        this.sunLight.target.position.set(
            TRACK_POSITION.x,
            0,
            TRACK_POSITION.z
        );
        this.scene.add(this.sunLight);
        this.scene.add(this.sunLight.target);

        this.ambientLight = new THREE.HemisphereLight(
            SKY_TOP_COLOR,
            GROUND_COLOR,
            AMBIENT_INTENSITY
        );
        this.scene.add(this.ambientLight);

        this.trackFog = new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);
        this.applyEnvironmentVisibility();
    }

    applyEnvironmentVisibility() {
        if (this.sky) this.sky.visible = this.active;
        if (this.sunLight) this.sunLight.visible = this.active;
        if (this.ambientLight) this.ambientLight.visible = this.active;
        if (this.active && this.trackFog) {
            if (this.previousFog === undefined) {
                this.previousFog = this.scene.fog || null;
            }
            this.scene.fog = this.trackFog;
        } else if (this.scene.fog === this.trackFog) {
            this.scene.fog = this.previousFog || null;
        }
    }

    getStartDirectionWorld() {
        if (this.centerlineWorld.length < 2) {
            return new THREE.Vector3(0, 0, 1);
        }
        return this.centerlineWorld[1].clone().sub(this.centerlineWorld[0]);
    }

    getRoadHeightAtPosition(position: THREE.Vector3) {
        if (!this.centerlineWorld.length) return this.groundY;
        let closestY = this.groundY;
        let minDist = Infinity;
        for (const point of this.centerlineWorld) {
            const dx = point.x - position.x;
            const dz = point.z - position.z;
            const dist = dx * dx + dz * dz;
            if (dist < minDist) {
                minDist = dist;
                closestY = point.y;
            }
        }
        return closestY + this.roadSurfaceOffsetWorld;
    }

    setActive(active: boolean) {
        this.active = active;
        if (this.group) {
            this.group.visible = active;
        }
        this.applyEnvironmentVisibility();
    }

    update() {
        if (!this.active || !this.sky) return;
        const cameraPos = this.application.camera.instance.position;
        this.sky.position.set(cameraPos.x, cameraPos.y, cameraPos.z);
    }

    createFallbackTrack() {
        const trackMaterial = new THREE.MeshStandardMaterial({
            color: ROAD_BASE_COLOR,
            roughness: 0.9,
            metalness: 0.05,
        });
        const roadOffsetWorld =
            ROAD_SURFACE_OFFSET_METERS * this.unitsPerMeter;
        const groundDropWorld = GROUND_DROP_METERS * this.unitsPerMeter;

        const ring = new THREE.RingGeometry(8000, 9500, 64);
        ring.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(ring, trackMaterial);
        mesh.receiveShadow = true;
        this.group.add(mesh);

        const ground = new THREE.Mesh(
            new THREE.PlaneGeometry(26000, 26000),
            new THREE.MeshStandardMaterial({
                color: GROUND_COLOR,
                roughness: 1,
                metalness: 0,
            })
        );
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = TRACK_SURFACE_Y - groundDropWorld;
        this.group.add(ground);

        this.group.position.copy(TRACK_POSITION);
        this.scene.add(this.group);
        this.group.updateMatrixWorld(true);

        this.startPosition.set(
            TRACK_POSITION.x + 8800,
            TRACK_POSITION.y,
            TRACK_POSITION.z
        );
        this.startPosition.y += TRACK_SURFACE_Y + roadOffsetWorld;
        this.startDirection.set(0, 0, 1);
        this.centerlineWorld = [this.startPosition.clone()];
        this.roadSurfaceOffsetWorld = 0;
        this.groundY = this.startPosition.y;
        this.group.visible = this.active;
        this.setupEnvironment();
        this.ready = true;

        UIEventBus.dispatch('trackReady', { name: this.name });
    }

    getStartTransform() {
        return {
            position: this.startPosition.clone(),
            direction: this.startDirection.clone(),
        };
    }

    getGroundY() {
        return this.groundY;
    }
}
