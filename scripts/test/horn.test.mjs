// the horn: each car has its own note, pressing fades it in to its level and
// letting go fades it out, and holding it doesn't keep rescheduling it
//
//   npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import './ts-hooks.mjs';

const { default: Horn, hornPitch } = await import('../../src/Application/Racing/Audio/Horn.ts');

const param = (value = 0) => ({
    value,
    targets: [],
    setTargetAtTime(target) {
        this.targets.push(target);
    },
    setValueAtTime(next) {
        this.value = next;
    },
    cancelScheduledValues() {},
});
const node = (extra = {}) => ({ connect() {}, disconnect() {}, ...extra });
const fakeContext = () => ({
    currentTime: 0,
    createGain: () => node({ gain: param(1) }),
    createBiquadFilter: () => node({ type: '', frequency: param(), Q: param(), gain: param() }),
    createOscillator: () => node({ type: '', frequency: param(), start() {}, stop() {} }),
});

test('every car gets a steady note in range', () => {
    const ids = ['m4', 'e92', 'crown', 'jesko', 'valkyrie', 'amgone', 'aventador', 'm5'];
    ids.forEach((id) => {
        const pitch = hornPitch(id);
        assert.equal(pitch, hornPitch(id));
        assert.ok(pitch >= 0.86 && pitch <= 1.16, `${id} ${pitch}`);
    });
    assert.ok(new Set(ids.map(hornPitch)).size > 4);
});

test('the horn fades in on a press and out on a release', () => {
    const horn = new Horn(fakeContext(), node(), 1.1, 0.12);
    assert.equal(horn.output.gain.value, 0);
    assert.deepEqual(
        horn.oscillators.map((osc) => Math.round(osc.frequency.value)),
        [462, 561]
    );
    horn.set(true);
    horn.set(true);
    assert.deepEqual(horn.output.gain.targets, [0.12]);
    horn.set(false);
    assert.deepEqual(horn.output.gain.targets, [0.12, 0]);
});
