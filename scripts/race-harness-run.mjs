// runs the in-page race harnesses (race-physics-check.js and
// race-drive-metrics.js) in chromium and writes the results as json.
//
//   node scripts/race-harness-run.mjs --url http://192.168.1.166:8190/ --out .tmp-validation/harness.json
//   node scripts/race-harness-run.mjs --url ... --cars bmw-e92-m3,amg-one --skip physics
//
// the physics numbers don't depend on the gpu, but the page still renders, so
// headed on the real gpu keeps it quick.

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    if (i < 0) return fallback;
    const next = args[i + 1];
    return next === undefined || next.startsWith('--') ? true : next;
};

const ALL_CARS = [
    'amg-one',
    'bmw-e92-m3',
    'amg-c63-507',
    'amg-c63s-coupe',
    'bmw-f82-m4',
    'bmw-f90-m5-competition',
    'bmw-m8-competition-coupe',
    'mercedes-gt63s-edition-one',
    'toyota-crown-platinum',
];

const url = new URL(opt('url', 'http://127.0.0.1:8190/'));
url.searchParams.set('raceDebug', '1');
const out = path.resolve(opt('out', '.tmp-validation/harness.json'));
const cars = String(opt('cars', ALL_CARS.join(','))).split(',');
const skip = new Set(String(opt('skip', '')).split(',').filter(Boolean));
const seconds = Number(opt('seconds', 30));

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
        '--window-size=900,600',
    ],
});
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 300));
});
await page.goto(url.toString(), {
    waitUntil: 'domcontentloaded',
    timeout: 180000,
});
await page.waitForFunction(
    () => Boolean(window.Application?.world?.car),
    null,
    {
        timeout: 240000,
    }
);
await page.evaluate(() => window.Application.world.ensureRaceManager());
// devtools evaluation isn't subject to the page's csp, a script tag would be
for (const file of ['race-physics-check.js', 'race-drive-metrics.js']) {
    await page.evaluate(fs.readFileSync(path.join(here, file), 'utf8'));
}

const results = { url: url.toString(), cars };
const run = async (label, expr) => {
    const t0 = Date.now();
    console.log(`[harness] ${label}...`);
    const raw = await page.evaluate(expr);
    results[label] = JSON.parse(raw);
    console.log(
        `[harness] ${label} done in ${Math.round((Date.now() - t0) / 1000)} s`
    );
};

if (!skip.has('physics')) {
    await run('physics', `__race(${JSON.stringify(cars)}, ${seconds})`);
}
if (!skip.has('stress')) {
    // from the start of the doettinger hoehe straight, the only place the
    // real lap gets to these speeds quickly
    await run(
        'drift200',
        `__race(['amg-c63s-coupe', 'bmw-f90-m5-competition'], 22, { scenario: 'drift', atKph: 200, startAt: 0.866, startKph: 150 })`
    );
    await run(
        'slalom220',
        `__race(['amg-one', 'bmw-m8-competition-coupe'], 22, { scenario: 'slalom', atKph: 220, startAt: 0.866, startKph: 170 })`
    );
    // the crests the real cars jump: flugplatz, then pflanzgarten
    await run(
        'flugplatz',
        `__race(['amg-one', 'bmw-e92-m3'], 16, { startAt: 0.1, startKph: 150 })`
    );
    await run(
        'pflanzgarten',
        `__race(['amg-one', 'bmw-e92-m3'], 20, { startAt: 0.7, startKph: 140 })`
    );
}
if (!skip.has('drive')) {
    // --drive-options '{"only":["driftAssist"],"driftTuning":{...}}'
    const driveOptions = opt('drive-options', '{}');
    await run('drive', `__drive(${JSON.stringify(cars)}, ${driveOptions})`);
}
results.errors = errors;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(results, null, 1));
console.log(`[harness] wrote ${out}`);
await browser.close();
