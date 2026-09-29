// what kind of gpu the renderer string names, and the tier auto starts from.
// only a starting guess: the race measures real frame times and steps down
// from there (see RaceVisuals). pure, so scripts/test/gpu-class.test.mjs can
// run every string we know of through it

export type GpuKind =
    | 'software'
    | 'mobile'
    | 'integrated'
    | 'discrete-low'
    | 'discrete'
    | 'apple'
    | 'unknown';

export type GpuHints = {
    renderer: string;
    vendor?: string;
    cores?: number;
    memoryGb?: number;
    mobile?: boolean;
};

export type GpuClass = {
    kind: GpuKind;
    tier: 'high' | 'low';
    reason: string;
};

const SOFTWARE =
    /swiftshader|llvmpipe|softpipe|lavapipe|software|microsoft basic render|mesa offscreen|virgl|vmware svga|parallels/i;
const MOBILE =
    /mali|adreno|powervr|videocore|tegra|apple a\d|samsung xclipse|immortalis/i;
// every intel part is an igpu except the arc a-series cards
const INTEL_DISCRETE = /arc\(tm\) a\d{3}|arc a\d{3}/i;
// ryzen apus say "radeon(tm) graphics", "radeon vega 8 graphics", "radeon
// 780m"; the old ones "radeon r7 graphics"
const AMD_INTEGRATED =
    /radeon(?:\(tm\))? graphics|radeon vega \d* ?graphics|vega \d+ graphics|radeon \d{3}m\b|radeon r[2-7] graphics|radeon hd \d{4}[dg]\b/i;
const NVIDIA_LOW =
    /geforce (?:mx ?\d+|gt ?\d+|\d{3}mx?\b|gtx? ?[4-7]\d0m?\b)|quadro [kmp]\d{3,4}m?\b|quadro nvs|nvidia t[56]00\b/i;
// firefox hands out a few fixed stand ins instead of the real name, the
// same one for every chip of that vendor, so they say nothing about speed
const FIREFOX_GENERIC =
    /^(?:angle \()?(?:intel\(r\) hd graphics(?: 400)?|nvidia geforce gtx 980|radeon r9 200 series|radeon hd 3200 graphics|generic renderer)(?: direct3d11.*| \(.*\))?\)?$/i;

export const classifyGpu = (hints: GpuHints): GpuClass => {
    const renderer = (hints.renderer || '').trim();
    const name = `${hints.vendor || ''} ${renderer}`;
    const cores = hints.cores || 0;
    const memory = hints.memoryGb;
    if (SOFTWARE.test(name))
        return { kind: 'software', tier: 'low', reason: 'software renderer' };
    if (hints.mobile || MOBILE.test(renderer))
        return { kind: 'mobile', tier: 'low', reason: 'mobile gpu' };
    // a small cpu can't feed the full world whatever the gpu is
    if ((cores && cores <= 4) || (memory !== undefined && memory <= 4))
        return {
            kind: 'unknown',
            tier: 'low',
            reason: `${cores || '?'} cores, ${memory ?? '?'} GB`,
        };
    if (!renderer)
        return { kind: 'unknown', tier: 'high', reason: 'no renderer string' };
    if (FIREFOX_GENERIC.test(renderer)) {
        // firefox's intel stand in covers every intel part, all of them igpus
        if (/intel/i.test(renderer) && !INTEL_DISCRETE.test(renderer))
            return {
                kind: 'integrated',
                tier: 'low',
                reason: 'intel graphics (firefox generic name)',
            };
        return {
            kind: 'unknown',
            tier: 'high',
            reason: 'generic name from firefox, measured in the race',
        };
    }
    if (/apple/i.test(renderer) && !/apple a\d/i.test(renderer))
        return { kind: 'apple', tier: 'high', reason: 'apple gpu' };
    if (/intel/i.test(name)) {
        if (INTEL_DISCRETE.test(renderer))
            return { kind: 'discrete', tier: 'high', reason: 'intel arc' };
        return { kind: 'integrated', tier: 'low', reason: 'intel graphics' };
    }
    if (AMD_INTEGRATED.test(renderer))
        return { kind: 'integrated', tier: 'low', reason: 'amd integrated' };
    if (NVIDIA_LOW.test(renderer))
        return {
            kind: 'discrete-low',
            tier: 'low',
            reason: 'entry level nvidia',
        };
    if (/nvidia|geforce|quadro|rtx|radeon|amd|ati /i.test(name))
        return { kind: 'discrete', tier: 'high', reason: 'discrete gpu' };
    return { kind: 'unknown', tier: 'high', reason: 'unrecognized gpu' };
};

// the renderer string, unmasked where the browser allows it
export const readRenderer = (
    gl: WebGLRenderingContext | WebGL2RenderingContext
) => {
    try {
        const info = gl.getExtension('WEBGL_debug_renderer_info');
        return {
            renderer: String(
                info
                    ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL)
                    : gl.getParameter(gl.RENDERER)
            ),
            vendor: String(
                info
                    ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL)
                    : gl.getParameter(gl.VENDOR)
            ),
        };
    } catch {
        return { renderer: '', vendor: '' };
    }
};

// what was measured on this machine, on top of the renderer string
export type Calibration = {
    // the homepage's first seconds after loading
    homeP50?: number;
    homeFrames?: number;
    // a race here fell back to the light limits before
    slowBefore?: boolean;
};

// the homepage is far lighter than the race, so one that can't hold about
// 35 fps means the full race world won't run either
export const HOME_SLOW_MS = 28;
// the window is 6 s, so a machine under 10 fps still gives a dozen frames.
// a hidden tab gives none (no frames are drawn, long gaps are dropped)
const HOME_MIN_FRAMES = 12;

export const calibrate = (found: GpuClass, measured: Calibration): GpuClass => {
    if (found.tier === 'low') return found;
    if (measured.slowBefore)
        return {
            ...found,
            tier: 'low',
            reason: `${found.reason}, but the race ran slow here before`,
        };
    if (
        (measured.homeFrames || 0) >= HOME_MIN_FRAMES &&
        (measured.homeP50 || 0) > HOME_SLOW_MS
    )
        return {
            ...found,
            tier: 'low',
            reason: `${found.reason}, but the homepage ran at ${Math.round(
                1000 / measured.homeP50!
            )} fps`,
        };
    return found;
};

// the renderer that ran slow, kept so the next visit builds the light world
const HINT_KEY = 'yassinverse:gpuSlow';
const HINT_DAYS = 30;

export const readSlowHint = (renderer: string) => {
    try {
        const hint = JSON.parse(localStorage.getItem(HINT_KEY) || 'null');
        return Boolean(
            hint &&
            hint.renderer === renderer &&
            Date.now() - hint.at < HINT_DAYS * 86400000
        );
    } catch {
        return false;
    }
};

export const writeSlowHint = (renderer: string, slow: boolean) => {
    try {
        if (slow)
            localStorage.setItem(
                HINT_KEY,
                JSON.stringify({ renderer, at: Date.now() })
            );
        else localStorage.removeItem(HINT_KEY);
    } catch {
        // private mode, no storage: it just measures again next time
    }
};
