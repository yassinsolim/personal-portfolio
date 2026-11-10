// node scripts/gamepad-check.mjs http://127.0.0.1:8081/
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const url = new URL(process.argv[2] || 'http://127.0.0.1:8081/');
url.searchParams.set('raceDebug', '1');
url.searchParams.set('mpmock', '1');
const browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--host-resolver-rules=MAP *.supabase.co ~NOTFOUND'],
});
const failures = [];
const results = [];

try {
    for (const mobile of [false, true]) {
        const context = await browser.newContext({
            viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
            isMobile: mobile,
            hasTouch: mobile,
            ignoreHTTPSErrors: ['127.0.0.1', 'localhost'].includes(url.hostname),
        });
        await context.addInitScript(() => {
            document.addEventListener('loadingScreenDone', () => { window.__roomReady = true; });
        });
        const page = await context.newPage();
        page.on('pageerror', (error) => failures.push(error.message));
        await page.goto(url.href, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__roomReady && window.Application?.gamepad, null, {
            timeout: 90000,
        });
        await page.evaluate(() => {
            window.__testPads = [];
            Object.defineProperty(navigator, 'getGamepads', {
                configurable: true, value: () => window.__testPads,
            });
            window.Application.gamepad.connected = true;
            window.Application.gamepad.update();
        });
        const state = () => page.evaluate(() => {
            window.Application.gamepad.update();
            return {
                active: document.documentElement.classList.contains('pad-mode'),
                ring: document.querySelector('.pad-target').classList.contains('on'),
                hints: document.querySelector('.pad-hints').classList.contains('on'),
            };
        });
        const expectInactive = async () =>
            assert.deepEqual(await state(), { active: false, ring: false, hints: false });
        const setPad = async ({ axes = [0, 0, 0, 0], pressed = [], mapping = 'standard' } = {}) => {
            await page.evaluate(({ axes, pressed, mapping }) => {
                window.__testPads = [{
                    index: 0, id: 'Regression controller', connected: true, mapping, axes,
                    buttons: Array.from({ length: 17 }, (_, index) => ({
                        pressed: pressed.includes(index), value: pressed.includes(index) ? 1 : 0,
                    })),
                }];
                window.Application.gamepad.update();
            }, { axes, pressed, mapping });
        };
        await expectInactive();
        await setPad();
        await expectInactive();
        await setPad({ axes: [0.25, 0.1, 0.25, 0] });
        await expectInactive();
        await setPad({ mapping: '', axes: [0, 0, -1, 0, 0, -1] });
        await expectInactive();
        await setPad();
        await setPad({ pressed: [10] });
        assert.equal((await state()).active, true);
        if (mobile) {
            await page.touchscreen.tap(20, 20);
        } else {
            await page.mouse.move(20, 20);
            await page.mouse.move(35, 25);
        }
        await expectInactive();
        // A held button cannot re-enable the pad on later animation frames.
        await page.waitForTimeout(300);
        await expectInactive();
        await setPad();
        await setPad({ axes: [0.8, 0, 0, 0] });
        assert.equal((await state()).active, true);
        await page.keyboard.press('Tab');
        await expectInactive();
        assert.equal(await page.evaluate(() => document.activeElement !== document.body), true);
        await setPad();
        await setPad({ pressed: [10] });
        assert.equal((await state()).active, true);
        await page.mouse.wheel(0, 50);
        await expectInactive();
        await setPad();
        await setPad({ pressed: [10] });
        await page.evaluate(() => { window.__testPads = []; });
        await expectInactive();
        results.push({ profile: mobile ? 'mobile' : 'desktop', checks: 'passed' });
        await context.close();
    }
    assert.deepEqual(failures, [], 'Browser runtime errors');
    console.log(JSON.stringify({ url: url.href, results, runtimeErrors: failures }, null, 2));
} finally {
    await browser.close();
}
