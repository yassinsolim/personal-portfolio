// the driving line assist: off, only where to ease off and brake, or the
// whole line
export type LineMode = 'off' | 'braking' | 'full';

export const LINE_MODES: LineMode[] = ['off', 'braking', 'full'];

const STORAGE_KEY = 'yassinverse:nordschleife:drivingLine:v1';

export const readLineMode = (): LineMode => {
    try {
        const stored = window.localStorage.getItem(STORAGE_KEY) as LineMode;
        if (LINE_MODES.includes(stored)) return stored;
    } catch {
        // storage blocked, the default stands
    }
    return 'off';
};

export const writeLineMode = (mode: LineMode) => {
    try {
        window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
        // storage blocked, the choice lasts until a reload
    }
};
