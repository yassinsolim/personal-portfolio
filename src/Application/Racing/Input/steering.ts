// the pause menu's steering speed: 1 is the default
export const STEERING_KEY = 'yassinverse:nordschleife:steering:v2';
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

// per second for keys and touch: in, back to the middle, and across. a key
// asks for the car's whole grip, so from town speeds (15 m/s) to 200 km/h
// (55 m/s) it takes twice as long to get there and to swap sides
export const steerRates = (sensitivity: number, speed = 0) => {
    const pace = 1 - 0.5 * Math.min(1, Math.max(0, (speed - 15) / 40));
    return {
        rise: 6 * sensitivity * pace,
        release: 9 + 2 * sensitivity,
        reverse: 12 * sensitivity * pace,
    };
};

// the pad stick's curve: higher keeps the middle of the stick finer
export const stickCurve = (sensitivity: number) =>
    Math.min(1.8, Math.max(1, 2.1 - 0.6 * sensitivity));
