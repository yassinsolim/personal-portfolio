// records and times the loading screens (?loader=bios|monitor|terminal|pipeline).
//
//   --mode frames   real time: chromium's screencast (a frame per compositor
//                   frame) resampled to a steady 60 fps. no clock tricks, so
//                   stalls are frozen frames and every number on screen is
//                   real (a virtual clock would show 0 ms for main thread work
//                   and put resource timing on a different clock). writes
//                   frames/, loader.mp4, loader.webp (small, for inline use)
//                   and strip.jpg
//   --mode timing   real time, no clock tricks: navigation to loader ready and
//                   to loadingScreenDone, the load stages, long tasks and
//                   frame times. --variants a,b runs them interleaved, --runs
//                   pairs of each
//
//   node scripts/loader-record.mjs --url https://192.168.1.166:8601/ --loader monitor --out ../media/monitor-first
//   node scripts/loader-record.mjs --url ... --loader terminal --returning
//   node scripts/loader-record.mjs --url ... --mode timing --variants bios,monitor,terminal,pipeline --runs 3
//   options: --net 50,40 (Mbps, rtt ms; 0 = unthrottled) --cpu 4 --tier low
//            --browser webkit --reduced-motion --width 390 --height 844 --dpr 3 --mobile
//
// a self signed https server needs --spki <base64 sha256 of its key> (chromium
// then treats it as trusted, so the http cache works for returning visits)

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
const baseUrl = opt('url', 'https://192.168.1.166:8601/');
const mode = opt('mode', 'frames');
const out = path.resolve(opt('out', '.tmp-validation/loader'));
const browserName = opt('browser', 'chromium');
const reducedMotion = Boolean(opt('reduced-motion', false));
const width = Number(opt('width', 1512));
const height = Number(opt('height', 900));
const dpr = Number(opt('dpr', 2));
const mobile = Boolean(opt('mobile', false));
const fps = Number(opt('fps', 60));
const runs = Number(opt('runs', 1));
const returning = Boolean(opt('returning', false));
const cpu = Number(opt('cpu', 1));
const tier = opt('tier', '');
const spki = opt('spki', '');
const [netMbps, netRtt] = String(opt('net', '50,40')).split(',').map(Number);
const tail = Number(opt('tail', 90));
const pressAfter = Number(opt('press-after', 700));
const label = opt('label', '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(out, { recursive: true });

// --main-url: another build to time, as the variant 'main' (its default
// loader) or 'before' (its hybrid, measured like this build's)
const mainUrl = opt('main-url', '');
const kindOf = (variant) => (variant === 'before' ? 'hybrid' : variant);
// the inline webp's size cap, in MB
const webpMax = Number(opt('webp-max', 4.9));

const pageUrl = (variant) => {
    const url = new URL((variant === 'main' || variant === 'before') && mainUrl ? mainUrl : baseUrl);
    // the hybrid is the default now: bios has to be asked for
    if (variant && variant !== 'main') url.searchParams.set('loader', kindOf(variant));
    if (tier) url.searchParams.set('raceTier', tier);
    return url.toString();
};

const findChromium = () => {
    if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
    const cache = path.join(process.env.HOME || '', 'Library/Caches/ms-playwright');
    const dirs = fs
        .readdirSync(cache)
        .filter((d) => /^chromium-\d+$/.test(d))
        .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const dir of dirs) {
        const exe = path.join(cache, dir, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
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
                  '--use-angle=metal',
                  '--ignore-gpu-blocklist',
                  '--enable-gpu-rasterization',
                  '--disable-background-timer-throttling',
                  '--disable-backgrounding-occluded-windows',
                  '--disable-renderer-backgrounding',
                  ...(spki ? [`--ignore-certificate-errors-spki-list=${spki}`] : []),
                  `--window-size=${width},${height + 90}`,
              ],
          });

// marks and events for both modes
const probes = () => {
    if (window.__probed) return;
    window.__probed = true;
    window.__marks = [];
    const add = (name) => window.__marks.push([name, performance.now()]);
    document.addEventListener('loadingScreenDone', () => add('loadingScreenDone'));
    document.addEventListener('loading:stage', (e) => {
        if (e.detail?.doneAt) add(`stage:${e.detail.name}`);
    });
    // every frame interval and long task from navigation on
    const log = { frames: [], long: [] };
    window.__frames = log;
    let last = 0;
    const loop = (now) => {
        if (last) log.frames.push([now, now - last]);
        last = now;
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    try {
        new PerformanceObserver((list) =>
            list.getEntries().forEach((e) => log.long.push([Math.round(e.startTime), Math.round(e.duration)]))
        ).observe({ entryTypes: ['longtask'] });
    } catch {
        // webkit has no long task timing
    }
};

const newContext = async (browser, extra = {}) => {
    const context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: dpr,
        isMobile: mobile && browserName === 'chromium' ? true : undefined,
        hasTouch: mobile || undefined,
        reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
        ignoreHTTPSErrors: !spki || browserName === 'webkit',
        ...extra,
    });
    await context.addInitScript(probes);
    return context;
};

// chromium only: the network profile and the cpu slowdown, through cdp
const throttle = async (context, page) => {
    if (browserName !== 'chromium') return null;
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    if (netMbps > 0) {
        await cdp.send('Network.emulateNetworkConditions', {
            offline: false,
            latency: netRtt || 0,
            downloadThroughput: (netMbps * 1e6) / 8,
            uploadThroughput: (netMbps * 1e6) / 8 / 4,
        });
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: Math.max(1, cpu) });
    return { cdp };
};

// a real time visit that finishes the intro, to warm the cache for --returning
const warmVisit = async (page, variant) => {
    await page.goto(pageUrl(variant), { waitUntil: 'domcontentloaded', timeout: 180000 });
    await page.waitForFunction(
        (v) => (v === 'monitor' ? performance.getEntriesByName('loader:ready').length > 0 : window.__marks.some(([m]) => m === 'loadingScreenDone')),
        variant,
        { timeout: 180000 }
    );
    if (variant === 'monitor') {
        await sleep(300);
        await page.keyboard.press('Space');
    }
    await sleep(4000);
};

// real time: cdp screencast (chromium sends a frame per compositor frame,
// about 85 a second here) resampled to a steady 60 fps, so stalls show as the
// frozen frames they are and every number on screen is the real one. webkit
// has no screencast, it gets playwright's own video (about 25 fps)
const recordFrames = async (variant) => {
    const browser = await launch();
    const dir = path.join(out, 'frames');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const webkitVideo = browserName === 'webkit' ? path.join(out, 'webkit-video') : '';
    const context = await newContext(
        browser,
        webkitVideo ? { recordVideo: { dir: webkitVideo, size: { width, height } } } : {}
    );
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 300)));
    // no page.route here: playwright turns the http cache off for routed
    // pages, and the homepage doesn't reach supabase before a race anyway
    if (returning) {
        await warmVisit(page, variant);
        await page.goto('about:blank');
    }
    const net = await throttle(context, page);
    const shots = [];
    let writes = Promise.resolve();
    if (net) {
        net.cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
            const index = shots.length;
            const file = path.join(dir, `raw-${String(index).padStart(5, '0')}.jpg`);
            shots.push({ t: metadata.timestamp, file });
            writes = writes.then(() => fs.promises.writeFile(file, Buffer.from(data, 'base64')));
            net.cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
        });
        await net.cdp.send('Page.startScreencast', {
            format: 'jpeg',
            quality: 88,
            maxWidth: width,
            maxHeight: height,
            everyNthFrame: 1,
        });
    }
    const startedAt = Date.now() / 1000;
    await page.goto(pageUrl(variant), { waitUntil: 'commit', timeout: 180000 });
    const mark = (name) =>
        page.evaluate((n) => performance.getEntriesByName(`loader:${n}`).length > 0 || window.__marks.some(([m]) => m === n), name);
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline && !(await mark(variant === 'monitor' ? 'ready' : 'loadingScreenDone').catch(() => false))) {
        await sleep(50);
    }
    if (variant === 'monitor') {
        await sleep(pressAfter);
        await page.keyboard.press('Space');
    }
    const end = kindOf(variant) === 'hybrid' ? 'os' : variant === 'monitor' || variant === 'pipeline' ? 'handoff' : 'loadingScreenDone';
    // a missing end mark shouldn't make a two minute recording
    const endBy = Date.now() + 25000;
    while (Date.now() < endBy && !(await mark(end).catch(() => false))) await sleep(50);
    await sleep((variant === 'bios' || variant === 'terminal' ? tail + 90 : tail) * (1000 / fps));
    const timeline = await page.evaluate(() => ({
        origin: performance.timeOrigin,
        marks: [
            ...window.__marks,
            ...performance.getEntriesByType('mark').filter((m) => m.name.startsWith('loader:')).map((m) => [m.name.slice(7), m.startTime]),
        ].map(([n, t]) => [n, Math.round(t)]),
    }));
    if (net) await net.cdp.send('Page.stopScreencast').catch(() => {});
    await writes;
    await context.close();
    await browser.close();

    let count = 0;
    if (net) {
        // steady 60 fps from navigation: each slot shows the newest frame
        const t0 = timeline.origin / 1000;
        const until = shots.length ? shots[shots.length - 1].t : t0;
        let j = 0;
        for (let slot = 0; t0 + slot / fps <= until; slot++) {
            const at = t0 + slot / fps;
            while (j + 1 < shots.length && shots[j + 1].t <= at) j++;
            const target = path.join(dir, `${String(slot).padStart(4, '0')}.jpg`);
            if (shots[j] && shots[j].t <= at) fs.copyFileSync(shots[j].file, target);
            else writeBlack(target);
            count = slot + 1;
        }
        shots.forEach((s) => fs.rmSync(s.file, { force: true }));
    } else {
        const video = fs.readdirSync(webkitVideo).find((f) => f.endsWith('.webm'));
        run('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(webkitVideo, video), '-vf', `fps=${fps},scale=${width}:-2`, '-q:v', '3', path.join(dir, '%04d.jpg')]);
        count = fs.readdirSync(dir).filter((f) => /^\d+\.jpg$/.test(f)).length;
        // ffmpeg numbers from 1
        for (let i = 1; i <= count; i++) {
            fs.renameSync(path.join(dir, `${String(i).padStart(4, '0')}.jpg`), path.join(dir, `${String(i - 1).padStart(4, '0')}.jpg`));
        }
        fs.rmSync(webkitVideo, { recursive: true, force: true });
    }
    const marks = Object.fromEntries(timeline.marks.map(([n, t]) => [n, Math.round((t / 1000) * fps)]));
    fs.writeFileSync(
        path.join(out, 'frames.json'),
        JSON.stringify({ variant, returning, fps, frames: count, captured: shots.length, marksMs: Object.fromEntries(timeline.marks), marksFrame: marks, errors, label, net: [netMbps, netRtt], cpu, browser: browserName, startedAt }, null, 1)
    );
    console.log('[record]', variant, returning ? 'returning' : 'first', browserName, 'frames', count, 'captured', shots.length, 'marks(ms)', JSON.stringify(Object.fromEntries(timeline.marks)), 'errors', errors.length);
    encode(dir, count);
};

const writeBlack = (file) => {
    if (!writeBlack.buffer) {
        run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}`, '-frames:v', '1', file]);
        writeBlack.buffer = fs.readFileSync(file);
        return;
    }
    fs.writeFileSync(file, writeBlack.buffer);
};

const run = (cmd, argv) => execFileSync(cmd, argv, { stdio: ['ignore', 'ignore', 'pipe'] });

const encode = (dir, count) => {
    const mp4 = path.join(out, 'loader.mp4');
    run('ffmpeg', [
        '-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(dir, '%04d.jpg'),
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', mp4,
    ]);
    // the inline copy: smaller and 30 fps, under --webp-max
    const small = path.join(out, 'small');
    const webp = path.join(out, 'loader.webp');
    let quality = 60;
    let scaleWidth = Math.min(width, 756);
    let rate = 30;
    for (;;) {
        fs.rmSync(small, { recursive: true, force: true });
        fs.mkdirSync(small, { recursive: true });
        run('ffmpeg', [
            '-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(dir, '%04d.jpg'),
            '-vf', `fps=${rate},scale=${scaleWidth}:-2:flags=lanczos`, '-q:v', '3', path.join(small, '%04d.jpg'),
        ]);
        const frames = fs.readdirSync(small).filter((f) => f.endsWith('.jpg')).sort();
        run('img2webp', ['-loop', '0', '-lossy', '-q', String(quality), '-m', '4', '-d', String(Math.round(1000 / rate)), ...frames.map((f) => path.join(small, f)), '-o', webp]);
        const size = fs.statSync(webp).size;
        if (size < webpMax * 1e6) break;
        if (quality > 36) quality -= 8;
        else if (rate > 20) rate = 20;
        else if (scaleWidth > 480) scaleWidth = Math.round(scaleWidth * 0.8);
        else break;
    }
    // eight evenly spaced frames, two rows
    const picks = Array.from({ length: 8 }, (_, i) => Math.round(((count - 1) * i) / 7));
    const inputs = [];
    picks.forEach((n) => inputs.push('-i', path.join(dir, `${String(n).padStart(4, '0')}.jpg`)));
    const tileWidth = Math.round(Math.min(width, 756));
    const scaled = picks.map((_, i) => `[${i}:v]scale=${tileWidth}:-2[s${i}]`).join(';');
    run('ffmpeg', [
        '-y', '-loglevel', 'error', ...inputs,
        '-filter_complex', `${scaled};${picks.map((_, i) => `[s${i}]`).join('')}xstack=inputs=8:layout=0_0|w0_0|w0+w1_0|w0+w1+w2_0|0_h0|w0_h0|w0+w1_h0|w0+w1+w2_h0[out]`,
        '-map', '[out]', '-q:v', '3', path.join(out, 'strip.jpg'),
    ]);
    fs.writeFileSync(path.join(out, 'strip.json'), JSON.stringify({ picks, fps }, null, 1));
    fs.rmSync(small, { recursive: true, force: true });
    const mb = (file) => (fs.statSync(file).size / 1e6).toFixed(2);
    console.log(`[record] ${mp4} ${mb(mp4)} MB, ${webp} ${mb(webp)} MB (q ${quality}, ${rate} fps, ${scaleWidth} px), ${path.join(out, 'strip.jpg')}`);
};

const percentile = (values, p) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
};

const timeOnce = async (variant) => {
    const browser = await launch();
    const context = await newContext(browser);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
    await throttle(context, page);
    if (returning) {
        await warmVisit(page, variant);
        await page.goto('about:blank');
    }
    const load = execFileSync('sysctl', ['-n', 'vm.loadavg']).toString().trim();
    await page.goto(pageUrl(variant), { waitUntil: 'commit', timeout: 180000 });
    const readyMark = variant === 'monitor' ? 'ready' : null;
    await page.waitForFunction(
        (m) => (m ? performance.getEntriesByName(`loader:${m}`).length > 0 : window.__marks.some(([n]) => n === 'loadingScreenDone')),
        readyMark,
        { timeout: 180000 }
    );
    if (variant === 'monitor') await page.keyboard.press('Space');
    // the outro: until the room is handed over, then two seconds of it
    await page.waitForFunction(
        (v) =>
            v === 'monitor' || v === 'pipeline' || v === 'hybrid'
                ? performance.getEntriesByName(v === 'hybrid' ? 'loader:os' : 'loader:handoff').length > 0
                : window.__marks.some(([n]) => n === 'loadingScreenDone'),
        kindOf(variant),
        { timeout: 60000 }
    );
    await sleep(2000);
    const data = await page.evaluate(() => ({
        marks: window.__marks,
        user: performance.getEntriesByType('mark').filter((m) => m.name.startsWith('loader:')).map((m) => [m.name.slice(7), m.startTime]),
        frames: window.__frames.frames,
        long: window.__frames.long,
        nav: (() => {
            const n = performance.getEntriesByType('navigation')[0];
            return n ? { responseEnd: n.responseEnd, domContentLoaded: n.domContentLoadedEventEnd } : null;
        })(),
        // a 304 moves headers only (and images report no body sizes at all)
        cached: performance
            .getEntriesByType('resource')
            .filter((r) =>
                r.transferSize === 0
                    ? r.encodedBodySize > 0 || r.decodedBodySize > 0
                    : r.encodedBodySize <= 0
                      ? r.transferSize < 2048
                      : r.transferSize < r.encodedBodySize / 2
            ).length,
        resources: performance.getEntriesByType('resource').length,
    }));
    await browser.close();
    const at = Object.fromEntries([...data.marks, ...data.user].map(([n, t]) => [n, Math.round(t)]));
    const interactive = variant === 'monitor' ? at.ready : at.loadingScreenDone;
    const after = data.frames.filter(([t]) => t > interactive).map(([, d]) => d);
    const before = data.frames.filter(([t]) => t <= interactive).map(([, d]) => d);
    const longAfter = data.long.filter(([t]) => t > interactive).map(([, d]) => d);
    const longBefore = data.long.filter(([t]) => t <= interactive).map(([, d]) => d);
    // the hybrid's pull-back: from the release to the camera settling
    const pullEnd = kindOf(variant) === 'hybrid' ? at.os : undefined;
    const pull = pullEnd ? data.frames.filter(([t]) => t > interactive && t <= pullEnd).map(([, d]) => d) : [];
    return {
        variant,
        returning,
        load,
        interactive,
        marks: at,
        cached: `${data.cached}/${data.resources}`,
        loaderFramesMaxMs: Math.round(Math.max(0, ...before)),
        loaderLongMaxMs: Math.max(0, ...longBefore),
        loaderLongCount: longBefore.filter((d) => d > 50).length,
        outroFramesMaxMs: Math.round(Math.max(0, ...after)),
        outroP95Ms: Math.round(percentile(after, 0.95) * 10) / 10,
        outroOver33: after.filter((d) => d > 33.4).length,
        outroLongMaxMs: Math.max(0, ...longAfter),
        pullbackMs: pullEnd ? pullEnd - interactive : null,
        pullFrames: pull.length,
        pullFramesMaxMs: Math.round(Math.max(0, ...pull) * 10) / 10,
        pullP95Ms: Math.round(percentile(pull, 0.95) * 10) / 10,
        pullOver33: pull.filter((d) => d > 33.4).length,
        errors,
    };
};

if (mode === 'frames') {
    await recordFrames(opt('loader', 'bios'));
} else {
    const variants = String(opt('variants', opt('loader', 'bios'))).split(',');
    const results = [];
    for (let r = 0; r < runs; r++) {
        for (const variant of variants) {
            const result = await timeOnce(variant);
            results.push(result);
            console.log('[timing]', JSON.stringify(result));
        }
    }
    fs.writeFileSync(path.join(out, `timing${label ? `-${label}` : ''}.json`), JSON.stringify(results, null, 1));
}
