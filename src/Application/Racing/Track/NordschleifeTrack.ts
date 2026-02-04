import * as THREE from 'three';
import Application from '../../Application';
import Resources from '../../Utils/Resources';

const COLLIDER_LAYER = 1;
const DEFAULT_UV_SCALE = 0.0015;
const DEFAULT_SAMPLES = 1200;
const DEFAULT_WIDTH = 36;
const ROOT_MARKER = 'nordschleifeTrackRoot';

type TrackAssetData = {
    name?: string;
    closed?: boolean;
    samples?: number;
    width?: number;
    uvScale?: number;
    offset?: number[];
    points: number[][];
};

export default class NordschleifeTrack {
    application: Application;
    resources: Resources;
    scene: THREE.Scene;
    root: THREE.Group;
    visualMesh: THREE.Mesh;
    edgeMarkings: THREE.Group;
    colliderMesh: THREE.Mesh;
    visualCurve: THREE.CatmullRomCurve3;
    colliderCurve: THREE.CatmullRomCurve3;
    colliderRaycaster: THREE.Raycaster;
    debugColliderRayEnabled: boolean;
    debugRayLine: THREE.Line | null;
    debugRayPoints: THREE.Vector3[];
    debugHitMarker: THREE.Mesh | null;

    constructor(parent: THREE.Object3D) {
        this.application = new Application();
        this.resources = this.application.resources;
        this.scene = this.application.scene;
        this.colliderRaycaster = new THREE.Raycaster();
        this.debugRayLine = null;
        this.debugHitMarker = null;
        this.debugRayPoints = [new THREE.Vector3(), new THREE.Vector3()];

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

        this.visualMesh = this.createVisualTrackMesh(visualData, this.visualCurve);
        this.edgeMarkings = this.createEdgeMarkingsMesh(
            visualData,
            this.visualCurve
        );
        this.colliderMesh = this.createColliderMesh(
            colliderData,
            this.colliderCurve
        );

        this.root.add(this.visualMesh);
        this.root.add(this.edgeMarkings);
        this.root.add(this.colliderMesh);
        parent.add(this.root);

        this.warnIfDuplicateTrackRoots();
        this.setupDebugColliderRay();
    }

    getTrackAsset(name: string): TrackAssetData {
        const source = this.resources.items.json[name];
        if (!source || !Array.isArray(source.points) || source.points.length < 4) {
            throw new Error(`[NordschleifeTrack] Missing valid track data: ${name}`);
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

        return new THREE.CatmullRomCurve3(
            points,
            data.closed ?? true,
            'centripetal',
            0.5
        );
    }

    createVisualTrackMesh(data: TrackAssetData, curve: THREE.Curve<THREE.Vector3>) {
        const geometry = this.createTrackSurfaceGeometry(data, curve);
        const material = new THREE.MeshStandardMaterial({
            color: 0x2b2f35,
            roughness: 0.92,
            metalness: 0.08,
            side: THREE.DoubleSide,
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'nordschleife-visual';
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        return mesh;
    }

    createEdgeMarkingsMesh(data: TrackAssetData, curve: THREE.Curve<THREE.Vector3>) {
        const group = new THREE.Group();
        group.name = 'nordschleife-edge-markings';

        const material = new THREE.MeshStandardMaterial({
            color: 0xf1f1f1,
            roughness: 0.55,
            metalness: 0.02,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -2,
        });

        const leftStrip = new THREE.Mesh(
            this.createEdgeStripGeometry(data, curve, 0.84, 0.97),
            material.clone()
        );
        leftStrip.name = 'nordschleife-edge-left';
        leftStrip.receiveShadow = true;
        leftStrip.castShadow = false;

        const rightStrip = new THREE.Mesh(
            this.createEdgeStripGeometry(data, curve, -0.97, -0.84),
            material.clone()
        );
        rightStrip.name = 'nordschleife-edge-right';
        rightStrip.receiveShadow = true;
        rightStrip.castShadow = false;

        group.add(leftStrip);
        group.add(rightStrip);
        return group;
    }

    createEdgeStripGeometry(
        data: TrackAssetData,
        curve: THREE.Curve<THREE.Vector3>,
        outerFactor: number,
        innerFactor: number
    ) {
        const samples = Math.max(64, data.samples ?? DEFAULT_SAMPLES);
        const width = data.width ?? DEFAULT_WIDTH;
        const halfWidth = width * 0.5;
        const uvScale = data.uvScale ?? DEFAULT_UV_SCALE;
        const elevationOffset = 0.12;

        const tangent = new THREE.Vector3();
        const point = new THREE.Vector3();
        const side = new THREE.Vector3();
        const normal = new THREE.Vector3(0, 1, 0);
        const previousSide = new THREE.Vector3(1, 0, 0);
        const outer = new THREE.Vector3();
        const inner = new THREE.Vector3();
        const previousPoint = new THREE.Vector3();
        const segmentDistance = new THREE.Vector3();

        const vertices: number[] = [];
        const uvs: number[] = [];
        const indices: number[] = [];
        let distanceTravelled = 0;

        curve.getPointAt(0, previousPoint);

        for (let i = 0; i <= samples; i++) {
            const t = i / samples;

            curve.getPointAt(t, point);
            curve.getTangentAt(t, tangent).normalize();

            side.crossVectors(normal, tangent);
            if (side.lengthSq() < 1e-6) {
                side.copy(previousSide);
            } else {
                side.normalize();
                if (side.dot(previousSide) < 0) {
                    side.multiplyScalar(-1);
                }
                previousSide.copy(side);
            }

            const bankAngle = Math.sin(t * Math.PI * 16) * 0.045;
            normal.set(0, 1, 0).applyAxisAngle(tangent, bankAngle).normalize();
            side.crossVectors(normal, tangent).normalize();

            outer
                .copy(point)
                .addScaledVector(side, halfWidth * outerFactor)
                .addScaledVector(normal, elevationOffset);
            inner
                .copy(point)
                .addScaledVector(side, halfWidth * innerFactor)
                .addScaledVector(normal, elevationOffset);

            vertices.push(outer.x, outer.y, outer.z, inner.x, inner.y, inner.z);

            if (i > 0) {
                segmentDistance.subVectors(point, previousPoint);
                distanceTravelled += segmentDistance.length();
            }
            const v = distanceTravelled * uvScale;
            uvs.push(0, v, 1, v);

            previousPoint.copy(point);
        }

        for (let i = 0; i < samples; i++) {
            const a = i * 2;
            const b = a + 1;
            const c = a + 2;
            const d = a + 3;
            indices.push(a, b, d, a, d, c);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setIndex(indices);
        geometry.setAttribute(
            'position',
            new THREE.Float32BufferAttribute(vertices, 3)
        );
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        return geometry;
    }

    createColliderMesh(data: TrackAssetData, curve: THREE.Curve<THREE.Vector3>) {
        const geometry = this.createTrackSurfaceGeometry(data, curve);
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

    createTrackSurfaceGeometry(data: TrackAssetData, curve: THREE.Curve<THREE.Vector3>) {
        const samples = Math.max(64, data.samples ?? DEFAULT_SAMPLES);
        const width = data.width ?? DEFAULT_WIDTH;
        const halfWidth = width * 0.5;
        const uvScale = data.uvScale ?? DEFAULT_UV_SCALE;

        const up = new THREE.Vector3(0, 1, 0);
        const tangent = new THREE.Vector3();
        const point = new THREE.Vector3();
        const side = new THREE.Vector3();
        const normal = new THREE.Vector3(0, 1, 0);
        const previousSide = new THREE.Vector3(1, 0, 0);
        const left = new THREE.Vector3();
        const right = new THREE.Vector3();
        const previousPoint = new THREE.Vector3();
        const segmentDistance = new THREE.Vector3();

        const vertices: number[] = [];
        const uvs: number[] = [];
        const indices: number[] = [];
        let distanceTravelled = 0;

        curve.getPointAt(0, previousPoint);

        for (let i = 0; i <= samples; i++) {
            const t = i / samples;

            curve.getPointAt(t, point);
            curve.getTangentAt(t, tangent).normalize();

            side.crossVectors(normal, tangent);
            if (side.lengthSq() < 1e-6) {
                side.copy(previousSide);
            } else {
                side.normalize();
                if (side.dot(previousSide) < 0) {
                    side.multiplyScalar(-1);
                }
                previousSide.copy(side);
            }

            const bankAngle = Math.sin(t * Math.PI * 16) * 0.045;
            normal.set(0, 1, 0).applyAxisAngle(tangent, bankAngle).normalize();
            side.crossVectors(normal, tangent).normalize();

            left.copy(point).addScaledVector(side, halfWidth);
            right.copy(point).addScaledVector(side, -halfWidth);

            vertices.push(left.x, left.y, left.z, right.x, right.y, right.z);

            if (i > 0) {
                segmentDistance.subVectors(point, previousPoint);
                distanceTravelled += segmentDistance.length();
            }

            const v = distanceTravelled * uvScale;
            uvs.push(0, v, 1, v);

            previousPoint.copy(point);
        }

        for (let i = 0; i < samples; i++) {
            const a = i * 2;
            const b = a + 1;
            const c = a + 2;
            const d = a + 3;
            indices.push(a, b, d, a, d, c);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setIndex(indices);
        geometry.setAttribute(
            'position',
            new THREE.Float32BufferAttribute(vertices, 3)
        );
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        return geometry;
    }

    getOffset(offset?: number[]) {
        return new THREE.Vector3(offset?.[0] || 0, offset?.[1] || 0, offset?.[2] || 0);
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
        if (!this.debugColliderRayEnabled || !this.debugRayLine || !this.debugHitMarker) {
            return;
        }

        const t = (this.application.time.elapsed * 0.00002) % 1;
        const curvePoint = this.colliderCurve.getPointAt(t);
        const origin = curvePoint.clone().add(new THREE.Vector3(0, 5000, 0));
        const direction = new THREE.Vector3(0, -1, 0);

        this.colliderRaycaster.layers.set(COLLIDER_LAYER);
        this.colliderRaycaster.set(origin, direction);
        this.colliderRaycaster.far = 12000;

        const hits = this.colliderRaycaster.intersectObject(this.colliderMesh, false);
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
