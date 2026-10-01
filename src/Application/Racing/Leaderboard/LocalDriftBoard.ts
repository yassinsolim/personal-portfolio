import { randomInt } from '../../Utils/Random';

export type DriftEntry = {
    id: string;
    name: string;
    score: number;
    lapTimeMs: number;
    carId: string;
    createdAt: string;
    source: 'local' | 'remote';
};

const STORAGE_KEY = 'yassinverse:driftpark:scores:v1';

// the drift park's runs on this device, best score first
export default class LocalDriftBoard {
    entries: DriftEntry[];

    constructor() {
        this.entries = this.read();
    }

    read(): DriftEntry[] {
        if (typeof window === 'undefined') return [];
        try {
            const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
            if (!Array.isArray(parsed)) return [];
            return parsed
                .filter(
                    (entry: DriftEntry) =>
                        entry &&
                        typeof entry.name === 'string' &&
                        Number.isFinite(entry.score) &&
                        Number.isFinite(entry.lapTimeMs)
                )
                .sort(byScore);
        } catch {
            return [];
        }
    }

    write() {
        if (typeof window === 'undefined') return;
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries));
        } catch {
            // storage can be full or blocked, the run just isn't kept
        }
    }

    getTop(limit = 10) {
        return this.entries.slice(0, limit);
    }

    add(entry: Omit<DriftEntry, 'id' | 'createdAt' | 'source'>) {
        const next: DriftEntry = {
            id: `local-${Date.now()}-${randomInt(10001)}`,
            createdAt: new Date().toISOString(),
            source: 'local',
            ...entry,
        };
        this.entries.push(next);
        this.entries.sort(byScore);
        this.entries = this.entries.slice(0, 64);
        this.write();
        return next;
    }
}

// higher score first, the quicker lap on a tie
export const byScore = (a: DriftEntry, b: DriftEntry) =>
    b.score - a.score || a.lapTimeMs - b.lapTimeMs;
