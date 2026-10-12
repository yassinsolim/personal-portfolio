import type { LapStanding } from './LeaderboardService';

// what RaceManager sends once a lap is in (race:lapResult)
export type LapResult = {
    id: string;
    lapTimeMs: number;
    board: 'stock' | 'tuned';
    // the board has it (not only this device)
    saved: boolean;
    // the board could be reached
    online: boolean;
    standing: LapStanding | null;
};

export type LapVerdict = {
    tone: 'best' | 'slower' | 'off';
    title: string;
    detail: string;
};

const gap = (ms: number) => (ms / 1000).toFixed(3);

// what the hud says about a lap: a new best or how far off the driver's best
// it was, and where their best is. the tuned board says why, a garage change
// is easy to miss
export const lapVerdict = (result: LapResult, clock: (ms: number) => string): LapVerdict => {
    const { lapTimeMs, board, saved, online, standing } = result;
    const name = board === 'tuned' ? 'Tuned board (your car has garage changes)' : 'Stock board';
    if (!saved) {
        return {
            tone: 'off',
            title: 'Saved on this device only',
            detail: online ? 'The board didn’t take it, try again in a few minutes' : 'The board is offline',
        };
    }
    if (!standing) return { tone: 'off', title: 'Lap sent', detail: `To the ${name}` };
    if (!standing.verified) {
        return {
            tone: 'off',
            title: 'Not on the board',
            detail: 'Its replay didn’t check out as a whole lap of the ring',
        };
    }
    const place = standing.rank ? `#${standing.rank} of ${standing.drivers} on the ${name}` : `On the ${name}`;
    const previous = standing.previousMs;
    if (!previous) return { tone: 'best', title: 'New PB', detail: place };
    if (lapTimeMs < previous) {
        return { tone: 'best', title: `New PB, ${gap(previous - lapTimeMs)} s faster`, detail: place };
    }
    if (lapTimeMs === previous) return { tone: 'slower', title: 'Matched your PB', detail: place };
    return {
        tone: 'slower',
        title: `+${gap(lapTimeMs - previous)} off your PB`,
        detail: `PB ${clock(previous)}, ${place}`,
    };
};
