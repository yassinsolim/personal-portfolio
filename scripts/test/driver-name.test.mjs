// the made-up names fit the board's 16 characters and are never "Driver"
//
//   npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import './ts-hooks.mjs';

const { randomDriverName, isDefaultDriverName, MAX_DRIVER_NAME } =
    await import('../../src/Application/Racing/Multiplayer/driverName.ts');

test('made-up names fit the board and are not the default', () => {
    for (let i = 0; i < 2000; i++) {
        const name = randomDriverName();
        assert.ok(name.length >= 1 && name.length <= MAX_DRIVER_NAME, name);
        assert.equal(name, name.trim());
        assert.ok(!isDefaultDriverName(name), name);
    }
    // the longest words drop the number instead of going over
    assert.equal(randomDriverName(() => 0.999), 'Midnight Cobra');
    assert.equal(randomDriverName(() => 0), 'Apex Fox 10');
});

test('an empty or default name still needs picking', () => {
    for (const name of [null, undefined, '', '   ', 'Driver', ' Driver ']) {
        assert.ok(isDefaultDriverName(name), String(name));
    }
    for (const name of ['driver2', 'Yassin', 'Apex Fox 10']) {
        assert.ok(!isDefaultDriverName(name), name);
    }
});
