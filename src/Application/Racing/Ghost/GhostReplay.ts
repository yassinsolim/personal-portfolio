import * as THREE from 'three';
import { carOptionsById, defaultCarId } from '../../carOptions';
import Application from '../../Application';

const STORAGE_KEY = 'yassinverse:nordschleife:ghost:v1';
const SAMPLE_INTERVAL_MS = 45;
const GHOST_OPACITY = 0.38;
const MAX_RECORDING_SAMPLES = 12000;

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

export type GhostLapReplay = {
    lapTimeMs: number;
    carId: string;
    samples: GhostSample[];
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

type PreparedGhostModelProvider = (carId: string) => THREE.Group | null;
type GhostGroundSampler = (
    x: number,
    z: number,
    normal: THREE.Vector3
) => number | null;

export default class GhostReplay {
    root: THREE.Group;
    ghostMesh: THREE.Object3D;
    ghostMaterialOverrides: THREE.Material[];
    resources: Application['resources'];
    getPreparedModel: PreparedGhostModelProvider | null;
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
    externalReplay: GhostLapReplay | null;
    lastCompletedLapReplay: GhostLapReplay | null;
    sampleGround: GhostGroundSampler | null;
    ghostRideHeight: number;
    groundNormal: THREE.Vector3;
    ghostForward: THREE.Vector3;
    ghostSide: THREE.Vector3;
    ghostBasis: THREE.Matrix4;

    constructor(
        parent: THREE.Object3D,
        getPreparedModel: PreparedGhostModelProvider | null = null,
        sampleGround: GhostGroundSampler | null = null
    ) {
        const app = new Application();
        this.resources = app.resources;
        this.getPreparedModel = getPreparedModel;
        this.sampleGround = sampleGround;
        this.ghostRideHeight = 0;
        this.groundNormal = new THREE.Vector3();
        this.ghostForward = new THREE.Vector3();
        this.ghostSide = new THREE.Vector3();
        this.ghostBasis = new THREE.Matrix4();

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
        this.playbackTimeMs = 0;
        this.playbackDurationMs = 0;
        this.bestLapTimeMs = 0;
        this.carId = 'unknown';
        this.lastSampleAtMs = -Infinity;
        this.externalReplay = null;
        this.lastCompletedLapReplay = null;

        this.load();
    }

    setActive(active: boolean) {
        this.active = active;
        this.root.visible = active && this.getActivePlaybackSamples().length > 1;
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
        if (
            !this.recording ||
            !Number.isFinite(nowMs) ||
            !Number.isFinite(this.lapStartMs)
        ) {
            return;
        }
        if (nowMs - this.lastSampleAtMs < SAMPLE_INTERVAL_MS) return;

        const { position, quaternion } = telemetry;
        if (
            ![
                position.x,
                position.y,
                position.z,
                quaternion.x,
                quaternion.y,
                quaternion.z,
                quaternion.w,
            ].every(Number.isFinite)
        ) {
            return;
        }

        if (!this.externalReplay && telemetry.carId && telemetry.carId !== this.carId) {
            this.setGhostCar(telemetry.carId);
        }

        this.lastSampleAtMs = nowMs;
        const t = nowMs - this.lapStartMs;
        const sample: GhostSample = {
            t,
            x: position.x,
            y: position.y,
            z: position.z,
            qx: quaternion.x,
            qy: quaternion.y,
            qz: quaternion.z,
            qw: quaternion.w,
        };
        this.recordingSamples.push(sample);
        this.compactRecordingSamples();
        this.carId = telemetry.carId;
    }

    compactRecordingSamples() {
        if (this.recordingSamples.length <= MAX_RECORDING_SAMPLES) return;

        let writeIndex = 0;
        for (
            let readIndex = 0;
            readIndex < this.recordingSamples.length;
            readIndex += 2
        ) {
            this.recordingSamples[writeIndex++] =
                this.recordingSamples[readIndex];
        }
        this.recordingSamples.length = writeIndex;
    }

    finalizeRecording(lapTimeMs: number) {
        const firstSample = this.recordingSamples[0];
        const lastSample =
            this.recordingSamples[this.recordingSamples.length - 1];
        if (
            !firstSample ||
            !lastSample ||
            !Number.isFinite(lapTimeMs) ||
            lapTimeMs <= lastSample.t
        ) {
            return;
        }

        this.recordingSamples.push({
            ...firstSample,
            t: lapTimeMs,
        });
    }

    completeLap(valid: boolean, lapTimeMs: number) {
        if (!this.recording) return;
        this.recording = false;
        this.finalizeRecording(lapTimeMs);

        if (valid && this.recordingSamples.length >= 8) {
            this.lastCompletedLapReplay = {
                lapTimeMs,
                carId: this.carId,
                samples: this.recordingSamples.map((sample) => ({ ...sample })),
            };
        } else {
            this.lastCompletedLapReplay = null;
        }

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
        if (!this.externalReplay) {
            this.root.visible = this.active;
            this.setGhostCar(this.carId);
        }
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
            if (!this.externalReplay) {
                this.setGhostCar(this.carId);
            }
        } catch (error) {
            return;
        }
    }

    setExternalReplay(replay: GhostLapReplay | null) {
        if (!replay || replay.samples.length < 2) {
            this.externalReplay = null;
            if (this.playbackSamples.length > 1) {
                this.setGhostCar(this.carId);
            }
            this.root.visible = this.active && this.getActivePlaybackSamples().length > 1;
            this.playbackTimeMs = 0;
            return;
        }

        this.externalReplay = {
            lapTimeMs: replay.lapTimeMs,
            carId: replay.carId,
            samples: replay.samples.map((sample) => ({ ...sample })),
        };
        this.setGhostCar(this.externalReplay.carId || this.carId);
        this.root.visible = this.active;
        this.playbackTimeMs = 0;
    }

    getLastCompletedLapReplay(expectedLapTimeMs?: number) {
        if (!this.lastCompletedLapReplay) return null;
        if (
            Number.isFinite(expectedLapTimeMs) &&
            expectedLapTimeMs &&
            Math.floor(this.lastCompletedLapReplay.lapTimeMs) !==
                Math.floor(expectedLapTimeMs)
        ) {
            return null;
        }
        return {
            lapTimeMs: this.lastCompletedLapReplay.lapTimeMs,
            carId: this.lastCompletedLapReplay.carId,
            samples: this.lastCompletedLapReplay.samples.map((sample) => ({
                ...sample,
            })),
        };
    }

    getActivePlaybackSamples() {
        return this.externalReplay?.samples || this.playbackSamples;
    }

    getActivePlaybackDurationMs() {
        const replayDuration = this.externalReplay?.lapTimeMs;
        if (
            typeof replayDuration === 'number' &&
            Number.isFinite(replayDuration) &&
            replayDuration > 0
        ) {
            return replayDuration;
        }
        const samples = this.getActivePlaybackSamples();
        const lastSample = samples.length > 0 ? samples[samples.length - 1] : undefined;
        return this.playbackDurationMs || lastSample?.t || 0;
    }

    update(deltaSeconds: number) {
        const samples = this.getActivePlaybackSamples();
        const durationMs = this.getActivePlaybackDurationMs();
        if (!this.active || samples.length < 2) return;
        if (!durationMs) return;

        this.playbackTimeMs =
            (this.playbackTimeMs + deltaSeconds * 1000) % durationMs;

        const sample = this.sampleAt(this.playbackTimeMs, samples);
        if (!sample) return;

        this.ghostMesh.position.set(sample.x, sample.y, sample.z);
        this.ghostMesh.quaternion.set(sample.qx, sample.qy, sample.qz, sample.qw);
        this.snapGhostToRoad(sample);
    }

    // replays keep their line but take height and tilt from the road as it is
    // now, so laps recorded before a track change don't float or sink
    snapGhostToRoad(sample: { x: number; z: number }) {
        if (!this.sampleGround || !this.ghostRideHeight) return;
        const groundY = this.sampleGround(
            sample.x,
            sample.z,
            this.groundNormal
        );
        if (groundY === null) return;

        const forward = this.ghostForward
            .set(0, 0, 1)
            .applyQuaternion(this.ghostMesh.quaternion)
            .projectOnPlane(this.groundNormal);
        if (forward.lengthSq() < 1e-8) return;
        forward.normalize();
        const side = this.ghostSide
            .crossVectors(this.groundNormal, forward)
            .normalize();
        this.ghostBasis.makeBasis(side, this.groundNormal, forward);
        this.ghostMesh.quaternion.setFromRotationMatrix(this.ghostBasis);
        this.ghostMesh.position.y = groundY + this.ghostRideHeight;
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
        if (!this.active && !this.externalReplay) {
            return;
        }
        const previousOverrides = this.ghostMaterialOverrides;
        this.ghostMaterialOverrides = [];

        const option = carOptionsById[carId] || carOptionsById[defaultCarId];
        const preparedModel = this.getPreparedModel?.(option?.id || carId) || null;
        const gltf = !preparedModel && option
            ? this.resources.items.gltfModel[option.resourceName]
            : null;
        const scene = preparedModel || gltf?.scene;

        let nextGhost: THREE.Object3D = this.buildFallbackGhostMesh();
        if (scene) {
            const clone = scene.clone(true);
            clone.name = 'race-ghost-car';

            if (!preparedModel) {
                const box = new THREE.Box3().setFromObject(clone);
                const size = new THREE.Vector3();
                box.getSize(size);
                const rawLength = Math.max(size.x, size.y, size.z);
                if (rawLength > 0 && option?.lengthMeters) {
                    clone.scale.setScalar(option.lengthMeters / rawLength);
                }
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
            if (preparedModel) {
                // a prepared model sits on its wheels through its own offset,
                // so the replayed pose goes on a pivot instead of the model
                const pivot = new THREE.Group();
                pivot.name = 'race-ghost-car';
                pivot.add(clone);
                nextGhost = pivot;
            }
        }
        this.ghostRideHeight = preparedModel
            ? Number(preparedModel.userData.raceRideHeight) || 0
            : 0;

        const previousGhost = this.ghostMesh;
        this.root.add(nextGhost);
        nextGhost.position.copy(previousGhost.position);
        nextGhost.quaternion.copy(previousGhost.quaternion);
        this.ghostMesh = nextGhost;
        this.root.remove(previousGhost);
        this.disposeGhostOverrides(previousOverrides);
    }

    sampleAt(timeMs: number, samples: GhostSample[]) {
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
        return this.externalReplay?.lapTimeMs || this.bestLapTimeMs;
    }
}
