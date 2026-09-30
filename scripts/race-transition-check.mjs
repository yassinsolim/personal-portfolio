// checks the homepage to race transition hands the keys to the game. from the
// desk view it clicks the car, then skips with a click over the monitor (or a
// key, or not at all), and checks focus isn't in the yassinOS iframe and W
// drives. last, outside race mode, a click focuses the monitor and the next must reach
// the iframe. exits 1 on any failure.
//
//   node scripts/race-transition-check.mjs --url http://192.168.1.166:8190/
//   node scripts/race-transition-check.mjs --url ... --runs 3 --only click
//
// headless chromium on macos can't reach 127.0.0.1, so serve on the lan ip.

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    if (i < 0) return fallback;
    const next = args[i + 1];
    return next === undefined || next.startsWith('--') ? true : next;
};
const url = new URL(opt('url', 'http://127.0.0.1:8190/'));
url.searchParams.set('raceDebug', '1');
const runs = Number(opt('runs', 1));
const modes = opt('only', '') ? [opt('only')] : ['click', 'key', 'none'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const findChromium = () => {
    if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
    const cache = path.join(process.env.HOME || '', 'Library/Caches/ms-playwright');
    if (!fs.existsSync(cache)) return undefined;
    const dirs = fs
        .readdirSync(cache)
        .filter((d) => /^chromium-\d+$/.test(d))
        .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const dir of dirs) {
        const exe = path.join(
            cache,
            dir,
            'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
        );
        if (fs.existsSync(exe)) return exe;
    }
    return undefined;
};

const browser = await chromium.launch({
    headless: Boolean(opt('headless', false)),
    executablePath: findChromium(),
    args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--window-size=1512,990'],
});

const focusState = (page) =>
    page.evaluate(() => {
        const a = document.activeElement;
        return a ? `${a.tagName}${a.id ? '#' + a.id : ''}` : 'none';
    });

// a point over the car where the page shows the pointer cursor
const findCar = async (page) => {
    const c = await page.evaluate(() => {
        const A = window.Application;
        const car = A.world.car.model;
        const V = car.position.constructor;
        const p = new V();
        const lo = new V(Infinity, Infinity, Infinity);
        const hi = new V(-Infinity, -Infinity, -Infinity);
        car.updateMatrixWorld(true);
        car.traverse((o) => {
            if (!o.isMesh || !o.geometry) return;
            o.geometry.computeBoundingBox();
            const b = o.geometry.boundingBox;
            for (const x of [b.min.x, b.max.x])
                for (const y of [b.min.y, b.max.y])
                    for (const z of [b.min.z, b.max.z]) {
                        p.set(x, y, z).applyMatrix4(o.matrixWorld);
                        lo.min(p);
                        hi.max(p);
                    }
        });
        const m = lo.clone().add(hi).multiplyScalar(0.5);
        m.x = m.x * 0.6 + hi.x * 0.4;
        m.project(A.camera.instance);
        return { x: ((m.x + 1) / 2) * innerWidth, y: ((1 - m.y) / 2) * innerHeight };
    });
    for (const [dx, dy] of [[0, 0], [60, 0], [120, 0], [-60, 0], [60, -40], [120, -40], [180, -20], [200, 0], [250, -30], [300, 0], [350, -40]]) {
        await page.mouse.move(c.x + dx, c.y + dy);
        await sleep(250);
        // the screens show a pointer too: it has to be the car's hover
        if (await page.evaluate(() => document.body.style.cursor === 'pointer' && window.Application.world.raceTransition.hovering)) {
            return { x: c.x + dx, y: c.y + dy };
        }
    }
    return null;
};

// the monitor's centre on screen, from the iframe's box
const monitorAt = (page) =>
    page.evaluate(() => {
        const r = document.getElementById('computer-screen')?.getBoundingClientRect();
        return r && r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    });

const results = [];
for (let run = 0; run < runs; run++) {
    for (const mode of modes) {
        const page = await browser.newPage({ viewport: { width: 1512, height: 900 } });
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
        await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 180000 });
        await page.waitForFunction(() => Boolean(window.Application?.world?.car?.model), null, { timeout: 240000 });
        await sleep(2500);
        // sweep the mouse over the room, which settles the camera in the desk view
        for (let i = 0; i < 40; i++) {
            await page.mouse.move(300 + (i % 10) * 90, 250 + (i % 4) * 90);
            await sleep(100);
        }
        await sleep(2500);
        const car = await findCar(page);
        const monitor = await monitorAt(page);
        const r = { run, mode, hover: Boolean(car), errors };
        if (!car) {
            results.push({ ...r, pass: false });
            await page.close();
            continue;
        }
        await page.mouse.move(car.x, car.y);
        await page.mouse.down();
        await page.mouse.up();
        await sleep(350);
        if (mode === 'click') {
            const at = monitor || { x: 756, y: 400 };
            r.skipOver = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName || null, [at.x, at.y]);
            await page.mouse.click(at.x, at.y);
        } else if (mode === 'key') {
            await page.keyboard.press('Space');
        }
        await page.waitForFunction(() => window.Application.world.raceManager?.active, null, { timeout: 30000 });
        // past the reveal, and past the lobby card if a later build shows one
        await sleep(mode === 'none' ? 5000 : 1500);
        await page.keyboard.press('Digit1');
        await sleep(300);
        r.focus = await focusState(page);
        await page.keyboard.down('KeyW');
        await sleep(2000);
        await page.keyboard.up('KeyW');
        r.kph = await page.evaluate(() => Math.round(window.Application.world.raceManager.vehicle.getTelemetry().speedKph));
        r.pass = r.focus !== 'IFRAME#computer-screen' && r.kph > 20 && errors.length === 0;
        results.push(r);
        console.log('[transition-check]', JSON.stringify(r));
        await page.close();
    }
}

// outside race mode the monitor still takes clicks: the iframe gets focus
{
    const page = await browser.newPage({ viewport: { width: 1512, height: 900 } });
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 180000 });
    await page.waitForFunction(() => Boolean(window.Application?.world?.car?.model), null, { timeout: 240000 });
    await sleep(2500);
    for (let i = 0; i < 40; i++) {
        await page.mouse.move(300 + (i % 10) * 90, 250 + (i % 4) * 90);
        await sleep(100);
    }
    await sleep(2500);
    const monitor = await monitorAt(page);
    const r = { mode: 'desk-monitor' };
    if (monitor) {
        // the first click focuses the screen (the camera glides in), then
        // the iframe takes the pointer and the next click lands in it
        await page.mouse.move(monitor.x, monitor.y);
        await sleep(300);
        r.idlePointerEvents = await page.evaluate(() => getComputedStyle(document.getElementById('computer-screen')).pointerEvents);
        await page.mouse.click(monitor.x, monitor.y);
        await sleep(1800);
        const focused = await monitorAt(page);
        r.pointerEvents = await page.evaluate(() => getComputedStyle(document.getElementById('computer-screen')).pointerEvents);
        await page.mouse.click(focused.x, focused.y);
        await sleep(800);
        r.focus = await focusState(page);
    }
    r.pass = r.focus === 'IFRAME#computer-screen' && r.pointerEvents === 'auto' && r.idlePointerEvents === 'none';
    results.push(r);
    console.log('[transition-check]', JSON.stringify(r));
    await page.close();
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`[transition-check] ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
