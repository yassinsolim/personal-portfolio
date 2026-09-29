// homepage frame times per camera state (idle, desk, each focused screen) for
// one or more builds, interleaved so a busy machine hits them alike.
//
//   node scripts/room/room-perf.mjs --build v2=http://192.168.1.166:8531/ --build main=http://192.168.1.166:8532/ --runs 3
//   ... --weak   (raceTier=low, 4x cpu throttle, 1536x864 at 1.25)
//   ... --swgl   (software gl, the worst case)   --throttle <n> (cpu throttle, default 4 with --weak)
//
// real time, headed, on the real gpu. prints a table and writes json to --out
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
const builds = [];
args.forEach((arg, i) => {
    if (arg === '--build') {
        const [label, url] = args[i + 1].split('=');
        builds.push({ label, url });
    }
});
const runs = Number(opt('runs', 2));
const weak = Boolean(opt('weak', false));
const swgl = Boolean(opt('swgl', false));
const throttle = Number(opt('throttle', weak ? 4 : 1));
const measureMs = Number(opt('ms', 4000));
const out = path.resolve(opt('out', '.tmp-validation/room-perf.json'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const findChromium = () => {
    const cache = path.join(process.env.HOME || '', 'Library/Caches/ms-playwright');
    if (!fs.existsSync(cache)) return undefined;
    const dirs = fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d));
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
    args: [swgl ? '--use-angle=swiftshader' : '--use-angle=metal', '--ignore-gpu-blocklist', '--window-size=1600,1000'],
});

const percentile = (values, p) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] * 10) / 10;
};

// frame intervals in the page for ms, plus what the renderer drew
const measure = (page, ms) =>
    page.evaluate(
        (ms) =>
            new Promise((resolve) => {
                const intervals = [];
                let last = performance.now();
                const end = last + ms;
                const frame = (now) => {
                    intervals.push(now - last);
                    last = now;
                    if (now < end) requestAnimationFrame(frame);
                    else {
                        const info = window.Application.renderer.instance.info.render;
                        resolve({ intervals, calls: info.calls, triangles: info.triangles });
                    }
                };
                requestAnimationFrame(frame);
            }),
        ms
    );

const states = async (page) => {
    const has = await page.evaluate(() => Boolean(window.Application.world.screens));
    const list = [['idle', async () => {}]];
    list.push([
        'desk',
        async () => {
            await page.evaluate(() => window.Application.camera.transition('desk'));
            await sleep(1800);
        },
    ]);
    if (has) {
        for (const id of ['m1', 'm2', 'm3']) {
            list.push([
                `focus_${id}`,
                async () => {
                    await page.evaluate((id) => window.Application.world.screens.focus(id), id);
                    await sleep(2200);
                },
            ]);
        }
    } else {
        list.push([
            'focus_m1',
            async () => {
                await page.evaluate(() => window.Application.camera.trigger('enterMonitor'));
                await sleep(2500);
            },
        ]);
    }
    return list;
};

const results = [];
for (let run = 0; run < runs; run++) {
    const order = run % 2 ? [...builds].reverse() : builds;
    for (const build of order) {
        const viewport = weak ? { width: 1536, height: 864 } : { width: 1512, height: 900 };
        const context = await browser.newContext({ viewport, deviceScaleFactor: weak ? 1.25 : 2 });
        const page = await context.newPage();
        if (throttle > 1) {
            const cdp = await context.newCDPSession(page);
            await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
        }
        const url = new URL(build.url);
        url.searchParams.set('raceDebug', '1');
        if (weak) url.searchParams.set('raceTier', 'low');
        const started = Date.now();
        await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 240000 });
        await page.waitForFunction(() => Boolean(window.Application?.world?.car?.model), null, { timeout: 300000 });
        const loadMs = Date.now() - started;
        // past the camera's intro move and the calibration window
        await sleep(7000);
        const info = await page.evaluate(() => window.Application.renderer.graphicsInfo());
        const row = { run, build: build.label, loadMs, tier: info.detectedTier, homeP50: info.homeP50, states: {} };
        for (const [name, enter] of await states(page)) {
            await enter();
            const m = await measure(page, measureMs);
            row.states[name] = {
                p50: percentile(m.intervals, 0.5),
                p95: percentile(m.intervals, 0.95),
                p99: percentile(m.intervals, 0.99),
                calls: m.calls,
                triangles: m.triangles,
            };
        }
        results.push(row);
        console.log('[room-perf]', JSON.stringify(row));
        await context.close();
    }
}
await browser.close();

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ weak, swgl, results }, null, 1));
const names = [...new Set(results.flatMap((r) => Object.keys(r.states)))];
for (const name of names) {
    const cells = builds.map((b) => {
        const rows = results.filter((r) => r.build === b.label && r.states[name]);
        if (!rows.length) return `${b.label} -`;
        const s = rows.map((r) => r.states[name]);
        return `${b.label} p50 ${s.map((x) => x.p50).join('/')} p95 ${s.map((x) => x.p95).join('/')} calls ${s[0].calls} tris ${s[0].triangles}`;
    });
    console.log(`${name.padEnd(9)} ${cells.join(' | ')}`);
}
