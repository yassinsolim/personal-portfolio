import * as THREE from 'three';

// the real ring: nothing laps it in under 5 minutes
const MIN_LAP_TIME_MS = 180_000;
// the start line only counts near the line itself, its plane cuts across the
// lap elsewhere too
const START_GATE_RADIUS = 40;
const START_TRIGGER_COOLDOWN_MS = 1_500;
const PROGRESS_VALID_THRESHOLD = 0.92;
// the first lap waits at 0 until the car moves. the grid sits just past the
// line (the furthest slot is ~60 m on), so arming only happens this close to it
export const ARM_PROGRESS = 0.012;
// movement that starts an armed lap, besides throttle or reverse: ground speed,
// or creeping this far from where it was armed (rolling on the start's slope)
export const ARM_START_SPEED_MPS = 1;
export const ARM_CREEP_METERS = 1.5;

type LapUpdate = {
    progress: number;
    // the lap fraction between samples, for the live gap to the best lap
    exact: number;
    lapRunning: boolean;
    lapTimeMs: number;
    armed?: boolean;
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
    // at the start with the clock at 0, waiting for the car to move
    armed: boolean;
    armOrigin: THREE.Vector3;
    minLapMs: number;

    constructor(curve: THREE.CatmullRomCurve3, sampleCount = 2200, minLapMs = MIN_LAP_TIME_MS) {
        this.curve = curve;
        this.minLapMs = minLapMs;
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
        this.armed = false;
        this.armOrigin = new THREE.Vector3();
    }

    reset() {
        this.lapRunning = false;
        this.lapStartMs = 0;
        this.maxProgress = 0;
        this.previousDistance = 0;
        this.previousClosestIndex = 0;
        this.lastCrossTimestampMs = -Infinity;
        this.armed = false;
    }

    // a fresh first lap. at the start the clock is armed at 0 and runs from
    // the first movement (see update). anywhere else the lap only starts at
    // the next forward crossing of the line, so a restart mid lap can't count
    // a part lap
    arm(nowMs: number, position: THREE.Vector3) {
        this.reset();
        const closestIndex = this.getClosestSampleIndex(position);
        const progress = closestIndex / Math.max(1, this.samplePoints.length - 1);
        this.previousDistance = position
            .clone()
            .sub(this.startPoint)
            .dot(this.startNormal);
        this.lastCrossTimestampMs = nowMs;
        this.maxProgress = progress;
        this.armed = progress <= ARM_PROGRESS;
        this.armOrigin.copy(position);
        return {
            progress,
            lapRunning: false,
            lapTimeMs: 0,
            armed: this.armed,
        };
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

    // the closest sample nudged along the segment the car is on, 2d
    exactProgress(position: THREE.Vector3, index: number) {
        const points = this.samplePoints;
        const last = points.length - 1;
        const along = (i: number) => {
            const a = points[i];
            const b = points[i + 1];
            const dx = b.x - a.x;
            const dz = b.z - a.z;
            const length = dx * dx + dz * dz;
            return length > 0
                ? ((position.x - a.x) * dx + (position.z - a.z) * dz) / length
                : 0;
        };
        let exact = index;
        const ahead = index < last ? along(index) : 0;
        if (ahead > 0) exact = index + Math.min(1, ahead);
        else if (index > 0) exact = index - 1 + Math.min(1, Math.max(0, along(index - 1)));
        return exact / Math.max(1, last);
    }

    // moving: throttle or reverse input this step. speed and creep are
    // checked here
    update(
        nowMs: number,
        position: THREE.Vector3,
        speedMps: number,
        forward: THREE.Vector3,
        moving = false
    ): LapUpdate {
        const closestIndex = this.getClosestSampleIndex(position);
        const progress = closestIndex / Math.max(1, this.samplePoints.length - 1);
        const exact = this.exactProgress(position, closestIndex);

        if (this.armed) {
            const creep = Math.hypot(
                position.x - this.armOrigin.x,
                position.z - this.armOrigin.z
            );
            if (
                moving ||
                Math.abs(speedMps) > ARM_START_SPEED_MPS ||
                creep > ARM_CREEP_METERS
            ) {
                this.armed = false;
                this.lapRunning = true;
                this.lapStartMs = nowMs;
                this.maxProgress = progress;
            } else {
                this.previousDistance = position
                    .clone()
                    .sub(this.startPoint)
                    .dot(this.startNormal);
                return { progress, exact, lapRunning: false, lapTimeMs: 0, armed: true };
            }
        }

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
            forward.dot(this.startNormal) > 0.25 &&
            position.distanceTo(this.startPoint) < START_GATE_RADIUS;

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
                    exact,
                    lapRunning: true,
                    lapTimeMs: 0,
                };
            }

            const lapTimeMs = nowMs - this.lapStartMs;
            const isValidLap =
                lapTimeMs >= this.minLapMs &&
                this.maxProgress >= PROGRESS_VALID_THRESHOLD;

            this.lapStartMs = nowMs;
            this.maxProgress = progress;

            return {
                progress,
                exact,
                lapRunning: true,
                lapTimeMs: 0,
                completedLapTimeMs: lapTimeMs,
                validLap: isValidLap,
            };
        }

        return {
            progress,
            exact,
            lapRunning: this.lapRunning,
            lapTimeMs: this.lapRunning ? nowMs - this.lapStartMs : 0,
        };
    }
}
