import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import type { SVGResultPaths } from 'three/examples/jsm/loaders/SVGLoader.js';
import Application from '../Application';
import UIEventBus from '../UI/EventBus';

const TRACK_SVG_PATH = 'textures/track/nurburgring.svg';
const TRACK_SURFACE_Y = 0;
const TRACK_POSITION = new THREE.Vector3(0, -1200, -70000);
const TRACK_NAME = 'Nurburgring Nordschleife';
const TRACK_LENGTH_METERS = 20830;
const TRACK_WIDTH_METERS = 12;
const CURB_WIDTH_METERS = 1.5;
const CENTER_LINE_WIDTH_METERS = 0.35;
const ROAD_SURFACE_OFFSET = 4;

type RibbonBuild = {
    geometry: THREE.BufferGeometry;
    centerline: THREE.Vector3[];
    tangent: THREE.Vector3;
    size: THREE.Vector2;
};

export default class RaceTrack {
    application: Application;
    scene: THREE.Scene;
    group: THREE.Group;
    ready: boolean;
    startPosition: THREE.Vector3;
    startDirection: THREE.Vector3;
    groundY: number;
    name: string;
    unitsPerMeter: number;

    constructor(unitsPerMeter: number = 25) {
        this.application = new Application();
        this.scene = this.application.scene;
        this.group = new THREE.Group();
        this.ready = false;
        this.startPosition = new THREE.Vector3();
        this.startDirection = new THREE.Vector3(0, 0, 1);
        this.groundY = TRACK_POSITION.y + TRACK_SURFACE_Y;
        this.name = TRACK_NAME;
        this.unitsPerMeter = unitsPerMeter;

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

            const points = this.getSpacedPoints(primaryPath, 1800);
            if (points.length < 4) {
                throw new Error('Track path sampling failed.');
            }

            const trackLength = this.getPathLength(points);
            const metersPerSvgUnit = TRACK_LENGTH_METERS / trackLength;
            const scale = this.unitsPerMeter * metersPerSvgUnit;
            const trackWidthSvg = TRACK_WIDTH_METERS / metersPerSvgUnit;
            const curbWidthSvg = CURB_WIDTH_METERS / metersPerSvgUnit;
            const centerLineWidthSvg =
                CENTER_LINE_WIDTH_METERS / metersPerSvgUnit;

            const ribbon = this.buildRibbon(points, trackWidthSvg);
            const curb = this.buildRibbon(
                points,
                trackWidthSvg + curbWidthSvg * 2
            );
            const centerLine = this.buildRibbon(points, centerLineWidthSvg);

            const roadMesh = new THREE.Mesh(
                ribbon.geometry,
                new THREE.MeshStandardMaterial({
                    color: 0x222222,
                    roughness: 0.9,
                    metalness: 0.05,
                    polygonOffset: true,
                    polygonOffsetFactor: -2,
                    polygonOffsetUnits: -2,
                })
            );
            roadMesh.position.y = TRACK_SURFACE_Y + ROAD_SURFACE_OFFSET;
            roadMesh.receiveShadow = true;

            const curbMesh = new THREE.Mesh(
                curb.geometry,
                new THREE.MeshStandardMaterial({
                    color: 0x7a1f1f,
                    roughness: 0.85,
                    metalness: 0.05,
                    polygonOffset: true,
                    polygonOffsetFactor: -1,
                    polygonOffsetUnits: -1,
                })
            );
            curbMesh.position.y = TRACK_SURFACE_Y + 1;
            curbMesh.receiveShadow = true;

            const centerMesh = new THREE.Mesh(
                centerLine.geometry,
                new THREE.MeshStandardMaterial({
                    color: 0xdadada,
                    roughness: 0.6,
                    metalness: 0,
                })
            );
            centerMesh.position.y = TRACK_SURFACE_Y + 6;
            centerMesh.receiveShadow = true;

            this.group.add(curbMesh);
            this.group.add(roadMesh);
            this.group.add(centerMesh);

            const groundSize =
                Math.max(ribbon.size.x, ribbon.size.y) * scale * 1.8;
            const ground = new THREE.Mesh(
                new THREE.PlaneGeometry(groundSize, groundSize),
                new THREE.MeshStandardMaterial({
                    color: 0x1b2a1b,
                    roughness: 1,
                    metalness: 0,
                })
            );
            ground.rotation.x = -Math.PI / 2;
            ground.position.y = TRACK_SURFACE_Y - 40;
            ground.receiveShadow = true;
            this.group.add(ground);

            this.group.scale.setScalar(scale);
            this.group.position.copy(TRACK_POSITION);
            this.scene.add(this.group);
            this.group.updateMatrixWorld(true);

            const startLocal = ribbon.centerline[0].clone();
            const startWorld = startLocal
                .clone()
                .multiplyScalar(scale)
                .add(this.group.position);
            this.startPosition.copy(startWorld);

            const direction = ribbon.tangent.clone();
            direction.y = 0;
            if (direction.lengthSq() > 0) {
                direction.normalize();
            }
            this.startDirection.copy(direction);

            this.groundY =
                this.group.position.y + TRACK_SURFACE_Y + ROAD_SURFACE_OFFSET;
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

    buildRibbon(points: THREE.Vector2[], width: number): RibbonBuild {
        const halfWidth = width / 2;
        const center = new THREE.Vector2();
        points.forEach((point) => center.add(point));
        center.divideScalar(points.length);

        const sizeBox = new THREE.Box2();
        points.forEach((point) => sizeBox.expandByPoint(point));
        const size = sizeBox.getSize(new THREE.Vector2());

        const left: THREE.Vector2[] = [];
        const right: THREE.Vector2[] = [];
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
        const centerline: THREE.Vector3[] = [];

        const toWorld = (point: THREE.Vector2) =>
            new THREE.Vector3(
                point.x - center.x,
                0,
                -(point.y - center.y)
            );

        for (let i = 0; i < points.length; i++) {
            centerline.push(toWorld(points[i]));
        }

        for (let i = 0; i < left.length; i++) {
            const next = (i + 1) % left.length;
            const l0 = toWorld(left[i]);
            const r0 = toWorld(right[i]);
            const l1 = toWorld(left[next]);
            const r1 = toWorld(right[next]);

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
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
            'position',
            new THREE.BufferAttribute(new Float32Array(positions), 3)
        );
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
        };
    }

    createFallbackTrack() {
        const trackMaterial = new THREE.MeshStandardMaterial({
            color: 0x252525,
            roughness: 0.9,
            metalness: 0.05,
        });

        const ring = new THREE.RingGeometry(8000, 9500, 64);
        ring.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(ring, trackMaterial);
        mesh.receiveShadow = true;
        this.group.add(mesh);

        const ground = new THREE.Mesh(
            new THREE.PlaneGeometry(26000, 26000),
            new THREE.MeshStandardMaterial({
                color: 0x1a2a1a,
                roughness: 1,
                metalness: 0,
            })
        );
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = TRACK_SURFACE_Y - 20;
        this.group.add(ground);

        this.group.position.copy(TRACK_POSITION);
        this.scene.add(this.group);
        this.group.updateMatrixWorld(true);

        this.startPosition.set(
            TRACK_POSITION.x + 8800,
            TRACK_POSITION.y,
            TRACK_POSITION.z
        );
        this.startDirection.set(0, 0, 1);
        this.groundY =
            this.group.position.y + TRACK_SURFACE_Y + ROAD_SURFACE_OFFSET;
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
