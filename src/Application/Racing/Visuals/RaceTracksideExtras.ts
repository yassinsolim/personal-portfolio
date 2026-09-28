import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type NordschleifeTrack from '../Track/NordschleifeTrack';
import { splitByCell } from '../Track/NordschleifeTrack';
import type RaceTerrain from './RaceTerrain';

// the second layer of trackside detail, all from open data or made here:
// catch fences where osm maps them next to the lap (brünnchen, pflanzgarten,
// wippermann, döttinger höhe...), the nürburg ruin and the kaiser wilhelm
// tower on the hohe acht on the skyline, and fan graffiti painted on the
// tarmac at the spots known for it. merged and cell split, so it's a few
// draws; weak gpus only get the graffiti (their 1 km view hides the rest)
const FENCE_HEIGHT = 3.2;
// osm puts a few runs on the grass between the tarmac and the armco (the wide
// end of döttinger höhe, hohe acht). catch fences stand behind the barrier
const FENCE_BEHIND_BARRIER = 1;
const FENCE_CELL = 800;
// chain link is invisible past this, so far cells aren't drawn at all
const FENCE_VIEW = 900;
// graffiti clusters, lap meters, and how many pieces each gets
const GRAFFITI_SPOTS: [number, number, number][] = [
    [10150, 10800, 4], // kesselchen
    [11250, 11550, 3], // klostertal, steilstrecke
    [12230, 12600, 4], // hohe acht
    [13500, 13900, 3], // wippermann, eschbach
    [14240, 14720, 5], // brünnchen
    [14920, 15300, 4], // pflanzgarten
    [18500, 19400, 7], // döttinger höhe
    [1600, 2300, 2], // quiddelbacher höhe
    [5200, 5600, 2], // adenauer forst
];
// made up fan tags, no real names
const TAGS = [
    'GRÜNE HÖLLE',
    'VOLLGAS',
    'HOPP HOPP',
    'KALLE',
    'EIFEL',
    'NORDSCHLEIFE',
    '24H',
    'TEAM ADENAU',
    'HEIDI + KLAUS',
    'GO GO GO',
    'RING',
    'BRÜNNCHEN',
    'SENNA',
    'LAST LAP',
    'OMA FÄHRT MIT',
    'SEND IT',
    'NO FEAR',
    'GRUPPE C',
    'PFLANZGARTEN',
    'HOHE ACHT',
];
const COLORS = [
    '#f4f1e6',
    '#ffd23f',
    '#e3342f',
    '#2f6fe3',
    '#ff8a1f',
    '#34c46a',
    '#f4f1e6',
    '#ffffff',
];

const rng = (seed: number) => {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

// chain link: two sets of diagonal wires on transparent
const chainLinkTexture = () => {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    if (!ctx) return texture;
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(168,174,178,1)';
    ctx.lineWidth = 3;
    for (let k = -size; k <= size * 2; k += size / 2) {
        ctx.beginPath();
        ctx.moveTo(k, 0);
        ctx.lineTo(k + size, size);
        ctx.moveTo(k + size, 0);
        ctx.lineTo(k, size);
        ctx.stroke();
    }
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
};

// 32 graffiti pieces in one atlas: tags in chunky letters, flags, arrows and
// hearts, each faded and worn like years of paint on tarmac
const ATLAS_COLS = 4;
const ATLAS_ROWS = 8;
const graffitiAtlas = () => {
    const cellW = 512;
    const cellH = 256;
    const canvas = document.createElement('canvas');
    canvas.width = cellW * ATLAS_COLS;
    canvas.height = cellH * ATLAS_ROWS;
    const ctx = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    if (!ctx) return texture;
    const random = rng(4711);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let cell = 0; cell < ATLAS_COLS * ATLAS_ROWS; cell++) {
        const x0 = (cell % ATLAS_COLS) * cellW;
        const y0 = Math.floor(cell / ATLAS_COLS) * cellH;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, y0, cellW, cellH);
        ctx.clip();
        ctx.translate(x0 + cellW / 2, y0 + cellH / 2);
        ctx.rotate((random() - 0.5) * 0.25);
        const color = COLORS[Math.floor(random() * COLORS.length)];
        const kind = cell % 8;
        if (kind === 5) {
            // black red gold stripes
            ['#1b1b1b', '#d7261e', '#f2c21b'].forEach((c, i) => {
                ctx.fillStyle = c;
                ctx.fillRect(-200, -90 + i * 60, 400, 56);
            });
        } else if (kind === 6) {
            // chequered flag
            for (let i = 0; i < 8; i++) {
                for (let j = 0; j < 4; j++) {
                    ctx.fillStyle = (i + j) % 2 ? '#f4f1e6' : '#1b1b1b';
                    ctx.fillRect(-200 + i * 50, -100 + j * 50, 50, 50);
                }
            }
        } else if (kind === 7) {
            // an arrow or a heart
            ctx.fillStyle = color;
            ctx.beginPath();
            if (random() < 0.5) {
                ctx.moveTo(-190, -30);
                ctx.lineTo(90, -30);
                ctx.lineTo(90, -90);
                ctx.lineTo(200, 0);
                ctx.lineTo(90, 90);
                ctx.lineTo(90, 30);
                ctx.lineTo(-190, 30);
            } else {
                ctx.moveTo(0, 95);
                ctx.bezierCurveTo(-210, -20, -110, -140, 0, -50);
                ctx.bezierCurveTo(110, -140, 210, -20, 0, 95);
            }
            ctx.fill();
        } else {
            const text = TAGS[Math.floor(random() * TAGS.length)];
            let size = 170;
            const font =
                random() < 0.5
                    ? 'Impact, "Arial Black", sans-serif'
                    : '"Arial Black", Impact, sans-serif';
            ctx.font = `900 ${size}px ${font}`;
            while (ctx.measureText(text).width > cellW * 0.9 && size > 40) {
                size -= 8;
                ctx.font = `900 ${size}px ${font}`;
            }
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            if (random() < 0.5) {
                // outlined letters
                ctx.lineWidth = 10;
                ctx.strokeStyle =
                    random() < 0.5
                        ? '#1b1b1b'
                        : COLORS[Math.floor(random() * COLORS.length)];
                ctx.strokeText(text, 0, 8);
            }
            ctx.fillStyle = color;
            ctx.fillText(text, 0, 8);
        }
        ctx.restore();
        // wear: tire rubber and years of rain knock the paint out
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        for (let i = 0; i < 900; i++) {
            ctx.fillStyle = `rgba(0,0,0,${0.25 + random() * 0.7})`;
            ctx.beginPath();
            ctx.arc(
                x0 + random() * cellW,
                y0 + random() * cellH,
                random() * 3 + 0.5,
                0,
                Math.PI * 2,
            );
            ctx.fill();
        }
        // the racing line wears a band through it
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(
            x0 + cellW * (0.3 + random() * 0.3),
            y0,
            cellW * 0.12,
            cellH,
        );
        ctx.restore();
    }
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
};

export default class RaceTracksideExtras {
    root: THREE.Group;
    // where each graffiti piece sits, for tests
    graffitiAt: THREE.Vector3[] = [];
    fenceCells: THREE.Mesh[] = [];

    constructor(
        parent: THREE.Object3D,
        track: NordschleifeTrack,
        terrain: RaceTerrain,
        lite: boolean,
    ) {
        this.root = new THREE.Group();
        this.root.name = 'race-trackside-extras';
        if (!lite) {
            this.buildFences(track, terrain);
            this.buildLandmarks(track, terrain);
        }
        this.buildGraffiti(track);
        parent.add(this.root);
    }

    update(camera: THREE.Vector3) {
        for (const cell of this.fenceCells) {
            const sphere = cell.geometry.boundingSphere!;
            cell.visible =
                sphere.center.distanceTo(camera) - sphere.radius < FENCE_VIEW;
        }
    }

    buildFences(track: NordschleifeTrack, terrain: RaceTerrain) {
        if (!track.fences.length) return;
        const panels: number[] = [];
        const uvs: number[] = [];
        const index: number[] = [];
        const posts: THREE.BufferGeometry[] = [];
        const post = new THREE.BoxGeometry(0.07, FENCE_HEIGHT, 0.07);
        const frame = track.createFrame();
        const hint = track.frameHint;
        const behindBarrier = (run: [number, number][]) => {
            let last = -1;
            return run.map(([x, z]): [number, number] => {
                track.queryFrame(x, z, frame, last);
                last = frame.index;
                const min = frame.barrierOffset + FENCE_BEHIND_BARRIER;
                if (Math.abs(frame.lateral) >= min) return [x, z];
                const push = (Math.sign(frame.lateral) || 1) * min - frame.lateral;
                return [x + frame.leftX * push, z + frame.leftZ * push];
            });
        };
        const runs = track.fences.map(behindBarrier);
        track.frameHint = hint;
        runs.forEach((run) => {
            let along = 0;
            const first = panels.length / 3;
            run.forEach(([x, z], i) => {
                const y = terrain.heightAt(x, z) - 0.15;
                if (i > 0)
                    along += Math.hypot(x - run[i - 1][0], z - run[i - 1][1]);
                panels.push(x, y, z, x, y + FENCE_HEIGHT, z);
                // the texture tile is a 1.2 m square of mesh
                uvs.push(along / 1.2, 0, along / 1.2, FENCE_HEIGHT / 1.2);
                if (i > 0) {
                    const a = first + (i - 1) * 2;
                    index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
                }
                posts.push(post.clone().translate(x, y + FENCE_HEIGHT / 2, z));
            });
        });
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
            'position',
            new THREE.Float32BufferAttribute(panels, 3),
        );
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(index);
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(
            geometry,
            new THREE.MeshLambertMaterial({
                map: chainLinkTexture(),
                alphaTest: 0.5,
                side: THREE.DoubleSide,
            }),
        );
        mesh.name = 'race-fence';
        const poleMesh = new THREE.Mesh(
            mergeGeometries(posts),
            new THREE.MeshStandardMaterial({
                color: 0x8b9094,
                roughness: 0.6,
                metalness: 0.6,
            }),
        );
        poleMesh.name = 'race-fence-posts';
        [mesh, poleMesh].forEach((m) => {
            const cells = splitByCell(m, FENCE_CELL);
            cells.children.forEach((c) =>
                this.fenceCells.push(c as THREE.Mesh),
            );
            this.root.add(cells);
        });
    }

    buildLandmarks(track: NordschleifeTrack, terrain: RaceTerrain) {
        if (!track.landmarks.length) return;
        const parts: THREE.BufferGeometry[] = [];
        track.landmarks.forEach((mark) => {
            const ground = terrain.heightAt(mark.x, mark.z);
            if (mark.kind === 'castle') {
                // the curtain wall along the osm outline, and the round keep
                const outline = mark.outline;
                const wall: number[] = [];
                const idx: number[] = [];
                outline.forEach(([dx, dz], i) => {
                    const x = mark.x + dx;
                    const z = mark.z + dz;
                    const y = terrain.heightAt(x, z) - 1.5;
                    wall.push(x, y, z, x, y + 8.5, z);
                    if (i > 0) {
                        const a = (i - 1) * 2;
                        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
                    }
                });
                const walls = new THREE.BufferGeometry();
                walls.setAttribute(
                    'position',
                    new THREE.Float32BufferAttribute(wall, 3),
                );
                walls.setIndex(idx);
                parts.push(walls.toNonIndexed());
                const keep = new THREE.CylinderGeometry(
                    5.5,
                    6.2,
                    26,
                    14,
                ).translate(mark.x, ground + 12, mark.z);
                parts.push(keep.toNonIndexed());
                for (let k = 0; k < 12; k++) {
                    const a = (k / 12) * Math.PI * 2;
                    parts.push(
                        new THREE.BoxGeometry(1.4, 1.6, 1.4)
                            .translate(
                                mark.x + Math.cos(a) * 5.2,
                                ground + 25.8,
                                mark.z + Math.sin(a) * 5.2,
                            )
                            .toNonIndexed(),
                    );
                }
            } else {
                const xs = mark.outline.map((p) => p[0]);
                const zs = mark.outline.map((p) => p[1]);
                const w = Math.max(5, Math.max(...xs) - Math.min(...xs));
                const d = Math.max(5, Math.max(...zs) - Math.min(...zs));
                const height = mark.height || 16;
                parts.push(
                    new THREE.BoxGeometry(w, height, d)
                        .translate(mark.x, ground + height / 2 - 0.5, mark.z)
                        .toNonIndexed(),
                );
                // battlements at the corners and mid sides
                [
                    [1, 1],
                    [1, -1],
                    [-1, 1],
                    [-1, -1],
                    [0, 1],
                    [0, -1],
                    [1, 0],
                    [-1, 0],
                ].forEach(([sx, sz]) => {
                    parts.push(
                        new THREE.BoxGeometry(1.1, 1.3, 1.1)
                            .translate(
                                mark.x + (sx * w) / 2,
                                ground + height + 0.1,
                                mark.z + (sz * d) / 2,
                            )
                            .toNonIndexed(),
                    );
                });
            }
        });
        const geometry = mergeGeometries(
            parts.map((part) => {
                part.deleteAttribute('uv');
                part.deleteAttribute('normal');
                return part;
            }),
        );
        geometry.computeVertexNormals();
        // weathered basalt and greywacke
        const mesh = new THREE.Mesh(
            geometry,
            new THREE.MeshStandardMaterial({
                color: 0x8a8376,
                roughness: 0.95,
                metalness: 0,
                flatShading: true,
                side: THREE.DoubleSide,
            }),
        );
        mesh.name = 'race-landmarks';
        this.root.add(mesh);
    }

    buildGraffiti(track: NordschleifeTrack) {
        const random = rng(1927);
        const parts: THREE.BufferGeometry[] = [];
        let cell = 0;
        GRAFFITI_SPOTS.forEach(([from, to, count]) => {
            for (let k = 0; k < count; k++) {
                const start =
                    from + ((to - from) * (k + random() * 0.6)) / count;
                const length = 7 + random() * 7;
                const lateral = (random() - 0.5) * 4;
                const half = 1.4 + random() * 1.4;
                const t0 = (start * track.distanceScale) / track.length;
                const range: [number, number] = [
                    t0,
                    t0 + (length * track.distanceScale) / track.length,
                ];
                // the sample count is for the whole lap, so ~8 land in the piece
                const geometry = track.createRibbonGeometry(
                    track.visualCurve,
                    Math.round(8 / (range[1] - range[0])),
                    () => [lateral + half, lateral - half],
                    0.024,
                    1 / length,
                    range,
                );
                // this piece's cell of the atlas, reading along the road
                const c = cell++ % (ATLAS_COLS * ATLAS_ROWS);
                const cu = (c % ATLAS_COLS) / ATLAS_COLS;
                const cv = 1 - (Math.floor(c / ATLAS_COLS) + 1) / ATLAS_ROWS;
                const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
                for (let i = 0; i < uv.count; i++) {
                    const across = uv.getX(i);
                    const along = (uv.getY(i) - uv.getY(0)) * length;
                    const u = Math.min(1, Math.max(0, along / length));
                    uv.setXY(i, cu + u / ATLAS_COLS, cv + across / ATLAS_ROWS);
                }
                parts.push(geometry);
                this.graffitiAt.push(
                    track.visualCurve.getPointAt((range[0] + range[1]) / 2),
                );
            }
        });
        if (!parts.length) return;
        const mesh = new THREE.Mesh(
            mergeGeometries(parts),
            new THREE.MeshStandardMaterial({
                map: graffitiAtlas(),
                transparent: true,
                roughness: 0.75,
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: -5,
                polygonOffsetUnits: -10,
            }),
        );
        mesh.name = 'race-graffiti';
        mesh.receiveShadow = true;
        mesh.renderOrder = 2;
        this.root.add(mesh);
    }
}
