// signing in on other devices (Racing/Profile): a taken name is its own save
// status, signing in takes a key of the device's own and the profile's
// setups, saves queued under the old player don't land on the new one, and
// signing out starts the device over
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
    setTimeout: () => 0,
    clearTimeout: () => undefined,
};

const profile = await import('../../src/Application/Racing/Profile/profile.ts');
const { default: ProfileService } = await import('../../src/Application/Racing/Profile/ProfileService.ts');
const { decodeTune, loadLook, loadTune, saveTune, STOCK_TUNE } = await import(
    '../../src/Application/Racing/Garage/garage.ts'
);

const ACCOUNT = '5d0f8a8e-3b7c-4e2a-9c61-0a4b7e2d9f13';
const PAYLOAD = { name: 'QA Phone', avatar: 'bolt', color: '#3e63dd', number: null, bio: '', car: null, garage: {} };

// supabase-js's rpc, answered by the test, each call kept
const fakeClient = (answer) => {
    const calls = [];
    return {
        calls,
        client: {
            rpc: async (fn, args) => {
                calls.push({ fn, args });
                return answer(fn, args);
            },
        },
    };
};

const serviceWith = (client) => {
    const statuses = [];
    const service = new ProfileService(async () => client, (status) => statuses.push(status));
    return { service, statuses };
};

const accountRow = {
    id: ACCOUNT,
    name: 'yass',
    avatar: 'crown',
    color: '#e5484d',
    number: 7,
    bio: 'both devices',
    car: 'koenigsegg-jesko',
    garage: { 'koenigsegg-jesko': { look: '', tune: 'zdiiiiiii9' }, 'amg-one': { look: '', tune: '' } },
    created_at: '2026-10-12T20:20:00Z',
};

test('a name someone else has is its own status, and is not tried again', async () => {
    store.clear();
    const { client } = fakeClient(() => ({ data: null, error: { code: '23505', message: 'that name is taken' } }));
    const { service, statuses } = serviceWith(client);
    service.save(PAYLOAD);
    await service.saving;
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(statuses, ['saving', 'taken']);
    assert.ok(profile.readIdentity(), 'the device keeps its player');
});

test('signing in takes a key of its own, and brings the device player only when asked', async () => {
    store.clear();
    const before = profile.ensureIdentity();
    const { client, calls } = fakeClient((fn) =>
        fn === 'racing_sign_in' ? { data: { signed_in: true, player: accountRow }, error: null } : { data: null, error: null }
    );
    const { service } = serviceWith(client);

    const result = await service.signIn(' yass ', 'correct horse', false);
    assert.equal(result.status, 'in');
    assert.equal(result.player.name, 'yass');
    assert.equal(calls[0].args.p_name, 'yass');
    assert.equal(calls[0].args.p_from_id, null);
    assert.equal(calls[0].args.p_from_key, null);
    const after = profile.readIdentity();
    assert.equal(after.id, ACCOUNT);
    assert.notEqual(after.key, before.key);
    assert.equal(after.key, calls[0].args.p_key);

    store.clear();
    const device = profile.ensureIdentity();
    await serviceWith(client).service.signIn('yass', 'correct horse', true);
    assert.equal(calls[1].args.p_from_id, device.id);
    assert.equal(calls[1].args.p_from_key, device.key);
});

test('a wrong password leaves the device as it was', async () => {
    store.clear();
    const before = profile.ensureIdentity();
    const { client } = fakeClient(() => ({ data: { signed_in: false }, error: null }));
    const result = await serviceWith(client).service.signIn('yass', 'nope', true);
    assert.deepEqual(result, { status: 'wrong' });
    assert.deepEqual(profile.readIdentity(), before);

    const limited = fakeClient(() => ({ data: null, error: { code: '53400', message: 'too many' } }));
    assert.deepEqual(await serviceWith(limited.client).service.signIn('yass', 'nope', false), { status: 'limited' });
    assert.deepEqual(await serviceWith(null).service.signIn('yass', 'nope', false), { status: 'offline' });
});

test("a save queued while signing in is the old player's, and doesn't go out", async () => {
    store.clear();
    profile.ensureIdentity();
    let release;
    const { client, calls } = fakeClient((fn) =>
        fn === 'racing_sign_in'
            ? new Promise((resolve) => {
                  release = () => resolve({ data: { signed_in: true, player: accountRow }, error: null });
              })
            : { data: null, error: null }
    );
    const { service } = serviceWith(client);
    const signing = service.signIn('yass', 'correct horse', false);
    await new Promise((resolve) => setImmediate(resolve));
    service.save(PAYLOAD);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(
        calls.map((call) => call.fn),
        ['racing_sign_in']
    );
    release();
    await signing;
    await service.saving;
    assert.deepEqual(
        calls.map((call) => call.fn),
        ['racing_sign_in']
    );
    assert.equal(service.pending, null);
});

test('signing out forgets the player, and a name check says free when it cannot tell', async () => {
    store.clear();
    profile.ensureIdentity();
    const { client, calls } = fakeClient((fn) =>
        fn === 'racing_name_free' ? { data: false, error: null } : { data: null, error: null }
    );
    const { service } = serviceWith(client);
    assert.equal(await service.nameFree('Becklandxd'), false);
    assert.equal(calls[0].args.p_name, 'Becklandxd');
    assert.equal(await service.signOut(), 'out');
    assert.equal(profile.readIdentity(), null);

    const down = fakeClient(() => ({ data: null, error: { code: '500', message: 'down' } }));
    assert.equal(await serviceWith(down.client).service.nameFree('Becklandxd'), true);
    assert.equal(await serviceWith(null).service.nameFree('Becklandxd'), true);
});

test('signing out while a sign in is out waits for it, and a browser that keeps nothing is told', async () => {
    store.clear();
    profile.ensureIdentity();
    let release;
    const order = [];
    const { client } = fakeClient((fn) => {
        order.push(fn);
        if (fn !== 'racing_sign_in') return { data: null, error: null };
        return new Promise((resolve) => {
            release = () => resolve({ data: { signed_in: true, player: accountRow }, error: null });
        });
    });
    const { service } = serviceWith(client);
    const signing = service.signIn('yass', 'correct horse', false);
    const leaving = service.signOut();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(order, ['racing_sign_in']);
    release();
    assert.equal((await signing).status, 'in');
    assert.equal(await leaving, 'out');
    assert.deepEqual(order, ['racing_sign_in', 'racing_sign_out']);
    assert.equal(profile.readIdentity(), null);

    const setItem = window.localStorage.setItem;
    window.localStorage.setItem = () => {
        throw new Error('quota');
    };
    try {
        const ok = fakeClient(() => ({ data: { signed_in: true, player: accountRow }, error: null }));
        assert.deepEqual(await serviceWith(ok.client).service.signIn('yass', 'correct horse', false), {
            status: 'storage',
        });
    } finally {
        window.localStorage.setItem = setItem;
    }
});

test("a signed in profile's setups go on the device, its other cars keep theirs", () => {
    store.clear();
    const mine = { ...STOCK_TUNE, power: 1.05 };
    saveTune('bmw-e92-m3', mine);
    saveTune('amg-one', { ...STOCK_TUNE, power: 1.1 });
    profile.importGarage(accountRow.garage);
    assert.deepEqual(loadTune('koenigsegg-jesko'), decodeTune('zdiiiiiii9').tune);
    assert.deepEqual(loadTune('amg-one'), STOCK_TUNE);
    assert.deepEqual(loadTune('bmw-e92-m3'), mine);
    assert.equal(loadLook('koenigsegg-jesko').spoiler, 'none');
});
