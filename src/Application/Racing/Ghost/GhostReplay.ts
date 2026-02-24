import * as THREE from 'three';
import { carOptionsById, defaultCarId } from '../../carOptions';
import Application from '../../Application';

const STORAGE_KEY = 'yassinverse:nordschleife:ghost:v1';
const SAMPLE_INTERVAL_MS = 45;
const GHOST_OPACITY = 0.38;

type GhostSample = {
    t: number;
    x: number;
    y: number;
    z: number;
    qx: number;
    qy: number;
    qz: number;
    qw: number;
};

type GhostStoragePayload = {
    bestLapTimeMs: number;
    samples: GhostSample[];
    carId: string;
};

type GhostTelemetry = {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    carId: string;
};

export default class GhostReplay {
    root: THREE.Group;
    ghostMesh: THREE.Object3D;
    ghostMaterialOverrides: THREE.Material[];
    resources: Application['resources'];
    fallbackGeometry: THREE.BoxGeometry;
    fallbackMaterial: THREE.MeshBasicMaterial;
    playbackSamples: GhostSample[];
    recordingSamples: GhostSample[];
    recording: boolean;
    active: boolean;
    lapStartMs: number;
    playbackTimeMs: number;
    playbackDurationMs: number;
    bestLapTimeMs: number;
    carId: string;
    lastSampleAtMs: number;

    constructor(parent: THREE.Object3D) {
        const app = new Application();
        this.resources = app.resources;

        this.root = new THREE.Group();
        this.root.name = 'race-ghost-root';
        this.root.visible = false;

        this.fallbackGeometry = new THREE.BoxGeometry(2.1, 1.2, 4.4);
        this.fallbackMaterial = new THREE.MeshBasicMaterial({
            color: 0x6fe7ff,
            transparent: true,
            opacity: 0.3,
            depthWrite: false,
        });
        this.ghostMesh = this.buildFallbackGhostMesh();
        this.ghostMaterialOverrides = [];
        this.root.add(this.ghostMesh);
        parent.add(this.root);

        this.playbackSamples = [];
        this.recordingSamples = [];
        this.recording = false;
        this.active = false;
        this.lapStartMs = 0;
        this.playbackTimeMs = 0;
        this.playbackDurationMs = 0;
        this.bestLapTimeMs = 0;
        this.carId = 'unknown';
        this.lastSampleAtMs = -Infinity;

        this.load();
    }

    setActive(active: boolean) {
        this.active = active;
        this.root.visible = active && this.playbackSamples.length > 1;
        if (!active) {
            this.recording = false;
            this.playbackTimeMs = 0;
        }
    }

    startLap(nowMs: number) {
        this.recording = true;
        this.recordingSamples = [];
        this.lapStartMs = nowMs;
        this.lastSampleAtMs = -Infinity;
    }

    cancelLap() {
        this.recording = false;
        this.recordingSamples = [];
    }

    capture(nowMs: number, telemetry: GhostTelemetry) {
        if (!this.recording) return;
        if (nowMs - this.lastSampleAtMs < SAMPLE_INTERVAL_MS) return;

        if (telemetry.carId && telemetry.carId !== this.carId) {
            this.setGhostCar(telemetry.carId);
        }

        this.lastSampleAtMs = nowMs;
        const t = nowMs - this.lapStartMs;
        const sample: GhostSample = {
            t,
            x: telemetry.position.x,
            y: telemetry.position.y,
            z: telemetry.position.z,
            qx: telemetry.quaternion.x,
            qy: telemetry.quaternion.y,
            qz: telemetry.quaternion.z,
            qw: telemetry.quaternion.w,
        };
        this.recordingSamples.push(sample);
        this.carId = telemetry.carId;
    }

    completeLap(valid: boolean, lapTimeMs: number) {
        if (!this.recording) return;
        this.recording = false;

        if (!valid || this.recordingSamples.length < 8) {
            this.recordingSamples = [];
            return;
        }

        const isBest = !this.bestLapTimeMs || lapTimeMs < this.bestLapTimeMs;
        if (!isBest) {
            this.recordingSamples = [];
            return;
        }

        this.bestLapTimeMs = lapTimeMs;
        this.playbackSamples = [...this.recordingSamples];
        this.playbackDurationMs =
            this.playbackSamples[this.playbackSamples.length - 1]?.t || lapTimeMs;
        this.playbackTimeMs = 0;
        this.recordingSamples = [];
        this.root.visible = this.active;
        this.setGhostCar(this.carId);
        this.save();
    }

    save() {
        if (typeof window === 'undefined') return;
        const payload: GhostStoragePayload = {
            bestLapTimeMs: this.bestLapTimeMs,
            samples: this.playbackSamples,
            carId: this.carId,
        };
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        } catch (error) {
            return;
        }
    }

    load() {
        if (typeof window === 'undefined') return;
        try {
            const raw = window.localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw) as GhostStoragePayload;
            if (!Array.isArray(parsed.samples) || !parsed.samples.length) return;
            this.bestLapTimeMs = parsed.bestLapTimeMs || 0;
            this.playbackSamples = parsed.samples;
            this.playbackDurationMs =
                this.playbackSamples[this.playbackSamples.length - 1]?.t || 0;
            this.carId = parsed.carId || 'unknown';
            this.setGhostCar(this.carId);
        } catch (error) {
            return;
        }
    }

    update(deltaSeconds: number) {
        if (!this.active || this.playbackSamples.length < 2) return;
        if (!this.playbackDurationMs) return;

        this.playbackTimeMs =
            (this.playbackTimeMs + deltaSeconds * 1000) % this.playbackDurationMs;

        const sample = this.sampleAt(this.playbackTimeMs);
        if (!sample) return;

        this.ghostMesh.position.set(sample.x, sample.y, sample.z);
        this.ghostMesh.quaternion.set(sample.qx, sample.qy, sample.qz, sample.qw);
    }

    buildFallbackGhostMesh() {
        const mesh = new THREE.Mesh(this.fallbackGeometry, this.fallbackMaterial);
        mesh.name = 'race-ghost-car';
        return mesh;
    }

    disposeGhostOverrides(overrides?: THREE.Material[]) {
        const target = overrides || this.ghostMaterialOverrides;
        target.forEach((material) => material.dispose());
        if (!overrides) {
            this.ghostMaterialOverrides = [];
        }
    }

    makeGhostMaterial(material: THREE.Material) {
        const cloned = material.clone();
        if ('transparent' in cloned) cloned.transparent = true;
        if ('opacity' in cloned) cloned.opacity = GHOST_OPACITY;
        if ('depthWrite' in cloned) cloned.depthWrite = false;
        if ('colorWrite' in cloned) cloned.colorWrite = true;
        if ('fog' in cloned) cloned.fog = false;
        cloned.needsUpdate = true;
        this.ghostMaterialOverrides.push(cloned);
        return cloned;
    }

    setGhostCar(carId: string) {
        const previousOverrides = this.ghostMaterialOverrides;
        this.ghostMaterialOverrides = [];

        const option = carOptionsById[carId] || carOptionsById[defaultCarId];
        const gltf = option
            ? this.resources.items.gltfModel[option.resourceName]
            : null;
        const scene = gltf?.scene;

        let nextGhost: THREE.Object3D = this.buildFallbackGhostMesh();
        if (scene) {
            const clone = scene.clone(true);
            clone.name = 'race-ghost-car';

            const box = new THREE.Box3().setFromObject(clone);
            const size = new THREE.Vector3();
            box.getSize(size);
            const rawLength = Math.max(size.x, size.y, size.z);
            if (rawLength > 0 && option?.lengthMeters) {
                clone.scale.setScalar(option.lengthMeters / rawLength);
            }

            clone.traverse((child) => {
                if (!(child instanceof THREE.Mesh)) return;
                child.castShadow = false;
                child.receiveShadow = false;
                if (Array.isArray(child.material)) {
                    child.material = child.material.map((mat) =>
                        this.makeGhostMaterial(mat)
                    );
                } else if (child.material) {
                    child.material = this.makeGhostMaterial(child.material);
                }
            });
            nextGhost = clone;
        }

        const previousGhost = this.ghostMesh;
        this.root.add(nextGhost);
        nextGhost.position.copy(previousGhost.position);
        nextGhost.quaternion.copy(previousGhost.quaternion);
        this.ghostMesh = nextGhost;
        this.root.remove(previousGhost);
        this.disposeGhostOverrides(previousOverrides);
    }

    sampleAt(timeMs: number) {
        const samples = this.playbackSamples;
        if (samples.length < 2) return null;

        let i = 0;
        for (; i < samples.length - 1; i++) {
            if (samples[i + 1].t >= timeMs) break;
        }

        const a = samples[i];
        const b = samples[Math.min(i + 1, samples.length - 1)];

        if (!a || !b) return null;
        if (a.t === b.t) return a;

        const alpha = (timeMs - a.t) / (b.t - a.t);
        const qA = new THREE.Quaternion(a.qx, a.qy, a.qz, a.qw);
        const qB = new THREE.Quaternion(b.qx, b.qy, b.qz, b.qw);
        const q = new THREE.Quaternion().slerpQuaternions(qA, qB, alpha);

        return {
            x: THREE.MathUtils.lerp(a.x, b.x, alpha),
            y: THREE.MathUtils.lerp(a.y, b.y, alpha),
            z: THREE.MathUtils.lerp(a.z, b.z, alpha),
            qx: q.x,
            qy: q.y,
            qz: q.z,
            qw: q.w,
        };
    }

    getBestLapTimeMs() {
        return this.bestLapTimeMs;
    }
}
