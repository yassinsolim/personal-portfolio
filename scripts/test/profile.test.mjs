// driver profiles (Racing/Profile/profile.ts): what comes back from the
// database is cleaned before it's shown, this device's player is made once
// and kept, the profile it saves carries the garage as short codes, and the
// board's rows carry their driver's badge
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

const profile = await import('../../src/Application/Racing/Profile/profile.ts');
const { sanitizeBoardQuery } = await import('../../src/Application/Racing/Leaderboard/boardQuery.ts');
const { default: LocalLeaderboard } = await import('../../src/Application/Racing/Leaderboard/LocalLeaderboard.ts');
const { default: LeaderboardService } = await import('../../src/Application/Racing/Leaderboard/LeaderboardService.ts');
const { STOCK_LOOK, STOCK_TUNE, saveLook, saveTune, decodeLook, decodeTune } = await import(
    '../../src/Application/Racing/Garage/garage.ts'
);

const ID = '0b7c9a52-3f4e-4d1a-9c3b-2f6e8d1a4b5c';

test('a badge from the database is cleaned, and a row without a real id is nobody', () => {
    const badge = profile.sanitizeBadge({
        id: ID,
        name: '  Late\u202e Braker\u0007  ',
        avatar: '<script>',
        color: 'red',
        number: 100,
    });
    assert.deepEqual(badge, { id: ID, name: 'Late Braker', avatar: 'helmet', color: '#e8b04a', number: null });
    assert.equal(profile.sanitizeBadge({ id: 'not-a-uuid', name: 'X' }), null);
    assert.equal(profile.sanitizeBadge(null), null);
    assert.equal(profile.sanitizeBadge({ id: ID, name: '', color: '#ABCDEF', number: 7, avatar: 'bolt' }).name, 'Driver');
    assert.equal(profile.sanitizeBadge({ id: ID, color: '#ABCDEF' }).color, '#abcdef');
    assert.equal(profile.sanitizeBadge({ id: ID, number: 4.5 }).number, null);
    assert.equal(profile.sanitizeBadge({ id: ID, number: '7' }).number, 7);
});

test('a profile keeps only cars the game has and codes it can read', () => {
    const player = profile.sanitizePlayer({
        id: ID,
        name: 'QA',
        bio: 'x'.repeat(200),
        car: 'gt3rs',
        garage: {
            'bmw-e92-m3': { look: '1f4fa8.2....0.-3', tune: 'ihhhhhhhhh' },
            'amg-one': { look: '<b>', tune: 'NOT_OK' },
            gt3rs: { look: '', tune: '' },
        },
        created_at: '2026-10-10T12:00:00Z',
    });
    assert.equal(player.bio.length, 140);
    assert.equal(player.car, null);
    assert.deepEqual(player.garage, {
        'bmw-e92-m3': { look: '1f4fa8.2....0.-3', tune: 'ihhhhhhhhh' },
        'amg-one': { look: '', tune: '' },
    });
    assert.equal(player.createdAt, '2026-10-10T12:00:00Z');
});

test("this device's player is made once, kept, and can start over", () => {
    store.clear();
    assert.equal(profile.readIdentity(), null);
    const first = profile.ensureIdentity();
    assert.match(first.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.match(first.key, /^[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(profile.ensureIdentity(), first);
    assert.deepEqual(profile.readIdentity(), first);
    profile.forgetIdentity();
    const next = profile.ensureIdentity();
    assert.notEqual(next.id, first.id);
    assert.notEqual(next.key, first.key);
});

test('the saved profile shows off the car driven unless one is picked, with the garage as codes', () => {
    store.clear();
    const look = { ...STOCK_LOOK, paint: '#1f4fa8', finish: 'metallic' };
    const tune = { ...STOCK_TUNE, tires: 'slick', power: 1.1 };
    saveLook('bmw-e92-m3', look);
    saveTune('bmw-e92-m3', tune);
    const draft = { ...profile.DEFAULT_DRAFT, avatar: 'bolt', number: 7, bio: '  Late on   the brakes ' };
    const payload = profile.profilePayload('QA Driver', draft, 'amg-one');
    assert.equal(payload.name, 'QA Driver');
    assert.equal(payload.bio, 'Late on the brakes');
    assert.equal(payload.car, 'amg-one');
    // the car shown off is in even when it's factory, the set up one too
    assert.deepEqual(payload.garage['amg-one'], { look: '', tune: '' });
    const codes = payload.garage['bmw-e92-m3'];
    assert.deepEqual(decodeLook(codes.look), look);
    assert.equal(decodeTune(codes.tune).tune.tires, 'slick');
    assert.equal(Object.keys(payload.garage).length, 2);
    // and what the race side gets back from the event is the same
    assert.deepEqual(profile.sanitizePayload(JSON.parse(JSON.stringify(payload))), payload);

    const picked = profile.profilePayload('QA', { ...draft, car: 'bmw-e92-m3' }, 'amg-one');
    assert.equal(picked.car, 'bmw-e92-m3');
    assert.equal(picked.garage['amg-one'], undefined);
});

test('the draft round trips through storage, cleaned', () => {
    store.clear();
    assert.deepEqual(profile.readDraft(), profile.DEFAULT_DRAFT);
    profile.writeDraft({ avatar: 'crown', color: '#FFAA00', number: 12, bio: 'hi\u0000 there', car: 'nope' });
    assert.deepEqual(profile.readDraft(), { avatar: 'crown', color: '#ffaa00', number: 12, bio: 'hi there', car: null });
});

test('initials from a name', () => {
    assert.equal(profile.initialsOf('Apex Fox 42'), 'AF');
    assert.equal(profile.initialsOf('yassin'), 'YA');
    assert.equal(profile.initialsOf(''), 'D');
});

test('board rows carry their driver, and the board filter picks a car', () => {
    const service = new LeaderboardService(new LocalLeaderboard());
    const entry = service.fromLapRow({
        id: 'lap-1',
        name: 'QA',
        lap_time_ms: 480000,
        car_id: 'bmw-e92-m3@v6~t0a1b2c3d4e',
        created_at: '2026-10-10T12:00:00Z',
        player_id: ID,
        player: { id: ID, name: 'QA Driver', avatar: 'flag', color: '#3e63dd', number: 3 },
    });
    assert.equal(entry.playerId, ID);
    assert.deepEqual(entry.player, { id: ID, name: 'QA Driver', avatar: 'flag', color: '#3e63dd', number: 3 });
    const bare = service.fromLapRow({ id: 'lap-2', name: 'Old', lap_time_ms: 480000, car_id: 'bmw-e92-m3@v7', created_at: '' });
    assert.equal(bare.playerId, null);
    assert.equal(bare.player, null);

    assert.deepEqual(service.boardFilter('stock'), ['like', '%@v7']);
    assert.deepEqual(service.boardFilter('tuned'), ['like', '%@v7~t%']);
    assert.deepEqual(service.boardFilter('stock', 'amg-one'), ['eq', 'amg-one@v7']);
    assert.deepEqual(service.boardFilter('tuned', 'amg-one'), ['like', 'amg-one@v7~t%']);
    assert.deepEqual(service.boardFilter('stock', 'gt3rs'), ['like', '%@v7']);
    assert.deepEqual(service.boardFilter('tuned', 'amg-one', 'last'), ['like', 'amg-one@v6~t%']);
    assert.equal(service.fromLapRow({ id: 'old', name: 'Old', lap_time_ms: 480000, car_id: 'amg-one@v6', created_at: '' }).lastSeason, true);
    assert.equal(bare.lastSeason, undefined);
});

test("a lap renamed on the board isn't shown twice on the device that set it", () => {
    const service = new LeaderboardService(new LocalLeaderboard());
    const lap = { lapTimeMs: 447157, carId: 'bugatti-chiron-super-sport', createdAt: '' };
    const remote = [{ ...lap, id: 'lap-1', name: 'Ajmal', source: 'remote' }];
    const local = [
        { ...lap, id: 'local-1', name: 'yassin', source: 'local' },
        { ...lap, id: 'local-2', name: 'yassin', source: 'local', tune: '0a1b2c3d4e' },
        { ...lap, id: 'local-3', name: 'yassin', source: 'local', lapTimeMs: 459603 },
    ];
    assert.deepEqual(
        service.mergeEntries(remote, local).map((entry) => entry.id),
        ['lap-1', 'local-2', 'local-3']
    );
});

test("the menu's board query only takes what it knows", () => {
    assert.deepEqual(sanitizeBoardQuery({ track: 'drift', board: 'tuned', carId: 'amg-one', season: 'last' }), {
        track: 'drift',
        board: 'tuned',
        carId: 'amg-one',
        season: 'last',
    });
    assert.deepEqual(sanitizeBoardQuery({ track: 'moon', board: 'x', carId: 'gt3rs', season: 'v1' }), {
        track: 'ring',
        board: 'stock',
        carId: null,
        season: 'current',
    });
});
