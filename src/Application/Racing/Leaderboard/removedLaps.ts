// laps taken off the board that this device set, kept until the player has
// been told why

export type RemovedLap = {
    lapId: string;
    name: string;
    lapTimeMs: number;
    carId: string;
    tuned: boolean;
    reason: string;
    removedAt: string;
};

const KEY = 'yassinverse:nordschleife:removedLaps';

export const sanitizeRemovedLap = (raw: unknown): RemovedLap | null => {
    const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<RemovedLap>;
    const lapTimeMs = Math.floor(Number(source.lapTimeMs));
    if (typeof source.lapId !== 'string' || !source.lapId || !(lapTimeMs > 0)) return null;
    return {
        lapId: source.lapId.slice(0, 80),
        name: String(source.name || '').slice(0, 16),
        lapTimeMs,
        carId: String(source.carId || '').slice(0, 64),
        tuned: source.tuned === true,
        reason: String(source.reason || '').slice(0, 600),
        removedAt: String(source.removedAt || ''),
    };
};

export const readRemovedNotices = (): RemovedLap[] => {
    try {
        const parsed = JSON.parse(window.localStorage.getItem(KEY) || '[]');
        if (!Array.isArray(parsed)) return [];
        return parsed.map(sanitizeRemovedLap).filter((lap): lap is RemovedLap => Boolean(lap));
    } catch {
        return [];
    }
};

const write = (laps: RemovedLap[]) => {
    try {
        window.localStorage.setItem(KEY, JSON.stringify(laps));
    } catch {
        // storage blocked, the notice is shown this time only
    }
};

export const addRemovedNotices = (laps: RemovedLap[]) => {
    const notices = readRemovedNotices();
    laps.forEach((lap) => {
        if (!notices.some((notice) => notice.lapId === lap.lapId)) notices.push(lap);
    });
    write(notices);
    return notices;
};

export const dismissRemovedNotice = (lapId: string) => {
    const notices = readRemovedNotices().filter((lap) => lap.lapId !== lapId);
    write(notices);
    return notices;
};
