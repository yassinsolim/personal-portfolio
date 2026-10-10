// the board only shows laps whose ghost passes the ring's checkpoints in
// order (supabase/racing.sql). they're written from the track data by
// scripts/track/checkpoints.mjs, so a ring change without rerunning it would
// fail every lap
//
//   npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { CHECKPOINTS, checkpointBlock, ringCheckpoints, writtenBlock } = await import('../track/checkpoints.mjs');

test("racing.sql has the ring's checkpoints", () => {
    assert.equal(writtenBlock(), checkpointBlock(ringCheckpoints()));
});

test('they are about 100 m apart, the last one on the start line', () => {
    const values = ringCheckpoints();
    assert.equal(values.length, CHECKPOINTS * 2);
    const ring = JSON.parse(fs.readFileSync('static/models/Tracks/Nordschleife/nordschleife.json', 'utf8'));
    const [x0, , z0] = ring.points[0];
    assert.deepEqual(values.slice(-2), [Math.round(x0), Math.round(z0)]);
    for (let k = 0; k < CHECKPOINTS; k++) {
        const [px, pz] = k ? values.slice(2 * k - 2, 2 * k) : values.slice(-2);
        const gap = Math.hypot(values[2 * k] - px, values[2 * k + 1] - pz);
        // the server's 50 m radius can't take two at once
        assert.ok(gap > 60 && gap < 110, `checkpoint ${k + 1} is ${gap.toFixed(0)} m on`);
    }
});
