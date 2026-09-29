// screenshots of the room's m2 and m3 displays at 1x, from the production
// build under production headers (vercel.json's csp), plus checks that they
// freeze while hidden and batch the boot log. serves build/ itself on its
// own port and stops it when done.
//
//   npm run build
//   node scripts/room/display-shots.mjs --out ~/Assets/portfolio-room/v2/displays
//   node scripts/room/display-shots.mjs --host 192.168.1.166 --port 8197 --headed
//
// headless chromium on macos may not reach 127.0.0.1: pass the lan ip then
import { chromium } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    if (i < 0) return fallback;
    const next = args[i + 1];
    return next === undefined || next.startsWith('--') ? true : next;
};

const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
);
const buildDir = path.resolve(opt('build', path.join(root, 'build')));
const outDir = path.resolve(
    String(
        opt('out', path.join(os.homedir(), 'Assets/portfolio-room/v2/displays'))
    ).replace(/^~/, os.homedir())
);
const host = String(opt('host', '127.0.0.1'));
const port = Number(opt('port', 8197));
const headed = Boolean(opt('headed', false));
const log = (...a) => console.log('[display-shots]', ...a);

if (!fs.existsSync(path.join(buildDir, 'index.html'))) {
    console.error(
        `[display-shots] no build in ${buildDir}, run npm run build first`
    );
    process.exit(1);
}

// vercel.json's headers for a path: every rule whose source matches, later
// ones winning (the ktx2 worker and draco get their own csp that way)
const vercel = JSON.parse(
    fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')
);
const rules = vercel.headers.map((rule) => ({
    match: new RegExp(`^${rule.source}$`),
    headers: rule.headers,
}));
const headersFor = (pathname) => {
    const out = {};
    for (const rule of rules) {
        if (!rule.match.test(pathname)) continue;
        for (const { key, value } of rule.headers) {
            // plain http here, so no hsts and no upgrade
            if (key === 'Strict-Transport-Security') continue;
            out[key] =
                key === 'Content-Security-Policy'
                    ? value.replace(/;\s*upgrade-insecure-requests/, '')
                    : value;
        }
    }
    return out;
};
const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.webp': 'image/webp',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.glb': 'model/gltf-binary',
    '.ktx2': 'image/ktx2',
    '.wasm': 'application/wasm',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.webm': 'audio/webm',
    '.ogg': 'audio/ogg',
    '.txt': 'text/plain',
    '.xml': 'application/xml',
};

const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let file = path.join(buildDir, decodeURIComponent(url.pathname));
    if (!file.startsWith(buildDir)) {
        res.writeHead(403).end();
        return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory())
        file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) {
        res.writeHead(404).end();
        return;
    }
    res.writeHead(200, {
        ...headersFor(url.pathname),
        'Content-Type':
            TYPES[path.extname(file).toLowerCase()] ||
            'application/octet-stream',
    });
    fs.createReadStream(file).pipe(res);
});
await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
});
const base = `http://${host}:${port}/`;
log(`serving ${path.relative(root, buildDir) || buildDir} at ${base}`);

// whichever playwright chromium is installed, like scripts/race-playtest.mjs
const findChromium = () => {
    if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
    const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
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

// m2 and m3 where they sit in the spanned wallpaper, with m1's part of it
// between (yassinOS draws that one), to show the one image across all three
const layout = async () => {
    const { default: sharp } = await import('sharp');
    const theme = JSON.parse(
        fs.readFileSync(
            path.join(buildDir, 'textures/room/room-theme.json'),
            'utf8'
        )
    );
    // the flat RoomTheme of types.ts, or the nested one yassinOS writes
    const image = theme.spanImage || theme.span?.path || 'room-span.webp';
    const span = path.join(buildDir, 'textures/room', image.split('/').pop());
    const { width: w, height: h } = await sharp(span).metadata();
    const rect = (id) => {
        const norm = theme.screens?.[id.toUpperCase()]?.norm;
        return theme.rects?.[id] || [norm.x, norm.y, norm.width, norm.height];
    };
    const place = async (id, file) => {
        const [x, y, rw, rh] = rect(id);
        const size = { width: Math.round(rw * w), height: Math.round(rh * h) };
        const input = file
            ? await sharp(file).resize(size).toBuffer()
            : await sharp(span)
                  .extract({
                      left: Math.round(x * w),
                      top: Math.round(y * h),
                      ...size,
                  })
                  .toBuffer();
        return { input, left: Math.round(x * w), top: Math.round(y * h) };
    };
    const file = path.join(outDir, 'layout.jpg');
    // sharp resizes before it composites, so two passes
    const full = await sharp({
        create: { width: w, height: h, channels: 3, background: '#161616' },
    })
        .composite([
            await place('m1'),
            await place('m2', path.join(outDir, 'm2-focused.png')),
            await place('m3', path.join(outDir, 'm3-commands.png')),
        ])
        .png()
        .toBuffer();
    await sharp(full).resize(1600).jpeg({ quality: 86 }).toFile(file);
    log('wrote', file);
};

const width = 2600;
const height = 1760;
const browser = await chromium.launch({
    headless: !headed,
    executablePath: findChromium(),
    args: [
        '--use-angle=metal',
        '--ignore-gpu-blocklist',
        `--window-size=${width},${height + 90}`,
    ],
});
const problems = [];
const checks = {};
try {
    const context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    page.on('console', (msg) => {
        if (msg.type() === 'error')
            problems.push(`console: ${msg.text().slice(0, 300)}`);
    });
    page.on('pageerror', (err) =>
        problems.push(`pageerror: ${String(err).slice(0, 300)}`)
    );
    await page.addInitScript(() => {
        window.__cspViolations = [];
        document.addEventListener('securitypolicyviolation', (event) =>
            window.__cspViolations.push(
                `${event.violatedDirective} ${event.blockedURI}`
            )
        );
    });

    fs.mkdirSync(outDir, { recursive: true });
    const shot = async (id, name) => {
        const file = path.join(outDir, name);
        await page
            .locator(`.room-display[data-screen="${id}"]`)
            .screenshot({ path: file });
        log('wrote', file);
    };
    const settle = () =>
        page.evaluate(
            () =>
                new Promise((r) =>
                    requestAnimationFrame(() => requestAnimationFrame(r))
                )
        );

    await page.goto(`${base}?roomDisplays=preview&mode=boot&lap=none`, {
        waitUntil: 'load',
    });
    await page.waitForFunction(() => window.__roomDisplays, null, {
        timeout: 30000,
    });
    await page.evaluate(() => document.fonts.ready);
    // the spanned wallpaper behind both
    await page.evaluate(async () => {
        const url = getComputedStyle(
            document.querySelector('.room-display')
        ).backgroundImage.slice(5, -2);
        const image = new Image();
        image.src = url;
        await image.decode();
    });
    // let the site load under the overlay: the boot log streams it, and the
    // renderer has frame times for the stats
    await page
        .waitForFunction(
            () => {
                const info = window.__roomDisplays.ctx.graphicsInfo();
                return (
                    info &&
                    info.frameP50 !== null &&
                    info.frameP50 !== undefined
                );
            },
            null,
            { timeout: 45000 }
        )
        .catch(() => problems.push('the renderer never reported frame times'));
    await page.waitForTimeout(1500);
    checks.renderer = await page.evaluate(
        () => window.__roomDisplays.ctx.graphicsInfo().renderer || null
    );
    await shot('m3', 'm3-boot.png');

    // the loader hands over: the same element carries on as the shell
    await page.evaluate(() => window.__roomDisplays.setMode('shell'));
    await page.waitForTimeout(1200);
    await shot('m3', 'm3-shell.png');
    await shot('m2', 'm2.png');

    // the log: a burst lands in one frame and keeps the last 400
    checks.batching = await page.evaluate(async () => {
        const { m3 } = window.__roomDisplays;
        const out = document.querySelector(
            '.room-display[data-screen="m3"] .rd-term-out'
        );
        let batches = 0;
        const observer = new MutationObserver(() => batches++);
        observer.observe(out, { childList: true });
        const before = out.childElementCount;
        for (let i = 1; i <= 1000; i++) m3.appendLog(`batch check ${i}`, 'dim');
        const sameTick = out.childElementCount;
        await new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r))
        );
        observer.disconnect();
        return {
            before,
            sameTick,
            after: out.childElementCount,
            last: out.lastElementChild?.textContent,
            batches,
        };
    });

    // hidden: no dom writes at all, whatever arrives
    checks.frozen = await page.evaluate(async () => {
        const { m2, m3, setOs } = window.__roomDisplays;
        const roots = [...document.querySelectorAll('.room-display')];
        let changes = 0;
        const observer = new MutationObserver(
            (records) => (changes += records.length)
        );
        m2.setVisible(false);
        m3.setVisible(false);
        for (const node of roots)
            observer.observe(node, {
                childList: true,
                subtree: true,
                characterData: true,
                attributes: true,
            });
        for (let i = 0; i < 50; i++) m3.appendLog(`while hidden ${i}`);
        document.dispatchEvent(
            new CustomEvent('carChange', { detail: 'bmw-f82-m4' })
        );
        setOs({ apps: ['Portfolio'], focused: 'Portfolio' });
        // three stats ticks' worth
        await new Promise((r) => setTimeout(r, 1600));
        const hiddenChanges = changes;
        m2.setVisible(true);
        m3.setVisible(true);
        await new Promise((r) => requestAnimationFrame(r));
        observer.disconnect();
        const out = document.querySelector(
            '.room-display[data-screen="m3"] .rd-term-out'
        );
        return {
            hiddenChanges,
            changesOnShow: changes - hiddenChanges,
            lastLine: out.lastElementChild?.textContent,
            osApp: document.querySelector('.rd-os-app')?.textContent,
        };
    });
    // focused: commands typed into the real input
    await page.evaluate(() => window.__roomDisplays.setFocus('m3'));
    checks.inputFocused = await page.evaluate(
        () =>
            document.activeElement?.classList.contains('rd-term-input') || false
    );
    await page.keyboard.type('clear');
    await page.keyboard.press('Enter');
    for (const command of ['help', 'neofetch']) {
        await page.keyboard.type(command);
        await page.keyboard.press('Enter');
    }
    await page.keyboard.type('open po');
    await page.keyboard.press('Tab');
    checks.completion = await page.evaluate(
        () => document.activeElement?.value
    );
    await page.keyboard.press('Escape');
    checks.escapeBlurs = await page.evaluate(
        () => !document.activeElement?.classList.contains('rd-term-input')
    );
    await settle();
    await shot('m3', 'm3-commands.png');
    // back into the input (a click on the terminal), and run it: the room
    // would move the camera to m1, the preview just unfocuses
    await page.locator('.room-display[data-screen="m3"] .rd-term-live').click();
    await page.keyboard.press('Enter');
    checks.openedFromM3 = await page.evaluate(
        () => window.__roomDisplays.ctx.osState().focused
    );
    await page.evaluate(() => window.__roomDisplays.setFocus('m3'));
    await page.keyboard.press('Control+L');
    await page.keyboard.type('graphics');
    await page.keyboard.press('Enter');
    await page.keyboard.type('ls');
    await page.keyboard.press('Enter');
    await settle();
    await shot('m3', 'm3-ls.png');

    // m2 with a lap, an app open on the main screen, and a focused button
    await page.evaluate(() => {
        const { setLap, setFocus } = window.__roomDisplays;
        setLap(492345);
        document.dispatchEvent(
            new CustomEvent('race:lapCompleted', {
                detail: { lapTimeMs: 492345 },
            })
        );
        setFocus('m2');
    });
    const clicksWhileUnfocused = await page.evaluate(() => {
        const { m2, ctx } = window.__roomDisplays;
        m2.setFocused(false);
        const before = ctx.osState().focused;
        document.querySelector('.rd-os-links .rd-btn').click();
        const after = ctx.osState().focused;
        m2.setFocused(true);
        return before === after;
    });
    checks.buttonsWaitForFocus = clicksWhileUnfocused;
    await page.locator('.rd-os-links .rd-btn').first().click();
    checks.openedFromM2 = await page.evaluate(
        () => window.__roomDisplays.ctx.osState().focused
    );
    await page.evaluate(() => {
        window.__roomDisplays.ctx.openInOS('FileExplorer', '/Users/Public');
        window.__roomDisplays.setFocus('m2');
        document.querySelector('.room-display[data-screen="m2"]').focus();
    });
    await page.keyboard.press('Tab');
    await settle();
    await shot('m2', 'm2-focused.png');
    await layout();

    checks.csp = await page.evaluate(() => window.__cspViolations);
    checks.problems = problems;
    fs.writeFileSync(
        path.join(outDir, 'checks.json'),
        `${JSON.stringify(checks, null, 2)}\n`
    );
    console.log(JSON.stringify(checks, null, 2));
} finally {
    await browser.close();
    server.close();
}
