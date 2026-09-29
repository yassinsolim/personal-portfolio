import { isLowPowerDevice } from './Device';
import {
    detectGpuTier,
    resolvePreset,
    type GpuTier,
    type RacePreset,
} from '../Racing/Visuals/qualityPresets';

// what the visitor's device says about itself, for the monitor loader's
// hardware check. readRenderer matches the one in the gpu classifier
// (Utils/gpuClass.ts, not on main yet); once that lands, prettyGpu and the
// tier below can come from classifyGpu instead

type NavigatorHints = Navigator & { deviceMemory?: number };

export type HardwareInfo = {
    gpu: string;
    // ANGLE's backend or the plain GL, when the string names it
    api: string;
    renderer: string;
    software: boolean;
    webgl: 1 | 2;
    maxTexture: number;
    compression: string;
    cores: number | null;
    // navigator.deviceMemory: chromium only, rounded and capped at 8
    memoryGb: number | null;
    screen: { width: number; height: number; dpr: number };
    viewport: { width: number; height: number };
    quality: {
        // the render switch, as saved; auto unless the visitor picked one
        mode: 'auto' | 'quality' | 'performance';
        lowPower: boolean;
        textures: '4K' | '2K';
        antialias: boolean;
        startScale: number;
        tier: GpuTier;
        racePreset: RacePreset;
    };
};

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

const SOFTWARE = /swiftshader|llvmpipe|softpipe|lavapipe|software|basic render/i;

const apiOf = (text: string) => {
    if (/metal/i.test(text)) return 'Metal';
    if (/direct3d ?11|d3d11/i.test(text)) return 'Direct3D 11';
    if (/direct3d ?9|d3d9/i.test(text)) return 'Direct3D 9';
    if (/vulkan/i.test(text)) return 'Vulkan';
    if (/opengl es/i.test(text)) return 'OpenGL ES';
    if (/opengl/i.test(text)) return 'OpenGL';
    return '';
};

// "ANGLE (Apple, ANGLE Metal Renderer: Apple M5, Unspecified Version)" to
// "Apple M5", "ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 (0x00002C02)
// Direct3D11 vs_5_0 ps_5_0, D3D11)" to "NVIDIA GeForce RTX 5080"
export const prettyGpu = (renderer: string) => {
    const raw = renderer.trim();
    const angle = /^ANGLE \((.*)\)$/.exec(raw);
    const parts = angle ? angle[1].split(', ') : [raw];
    let name = angle ? parts[1] || parts[0] : raw;
    const api = apiOf(angle ? parts.slice(1).join(' ') : raw);
    if (SOFTWARE.test(raw)) {
        const which = /swiftshader|llvmpipe|softpipe|lavapipe/i.exec(raw);
        return { name: `${which ? which[0] : 'Software'} (software, no GPU)`, api, software: true };
    }
    name = name
        .replace(/^ANGLE \w+ Renderer: /i, '')
        .replace(/\((?:R|TM)\)/gi, '')
        .replace(/\(0x[0-9a-f]+\)/gi, '')
        .replace(/Direct3D\d+.*$/i, '')
        .replace(/vs_\d_\d.*$/i, '')
        .replace(/\/PCIe.*$/i, '')
        .replace(/ OpenGL Engine$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    return { name: name || raw || 'unknown GPU', api, software: false };
};

const compressionOf = (gl: WebGLRenderingContext | WebGL2RenderingContext) => {
    const has = (name: string) => {
        try {
            return Boolean(gl.getExtension(name));
        } catch {
            return false;
        }
    };
    // the order KTX2Loader picks its transcode target in
    if (has('WEBGL_compressed_texture_astc')) return 'ASTC';
    if (has('EXT_texture_compression_bptc')) return 'BC7';
    if (has('WEBGL_compressed_texture_etc')) return 'ETC2';
    if (has('WEBGL_compressed_texture_s3tc')) return 'BC1/BC3';
    if (has('WEBGL_compressed_texture_pvrtc')) return 'PVRTC';
    return 'none (RGBA)';
};

// the same read as App.tsx's getStoredQualityMode
const storedMode = (): HardwareInfo['quality']['mode'] => {
    try {
        const value = window.localStorage.getItem('yassinverse:renderMode');
        if (value === 'auto' || value === 'quality' || value === 'performance') {
            return value;
        }
        return window.localStorage.getItem('yassinverse:qualityMode') === 'performance'
            ? 'performance'
            : 'auto';
    } catch {
        return 'auto';
    }
};

export const readHardware = (
    gl: WebGLRenderingContext | WebGL2RenderingContext
): HardwareInfo => {
    const { renderer } = readRenderer(gl);
    const gpu = prettyGpu(renderer);
    const nav = navigator as NavigatorHints;
    const lowPower = isLowPowerDevice();
    const dpr = window.devicePixelRatio || 1;
    const tier = detectGpuTier(gl);
    const mode = storedMode();
    let maxTexture = 0;
    try {
        maxTexture = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0;
    } catch {
        maxTexture = 0;
    }
    return {
        gpu: gpu.name,
        api: gpu.api,
        renderer,
        software: gpu.software,
        webgl:
            typeof WebGL2RenderingContext !== 'undefined' &&
            gl instanceof WebGL2RenderingContext
                ? 2
                : 1,
        maxTexture,
        compression: compressionOf(gl),
        cores: nav.hardwareConcurrency || null,
        memoryGb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
        screen: {
            width: window.screen?.width || window.innerWidth,
            height: window.screen?.height || window.innerHeight,
            dpr,
        },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        quality: {
            mode,
            lowPower,
            textures: lowPower ? '2K' : '4K',
            antialias: !lowPower,
            // Renderer starts auto here, capped by the screen (Sizes caps at 2)
            startScale: Math.min(lowPower ? 1 : 1.5, Math.min(dpr, 2)),
            tier,
            racePreset: resolvePreset(mode, tier, false),
        },
    };
};

const COMMON_RATES = [24, 30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 180, 240, 360];

// the median animation frame interval over about 30 frames. busy frames
// during loading run long, the median ignores them. null when the page is
// hidden or frames never come
export const measureRefreshRate = (frames = 30, timeoutMs = 4000) =>
    new Promise<number | null>((resolve) => {
        const intervals: number[] = [];
        let last = 0;
        const started = performance.now();
        const step = (now: number) => {
            if (last) intervals.push(now - last);
            last = now;
            if (intervals.length >= frames) {
                const sorted = [...intervals].sort((a, b) => a - b);
                const hz = 1000 / sorted[Math.floor(sorted.length / 2)];
                const near = COMMON_RATES.find((rate) => Math.abs(rate - hz) / rate < 0.04);
                resolve(near ?? Math.round(hz));
                return;
            }
            if (performance.now() - started > timeoutMs) {
                resolve(null);
                return;
            }
            requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    });

export const formatBytes = (bytes: number) => {
    if (bytes < 0) return '?';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};
