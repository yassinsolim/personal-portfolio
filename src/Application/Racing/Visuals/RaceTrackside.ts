import * as THREE from 'three';
import type NordschleifeTrack from '../Track/NordschleifeTrack';
import {
    createCheckerTexture,
    createGantryTexture,
    createRoadTextTexture,
} from './proceduralTextures';

// things along the road: armco on both sides with posts, the start gantry
// and line, and painted words on the asphalt like the ring's graffiti
const BARRIER_INSET = 0.15;
const POST_SPACING = 4;
const POST_CHUNKS = 16;
// w-beam cross section: out from the barrier line toward the road, height
// segments of the rail along the lap, for culling
const ARMCO_SEGMENTS = 30;
const ARMCO_PROFILE: [number, number][] = [
    [0, 0.44],
    [0.06, 0.48],
    [0.07, 0.54],
    [0.02, 0.6],
    [0.07, 0.66],
    [0.06, 0.72],
    [0, 0.76],
    [-0.03, 0.76],
    [-0.03, 0.44],
];
const ROAD_WORDS: { t: number; text: string; lateral: number }[] = [
    { t: 0.06, text: 'GRÜNE HÖLLE', lateral: 0 },
    { t: 0.17, text: 'YASSIN', lateral: -2.5 },
    { t: 0.29, text: 'FLAT OUT?', lateral: 2 },
    { t: 0.41, text: 'BRAKE LATER', lateral: 0 },
    { t: 0.55, text: 'NÜRBURGRING', lateral: -2 },
    { t: 0.68, text: 'KEEP LEFT', lateral: 2.5 },
    { t: 0.82, text: 'SEND IT', lateral: 0 },
    { t: 0.93, text: 'ALMOST THERE', lateral: -1.5 },
];

export default class RaceTrackside {
    root: THREE.Group;
    track: NordschleifeTrack;
    armcoMaterial: THREE.MeshStandardMaterial;
    postMaterial: THREE.MeshStandardMaterial;

    constructor(parent: THREE.Object3D, track: NordschleifeTrack) {
        this.track = track;
        this.root = new THREE.Group();
        this.root.name = 'race-trackside';
        parent.add(this.root);
        this.armcoMaterial = new THREE.MeshStandardMaterial({
            color: 0xc4c8cc,
            // weathered galvanized steel, dull enough not to flare
            metalness: 0.75,
            roughness: 0.58,
            side: THREE.DoubleSide,
        });
        this.postMaterial = new THREE.MeshStandardMaterial({
            color: 0x6d7176,
            metalness: 0.6,
            roughness: 0.5,
        });
        this.buildArmco();
        this.buildPosts();
        this.buildStart();
        this.buildRoadWords();
    }

    // in segments along the lap, so all but the few in view get culled
    buildArmco() {
        const track = this.track;
        const curve = track.visualCurve;
        const samples = 2400;
        const segments = ARMCO_SEGMENTS;
        const perSegment = samples / segments;
        const point = new THREE.Vector3();
        const tangent = new THREE.Vector3();
        const normal = new THREE.Vector3();
        const side = new THREE.Vector3(1, 0, 0);
        const previousSide = new THREE.Vector3(1, 0, 0);
        const base = new THREE.Vector3();
        const vertex = new THREE.Vector3();
        const columns = ARMCO_PROFILE.length;
        // one pass for the rail vertices of both sides, so the ribbon frame
        // stays continuous around the lap
        const rails: Record<number, number[]> = { 1: [], [-1]: [] };
        [1, -1].forEach((sign) => {
            previousSide.set(1, 0, 0);
            for (let i = 0; i <= samples; i++) {
                const t = i / samples;
                track.getRibbonFrame(
                    curve,
                    t,
                    point,
                    tangent,
                    normal,
                    side,
                    previousSide
                );
                const lateral =
                    sign * (track.getVergeHalfWidth(t) - BARRIER_INSET);
                base.copy(point).addScaledVector(side, lateral);
                ARMCO_PROFILE.forEach(([inward, height]) => {
                    vertex
                        .copy(base)
                        .addScaledVector(side, -sign * inward)
                        .addScaledVector(normal, height);
                    rails[sign].push(vertex.x, vertex.y, vertex.z);
                });
            }
        });
        for (let segment = 0; segment < segments; segment++) {
            const first = segment * perSegment;
            const rings = perSegment + 1;
            const positions: number[] = [];
            const indices: number[] = [];
            [1, -1].forEach((sign) => {
                const start = positions.length / 3;
                const source = rails[sign];
                positions.push(
                    ...source.slice(
                        first * columns * 3,
                        (first + rings) * columns * 3
                    )
                );
                for (let i = 0; i < perSegment; i++) {
                    for (let c = 0; c < columns; c++) {
                        const next = (c + 1) % columns;
                        const a = start + i * columns + c;
                        const b = start + i * columns + next;
                        const d = start + (i + 1) * columns + c;
                        const e = start + (i + 1) * columns + next;
                        if (sign > 0) indices.push(a, d, b, b, d, e);
                        else indices.push(a, b, d, b, e, d);
                    }
                }
            });
            const geometry = new THREE.BufferGeometry();
            geometry.setIndex(indices);
            geometry.setAttribute(
                'position',
                new THREE.Float32BufferAttribute(positions, 3)
            );
            geometry.computeVertexNormals();
            geometry.computeBoundingSphere();
            const mesh = new THREE.Mesh(geometry, this.armcoMaterial);
            mesh.name = `race-armco-${segment}`;
            mesh.receiveShadow = true;
            this.root.add(mesh);
        }
    }

    buildPosts() {
        const track = this.track;
        const curve = track.visualCurve;
        const length = track.length;
        const count = Math.floor(length / POST_SPACING);
        const geometry = new THREE.BoxGeometry(0.09, 0.82, 0.12);
        geometry.translate(0, 0.41, 0);
        const point = new THREE.Vector3();
        const tangent = new THREE.Vector3();
        const normal = new THREE.Vector3();
        const side = new THREE.Vector3(1, 0, 0);
        const previousSide = new THREE.Vector3(1, 0, 0);
        const matrix = new THREE.Matrix4();
        const basis = new THREE.Matrix4();
        const position = new THREE.Vector3();
        const perChunk = Math.ceil(count / POST_CHUNKS);
        for (let chunk = 0; chunk < POST_CHUNKS; chunk++) {
            const first = chunk * perChunk;
            const last = Math.min(count, first + perChunk);
            if (last <= first) break;
            const mesh = new THREE.InstancedMesh(
                geometry,
                this.postMaterial,
                (last - first) * 2
            );
            mesh.name = `race-armco-posts-${chunk}`;
            let index = 0;
            for (let i = first; i < last; i++) {
                const t = i / count;
                track.getRibbonFrame(
                    curve,
                    t,
                    point,
                    tangent,
                    normal,
                    side,
                    previousSide
                );
                for (const sign of [1, -1]) {
                    const lateral =
                        sign *
                        (track.getVergeHalfWidth(t) - BARRIER_INSET + 0.1);
                    position.copy(point).addScaledVector(side, lateral);
                    basis.makeBasis(side, normal, tangent);
                    matrix.copy(basis).setPosition(position);
                    mesh.setMatrixAt(index++, matrix);
                }
            }
            mesh.instanceMatrix.needsUpdate = true;
            mesh.computeBoundingSphere();
            mesh.castShadow = true;
            this.root.add(mesh);
        }
    }

    // a gantry over the line and a checkered strip on the road
    buildStart() {
        const track = this.track;
        const point = new THREE.Vector3();
        const tangent = new THREE.Vector3();
        const normal = new THREE.Vector3();
        const side = new THREE.Vector3(1, 0, 0);
        const previousSide = new THREE.Vector3(1, 0, 0);
        track.getRibbonFrame(
            track.visualCurve,
            0,
            point,
            tangent,
            normal,
            side,
            previousSide
        );
        const halfRoad = track.getRoadHalfWidth(0);
        const group = new THREE.Group();
        group.name = 'race-start';
        const basis = new THREE.Matrix4().makeBasis(side, normal, tangent);
        group.quaternion.setFromRotationMatrix(basis);
        group.position.copy(point);
        this.root.add(group);

        const steel = new THREE.MeshStandardMaterial({
            color: 0x2a2e33,
            metalness: 0.7,
            roughness: 0.45,
        });
        const span = halfRoad * 2 + 5;
        [1, -1].forEach((sign) => {
            const pillar = new THREE.Mesh(
                new THREE.BoxGeometry(0.7, 7.2, 0.7),
                steel
            );
            pillar.position.set(sign * (halfRoad + 2.5), 3.6, 0);
            pillar.castShadow = true;
            group.add(pillar);
        });
        const beam = new THREE.Mesh(
            new THREE.BoxGeometry(span + 0.7, 1.4, 0.9),
            steel
        );
        beam.position.set(0, 6.6, 0);
        beam.castShadow = true;
        group.add(beam);
        // board faces the cars coming up to the line
        const board = new THREE.Mesh(
            new THREE.PlaneGeometry(span * 0.9, (span * 0.9) / 8),
            new THREE.MeshStandardMaterial({
                map: createGantryTexture(),
                emissive: 0xffffff,
                emissiveMap: createGantryTexture(),
                emissiveIntensity: 1.6,
                roughness: 0.6,
            })
        );
        board.position.set(0, 6.6, -0.47);
        board.rotation.y = Math.PI;
        group.add(board);

        const line = new THREE.Mesh(
            new THREE.PlaneGeometry(halfRoad * 2, 1.6),
            new THREE.MeshStandardMaterial({
                map: createCheckerTexture(Math.round(halfRoad * 2), 2),
                roughness: 0.7,
                polygonOffset: true,
                polygonOffsetFactor: -6,
                polygonOffsetUnits: -12,
            })
        );
        line.rotation.x = -Math.PI / 2;
        line.position.set(0, 0.03, 0);
        line.receiveShadow = true;
        group.add(line);
    }

    buildRoadWords() {
        const track = this.track;
        ROAD_WORDS.forEach((word, index) => {
            const length = 14;
            const range: [number, number] = [
                word.t,
                word.t + length / track.length,
            ];
            const geometry = track.createRibbonGeometry(
                track.visualCurve,
                Math.round(8 / (range[1] - range[0])),
                () => [word.lateral + 3.2, word.lateral - 3.2],
                0.022,
                1 / length,
                range
            );
            const material = new THREE.MeshStandardMaterial({
                map: createRoadTextTexture(word.text, 50 + index),
                transparent: true,
                roughness: 0.75,
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: -5,
                polygonOffsetUnits: -10,
            });
            // the ribbon runs 0..1 across and 0..1 along, the words read along
            material.map!.rotation = Math.PI / 2;
            material.map!.center.set(0.5, 0.5);
            const mesh = new THREE.Mesh(geometry, material);
            mesh.name = `race-road-word-${index}`;
            mesh.receiveShadow = true;
            mesh.renderOrder = 2;
            this.root.add(mesh);
        });
    }
}
