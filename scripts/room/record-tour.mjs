// records a homepage tour for review: a first visit (fresh profile), the idle
// view, the desk view, each screen focused by a click and left with esc, then
// the car click into the race. real time (playwright's video), headed.
//
//   node scripts/room/record-tour.mjs --url http://192.168.1.166:8531/ --out ~/Assets/portfolio-room/v2/tour [--os http://192.168.1.166:3100] [--tier low]
//
// writes tour.webm, tour.mp4 (ffmpeg) and a few stills
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i < 0 ? fallback : args[i + 1];
};
const url = new URL(opt('url', 'http://192.168.1.166:8531/'));
url.searchParams.set('raceDebug', '1');
url.searchParams.set('mpmock', '1');
if (opt('tier')) url.searchParams.set('raceTier', opt('tier'));
// a local yassinOS for m1 (lan ip), e.g. the embed bridge's branch before it deploys
if (opt('os')) url.searchParams.set('os', opt('os'));
const out = path.resolve(opt('out', '').replace(/^~/, os.homedir()) || '.tmp-validation/tour');
const width = 1512;
const height = 900;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const findChromium = () => {
    const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
    const dirs = fs.existsSync(cache) ? fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)) : [];
    dirs.sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const dir of dirs) {
        const exe = path.join(cache, dir, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
        if (fs.existsSync(exe)) return exe;
    }
    return undefined;
};

const browser = await chromium.launch({
    headless: false,
    executablePath: findChromium(),
    args: ['--use-angle=metal', '--ignore-gpu-blocklist', `--window-size=${width},${height + 100}`],
});
const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    recordVideo: { dir: out, size: { width, height } },
});
await context.addInitScript(() => {
    document.addEventListener('loadingScreenDone', () => (window.__loaded = true));
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
let still = 0;
const shot = (name) => page.screenshot({ path: path.join(out, `${String(still++).padStart(2, '0')}_${name}.png`) });

// a point on screen for a screen's centre, or the car
const at = (what) =>
    page.evaluate((what) => {
        const A = window.Application;
        let p;
        if (what === 'car') {
            const car = A.world.car.model;
            p = car.position.clone();
            p.y += 1300;
        } else p = A.world.screens.screens[what].pose.center.clone();
        p.project(A.camera.instance);
        return { x: ((p.x + 1) / 2) * innerWidth, y: ((1 - p.y) / 2) * innerHeight };
    }, what);

const glide = async (to, steps = 18) => {
    const from = await page.evaluate(() => window.__mouse || { x: innerWidth / 2, y: innerHeight / 2 });
    for (let i = 1; i <= steps; i++) {
        const x = from.x + ((to.x - from.x) * i) / steps;
        const y = from.y + ((to.y - from.y) * i) / steps;
        await page.mouse.move(x, y);
        await sleep(16);
    }
    await page.evaluate((p) => (window.__mouse = p), to);
};

await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 240000 });
await page.waitForFunction(() => window.__loaded, null, { timeout: 300000 });
await sleep(4500);
await shot('idle');
// the desk view
await glide({ x: width * 0.85, y: height * 0.9 });
await page.mouse.click(width * 0.85, height * 0.9);
await sleep(2200);
await shot('desk');
for (const id of ['m2', 'm3', 'm1']) {
    const p = await at(id);
    await glide(p);
    await sleep(500);
    await page.mouse.click(p.x, p.y);
    await sleep(2400);
    await shot(`focus_${id}`);
    await page.keyboard.press('Escape');
    await sleep(1600);
}
// the pc, with its spec card
await page.evaluate(() => window.Application.world.screens.focus('pc'));
await sleep(2600);
await shot('focus_pc');
await page.keyboard.press('Escape');
await sleep(1600);
// the flipper zero, zoomed in by its own focus
await page.evaluate(() => window.Application.world.flipper?.focus());
await sleep(3500);
await shot('focus_flipper');
await page.keyboard.press('Escape');
await sleep(1600);
// back to idle, then the car
await page.keyboard.press('Escape');
await sleep(2500);
const car = await at('car');
await glide(car, 24);
await sleep(1200);
await page.mouse.click(car.x, car.y);
await page.waitForFunction(() => window.Application.world.raceManager?.active, null, { timeout: 60000 });
await sleep(7000);
await shot('race');
const video = await page.video().path();
await context.close();
await browser.close();

const webm = path.join(out, 'tour.webm');
fs.renameSync(video, webm);
try {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', path.join(out, 'tour.mp4')]);
} catch (error) {
    console.error('[tour] ffmpeg failed', String(error).slice(0, 200));
}
console.log('[tour]', JSON.stringify({ out, errors }));
