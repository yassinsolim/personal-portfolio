// renders a short demo clip per car with the real race audio code running on
// an OfflineAudioContext in chromium: idle, full throttle through the gears to
// the limiter, then a lift. writes docs/audio-samples/<carId>.mp3.
//
//   node scripts/render-audio-samples.mjs            # every car
//   node scripts/render-audio-samples.mjs bmw-f82-m4 # just one

import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs', 'audio-samples');
const harnessDir = path.join(root, '.tmp-validation', 'audio-harness');

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
const cars = process.argv.slice(2).length ? process.argv.slice(2) : ALL_CARS;

const buildHarness = () =>
    new Promise((resolve, reject) => {
        const webpack = require('webpack');
        const config = require(path.join(root, 'scripts/audio/harness/webpack.config.js'));
        webpack(config, (error, stats) => {
            if (error) return reject(error);
            if (stats.hasErrors()) return reject(new Error(stats.toString('errors-only')));
            resolve();
        });
    });

const types = { '.js': 'text/javascript', '.json': 'application/json', '.webm': 'audio/webm', '.m4a': 'audio/mp4', '.html': 'text/html' };

const serve = () =>
    new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const url = decodeURIComponent((req.url || '/').split('?')[0]);
            let file;
            if (url === '/') {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><script src="/harness.js"></script>');
                return;
            }
            if (url === '/harness.js') file = path.join(harnessDir, 'harness.js');
            else if (url.startsWith('/sounds/')) file = path.join(root, 'static', url);
            if (!file || !file.startsWith(root) || !fs.existsSync(file)) {
                res.writeHead(404);
                res.end();
                return;
            }
            res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
            fs.createReadStream(file).pipe(res);
        });
        server.listen(0, '127.0.0.1', () => resolve(server));
    });

// use whichever chromium playwright has cached, even if it's newer than the
// one this playwright version pins
const findChromium = () => {
    if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
    const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
    if (!fs.existsSync(cache)) return undefined;
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

await buildHarness();
const server = await serve();
const port = server.address().port;
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text());
});
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForFunction(() => window.harnessReady === true);
fs.mkdirSync(outDir, { recursive: true });
// full quality wavs stay in the gitignored validation folder for analysis
const tmp = path.join(root, '.tmp-validation', 'audio-samples-wav');
fs.mkdirSync(tmp, { recursive: true });
const summary = [];
for (const carId of cars) {
    const result = await page.evaluate((id) => window.renderCarSample(id), carId);
    const wav = path.join(tmp, `${carId}.wav`);
    fs.writeFileSync(wav, Buffer.from(result.wav, 'base64'));
    const mp3 = path.join(outDir, `${carId}.mp3`);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', wav, '-c:a', 'libmp3lame', '-q:a', '3', mp3]);
    const row = {
        carId,
        seconds: result.seconds,
        peak: Number(result.peak.toFixed(3)),
        format: result.format,
        downloadKB: Math.round(result.bytes / 1024),
        maxRpm: result.maxRpm,
        shifts: result.shifts,
        liftAt: result.liftAt,
        shots: result.shots,
        mp3KB: Math.round(fs.statSync(mp3).size / 1024),
    };
    summary.push(row);
    console.log(JSON.stringify(row));
}
await browser.close();
server.close();
if (errors.length) {
    console.log('page errors or warnings:');
    errors.forEach((e) => console.log('  ' + e));
    process.exitCode = 1;
}
