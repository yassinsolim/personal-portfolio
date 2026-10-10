// a lap taken off the board (supabase nordschleife_removed_laps): the device
// that set it drops its own copies, its best lap for the delta, and keeps a
// notice for the player until it's dismissed. other devices' laps and this
// device's other laps stay
//
//   npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import './ts-hooks.mjs';

const store = new Map();
globalThis.window = {
    localStorage: {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => store.set(key, String(value)),
        removeItem: (key) => store.delete(key),
    },
    location: { search: '' },
};

const { default: LocalLeaderboard } = await import('../../src/Application/Racing/Leaderboard/LocalLeaderboard.ts');
const { default: LeaderboardService } = await import('../../src/Application/Racing/Leaderboard/LeaderboardService.ts');
const { default: LapDelta } = await import('../../src/Application/Racing/Lap/LapDelta.ts');
const { addRemovedNotices, dismissRemovedNotice, readRemovedNotices } = await import(
    '../../src/Application/Racing/Leaderboard/removedLaps.ts'
);

const removed = (over = {}) => ({
    lapId: 'f828b94d-9fe1-4b6c-abfe-0ced77d57cd9',
    name: 'Mohamed',
    lapTimeMs: 302406,
    carId: 'bugatti-chiron-super-sport',
    tuned: true,
    reason: 'It backed over the start line and came back.',
    removedAt: '2026-10-09T12:00:00Z',
    ...over,
});

test('the device that set a removed lap drops it, its ghost and nothing else', () => {
    store.clear();
    const local = new LocalLeaderboard();
    const bogus = local.add({ name: 'Mohamed', lapTimeMs: 302406, carId: 'bugatti-chiron-super-sport', tune: 'i1iiiiiiizy0tz08' });
    local.add({ name: 'Mohamed', lapTimeMs: 455000, carId: 'bugatti-chiron-super-sport', tune: 'i1iiiiiiizy0tz08' });
    // same time and car, but stock: a different lap
    local.add({ name: 'Mohamed', lapTimeMs: 302406, carId: 'bugatti-chiron-super-sport' });
    const service = new LeaderboardService(local);
    const samples = Array.from({ length: 8 }, (_, i) => ({ t: i * 100, x: i, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 }));
    service.cacheGhostReplay(bogus.id, { lapTimeMs: 302406, carId: 'bugatti-chiron-super-sport', samples });

    const mine = service.forgetRemovedLaps([removed(), removed({ lapId: 'someone-else', lapTimeMs: 420000 })]);
    assert.deepEqual(mine.map((lap) => lap.lapId), ['f828b94d-9fe1-4b6c-abfe-0ced77d57cd9']);
    assert.deepEqual(
        local.entries.map((entry) => [entry.lapTimeMs, Boolean(entry.tune)]),
        [[302406, false], [455000, true]]
    );
    assert.equal(service.ghostReplayCache.has(bogus.id), false);
    assert.equal(new LocalLeaderboard().entries.length, 2, 'saved');
    assert.deepEqual(service.forgetRemovedLaps([removed()]), [], 'only once');
});

test('its best lap for the delta goes, a different best stays', () => {
    store.clear();
    const delta = new LapDelta();
    delta.setKey('bugatti-chiron-super-sport', true);
    const lap = Array.from({ length: 1001 }, (_, i) => i * 302);
    delta.best = lap;
    delta.bestLapMs = 302406.7;
    delta.save();
    delta.forget('bugatti-chiron-super-sport', true, 300000);
    assert.equal(delta.bestLapMs, 302406.7, 'another time');
    delta.forget('bugatti-chiron-super-sport', false, 302406);
    assert.equal(delta.bestLapMs, 302406.7, 'the stock board');
    delta.forget('bugatti-chiron-super-sport', true, 302406);
    assert.equal(delta.bestLapMs, 0);
    assert.equal(delta.best, null);
    delta.setKey('amg-one', false);
    delta.setKey('bugatti-chiron-super-sport', true);
    assert.equal(delta.bestLapMs, 0, 'gone from storage');
});

test('the player is told once per lap, until they dismiss it', () => {
    store.clear();
    addRemovedNotices([removed()]);
    addRemovedNotices([removed()]);
    assert.equal(readRemovedNotices().length, 1);
    assert.equal(readRemovedNotices()[0].reason, 'It backed over the start line and came back.');
    assert.deepEqual(dismissRemovedNotice('f828b94d-9fe1-4b6c-abfe-0ced77d57cd9'), []);
    store.set('yassinverse:nordschleife:removedLaps', JSON.stringify([{ lapId: 5 }, 'x', removed({ lapId: 'b' })]));
    assert.deepEqual(readRemovedNotices().map((lap) => lap.lapId), ['b'], 'junk is dropped');
});
