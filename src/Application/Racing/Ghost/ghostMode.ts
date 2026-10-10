import { carOptionsById } from '../../carOptions';
import { SEASON_TAG } from '../Leaderboard/season';

// which ghost races you on the ring: none, your own best lap, the lap on the
// board just faster than your best with this car (a rival), the record, or a
// board lap picked from its card
export type GhostMode = 'off' | 'best' | 'rival' | 'record' | 'lap';

// what the menu always offers, the picked lap joins them once there is one
export const GHOST_MODES: GhostMode[] = ['off', 'best', 'rival', 'record'];

export type GhostPick = { id: string; name: string; lapTimeMs: number; carId: string };

const STORAGE_KEY = 'yassinverse:nordschleife:ghostMode:v1';
// another season's laps aren't comparable, so the pick is per season
const PICK_KEY = `yassinverse:nordschleife:ghostLap${SEASON_TAG}`;

export const sanitizeGhostPick = (raw: unknown): GhostPick | null => {
    const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<GhostPick>;
    const id = String(source.id || '');
    const lapTimeMs = Math.floor(Number(source.lapTimeMs));
    const carId = String(source.carId || '');
    if (!/^[0-9a-z-]{1,80}$/i.test(id) || !carOptionsById[carId]) return null;
    if (!(lapTimeMs >= 1000 && lapTimeMs <= 7_200_000)) return null;
    const name =
        Array.from(String(source.name || ''))
            .filter((character) => !/[\u0000-\u001F\u007F-\u009F]/.test(character))
            .slice(0, 16)
            .join('')
            .trim() || 'Driver';
    return { id, name, lapTimeMs, carId };
};

export const readGhostPick = (): GhostPick | null => {
    try {
        return sanitizeGhostPick(JSON.parse(window.localStorage.getItem(PICK_KEY) || 'null'));
    } catch {
        return null;
    }
};

export const writeGhostPick = (pick: GhostPick) => {
    try {
        window.localStorage.setItem(PICK_KEY, JSON.stringify(pick));
    } catch {
        // storage blocked, the pick lasts until a reload
    }
};

// ?ghostReplay still turns the record on when nothing's been picked
export const readGhostMode = (): GhostMode => {
    try {
        const stored = window.localStorage.getItem(STORAGE_KEY) as GhostMode;
        if (GHOST_MODES.includes(stored)) return stored;
        if (stored === 'lap' && readGhostPick()) return stored;
    } catch {
        // storage blocked, the default stands
    }
    return new URLSearchParams(window.location.search).has('ghostReplay')
        ? 'record'
        : 'off';
};

export const writeGhostMode = (mode: GhostMode) => {
    try {
        window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
        // storage blocked, the choice lasts until a reload
    }
};
