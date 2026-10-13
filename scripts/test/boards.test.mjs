// the boards are each driver's best (supabase/racing.sql nordschleife_board and
// drift_park_board): the service reads them through those functions and
// doesn't mix this device's laps in while the board is up, a lap says how it
// stood once it's in, and the hud puts that in words
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
const { default: LeaderboardService, bestPerDriver } = await import(
    '../../src/Application/Racing/Leaderboard/LeaderboardService.ts'
);
const { lapVerdict } = await import('../../src/Application/Racing/Leaderboard/lapResult.ts');

// a stand-in for supabase-js: each rpc call or table read and what's chained
// on it is kept, and awaiting it gives what the test answers
const fakeClient = (answer) => {
    const calls = [];
    const start = (call) => {
        calls.push(call);
        const builder = new Proxy(
            {},
            {
                get(_, key) {
                    if (key === 'then') {
                        return (resolve, reject) => Promise.resolve(answer(call)).then(resolve, reject);
                    }
                    return (...rest) => {
                        call.chain.push([key, ...rest]);
                        return builder;
                    };
                },
            }
        );
        return builder;
    };
    const client = {
        rpc: (fn, args, options) => start({ fn, args, options, chain: [] }),
        from: (table) => start({ fn: `from:${table}`, chain: [] }),
    };
    return { client, calls };
};

const serviceWith = (client) => {
    store.clear();
    const service = new LeaderboardService(new LocalLeaderboard());
    service.initialized = true;
    service.supabase = client;
    return service;
};

const row = (id, name, ms, carId) => ({ id, name, lap_time_ms: ms, car_id: carId, created_at: '', player_id: null, player: null });

test("the board is the database's, each driver once, without this device's laps", async () => {
    const { client, calls } = fakeClient((call) => ({
        data: [row('lap-1', 'Ann', 390000, `amg-one${call.args.p_season}~tq1`)],
        error: null,
    }));
    const service = serviceWith(client);
    service.local.add({ name: 'yassin', lapTimeMs: 380000, carId: 'amg-one', tune: 'q1' });

    const entries = await service.getLeaderboard(10, 'tuned', 'amg-one');
    assert.deepEqual(
        entries.map((entry) => entry.id),
        ['lap-1']
    );
    assert.equal(calls[0].fn, 'nordschleife_board');
    assert.deepEqual(calls[0].args, { p_season: '@v7', p_tuned: true, p_car: 'amg-one' });
    assert.deepEqual(calls[0].options, { get: true });
    assert.deepEqual(
        calls[0].chain.map(([key, ...rest]) => (key === 'select' ? key : [key, ...rest])),
        ['select', ['order', 'lap_time_ms', { ascending: true }], ['limit', 10]]
    );

    await service.getLeaderboard(5, 'stock', 'gt3rs');
    assert.deepEqual(calls[1].args, { p_season: '@v7', p_tuned: false });

    // last season is still there to read, without this device's laps
    const last = await service.getLeaderboard(5, 'stock', null, 'last');
    assert.deepEqual(calls[2].args, { p_season: '@v6', p_tuned: false });
    assert.equal(last[0].lastSeason, true);
    assert.equal(entries[0].lastSeason, undefined);
    assert.ok(last.every((entry) => entry.source === 'remote'));
});

test("the garage's board tunes come from both seasons, one per tune", async () => {
    const { client, calls } = fakeClient(() => ({
        data: [
            row('new-q1', 'Ann', 390000, 'amg-one@v7~tq1'),
            row('old-q1', 'Bob', 391000, 'amg-one@v6~tq1'),
            row('old-z9', 'Cat', 395000, 'amg-one@v6~tz9'),
        ],
        error: null,
    }));
    const service = serviceWith(client);
    const tunes = await service.getTunesForCar('amg-one');
    assert.deepEqual(
        tunes.map((entry) => [entry.id, entry.tune, entry.lastSeason === true]),
        [
            ['new-q1', 'q1', false],
            ['old-z9', 'z9', true],
        ]
    );
    assert.equal(calls[0].fn, 'from:nordschleife_leaderboard');
    assert.deepEqual(
        calls[0].chain.find(([key]) => key === 'or'),
        ['or', 'car_id.like.amg-one@v7~t*,car_id.like.amg-one@v6~t*']
    );
    assert.deepEqual(
        calls[0].chain.find(([key]) => key === 'eq'),
        ['eq', 'verified', true]
    );
});

test('a rank counts the drivers whose best is faster', async () => {
    const { client, calls } = fakeClient(() => ({ count: 4, error: null }));
    const service = serviceWith(client);
    assert.equal(await service.getRankOf(400000.6, 'stock'), 5);
    assert.deepEqual(calls[0].options, { get: true, head: true, count: 'exact' });
    assert.deepEqual(calls[0].chain, [['lt', 'lap_time_ms', 400000]]);

    const failing = serviceWith(fakeClient(() => ({ count: null, error: { message: 'down' } })).client);
    assert.equal(await failing.getRankOf(400000, 'stock'), 0);
});

test("the drift park's board is each driver's best run", async () => {
    const { client, calls } = fakeClient(() => ({
        data: [{ id: 'run-1', name: 'Ann', score: 60000, lap_time_ms: 82000, car_id: 'amg-one@d1', created_at: '' }],
        error: null,
    }));
    const service = serviceWith(client);
    const entries = await service.getDriftBoard(10);
    assert.deepEqual(
        entries.map((entry) => [entry.id, entry.score]),
        [['run-1', 60000]]
    );
    assert.equal(calls[0].fn, 'drift_park_board');
    assert.deepEqual(calls[0].args, { p_season: '@d1' });
    assert.deepEqual(calls[0].chain.slice(1), [
        ['order', 'score', { ascending: false }],
        ['order', 'lap_time_ms', { ascending: true }],
        ['limit', 10],
    ]);
});

test('offline, the board is this device’s laps, each name once', async () => {
    const service = serviceWith(null);
    service.local.add({ name: 'yassin', lapTimeMs: 470000, carId: 'amg-one' });
    service.local.add({ name: 'Yassin ', lapTimeMs: 460000, carId: 'bmw-e92-m3' });
    service.local.add({ name: 'Ajmal', lapTimeMs: 465000, carId: 'amg-one' });
    const entries = await service.getLeaderboard(10, 'stock');
    assert.deepEqual(
        entries.map((entry) => [entry.name, entry.lapTimeMs]),
        [
            ['Yassin ', 460000],
            ['Ajmal', 465000],
        ]
    );
    assert.deepEqual(
        bestPerDriver([
            { name: 'Old', player: { name: 'New' } },
            { name: 'new' },
            { name: 'Other' },
        ]).map((entry) => entry.name),
        ['Old', 'Other']
    );
});

test('a lap says how it stands, and a lap the board never got asks nothing', async () => {
    const { client, calls } = fakeClient(() => ({
        data: [{ verified: true, previous_ms: 400000, rank: 2, drivers: 3 }],
        error: null,
    }));
    const service = serviceWith(client);
    assert.deepEqual(await service.getLapStanding('2f0e4c1a-0000-4000-8000-000000000001'), {
        verified: true,
        previousMs: 400000,
        rank: 2,
        drivers: 3,
    });
    assert.equal(calls[0].fn, 'nordschleife_lap_standing');
    assert.deepEqual(calls[0].args, { p_lap_id: '2f0e4c1a-0000-4000-8000-000000000001' });

    assert.equal(await service.getLapStanding('local-123'), null);
    assert.equal(calls.length, 1);

    const first = serviceWith(
        fakeClient(() => ({ data: [{ verified: true, previous_ms: null, rank: null, drivers: 0 }], error: null })).client
    );
    assert.deepEqual(await first.getLapStanding('lap-9'), { verified: true, previousMs: 0, rank: 0, drivers: 0 });
    const missing = serviceWith(fakeClient(() => ({ data: [], error: null })).client);
    assert.equal(await missing.getLapStanding('lap-9'), null);
});

const clock = (ms) => `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`;
const result = (lapTimeMs, standing, extra = {}) => ({
    id: 'lap-1',
    lapTimeMs,
    board: 'stock',
    saved: true,
    online: true,
    standing,
    ...extra,
});

test('the hud says a new best, how far off it, or why a lap is not on the board', () => {
    assert.deepEqual(lapVerdict(result(380308, { verified: true, previousMs: 0, rank: 1, drivers: 9 }, { board: 'tuned' }), clock), {
        tone: 'best',
        title: 'New PB',
        detail: '#1 of 9 on the Tuned board (your car has garage changes)',
    });
    assert.deepEqual(lapVerdict(result(387083, { verified: true, previousMs: 389000, rank: 1, drivers: 12 }), clock), {
        tone: 'best',
        title: 'New PB, 1.917 s faster',
        detail: '#1 of 12 on the Stock board',
    });
    assert.deepEqual(lapVerdict(result(392345, { verified: true, previousMs: 390000, rank: 3, drivers: 12 }), clock), {
        tone: 'slower',
        title: '+2.345 off your PB',
        detail: 'PB 6:30.000, #3 of 12 on the Stock board',
    });
    assert.equal(lapVerdict(result(390000, { verified: true, previousMs: 390000, rank: 3, drivers: 12 }), clock).title, 'Matched your PB');
    assert.equal(lapVerdict(result(390000, { verified: false, previousMs: 0, rank: 0, drivers: 0 }), clock).title, 'Not on the board');
    assert.deepEqual(lapVerdict(result(390000, null, { saved: false, online: false }), clock), {
        tone: 'off',
        title: 'Saved on this device only',
        detail: 'The board is offline',
    });
    assert.equal(
        lapVerdict(result(390000, null, { saved: false }), clock).detail,
        'The board didn’t take it, try again in a few minutes'
    );
    assert.equal(lapVerdict(result(390000, null), clock).title, 'Lap sent');
});
