// what a stored lap shows on its own: where and how fast the car was at any
// moment, its top speed, how far it went, and its line for a map. samples are
// sorted by t (ms), x and z in meters. a recorded lap ends on a copy of its
// first pose (GhostReplay.finalizeRecording), so the last real sample is the
// one before it

type Sample = { t: number; x: number; z: number };
type Point = { x: number; z: number };

// over this long, so a few cm of jitter between samples isn't speed
const SPEED_WINDOW_MS = 500;

// the last sample at or before t
export const indexAt = (samples: Sample[], t: number) => {
    let lo = 0;
    let hi = samples.length - 1;
    if (hi <= 0 || t <= samples[0].t) return 0;
    if (t >= samples[hi].t) return hi;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (samples[mid].t <= t) lo = mid;
        else hi = mid;
    }
    return lo;
};

// the last real sample's time: playback and speeds stop there
export const realEndMs = (samples: Sample[]) =>
    samples.length > 2 ? samples[samples.length - 2].t : samples[samples.length - 1]?.t || 0;

export const pointAt = (samples: Sample[], t: number, out: Point = { x: 0, z: 0 }) => {
    const i = indexAt(samples, t);
    const a = samples[i];
    const b = samples[Math.min(i + 1, samples.length - 1)];
    if (!a) return out;
    const span = b.t - a.t;
    const k = span > 0 ? Math.min(1, Math.max(0, (t - a.t) / span)) : 0;
    out.x = a.x + (b.x - a.x) * k;
    out.z = a.z + (b.z - a.z) * k;
    return out;
};

const from: Point = { x: 0, z: 0 };
const to: Point = { x: 0, z: 0 };

// m/s around t, inside the real lap
export const speedAt = (samples: Sample[], t: number) => {
    const end = realEndMs(samples);
    if (end <= 0) return 0;
    const start = Math.min(Math.max(0, t - SPEED_WINDOW_MS / 2), Math.max(0, end - SPEED_WINDOW_MS));
    const stop = Math.min(end, start + SPEED_WINDOW_MS);
    if (stop <= start) return 0;
    pointAt(samples, start, from);
    pointAt(samples, stop, to);
    return Math.hypot(to.x - from.x, to.z - from.z) / ((stop - start) / 1000);
};

export type ReplaySummary = {
    topKph: number;
    distanceM: number;
    // the line, thinned, as [x, z] in whole meters
    path: Array<[number, number]>;
};

export const summarizeReplay = (samples: Sample[], points = 240): ReplaySummary => {
    const last = samples.length - 2;
    let distanceM = 0;
    for (let i = 1; i <= last; i++) {
        distanceM += Math.hypot(samples[i].x - samples[i - 1].x, samples[i].z - samples[i - 1].z);
    }
    let top = 0;
    const end = realEndMs(samples);
    for (let t = 0; t + SPEED_WINDOW_MS <= end; t += SPEED_WINDOW_MS / 4) {
        top = Math.max(top, speedAt(samples, t + SPEED_WINDOW_MS / 2));
    }
    const path: Array<[number, number]> = [];
    const step = Math.max(1, Math.ceil((last + 1) / points));
    for (let i = 0; i <= last; i += step) {
        path.push([Math.round(samples[i].x), Math.round(samples[i].z)]);
    }
    if (last > 0 && (last % step) !== 0) {
        path.push([Math.round(samples[last].x), Math.round(samples[last].z)]);
    }
    return { topKph: Math.round(top * 3.6), distanceM: Math.round(distanceM), path };
};
