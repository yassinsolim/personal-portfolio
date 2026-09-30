import { isMobileDevice } from '../../Utils/Device';
import { classifyGpu, machineHints, readRenderer, type GpuClass } from '../../Utils/gpuClass';

// race graphics presets. auto picks balanced on a capable gpu and performance
// on weak or software ones, and the adaptive resolution still runs on top.
// the budgets are what each preset is tuned to hold during a lap:
//   quality      opt in, full resolution, for fast desktop gpus
//   balanced     p95 frame <= 12 ms on an m5 at 1.5x, <= 260 draws, <= 600k tris
//   performance  no post chain or sun shadows, <= 200 draws, <= 350k tris. on a
//                weak gpu (software gl included) billboards only and 0.75x
export type RacePreset = 'quality' | 'balanced' | 'performance';

export type PresetSettings = {
    maxPixelRatio: number;
    // off: straight to the screen with the renderer's tone map
    post: boolean;
    shadows: boolean;
    msaa: number;
    bloom: boolean;
    streakTaps: number;
    aberration: number;
    grain: number;
    shadowSize: number;
    // how far from the car trees still go into the shadow map, 0 = never
    treeShadowRange: number;
    // real tree geometry out to here, billboards past it
    nearTreeRange: number;
    // camera far plane. the haze already hides everything past about 6 km,
    // shorter than that the fog closes in to hide the far plane
    drawDistance: number;
    // the scattering sky shader, or just the fog color behind everything
    sky: boolean;
};

export const PRESETS: Record<RacePreset, PresetSettings> = {
    quality: {
        maxPixelRatio: Infinity,
        post: true,
        shadows: true,
        msaa: 4,
        bloom: true,
        streakTaps: 10,
        aberration: 0.0012,
        grain: 0.018,
        shadowSize: 2048,
        treeShadowRange: 120,
        nearTreeRange: 190,
        drawDistance: 9000,
        sky: true,
    },
    balanced: {
        maxPixelRatio: 1.5,
        post: true,
        shadows: true,
        msaa: 2,
        bloom: true,
        streakTaps: 6,
        aberration: 0.0012,
        grain: 0.014,
        shadowSize: 2048,
        treeShadowRange: 75,
        nearTreeRange: 120,
        drawDistance: 6000,
        sky: true,
    },
    performance: {
        maxPixelRatio: 1,
        post: false,
        shadows: false,
        msaa: 0,
        bloom: false,
        streakTaps: 1,
        aberration: 0,
        grain: 0,
        shadowSize: 1024,
        treeShadowRange: 0,
        // billboards only, a short view and the fog color for a sky: the
        // light path, whatever the gpu
        nearTreeRange: 0,
        drawDistance: 1600,
        sky: false,
    },
};

// on top of the preset for weak gpus
export const WEAK_GPU_LIMITS = {
    maxPixelRatio: 0.65,
    nearTreeRange: 0,
    drawDistance: 1000,
};

export const settingsFor = (
    preset: RacePreset,
    tier: GpuTier
): PresetSettings => {
    const settings = PRESETS[preset];
    if (tier !== 'low' || preset === 'quality') return settings;
    return {
        ...settings,
        maxPixelRatio: Math.min(
            settings.maxPixelRatio,
            WEAK_GPU_LIMITS.maxPixelRatio
        ),
        nearTreeRange: Math.min(
            settings.nearTreeRange,
            WEAK_GPU_LIMITS.nearTreeRange
        ),
        drawDistance: WEAK_GPU_LIMITS.drawDistance,
        sky: false,
    };
};

export type GpuTier = 'high' | 'low';

// the starting tier, from the renderer string plus cpu and memory hints
// (gpuClass.ts). ?raceTier=low or high forces it, for testing either path
export const detectGpu = (
    gl: WebGLRenderingContext | WebGL2RenderingContext
): GpuClass & { renderer: string; vendor: string; forced: boolean } => {
    const { renderer, vendor } = readRenderer(gl);
    const found = classifyGpu({
        renderer,
        vendor,
        ...machineHints(),
        mobile: isMobileDevice(),
    });
    const forced = new URLSearchParams(window.location.search).get('raceTier');
    if (forced === 'low' || forced === 'high')
        return {
            ...found,
            tier: forced,
            reason: `forced by ?raceTier`,
            renderer,
            vendor,
            forced: true,
        };
    return { ...found, renderer, vendor, forced: false };
};

// a cpu rasterizer: every shader compile takes seconds there
export const isSoftwareGl = (gl: WebGLRenderingContext | WebGL2RenderingContext) => {
    try {
        const info = gl.getExtension('WEBGL_debug_renderer_info');
        const renderer = String(
            info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
        );
        return /swiftshader|llvmpipe|softpipe|software/i.test(renderer);
    } catch {
        return false;
    }
};

export const detectGpuTier = (
    gl: WebGLRenderingContext | WebGL2RenderingContext
): GpuTier => detectGpu(gl).tier;

// render mode (the existing auto / quality / performance switch) to a preset.
// in auto, once the adaptive resolution has to drop below 1x the heavy extras
// go too
export const resolvePreset = (
    mode: 'auto' | 'quality' | 'performance',
    tier: GpuTier,
    effectsLow: boolean
): RacePreset => {
    if (mode === 'quality') return 'quality';
    if (mode === 'performance') return 'performance';
    if (tier === 'low' || effectsLow) return 'performance';
    return 'balanced';
};
