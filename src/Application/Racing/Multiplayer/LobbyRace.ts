// a race in a lobby. the host picks the laps and starts it: everyone in the
// lobby then lines up on the grid in that order, counts down to the same green
// light and races. places come from how far each car has got, the finish from
// the race clock, which runs from the green light
export type RacePhase = 'idle' | 'countdown' | 'racing' | 'finished';

export const RACE_LAPS = [1, 2, 3];
// from the host's click to the green light, time to line up
export const RACE_LEAD_MS = 6000;

export type RaceEntrant = {
    sessionId: string;
    name: string;
    // laps done plus the share of the one going, below 0 before the line
    distance: number;
    // still in the lobby
    present: boolean;
};

export type RaceStanding = RaceEntrant & {
    place: number;
    finishMs: number | null;
};

// how far a car has got, in laps. on the grid behind the line the lap timer
// isn't running and sits near 1, so that reads as just under 0
export const raceDistance = (lapsDone: number, progress: number, running: boolean) =>
    lapsDone + (running || progress < 0.5 ? progress : progress - 1);

export default class LobbyRace {
    phase: RacePhase = 'idle';
    raceId = '';
    laps = 1;
    // the green light, on this device's clock (epoch ms)
    startAt = 0;
    // session ids in grid order
    grid: string[] = [];
    lapsDone = 0;
    // race times of everyone over the line, by session id
    finishes = new Map<string, number>();

    start(raceId: string, laps: number, startAt: number, grid: string[]) {
        this.phase = 'countdown';
        this.raceId = raceId;
        this.laps = laps;
        this.startAt = startAt;
        this.grid = grid.slice();
        this.lapsDone = 0;
        this.finishes.clear();
    }

    end() {
        this.phase = 'idle';
        this.raceId = '';
        this.grid = [];
        this.lapsDone = 0;
        this.finishes.clear();
    }

    // in the race (lined up, racing or done), not just watching it
    entered(sessionId: string) {
        return this.phase !== 'idle' && this.grid.includes(sessionId);
    }

    // seconds to the green light
    countdown(now: number) {
        return Math.max(0, (this.startAt - now) / 1000);
    }

    // true on the frame the light goes green
    tick(now: number) {
        if (this.phase !== 'countdown' || now < this.startAt) return false;
        this.phase = 'racing';
        return true;
    }

    // a lap done by this car: its race time when that was the last one
    completeLap(now: number, sessionId: string) {
        if (this.phase !== 'racing') return null;
        this.lapsDone++;
        if (this.lapsDone < this.laps) return null;
        const time = now - this.startAt;
        this.finishes.set(sessionId, time);
        this.phase = 'finished';
        return time;
    }

    // another car over the line
    finish(sessionId: string, timeMs: number) {
        if (this.phase === 'idle' || !this.grid.includes(sessionId)) return;
        if (!this.finishes.has(sessionId)) this.finishes.set(sessionId, timeMs);
    }

    // finished cars by time, then the rest by how far they've got, then the
    // ones that left. on the grid it's the grid order: cars side by side
    // would swap places on centimetres
    standings(entrants: RaceEntrant[]): RaceStanding[] {
        const rank = (entrant: RaceEntrant) => {
            const finish = this.finishes.get(entrant.sessionId);
            if (finish !== undefined) return [0, finish];
            if (!entrant.present) return [2, 0];
            if (this.phase === 'countdown') return [1, this.grid.indexOf(entrant.sessionId)];
            return [1, -entrant.distance];
        };
        return entrants
            .filter((entrant) => this.grid.includes(entrant.sessionId))
            .map((entrant) => ({ entrant, key: rank(entrant) }))
            .sort(
                (a, b) =>
                    a.key[0] - b.key[0] ||
                    a.key[1] - b.key[1] ||
                    this.grid.indexOf(a.entrant.sessionId) - this.grid.indexOf(b.entrant.sessionId)
            )
            .map(({ entrant }, index) => ({
                ...entrant,
                place: index + 1,
                finishMs: this.finishes.get(entrant.sessionId) ?? null,
            }));
    }
}
