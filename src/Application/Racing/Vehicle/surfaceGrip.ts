import type { TrackSurface } from '../Track/NordschleifeTrack';

// grip and rolling drag per surface. kerbs lose a little. grass is slippery,
// soft and uneven, so running wide costs more than lifting would have
export const SURFACE_GRIP: Record<TrackSurface, number> = {
    asphalt: 1,
    kerb: 0.9,
    grass: 0.38,
    off: 0.3,
};
export const SURFACE_DRAG: Record<TrackSurface, number> = {
    asphalt: 0,
    kerb: 0.004,
    grass: 0.28,
    off: 0.35,
};

// clumps, ruts and soft spots: grass grip under a wheel runs from 0.7 to 1.2
// of its average across a few meters, smoothly, so the car squirms on it
const PATCH_SIZE = 2.5;

const hash = (x: number, z: number) => {
    const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
    return s - Math.floor(s);
};

const smooth = (t: number) => t * t * (3 - 2 * t);

export const grassPatch = (x: number, z: number) => {
    const gx = x / PATCH_SIZE;
    const gz = z / PATCH_SIZE;
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = smooth(gx - ix);
    const fz = smooth(gz - iz);
    const a = hash(ix, iz);
    const b = hash(ix + 1, iz);
    const c = hash(ix, iz + 1);
    const d = hash(ix + 1, iz + 1);
    return 0.7 + 0.5 * (a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz);
};
