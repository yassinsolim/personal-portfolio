// three sectors along the lap, split at named corners. keeps this lap's
// splits, the last lap's and the best per sector for the current car

export type SectorState = {
    // sector the car is in, 0 to 2
    index: number;
    // this lap, ms per finished sector
    current: number[];
    last: number[];
    best: number[];
    // the split points as lap fractions, for the minimap
    bounds: number[];
    names: string[];
};

const STORAGE_PREFIX = 'yassinverse:raceSectors@v6:';

export default class SectorTimer {
    bounds: number[];
    names: string[];
    index: number;
    sectorStartMs: number;
    current: number[];
    last: number[];
    best: number[];
    carId: string;
    // which lap the saved bests are for, the ring's are under no name
    trackKey: string;

    constructor(bounds: number[], names: string[], trackKey = '') {
        this.bounds = bounds;
        this.names = names;
        this.trackKey = trackKey;
        this.index = 0;
        this.sectorStartMs = 0;
        this.current = [];
        this.last = [];
        this.best = [];
        this.carId = '';
    }

    setCar(carId: string) {
        if (carId === this.carId) return;
        this.carId = carId;
        this.last = [];
        this.best = this.load();
        this.reset();
    }

    reset() {
        this.index = 0;
        this.sectorStartMs = 0;
        this.current = [];
    }

    // progress is the lap fraction, lap time is from the lap timer
    update(progress: number, lapTimeMs: number, lapRunning: boolean) {
        if (!lapRunning) return;
        const bound = this.bounds[this.index];
        // only a forward crossing close past the split counts, a reset or a
        // shortcut doesn't jump sectors
        if (
            bound !== undefined &&
            progress >= bound &&
            progress < bound + 0.04
        ) {
            this.current.push(lapTimeMs - this.sectorStartMs);
            this.sectorStartMs = lapTimeMs;
            this.index++;
        }
    }

    completeLap(lapTimeMs: number, valid: boolean) {
        if (this.current.length === this.bounds.length) {
            this.current.push(lapTimeMs - this.sectorStartMs);
            this.last = this.current.slice();
            if (valid) {
                let changed = false;
                this.last.forEach((split, i) => {
                    if (!(this.best[i] > 0) || split < this.best[i]) {
                        this.best[i] = split;
                        changed = true;
                    }
                });
                if (changed) this.save();
            }
        }
        this.reset();
    }

    getState(): SectorState {
        return {
            index: this.index,
            current: this.current.slice(),
            last: this.last.slice(),
            best: this.best.slice(),
            bounds: this.bounds,
            names: this.names,
        };
    }

    load(): number[] {
        try {
            const raw = window.localStorage.getItem(
                STORAGE_PREFIX + this.trackKey + this.carId
            );
            const parsed = raw ? JSON.parse(raw) : null;
            if (Array.isArray(parsed))
                return parsed.map((v) => (Number(v) > 0 ? Number(v) : 0));
        } catch {
            // no saved sectors
        }
        return [];
    }

    save() {
        try {
            window.localStorage.setItem(
                STORAGE_PREFIX + this.trackKey + this.carId,
                JSON.stringify(this.best)
            );
        } catch {
            // storage full or blocked
        }
    }
}
