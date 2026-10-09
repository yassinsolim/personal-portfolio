// the site's logo and every icon made from it: favicon.svg, favicon.ico,
// the png favicons, the apple touch icon and the android and maskable icons.
// a white geometric y on a black tile, like the ui's white on black glass.
// renders with the chrome for testing that playwright installed
//
//   node scripts/icons.mjs            writes the icons into static/
//   node scripts/icons.mjs --preview  only writes /tmp/icons-preview.png
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const { chromium } = require('playwright');

// the y in a 512 box: its top, its foot, half the width across the arms' tops,
// the arms' angle from upright and the stroke, the corners rounded by ROUND
const Y = { top: 112, bottom: 400, half: 148, angle: 31, stroke: 74 };
const ROUND = 12;
const CX = 256;

const glyph = ({ top, bottom, half, angle, stroke }, scale = 1) => {
    const slope = Math.tan((angle * Math.PI) / 180);
    // a slanted stroke cut level is wider across than it is thick
    const across = stroke / Math.cos((angle * Math.PI) / 180);
    const outer = CX - half;
    const inner = outer + across;
    const stemLeft = CX - stroke / 2;
    const shoulder = top + (stemLeft - outer) / slope;
    const crotch = top + (CX - inner) / slope;
    // shrunk by the rounding, which grows the outline back out as it rounds
    const inset = ROUND / 2;
    const points = [
        [outer + inset, top + inset],
        [inner - inset, top + inset],
        [CX, crotch + inset * 1.6],
        [2 * CX - inner + inset, top + inset],
        [2 * CX - outer - inset, top + inset],
        [2 * CX - stemLeft - inset, shoulder],
        [2 * CX - stemLeft - inset, bottom - inset],
        [stemLeft + inset, bottom - inset],
        [stemLeft + inset, shoulder],
    ].map(([x, y]) => [CX + (x - CX) * scale, 256 + (y - 256) * scale]);
    const d = points.map(([x, y], i) => `${i ? 'L' : 'M'}${+x.toFixed(1)} ${+y.toFixed(1)}`).join('') + 'Z';
    return `<path d="${d}" fill="#fff" stroke="#fff" stroke-width="${+(ROUND * scale).toFixed(1)}" stroke-linejoin="round"/>`;
};

// tile: rounded with clear corners (favicons, android), full bleed (apple
// rounds its own corners), or full bleed with the y inside the maskable circle
const svg = (tile, scale = 1) => {
    const shape =
        tile === 'rounded'
            ? '<rect width="512" height="512" rx="116" fill="url(#tile)"/><rect x="1.5" y="1.5" width="509" height="509" rx="114.5" fill="none" stroke="#fff" stroke-opacity=".1" stroke-width="3"/>'
            : '<rect width="512" height="512" fill="url(#tile)"/>';
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">' +
        '<defs><linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="#1b1b1e"/><stop offset="1" stop-color="#0b0b0c"/>' +
        '</linearGradient></defs>' +
        shape +
        glyph(Y, scale) +
        '</svg>'
    );
};

const cft = fs
    .readdirSync(`${process.env.HOME}/Library/Caches/ms-playwright`)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort()
    .pop();
const browser = await chromium.launch({
    headless: true,
    executablePath: `${process.env.HOME}/Library/Caches/ms-playwright/${cft}/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
});
const page = await browser.newPage({ deviceScaleFactor: 1 });

const render = async (markup, size) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
        `<html><body style="margin:0;background:transparent">${markup.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`
    );
    return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
};

// a png-in-ico, which every browser since ie 11 reads
const ico = (images) => {
    const header = Buffer.alloc(6 + images.length * 16);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(images.length, 4);
    let offset = header.length;
    images.forEach(({ size, png }, i) => {
        const at = 6 + i * 16;
        header.writeUInt8(size >= 256 ? 0 : size, at);
        header.writeUInt8(size >= 256 ? 0 : size, at + 1);
        header.writeUInt8(0, at + 2);
        header.writeUInt8(0, at + 3);
        header.writeUInt16LE(1, at + 4);
        header.writeUInt16LE(32, at + 6);
        header.writeUInt32LE(png.length, at + 8);
        header.writeUInt32LE(offset, at + 12);
        offset += png.length;
    });
    return Buffer.concat([header, ...images.map(({ png }) => png)]);
};

if (process.argv.includes('--preview')) {
    // big, the apple and maskable crops, then 32 and 16 actual size and blown
    // up without smoothing, on a light and a dark tab strip
    const png = async (markup, size) => (await render(markup, size)).toString('base64');
    const big = await png(svg('rounded'), 160);
    const apple = await png(svg('bleed'), 120);
    const mask = await png(svg('bleed', 0.78), 120);
    const s32 = await png(svg('rounded'), 32);
    const s16 = await png(svg('rounded'), 16);
    const img = (data, width, extra = '') => `<img src="data:image/png;base64,${data}" width="${width}" ${extra}>`;
    const strip = (bg) =>
        `<div style="display:flex;gap:18px;align-items:center;padding:14px;background:${bg}">` +
        img(big, 160) +
        img(apple, 120, 'style="border-radius:27px"') +
        img(mask, 120, 'style="border-radius:50%"') +
        img(s32, 32) +
        img(s16, 16) +
        img(s32, 128, 'style="image-rendering:pixelated"') +
        img(s16, 128, 'style="image-rendering:pixelated"') +
        '</div>';
    await page.setViewportSize({ width: 800, height: 400 });
    await page.setContent(`<body style="margin:0">${strip('#f1f3f4')}${strip('#202124')}</body>`);
    await page.screenshot({ path: '/tmp/icons-preview.png', fullPage: true });
    console.log('wrote /tmp/icons-preview.png');
} else {
    const images = path.join(root, 'static/images');
    fs.writeFileSync(path.join(images, 'favicon.svg'), svg('rounded') + '\n');
    const sizes = {};
    for (const size of [16, 32, 48, 192, 512]) sizes[size] = await render(svg('rounded'), size);
    fs.writeFileSync(path.join(images, 'favicon-16x16.png'), sizes[16]);
    fs.writeFileSync(path.join(images, 'favicon-32x32.png'), sizes[32]);
    fs.writeFileSync(path.join(images, 'android-chrome-192x192.png'), sizes[192]);
    fs.writeFileSync(path.join(images, 'android-chrome-512x512.png'), sizes[512]);
    fs.writeFileSync(path.join(images, 'apple-touch-icon.png'), await render(svg('bleed'), 180));
    fs.writeFileSync(path.join(images, 'maskable-512x512.png'), await render(svg('bleed', 0.78), 512));
    fs.writeFileSync(
        path.join(root, 'static/favicon.ico'),
        ico([16, 32, 48].map((size) => ({ size, png: sizes[size] })))
    );
    console.log('wrote the icons');
}
await browser.close();
