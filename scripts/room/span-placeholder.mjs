// stand-ins for the room's shared wallpaper and theme until yassinOS's real
// ones (public/embed/room-span.webp and room-theme.json there) are copied in:
//   static/textures/room/room-span.webp  one image across the three screens
//   static/textures/room/room-theme.json yassinOS's dark theme tokens, the
//                                        image and each screen's rect in it
// the image is black with a few soft grey blue light ribbons sweeping across
// the three screens (a still take on yassinOS's grey vanta waves), so the
// screens stay true black wherever it's dark
//
//   node scripts/room/span-placeholder.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
);
const outDir = path.join(root, 'static/textures/room');

// 3 px per mm of the three screens' real layout (976 x 705 mm)
const W = 2929;
const H = 2116;
// normalised x, y, w, h of each screen in the image
const RECTS = {
    m2: [0, 0, 0.6111, 0.4759],
    m1: [0, 0.5241, 0.6111, 0.4759],
    m3: [0.6562, 0.0799, 0.3438, 0.8459],
};

const theme = {
    note: 'placeholder from yassinOS styles/defaultTheme, replaced by the real room-theme.json',
    name: 'Dark',
    accent: 'hsla(207, 100%, 72%, 90%)',
    accentStrong: 'hsla(207, 100%, 45%, 90%)',
    background: '#000',
    text: 'rgba(255, 255, 255, 90%)',
    textMuted: 'rgb(170, 170, 170)',
    fontUi: "'Segoe UI', system-ui, Roboto, 'Helvetica Neue', sans-serif",
    fontMono: "Consolas, 'Lucida Console', 'Courier New', monospace",
    radius: 0,
    titleBar: 'rgb(0, 0, 0)',
    outline: 'hsla(0, 0%, 25%, 75%)',
    terminalText: 'rgb(204, 204, 204)',
    spanImage: 'room-span.webp',
    spanSize: [W, H],
    rects: RECTS,
};

const smooth = (edge0, edge1, x) => {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
};

// ribbons from the bottom left up to the right: centre line y = base + slope
// * x + a wave, a wide soft glow and a thin bright core. x runs 0 to the
// image's aspect, y 0 to 1, so distances are the same both ways
const RIBBONS = [
    {
        base: 0.92,
        slope: -0.62,
        amp: 0.05,
        freq: 2.4,
        phase: 0.4,
        width: 0.05,
        core: 0.006,
        glow: 0.1,
        bright: 0.26,
    },
    {
        base: 1.04,
        slope: -0.6,
        amp: 0.06,
        freq: 1.9,
        phase: 2.2,
        width: 0.08,
        core: 0.009,
        glow: 0.07,
        bright: 0.16,
    },
    {
        base: 0.76,
        slope: -0.64,
        amp: 0.045,
        freq: 3.1,
        phase: 1.1,
        width: 0.035,
        core: 0.004,
        glow: 0.06,
        bright: 0.2,
    },
    {
        base: 1.2,
        slope: -0.58,
        amp: 0.04,
        freq: 1.5,
        phase: 4.0,
        width: 0.14,
        core: 0.02,
        glow: 0.05,
        bright: 0.07,
    },
];

const aspect = W / H;
const ribbonLight = (x, y) => {
    let lum = 0;
    let blue = 0;
    for (const r of RIBBONS) {
        const centre =
            r.base + r.slope * x + r.amp * Math.sin(r.freq * x + r.phase);
        const tangent =
            r.slope + r.amp * r.freq * Math.cos(r.freq * x + r.phase);
        const d = (y - centre) / Math.sqrt(1 + tangent * tangent);
        // brighter and darker stretches along each ribbon
        const along = 0.55 + 0.45 * Math.sin(1.3 * x + r.phase * 1.7);
        lum +=
            along *
            (r.glow * Math.exp(-(d * d) / (2 * r.width * r.width)) +
                r.bright * Math.exp(-(d * d) / (2 * r.core * r.core)));
        blue +=
            along * r.glow * Math.exp(-(d * d) / (2 * (r.width * 2.2) ** 2));
    }
    return [lum, blue];
};

const pixels = Buffer.alloc(W * H * 3);
let seed = 1;
// cheap deterministic noise for dithering, so the gradients don't band
const noise = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
};

for (let py = 0; py < H; py++) {
    const v = py / H;
    for (let px = 0; px < W; px++) {
        const u = px / W;
        const [ribbon, blue] = ribbonLight(u * aspect, v);
        // fades out toward the top left (m2's clock sits there) and the far
        // corners, so the light stays around the middle of the setup
        const fade =
            smooth(0.05, 0.55, u * 0.8 + v * 0.7) *
            smooth(1.25, 0.8, u * 0.5 + v * 0.75);
        const lum = ribbon * fade;
        const tint = blue * fade * 0.35;
        const r = lum * 0.78;
        const g = lum * 0.86 + tint * 0.35;
        const b = lum * 1.0 + tint;
        const i = (py * W + px) * 3;
        const dither = noise() - noise();
        pixels[i] = Math.max(
            0,
            Math.min(255, Math.round(r * 255 + dither * 0.6))
        );
        pixels[i + 1] = Math.max(
            0,
            Math.min(255, Math.round(g * 255 + dither * 0.6))
        );
        pixels[i + 2] = Math.max(
            0,
            Math.min(255, Math.round(b * 255 + dither * 0.6))
        );
    }
}

fs.mkdirSync(outDir, { recursive: true });
const imagePath = path.join(outDir, 'room-span.webp');
await sharp(pixels, { raw: { width: W, height: H, channels: 3 } })
    .webp({ quality: 82, effort: 6, smartSubsample: true })
    .toFile(imagePath);
fs.writeFileSync(
    path.join(outDir, 'room-theme.json'),
    `${JSON.stringify(theme, null, 2)}\n`
);

const bytes = fs.statSync(imagePath).size;
console.log(
    `[span-placeholder] ${path.relative(root, imagePath)} ${W}x${H}, ${Math.round(bytes / 1024)} KB`
);
if (bytes > 300 * 1024) {
    console.error('[span-placeholder] over the 300 KB budget');
    process.exit(1);
}
