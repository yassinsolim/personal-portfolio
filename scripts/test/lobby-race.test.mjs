// lobby races: the count down to one green light, laps to the finish, and
// places from how far each car has got, the finished ones by time
//
//   npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import './ts-hooks.mjs';

const { default: LobbyRace, raceDistance } = await import(
    '../../src/Application/Racing/Multiplayer/LobbyRace.ts'
);

test('distance counts laps, and the grid behind the line is just under 0', () => {
    assert.ok(Math.abs(raceDistance(0, 0.998, false) + 0.002) < 1e-9);
    assert.equal(raceDistance(0, 0.004, false), 0.004);
    assert.equal(raceDistance(0, 0.3, true), 0.3);
    assert.equal(raceDistance(2, 0.75, true), 2.75);
});

test('a race counts down, goes green once and finishes on the last lap', () => {
    const race = new LobbyRace();
    race.start('abc', 2, 10000, ['a', 'b', 'c']);
    assert.equal(race.phase, 'countdown');
    assert.equal(race.entered('b'), true);
    assert.equal(race.entered('late'), false);
    assert.equal(race.countdown(7000), 3);
    assert.equal(race.tick(9999), false);
    assert.equal(race.tick(10000), true);
    assert.equal(race.tick(10016), false);
    assert.equal(race.phase, 'racing');
    assert.equal(race.completeLap(400000, 'a'), null);
    assert.equal(race.completeLap(790000, 'a'), 780000);
    assert.equal(race.phase, 'finished');
    // a lap after the finish changes nothing
    assert.equal(race.completeLap(900000, 'a'), null);
});

test('places: finished by time, then by distance, then those who left', () => {
    const race = new LobbyRace();
    race.start('abc', 1, 0, ['a', 'b', 'c', 'd', 'e']);
    race.tick(0);
    race.finish('c', 500000);
    race.finish('b', 480000);
    // a car not on the grid can't finish
    race.finish('x', 1);
    const standings = race.standings([
        { sessionId: 'a', name: 'A', distance: 0.9, present: true },
        { sessionId: 'b', name: 'B', distance: 1.01, present: true },
        { sessionId: 'c', name: 'C', distance: 1.02, present: true },
        { sessionId: 'd', name: 'D', distance: 0.95, present: true },
        { sessionId: 'e', name: 'E', distance: 0.99, present: false },
        { sessionId: 'x', name: 'X', distance: 3, present: true },
    ]);
    assert.deepEqual(
        standings.map((s) => [s.place, s.sessionId, s.finishMs]),
        [
            [1, 'b', 480000],
            [2, 'c', 500000],
            [3, 'd', null],
            [4, 'a', null],
            [5, 'e', null],
        ]
    );
});
