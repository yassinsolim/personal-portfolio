// keeps the render resolution as high as the device can hold at the target
// frame rate. it drops fast when frames run long, probes back up slowly when
// there's headroom, and remembers failed probes so it settles instead of
// bouncing between two resolutions

const WINDOW_MS = 1000;
const MIN_FRAMES = 20;
// longer frames are loading, shader compiles, or tab switches, not steady load,
// unless they keep coming: this many in a row is a machine that's just slow
const HITCH_MS = 250;
const SLOW_RUN = 4;
// a slow machine may not fit MIN_FRAMES in a window, so after this long a
// window closes with whatever it has
const SLOW_WINDOW_MS = 3000;
const SLOW_MIN_FRAMES = 4;
const TRIM = 0.1;
const LOW = 0.92;
const HIGH = 0.97;
// high refresh screens show real headroom above the target, so probe sooner
const HEADROOM = 1.25;
const PROBE_AFTER_MS = 3000;
const FAST_PROBE_AFTER_MS = 1000;
// probes start big and halve after each failure to close in on the limit
const PROBE_STEP = 1.15;
// a resolution drop has to buy this much fps, or resolution isn't the
// bottleneck (cpu bound, or the browser caps the frame rate)
const MIN_GAIN = 1.05;
const CEILING_MS = 30000;
const FLOOR_MS = 60000;
const MAX_BACKOFF_MS = 300000;
const STEP = 0.05;

type Pending = { kind: 'up' | 'down'; from: number; fps: number };

const snapDown = (ratio: number) => Math.floor(ratio / STEP + 1e-6) * STEP;
const snapUp = (ratio: number) => Math.ceil(ratio / STEP - 1e-6) * STEP;

export default class AdaptiveResolution {
    ratio: number;
    min: number;
    max: number;
    fps: number;
    private target: number;
    private intervals: number[];
    private windowStart: number;
    private settle: number;
    private stableMs: number;
    private pending: Pending | null;
    private probeStep: number;
    private ceiling: number;
    private ceilingUntil: number;
    private ceilingMs: number;
    private floor: number;
    private floorUntil: number;
    private floorMs: number;
    private longRun = 0;

    constructor(min: number, max: number, start: number, targetFps = 60) {
        this.min = min;
        this.max = Math.max(min, max);
        this.ratio = Math.min(this.max, Math.max(this.min, start));
        this.target = targetFps;
        this.fps = 0;
        this.intervals = [];
        this.windowStart = -1;
        this.settle = 2;
        this.stableMs = 0;
        this.pending = null;
        this.probeStep = PROBE_STEP;
        this.ceiling = Infinity;
        this.ceilingUntil = 0;
        this.ceilingMs = CEILING_MS;
        this.floor = 0;
        this.floorUntil = 0;
        this.floorMs = FLOOR_MS;
    }

    // the screen can change (window moved to another monitor), keep the ratio inside it
    setBounds(min: number, max: number) {
        this.min = min;
        this.max = Math.max(min, max);
        this.ratio = Math.min(this.max, Math.max(this.min, this.ratio));
    }

    // call on a scene switch: drops the measurements and the limits learned
    // in the old scene
    reset() {
        this.intervals = [];
        this.windowStart = -1;
        this.settle = Math.max(this.settle, 1);
        this.pending = null;
        this.stableMs = 0;
        this.probeStep = PROBE_STEP;
        this.ceiling = Infinity;
        this.ceilingMs = CEILING_MS;
        this.floor = 0;
        this.floorMs = FLOOR_MS;
    }

    // a frame that isn't the steady load (work spread over frames on
    // purpose) starts the measurement over instead of counting
    discard(now: number) {
        this.intervals = [];
        this.windowStart = now;
    }

    // feed every frame; returns the new ratio when it should change
    frame(intervalMs: number, now: number): number | null {
        if (!(intervalMs > 0)) return null;
        if (intervalMs > HITCH_MS) {
            this.longRun++;
            if (this.longRun < SLOW_RUN) {
                this.intervals = [];
                this.windowStart = now;
                return null;
            }
        } else this.longRun = 0;
        if (this.windowStart < 0) this.windowStart = now - intervalMs;
        this.intervals.push(intervalMs);
        const elapsed = now - this.windowStart;
        const full =
            elapsed >= WINDOW_MS && this.intervals.length >= MIN_FRAMES;
        const slowFull =
            elapsed >= SLOW_WINDOW_MS &&
            this.intervals.length >= SLOW_MIN_FRAMES;
        if (!full && !slowFull) return null;

        const sorted = this.intervals.slice().sort((a, b) => a - b);
        const kept = sorted.slice(0, Math.ceil(sorted.length * (1 - TRIM)));
        const mean = kept.reduce((sum, value) => sum + value, 0) / kept.length;
        this.fps = 1000 / mean;
        this.intervals = [];
        this.windowStart = now;
        if (this.settle > 0) {
            this.settle--;
            return null;
        }
        return this.decide(this.fps, elapsed, now);
    }

    private decide(fps: number, elapsed: number, now: number) {
        const slow = fps < this.target * LOW;
        const pending = this.pending;
        this.pending = null;
        if (pending?.kind === 'up' && slow) {
            // stay under the resolution that failed, and try smaller steps next
            this.ceiling = Math.max(pending.from, snapDown(this.ratio - STEP));
            this.ceilingUntil = now + this.ceilingMs;
            this.ceilingMs = Math.min(this.ceilingMs * 2, MAX_BACKOFF_MS);
            this.probeStep = 1 + (this.probeStep - 1) / 2;
            return this.set(pending.from);
        }
        if (pending?.kind === 'down' && slow && fps < pending.fps * MIN_GAIN) {
            this.floor = pending.from;
            this.floorUntil = now + this.floorMs;
            this.floorMs = Math.min(this.floorMs * 2, MAX_BACKOFF_MS);
            return this.set(pending.from);
        }
        if (now >= this.ceilingUntil) this.ceiling = Infinity;
        if (now >= this.floorUntil) this.floor = 0;

        if (slow) {
            this.stableMs = 0;
            const lowest = Math.max(this.min, this.floor);
            // pixel cost scales with ratio squared, mild dips only drop a step
            const factor = Math.min(
                0.97,
                Math.max(0.7, Math.sqrt(fps / this.target))
            );
            const next = Math.max(lowest, snapDown(this.ratio * factor));
            if (next >= this.ratio - 1e-6) return null;
            // this level was too slow, so don't probe back to it for a while
            this.ceiling = Math.min(this.ceiling, snapDown(this.ratio - STEP));
            this.ceilingUntil = now + this.ceilingMs;
            this.ceilingMs = Math.min(this.ceilingMs * 2, MAX_BACKOFF_MS);
            this.pending = { kind: 'down', from: this.ratio, fps };
            return this.set(next);
        }

        if (fps < this.target * HIGH) {
            this.stableMs = 0;
            return null;
        }
        this.stableMs += elapsed;
        const headroom = fps >= this.target * HEADROOM;
        if (headroom) this.probeStep = PROBE_STEP;
        const wait = headroom ? FAST_PROBE_AFTER_MS : PROBE_AFTER_MS;
        const highest = Math.min(this.max, this.ceiling);
        if (this.stableMs < wait || this.ratio >= highest - 1e-6) return null;
        this.stableMs = 0;
        this.pending = { kind: 'up', from: this.ratio, fps };
        return this.set(Math.min(highest, snapUp(this.ratio * this.probeStep)));
    }

    private set(ratio: number) {
        const next =
            Math.round(Math.min(this.max, Math.max(this.min, ratio)) * 1000) /
            1000;
        if (Math.abs(next - this.ratio) < 1e-6) return null;
        this.ratio = next;
        this.settle = 1;
        this.intervals = [];
        this.windowStart = -1;
        return next;
    }
}
