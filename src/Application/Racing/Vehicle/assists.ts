import type { AssistSettings } from './VehiclePhysics';

export type AssistPreset = 'standard' | 'sport' | 'off';

type StoredAssists = { preset: AssistPreset; autoGears: boolean };

const STORAGE_KEY = 'yassinverse:nordschleife:assists:v1';

// standard catches slides for you, sport lets the rear out and holds the
// drift at the angle you steer for, off is just you and the tires
export const ASSIST_PRESETS: Record<
    AssistPreset,
    Omit<AssistSettings, 'autoGears'>
> = {
    standard: {
        abs: true,
        tractionControl: true,
        stability: true,
        countersteer: true,
        drift: false,
    },
    sport: {
        abs: true,
        tractionControl: false,
        stability: false,
        countersteer: true,
        drift: true,
    },
    off: {
        abs: false,
        tractionControl: false,
        stability: false,
        countersteer: false,
        drift: false,
    },
};

export const readAssistSettings = (): StoredAssists => {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        const preset =
            parsed && parsed.preset in ASSIST_PRESETS
                ? parsed.preset
                : 'standard';
        return { preset, autoGears: parsed?.autoGears !== false };
    } catch {
        return { preset: 'standard', autoGears: true };
    }
};

export const writeAssistSettings = (settings: StoredAssists) => {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
        // storage can be full or blocked, the setting just won't stick
    }
};
