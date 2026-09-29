// serves build/ the way vercel does, for load and cache measurements:
// http/2 over tls, the headers from vercel.json (last matching rule wins per
// key), vercel's default cache-control, brotli at quality 3 for the types
// vercel compresses (quality 3 matches its bytes exactly), etags with 304s
// and byte ranges for media.
//
//   node scripts/perf/serve-build.mjs [--dir build] [--config vercel.json]
//     [--port 8443] [--host 0.0.0.0] [--cert cert.pem --key key.pem] [--log]
//
// headless chromium on macos can't reach 127.0.0.1, use the lan ip. the
// certificate is self signed, so browsers need --ignore-certificate-errors.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http2 from 'node:http2';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const arg = (name, fallback) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const dir = path.resolve(root, arg('dir', 'build'));
const port = Number(arg('port', '8443'));
const host = arg('host', '0.0.0.0');
const log = args.includes('--log');

const ensureCert = () => {
    const cert = arg('cert', '');
    const key = arg('key', '');
    if (cert && key) return { cert: fs.readFileSync(cert), key: fs.readFileSync(key) };
    const out = path.join(root, '.tmp-validation/perf-cert');
    const certPath = path.join(out, 'cert.pem');
    const keyPath = path.join(out, 'key.pem');
    if (!fs.existsSync(certPath)) {
        fs.mkdirSync(out, { recursive: true });
        execFileSync('openssl', [
            'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30',
            '-keyout', keyPath, '-out', certPath, '-subj', '/CN=perf.local',
        ], { stdio: 'ignore' });
    }
    return { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
};

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.wasm': 'application/wasm',
    '.glb': 'model/gltf-binary',
    '.ktx2': 'image/ktx2',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/vnd.microsoft.icon',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.m4a': 'audio/mp4',
    '.txt': 'text/plain; charset=utf-8',
    '.xml': 'application/xml',
    '.bin': 'application/octet-stream',
};
// what vercel's edge compressed when checked against yassin.app
const COMPRESSIBLE = /^(text\/|application\/(javascript|json|wasm|xml)|model\/gltf-binary|image\/(svg\+xml|vnd\.microsoft\.icon))/;
const MIN_COMPRESS_BYTES = 1024;
const DEFAULT_CACHE_CONTROL = 'public, max-age=0, must-revalidate';

// the subset of path-to-regexp that vercel.json sources use here: literal
// text, (regex) groups and :name segments
const sourceToRegExp = (source) => {
    let out = '';
    for (let i = 0; i < source.length; ) {
        const char = source[i];
        if (char === '(') {
            let depth = 0;
            let j = i;
            for (; j < source.length; j++) {
                if (source[j] === '\\') { j++; continue; }
                if (source[j] === '(') depth++;
                if (source[j] === ')' && --depth === 0) break;
            }
            out += source.slice(i, j + 1);
            i = j + 1;
        } else if (char === ':') {
            const match = /^:[A-Za-z0-9_]+/.exec(source.slice(i));
            out += '([^/]+)';
            i += match[0].length;
        } else if (char === '\\') {
            out += source.slice(i, i + 2);
            i += 2;
        } else {
            out += char.replace(/[.*+?^${}|[\]]/g, '\\$&');
            i++;
        }
    }
    return new RegExp(`^${out}$`);
};

const conditionMatches = (condition, url, headers) => {
    let value;
    if (condition.type === 'query') value = url.searchParams.get(condition.key);
    else if (condition.type === 'header') value = headers[condition.key.toLowerCase()];
    else if (condition.type === 'host') value = headers[':authority'] || headers.host;
    else return false;
    if (value === null || value === undefined) return false;
    if (condition.value === undefined) return true;
    return new RegExp(`^${condition.value}$`).test(value);
};

const loadRules = () => {
    const config = JSON.parse(fs.readFileSync(path.resolve(root, arg('config', 'vercel.json')), 'utf8'));
    return (config.headers || []).map((rule) => ({ ...rule, regex: sourceToRegExp(rule.source) }));
};

const headersFor = (rules, url, requestHeaders) => {
    const out = {};
    for (const rule of rules) {
        if (!rule.regex.test(url.pathname)) continue;
        if (rule.has && !rule.has.every((c) => conditionMatches(c, url, requestHeaders))) continue;
        if (rule.missing && rule.missing.some((c) => conditionMatches(c, url, requestHeaders))) continue;
        for (const { key, value } of rule.headers) out[key.toLowerCase()] = value;
    }
    if (!out['cache-control']) out['cache-control'] = DEFAULT_CACHE_CONTROL;
    return out;
};

const fileCache = new Map();
const readFile = (file) => {
    const stat = fs.statSync(file);
    const cached = fileCache.get(file);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached;
    const body = fs.readFileSync(file);
    const etag = crypto.createHash('sha1').update(body).digest('hex').slice(0, 32);
    const entry = { body, etag, mtimeMs: stat.mtimeMs, size: stat.size, br: null };
    fileCache.set(file, entry);
    return entry;
};

const resolveFile = (pathname) => {
    let decoded;
    try {
        decoded = decodeURIComponent(pathname);
    } catch {
        return null;
    }
    const file = path.join(dir, decoded);
    if (!file.startsWith(dir)) return null;
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
        const index = path.join(file, 'index.html');
        return fs.existsSync(index) ? index : null;
    }
    return fs.existsSync(file) ? file : null;
};

const rules = loadRules();
const server = http2.createSecureServer({ ...ensureCert(), allowHTTP1: true });

server.on('request', (req, res) => {
    try {
        handle(req, res);
    } catch (error) {
        console.error('[serve-build]', req.url, error);
        if (!res.headersSent) res.writeHead(500);
        res.end();
    }
});

const handle = (req, res) => {
    const url = new URL(req.url.replace(/^\/+/, '/'), 'https://local');
    const file = resolveFile(url.pathname);
    const send = (status, headers, body) => {
        res.writeHead(status, headers);
        res.end(req.method === 'HEAD' ? undefined : body);
        if (log) console.log(status, req.method, req.url, body ? body.length : 0);
    };
    if (!file) {
        send(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=0, must-revalidate' }, Buffer.from('not found'));
        return;
    }
    const entry = readFile(file);
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const headers = { ...headersFor(rules, url, req.headers), 'content-type': type };
    const acceptsBr = /\bbr\b/.test(req.headers['accept-encoding'] || '');
    const compress = acceptsBr && COMPRESSIBLE.test(type) && entry.size >= MIN_COMPRESS_BYTES;
    const etag = compress ? `W/"${entry.etag}"` : `"${entry.etag}"`;
    headers.etag = etag;
    const inm = (req.headers['if-none-match'] || '').replace(/W\//g, '');
    if (inm && inm.split(/\s*,\s*/).includes(`"${entry.etag}"`)) {
        send(304, headers, null);
        return;
    }
    if (compress) {
        if (!entry.br) {
            entry.br = zlib.brotliCompressSync(entry.body, {
                params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 3, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: entry.size },
            });
        }
        headers['content-encoding'] = 'br';
        headers.vary = 'Accept-Encoding';
        send(200, headers, entry.br);
        return;
    }
    headers['accept-ranges'] = 'bytes';
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range) {
        const start = range[1] ? Number(range[1]) : entry.size - Number(range[2]);
        const end = range[1] && range[2] ? Math.min(Number(range[2]), entry.size - 1) : entry.size - 1;
        if (start >= entry.size || start > end) {
            send(416, { 'content-range': `bytes */${entry.size}` }, null);
            return;
        }
        headers['content-range'] = `bytes ${start}-${end}/${entry.size}`;
        send(206, headers, entry.body.subarray(start, end + 1));
        return;
    }
    send(200, headers, entry.body);
};

server.listen(port, host, () => {
    console.log(`[serve-build] https://${host}:${port}/ from ${path.relative(root, dir) || '.'} (${rules.length} header rules)`);
});
