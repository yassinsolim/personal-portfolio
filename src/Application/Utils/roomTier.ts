import { classifyGpu, readRenderer } from './gpuClass';
import { isLowPowerDevice, isMobileDevice } from './Device';

export type RoomTier = 'high' | 'low';

let cached: RoomTier | null = null;

// which room assets and how much live screen work this machine gets. the
// same classifier as the race's auto tier, read from a throwaway context
// because the room's sources are picked before the renderer exists.
// ?raceTier=low|high forces it, like the race
export const roomTier = (): RoomTier => {
    if (cached) return cached;
    const forced = new URLSearchParams(window.location.search).get('raceTier');
    if (forced === 'low' || forced === 'high') return (cached = forced);
    if (isLowPowerDevice()) return (cached = 'low');
    let tier: RoomTier = 'high';
    try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const gl = canvas.getContext('webgl');
        if (gl) {
            const { renderer, vendor } = readRenderer(gl);
            const nav = navigator as Navigator & { deviceMemory?: number };
            tier = classifyGpu({
                renderer,
                vendor,
                cores: nav.hardwareConcurrency,
                memoryGb: nav.deviceMemory,
                mobile: isMobileDevice(),
            }).tier;
            gl.getExtension('WEBGL_lose_context')?.loseContext();
        }
    } catch {
        // no webgl here: the site shows its own error, the tier doesn't matter
    }
    return (cached = tier);
};
