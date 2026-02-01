import * as THREE from 'three';

const STORAGE_KEY = 'yassinverse:nordschleife:ghost:v1';
const SAMPLE_INTERVAL_MS = 45;

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
    ghostMesh: THREE.Mesh;
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
        this.root = new THREE.Group();
        this.root.name = 'race-ghost-root';
        this.root.visible = false;

        this.ghostMesh = new THREE.Mesh(
            new THREE.BoxGeometry(2.1, 1.2, 4.4),
            new THREE.MeshBasicMaterial({
                color: 0x6fe7ff,
                transparent: true,
                opacity: 0.35,
                wireframe: true,
                depthWrite: false,
            })
        );
        this.ghostMesh.name = 'race-ghost-car';
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

