// how other players' cars are drawn: two windows in the in browser mock lobby
// (?mpmock=1, never the live supabase project). one drives a hilly, twisty
// stretch on rails (exact pose, speed from the bend ahead), the other logs its
// car as drawn: how far under or over the road, past the armco, and off the
// real spot. then the driver pauses at speed in a bend (nothing is sent while
// paused) and later respawns 60 m back from out by the armco.
//
//   npm run build && node scripts/race-mp-remote.mjs --url http://<lan-ip>:<port>/ [--netsim 0.05,150,80] [--start Hatzenbach]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const base = opt('url', 'http://127.0.0.1:8080/');
const netsim = opt('netsim', '0.05,150,80');
const start = opt('start', 'Hatzenbach');
const out = opt('out', '.tmp-validation/mp-remote.json');
const DRIVE_MS = 40000;
const BACK_M = 200;
const MAX_MPS = 36;

const cache = path.join(process.env.HOME, 'Library/Caches/ms-playwright');
const dir = fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))[0];
const exe = path.join(cache, dir, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const url = `${base}?raceDebug=1&mpmock=1&raceTier=low${netsim ? `&netsim=${netsim}` : ''}`;

const browser = await chromium.launch({
    executablePath: exe,
    headless: true,
    args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});
const context = await browser.newContext({ viewport: { width: 640, height: 360 } });
// belt and braces: nothing may reach a real supabase project
await context.route(/supabase\.(co|in)/, (route) => route.abort());
const watcher = await context.newPage();
const driver = await context.newPage();
const errors = [];
[watcher, driver].forEach((p, i) => p.on('pageerror', (e) => errors.push(`${i}: ${String(e).slice(0, 200)}`)));
const enter = async (p) => {
    await p.goto(url, { waitUntil: 'domcontentloaded' });
    await p.locator('.look-hint').waitFor({ timeout: 90000 });
    if (await p.locator('.look-hint.folded').count()) await p.locator('.look-hint-menu').click();
    await p.waitForTimeout(600);
    await p.evaluate(() => [...document.querySelectorAll('.look-hint button')].find((b) => b.textContent.trim() === 'Play Solo').click());
    await p.waitForFunction(() => { const rm = window.Application?.world?.raceManager; return Boolean(rm?.active && rm.vehicle?.carModel); }, null, { timeout: 120000 });
};
await enter(watcher);
await enter(driver);
await watcher.evaluate(() => document.dispatchEvent(new CustomEvent('race:multiplayerCreateLobby', { detail: { playerName: 'Watch' } })));
await watcher.waitForFunction(() => window.Application.world.raceManager.multiplayer.getState().connected, null, { timeout: 20000 });
const code = await watcher.evaluate(() => window.Application.world.raceManager.multiplayer.getState().lobbyCode);
await driver.evaluate((lobbyCode) => document.dispatchEvent(new CustomEvent('race:multiplayerJoinLobby', { detail: { playerName: 'Drive', lobbyCode } })), code);
await Promise.all([watcher, driver].map((p) => p.waitForFunction(() => window.Application.world.raceManager.multiplayer.getState().players.length >= 2, null, { timeout: 30000 })));

const sections = await driver.evaluate(() => {
    const tr = window.Application.world.raceManager.track;
    return tr.sections.map((s) => [s.name, Math.round(s.distance * tr.distanceScale)]);
});
const found = sections.find(([name]) => name.toLowerCase().includes(start.toLowerCase()));
const startAt = (found ? found[1] : 800) - BACK_M;

// the driver: centreline plus a lane, road height and tilt from the collider
await driver.evaluate(([startAt, maxMps]) => {
    const rm = window.Application.world.raceManager; const v = rm.vehicle; const tr = rm.track;
    const curve = tr.getCurve();
    const V3 = v.position.constructor; const M4 = v.carPivot.matrix.constructor;
    const at = (d) => (((d / tr.length) % 1) + 1) % 1;
    const st = (window.__state = { s: startAt, speed: 18, lane: 0, stop: false, k: 0, frozen: false });
    const ride = v.rideHeight;
    let lastHeading = null;
    const normal = new V3(); const fwd = new V3(); const side = new V3(); const m = new M4();
    v.input.update = () => {};
    v.update = (dt) => {
        if (!dt || st.frozen) return;
        const t0 = curve.getTangentAt(at(st.s + 5)); const t1 = curve.getTangentAt(at(st.s + 45));
        const dot = (t0.x * t1.x + t0.z * t1.z) / Math.hypot(t0.x, t0.z) / Math.hypot(t1.x, t1.z);
        const k = Math.max(1e-4, Math.acos(Math.max(-1, Math.min(1, dot))) / 40);
        st.k = k;
        const target = st.stop ? 0 : Math.min(maxMps, Math.sqrt(9 / k));
        st.speed += Math.max(-9 * dt, Math.min(4 * dt, target - st.speed));
        st.s += st.speed * dt;
        const p = curve.getPointAt(at(st.s)); const tg = curve.getTangentAt(at(st.s));
        const h = Math.hypot(tg.x, tg.z); const fx = tg.x / h; const fz = tg.z / h;
        const x = p.x + fz * st.lane; const z = p.z - fx * st.lane;
        const g = tr.sampleGround(x, z, normal);
        if (g === null) normal.set(0, 1, 0);
        const heading = Math.atan2(fx, fz);
        let turn = lastHeading === null ? 0 : heading - lastHeading;
        if (turn > Math.PI) turn -= 2 * Math.PI;
        if (turn < -Math.PI) turn += 2 * Math.PI;
        lastHeading = heading;
        v.position.set(x, (g ?? p.y) + ride, z);
        v.velocity.set(fx * st.speed, 0, fz * st.speed);
        v.physics.yawRate = turn / dt; v.physics.vx = st.speed; v.physics.vy = 0; v.speedMps = st.speed;
        fwd.set(fx, 0, fz).projectOnPlane(normal).normalize();
        side.crossVectors(normal, fwd).normalize();
        m.makeBasis(side, normal, fwd);
        v.carPivot.quaternion.setFromRotationMatrix(m);
        v.carPivot.position.copy(v.position);
    };
    window.__own = [];
    const loop = () => {
        window.__own.push([Date.now(), v.position.x, v.position.y, v.position.z]);
        if (window.__own.length < 40000) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
}, [startAt, MAX_MPS]);

// the watcher: the drawn car against the road and the armco
await watcher.evaluate(() => {
    const rm = window.Application.world.raceManager; const tr = rm.track;
    window.__seen = [];
    const frame = tr.createFrame();
    let hint = -1;
    const loop = () => {
        const now = Date.now();
        rm.remoteVehicles.forEach((vis) => {
            const p = vis.root.position; const q = vis.root.quaternion;
            const saved = tr.frameHint;
            const g = tr.sampleGround(p.x, p.z);
            const f = tr.queryFrame(p.x, p.z, frame, hint); hint = f.index;
            tr.frameHint = saved;
            const fx = 2 * (q.x * q.z + q.w * q.y); const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
            const n = Math.hypot(fx, fz) || 1;
            const sin = fx / n, cos = fz / n;
            const size = vis.model.userData.raceBodySize || [1.95, 1.3, 4.7];
            const fa = sin * f.leftX + cos * f.leftZ; const la = cos * f.leftX - sin * f.leftZ;
            const reach = Math.abs(size[2] * 0.48 * fa) + Math.abs(size[0] * 0.46 * la);
            const over = Math.max(f.lateral + reach - f.barrierLeft, -(f.lateral - reach) - f.barrierRight);
            const ride = Number(vis.model.userData.raceRideHeight) || 0.33;
            window.__seen.push([now, p.x, p.y, p.z, g === null ? null : p.y - g - ride, over]);
        });
        if (window.__seen.length < 80000) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
});

const now = () => watcher.evaluate(() => Date.now());
const marks = { drive: await now() };
await watcher.waitForTimeout(DRIVE_MS);
let pauseInfo = null;
for (let i = 0; i < 200 && !pauseInfo; i++) {
    const s = await driver.evaluate(() => window.__state);
    if (s.speed > 19 && s.k > 1 / 220) {
        pauseInfo = await driver.evaluate(() => {
            window.__state.frozen = true;
            window.Application.world.raceManager.setPaused(true);
            return { speedKph: Math.round(window.__state.speed * 3.6), radius: Math.round(1 / window.__state.k) };
        });
    } else await driver.waitForTimeout(100);
}
marks.pause = await now();
await watcher.waitForTimeout(4000);
await driver.evaluate(() => { window.__state.frozen = false; window.Application.world.raceManager.setPaused(false); });
marks.resume = await now();
await watcher.waitForTimeout(3000);
await driver.evaluate(() => {
    const rm = window.Application.world.raceManager; const tr = rm.track; const v = rm.vehicle;
    const f = tr.queryFrame(v.position.x, v.position.z, tr.createFrame());
    window.__state.lane = Math.sign(f.lateral || 1) * (f.barrierOffset - 1.6);
});
await watcher.waitForTimeout(1500);
const before = await driver.evaluate(() => { const p = window.Application.world.raceManager.vehicle.position; return [p.x, p.z]; });
marks.respawn = await now();
await driver.evaluate(() => { const st = window.__state; st.s -= 60; st.lane = 0; st.speed = 0; st.stop = true; });
await driver.waitForTimeout(200);
const after = await driver.evaluate(() => { const p = window.Application.world.raceManager.vehicle.position; return [p.x, p.z]; });
await watcher.waitForTimeout(3000);
marks.end = await now();

const seen = await watcher.evaluate(() => window.__seen);
const own = await driver.evaluate(() => window.__own);
await browser.close();

const truthAt = (t) => {
    let lo = 0, hi = own.length - 1;
    if (!own.length || t <= own[0][0] || t >= own[hi][0]) return null;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (own[m][0] <= t) lo = m; else hi = m; }
    const a = own[lo], b = own[hi], k = (t - a[0]) / Math.max(1, b[0] - a[0]);
    return [a[1] + (b[1] - a[1]) * k, a[3] + (b[3] - a[3]) * k];
};
const pct = (list, p) => {
    if (!list.length) return null;
    const s = [...list].sort((a, b) => a - b);
    return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2);
};
const phase = (from, to) => {
    const rows = seen.filter((r) => r[0] >= from && r[0] < to);
    const lift = rows.map((r) => r[4]).filter((x) => x !== null);
    const over = rows.map((r) => r[5]);
    const err = rows.map((r) => { const t = truthAt(r[0]); return t ? Math.hypot(t[0] - r[1], t[1] - r[3]) : null; }).filter((x) => x !== null);
    return {
        frames: rows.length,
        // drawn height over the road minus the ride height: negative is sunk
        liftErrM: { min: pct(lift, 0), p5: pct(lift, 0.05), p50: pct(lift, 0.5), max: pct(lift, 1) },
        sunkOver20cm: +(lift.filter((x) => x < -0.2).length / Math.max(1, lift.length)).toFixed(3),
        pastArmco: { maxM: pct(over, 1), framesOver25cm: over.filter((x) => x > 0.25).length },
        offSpotM: { p50: pct(err, 0.5), p95: pct(err, 0.95), max: pct(err, 1) },
    };
};
// drawn away from both ends of the respawn: sliding across, not jumping
const glideFrames = seen
    .filter((r) => r[0] >= marks.respawn && r[0] < marks.end)
    .filter((r) => Math.hypot(r[1] - before[0], r[3] - before[1]) > 3 && Math.hypot(r[1] - after[0], r[3] - after[1]) > 3).length;
const result = {
    url,
    section: found?.[0] || null,
    pauseInfo,
    drive: phase(marks.drive + 1500, marks.pause),
    paused: phase(marks.pause, marks.resume),
    resumed: phase(marks.resume + 500, marks.respawn),
    respawn: { ...phase(marks.respawn, marks.end), glideFrames },
    errors,
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
process.exit(0);
