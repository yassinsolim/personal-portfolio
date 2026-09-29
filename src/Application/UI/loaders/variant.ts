// which loading screen runs: ?loader=monitor|terminal|pipeline, today's
// bios screen otherwise. the three are prototypes to pick from
export type LoaderVariant = 'bios' | 'monitor' | 'terminal' | 'pipeline';

let cached: LoaderVariant | null = null;

export const loaderVariant = (): LoaderVariant => {
    if (cached) return cached;
    let value = '';
    try {
        value = new URLSearchParams(window.location.search).get('loader') || '';
    } catch {
        value = '';
    }
    cached =
        value === 'monitor' || value === 'terminal' || value === 'pipeline'
            ? value
            : 'bios';
    return cached;
};

export const prefersReducedMotion = () => {
    try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
        return false;
    }
};

export const isTouchDevice = () => {
    try {
        return window.matchMedia('(pointer: coarse)').matches;
    } catch {
        return false;
    }
};

// a visitor who has watched an intro to the end before gets the short one.
// the loading itself shows whatever is really cached
const SEEN_KEY = 'yassinverse:introSeen';

let returning: boolean | null = null;

export const isReturningVisitor = () => {
    if (returning !== null) return returning;
    try {
        returning = window.localStorage.getItem(SEEN_KEY) === '1';
    } catch {
        returning = false;
    }
    return returning;
};

export const markIntroSeen = () => {
    try {
        window.localStorage.setItem(SEEN_KEY, '1');
    } catch {
        // storage blocked, every visit is a first one
    }
};

// ?debug skips the loading screen, as the bios one does
export const skipIntro = () => {
    try {
        return new URLSearchParams(window.location.search).has('debug');
    } catch {
        return false;
    }
};

// performance marks for the timing harness (scripts/loader-record.mjs)
export const mark = (name: string) => {
    try {
        performance.mark(`loader:${name}`);
    } catch {
        // no user timing
    }
};
