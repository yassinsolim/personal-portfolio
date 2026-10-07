// the pause menu's steering speed: 1 is the default, about 0.6 the old feel

export const STEERING_KEY = 'yassinverse:nordschleife:steering:v1';
export const STEERING_MIN = 0.6;
export const STEERING_MAX = 1.6;

export const clampSteering = (value: number) =>
    Number.isFinite(value)
        ? Math.min(STEERING_MAX, Math.max(STEERING_MIN, value))
        : 1;

export const readSteering = () => {
    try {
        const stored = window.localStorage.getItem(STEERING_KEY);
        return stored === null ? 1 : clampSteering(Number(stored));
    } catch {
        return 1;
    }
};

// per second for keys and touch: in, back to the middle, and across
export const steerRates = (sensitivity: number) => ({
    rise: 8 * sensitivity,
    release: 9 + 2 * sensitivity,
    reverse: 16 * sensitivity,
});

// the pad stick's curve: lower turns more for the same push
export const stickCurve = (sensitivity: number) =>
    Math.min(1.4, Math.max(0.8, 1.6 - 0.5 * sensitivity));
