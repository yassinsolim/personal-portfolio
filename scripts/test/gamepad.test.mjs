// the controller support's pure parts: picking the pad in use, the stick's
// dead zone, the d-pad and stick directions with their repeat, the button
// names per pad, and the focus moving between boxes like a tv remote
//
//   npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import './ts-hooks.mjs';

const pad = await import('../../src/Application/Gamepad/pad.ts');
const { pickInDirection } =
    await import('../../src/Application/Gamepad/spatial.ts');

const makePad = (
    index,
    {
        pressed = [],
        axes = [0, 0, 0, 0],
        mapping = 'standard',
        connected = true,
    } = {},
) => ({
    index,
    connected,
    mapping,
    axes,
    buttons: Array.from({ length: 17 }, (_, i) => ({
        pressed: pressed.includes(i),
        value: pressed.includes(i) ? 1 : 0,
    })),
});

test('the picker keeps its pad until another one is used while it sits idle', () => {
    const picker = new pad.PadPicker();
    const first = makePad(0);
    const second = makePad(1);
    assert.equal(picker.pick([first, second]), first);
    // a second pad moving while the first one is idle takes over
    const pressed = makePad(1, { pressed: [pad.BUTTON.A] });
    assert.equal(picker.pick([first, pressed]), pressed);
    // and keeps it while it's idle again
    assert.equal(picker.pick([first, second]), second);
    // both in use: the current one stays
    const busyFirst = makePad(0, { pressed: [pad.BUTTON.B] });
    const busySecond = makePad(1, { axes: [0.9, 0, 0, 0] });
    assert.equal(picker.pick([busyFirst, busySecond]), busySecond);
    // gone: the next connected one
    assert.equal(picker.pick([first, makePad(1, { connected: false })]), first);
    assert.equal(picker.pick([null, null]), null);
});

test('a pad outside the standard layout only counts its left stick as input', () => {
    const picker = new pad.PadPicker();
    const standard = makePad(0);
    // triggers resting at -1 on axes 2 and 5
    const raw = makePad(1, { mapping: '', axes: [0, 0, -1, 0, 0, -1] });
    assert.equal(picker.pick([standard, raw]), standard);
    assert.equal(picker.pick([standard, raw]), standard);
    // with nothing picked yet, the standard one is preferred
    const fresh = new pad.PadPicker();
    assert.equal(fresh.pick([raw, standard]), standard);
});

test('the stick has a round dead zone and still reaches 1', () => {
    assert.deepEqual(pad.stick(0.1, 0.1), [0, 0]);
    const [x, y] = pad.stick(1, 0);
    assert.equal(x, 1);
    assert.equal(y, 0);
    const [dx, dy] = pad.stick(0.6, 0.8);
    assert.ok(Math.abs(Math.hypot(dx, dy) - 1) < 1e-9);
    const [hx] = pad.stick(0.6, 0);
    assert.ok(hx > 0 && hx < 0.6);
    assert.deepEqual(pad.stick(Number.NaN, 0), [0, 0]);
});

test('the d-pad wins over the stick, which has to be pushed most of the way', () => {
    assert.equal(
        pad.padDirection(
            makePad(0, { pressed: [pad.BUTTON.LEFT], axes: [0.9, 0] }),
        ),
        'left',
    );
    assert.equal(pad.padDirection(makePad(0, { axes: [0.3, 0.2] })), null);
    assert.equal(pad.padDirection(makePad(0, { axes: [0.7, 0.2] })), 'right');
    assert.equal(pad.padDirection(makePad(0, { axes: [0.2, -0.8] })), 'up');
    assert.equal(pad.padDirection(makePad(0, { axes: [-0.5, 0.9] })), 'down');
});

test('a held direction moves once, waits, then repeats', () => {
    const repeat = new pad.Repeat(300, 100);
    assert.equal(repeat.step('down', 0), 'down');
    assert.equal(repeat.step('down', 200), null);
    assert.equal(repeat.step('down', 300), 'down');
    assert.equal(repeat.step('down', 350), null);
    assert.equal(repeat.step('down', 400), 'down');
    assert.equal(repeat.step(null, 410), null);
    assert.equal(repeat.step('down', 420), 'down');
    assert.equal(repeat.step('up', 430), 'up');
});

test('buttons are named for the pad in hand', () => {
    assert.equal(
        pad.padKind('054c-0ce6-DualSense Wireless Controller'),
        'playstation',
    );
    assert.equal(
        pad.padKind(
            'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)',
        ),
        'playstation',
    );
    assert.equal(
        pad.padKind('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)'),
        'xbox',
    );
    assert.equal(
        pad.padKind(
            'Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)',
        ),
        'nintendo',
    );
    assert.equal(pad.buttonLabel('playstation', 'A'), '✕');
    assert.equal(pad.buttonLabel('nintendo', 'A'), 'B');
    assert.equal(pad.buttonLabel('xbox', 'MENU'), 'Menu');
});

const box = (left, top, width, height) => ({
    left,
    top,
    right: left + width,
    bottom: top + height,
});

test('focus moves to the next box that way, lined up ones first', () => {
    // a 3 x 2 grid of 100 x 50 buttons with 20 px gaps
    const grid = [];
    for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 3; col++)
            grid.push(box(col * 120, row * 70, 100, 50));
    }
    assert.equal(pickInDirection(grid[0], grid, 'right'), 1);
    assert.equal(pickInDirection(grid[1], grid, 'down'), 4);
    assert.equal(pickInDirection(grid[4], grid, 'up'), 1);
    assert.equal(pickInDirection(grid[5], grid, 'left'), 4);
    assert.equal(pickInDirection(grid[0], grid, 'left'), -1);
    assert.equal(pickInDirection(grid[0], grid, 'up'), -1);
});

test('a lined up box beats a nearer one off to the side', () => {
    const source = box(0, 0, 100, 40);
    // 50 down, against one 20 down but off to the side (its far edge 60)
    const ahead = box(0, 90, 100, 40);
    const aside = box(150, 60, 100, 40);
    assert.equal(pickInDirection(source, [source, aside, ahead], 'down'), 2);
    // sideways a lined up box always wins
    assert.equal(
        pickInDirection(
            source,
            [box(150, 60, 50, 40), box(700, 0, 50, 40)],
            'right',
        ),
        1,
    );
    // and when nothing lines up, the nearest
    const right = box(400, 300, 50, 50);
    const farRight = box(900, 200, 50, 50);
    assert.equal(pickInDirection(source, [farRight, right], 'right'), 1);
});

test('a wide panel button reaches the narrow ones under it', () => {
    const wide = box(0, 0, 300, 40);
    const left = box(0, 60, 90, 40);
    const middle = box(105, 60, 90, 40);
    const right = box(210, 60, 90, 40);
    assert.equal(pickInDirection(wide, [left, middle, right], 'down'), 1);
    assert.equal(pickInDirection(right, [wide, left, middle], 'up'), 0);
});
