// checks the race audio in a headed chromium against a production build:
// enters race mode, drives with real key presses, switches car from the
// pause menu, and reports what the audio graph actually outputs, console
// errors, download sizes and fps with the audio running vs suspended.
//
//   npm run build
//   node scripts/verify-race-audio.mjs [--port 8232] [--car bmw-f82-m4] [--switch amg-c63-507]

import { chromium } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(root, 'build');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const port = Number(opt('port', 8232));
const firstCar = opt('car', 'bmw-f82-m4');
const secondCar = opt('switch', 'amg-c63-507');
const outFile = path.join(root, '.tmp-validation', 'race-audio-verify.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// same headers as production (vercel.json), so the csp is tested too
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const headers = Object.fromEntries(vercel.headers[0].headers.map((h) => [h.key, h.value]));
delete headers['Strict-Transport-Security'];
headers['Content-Security-Policy'] = headers['Content-Security-Policy'].replace('; upgrade-insecure-requests', '');
const types = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.webm': 'audio/webm', '.m4a': 'audio/mp4', '.glb': 'model/gltf-binary', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
    '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg',
};
const server = http.createServer((req, res) => {
    let url = decodeURIComponent((req.url || '/').split('?')[0]);
    if (url.endsWith('/')) url += 'index.html';
    const file = path.join(buildDir, url);
    if (!file.startsWith(buildDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404, headers);
        res.end();
        return;
    }
    res.writeHead(200, { ...headers, 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(port, '127.0.0.1', r));

const findChromium = () => {
    const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
    const dirs = fs.existsSync(cache)
        ? fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
        : [];
    for (const dir of dirs) {
        const exe = path.join(cache, dir, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
        if (fs.existsSync(exe)) return exe;
    }
    return undefined;
};

const browser = await chromium.launch({ headless: false, executablePath: findChromium() });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const logs = [];
page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push({ type: m.type(), text: m.text().slice(0, 300) });
});
page.on('pageerror', (e) => logs.push({ type: 'pageerror', text: String(e).slice(0, 300) }));
await page.addInitScript(() => {
    window.__loadingDone = false;
    document.addEventListener('loadingScreenDone', () => {
        window.__loadingDone = true;
    });
});

const report = { phases: {}, logs, cars: [firstCar, secondCar] };
await page.goto(`http://127.0.0.1:${port}/?raceDebug=1`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => window.__loadingDone, null, { timeout: 240000 });
await page.waitForSelector('#car-switcher');
await page.selectOption('#car-switcher', firstCar);
await sleep(800);
const soundsBefore = await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => e.name.includes('/sounds/race/')).length);
report.audioRequestsBeforeRace = soundsBefore;
await page.getByRole('button', { name: /^Play Solo$/ }).click();
await page.waitForFunction(() => {
    const rm = window.Application?.world?.raceManager;
    return Boolean(rm?.active && rm.vehicle?.carModel);
}, null, { timeout: 120000 });
// the car dropdown keeps keyboard focus otherwise and eats the key presses
await page.evaluate(() => document.activeElement?.blur());
await page.mouse.click(640, 400);

// tap the race mix with an analyser and count frame times
await page.evaluate(() => {
    const audio = window.Application.world.raceManager.engineAudio.carAudio;
    window.__audio = audio;
    window.__frames = [];
    window.__audioMs = [];
    let last = performance.now();
    const tick = (now) => {
        window.__frames.push(now - last);
        last = now;
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const rae = window.Application.world.raceManager.engineAudio;
    for (const name of ['update', 'updateWorld']) {
        const fn = rae[name].bind(rae);
        rae[name] = (...a) => {
            const s = performance.now();
            fn(...a);
            window.__audioMs.push(performance.now() - s);
        };
    }
    window.__tap = () => {
        const a = window.__audio;
        if (!a.context || !a.master) return null;
        if (!window.__analyser) {
            window.__analyser = a.context.createAnalyser();
            window.__analyser.fftSize = 2048;
            a.master.connect(window.__analyser);
        }
        const buf = new Float32Array(2048);
        window.__analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        return 20 * Math.log10(Math.sqrt(sum / buf.length) + 1e-9);
    };
});

const phase = async (name, ms, keys = []) => {
    await page.evaluate(() => {
        window.__frames.length = 0;
        window.__audioMs.length = 0;
    });
    for (const k of keys) await page.keyboard.down(k);
    const levels = [];
    const stats = [];
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        await sleep(250);
        const s = await page.evaluate(() => {
            const t = window.Application.world.raceManager.vehicle.getTelemetry();
            return { level: window.__tap(), stats: window.__audio.stats(), kph: Math.round(t.speedKph), rpm: Math.round(t.rpm), gear: t.gear };
        });
        levels.push(s.level);
        stats.push(s);
    }
    for (const k of keys) await page.keyboard.up(k);
    const perf = await page.evaluate(() => {
        const f = window.__frames.slice(5);
        const a = window.__audioMs;
        const mean = (v) => v.reduce((x, y) => x + y, 0) / Math.max(1, v.length);
        return {
            fps: Math.round(1000 / mean(f)),
            p95FrameMs: Number([...f].sort((x, y) => x - y)[Math.floor(f.length * 0.95)]?.toFixed(1)),
            audioJsMsPerFrame: Number((mean(a) * 2).toFixed(3)),
        };
    });
    const finite = levels.filter((v) => Number.isFinite(v));
    report.phases[name] = {
        ...perf,
        levelDbMin: Math.round(Math.min(...finite)),
        levelDbMax: Math.round(Math.max(...finite)),
        last: stats[stats.length - 1],
        path: stats.map((s) => `${s.kph}kph/${s.rpm}rpm/g${s.gear}/${Math.round(s.level)}dB`).join(' '),
    };
    console.log(name, JSON.stringify(report.phases[name]).slice(0, 600));
};

await phase('idle', 2500);
await phase('full-throttle', 7000, ['KeyW']);
await phase('lift-off', 3000);

// switch car from the pause menu like a player would
await page.keyboard.press('Escape');
await sleep(700);
await page.selectOption('#race-car-select', secondCar);
await sleep(2500);
const resume = page.getByRole('button', { name: /resume/i });
if (await resume.count()) await resume.first().click();
else await page.keyboard.press('Escape');
await sleep(500);
await page.evaluate(() => document.activeElement?.blur());
await page.mouse.click(640, 400);
await phase('after-switch-idle', 2500);
await phase('after-switch-throttle', 5000, ['KeyW']);

// a fake multiplayer car passing the player at speed, to exercise the 3d
// voices (bank loading, panner, doppler) without a live lobby
await page.evaluate(() => {
    const rae = window.Application.world.raceManager.engineAudio;
    const original = rae.updateWorld.bind(rae);
    const start = performance.now();
    window.__flyby = { maxRemotes: 0 };
    rae.updateWorld = (listener, remotes, dt) => {
        const t = (performance.now() - start) / 1000;
        const p = listener.position;
        const f = listener.forward;
        // runs from 120 m behind to 120 m ahead, 6 m to the side, 216 km/h
        const along = -120 + 60 * t;
        const fake = {
            id: 'verify-remote',
            carId: 'amg-one',
            position: { x: p.x + f.x * along + f.z * 6, y: p.y, z: p.z + f.z * along - f.x * 6 },
            speedKph: 216,
        };
        original(listener, t < 4 ? [...remotes, fake] : remotes, dt);
        window.__flyby.maxRemotes = Math.max(window.__flyby.maxRemotes, rae.carAudio.remotes.size);
    };
});
await phase('remote-flyby', 4500);
report.flyby = await page.evaluate(() => window.__flyby);

// fps with the audio suspended vs running, same driving
await page.evaluate(() => window.__audio.context.suspend());
await phase('throttle-audio-suspended', 4000, ['KeyW']);
await page.evaluate(() => window.__audio.context.resume());
await phase('throttle-audio-running', 4000, ['KeyW']);

report.audioResources = await page.evaluate(() =>
    performance
        .getEntriesByType('resource')
        .filter((e) => e.name.includes('/sounds/race/'))
        .map((e) => ({ file: e.name.split('/sounds/race/')[1], kb: Math.round((e.transferSize || e.encodedBodySize) / 1024) }))
);
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
console.log('audio files fetched:', JSON.stringify(report.audioResources));
console.log('console errors/warnings:', logs.length ? JSON.stringify(logs, null, 1) : 'none');
await browser.close();
server.close();
