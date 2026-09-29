// drives the desk flipper in a production build: desk view, hover (lazy load),
// click to zoom in, menus, snake, esc out. prints frame times and the worker's
// firmware load, saves screenshots, and can record a video.
//
//   node scripts/perf/serve-build.mjs --port 8296 &
//   node scripts/flipper-room-check.mjs --url https://192.168.1.166:8296/ [--profile m5|weak]
//     [--shots .tmp-validation/flipper] [--record ~/Assets/flipper] [--out result.json]
//
// weak is the mobile profile of scripts/perf/load-trace.mjs (412x823, dpr 1.75,
// 4x cpu throttle, touch). headless chrome for testing renders on the real gpu,
// and on macos it can't reach 127.0.0.1, so serve on the lan ip.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
};
const url = arg('url', 'https://192.168.1.166:8296/');
const profileName = arg('profile', 'm5');
const shots = arg('shots', '');
const record = arg('record', '');
const out = arg('out', '');
const executablePath =
    process.env.CHROMIUM_PATH ||
    `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

const PROFILES = {
    m5: { viewport: { width: 1280, height: 720 }, dpr: 2, mobile: false, cpu: 1 },
    weak: { viewport: { width: 412, height: 823 }, dpr: 1.75, mobile: true, cpu: 4 },
};
const profile = PROFILES[profileName];
if (shots) fs.mkdirSync(shots, { recursive: true });
if (record) fs.mkdirSync(record, { recursive: true });

const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--host-resolver-rules=MAP *.supabase.co ~NOTFOUND', '--ignore-certificate-errors'],
});
const context = await browser.newContext({
    viewport: profile.viewport,
    deviceScaleFactor: profile.dpr,
    isMobile: profile.mobile,
    hasTouch: profile.mobile,
    ignoreHTTPSErrors: true,
    ...(record ? { recordVideo: { dir: record, size: profile.viewport } } : {}),
});
await context.addInitScript(() => {
    window.__events = [];
    for (const name of ['loadingScreenDone', 'flipper:focus']) {
        document.addEventListener(name, (e) => window.__events.push({ name, t: performance.now(), detail: e.detail }));
    }
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
const cdp = await context.newCDPSession(page);
if (profile.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });

const wait = (ms) => page.waitForTimeout(ms);
const shot = async (name) => shots && page.screenshot({ path: path.join(shots, `${profileName}-${name}.png`) });
const tap = async (key, hold = 110, after = 420) => {
    await page.keyboard.down(key);
    await wait(hold);
    await page.keyboard.up(key);
    await wait(after);
};
// frame times from the renderer's own stats, and the firmware's share of its worker
const sample = async (label, ms = 3000) => {
    // recordings keep the pauses short
    if (record) ms = Math.min(ms, 1200);
    await page.evaluate(() => window.__flipper.application.renderer.frameStats.reset());
    await wait(ms);
    const s = await page.evaluate(() => {
        const f = window.__flipper;
        return { ...f.application.renderer.frameStats.summary(240), workerLoad: f.device.workerLoad, state: f.device.state };
    });
    const row = {
        label,
        frameP50: +s.frameP50.toFixed(2),
        frameP95: +s.frameP95.toFixed(2),
        cpuP50: +s.cpuP50.toFixed(2),
        gpuP50: s.gpuP50 === null ? null : +s.gpuP50.toFixed(2),
        workerLoadPct: +(s.workerLoad * 100).toFixed(2),
        device: s.state,
    };
    console.log(JSON.stringify(row));
    return row;
};

const started = Date.now();
await page.goto(`${url}?handheldDebug=1`, { waitUntil: 'commit', timeout: 120000 });
await page.waitForFunction(() => window.__events?.some((e) => e.name === 'loadingScreenDone'), null, { timeout: 180000 });
await page.waitForFunction(() => window.__flipper, null, { timeout: 60000 });
await wait(3500);

// empty space toggles idle and desk
if (profile.mobile) await page.touchscreen.tap(profile.viewport.width / 2, 40);
else await page.mouse.click(profile.viewport.width / 2, 40);
await wait(1800);
const rows = [];
rows.push(await sample('desk, flipper not loaded'));
await shot('1-desk');

const where = () =>
    page.evaluate(() => {
        const f = window.__flipper;
        const v = f.model.position.clone();
        v.y += 60;
        v.project(f.camera.instance);
        return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
    });

// the desk view follows the mouse, so aim again until the device stops moving
const aim = async () => {
    let point = await where();
    for (let i = 0; i < 6; i++) {
        await page.mouse.move(point.x, point.y, { steps: 8 });
        await wait(500);
        const next = await where();
        const moved = Math.hypot(next.x - point.x, next.y - point.y);
        point = next;
        if (moved < 2) break;
    }
    return point;
};

let bootMs;
if (profile.mobile) {
    // no hover on a phone: the first tap loads it and zooms in
    const point = await where();
    const tapAt = Date.now();
    await page.touchscreen.tap(point.x, point.y);
    await page.waitForFunction(() => window.__flipper.device.state === 'running', null, { timeout: 60000 });
    bootMs = Date.now() - tapAt;
} else {
    const hoverAt = Date.now();
    const point = await aim();
    await page.waitForFunction(() => window.__flipper.device.state === 'running', null, { timeout: 60000 });
    bootMs = Date.now() - hoverAt;
    await wait(1500);
    rows.push(await sample('desk, flipper running'));
    await shot('2-hover');
    const target = await aim();
    await page.mouse.click(target.x, target.y);
}
await wait(1500);
const focused = await page.evaluate(() => window.__flipper.focused);
if (!focused) errors.push('click did not focus the device');
await shot('3-focused');
rows.push(await sample('focused, desktop'));

await tap('Enter', 110, 700); // main menu
await tap('ArrowDown');
await tap('ArrowDown');
await shot('4-menu');
for (let i = 0; i < 3; i++) await tap('ArrowUp'); // nfc, up past the top wraps to apps
await tap('Enter', 110, 1200);
await tap('ArrowDown'); // games
await tap('Enter', 110, 900);
await tap('ArrowDown'); // snake
await tap('Enter', 110, 1400);
await tap('ArrowUp', 90, 800);
await tap('ArrowRight', 90, 600);
await shot('5-snake');
rows.push(await sample('focused, snake', 2500));
await tap('ArrowDown', 90, 1500);
for (let i = 0; i < 4; i++) await tap('Backspace', 110, 350);
await wait(600);
await page.keyboard.press('Escape');
await wait(1600);
await shot('6-back-to-desk');
rows.push(await sample('desk after leaving', 2500));

// settings and dolphin state saved for the next visit
const saved = await page.evaluate(
    () =>
        new Promise((resolve) => {
            const req = indexedDB.open('flipper-wasm-ofw');
            req.onsuccess = () => {
                const keys = req.result.transaction('files').objectStore('files').getAllKeys();
                keys.onsuccess = () => resolve(keys.result);
            };
            req.onerror = () => resolve([]);
        })
);
console.log('saved', JSON.stringify(saved));

const result = { profile: profileName, bootMs, saved, loadMs: Date.now() - started, rows, errors };
console.log(JSON.stringify({ bootMs, errors }, null, 2));
if (out) fs.writeFileSync(out, JSON.stringify(result, null, 2));
const video = page.video();
await context.close();
if (video && record) console.log('video', await video.path());
await browser.close();
