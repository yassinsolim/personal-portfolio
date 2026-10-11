// records the homepage to race transition (click the car, the camera goes
// behind it, the ring builds around it). two modes:
//
//   --mode frames   a virtual clock steps the page exactly 1/60 s per frame
//                   and every frame is screenshotted, so the video is a clean
//                   60 fps however busy the machine is. writes frames/*.jpg,
//                   then transition.mp4 (ffmpeg), transition.webp (img2webp,
//                   small, for inline use) and strip.jpg
//   --mode timing   real time. logs every frame interval and long task from
//                   the hover (which builds the race world) until the race
//                   has run for a few seconds, and reports the max, p95 and
//                   the frames over 33 and 50 ms, per phase. --hover <s> is
//                   how long the pointer rests on the car before the click
//
//   node scripts/race-transition-record.mjs --url http://192.168.1.166:5871/ --out .tmp-validation/rec
//   node scripts/race-transition-record.mjs --url ... --mode timing --runs 3 [--swgl] [--tier low] [--cpu-throttle 4]
//   node scripts/race-transition-record.mjs --url ... --browser webkit --reduced-motion
//   node scripts/race-transition-record.mjs --url ... --look '{"paint":"#d8342c","wheels":"bmw-m8-competition-coupe"}'
//
// headless chromium on macos can't reach 127.0.0.1, so serve on the lan ip.
// frame times only mean something headed on the real gpu.

import { chromium, webkit } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    if (i < 0) return fallback;
    const next = args[i + 1];
    return next === undefined || next.startsWith('--') ? true : next;
};
const url = new URL(opt('url', 'http://192.168.1.166:5871/'));
url.searchParams.set('raceDebug', '1');
url.searchParams.set('mpmock', '1');
if (opt('tier', '')) url.searchParams.set('raceTier', opt('tier'));
const mode = opt('mode', 'frames');
const out = path.resolve(opt('out', '.tmp-validation/transition'));
const browserName = opt('browser', 'chromium');
const swgl = Boolean(opt('swgl', false));
const reducedMotion = Boolean(opt('reduced-motion', false));
const width = Number(opt('width', 1512));
const height = Number(opt('height', 900));
const dpr = Number(opt('dpr', 2));
const fps = Number(opt('fps', 60));
const runs = Number(opt('runs', 1));
const skip = opt('skip', '');
const carId = opt('car', '');
const look = opt('look', '');
const label = opt('label', '');
// frames kept after the transition is over, and the most frames overall
const tail = Number(opt('tail', 75));
const maxFrames = Number(opt('max-frames', 900));
// timing: how long to wait for the transition to finish (software gl is slow)
const timeoutSeconds = Number(opt('timeout', 20));
// timing: how long the pointer rests on the car before the click
const hoverSeconds = Number(opt('hover', 3));
// timing: a slower cpu (chromium's throttling, from the hover on), for how
// an everyday laptop does
const cpuThrottle = Number(opt('cpu-throttle', 1));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(out, { recursive: true });

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

const launch = () =>
    browserName === 'webkit'
        ? webkit.launch({ headless: false })
        : chromium.launch({
              headless: false,
              executablePath: findChromium(),
              args: [
                  swgl ? '--use-angle=swiftshader' : '--use-angle=metal',
                  ...(swgl ? ['--enable-unsafe-swiftshader'] : []),
                  '--ignore-gpu-blocklist',
                  '--enable-gpu-rasterization',
                  '--autoplay-policy=no-user-gesture-required',
                  '--disable-background-timer-throttling',
                  '--disable-backgrounding-occluded-windows',
                  '--disable-renderer-backgrounding',
                  `--window-size=${width},${height + 90}`,
              ],
          });

// the virtual clock: while on, performance.now only moves when step() runs,
// and animation frame callbacks wait for it. every step runs inside a real
// animation frame so the page still draws and presents normally
const virtualClock = () => {
    const realRaf = window.requestAnimationFrame.bind(window);
    const realCancel = window.cancelAnimationFrame.bind(window);
    const realNow = performance.now.bind(performance);
    const vt = { on: false, now: 0, queue: new Map(), id: 1e7 };
    performance.now = () => (vt.on ? vt.now : realNow());
    window.requestAnimationFrame = (cb) => {
        if (!vt.on) return realRaf(cb);
        const id = vt.id++;
        vt.queue.set(id, cb);
        return id;
    };
    window.cancelAnimationFrame = (id) => {
        if (vt.queue.has(id)) vt.queue.delete(id);
        else realCancel(id);
    };
    window.__vt = {
        start() {
            vt.now = realNow();
            vt.on = true;
        },
        stop() {
            vt.on = false;
            const pending = [...vt.queue.values()];
            vt.queue.clear();
            pending.forEach((cb) => realRaf(cb));
        },
        step(ms) {
            return new Promise((resolve) => {
                realRaf(() => {
                    vt.now += ms;
                    const run = [...vt.queue.values()];
                    vt.queue.clear();
                    for (const cb of run) {
                        try {
                            cb(vt.now);
                        } catch (error) {
                            console.error(error);
                        }
                    }
                    realRaf(() => resolve(vt.now));
                });
            });
        },
    };
};

// every real frame interval, plus the long tasks, from mark() on
const frameLog = () => {
    const log = { on: false, frames: [], long: [], t0: 0 };
    window.__frames = log;
    const loop = (now) => {
        if (log.on) {
            if (log.last !== undefined) log.frames.push([now - log.t0, now - log.last]);
            log.last = now;
        }
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    try {
        new PerformanceObserver((list) => {
            if (!log.on) return;
            list.getEntries().forEach((e) =>
                log.long.push([Math.round(e.startTime - log.t0), Math.round(e.duration)])
            );
        }).observe({ entryTypes: ['longtask'] });
    } catch {
        // webkit has no long task timing
    }
    log.mark = () => {
        log.on = true;
        log.t0 = performance.now();
        log.last = undefined;
        log.frames = [];
        log.long = [];
    };
};

const prepare = async (browser) => {
    const context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: dpr,
        reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
    });
    const storage = {};
    if (carId) storage['yassinverse:selectedCar'] = carId;
    if (look && carId) storage[`yassinverse:garageLook:${carId}`] = look;
    await context.addInitScript((pairs) => {
        for (const [key, value] of Object.entries(pairs)) {
            try {
                localStorage.setItem(key, value);
            } catch {
                // storage blocked
            }
        }
        window.__loaded = false;
        document.addEventListener('loadingScreenDone', () => (window.__loaded = true));
    }, storage);
    if (mode === 'frames') await context.addInitScript(virtualClock);
    else await context.addInitScript(frameLog);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
    page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text().slice(0, 300));
    });
    // realtime stays offline: the mock lobby only, never a live project
    await page.route(/supabase\.co/, (route) => route.abort());
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 180000 });
    await page.waitForFunction(
        () => window.__loaded && Boolean(window.Application?.world?.car?.model),
        null,
        { timeout: 240000 }
    );
    // off the monitor (hovering it zooms in), then wait out the fly in
    await page.mouse.move(40, height - 40);
    await page.waitForFunction(
        () => ['idle', 'desk'].includes(window.Application.camera.currentKeyframe),
        null,
        { timeout: 30000 }
    );
    await sleep(1500);
    return { context, page, errors };
};

// a point over the car where the page shows the pointer cursor. hovering it
// also builds the race world
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
    const offsets = [[0, 0], [60, 0], [120, 0], [-60, 0], [60, -40], [120, -40], [180, -20], [200, 0], [250, -30], [300, 0], [350, -40]];
    for (const [dx, dy] of offsets) {
        await page.mouse.move(c.x + dx, c.y + dy);
        await sleep(250);
        // the screens show a pointer too: it has to be the car's hover
        if (await page.evaluate(() => document.body.style.cursor === 'pointer' && window.Application.world.raceTransition.hovering)) {
            return { x: c.x + dx, y: c.y + dy };
        }
    }
    return null;
};

const transitionState = (page) =>
    page.evaluate(() => {
        const A = window.Application;
        const rm = A.world.raceManager;
        return {
            busy: Boolean(A.world.raceTransition?.busy),
            active: Boolean(rm?.active),
            lobby: Boolean(document.querySelector('.race-lobby-choice')),
        };
    });

const percentile = (values, p) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
};

const run = (cmd, argv) => execFileSync(cmd, argv, { stdio: ['ignore', 'ignore', 'pipe'] });

const recordFrames = async () => {
    const browser = await launch();
    const { page, errors } = await prepare(browser);
    const car = await findCar(page);
    if (!car) throw new Error('no pointer over the car');
    await page.waitForFunction(() => Boolean(window.Application.world.raceManager), null, {
        timeout: 60000,
    });
    await sleep(1500);
    const dir = path.join(out, 'frames');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    await page.evaluate(() => window.__vt.start());
    const dt = 1000 / fps;
    let frame = 0;
    const grab = async () => {
        await page.screenshot({
            path: path.join(dir, `${String(frame).padStart(4, '0')}.jpg`),
            type: 'jpeg',
            quality: 92,
            scale: 'css',
        });
        frame++;
    };
    // a moment of the desk view first
    for (let i = 0; i < 12; i++) {
        await page.evaluate((ms) => window.__vt.step(ms), dt);
        await grab();
    }
    await page.mouse.down();
    await page.mouse.up();
    const marks = { click: frame };
    let after = -1;
    while (frame < maxFrames) {
        await page.evaluate((ms) => window.__vt.step(ms), dt);
        await grab();
        if (skip && frame === marks.click + 20) {
            marks.skip = frame;
            if (skip === 'key') await page.keyboard.press('Space');
            else await page.mouse.click(width * 0.5, height * 0.45);
        }
        const s = await transitionState(page);
        if (s.active && marks.active === undefined) marks.active = frame;
        if (!s.busy && s.active && after < 0) {
            marks.done = frame;
            after = tail;
        }
        if (after >= 0 && after-- === 0) break;
    }
    await page.evaluate(() => window.__vt.stop());
    await browser.close();
    fs.writeFileSync(
        path.join(out, 'frames.json'),
        JSON.stringify({ fps, frames: frame, marks, errors, label }, null, 1)
    );
    console.log('[record] frames', frame, 'marks', JSON.stringify(marks), 'errors', errors.length);
    encode(dir, frame, marks);
};

const encode = (dir, count, marks) => {
    const mp4 = path.join(out, 'transition.mp4');
    run('ffmpeg', [
        '-y', '-loglevel', 'error', '-framerate', String(fps),
        '-i', path.join(dir, '%04d.jpg'),
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow',
        '-movflags', '+faststart', mp4,
    ]);
    // the inline copy: half size, 30 fps, from the click on
    const small = path.join(out, 'small');
    fs.rmSync(small, { recursive: true, force: true });
    fs.mkdirSync(small, { recursive: true });
    const from = Math.max(0, marks.click - 6);
    run('ffmpeg', [
        '-y', '-loglevel', 'error', '-start_number', String(from), '-framerate', String(fps),
        '-i', path.join(dir, '%04d.jpg'),
        '-vf', `fps=30,scale=${Math.round(width / 2)}:-2:flags=lanczos`,
        '-q:v', '3', path.join(small, '%04d.jpg'),
    ]);
    const smallFrames = fs.readdirSync(small).filter((f) => f.endsWith('.jpg')).sort();
    const webp = path.join(out, 'transition.webp');
    let quality = 62;
    for (;;) {
        run('img2webp', [
            '-loop', '0', '-lossy', '-q', String(quality), '-m', '4', '-d', '33',
            ...smallFrames.map((f) => path.join(small, f)),
            '-o', webp,
        ]);
        const size = fs.statSync(webp).size;
        if (size < 7.5e6 || quality <= 30) break;
        quality -= 8;
    }
    // eight evenly spaced frames from the click to the end, two rows
    const last = Math.min(count - 1, (marks.done ?? count - 1) + 20);
    const picks = Array.from({ length: 8 }, (_, i) =>
        Math.round(marks.click + ((last - marks.click) * i) / 7)
    );
    const inputs = [];
    picks.forEach((n) => inputs.push('-i', path.join(dir, `${String(n).padStart(4, '0')}.jpg`)));
    const scaled = picks.map((_, i) => `[${i}:v]scale=756:-2[s${i}]`).join(';');
    const tiles = picks.map((_, i) => `[s${i}]`).join('');
    run('ffmpeg', [
        '-y', '-loglevel', 'error', ...inputs,
        '-filter_complex', `${scaled};${tiles}xstack=inputs=8:layout=0_0|w0_0|w0+w1_0|w0+w1+w2_0|0_h0|w0_h0|w0+w1_h0|w0+w1+w2_h0[out]`,
        '-map', '[out]', '-q:v', '3', path.join(out, 'strip.jpg'),
    ]);
    fs.writeFileSync(path.join(out, 'strip.json'), JSON.stringify({ picks, fps }, null, 1));
    const mb = (file) => (fs.statSync(file).size / 1e6).toFixed(2);
    console.log(`[record] ${mp4} ${mb(mp4)} MB, ${webp} ${mb(webp)} MB (q ${quality}), strip ${path.join(out, 'strip.jpg')}`);
};

const recordTiming = async () => {
    const results = [];
    for (let r = 0; r < runs; r++) {
        const browser = await launch();
        const { page, errors } = await prepare(browser);
        if (cpuThrottle > 1) {
            const cdp = await page.context().newCDPSession(page);
            await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle });
        }
        // from before the hover: it builds the race world and prewarms it
        await page.evaluate(() => window.__frames.mark());
        const car = await findCar(page);
        if (!car) throw new Error('no pointer over the car');
        await page.waitForFunction(() => Boolean(window.Application.world.raceManager), null, {
            timeout: 60000,
        });
        await sleep(hoverSeconds * 1000);
        const load = execFileSync('sysctl', ['-n', 'vm.loadavg']).toString().trim();
        const clickAt = await page.evaluate(() => performance.now() - window.__frames.t0);
        await page.mouse.down();
        await page.mouse.up();
        const t0 = Date.now();
        let doneAt = 0;
        if (skip) {
            await sleep(350);
            if (skip === 'key') await page.keyboard.press('Space');
            else await page.mouse.click(width * 0.5, height * 0.45);
        }
        while (Date.now() - t0 < timeoutSeconds * 1000) {
            await sleep(100);
            const s = await transitionState(page);
            if (s.active && !s.busy && !doneAt) doneAt = Date.now();
            if (doneAt && Date.now() - doneAt > 2000) break;
        }
        const log = await page.evaluate(() => ({
            frames: window.__frames.frames,
            long: window.__frames.long,
            // the transition's own phase marks (builds that have them)
            marks: performance
                .getEntriesByType('mark')
                .filter((m) => m.name.startsWith('race-transition:'))
                .map((m) => [m.name.split(':')[1], m.startTime - window.__frames.t0]),
            preset: window.Application.world.raceManager?.visuals?.preset,
            tier: window.Application.world.raceManager?.visuals?.tier,
            renderer: (() => {
                const gl = window.Application.renderer.instance.getContext();
                const info = gl.getExtension('WEBGL_debug_renderer_info');
                return String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
            })(),
        }));
        const intervals = log.frames.map((f) => f[1]);
        const worst = [...log.frames].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, d]) => [Math.round(t), Math.round(d * 10) / 10]);
        // per phase: the fly (camera moving), settled and held (a still
        // picture on screen), the reveal, and the race after it. a frame
        // belongs to the phase its end falls in
        const at = Object.fromEntries(log.marks.filter(([name]) => name !== 'start'));
        const edges = [
            ['hover', 0],
            ['click', clickAt],
            ['fly', at.fly],
            ['settled', at.settled],
            ['held', at.handoff],
            ['reveal', at.reveal],
            ['race', at.done],
        ].filter(([, t]) => t !== undefined);
        const phases = {};
        edges.forEach(([name, from], i) => {
            const to = i + 1 < edges.length ? edges[i + 1][1] : Infinity;
            const inside = log.frames.filter(([t]) => t > from && t <= to).map(([, d]) => d);
            if (!inside.length) return;
            const long = log.long.filter(([t]) => t > from && t <= to).map(([, d]) => d);
            phases[name] = {
                frames: inside.length,
                maxMs: Math.round(Math.max(...inside) * 10) / 10,
                over33: inside.filter((d) => d > 33.4).length,
                // chromium only, webkit has no long task timing
                longMax: long.length ? Math.max(...long) : 0,
                longOver50: long.filter((d) => d > 50).length,
            };
        });
        const result = {
            run: r,
            load,
            preset: log.preset,
            tier: log.tier,
            cpuThrottle,
            renderer: log.renderer.slice(0, 80),
            seconds: Math.round((log.frames.at(-1)?.[0] ?? 0) / 100) / 10,
            frames: intervals.length,
            maxMs: Math.round(Math.max(...intervals) * 10) / 10,
            p95Ms: Math.round(percentile(intervals, 0.95) * 10) / 10,
            p99Ms: Math.round(percentile(intervals, 0.99) * 10) / 10,
            over33: intervals.filter((d) => d > 33.4).length,
            over50: intervals.filter((d) => d > 50).length,
            phases,
            marks: log.marks.map(([name, t]) => [name, Math.round(t)]),
            worst,
            longTasks: log.long.slice(0, 12),
            errors,
        };
        results.push(result);
        console.log('[timing]', JSON.stringify(result));
        await browser.close();
    }
    fs.writeFileSync(path.join(out, 'timing.json'), JSON.stringify(results, null, 1));
};

if (mode === 'frames') await recordFrames();
else await recordTiming();
