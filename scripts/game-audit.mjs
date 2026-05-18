import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const buildDir = path.join(root, 'build');
const criticalFailures = [];
const warnings = [];

const readText = (filePath) => readFileSync(filePath, 'utf8');

const findFiles = (dir, predicate, results = []) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            findFiles(fullPath, predicate, results);
        } else if (predicate(fullPath, entry.name)) {
            results.push(fullPath);
        }
    }
    return results;
};

const fail = (message) => criticalFailures.push(message);
const warn = (message) => warnings.push(message);

if (!statSync(buildDir, { throwIfNoEntry: false })?.isDirectory()) {
    fail('Missing build directory. Run npm run build before npm run game:audit.');
} else {
    const indexPath = path.join(buildDir, 'index.html');
    const indexHtml = statSync(indexPath, { throwIfNoEntry: false })
        ? readText(indexPath)
        : '';
    if (!indexHtml) {
        fail('Missing build/index.html.');
    }

    const scriptMatches = [...indexHtml.matchAll(/<script[^>]+src="([^"]+)"/gi)].map(
        (match) => match[1]
    );
    const initialScripts = scriptMatches
        .map((src) => path.join(buildDir, src.replace(/^\//, '')))
        .filter((filePath) => statSync(filePath, { throwIfNoEntry: false }));
    if (initialScripts.length === 0) {
        fail('No initial script bundle found in build/index.html.');
    }

    const allJs = findFiles(buildDir, (_, name) => name.endsWith('.js'));
    const lazyChunks = allJs.filter((filePath) => !initialScripts.includes(filePath));
    if (lazyChunks.length === 0) {
        fail('No lazy JS chunks found. Racing code should remain code-split.');
    }

    const riskyHomepageMarkers = [
        '@supabase/supabase-js',
        'signInWithSolana',
        'signInWithEthereum',
        'SupabaseAuthClient',
        'RealtimeClient',
        'WebSocket',
        'wallet',
    ];
    for (const filePath of initialScripts) {
        const contents = readText(filePath);
        const relative = path.relative(root, filePath);
        for (const marker of riskyHomepageMarkers) {
            if (contents.includes(marker)) {
                fail(`Initial homepage bundle ${relative} contains risky marker: ${marker}`);
            }
        }
    }

    const racingMarkers = ['RaceManager', 'RaceVehicle', 'Nordschleife'];
    const lazyChunkText = lazyChunks.map((filePath) => readText(filePath)).join('\n');
    for (const marker of racingMarkers) {
        if (!lazyChunkText.includes(marker)) {
            warn(`Lazy chunks did not contain expected racing marker: ${marker}`);
        }
    }

    const cssText = findFiles(buildDir, (_, name) => name.endsWith('.css'))
        .map((filePath) => readText(filePath))
        .join('\n');
    for (const className of [
        'race-touch-controls',
        'race-rotate-hint',
        'race-mode-touch',
    ]) {
        if (!cssText.includes(className)) {
            fail(`Built CSS is missing mobile racing class: ${className}`);
        }
    }

    const sourceMaps = findFiles(buildDir, (_, name) => name.endsWith('.map'));
    if (sourceMaps.length > 0) {
        warn(`Production build includes ${sourceMaps.length} source map file(s).`);
    }

    const assetFiles = findFiles(buildDir, () => true);
    for (const filePath of assetFiles) {
        const sizeMb = statSync(filePath).size / (1024 * 1024);
        if (sizeMb > 120) {
            fail(`${path.relative(root, filePath)} is ${sizeMb.toFixed(1)} MB.`);
        } else if (sizeMb > 40) {
            warn(`${path.relative(root, filePath)} is ${sizeMb.toFixed(1)} MB.`);
        }
    }
}

const vercelPath = path.join(root, 'vercel.json');
if (statSync(vercelPath, { throwIfNoEntry: false })) {
    const vercel = JSON.parse(readText(vercelPath));
    const headers = Array.isArray(vercel.headers) ? vercel.headers : [];
    const cspHeader = headers
        .flatMap((entry) => entry.headers || [])
        .find((header) => String(header.key || '').toLowerCase() === 'content-security-policy');
    const csp = cspHeader?.value || '';
    if (!csp) {
        fail('vercel.json is missing Content-Security-Policy.');
    }
    const cspTokens = csp.split(/[\s;]+/).filter(Boolean);
    for (const broadSource of ['http:', 'https:', 'ws:', 'wss:']) {
        if (cspTokens.includes(broadSource)) {
            fail(`CSP contains broad source allowance: ${broadSource}`);
        }
    }
    if (csp.includes("'unsafe-eval'")) {
        fail("CSP contains 'unsafe-eval'.");
    }
} else {
    warn('vercel.json not found; header audit skipped.');
}

console.log('Game audit');
console.log(`- Critical failures: ${criticalFailures.length}`);
console.log(`- Warnings: ${warnings.length}`);

for (const message of criticalFailures) {
    console.error(`FAIL: ${message}`);
}
for (const message of warnings) {
    console.warn(`WARN: ${message}`);
}

if (criticalFailures.length > 0) {
    process.exit(1);
}
