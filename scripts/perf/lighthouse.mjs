// lighthouse runs (performance only) with the key numbers pulled out. lighthouse
// itself isn't a dependency here: point LIGHTHOUSE at a local install
// (npm i lighthouse@12 in a scratch folder), it runs chrome for testing.
//
//   LIGHTHOUSE=/tmp/lh/node_modules/.bin/lighthouse node scripts/perf/lighthouse.mjs
//     --url https://yassin.app/ [--runs 3] [--form mobile|desktop]
//     [--spki <hash>] [--label base] [--out .tmp-validation/perf/lh-base.json]
//
// interleave labels (base, then change, then base...) when the machine is busy.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
};
const url = arg('url', 'https://yassin.app/');
const runs = Number(arg('runs', '3'));
const form = arg('form', 'mobile');
const spki = arg('spki', '');
const label = arg('label', new URL(url).host);
const out = arg('out', '');
const lighthouse = process.env.LIGHTHOUSE || 'lighthouse';
const chrome =
    process.env.CHROMIUM_PATH ||
    `${os.homedir()}/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

const flags = ['--headless=new', '--host-resolver-rules=MAP *.supabase.co ~NOTFOUND'];
if (spki) flags.push(`--ignore-certificate-errors-spki-list=${spki}`);

const pickRun = (report) => {
    const audit = (id) => report.audits[id];
    const numeric = (id) => audit(id)?.numericValue ?? null;
    const breakdown = audit('mainthread-work-breakdown')?.details?.items || [];
    const bootup = audit('bootup-time')?.details?.items || [];
    const weight = audit('total-byte-weight')?.details?.items || [];
    return {
        score: Math.round((report.categories.performance.score || 0) * 100),
        fcp: numeric('first-contentful-paint'),
        lcp: numeric('largest-contentful-paint'),
        tbt: numeric('total-blocking-time'),
        cls: numeric('cumulative-layout-shift'),
        si: numeric('speed-index'),
        tti: numeric('interactive'),
        bytes: numeric('total-byte-weight'),
        mainThreadMs: numeric('mainthread-work-breakdown'),
        bootupMs: numeric('bootup-time'),
        mainThread: Object.fromEntries(breakdown.map((i) => [i.group, Math.round(i.duration)])),
        heaviestScripts: bootup.slice(0, 5).map((i) => ({ url: i.url.split('/').pop(), total: Math.round(i.total) })),
        largestTransfers: weight.slice(0, 8).map((i) => ({ url: i.url.replace(/^https?:\/\/[^/]+/, ''), kib: Math.round(i.totalBytes / 1024) })),
        warnings: report.runWarnings || [],
    };
};

const results = [];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-'));
for (let run = 0; run < runs; run++) {
    const file = path.join(tmp, `run-${run}.json`);
    const cli = [
        url,
        '--only-categories=performance',
        '--output=json',
        `--output-path=${file}`,
        `--chrome-flags=${flags.join(' ')}`,
        '--quiet',
        '--max-wait-for-load=60000',
    ];
    if (form === 'desktop') cli.push('--preset=desktop');
    try {
        execFileSync(lighthouse, cli, { env: { ...process.env, CHROME_PATH: chrome }, stdio: ['ignore', 'ignore', 'inherit'], timeout: 240000 });
        const report = JSON.parse(fs.readFileSync(file, 'utf8'));
        const result = pickRun(report);
        results.push(result);
        console.log(
            `[${label} ${form} ${run + 1}/${runs}] score ${result.score} fcp ${Math.round(result.fcp)} lcp ${Math.round(result.lcp)}` +
                ` tbt ${Math.round(result.tbt)} cls ${result.cls?.toFixed(3)} si ${Math.round(result.si)} tti ${Math.round(result.tti)}` +
                ` bytes ${Math.round(result.bytes / 1024)} KiB`
        );
    } catch (error) {
        console.log(`[${label} ${form} ${run + 1}/${runs}] failed: ${String(error.message || error).slice(0, 200)}`);
    }
}

const median = (key) => {
    const list = results.map((r) => r[key]).filter((v) => typeof v === 'number').sort((a, b) => a - b);
    if (!list.length) return null;
    const mid = Math.floor(list.length / 2);
    return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
};
const summary = { label, url, form, runs: results.length };
for (const key of ['score', 'fcp', 'lcp', 'tbt', 'cls', 'si', 'tti', 'bytes', 'mainThreadMs', 'bootupMs']) summary[key] = median(key);
console.log(JSON.stringify(summary));
if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ summary, results }, null, 1));
}
