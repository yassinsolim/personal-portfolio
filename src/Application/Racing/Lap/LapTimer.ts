import * as THREE from 'three';

const MIN_LAP_TIME_MS = 30_000;
const START_TRIGGER_COOLDOWN_MS = 1_500;
const PROGRESS_VALID_THRESHOLD = 0.92;

type LapUpdate = {
    progress: number;
    lapRunning: boolean;
    lapTimeMs: number;
    completedLapTimeMs?: number;
    validLap?: boolean;
};

export default class LapTimer {
    curve: THREE.CatmullRomCurve3;
    samplePoints: THREE.Vector3[];
    startPoint: THREE.Vector3;
    startNormal: THREE.Vector3;
    lapRunning: boolean;
    lapStartMs: number;
    maxProgress: number;
    previousDistance: number;
    previousClosestIndex: number;
    lastCrossTimestampMs: number;

    constructor(curve: THREE.CatmullRomCurve3, sampleCount = 2200) {
        this.curve = curve;
        this.samplePoints = [];
        for (let i = 0; i <= sampleCount; i++) {
            this.samplePoints.push(this.curve.getPointAt(i / sampleCount));
        }

        this.startPoint = this.curve.getPointAt(0);
        this.startNormal = this.curve.getTangentAt(0).normalize();

        this.lapRunning = false;
        this.lapStartMs = 0;
        this.maxProgress = 0;
        this.previousDistance = 0;
        this.previousClosestIndex = 0;
        this.lastCrossTimestampMs = -Infinity;
    }

    reset() {
        this.lapRunning = false;
        this.lapStartMs = 0;
        this.maxProgress = 0;
        this.previousDistance = 0;
        this.previousClosestIndex = 0;
        this.lastCrossTimestampMs = -Infinity;
    }

    startLap(nowMs: number, position: THREE.Vector3) {
        const closestIndex = this.getClosestSampleIndex(position);
        const progress = closestIndex / Math.max(1, this.samplePoints.length - 1);
        const signedDistance = position
            .clone()
            .sub(this.startPoint)
            .dot(this.startNormal);

        this.lapRunning = true;
        this.lapStartMs = nowMs;
        this.maxProgress = progress;
        this.previousDistance = signedDistance;
        this.lastCrossTimestampMs = nowMs;

        return {
            progress,
            lapRunning: this.lapRunning,
            lapTimeMs: 0,
        };
    }

    getClosestSampleIndex(position: THREE.Vector3) {
        let bestDistanceSq = Number.POSITIVE_INFINITY;
        let bestIndex = this.previousClosestIndex;
        const count = this.samplePoints.length;

        // Search near prior sample first to avoid full scans every frame.
        const localRange = 160;
        for (let offset = -localRange; offset <= localRange; offset++) {
            const candidateIndex =
                (this.previousClosestIndex + offset + count) % count;
            const distanceSq = position.distanceToSquared(
                this.samplePoints[candidateIndex]
            );
            if (distanceSq < bestDistanceSq) {
                bestDistanceSq = distanceSq;
                bestIndex = candidateIndex;
            }
        }

        // Recover if we teleported too far away.
        if (bestDistanceSq > 1200 * 1200) {
            for (let i = 0; i < count; i++) {
                const distanceSq = position.distanceToSquared(this.samplePoints[i]);
                if (distanceSq < bestDistanceSq) {
                    bestDistanceSq = distanceSq;
                    bestIndex = i;
                }
            }
        }

        this.previousClosestIndex = bestIndex;
        return bestIndex;
    }

    update(
        nowMs: number,
        position: THREE.Vector3,
        speedMps: number,
        forward: THREE.Vector3
    ): LapUpdate {
        const closestIndex = this.getClosestSampleIndex(position);
        const progress = closestIndex / Math.max(1, this.samplePoints.length - 1);

        if (this.lapRunning) {
            this.maxProgress = Math.max(this.maxProgress, progress);
        }

        const signedDistance = position
            .clone()
            .sub(this.startPoint)
            .dot(this.startNormal);
        const crossedForward =
            this.previousDistance < 0 &&
            signedDistance >= 0 &&
            speedMps > 5 &&
            forward.dot(this.startNormal) > 0.25;

        this.previousDistance = signedDistance;

        if (
            crossedForward &&
            nowMs - this.lastCrossTimestampMs > START_TRIGGER_COOLDOWN_MS
        ) {
            this.lastCrossTimestampMs = nowMs;

            if (!this.lapRunning) {
                this.lapRunning = true;
                this.lapStartMs = nowMs;
                this.maxProgress = progress;
                return {
                    progress,
                    lapRunning: true,
                    lapTimeMs: 0,
                };
            }

            const lapTimeMs = nowMs - this.lapStartMs;
            const isValidLap =
                lapTimeMs >= MIN_LAP_TIME_MS &&
                this.maxProgress >= PROGRESS_VALID_THRESHOLD;

            this.lapStartMs = nowMs;
            this.maxProgress = progress;

            return {
                progress,
                lapRunning: true,
                lapTimeMs: 0,
                completedLapTimeMs: lapTimeMs,
                validLap: isValidLap,
            };
        }

        return {
            progress,
            lapRunning: this.lapRunning,
            lapTimeMs: this.lapRunning ? nowMs - this.lapStartMs : 0,
        };
    }
}
