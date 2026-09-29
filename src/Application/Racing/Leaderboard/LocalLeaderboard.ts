import { randomInt } from '../../Utils/Random';

export type LeaderboardEntry = {
    id: string;
    name: string;
    lapTimeMs: number;
    carId: string;
    createdAt: string;
    source: 'local' | 'remote';
    // the garage tune code when the lap was set on a tuned car
    tune?: string;
};

const STORAGE_KEY = 'yassinverse:nordschleife:leaderboard:v6';

export default class LocalLeaderboard {
    entries: LeaderboardEntry[];

    constructor() {
        this.entries = this.read();
    }

    read() {
        if (typeof window === 'undefined') return [];
        try {
            const raw = window.localStorage.getItem(STORAGE_KEY);
            if (!raw) return [];
            const parsed = JSON.parse(raw) as LeaderboardEntry[];
            if (!Array.isArray(parsed)) return [];
            return parsed
                .filter(
                    (entry) =>
                        entry &&
                        typeof entry.name === 'string' &&
                        Number.isFinite(entry.lapTimeMs)
                )
                .sort((a, b) => a.lapTimeMs - b.lapTimeMs);
        } catch {
            return [];
        }
    }

    write() {
        if (typeof window === 'undefined') return;
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries));
        } catch (error) {
            return;
        }
    }

    getTop(limit = 12, board: 'stock' | 'tuned' = 'stock') {
        return this.entries
            .filter((entry) => (board === 'tuned' ? Boolean(entry.tune) : !entry.tune))
            .slice(0, limit);
    }

    add(entry: Omit<LeaderboardEntry, 'id' | 'createdAt' | 'source'>) {
        const next: LeaderboardEntry = {
            id: `local-${Date.now()}-${randomInt(10001)}`,
            createdAt: new Date().toISOString(),
            source: 'local',
            ...entry,
        };

        this.entries.push(next);
        this.entries.sort((a, b) => a.lapTimeMs - b.lapTimeMs);
        this.entries = this.entries.slice(0, 64);
        this.write();
        return next;
    }
}
