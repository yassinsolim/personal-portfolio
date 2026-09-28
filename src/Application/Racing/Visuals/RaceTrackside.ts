import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type NordschleifeTrack from '../Track/NordschleifeTrack';
import {
    createCheckerTexture,
    createGantryTexture,
} from './proceduralTextures';

// things along the road: armco on both sides with posts, the start gantry
// and line (the graffiti on the asphalt is in RaceTracksideExtras)
const BARRIER_INSET = 0.15;
const POST_HALF_WIDTH = 0.06;
const POST_HALF_DEPTH = 0.045;
const POST_HEIGHT = 0.82;
const RAIL_COLOR = new THREE.Color(0xc4c8cc);
const POST_COLOR = new THREE.Color(0x6d7176);
// w-beam cross section: out from the barrier line toward the road, height
// segments of the rail along the lap, for culling
const ARMCO_SEGMENTS = 60;
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

export default class RaceTrackside {
    root: THREE.Group;
    track: NordschleifeTrack;
    armcoMaterial: THREE.MeshStandardMaterial;
    postMaterial: THREE.MeshStandardMaterial;

    // a ring (and post) every this many meters along the armco
    ringSpacing: number;

    constructor(
        parent: THREE.Object3D,
        track: NordschleifeTrack,
        lite = false
    ) {
        this.track = track;
        this.ringSpacing = lite ? 8 : 4;
        this.root = new THREE.Group();
        this.root.name = 'race-trackside';
        parent.add(this.root);
        this.armcoMaterial = new THREE.MeshStandardMaterial({
            // rail and post shades come from the vertex colors
            color: 0xffffff,
            vertexColors: true,
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
        this.buildStart();
        this.buildBridges();
        this.buildTrackBridges();
        this.buildBoards();
    }

    // frame at a distance along the lap in the track data's meters
    frameAt(
        distance: number,
        point: THREE.Vector3,
        tangent: THREE.Vector3,
        normal: THREE.Vector3,
        side: THREE.Vector3
    ) {
        const track = this.track;
        const t =
            ((((distance * track.distanceScale) / track.length) % 1) + 1) % 1;
        track.getRibbonFrame(
            track.visualCurve,
            t,
            point,
            tangent,
            normal,
            side,
            new THREE.Vector3(1, 0, 0)
        );
        return t;
    }

    // the overpasses openstreetmap has over the lap: a concrete deck on two
    // abutments, running the way the crossing road does
    buildBridges() {
        const track = this.track;
        if (!track.bridges.length) return;
        const material = new THREE.MeshStandardMaterial({
            color: 0x8e8b84,
            roughness: 0.9,
            metalness: 0,
        });
        const parts: THREE.BufferGeometry[] = [];
        const point = new THREE.Vector3();
        const tangent = new THREE.Vector3();
        const normal = new THREE.Vector3();
        const side = new THREE.Vector3();
        const matrix = new THREE.Matrix4();
        const quaternion = new THREE.Quaternion();
        const up = new THREE.Vector3(0, 1, 0);
        track.bridges.forEach((bridge) => {
            const t = this.frameAt(
                bridge.distance,
                point,
                tangent,
                normal,
                side
            );
            const road =
                bridge.kind === 'track' ||
                bridge.kind === 'path' ||
                bridge.kind === 'footway';
            const deckWidth = road ? 4.5 : 11;
            // across the lap: the verges plus a few meters each side
            const span = (track.getVergeHalfWidth(t) + 4) * 2;
            quaternion.setFromAxisAngle(up, bridge.angle);
            const deck = new THREE.BoxGeometry(deckWidth, 1.1, span);
            matrix.compose(
                point.clone().add(new THREE.Vector3(0, 6.2, 0)),
                quaternion,
                new THREE.Vector3(1, 1, 1)
            );
            parts.push(deck.applyMatrix4(matrix));
            [1, -1].forEach((end) => {
                const wall = new THREE.BoxGeometry(deckWidth + 1, 7, 1.4);
                const offset = new THREE.Vector3(
                    0,
                    0,
                    end * (span / 2 - 0.7)
                ).applyQuaternion(quaternion);
                matrix.compose(
                    point
                        .clone()
                        .add(offset)
                        .add(new THREE.Vector3(0, 2.6, 0)),
                    quaternion,
                    new THREE.Vector3(1, 1, 1)
                );
                parts.push(wall.applyMatrix4(matrix));
            });
        });
        const mesh = new THREE.Mesh(mergeGeometries(parts), material);
        mesh.name = 'race-bridges';
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.root.add(mesh);
    }

    // where the lap is a bridge itself (quiddelbacher hoehe over the b257,
    // breidscheid, before doettinger hoehe, t13): a concrete parapet behind
    // the armco on both sides, with the deck's fascia running down below the
    // road. the armco still does the stopping
    buildTrackBridges() {
        const track = this.track;
        if (!track.spans.length) return;
        const point = new THREE.Vector3();
        const tangent = new THREE.Vector3();
        const normal = new THREE.Vector3();
        const side = new THREE.Vector3();
        const positions: number[] = [];
        const indices: number[] = [];
        const THICK = 0.35;
        const TOP = 1.0;
        const FASCIA = 1.9;
        track.spans.forEach((span) => {
            const from = span.start - 4;
            const to = span.end + 4;
            const steps = Math.max(2, Math.ceil((to - from) / 1.5));
            [1, -1].forEach((sign) => {
                const first = positions.length / 3;
                for (let i = 0; i <= steps; i++) {
                    const t = this.frameAt(
                        from + ((to - from) * i) / steps,
                        point,
                        tangent,
                        normal,
                        side
                    );
                    const inner = track.getVergeHalfWidth(t) + 0.15;
                    // inner bottom, inner top, outer top, outer bottom
                    [
                        [inner, -FASCIA],
                        [inner, TOP],
                        [inner + THICK, TOP],
                        [inner + THICK, -FASCIA],
                    ].forEach(([lateral, height]) => {
                        positions.push(
                            point.x + side.x * sign * lateral,
                            point.y + height,
                            point.z + side.z * sign * lateral
                        );
                    });
                }
                for (let i = 0; i < steps; i++) {
                    for (let f = 0; f < 3; f++) {
                        const a = first + i * 4 + f;
                        const b = a + 1;
                        const c = a + 4;
                        const d = b + 4;
                        if (sign > 0) indices.push(a, c, b, b, c, d);
                        else indices.push(a, b, c, b, d, c);
                    }
                }
                // end caps
                [0, steps].forEach((ring) => {
                    const r = first + ring * 4;
                    if ((ring === 0) === sign > 0)
                        indices.push(r, r + 1, r + 2, r, r + 2, r + 3);
                    else indices.push(r, r + 2, r + 1, r, r + 3, r + 2);
                });
            });
        });
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
            'position',
            new THREE.Float32BufferAttribute(positions, 3)
        );
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
        const mesh = new THREE.Mesh(
            geometry,
            new THREE.MeshStandardMaterial({
                color: 0xa19d95,
                roughness: 0.92,
                metalness: 0,
                side: THREE.DoubleSide,
            })
        );
        mesh.name = 'race-track-bridges';
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.root.add(mesh);
    }

    // a board for every named corner on the right, and the kilometers on the
    // left, all from one text atlas and merged into one mesh
    buildBoards() {
        const track = this.track;
        const labels: {
            text: string;
            distance: number;
            side: number;
            km: boolean;
        }[] = [];
        track.sections.forEach((section) =>
            labels.push({
                text: section.name,
                distance: section.distance,
                side: -1,
                km: false,
            })
        );
        const dataLength = track.length / track.distanceScale;
        for (let km = 1; km * 1000 < dataLength; km++) {
            labels.push({
                text: `${km}`,
                distance: km * 1000,
                side: 1,
                km: true,
            });
        }
        const rowHeight = 64;
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = THREE.MathUtils.ceilPowerOfTwo(
            labels.length * rowHeight
        );
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        labels.forEach((label, i) => {
            const y = i * rowHeight;
            ctx.fillStyle = label.km ? '#f2f2ee' : '#1f3b2a';
            ctx.fillRect(0, y + 2, 1024, rowHeight - 4);
            ctx.strokeStyle = label.km ? '#222' : '#e8e8e2';
            ctx.lineWidth = 4;
            ctx.strokeRect(6, y + 8, 1012, rowHeight - 16);
            ctx.fillStyle = label.km ? '#111' : '#f4f4ee';
            ctx.font = `bold ${
                label.km ? 40 : 38
            }px Helvetica, Arial, sans-serif`;
            ctx.fillText(
                label.km ? `${label.text} km` : label.text,
                512,
                y + rowHeight / 2 + 1
            );
        });
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 8;
        const boardMaterial = new THREE.MeshStandardMaterial({
            map: texture,
            roughness: 0.7,
            metalness: 0,
        });
        const point = new THREE.Vector3();
        const tangent = new THREE.Vector3();
        const normal = new THREE.Vector3();
        const side = new THREE.Vector3();
        const boards: THREE.BufferGeometry[] = [];
        const posts: THREE.BufferGeometry[] = [];
        const basis = new THREE.Matrix4();
        const back = new THREE.Vector3();
        labels.forEach((label, i) => {
            const t = this.frameAt(
                label.distance,
                point,
                tangent,
                normal,
                side
            );
            const width = label.km ? 1.4 : 3.6;
            const height = label.km ? 0.7 : 0.8;
            const geometry = new THREE.PlaneGeometry(width, height);
            const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
            const v0 = 1 - ((i + 1) * rowHeight) / canvas.height;
            const v1 = 1 - (i * rowHeight) / canvas.height;
            const u0 = label.km ? 0.3 : 0;
            const u1 = label.km ? 0.7 : 1;
            for (let k = 0; k < uv.count; k++) {
                uv.setXY(
                    k,
                    u0 + (u1 - u0) * uv.getX(k),
                    v0 + (v1 - v0) * uv.getY(k)
                );
            }
            // faces the cars coming toward it, just past the armco
            back.copy(tangent).setY(0).normalize().multiplyScalar(-1);
            const right = new THREE.Vector3()
                .crossVectors(new THREE.Vector3(0, 1, 0), back)
                .normalize();
            basis.makeBasis(right, new THREE.Vector3(0, 1, 0), back);
            const lateral = label.side * (track.getVergeHalfWidth(t) + 0.9);
            const base = point.clone().addScaledVector(side, lateral);
            basis.setPosition(base.x, base.y + 1.5, base.z);
            boards.push(geometry.applyMatrix4(basis));
            [-1, 1].forEach((end) => {
                const post = new THREE.BoxGeometry(0.08, 1.5, 0.08);
                post.translate(
                    end * (width / 2 - 0.2),
                    -0.75 - height / 2 + 0.4,
                    -0.05
                );
                posts.push(post.applyMatrix4(basis));
            });
        });
        const boardMesh = new THREE.Mesh(
            mergeGeometries(boards),
            boardMaterial
        );
        boardMesh.name = 'race-boards';
        boardMesh.castShadow = true;
        boardMesh.receiveShadow = true;
        this.root.add(boardMesh);
        const postMesh = new THREE.Mesh(
            mergeGeometries(posts),
            this.postMaterial
        );
        postMesh.name = 'race-board-posts';
        this.root.add(postMesh);
    }

    // in segments along the lap, so all but the few in view get culled
    buildArmco() {
        const track = this.track;
        const curve = track.visualCurve;
        const segments = ARMCO_SEGMENTS;
        // a whole number of rings per segment
        const samples =
            segments * Math.ceil(track.length / this.ringSpacing / segments);
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
        // per ring: the post foot, the way out from the road, and along it
        const posts: Record<number, number[]> = { 1: [], [-1]: [] };
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
                posts[sign].push(
                    base.x + side.x * sign * 0.1,
                    base.y,
                    base.z + side.z * sign * 0.1,
                    side.x * sign,
                    side.z * sign,
                    tangent.x,
                    tangent.z
                );
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
            const colors: number[] = [];
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
                for (let k = 0; k < rings * columns; k++) {
                    colors.push(RAIL_COLOR.r, RAIL_COLOR.g, RAIL_COLOR.b);
                }
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
                // a post at every ring: the faces you can see from the road
                // (front, both sides, top) in the same mesh as the rail
                const p = posts[sign];
                for (let i = first; i < first + perSegment; i++) {
                    const [fx, fy, fz, ox, oz, tx, tz] = p.slice(
                        i * 7,
                        i * 7 + 7
                    );
                    const hw = POST_HALF_WIDTH;
                    const hd = POST_HALF_DEPTH;
                    const corner = (u: number, v: number, h: number) => [
                        fx + tx * u * hw + ox * v * hd,
                        fy + h,
                        fz + tz * u * hw + oz * v * hd,
                    ];
                    const quad = (q: number[][]) => {
                        const at = positions.length / 3;
                        q.forEach((c) => {
                            positions.push(c[0], c[1], c[2]);
                            colors.push(
                                POST_COLOR.r,
                                POST_COLOR.g,
                                POST_COLOR.b
                            );
                        });
                        indices.push(at, at + 1, at + 2, at, at + 2, at + 3);
                    };
                    const h = POST_HEIGHT;
                    // front faces the road (v = -1)
                    quad([
                        corner(-1, -1, 0),
                        corner(1, -1, 0),
                        corner(1, -1, h),
                        corner(-1, -1, h),
                    ]);
                    quad([
                        corner(1, -1, 0),
                        corner(1, 1, 0),
                        corner(1, 1, h),
                        corner(1, -1, h),
                    ]);
                    quad([
                        corner(-1, 1, 0),
                        corner(-1, -1, 0),
                        corner(-1, -1, h),
                        corner(-1, 1, h),
                    ]);
                    quad([
                        corner(-1, -1, h),
                        corner(1, -1, h),
                        corner(1, 1, h),
                        corner(-1, 1, h),
                    ]);
                }
            });
            const geometry = new THREE.BufferGeometry();
            geometry.setIndex(indices);
            geometry.setAttribute(
                'position',
                new THREE.Float32BufferAttribute(positions, 3)
            );
            geometry.setAttribute(
                'color',
                new THREE.Float32BufferAttribute(colors, 3)
            );
            geometry.computeVertexNormals();
            geometry.computeBoundingSphere();
            const mesh = new THREE.Mesh(geometry, this.armcoMaterial);
            mesh.name = `race-armco-${segment}`;
            mesh.receiveShadow = true;
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

}
