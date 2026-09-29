// the adaptive resolution has to work on machines too slow for its windows:
// a steady 3 fps used to count every frame as a hitch and never adapt
//
//   npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import './ts-hooks.mjs';

const { default: AdaptiveResolution } =
    await import('../../src/Application/Utils/AdaptiveResolution.ts');

// frame time follows the pixel count (ratio squared) from what it is at 1.5x
const run = (adaptive, msAtMax, seconds) => {
    let now = 0;
    while (now < seconds * 1000) {
        const ms = msAtMax * (adaptive.ratio / 1.5) ** 2;
        now += ms;
        adaptive.frame(ms, now);
    }
    return adaptive.ratio;
};

test('a steady 300 ms frame brings the resolution down', () => {
    const adaptive = new AdaptiveResolution(0.5, 1.5, 1.5);
    assert.ok(run(adaptive, 300, 40) < 1, `ratio ${adaptive.ratio}`);
});

test('a steady 30 fps brings it down, 60 fps keeps it', () => {
    assert.ok(run(new AdaptiveResolution(0.5, 1.5, 1.5), 33, 20) < 1.5);
    assert.equal(run(new AdaptiveResolution(0.5, 1.5, 1.5), 16.6, 20), 1.5);
});

test('one long hitch among good frames changes nothing', () => {
    const adaptive = new AdaptiveResolution(0.5, 1.5, 1.5);
    let now = 0;
    for (let i = 0; i < 1200; i++) {
        const ms = i === 300 ? 900 : 16.6;
        now += ms;
        adaptive.frame(ms, now);
    }
    assert.equal(adaptive.ratio, 1.5);
});
