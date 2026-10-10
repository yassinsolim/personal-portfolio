// the clock of a board lap being watched: its own time, played at a rate,
// paused, sought or skipped. it stops at the lap's end and play starts over
export const WATCH_RATES = [0.5, 1, 2, 4];

export type WatchControl = {
    playing?: boolean;
    rate?: number;
    seekMs?: number;
    skipMs?: number;
};

export default class WatchClock {
    endMs: number;
    timeMs = 0;
    playing = true;
    rate = 1;

    constructor(endMs: number) {
        this.endMs = Math.max(0, endMs);
    }

    advance(deltaSeconds: number) {
        if (!this.playing) return;
        this.timeMs = Math.min(this.endMs, this.timeMs + deltaSeconds * 1000 * this.rate);
        if (this.timeMs >= this.endMs) this.playing = false;
    }

    // true when the time jumped, so a follow camera can cut instead of swing
    control(state: WatchControl | undefined) {
        const at = (value: number) => Math.min(this.endMs, Math.max(0, value));
        let jumped = false;
        if (Number.isFinite(state?.seekMs)) {
            this.timeMs = at(state!.seekMs!);
            jumped = true;
        }
        if (Number.isFinite(state?.skipMs)) {
            this.timeMs = at(this.timeMs + state!.skipMs!);
            jumped = true;
        }
        if (WATCH_RATES.includes(state?.rate as number)) this.rate = state!.rate!;
        if (typeof state?.playing === 'boolean') {
            if (state.playing && this.timeMs >= this.endMs) {
                this.timeMs = 0;
                jumped = true;
            }
            this.playing = state.playing;
        }
        return jumped;
    }
}
