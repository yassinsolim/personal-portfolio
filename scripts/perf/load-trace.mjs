// load and cache measurements for the homepage and the car click into race
// mode. each run is a fresh browser profile: a cold load, then a repeat visit
// in a new tab of the same profile (warm http cache), and with --race the car
// click from the warm page. per request transfer and cache state come from
// the devtools network domain, milestones from the ui event bus (plain
// document events) and the page's performance entries.
//
//   node scripts/perf/load-trace.mjs --url https://192.168.1.166:8443/
//     [--runs 3] [--profile desktop|mobile|none] [--race] [--hover-ms 600]
//     [--headed] [--label base] [--out .tmp-validation/perf/base.json]
//
// race runs add ?raceDebug=1&mpmock=1 (offline multiplayer mock) and every
// request to supabase.co is aborted, so nothing reaches a live project.
// headless chromium 149 renders on the real gpu (angle metal), and on macos
// it can't reach 127.0.0.1, so serve on the lan ip (serve-build.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const baseUrl = arg('url', 'https://yassin.app/');
const runs = Number(arg('runs', '1'));
const profileName = arg('profile', 'desktop');
const race = flag('race');
const hoverMs = Number(arg('hover-ms', '600'));
const label = arg('label', new URL(baseUrl).host);
const out = arg('out', '');
const settleMs = Number(arg('settle-ms', '4000'));
const executablePath =
    process.env.CHROMIUM_PATH ||
    `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

// lighthouse's throttling numbers, applied rather than simulated
const PROFILES = {
    desktop: { viewport: { width: 1350, height: 940 }, dpr: 1, mobile: false, latency: 40, down: 10240, up: 10240, cpu: 1 },
    mobile: { viewport: { width: 412, height: 823 }, dpr: 1.75, mobile: true, latency: 150, down: 1638.4, up: 750, cpu: 4 },
    none: { viewport: { width: 1350, height: 940 }, dpr: 1, mobile: false, latency: 0, down: -1, up: -1, cpu: 1 },
};
const profile = PROFILES[profileName];
if (!profile) throw new Error(`unknown profile ${profileName}`);

const BUS_EVENTS = [
    'loadedSource',
    'failedSource',
    'loadingScreenDone',
    'raceMode:changed',
    'race:transitionLock',
    'race:transitionReveal',
    'race:transitionSkip',
    'race:lobbyChoice',
    'load:stage',
];

// runs in the top frame only: bus events and performance entries
const initScript = (events) => {
    if (window.top !== window) return;
    const perf = {
        events: [],
        longtasks: [],
        loafs: [],
        lcp: [],
        cls: 0,
        fcp: null,
        interactions: [],
    };
    window.__perf = perf;
    const brief = (detail) => {
        if (!detail || typeof detail !== 'object') return detail ?? null;
        const out = {};
        for (const [key, value] of Object.entries(detail)) {
            if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) out[key] = value;
        }
        return out;
    };
    events.forEach((name) =>
        document.addEventListener(name, (event) =>
            perf.events.push({ name, t: performance.now(), detail: brief(event.detail) })
        )
    );
    // when the monitor's iframe is created and when it has loaded
    new MutationObserver((records, observer) => {
        const frame = document.getElementById('computer-screen');
        if (!frame) return;
        observer.disconnect();
        perf.iframeCreated = performance.now();
        frame.addEventListener('load', () => (perf.iframeLoaded = performance.now()), { once: true });
    }).observe(document, { childList: true, subtree: true });
    const observe = (type, callback, extra = {}) => {
        try {
            new PerformanceObserver((list) => list.getEntries().forEach(callback)).observe({ type, buffered: true, ...extra });
        } catch {
            // not supported here
        }
    };
    perf.marks = [];
    observe('mark', (e) => {
        if (/^(race-transition|load):/.test(e.name)) perf.marks.push({ name: e.name, t: e.startTime });
    });
    observe('longtask', (e) => perf.longtasks.push({ start: e.startTime, duration: e.duration }));
    observe('long-animation-frame', (e) =>
        perf.loafs.push({
            start: e.startTime,
            duration: e.duration,
            blocking: e.blockingDuration,
            scripts: (e.scripts || [])
                .filter((s) => s.duration >= 20)
                .map((s) => ({
                    duration: Math.round(s.duration),
                    invoker: s.invoker,
                    source: (s.sourceURL || '').split('/').pop() + (s.sourceFunctionName ? `:${s.sourceFunctionName}` : ''),
                })),
        })
    );
    observe('largest-contentful-paint', (e) => perf.lcp.push({ t: e.startTime, size: e.size, element: e.element?.tagName || '' }));
    observe('layout-shift', (e) => {
        if (!e.hadRecentInput) perf.cls += e.value;
    });
    observe('paint', (e) => {
        if (e.name === 'first-contentful-paint') perf.fcp = e.startTime;
    });
    observe(
        'event',
        (e) => {
            if (e.interactionId) perf.interactions.push({ name: e.name, t: e.startTime, duration: e.duration });
        },
        { durationThreshold: 16 }
    );
};

const category = (entry) => {
    const url = entry.url;
    if (entry.frame !== 'main' || !url.startsWith(new URL(baseUrl).origin)) return 'iframe';
    if (entry.type === 'Document') return 'html';
    const file = new URL(url).pathname;
    if (/\.wasm$/.test(file)) return 'wasm';
    if (/\.js$/.test(file) || entry.type === 'Script') return 'js';
    if (/\.css$/.test(file)) return 'css';
    if (/\.glb$/.test(file)) return 'model';
    if (/\.(mp4)$/.test(file)) return 'video';
    if (/^\/sounds\//.test(file)) return 'audio';
    if (/\.(jpg|jpeg|png|webp|avif|ktx2|svg|ico)$/.test(file)) return 'image';
    if (/\.json$/.test(file)) return 'data';
    return 'other';
};

const summarizeNetwork = (entries, since = 0) => {
    const list = entries.filter((e) => e.start >= since);
    const byCategory = {};
    let bytes = 0;
    let network = 0;
    let cached = 0;
    let revalidated = 0;
    for (const e of list) {
        const c = category(e);
        byCategory[c] = byCategory[c] || { requests: 0, bytes: 0, cached: 0, revalidated: 0 };
        byCategory[c].requests++;
        byCategory[c].bytes += e.bytes;
        bytes += e.bytes;
        if (e.fromCache) {
            cached++;
            byCategory[c].cached++;
        } else {
            network++;
        }
        if (e.status === 304 || e.revalidated) {
            revalidated++;
            byCategory[c].revalidated++;
        }
    }
    return { requests: list.length, network, cached, revalidated, bytes, byCategory };
};

const tbt = (longtasks, from, to) =>
    longtasks
        .filter((t) => t.start >= from && t.start < to)
        .reduce((sum, t) => sum + Math.max(0, t.duration - 50), 0);

const eventTime = (perf, name, predicate = () => true) =>
    perf.events.find((e) => e.name === name && predicate(e.detail))?.t ?? null;

const attachNetwork = async (page) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    if (profile.latency || profile.down > 0) {
        await cdp.send('Network.emulateNetworkConditions', {
            offline: false,
            latency: profile.latency,
            downloadThroughput: profile.down > 0 ? (profile.down * 1024) / 8 : -1,
            uploadThroughput: profile.up > 0 ? (profile.up * 1024) / 8 : -1,
        });
    }
    if (profile.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
    const { frameTree } = await cdp.send('Page.getFrameTree');
    const mainFrameId = frameTree.frame.id;
    const byId = new Map();
    let origin = null;
    cdp.on('Network.requestWillBeSent', (e) => {
        if (origin === null) origin = e.timestamp;
        const existing = byId.get(e.requestId);
        if (existing && e.redirectResponse) existing.redirects++;
        byId.set(e.requestId, {
            url: e.request.url,
            type: e.type,
            frame: e.frameId === mainFrameId ? 'main' : 'sub',
            start: (e.timestamp - origin) * 1000,
            end: null,
            status: 0,
            bytes: 0,
            fromCache: false,
            cacheControl: '',
            encoding: '',
            mime: '',
            priority: e.request.initialPriority,
            redirects: existing?.redirects || 0,
            failed: '',
        });
    });
    // the raw status: a revalidated response is reported as 200 otherwise
    cdp.on('Network.responseReceivedExtraInfo', (e) => {
        const entry = byId.get(e.requestId);
        if (entry && e.statusCode === 304) entry.revalidated = true;
    });
    cdp.on('Network.requestServedFromCache', (e) => {
        const entry = byId.get(e.requestId);
        if (entry) entry.fromCache = 'memory';
    });
    cdp.on('Network.responseReceived', (e) => {
        const entry = byId.get(e.requestId);
        if (!entry) return;
        const headers = Object.fromEntries(Object.entries(e.response.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
        entry.status = e.response.status;
        entry.mime = e.response.mimeType;
        entry.cacheControl = headers['cache-control'] || '';
        entry.encoding = headers['content-encoding'] || '';
        if (e.response.fromDiskCache) entry.fromCache = 'disk';
        if (e.response.fromServiceWorker) entry.fromCache = 'sw';
        if (e.response.fromPrefetchCache) entry.fromCache = 'prefetch';
    });
    // media keeps streaming past the measurement window, so count as it arrives
    cdp.on('Network.dataReceived', (e) => {
        const entry = byId.get(e.requestId);
        if (entry && entry.end === null) entry.streamed = (entry.streamed || 0) + e.encodedDataLength;
    });
    cdp.on('Network.loadingFinished', (e) => {
        const entry = byId.get(e.requestId);
        if (!entry) return;
        entry.bytes = e.encodedDataLength;
        entry.end = (e.timestamp - origin) * 1000;
    });
    cdp.on('Network.loadingFailed', (e) => {
        const entry = byId.get(e.requestId);
        if (!entry) return;
        entry.failed = e.canceled ? 'canceled' : e.errorText;
        entry.end = (e.timestamp - origin) * 1000;
    });
    // the monitor's iframe runs out of process, so its requests come from
    // playwright's own events instead of this session
    const frames = [];
    page.on('requestfinished', async (request) => {
        if (request.frame() === page.mainFrame()) return;
        try {
            const sizes = await request.sizes();
            const response = await request.response();
            const status = response ? response.status() : 0;
            const body = Math.max(0, sizes.responseBodySize);
            frames.push({
                url: request.url(),
                type: request.resourceType(),
                frame: 'iframe',
                start: null,
                end: null,
                status,
                bytes: body + Math.max(0, sizes.responseHeadersSize),
                // a 200 with no body on the wire came from the http cache
                fromCache: status === 200 && body === 0 ? 'disk' : false,
                cacheControl: response ? (await response.headerValue('cache-control')) || '' : '',
            });
        } catch {
            // the frame went away
        }
    });
    // everything so far, or only what started after a snapshot()
    const list = (since = { own: 0, frames: 0 }) => {
        const own = [...byId.values()].slice(since.own);
        // on yassin.app the iframe is same site and in process, so the
        // session already has its requests
        const seen = new Set([...byId.values()].filter((e) => e.frame !== 'main').map((e) => e.url));
        return [...own, ...frames.slice(since.frames).filter((e) => !seen.has(e.url))]
            .filter((e) => !e.url.startsWith('data:') && !e.url.startsWith('blob:'))
            .map((e) => (e.end === null && e.streamed ? { ...e, bytes: e.streamed, streaming: true } : e));
    };
    return {
        cdp,
        list,
        snapshot: () => ({ own: byId.size, frames: frames.length }),
    };
};

const waitForEvent = (page, name, timeout) =>
    page.waitForFunction(
        (eventName) => Boolean(window.__perf?.events.some((e) => e.name === eventName)),
        name,
        { timeout, polling: 50 }
    );

const loadPage = async (context, url, kind) => {
    const page = await context.newPage();
    const net = await attachNetwork(page);
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text().slice(0, 200));
    });
    const started = Date.now();
    await page.goto(url, { waitUntil: 'commit', timeout: 120000 });
    try {
        await waitForEvent(page, 'loadingScreenDone', 180000);
    } catch {
        errors.push('loadingScreenDone never fired');
    }
    // the camera flies to the idle view after the loading screen; let the
    // page settle so late requests (the monitor iframe) are counted too
    await page.waitForTimeout(settleMs);
    const perf = await page.evaluate(() => window.__perf);
    const nav = await page.evaluate(() => {
        const n = performance.getEntriesByType('navigation')[0];
        return n ? { ttfb: n.responseStart, domContentLoaded: n.domContentLoadedEventEnd, load: n.loadEventEnd } : null;
    });
    const memory = await page.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize : null));
    const list = net.list();
    const firstSource = eventTime(perf, 'loadedSource');
    const lastSource = [...perf.events].reverse().find((e) => e.name === 'loadedSource' || e.name === 'failedSource')?.t ?? null;
    const ready = eventTime(perf, 'loadingScreenDone');
    const lcp = perf.lcp.length ? perf.lcp[perf.lcp.length - 1].t : null;
    const fcp = perf.fcp;
    const result = {
        kind,
        wallMs: Date.now() - started,
        nav,
        fcp,
        lcp,
        cls: Number(perf.cls.toFixed(4)),
        tbtToReady: fcp !== null && ready !== null ? Math.round(tbt(perf.longtasks, fcp, ready + 5000)) : null,
        longtasks: perf.longtasks.length,
        longestTask: Math.round(Math.max(0, ...perf.longtasks.map((t) => t.duration))),
        firstSource,
        resourcesReady: lastSource,
        homepageReady: ready,
        iframeCreated: perf.iframeCreated ?? null,
        iframeLoaded: perf.iframeLoaded ?? null,
        heapBytes: memory,
        network: summarizeNetwork(list),
        requests: list,
        loafs: perf.loafs.filter((l) => l.duration >= 100).slice(0, 40),
        errors,
    };
    return { page, net, result };
};

// a point on the car that the transition's own hit test accepts
const findCarPoint = (page) =>
    page.evaluate(() => {
        const app = window.Application;
        const transition = app?.world?.raceTransition;
        const car = app?.world?.car?.model;
        if (!transition || !car || !transition.canStart()) return null;
        const canvas = app.renderer.instance.domElement;
        const rect = canvas.getBoundingClientRect();
        const center = car.position.clone();
        car.updateMatrixWorld(true);
        car.getWorldPosition(center);
        const p = center.clone().project(app.camera.instance);
        const cx = rect.left + ((p.x + 1) / 2) * rect.width;
        const cy = rect.top + ((1 - p.y) / 2) * rect.height;
        for (let r = 0; r < 200; r += 8) {
            for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
                const x = cx + Math.cos(a) * r;
                const y = cy + Math.sin(a) * r - r * 0.3;
                if (transition.hitsCar(x, y)) return { x, y };
                if (r === 0) break;
            }
        }
        return null;
    });

const measureRace = async (page, net) => {
    const deadline = Date.now() + 30000;
    let point = null;
    while (!point && Date.now() < deadline) {
        point = await findCarPoint(page);
        if (!point) await page.waitForTimeout(250);
    }
    if (!point) return { error: 'car not clickable' };
    const clickSince = (await page.evaluate(() => performance.now())) - 5;
    const before = net.snapshot();
    await page.mouse.move(point.x - 40, point.y);
    await page.mouse.move(point.x, point.y, { steps: 4 });
    const hoverAt = await page.evaluate(() => performance.now());
    if (hoverMs > 0) await page.waitForTimeout(hoverMs);
    // the idle camera sways, so the desk can cover the first point by now
    const onCar = await findCarPoint(page);
    if (onCar && (onCar.x !== point.x || onCar.y !== point.y)) await page.mouse.move(onCar.x, onCar.y);
    const aim = await page.evaluate(({ x, y }) => {
        const t = window.Application?.world?.raceTransition;
        return { canStart: t?.canStart(), hitsCar: t?.hitsCar(x, y), busy: t?.busy };
    }, onCar || point);
    await page.mouse.down();
    const clickAt = await page.evaluate(() => performance.now());
    await page.mouse.up();
    let error = null;
    try {
        await waitForEvent(page, 'race:lobbyChoice', 90000);
    } catch {
        error = 'race:lobbyChoice never fired';
    }
    await page.waitForTimeout(1500);
    const perf = await page.evaluate(() => window.__perf);
    const active = eventTime(perf, 'raceMode:changed', (d) => d && d.active === true);
    const markAt = (name) => perf.marks.find((m) => m.name === name && m.t >= clickSince)?.t ?? null;
    const reveal = eventTime(perf, 'race:transitionReveal') ?? markAt('race-transition:reveal');
    const choice = eventTime(perf, 'race:lobbyChoice');
    const phases = Object.fromEntries(
        perf.marks.filter((m) => m.t >= clickSince).map((m) => [m.name, Math.round(m.t - clickAt)])
    );
    const tasks = perf.longtasks.filter((t) => t.start >= hoverAt);
    const list = net.list(before);
    return {
        error,
        aim: { first: point, again: onCar, ...aim },
        hoverMs,
        clickToActive: active !== null ? Math.round(active - clickAt) : null,
        clickToReveal: reveal !== null ? Math.round(reveal - clickAt) : null,
        clickToDrive: choice !== null ? Math.round(choice - clickAt) : null,
        phases,
        longtasks: tasks.length,
        longestTask: Math.round(Math.max(0, ...tasks.map((t) => t.duration))),
        blockingMs: Math.round(tasks.reduce((s, t) => s + Math.max(0, t.duration - 50), 0)),
        network: summarizeNetwork(list),
        requests: list,
        loafs: perf.loafs.filter((l) => l.start >= clickSince && l.duration >= 100).slice(0, 40),
        interactions: perf.interactions.filter((i) => i.t >= clickSince - 10),
    };
};

// chrome doesn't cache anything from a host whose certificate error was
// ignored, so the local server's certificate is trusted by its key instead
// (--spki, from: openssl x509 -pubkey -noout -in cert.pem | openssl pkey
// -pubin -outform der | openssl dgst -sha256 -binary | base64)
// supabase is blocked in dns, not with playwright's routing, which turns the
// http cache off and would make every warm load look cold
const spki = arg('spki', '');
const launch = () =>
    chromium.launch({
        executablePath,
        headless: !flag('headed'),
        args: [
            '--host-resolver-rules=MAP *.supabase.co ~NOTFOUND',
            ...(spki ? [`--ignore-certificate-errors-spki-list=${spki}`] : []),
        ],
    });

const results = [];
for (let run = 0; run < runs; run++) {
    const browser = await launch();
    const context = await browser.newContext({
        viewport: profile.viewport,
        deviceScaleFactor: profile.dpr,
        isMobile: profile.mobile,
        hasTouch: profile.mobile,
    });
    await context.addInitScript(initScript, BUS_EVENTS);
    const url = new URL(baseUrl);
    if (race) {
        url.searchParams.set('raceDebug', '1');
        url.searchParams.set('mpmock', '1');
    }
    const cold = await loadPage(context, url.toString(), 'cold');
    await cold.page.close();
    const warm = await loadPage(context, url.toString(), 'warm');
    let raceResult = null;
    if (race && !profile.mobile) raceResult = await measureRace(warm.page, warm.net);
    await warm.page.close();
    await browser.close();
    const supabase = [cold.result, warm.result, raceResult]
        .flatMap((r) => r?.requests || [])
        .filter((e) => /supabase\.co/.test(e.url)).length;
    results.push({ run, cold: cold.result, warm: warm.result, race: raceResult, supabaseBlocked: supabase });
    const c = cold.result;
    const w = warm.result;
    console.log(
        `[${label} ${profileName} run ${run + 1}/${runs}] cold ${c.network.requests} req ${(c.network.bytes / 1024).toFixed(0)} KiB` +
            ` fcp ${c.fcp?.toFixed(0)} lcp ${c.lcp?.toFixed(0)} ready ${c.homepageReady?.toFixed(0)} tbt ${c.tbtToReady}` +
            ` | warm ${w.network.requests} req (${w.network.network} net, ${w.network.revalidated} 304) ${(w.network.bytes / 1024).toFixed(0)} KiB ready ${w.homepageReady?.toFixed(0)}` +
            (raceResult ? ` | race drive ${raceResult.clickToDrive} reveal ${raceResult.clickToReveal} ${(raceResult.network.bytes / 1024).toFixed(0)} KiB` : '') +
            (c.errors.length || w.errors.length ? ` errors ${c.errors.length + w.errors.length}` : '')
    );
}

const median = (values) => {
    const list = values.filter((v) => typeof v === 'number').sort((a, b) => a - b);
    if (!list.length) return null;
    const mid = Math.floor(list.length / 2);
    return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
};
const pick = (kind, key) => median(results.map((r) => (typeof key === 'function' ? key(r[kind]) : r[kind]?.[key])));
const summary = {
    label,
    url: baseUrl,
    profile: profileName,
    runs,
    cold: {
        requests: pick('cold', (r) => r.network.requests),
        kib: pick('cold', (r) => r.network.bytes / 1024),
        fcp: pick('cold', 'fcp'),
        lcp: pick('cold', 'lcp'),
        cls: pick('cold', 'cls'),
        tbtToReady: pick('cold', 'tbtToReady'),
        resourcesReady: pick('cold', 'resourcesReady'),
        homepageReady: pick('cold', 'homepageReady'),
    },
    warm: {
        requests: pick('warm', (r) => r.network.requests),
        networkRequests: pick('warm', (r) => r.network.network),
        revalidated: pick('warm', (r) => r.network.revalidated),
        kib: pick('warm', (r) => r.network.bytes / 1024),
        resourcesReady: pick('warm', 'resourcesReady'),
        homepageReady: pick('warm', 'homepageReady'),
    },
    race: race
        ? {
              clickToActive: pick('race', 'clickToActive'),
              clickToReveal: pick('race', 'clickToReveal'),
              clickToDrive: pick('race', 'clickToDrive'),
              blockingMs: pick('race', 'blockingMs'),
              longestTask: pick('race', 'longestTask'),
              kib: pick('race', (r) => (r ? r.network.bytes / 1024 : null)),
          }
        : null,
};
console.log(JSON.stringify(summary, null, 1));
if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ summary, results }, null, 1));
    console.log(`[load-trace] wrote ${out}`);
}
