import * as THREE from 'three';

// one canvas atlas for the whole forest so every species shares a material:
// four foliage cards on the left (spruce sprig, beech cluster, birch cluster,
// pine tuft), four bark strips on the right. all drawn here, no image files
export const ATLAS_WIDTH = 2048;
export const ATLAS_HEIGHT = 1024;
const CELL = 512;
const PAD = 10;
const BARK_WIDTH = 256;

export type Species = 'spruce' | 'beech' | 'birch' | 'pine';
export const SPECIES: Species[] = ['spruce', 'beech', 'birch', 'pine'];

export type UvRect = { u0: number; v0: number; u1: number; v1: number };

const foliageOrigin = (index: number) => ({
    x: (index % 2) * CELL,
    y: Math.floor(index / 2) * CELL,
});

// canvas y runs down, uv v runs up (the texture is flipped on upload)
const rect = (x: number, y: number, w: number, h: number): UvRect => ({
    u0: x / ATLAS_WIDTH,
    u1: (x + w) / ATLAS_WIDTH,
    v0: 1 - (y + h) / ATLAS_HEIGHT,
    v1: 1 - y / ATLAS_HEIGHT,
});

export const foliageRect = (species: Species) => {
    const o = foliageOrigin(SPECIES.indexOf(species));
    return rect(o.x + PAD, o.y + PAD, CELL - PAD * 2, CELL - PAD * 2);
};

export const barkRect = (species: Species) => {
    const x = CELL * 2 + SPECIES.indexOf(species) * BARK_WIDTH;
    return rect(x + 4, 4, BARK_WIDTH - 8, ATLAS_HEIGHT - 8);
};

const rng = (seed: number) => {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

const hsl = (h: number, s: number, l: number, a = 1) =>
    `hsla(${h.toFixed(1)}, ${(s * 100).toFixed(1)}%, ${(l * 100).toFixed(
        1
    )}%, ${a})`;

// a spruce branch spray: a main twig along the card, side twigs, and dense
// short needles. the card's u runs along the branch, base at the left
const drawSpruce = (ctx: CanvasRenderingContext2D, ox: number, oy: number) => {
    const random = rng(11);
    const size = CELL - PAD * 2;
    const x0 = ox + PAD;
    const cy = oy + CELL / 2;
    ctx.lineCap = 'round';
    const needleRun = (
        sx: number,
        sy: number,
        ex: number,
        ey: number,
        reach: number,
        count: number
    ) => {
        const dx = ex - sx;
        const dy = ey - sy;
        const length = Math.hypot(dx, dy);
        const nx = -dy / length;
        const ny = dx / length;
        for (let i = 0; i < count; i++) {
            const t = random();
            const px = sx + dx * t;
            const py = sy + dy * t;
            // needles shorten toward the tip and point a little forward
            const reachHere =
                reach * (0.55 + 0.45 * (1 - t)) * (0.7 + random() * 0.5);
            const side = random() < 0.5 ? -1 : 1;
            const forward = 0.25 + random() * 0.35;
            const ex2 = px + (nx * side + (dx / length) * forward) * reachHere;
            const ey2 = py + (ny * side + (dy / length) * forward) * reachHere;
            const young = t > 0.8 && random() < 0.5;
            ctx.strokeStyle = young
                ? hsl(100 + random() * 12, 0.42, 0.34 + random() * 0.08)
                : hsl(
                      128 + random() * 18,
                      0.36 + random() * 0.1,
                      0.12 + random() * 0.1
                  );
            ctx.lineWidth = 3 + random() * 1.8;
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(ex2, ey2);
            ctx.stroke();
        }
    };
    const twigs = 10;
    const runs: [number, number, number, number][] = [];
    for (let i = 0; i < twigs; i++) {
        const t = 0.04 + (i / twigs) * 0.84;
        const bx = x0 + size * t;
        const spread = (1 - t) * 0.4 + 0.1;
        for (const side of [-1, 1]) {
            const ex = bx + size * (0.14 + random() * 0.1);
            const ey = cy + side * size * spread * (0.75 + random() * 0.25);
            runs.push([bx, cy, ex, ey]);
        }
    }
    // a dark core first so the spray stays solid when it's mipmapped down,
    // thin needles alone thin out and get alpha tested away at a distance
    ctx.strokeStyle = hsl(135, 0.35, 0.07);
    runs.forEach(([sx, sy, ex, ey]) => {
        ctx.lineWidth = 26;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + (ex - sx) * 0.85, sy + (ey - sy) * 0.85);
        ctx.stroke();
    });
    ctx.lineWidth = 34;
    ctx.beginPath();
    ctx.moveTo(x0 + 8, cy);
    ctx.lineTo(x0 + size * 0.9, cy);
    ctx.stroke();
    runs.forEach(([sx, sy, ex, ey]) => needleRun(sx, sy, ex, ey, 30, 150));
    needleRun(x0, cy, x0 + size * 0.98, cy, 32, 420);
    ctx.strokeStyle = hsl(24, 0.35, 0.18);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x0, cy);
    ctx.lineTo(x0 + size * 0.95, cy);
    ctx.stroke();
};

// a pointed oval leaf with a midrib
const drawLeaf = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    length: number,
    width: number,
    angle: number,
    fill: string,
    rib: string
) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(
        length * 0.25,
        -width,
        length * 0.75,
        -width * 0.8,
        length,
        0
    );
    ctx.bezierCurveTo(length * 0.75, width * 0.8, length * 0.25, width, 0, 0);
    ctx.fill();
    ctx.strokeStyle = rib;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(length * 0.05, 0);
    ctx.lineTo(length * 0.9, 0);
    ctx.stroke();
    ctx.restore();
};

// a round cluster of leaves on a few twigs, darker leaves at the back
const drawCluster = (
    ctx: CanvasRenderingContext2D,
    ox: number,
    oy: number,
    seed: number,
    options: {
        leaves: number;
        length: [number, number];
        aspect: number;
        hue: [number, number];
        saturation: number;
        lightness: [number, number];
        droop: number;
    }
) => {
    const random = rng(seed);
    const cx = ox + CELL / 2;
    const cy = oy + CELL / 2;
    const radius = CELL / 2 - PAD - 30;
    ctx.lineCap = 'round';
    const twigs: [number, number, number, number][] = [];
    for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + random() * 0.5;
        const reach = radius * (0.6 + random() * 0.35);
        twigs.push([
            cx,
            cy,
            cx + Math.cos(a) * reach,
            cy + Math.sin(a) * reach,
        ]);
    }
    ctx.strokeStyle = hsl(26, 0.3, 0.2);
    ctx.lineWidth = 3;
    twigs.forEach(([sx, sy, ex, ey]) => {
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
    });
    const leaves: {
        x: number;
        y: number;
        a: number;
        l: number;
        depth: number;
    }[] = [];
    for (let i = 0; i < options.leaves; i++) {
        const twig = twigs[Math.floor(random() * twigs.length)];
        const t = 0.25 + random() * 0.75;
        const x = twig[0] + (twig[2] - twig[0]) * t + (random() - 0.5) * 60;
        const y = twig[1] + (twig[3] - twig[1]) * t + (random() - 0.5) * 60;
        const outward = Math.atan2(y - cy, x - cx);
        leaves.push({
            x,
            y,
            a: outward + (random() - 0.5) * 1.6 + options.droop,
            l:
                options.length[0] +
                random() * (options.length[1] - options.length[0]),
            depth: random(),
        });
    }
    leaves.sort((a, b) => a.depth - b.depth);
    leaves.forEach((leaf) => {
        const light =
            options.lightness[0] +
            (options.lightness[1] - options.lightness[0]) * leaf.depth;
        const hue =
            options.hue[0] + random() * (options.hue[1] - options.hue[0]);
        drawLeaf(
            ctx,
            leaf.x,
            leaf.y,
            leaf.l,
            leaf.l * options.aspect,
            leaf.a,
            hsl(hue, options.saturation, light),
            hsl(hue, options.saturation * 0.8, light * 0.72)
        );
    });
};

// pine: bundles of long needles bursting from a few points
const drawPine = (ctx: CanvasRenderingContext2D, ox: number, oy: number) => {
    const random = rng(29);
    const cx = ox + CELL / 2;
    const cy = oy + CELL / 2;
    ctx.lineCap = 'round';
    for (let tuft = 0; tuft < 16; tuft++) {
        const a = random() * Math.PI * 2;
        const r = Math.sqrt(random()) * 150;
        const px = cx + Math.cos(a) * r;
        const py = cy + Math.sin(a) * r * 0.8;
        for (let i = 0; i < 110; i++) {
            const na = random() * Math.PI * 2;
            const length = 60 + random() * 70;
            ctx.strokeStyle = hsl(
                118 + random() * 18,
                0.26,
                0.14 + random() * 0.14
            );
            ctx.lineWidth = 3 + random() * 1.5;
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.quadraticCurveTo(
                px + Math.cos(na) * length * 0.5,
                py + Math.sin(na) * length * 0.5 - 6,
                px + Math.cos(na) * length,
                py + Math.sin(na) * length
            );
            ctx.stroke();
        }
    }
};

const drawBark = (ctx: CanvasRenderingContext2D, species: Species) => {
    const random = rng(71 + SPECIES.indexOf(species));
    const x0 = CELL * 2 + SPECIES.indexOf(species) * BARK_WIDTH;
    const w = BARK_WIDTH;
    const h = ATLAS_HEIGHT;
    const base = {
        spruce: hsl(18, 0.22, 0.25),
        beech: hsl(40, 0.06, 0.5),
        birch: hsl(45, 0.1, 0.84),
        pine: hsl(20, 0.3, 0.3),
    }[species];
    ctx.fillStyle = base;
    ctx.fillRect(x0, 0, w, h);
    if (species === 'pine') {
        // scots pine goes orange up the trunk
        const gradient = ctx.createLinearGradient(0, h, 0, 0);
        gradient.addColorStop(0, 'rgba(60,40,30,0)');
        gradient.addColorStop(0.55, 'rgba(190,105,55,0.35)');
        gradient.addColorStop(1, 'rgba(205,120,65,0.8)');
        ctx.fillStyle = gradient;
        ctx.fillRect(x0, 0, w, h);
    }
    for (let i = 0; i < 900; i++) {
        const x = x0 + random() * w;
        const y = random() * h;
        if (species === 'birch') {
            // dark horizontal lenticels, heavier near the base
            const nearBase = y / h;
            if (random() > 0.35 + nearBase * 0.5) continue;
            ctx.fillStyle = hsl(30, 0.1, 0.08 + random() * 0.12, 0.85);
            ctx.fillRect(
                x,
                y,
                6 + random() * 30,
                2 + random() * 4 * (0.5 + nearBase)
            );
        } else if (species === 'beech') {
            ctx.fillStyle = hsl(40, 0.06, 0.36 + random() * 0.3, 0.25);
            ctx.fillRect(x, y, 2 + random() * 18, 1 + random() * 3);
        } else {
            // plates and furrows
            ctx.fillStyle = hsl(18, 0.2, 0.1 + random() * 0.24, 0.6);
            ctx.fillRect(x, y, 2 + random() * 5, 8 + random() * 30);
        }
    }
};

let atlas: THREE.CanvasTexture | null = null;

export const getFoliageAtlas = () => {
    if (atlas) return atlas;
    const canvas = document.createElement('canvas');
    canvas.width = ATLAS_WIDTH;
    canvas.height = ATLAS_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context for the foliage atlas');
    ctx.clearRect(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT);
    const spruce = foliageOrigin(0);
    drawSpruce(ctx, spruce.x, spruce.y);
    const beech = foliageOrigin(1);
    drawCluster(ctx, beech.x, beech.y, 17, {
        leaves: 150,
        length: [62, 88],
        aspect: 0.36,
        hue: [88, 104],
        saturation: 0.45,
        lightness: [0.14, 0.34],
        droop: 0.3,
    });
    const birch = foliageOrigin(2);
    drawCluster(ctx, birch.x, birch.y, 23, {
        leaves: 170,
        length: [42, 58],
        aspect: 0.42,
        hue: [74, 92],
        saturation: 0.48,
        lightness: [0.2, 0.42],
        droop: 1.1,
    });
    const pine = foliageOrigin(3);
    drawPine(ctx, pine.x, pine.y);
    SPECIES.forEach((species) => drawBark(ctx, species));

    atlas = new THREE.CanvasTexture(canvas);
    atlas.colorSpace = THREE.SRGBColorSpace;
    atlas.anisotropy = 4;
    atlas.generateMipmaps = true;
    atlas.minFilter = THREE.LinearMipmapLinearFilter;
    return atlas;
};
