// which ghost races you on the ring: none, your own best lap, the lap on the
// board just faster than your best with this car (a rival), or the record
export type GhostMode = 'off' | 'best' | 'rival' | 'record';

export const GHOST_MODES: GhostMode[] = ['off', 'best', 'rival', 'record'];

const STORAGE_KEY = 'yassinverse:nordschleife:ghostMode:v1';

// ?ghostReplay still turns the record on when nothing's been picked
export const readGhostMode = (): GhostMode => {
    try {
        const stored = window.localStorage.getItem(STORAGE_KEY) as GhostMode;
        if (GHOST_MODES.includes(stored)) return stored;
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
