// chase cam screenshots at spots along the lap, for checking the terrain
// against the road. the car goes on the road a little before each spot,
// facing it, the camera snaps behind it and a shot is taken. --magenta paints
// every terrain surface flat magenta, so any ground drawn over the road shows
// up at a glance. --transition captures frames of the homepage car click
// reveal instead.
//
//   node scripts/race-terrain-shots.mjs --url http://127.0.0.1:8192/ --out .tmp-validation/terrain/after
//   node scripts/race-terrain-shots.mjs --url ... --tier low        (the weak gpu path)
//   node scripts/race-terrain-shots.mjs --url ... --spots spots.json --magenta
//   node scripts/race-terrain-shots.mjs --url ... --transition
//   node scripts/race-terrain-shots.mjs --url ... --eval 'rm.track.visualMesh.material.polygonOffsetUnits = 2'
//
// spots.json: [{ "label": "karussell", "distance": 12196, "x": 1668.7, "z": -1411.1 }],
// x and z are the world point to look at (the report's worst sample), the car
// sits `back` meters (default 16) before `distance` on the centerline.
// the page also gets window.__raceTeleport(distance, x?, z?, back?) for the console.
//
// multiplayer stays on the in-browser mock (mpmock=1) and every request to
// supabase is aborted.

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

const url = new URL(opt('url', 'http://127.0.0.1:8192/'));
url.searchParams.set('raceDebug', '1');
url.searchParams.set('mpmock', '1');
const tier = opt('tier', '');
if (tier) url.searchParams.set('raceTier', tier);
const outDir = path.resolve(opt('out', '.tmp-validation/terrain-shots'));
const mode = opt('mode', 'auto');
const magenta = Boolean(opt('magenta', false));
const transition = Boolean(opt('transition', false));
const view = Number(opt('view', 0));
const width = Number(opt('width', 1280));
const height = Number(opt('height', 720));
const dpr = Number(opt('dpr', 1));
const spotsFile = opt('spots', '');
const spots = spotsFile
    ? JSON.parse(fs.readFileSync(path.resolve(spotsFile), 'utf8'))
    : [];
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[terrain-shots]', ...a);

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
    headless: Boolean(opt('headless', false)),
    executablePath: findChromium(),
    args: [
        '--use-angle=metal',
        '--ignore-gpu-blocklist',
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
});
let blocked = 0;
await context.route(/supabase\.(co|in)/, (route) => {
    blocked++;
    return route.abort();
});
await context.routeWebSocket(/supabase\.(co|in)/, (ws) => {
    blocked++;
    ws.close();
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 300));
});
await page.addInitScript(
    ({ renderMode, cameraView }) => {
        try {
            localStorage.setItem('yassinverse:renderMode', renderMode);
            localStorage.setItem(
                'yassinverse:nordschleife:cameraView:v1',
                String(cameraView)
            );
        } catch {}
    },
    { renderMode: mode, cameraView: view }
);
const shot = (name) =>
    page.screenshot({
        path: path.join(outDir, `${name}.jpg`),
        type: 'jpeg',
        quality: 88,
        scale: 'css',
    });

await page.goto(url.toString(), {
    waitUntil: 'domcontentloaded',
    timeout: 180000,
});
await page.waitForFunction(
    () => Boolean(window.Application?.world?.car?.model),
    null,
    { timeout: 240000 }
);

// flat magenta on every terrain material, unlit and fogless
const paintTerrain = () =>
    page.evaluate(() => {
        const rm = window.Application.world.raceManager;
        const root = rm.visuals.terrain.root;
        const done = new Set();
        root.traverse((o) => {
            if (!o.isMesh || done.has(o.material)) return;
            done.add(o.material);
            const m = o.material;
            m.onBeforeCompile = (shader) => {
                shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <dithering_fragment>',
                    '#include <dithering_fragment>\n    gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);'
                );
            };
            m.customProgramCacheKey = () => 'terrain-magenta';
            m.needsUpdate = true;
        });
    });

if (transition) {
    // the homepage car click, like race-transition-check.mjs: settle in the
    // desk view, find the car under the pointer, click, capture the reveal
    await sleep(2500);
    for (let i = 0; i < 40; i++) {
        await page.mouse.move(300 + (i % 10) * 90, 250 + (i % 4) * 90);
        await sleep(100);
    }
    await sleep(2500);
    const center = await page.evaluate(() => {
        const A = window.Application;
        const car = A.world.car.model;
        const box = new car.position.constructor();
        const lo = box.clone().setScalar(Infinity);
        const hi = box.clone().setScalar(-Infinity);
        car.updateMatrixWorld(true);
        car.traverse((o) => {
            if (!o.isMesh || !o.geometry) return;
            o.geometry.computeBoundingBox();
            const b = o.geometry.boundingBox;
            for (const x of [b.min.x, b.max.x])
                for (const y of [b.min.y, b.max.y])
                    for (const z of [b.min.z, b.max.z]) {
                        box.set(x, y, z).applyMatrix4(o.matrixWorld);
                        lo.min(box);
                        hi.max(box);
                    }
        });
        const m = lo.clone().add(hi).multiplyScalar(0.5);
        m.x = m.x * 0.6 + hi.x * 0.4;
        m.project(A.camera.instance);
        return {
            x: ((m.x + 1) / 2) * innerWidth,
            y: ((1 - m.y) / 2) * innerHeight,
        };
    });
    let at = null;
    for (const [dx, dy] of [
        [0, 0],
        [60, 0],
        [120, 0],
        [-60, 0],
        [60, -40],
        [120, -40],
        [180, -20],
        [200, 0],
        [250, -30],
        [300, 0],
    ]) {
        await page.mouse.move(center.x + dx, center.y + dy);
        await sleep(250);
        if (
            (await page.evaluate(() => document.body.style.cursor)) ===
            'pointer'
        ) {
            at = { x: center.x + dx, y: center.y + dy };
            break;
        }
    }
    if (!at) throw new Error('could not find the car to click');
    // building the race world starts on hover, give it a moment
    await sleep(1500);
    if (magenta) {
        await page.waitForFunction(
            () => Boolean(window.Application.world.raceManager?.visuals),
            null,
            { timeout: 60000 }
        );
        await paintTerrain();
    }
    await page.mouse.click(at.x, at.y);
    await page.waitForFunction(
        () => window.Application.world.raceManager?.active,
        null,
        { timeout: 30000 }
    );
    const frames = [];
    const t0 = Date.now();
    for (let i = 0; i < 16; i++) {
        const radius = await page.evaluate(
            () =>
                window.Application.world.raceManager.visuals.reveal
                    .uRevealRadius.value
        );
        const name = `transition-${String(i).padStart(2, '0')}`;
        await shot(name);
        frames.push({ name, ms: Date.now() - t0, radius: Math.round(radius) });
        await sleep(220);
    }
    log('frames', JSON.stringify(frames));
} else {
    const playButton = page.getByRole('button', { name: /^Play Solo$/ });
    await playButton.waitFor({ timeout: 60000 });
    await playButton.click();
    await page.waitForFunction(
        () => {
            const rm = window.Application?.world?.raceManager;
            return Boolean(rm?.active && rm.vehicle?.carModel);
        },
        null,
        { timeout: 120000 }
    );
    await sleep(2500);
    if (magenta) await paintTerrain();
    // --eval 'js': run once race mode is up (a, rm in scope), for a/b tests
    const evalCode = opt('eval', '');
    if (evalCode) {
        await page.evaluate((code) => {
            const a = window.Application;
            new Function('a', 'rm', code)(a, a.world.raceManager);
        }, evalCode);
    }
    await page.evaluate(() => {
        window.__raceTeleport = (distance, x, z, back = 16) => {
            const rm = window.Application.world.raceManager;
            const v = rm.vehicle;
            const track = v.track;
            const curve = track.getCurve();
            const L = track.length;
            const t = ((((distance - back) / L) % 1) + 1) % 1;
            const p = curve.getPointAt(t);
            let yaw;
            if (x === undefined || z === undefined) {
                const d = curve.getTangentAt(t);
                yaw = Math.atan2(d.x, d.z);
            } else {
                yaw = Math.atan2(x - p.x, z - p.z);
            }
            v.teleport(p, yaw, 0);
            rm.chaseCamera.initialized = false;
            return {
                x: +p.x.toFixed(1),
                y: +p.y.toFixed(1),
                z: +p.z.toFixed(1),
                yaw: +yaw.toFixed(3),
            };
        };
    });
    for (const spot of spots) {
        const placed = await page.evaluate(
            ({ distance, x, z, back }) =>
                window.__raceTeleport(distance, x, z, back),
            spot
        );
        // a few frames: the camera snaps, near trees refill, the car settles
        await sleep(900);
        await page.evaluate(
            () =>
                (window.Application.world.raceManager.chaseCamera.initialized = false)
        );
        await sleep(600);
        const info = await page.evaluate(() => ({
            ratio: window.Application.renderer.instance.getPixelRatio(),
            preset: window.Application.world.raceManager.visuals.preset,
        }));
        await shot(spot.label);
        log(spot.label, JSON.stringify({ ...placed, ...info }));
    }
}

await browser.close();
log(
    `done, ${blocked} supabase requests blocked, ${errors.length} console errors`
);
if (errors.length) log(errors.slice(0, 5).join('\n'));
