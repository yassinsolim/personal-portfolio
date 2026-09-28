// headed chromium play test for race mode. loads the site, enters race mode,
// drives a lap with real keyboard events (an autopilot presses W/A/S/D/Space
// from node), and reports load time, fps, frame times, console errors and
// screenshots.
//
//   node scripts/race-playtest.mjs --url http://192.168.1.166:8190/ --out .tmp-validation/run
//   node scripts/race-playtest.mjs --url ... --mode quality --seconds 60 --car bmw-e92-m3
//   node scripts/race-playtest.mjs --url ... --mobile   (landscape phone emulation, touch ui)
//
// headless chromium on macos can't reach 127.0.0.1, so serve on the lan ip.
// fps is only meaningful headed on the real gpu (angle metal).

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
const outDir = path.resolve(opt('out', '.tmp-validation/playtest'));
const seconds = Number(opt('seconds', 45));
const mode = opt('mode', 'auto');
const carId = opt('car', '');
const mobile = Boolean(opt('mobile', false));
const headless = Boolean(opt('headless', false));
// cornering target in m/s^2, defaults to 78% of the car's tire grip
const latOption = opt('lat', '');
const latAccel = latOption === '' ? null : Number(latOption);
const width = Number(opt('width', mobile ? 852 : 1512));
const height = Number(opt('height', mobile ? 393 : 900));
const dpr = Number(opt('dpr', mobile ? 3 : 2));
const shotEvery = Number(opt('shot-every', 8));
const drift = opt('drift', 'yes') !== 'no';
const throttleMbps = Number(opt('mbps', 0));
const kp = Number(opt('kp', 2.5));
const kd = Number(opt('kd', 0.9));

fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let page;
const shot = (name) =>
    page.screenshot({
        path: path.join(outDir, name.replace(/\.png$/, '.jpg')),
        type: 'jpeg',
        quality: 82,
        scale: 'css',
    });
const log = (...a) => console.log('[playtest]', ...a);

// use whichever playwright chromium is installed, the cache can be newer than
// this repo's playwright version
const findChromium = () => {
    if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
    const cache = path.join(
        process.env.HOME || '',
        'Library/Caches/ms-playwright'
    );
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
    headless,
    executablePath: findChromium(),
    args: [
        '--use-angle=metal',
        '--ignore-gpu-blocklist',
        '--enable-gpu-rasterization',
        '--autoplay-policy=no-user-gesture-required',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        `--window-size=${width},${height + 90}`,
    ],
});
const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: dpr,
    isMobile: mobile,
    hasTouch: mobile,
    userAgent: mobile
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
        : undefined,
});
page = await context.newPage();

const consoleMessages = [];
page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error' || type === 'warning') {
        consoleMessages.push({ type, text: msg.text().slice(0, 400) });
    }
});
page.on('pageerror', (err) =>
    consoleMessages.push({ type: 'pageerror', text: String(err).slice(0, 400) })
);

if (throttleMbps > 0) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 25,
        downloadThroughput: (throttleMbps * 1e6) / 8,
        uploadThroughput: (10 * 1e6) / 8,
    });
}

await page.addInitScript(
    ({ renderMode }) => {
        try {
            localStorage.setItem('yassinverse:renderMode', renderMode);
        } catch {}
        window.__pt = { marks: {} };
        const mark = (name) => {
            if (window.__pt.marks[name] === undefined) {
                window.__pt.marks[name] = performance.now();
            }
        };
        document.addEventListener('loadingScreenDone', () =>
            mark('loadingDone')
        );
        document.addEventListener('raceMode:changed', (e) => {
            if (e.detail?.active) mark('raceActive');
        });
    },
    { renderMode: mode }
);

const t0 = Date.now();
await page.goto(url.toString(), {
    waitUntil: 'domcontentloaded',
    timeout: 180000,
});
await page.waitForFunction(
    () => window.__pt.marks.loadingDone !== undefined,
    null,
    {
        timeout: 240000,
    }
);
const loadingDoneMs = await page.evaluate(() => window.__pt.marks.loadingDone);
log(`loading screen done after ${Math.round(loadingDoneMs)} ms`);

const initialBytes = await page.evaluate(() =>
    performance
        .getEntriesByType('resource')
        .reduce((sum, e) => sum + (e.transferSize || e.encodedBodySize || 0), 0)
);

if (carId) {
    await page.waitForSelector('#car-switcher');
    await page.selectOption('#car-switcher', carId);
    await sleep(500);
}

// the site view, before racing
await sleep(1500);
await shot('00-site.png');

const playButton = page.getByRole('button', { name: /^Play Solo$/ });
await playButton.waitFor({ timeout: 60000 });
const clickAt = await page.evaluate(() => performance.now());
await playButton.click();
await page.waitForFunction(
    () => {
        const rm = window.Application?.world?.raceManager;
        return Boolean(rm?.active && rm.vehicle?.carModel);
    },
    null,
    { timeout: 120000 }
);
// first rendered frame after the car is in
await page.evaluate(
    () =>
        new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r))
        )
);
const raceReadyMs = await page.evaluate(() => performance.now());
const raceBytes = await page.evaluate(
    (since) =>
        performance
            .getEntriesByType('resource')
            .filter((e) => e.startTime >= since)
            .reduce(
                (sum, e) => sum + (e.transferSize || e.encodedBodySize || 0),
                0
            ),
    clickAt
);
log(`race ready ${Math.round(raceReadyMs - clickAt)} ms after Play Solo`);

// lock the pointer like a player would
if (!mobile) {
    await page.mouse.click(width / 2, height / 2);
}
await sleep(1200);
await shot('01-start.png');

// autopilot state from the page: heading error to a lookahead point and a
// target speed from the curvature ahead
await page.evaluate(() => {
    const rm = window.Application.world.raceManager;
    const curve = rm.vehicle.track.getCurve();
    const N = 6000;
    const pts = curve.getSpacedPoints(N);
    const spacing = curve.getLength() / N;
    window.__ap = { pts, N, spacing, hint: -1 };
    const frames = [];
    const samples = [];
    window.__frames = frames;
    window.__samples = samples;
    window.__sampling = false;
    let last = performance.now();
    const loop = (now) => {
        if (window.__sampling) frames.push(now - last);
        last = now;
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    const app = window.Application;
    const origUpdate = app.update.bind(app);
    window.__jsMs = [];
    app.update = () => {
        const s = performance.now();
        origUpdate();
        if (window.__sampling) window.__jsMs.push(performance.now() - s);
    };
    window.__sampleTimer = setInterval(() => {
        if (!window.__sampling) return;
        const r = app.renderer;
        const info = r.instance.info.render;
        const t = rm.vehicle.getTelemetry();
        samples.push({
            ratio: r.instance.getPixelRatio(),
            adaptiveFps: r.adaptive.fps,
            calls: info.calls,
            triangles: info.triangles,
            kph: t.speedKph,
        });
    }, 1000);
});

const apState = () =>
    page.evaluate(() => {
        const ap = window.__ap;
        const v = window.Application.world.raceManager.vehicle;
        const pos = v.position;
        const span = ap.hint < 0 ? ap.N : 120;
        let best = ap.hint < 0 ? 0 : ap.hint;
        let bestD = Infinity;
        for (let k = -span; k <= span; k++) {
            const i =
                ap.hint < 0 ? k + span : (((ap.hint + k) % ap.N) + ap.N) % ap.N;
            if (i < 0 || i >= ap.N) continue;
            const p = ap.pts[i];
            const d = (p.x - pos.x) ** 2 + (p.z - pos.z) ** 2;
            if (d < bestD) {
                bestD = d;
                best = i;
            }
        }
        ap.hint = best;
        const speed = Math.abs(v.speedMps);
        const ahead = Math.round(Math.max(12, speed * 0.55) / ap.spacing);
        const target = ap.pts[(best + ahead) % ap.N];
        const targetYaw = Math.atan2(target.x - pos.x, target.z - pos.z);
        let delta = targetYaw - v.yaw;
        delta = Math.atan2(Math.sin(delta), Math.cos(delta));
        // tightest turn in the braking window ahead
        let maxK = 0;
        const window_ = Math.round(Math.max(60, speed * 3.2) / ap.spacing);
        const step = Math.max(1, Math.round(6 / ap.spacing));
        for (let j = ahead; j < window_; j += step) {
            const a = ap.pts[(best + j) % ap.N];
            const b = ap.pts[(best + j + step) % ap.N];
            const c = ap.pts[(best + j + 2 * step) % ap.N];
            const h1 = Math.atan2(b.x - a.x, b.z - a.z);
            const h2 = Math.atan2(c.x - b.x, c.z - b.z);
            let dh = h2 - h1;
            dh = Math.atan2(Math.sin(dh), Math.cos(dh));
            const ds = Math.hypot(c.x - b.x, c.z - b.z) || 1;
            maxK = Math.max(maxK, Math.abs(dh) / ds);
        }
        // signed curvature of the path just ahead, for a yaw rate reference
        const a = ap.pts[(best + ahead) % ap.N];
        const b = ap.pts[(best + ahead + 8) % ap.N];
        const c0 = ap.pts[(best + ahead + 16) % ap.N];
        let dh =
            Math.atan2(c0.x - b.x, c0.z - b.z) -
            Math.atan2(b.x - a.x, b.z - a.z);
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        const kAhead = dh / Math.max(1, Math.hypot(c0.x - b.x, c0.z - b.z));
        const now = performance.now();
        let yawRate = 0;
        if (ap.lastYawAt) {
            let dy = v.yaw - ap.lastYaw;
            dy = Math.atan2(Math.sin(dy), Math.cos(dy));
            yawRate = dy / Math.max(1e-3, (now - ap.lastYawAt) / 1000);
        }
        ap.lastYaw = v.yaw;
        ap.lastYawAt = now;
        ap.yawRate =
            ap.yawRate === undefined
                ? yawRate
                : ap.yawRate * 0.6 + yawRate * 0.4;
        const c = v.input.getState();
        return {
            delta,
            yawRate: ap.yawRate,
            yawRateRef: speed * kAhead,
            speed,
            maxK,
            offset: Math.sqrt(bestD),
            progress: best / ap.N,
            input: [c.throttle, c.brake, c.steer, c.handbrake].map(
                (x) => +x.toFixed(2)
            ),
            grip: v.physics ? v.physics.spec.tireGrip : 1.15,
        };
    });

// real keyboards auto-repeat keydown while a key is held, and the game clears
// its key state on resets, so held keys get re-sent like a real key repeat
const held = new Map();
const setKey = async (code, down) => {
    const now = Date.now();
    if (down && (!held.has(code) || now - held.get(code) > 120)) {
        held.set(code, now);
        await page.keyboard.down(code);
    } else if (!down && held.has(code)) {
        held.delete(code);
        await page.keyboard.up(code);
    }
};
const releaseAll = async () => {
    for (const code of [...held.keys()]) await setKey(code, false);
};

await page.evaluate(() => (window.__sampling = true));
const start = Date.now();
let nextShot = 3;
let shotIndex = 2;
let driftDone = !drift;
let driftUntil = 0;
const trace = [];
while (Date.now() - start < seconds * 1000) {
    const s = await apState();
    const elapsed = (Date.now() - start) / 1000;
    const kph = s.speed * 3.6;
    const lat = latAccel ?? 0.78 * s.grip * 9.81;
    const vTarget = Math.sqrt(lat / Math.max(1e-4, s.maxK));
    if (!driftDone && elapsed > 12 && kph > 70 && kph < 140) {
        driftDone = true;
        driftUntil = Date.now() + 1600;
    }
    if (Date.now() < driftUntil) {
        // handbrake flick into a slide, then catch it
        const phase = (driftUntil - Date.now()) / 1600;
        await setKey('Space', phase > 0.55);
        await setKey('KeyW', true);
        await setKey('KeyS', false);
        await setKey('KeyA', phase > 0.45);
        await setKey('KeyD', phase <= 0.45 && phase > 0.15);
        if (Math.abs(phase - 0.6) < 0.05) {
            await shot(`drift.png`);
        }
    } else {
        await setKey('Space', false);
        // keys are on/off, so steer with pwm: the game's input smoothing
        // averages the duty cycle into a partial steer
        // heading error with yaw rate damping, or the lag in the car's
        // steering turns it into a growing weave
        const u = Math.max(
            -1,
            Math.min(1, s.delta * kp - (s.yawRate - s.yawRateRef) * kd)
        );
        const phase = (Date.now() % 100) / 100;
        const on = phase < Math.abs(u);
        await setKey('KeyA', on && u > 0.02);
        await setKey('KeyD', on && u < -0.02);
        const brake = s.speed > vTarget + 2.5;
        await setKey('KeyS', brake);
        await setKey('KeyW', !brake && s.speed < vTarget + 0.5);
    }
    trace.push({
        t: +elapsed.toFixed(2),
        kph: Math.round(kph),
        vt: Math.round(vTarget * 3.6),
        off: +s.offset.toFixed(1),
        p: +s.progress.toFixed(4),
        in: s.input,
    });
    if (elapsed >= nextShot) {
        nextShot += shotEvery;
        await shot(`${String(shotIndex).padStart(2, '0')}-drive.png`);
        shotIndex++;
    }
    await sleep(25);
}
await releaseAll();

const perf = await page.evaluate(() => {
    window.__sampling = false;
    clearInterval(window.__sampleTimer);
    const f = window.__frames.slice(10);
    const sorted = f.slice().sort((a, b) => a - b);
    const pct = (p) =>
        sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    const mean = f.reduce((a, b) => a + b, 0) / Math.max(1, f.length);
    const js = window.__jsMs.slice().sort((a, b) => a - b);
    const jpct = (p) => js[Math.min(js.length - 1, Math.floor(js.length * p))];
    const s = window.__samples;
    const avg = (k) => s.reduce((a, b) => a + b[k], 0) / Math.max(1, s.length);
    return {
        frames: f.length,
        fpsMean: +(1000 / mean).toFixed(1),
        fps1Low: +(1000 / pct(0.99)).toFixed(1),
        frameMsP50: +pct(0.5).toFixed(2),
        frameMsP95: +pct(0.95).toFixed(2),
        frameMsP99: +pct(0.99).toFixed(2),
        frameMsMax: +sorted[sorted.length - 1].toFixed(1),
        hitches33: f.filter((x) => x > 33.4).length,
        jsMsP50: +jpct(0.5).toFixed(2),
        jsMsP95: +jpct(0.95).toFixed(2),
        pixelRatioMin: Math.min(...s.map((x) => x.ratio)),
        pixelRatioMax: Math.max(...s.map((x) => x.ratio)),
        pixelRatioAvg: +avg('ratio').toFixed(2),
        drawCallsAvg: Math.round(avg('calls')),
        trianglesAvg: Math.round(avg('triangles')),
        maxKph: Math.round(Math.max(...s.map((x) => x.kph))),
        canvas: [
            window.Application.renderer.instance.domElement.width,
            window.Application.renderer.instance.domElement.height,
        ],
    };
});

// pause menu and hud
await page.keyboard.press('Escape');
await sleep(600);
await shot('pause.png');

const lb = await page.evaluate(() => {
    const rows = Array.from(
        document.querySelectorAll('.race-hud-board li')
    ).map((li) => li.textContent);
    return rows.slice(0, 5);
});

const result = {
    url: url.toString(),
    mode,
    viewport: [width, height, dpr],
    mobile,
    loadingDoneMs: Math.round(loadingDoneMs),
    initialTransferKB: Math.round(initialBytes / 1024),
    raceEntryMs: Math.round(raceReadyMs - clickAt),
    raceEntryTransferKB: Math.round(raceBytes / 1024),
    wallSeconds: Math.round((Date.now() - t0) / 1000),
    perf,
    trace: trace.filter((_, i) => i % 20 === 0),
    leaderboardRows: lb,
    console: consoleMessages,
};
fs.writeFileSync(
    path.join(outDir, 'result.json'),
    JSON.stringify(result, null, 2)
);
log(JSON.stringify({ ...result, trace: undefined }, null, 2));
await browser.close();
