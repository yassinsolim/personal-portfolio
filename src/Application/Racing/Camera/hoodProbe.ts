import * as THREE from 'three';

// the hood cam's spot on a car, from the shape of its body. in the frame of
// the car's pivot: along is forward, up is up
export type HoodSpot = { along: number; up: number };
// the body's top down its middle, a height every step from start (the tail)
export type BodyProfile = {
    length: number;
    start: number;
    step: number;
    heights: number[];
};

const STEP = 0.04;
// the body is cut down the middle and a bit either side, and each spot takes
// the middle of the three heights, so a wiper or a badge on the center line
// doesn't count as the body
const PLANES = [-0.12, 0, 0.12];
// the glass starts where the body first climbs past this share of the roof's
// height (from the ground). every car's hood stays under it
const GLASS_SHARE = 0.8;
// the camera sits this far ahead of the glass, this far above the hood
const GLASS_AHEAD = 0.18;
const ABOVE_HOOD = 0.1;

const shown = (object: THREE.Object3D | null) => {
    for (let node = object; node; node = node.parent) {
        if (!node.visible) return false;
    }
    return true;
};

// the body's top down the middle, every 4 cm: each triangle that crosses a
// cutting plane leaves a line on it, and the highest line wins. a flat panel
// is a couple of big triangles, so vertices alone left gaps
export const bodyProfile = (
    pivot: THREE.Object3D,
    model: THREE.Object3D,
    length: number
): BodyProfile => {
    pivot.updateWorldMatrix(true, false);
    model.updateWorldMatrix(false, true);
    const toPivot = new THREE.Matrix4().copy(pivot.matrixWorld).invert();
    const matrix = new THREE.Matrix4();
    const v = new THREE.Vector3();
    const half = length * 0.6;
    const count = Math.ceil((2 * half) / STEP);
    const tops = PLANES.map(() => new Array<number>(count).fill(-Infinity));
    const mark = (top: number[], z0: number, y0: number, z1: number, y1: number) => {
        if (z0 > z1) {
            [z0, z1] = [z1, z0];
            [y0, y1] = [y1, y0];
        }
        const first = Math.max(0, Math.floor((z0 + half) / STEP));
        const last = Math.min(count - 1, Math.floor((z1 + half) / STEP));
        for (let bin = first; bin <= last; bin++) {
            const z = Math.min(z1, Math.max(z0, -half + (bin + 0.5) * STEP));
            const y = z1 > z0 ? y0 + ((z - z0) / (z1 - z0)) * (y1 - y0) : Math.max(y0, y1);
            if (y > top[bin]) top[bin] = y;
        }
    };
    const cut = [0, 0, 0, 0];
    model.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh || !shown(mesh)) return;
        const geometry = mesh.geometry;
        const position = geometry?.attributes?.position;
        if (!position) return;
        matrix.multiplyMatrices(toPivot, mesh.matrixWorld);
        const p = new Float32Array(position.count * 3);
        for (let i = 0; i < position.count; i++) {
            v.fromBufferAttribute(position, i).applyMatrix4(matrix);
            p[i * 3] = v.x;
            p[i * 3 + 1] = v.y;
            p[i * 3 + 2] = v.z;
        }
        const index = geometry.index?.array;
        const corners = index ? index.length : position.count;
        for (let t = 0; t + 2 < corners; t += 3) {
            const a = (index ? index[t] : t) * 3;
            const b = (index ? index[t + 1] : t + 1) * 3;
            const c = (index ? index[t + 2] : t + 2) * 3;
            const lo = Math.min(p[a], p[b], p[c]);
            const hi = Math.max(p[a], p[b], p[c]);
            if (hi < PLANES[0] || lo > PLANES[PLANES.length - 1]) continue;
            PLANES.forEach((plane, k) => {
                if (lo > plane || hi < plane) return;
                // where two of its edges cross the plane
                let found = 0;
                [[a, b], [b, c], [c, a]].forEach(([u, w]) => {
                    if (found === 2) return;
                    const du = p[u] - plane;
                    const dw = p[w] - plane;
                    if (du * dw > 0 || du === dw) return;
                    const s = du / (du - dw);
                    cut[found * 2] = p[u + 2] + s * (p[w + 2] - p[u + 2]);
                    cut[found * 2 + 1] = p[u + 1] + s * (p[w + 1] - p[u + 1]);
                    found++;
                });
                if (found === 2) mark(tops[k], cut[0], cut[1], cut[2], cut[3]);
            });
        }
    });
    const heights = tops[0].map((_, bin) => {
        const seen = tops.map((top) => top[bin]).filter(Number.isFinite);
        if (!seen.length) return NaN;
        seen.sort((x, y) => x - y);
        return seen.length === 3 ? seen[1] : seen[seen.length - 1];
    });
    return { length, start: -half, step: STEP, heights };
};

// ride is how high the pivot sits over the ground
export const findHood = (
    profile: BodyProfile,
    ride: number
): HoodSpot | null => {
    const { length, start, step, heights: top } = profile;
    const zOf = (i: number) => start + (i + 0.5) * step;
    let nose = -1;
    let roof = -Infinity;
    top.forEach((h, i) => {
        if (!Number.isFinite(h)) return;
        nose = i;
        if (Math.abs(zOf(i)) < length * 0.22) roof = Math.max(roof, h);
    });
    if (nose < 0 || !Number.isFinite(roof)) return null;
    const glass = GLASS_SHARE * (roof + ride) - ride;
    // from past the bumper back to the middle
    for (let i = nose - Math.round((length * 0.12) / step); i >= 0 && zOf(i) > 0; i--) {
        if (!(top[i] >= glass)) continue;
        const along = zOf(i) + GLASS_AHEAD;
        let hood = -Infinity;
        top.forEach((h, k) => {
            if (Math.abs(zOf(k) - along) <= 0.1 && h > hood) hood = h;
        });
        return Number.isFinite(hood) ? { along, up: hood + ABOVE_HOOD } : null;
    }
    return null;
};

export const probeHood = (
    pivot: THREE.Object3D,
    model: THREE.Object3D,
    length: number,
    ride: number
): HoodSpot | null => findHood(bodyProfile(pivot, model, length), ride);
