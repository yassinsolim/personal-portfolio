// builds the real race track and terrain in node, from the same typescript and
// track data the game uses, for geometry tests
import './dom-shim.mjs';
import './ts-hooks.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
);
const THREE = await import('three');

let track = null;

export const loadTrack = async () => {
    if (track) return track;
    const data = JSON.parse(
        fs.readFileSync(
            path.join(
                root,
                'static/models/Tracks/Nordschleife/nordschleife.json'
            ),
            'utf8'
        )
    );
    globalThis.__testApplication = {
        resources: { items: { json: { nordschleifeData: data } } },
        scene: new THREE.Scene(),
        renderer: null,
        time: { elapsed: 0, delta: 16 },
    };
    const { default: NordschleifeTrack } = await import(
        '../../src/Application/Racing/Track/NordschleifeTrack.ts'
    );
    track = new NordschleifeTrack(globalThis.__testApplication.scene);
    track.root.updateMatrixWorld(true);
    return track;
};

const terrainModule = () =>
    import('../../src/Application/Racing/Visuals/RaceTerrain.ts');

// every terrain quality the game can build
export const terrainQualities = async () =>
    (await terrainModule()).TERRAIN_QUALITIES ?? ['high', 'low'];

export const buildTerrain = async (quality) => {
    const current = await loadTrack();
    const { default: RaceTerrain } = await terrainModule();
    const parent = new THREE.Group();
    const terrain = new RaceTerrain(parent, current, quality);
    parent.updateMatrixWorld(true);
    return terrain;
};

export { THREE };
