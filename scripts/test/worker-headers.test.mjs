import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { devServer } = require('../../bundler/webpack.dev.js');
const production = require('../../vercel.json');
const headers = (url) => devServer.headers({ url });

test('dev worker policies match production, including versioned requests', () => {
    for (const [url, source] of [
        ['/basis/ktx2-worker.js', '/basis/ktx2-worker.js'],
        ['/basis/ktx2-worker.js?v=test', '/basis/ktx2-worker.js'],
        ['/draco/draco-worker.js?v=test', '/draco/(.*)'],
        ['/handheld/flipper-worker.js', '/handheld/(.*)'],
    ]) {
        const expected = production.headers.find((rule) => rule.source === source)
            .headers.find(({ key }) => key === 'Content-Security-Policy').value;
        assert.equal(headers(url)['Content-Security-Policy'], expected, url);
    }
});

test('only the Basis worker gets eval; documents keep the strict script policy', () => {
    for (const url of ['/', '/bundle.js', '/basis/ktx2-workerXjs', '/basis/ktx2-worker.js/extra']) {
        const policy = headers(url)['Content-Security-Policy'];
        assert.ok(!policy.includes("'unsafe-eval'"), url);
        assert.ok(policy.includes('frame-src https://os.yassin.app'), url);
        assert.equal(headers(url)['X-Frame-Options'], 'DENY');
    }
});
