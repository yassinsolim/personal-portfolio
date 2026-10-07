// a fast line round the lap: as little curvature as the road's width allows
// (out, in, out), worked out from the track's evenly spaced frames. solved
// coarse to fine, each pass moving every point to where its bend is least
// and keeping it on the asphalt

export type LineFrames = {
    length: number;
    // x, y, z per frame
    framePoints: ArrayLike<number>;
    // horizontal unit tangent x, z per frame
    frameTangents: ArrayLike<number>;
    // road width per frame, m
    frameWidth: ArrayLike<number>;
};

export type RacingLine = {
    count: number;
    // per point, one per track frame
    x: Float32Array;
    y: Float32Array;
    z: Float32Array;
    // off the centre line, positive to the left
    offset: Float32Array;
    // 1/m, positive turning left
    curvature: Float32Array;
    // along the line from the start line, m
    distance: Float32Array;
    length: number;
};

// the car's half width and a little room to the white line
const EDGE_MARGIN = 1.4;
const LEVELS = [16, 8, 4, 2, 1];
const PASSES = [400, 300, 250, 200, 150];
const NEIGHBOURS = [
    [-2, -1],
    [-1, 4],
    [1, 4],
    [2, -1],
] as const;

export const buildRacingLine = (frames: LineFrames): RacingLine => {
    const count = frames.frameWidth.length;
    const points = frames.framePoints;
    const tangents = frames.frameTangents;
    const offset = new Float64Array(count);
    for (let level = 0; level < LEVELS.length; level++) {
        const stride = LEVELS[level];
        const n = Math.floor(count / stride);
        // the coarser level's answer at this level's points
        if (level > 0) {
            const coarse = LEVELS[level - 1];
            for (let i = 0; i < count; i += stride) {
                if (i % coarse === 0) continue;
                const a = Math.floor(i / coarse) * coarse;
                const b = (a + coarse) % count;
                offset[i] = offset[a] + ((offset[b] - offset[a]) * (i - a)) / coarse;
            }
        }
        for (let pass = 0; pass < PASSES[level]; pass++) {
            for (let k = 0; k < n; k++) {
                const i = k * stride;
                const lx = tangents[i * 2 + 1];
                const lz = -tangents[i * 2];
                // where this point puts the bend smallest: the minimum of the
                // squared second differences it's in, (4 (b + c) - (a + d)) / 6
                let tx = 0;
                let tz = 0;
                for (const [step, weight] of NEIGHBOURS) {
                    const j = ((k + step + n) % n) * stride;
                    tx += weight * (points[j * 3] + offset[j] * tangents[j * 2 + 1]);
                    tz += weight * (points[j * 3 + 2] - offset[j] * tangents[j * 2]);
                }
                const along = (tx / 6 - points[i * 3]) * lx + (tz / 6 - points[i * 3 + 2]) * lz;
                const room = Math.max(0, frames.frameWidth[i] / 2 - EDGE_MARGIN);
                offset[i] = Math.min(room, Math.max(-room, along));
            }
        }
    }

    const line: RacingLine = {
        count,
        x: new Float32Array(count),
        y: new Float32Array(count),
        z: new Float32Array(count),
        offset: new Float32Array(count),
        curvature: new Float32Array(count),
        distance: new Float32Array(count),
        length: 0,
    };
    for (let i = 0; i < count; i++) {
        line.x[i] = points[i * 3] + offset[i] * tangents[i * 2 + 1];
        line.y[i] = points[i * 3 + 1];
        line.z[i] = points[i * 3 + 2] - offset[i] * tangents[i * 2];
        line.offset[i] = offset[i];
    }
    let distance = 0;
    for (let i = 0; i < count; i++) {
        line.distance[i] = distance;
        const j = (i + 1) % count;
        distance += Math.hypot(line.x[j] - line.x[i], line.z[j] - line.z[i]);
    }
    line.length = distance;
    // heading change over about 10 m either side
    const span = Math.max(1, Math.round((10 / frames.length) * count));
    for (let i = 0; i < count; i++) {
        const a = (i - span + count) % count;
        const b = (i + span) % count;
        const a2 = (a + 1) % count;
        const b2 = (b - 1 + count) % count;
        const headingA = Math.atan2(line.x[a2] - line.x[a], line.z[a2] - line.z[a]);
        const headingB = Math.atan2(line.x[b] - line.x[b2], line.z[b] - line.z[b2]);
        let turn = headingB - headingA;
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        let along = line.distance[b] - line.distance[a];
        if (along <= 0) along += line.length;
        line.curvature[i] = turn / Math.max(1, along);
    }
    return line;
};
