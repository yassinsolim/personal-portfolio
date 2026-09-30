// counts realtime messages per minute for 1, 2 and 4 cars in a lobby, against
// the in browser mock (?mpmock=1), never the live supabase project. every
// window drives side by side on doettinger hoehe for 30 s, then parks for 15.
// it also reports how far remote cars are drawn from where they really are.
//
//   npm run build && node scripts/race-mp-traffic.mjs --url http://<lan-ip>:<port>/ [--netsim 0.2,120,80] [--cases 1,2,4]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const base = opt('url', 'http://127.0.0.1:8080/');
const netsim = opt('netsim', '');
const cases = opt('cases', '1,2,4').split(',').map(Number);
const out = opt('out', '.tmp-validation/mp-traffic.json');
const DRIVE_MS = 30000;
const PARK_MS = 15000;

const cache = path.join(process.env.HOME, 'Library/Caches/ms-playwright');
const dir = fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))[0];
const exe = path.join(cache, dir, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const url = `${base}?raceDebug=1&mpmock=1&raceTier=low${netsim ? `&netsim=${netsim}` : ''}`;

const statsOf = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__mpStats || { sent: { broadcast: 0, presence: 0 }, received: { broadcast: 0, presence: 0 }, byEvent: {} })));
const zero = () => ({ sent: { broadcast: 0, presence: 0 }, received: { broadcast: 0, presence: 0 }, byEvent: {} });
const diff = (a, b) => ({
    sent: { broadcast: b.sent.broadcast - a.sent.broadcast, presence: b.sent.presence - a.sent.presence },
    received: { broadcast: b.received.broadcast - a.received.broadcast, presence: b.received.presence - a.received.presence },
    byEvent: Object.fromEntries(Object.keys(b.byEvent).map((k) => [k, b.byEvent[k] - (a.byEvent[k] || 0)])),
});
const sum = (list) => list.reduce((acc, s) => {
    acc.sent.broadcast += s.sent.broadcast; acc.sent.presence += s.sent.presence;
    acc.received.broadcast += s.received.broadcast; acc.received.presence += s.received.presence;
    Object.entries(s.byEvent).forEach(([k, v]) => { acc.byEvent[k] = (acc.byEvent[k] || 0) + v; });
    return acc;
}, zero());
const perMinute = (s, ms) => {
    const k = 60000 / ms;
    const sent = (s.sent.broadcast + s.sent.presence) * k;
    const received = (s.received.broadcast + s.received.presence) * k;
    return { sent: Math.round(sent), received: Math.round(received), billed: Math.round(sent + received), byEvent: Object.fromEntries(Object.entries(s.byEvent).map(([e, v]) => [e, Math.round(v * k)])) };
};

const runCase = async (n) => {
    const browser = await chromium.launch({ executablePath: exe, headless: false, args: ['--use-angle=metal', '--window-size=640,400', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
    const context = await browser.newContext({ viewport: { width: 640, height: 360 } });
    // belt and braces: nothing may reach a real supabase project
    let blocked = 0;
    await context.route(/supabase\.(co|in)/, (route) => { blocked++; return route.abort(); });
    if (context.routeWebSocket) await context.routeWebSocket(/supabase\.(co|in)/, (ws) => { blocked++; ws.close(); });
    const pages = [];
    for (let i = 0; i < n; i++) pages.push(await context.newPage());
    const errors = [];
    pages.forEach((p, i) => p.on('pageerror', (e) => errors.push(`${i}: ${String(e).slice(0, 160)}`)));
    const enter = async (p) => {
        await p.goto(url, { waitUntil: 'domcontentloaded' });
        // small screens fold the room panel to its menu button
        await p.locator('.look-hint').waitFor({ timeout: 90000 });
        if (await p.locator('.look-hint.folded').count()) await p.locator('.look-hint-menu').click();
        await p.getByRole('button', { name: /^Play Solo$/ }).waitFor({ timeout: 90000 });
        await p.waitForTimeout(600);
        await p.getByRole('button', { name: /^Play Solo$/ }).click();
        await p.waitForFunction(() => { const rm = window.Application?.world?.raceManager; return Boolean(rm?.active && rm.vehicle?.carModel); }, null, { timeout: 120000 });
    };
    for (const p of pages) await enter(p);
    await pages[0].evaluate(() => document.dispatchEvent(new CustomEvent('race:multiplayerCreateLobby', { detail: { playerName: 'Count A' } })));
    await pages[0].waitForFunction(() => window.Application.world.raceManager.multiplayer.getState().connected, null, { timeout: 20000 });
    const code = await pages[0].evaluate(() => window.Application.world.raceManager.multiplayer.getState().lobbyCode);
    for (let i = 1; i < n; i++) {
        await pages[i].evaluate(([lobbyCode, name]) => document.dispatchEvent(new CustomEvent('race:multiplayerJoinLobby', { detail: { playerName: name, lobbyCode } })), [code, `Count ${i}`]);
    }
    await Promise.all(pages.map((p) => p.waitForFunction((count) => window.Application.world.raceManager.multiplayer.getState().players.length >= count, n, { timeout: 30000 })));
    // side by side with a lane keeping autopilot
    await Promise.all(pages.map((p, i) => p.evaluate(([back, lane]) => {
        const rm = window.Application.world.raceManager; const v = rm.vehicle; const tr = rm.track;
        const curve = tr.getCurve(); const t = (17200 - back) / tr.length;
        const pt = curve.getPointAt(t); const d = curve.getTangentAt(t);
        const n = Math.hypot(d.x, d.z); pt.x += (d.z / n) * lane; pt.z += (-d.x / n) * lane;
        v.teleport(pt, Math.atan2(d.x, d.z), 150 / 3.6);
        const frame = { point: pt.clone() }; const last = { x: pt.x, z: pt.z }; const dir = { x: d.x / n, z: d.z / n };
        window.__drive = true;
        v.input.update = () => {};
        v.input.getState = () => {
            if (!window.__drive) return { throttle: 0, brake: 1, steer: 0, handbrake: 1 };
            const f = tr.queryFrame(v.position.x, v.position.z, frame);
            const dx = v.position.x - last.x, dz = v.position.z - last.z; const sp = Math.hypot(dx, dz);
            if (sp > 0.05) { dir.x = dx / sp; dir.z = dz / sp; last.x = v.position.x; last.z = v.position.z; }
            const cross = f.tangentX * dir.z - f.tangentZ * dir.x;
            return { throttle: 0.55, brake: 0, steer: -Math.max(-1, Math.min(1, (f.lateral - lane) * 0.12 + cross * 2.2)), handbrake: 0 };
        };
        // own pose and remotes as drawn, on the shared clock
        window.__log = { own: [], seen: [] };
        const me = rm.multiplayer.getState().localSessionId;
        window.__me = me;
        const loop = () => {
            const now = Date.now();
            window.__log.own.push([now, v.position.x, v.position.z]);
            rm.remoteVehicles.forEach((vis, id) => window.__log.seen.push([now, id, vis.root.position.x, vis.root.position.z]));
            if (window.__log.own.length < 20000) requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }, [i * 14, i % 2 ? 2.4 : -2.4])));
    await pages[0].waitForTimeout(1500);
    const s0 = await Promise.all(pages.map(statsOf));
    await pages[0].waitForTimeout(DRIVE_MS);
    const s1 = await Promise.all(pages.map(statsOf));
    await Promise.all(pages.map((p) => p.evaluate(() => { window.__drive = false; })));
    await pages[0].waitForTimeout(3000);
    const s2 = await Promise.all(pages.map(statsOf));
    await pages[0].waitForTimeout(PARK_MS);
    const s3 = await Promise.all(pages.map(statsOf));
    // a hidden tab disconnects, then rejoins when it's shown again
    let hidden = null;
    if (n >= 2) {
        const setVisible = (p, visible) => p.evaluate((v) => {
            Object.defineProperty(document, 'visibilityState', { value: v ? 'visible' : 'hidden', configurable: true });
            document.dispatchEvent(new Event('visibilitychange'));
        }, visible);
        await setVisible(pages[1], false);
        await pages[0].waitForTimeout(2000);
        const h0 = await Promise.all(pages.map(statsOf));
        await pages[0].waitForTimeout(10000);
        const h1 = await Promise.all(pages.map(statsOf));
        const hiddenConnected = await pages[1].evaluate(() => window.Application.world.raceManager.multiplayer.getState().connected);
        await setVisible(pages[1], true);
        const rejoined = await pages[1].waitForFunction((count) => { const s = window.Application.world.raceManager.multiplayer.getState(); return s.connected && s.players.length >= count; }, n, { timeout: 20000 }).then(() => true).catch(() => false);
        hidden = { perMinuteWhileHidden: perMinute(sum(h0.map((a, i) => diff(a, h1[i]))), 10000), hiddenTabConnected: hiddenConnected, rejoined };
    }
    // remote position error while driving
    const logs = await Promise.all(pages.map((p) => p.evaluate(() => ({ me: window.__me, ...window.__log }))));
    const truth = Object.fromEntries(logs.map((l) => [l.me, l.own]));
    const at = (rows, t) => {
        let lo = 0, hi = rows.length - 1;
        if (!rows.length || t <= rows[0][0] || t >= rows[hi][0]) return null;
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (rows[m][0] <= t) lo = m; else hi = m; }
        const a = rows[lo], b = rows[hi], k = (t - a[0]) / Math.max(1, b[0] - a[0]);
        return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    };
    const err = [];
    logs.forEach((l) => l.seen.forEach(([t, id, x, z]) => { const r = truth[id] && at(truth[id], t); if (r) err.push(Math.hypot(r[0] - x, r[1] - z)); }));
    err.sort((a, b) => a - b);
    const pct = (p) => (err.length ? +err[Math.min(err.length - 1, Math.floor(p * err.length))].toFixed(2) : null);
    await browser.close();
    return {
        cars: n,
        driving: perMinute(sum(s0.map((a, i) => diff(a, s1[i]))), DRIVE_MS),
        parked: perMinute(sum(s2.map((a, i) => diff(a, s3[i]))), PARK_MS),
        remoteErrorM: n > 1 ? { p50: pct(0.5), p95: pct(0.95), max: pct(1) } : null,
        hiddenTab: hidden,
        blockedSupabaseRequests: blocked,
        errors,
    };
};

const results = [];
for (const n of cases) {
    const result = await runCase(n);
    results.push(result);
    console.log(JSON.stringify(result));
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ url, netsim, results }, null, 2));
process.exit(0);
