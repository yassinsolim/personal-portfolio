import * as THREE from 'three';
import type RaceVehicle from './Vehicle/RaceVehicle';

// rewind: the last 10 s of the car, a frame every 1/30 s. holding rewind plays
// them back in reverse, letting go drives on from the one on screen
export const REWIND_SECONDS = 10;
const FRAME_MS = 1000 / 30;
// real time at first, then twice as fast once it's been held this long
const FAST_AFTER_S = 0.6;

export type Fields = Record<string, unknown>;

const isVector = (value: unknown): value is THREE.Vector3 | THREE.Quaternion =>
    Boolean(
        value &&
            ((value as THREE.Vector3).isVector3 ||
                (value as THREE.Quaternion).isQuaternion)
    );

// an object's own numbers, flags, lists of them, vectors and quaternions:
// what a driving model carries from one step to the next
export const snapshotFields = (
    source: object,
    skip: (key: string) => boolean = () => false
): Fields => {
    const out: Fields = {};
    Object.keys(source).forEach((key) => {
        if (skip(key)) return;
        const value = (source as Fields)[key];
        const kind = typeof value;
        if (kind === 'number' || kind === 'boolean') out[key] = value;
        else if (Array.isArray(value)) {
            if (value.every((item) => typeof item !== 'object')) out[key] = value.slice();
        } else if (isVector(value)) out[key] = value.clone();
    });
    return out;
};

// back into the same objects, so whatever holds them still sees them
export const restoreFields = (target: object, fields: Fields) => {
    const own = target as Fields;
    Object.keys(fields).forEach((key) => {
        const value = fields[key];
        const current = own[key];
        if (Array.isArray(value)) {
            if (Array.isArray(current)) {
                current.length = 0;
                current.push(...value);
            } else own[key] = value.slice();
        } else if (isVector(value)) {
            if (isVector(current)) (current as THREE.Vector3).copy(value as THREE.Vector3);
            else own[key] = value.clone();
        } else own[key] = value;
    });
};

export type RewindFrame = {
    // on the rewind's own clock, which stops while it plays back
    at: number;
    vehicle: Fields;
    physics: Fields;
    surface: Fields;
    trackFrame: Fields;
    wheelFrame: Fields;
    pivotPosition: THREE.Vector3;
    pivotQuaternion: THREE.Quaternion;
    // whatever else the caller keeps with it (lap clock, sectors)
    extra: Record<string, Fields>;
};

// the reset counter tells the lap clock to start again, it stays as it is
const skipVehicle = (key: string) => key.startsWith('tmp') || key === 'startResets';

export const captureVehicle = (
    vehicle: RaceVehicle,
    at: number,
    extra: Record<string, Fields>
): RewindFrame => ({
    at,
    vehicle: snapshotFields(vehicle, skipVehicle),
    physics: snapshotFields(vehicle.physics),
    surface: snapshotFields(vehicle.physicsSurface),
    trackFrame: snapshotFields(vehicle.trackFrame),
    wheelFrame: snapshotFields(vehicle.wheelFrame),
    pivotPosition: vehicle.carPivot.position.clone(),
    pivotQuaternion: vehicle.carPivot.quaternion.clone(),
    extra,
});

export const restoreVehicle = (vehicle: RaceVehicle, frame: RewindFrame) => {
    restoreFields(vehicle, frame.vehicle);
    restoreFields(vehicle.physics, frame.physics);
    restoreFields(vehicle.physicsSurface, frame.surface);
    restoreFields(vehicle.trackFrame, frame.trackFrame);
    restoreFields(vehicle.wheelFrame, frame.wheelFrame);
    vehicle.carPivot.position.copy(frame.pivotPosition);
    vehicle.carPivot.quaternion.copy(frame.pivotQuaternion);
    vehicle.carPivot.updateMatrixWorld(true);
};

export default class RewindBuffer {
    frames: RewindFrame[] = [];
    clock = 0;
    lastAt = -Infinity;
    // where the playback is on the clock, null when it isn't playing
    playhead: number | null = null;
    held = 0;

    // after each driving frame. the clock only runs while driving
    record(deltaMs: number, make: (at: number) => RewindFrame) {
        this.clock += deltaMs;
        // a ms of slack, or two 60 Hz frames can round to just under one
        if (this.clock - this.lastAt < FRAME_MS - 1) return;
        this.lastAt = this.clock;
        this.frames.push(make(this.clock));
        const oldest = this.clock - REWIND_SECONDS * 1000;
        while (this.frames.length > 1 && this.frames[0].at < oldest) this.frames.shift();
    }

    clear() {
        this.frames.length = 0;
        this.lastAt = -Infinity;
        this.playhead = null;
        this.held = 0;
    }

    canRewind() {
        return this.frames.length > 1;
    }

    // the last frame at or before the time
    frameAt(at: number) {
        let lo = 0;
        let hi = this.frames.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (this.frames[mid].at <= at) lo = mid;
            else hi = mid - 1;
        }
        return lo;
    }

    // a step back while held: the frame to show
    scrub(deltaSeconds: number): RewindFrame | null {
        if (!this.canRewind()) return null;
        if (this.playhead === null) {
            this.playhead = this.frames[this.frames.length - 1].at;
            this.held = 0;
        }
        this.held += deltaSeconds;
        const speed = this.held < FAST_AFTER_S ? 1 : 2;
        this.playhead = Math.max(
            this.frames[0].at,
            this.playhead - deltaSeconds * 1000 * speed
        );
        return this.frames[this.frameAt(this.playhead)];
    }

    // let go: everything after the frame on screen goes, and it's the one to
    // drive on from
    release(): RewindFrame | null {
        if (this.playhead === null) return null;
        const index = this.frameAt(this.playhead);
        const frame = this.frames[index];
        this.frames.length = index + 1;
        this.clock = frame.at;
        this.lastAt = frame.at;
        this.playhead = null;
        this.held = 0;
        return frame;
    }

    // how much is left to go back, 0..1
    left() {
        if (this.frames.length < 2) return 0;
        const first = this.frames[0].at;
        const last = this.frames[this.frames.length - 1].at;
        const at = this.playhead ?? last;
        return (at - first) / (REWIND_SECONDS * 1000);
    }
}
