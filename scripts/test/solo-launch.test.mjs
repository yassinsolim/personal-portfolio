import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { opensLobbyChoice } = await import(
    '../../src/Application/World/soloLaunch.ts'
);

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

test('a solo launch skips the lobby card', () => {
    assert.equal(
        opensLobbyChoice({
            active: true,
            toGarage: false,
            hasInvite: false,
            ask: false,
        }),
        false
    );
});

test('an open-ended launch still asks how to drive', () => {
    assert.equal(
        opensLobbyChoice({
            active: true,
            toGarage: false,
            hasInvite: false,
            ask: true,
        }),
        true
    );
});

test('the garage path and an invite link do not ask', () => {
    assert.equal(
        opensLobbyChoice({
            active: true,
            toGarage: true,
            hasInvite: false,
            ask: true,
        }),
        false
    );
    assert.equal(
        opensLobbyChoice({
            active: true,
            toGarage: false,
            hasInvite: true,
            ask: true,
        }),
        false
    );
    assert.equal(
        opensLobbyChoice({
            active: false,
            toGarage: false,
            hasInvite: false,
            ask: true,
        }),
        false
    );
});

test('the root license keeps both copyright notices', () => {
    const license = readFileSync(join(root, 'LICENSE'), 'utf8');
    assert.match(license, /Copyright 2024 Henry Heffernan/);
    assert.match(license, /Copyright 2025-2026 Yassin Soliman/);
    assert.match(license, /Permission is hereby granted/);
    assert.match(readFileSync(join(root, 'CREDITS.md'), 'utf8'), /Henry Heffernan/);
    const readme = readFileSync(join(root, 'readme.md'), 'utf8');
    assert.match(readme, /Henry Heffernan/);
    assert.match(readme, /daedalOS/);
    assert.match(readme, /environment map/);
    assert.match(readme, /Play Solo/);
});
