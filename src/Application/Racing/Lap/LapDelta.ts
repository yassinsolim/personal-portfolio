// the live gap to your best clean lap with this car, stock or tuned: this
// lap's clock at each bit of the lap against the best lap's at the same spot
import { SEASON_TAG } from '../Leaderboard/season';

const STORAGE_PREFIX = `yassinverse:raceDelta${SEASON_TAG}:`;
// about 21 m each on the ring
const BUCKETS = 1000;

export default class LapDelta {
    key = '';
    // ms on the best lap's clock at each bucket, BUCKETS + 1 of them
    best: number[] | null = null;
    bestLapMs = 0;
    current: number[] = [];
    filled = -1;
    lastProgress = 0;
    lastTime = 0;

    // true when it's another car or setup
    setKey(carId: string, tuned: boolean) {
        const key = `${carId}:${tuned ? 'tuned' : 'stock'}`;
        if (key === this.key) return false;
        this.key = key;
        this.load();
        this.reset();
        return true;
    }

    reset() {
        this.current = [];
        this.filled = -1;
        this.lastProgress = 0;
        this.lastTime = 0;
    }

    // only moving on counts: backing up or a reset leaves the clock running
    // until the car is past where it was
    update(progress: number, lapMs: number) {
        if (progress <= this.lastProgress) return;
        const bucket = Math.min(BUCKETS, Math.floor(progress * BUCKETS));
        const span = progress - this.lastProgress;
        for (let b = this.filled + 1; b <= bucket; b++) {
            const t = Math.min(1, Math.max(0, (b / BUCKETS - this.lastProgress) / span));
            this.current[b] = Math.round(this.lastTime + (lapMs - this.lastTime) * t);
        }
        this.filled = Math.max(this.filled, bucket);
        this.lastProgress = progress;
        this.lastTime = lapMs;
    }

    // ms behind (positive) or ahead of the best lap, null with nothing to
    // compare
    gap() {
        const best = this.best;
        if (!best || this.filled < 0) return null;
        const x = Math.min(BUCKETS, this.lastProgress * BUCKETS);
        const i = Math.min(BUCKETS - 1, Math.floor(x));
        const reference = best[i] + (best[i + 1] - best[i]) * (x - i);
        return this.lastTime - reference;
    }

    // a clean lap that beats the best becomes it
    complete(lapMs: number, clean: boolean) {
        const covered = this.filled >= BUCKETS * 0.95;
        if (clean && covered && (!this.bestLapMs || lapMs < this.bestLapMs)) {
            const lap = this.current.slice();
            for (let b = this.filled + 1; b <= BUCKETS; b++) lap[b] = lapMs;
            this.best = lap;
            this.bestLapMs = lapMs;
            this.save();
        }
        this.reset();
    }

    load() {
        this.best = null;
        this.bestLapMs = 0;
        try {
            const raw = window.localStorage.getItem(STORAGE_PREFIX + this.key);
            const parsed = raw ? JSON.parse(raw) : null;
            if (
                parsed &&
                Array.isArray(parsed.lap) &&
                parsed.lap.length === BUCKETS + 1 &&
                parsed.lap.every(Number.isFinite) &&
                parsed.lapMs > 0
            ) {
                this.best = parsed.lap;
                this.bestLapMs = parsed.lapMs;
            }
        } catch {
            // nothing saved for this car yet
        }
    }

    save() {
        try {
            window.localStorage.setItem(
                STORAGE_PREFIX + this.key,
                JSON.stringify({ lapMs: this.bestLapMs, lap: this.best })
            );
        } catch {
            // storage full or blocked
        }
    }
}
