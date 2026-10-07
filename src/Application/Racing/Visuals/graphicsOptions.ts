import type { PresetSettings } from './qualityPresets';

// the advanced graphics switches. each one only takes something away from the
// preset the render mode picks, so none of them can make a slow machine slower
export const GRAPHICS_OPTIONS = [
    'post',
    'bloom',
    'streaks',
    'aberration',
    'grain',
    'antialias',
    'shadows',
    'trees',
    'sky',
    'trackside',
    'distance',
    'smoke',
    'skids',
    'sparks',
    'shake',
    'speedFov',
] as const;

export type GraphicsOption = (typeof GRAPHICS_OPTIONS)[number];

const KEY = 'yassinverse:graphicsOff:v1';

export const readGraphicsOff = (): GraphicsOption[] => {
    try {
        const parsed = JSON.parse(window.localStorage.getItem(KEY) || '[]');
        return Array.isArray(parsed)
            ? GRAPHICS_OPTIONS.filter((option) => parsed.includes(option))
            : [];
    } catch {
        return [];
    }
};

export const writeGraphicsOff = (off: GraphicsOption[]) => {
    try {
        window.localStorage.setItem(KEY, JSON.stringify(off));
    } catch {
        // not saved, still applies
    }
};

// the preset with what's switched off taken out
export const withGraphicsOff = (
    settings: PresetSettings,
    off: ReadonlySet<GraphicsOption>
): PresetSettings => ({
    ...settings,
    post: settings.post && !off.has('post'),
    bloom: settings.bloom && !off.has('bloom'),
    // one tap is no streak at all
    streakTaps: off.has('streaks') ? 1 : settings.streakTaps,
    aberration: off.has('aberration') ? 0 : settings.aberration,
    grain: off.has('grain') ? 0 : settings.grain,
    msaa: off.has('antialias') ? 0 : settings.msaa,
    shadows: settings.shadows && !off.has('shadows'),
    treeShadowRange: off.has('shadows') ? 0 : settings.treeShadowRange,
    nearTreeRange: off.has('trees') ? 0 : settings.nearTreeRange,
    sky: settings.sky && !off.has('sky'),
    drawDistance: off.has('distance')
        ? Math.min(settings.drawDistance, 1600)
        : settings.drawDistance,
});
