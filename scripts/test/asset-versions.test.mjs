import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const assetVersions = require('../asset-versions.js');
const { headers } = require('../../vercel.json');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-asset-versions-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const content = Buffer.from('worker content');
const extra = Object.fromEntries([
    'basis/ktx2-worker.js', 'draco/draco-worker.js', 'draco/draco-worker-js.js',
    'handheld/worker.js', 'models/room.glb', 'basis/basis_transcoder.wasm',
].map((key) => [key, content]));
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 8);

test('worker versions include their response CSP and leave byte sizes unchanged', () => {
    const result = assetVersions(dir, extra);
    for (const [key, source] of [
        ['basis/ktx2-worker.js', '/basis/ktx2-worker.js'],
        ['draco/draco-worker.js', '/draco/(.*)'],
        ['draco/draco-worker-js.js', '/draco/(.*)'],
        ['handheld/worker.js', '/handheld/(.*)'],
    ]) {
        const policy = headers.find((rule) => rule.source === source).headers
            .find(({ key }) => key === 'Content-Security-Policy').value;
        assert.equal(result.versions[key], hash(Buffer.concat([content, Buffer.from(`\0${policy}`)])));
        assert.notEqual(result.versions[key], hash(content));
        assert.equal(result.sizes[key], content.length);
    }
    for (const key of ['models/room.glb', 'basis/basis_transcoder.wasm']) {
        assert.equal(result.versions[key], hash(content));
        assert.equal(result.sizes[key], content.length);
    }
});

test('policy changes invalidate only the matching workers', () => {
    const changed = structuredClone(headers);
    changed.find((rule) => rule.source === '/basis/ktx2-worker.js').headers
        .find(({ key }) => key === 'Content-Security-Policy').value += "; connect-src 'none'";
    const before = assetVersions(dir, extra, headers);
    const after = assetVersions(dir, extra, changed);
    assert.notEqual(before.versions['basis/ktx2-worker.js'], after.versions['basis/ktx2-worker.js']);
    for (const key of Object.keys(extra).filter((key) => key !== 'basis/ktx2-worker.js')) {
        assert.equal(before.versions[key], after.versions[key], key);
    }
    assert.deepEqual(before.sizes, after.sizes);
    assert.deepEqual(assetVersions(dir, extra, headers), before);
});

test('changed bytes still invalidate workers and static and emitted assets agree', () => {
    fs.mkdirSync(path.join(dir, 'basis'), { recursive: true });
    const file = path.join(dir, 'basis', 'ktx2-worker.js');
    fs.writeFileSync(file, content);
    const fromFile = assetVersions(dir);
    assert.equal(fromFile.versions['basis/ktx2-worker.js'], assetVersions(dir, extra).versions['basis/ktx2-worker.js']);
    fs.writeFileSync(file, Buffer.concat([content, Buffer.from(' updated')]));
    assert.notEqual(fromFile.versions['basis/ktx2-worker.js'], assetVersions(dir).versions['basis/ktx2-worker.js']);
    assert.throws(() => assetVersions(dir, {}, []), /Missing worker response policy/);
});
