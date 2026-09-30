// the garage's rear body kit, shaped from the car it goes on: a ducktail
// that follows the boot lid's trailing edge across its width, or a gt wing
// with an airfoil blade, end plates and swan neck mounts standing on the
// lid. built in the car's parent frame (forward +z, up +y, meters)
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Spoiler } from './garage';

// top of the body straight down at (x, z) in the parent frame, null off it
export type KitSurface = (x: number, z: number) => number | null;

let carbon: THREE.MeshPhysicalMaterial | null = null;
let anodized: THREE.MeshStandardMaterial | null = null;

// 2x2 twill: tows of fibre crossing over two and under two, with a bit of
// shading on each so the weave catches the light under the clearcoat
const weave = () => {
    const size = 128;
    const tow = 16;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    for (let cy = 0; cy < size / tow; cy++) {
        for (let cx = 0; cx < size / tow; cx++) {
            const across = Math.floor((cx + cy) / 2) % 2 === 0;
            const x = cx * tow;
            const y = cy * tow;
            const g = across
                ? ctx.createLinearGradient(x, y, x, y + tow)
                : ctx.createLinearGradient(x, y, x + tow, y);
            g.addColorStop(0, '#16171a');
            g.addColorStop(0.5, '#3a3d44');
            g.addColorStop(1, '#16171a');
            ctx.fillStyle = g;
            ctx.fillRect(x, y, tow, tow);
            ctx.strokeStyle = 'rgba(0,0,0,0.25)';
            ctx.lineWidth = 1;
            for (let k = 2; k < tow; k += 3) {
                ctx.beginPath();
                if (across) {
                    ctx.moveTo(x, y + k);
                    ctx.lineTo(x + tow, y + k);
                } else {
                    ctx.moveTo(x + k, y);
                    ctx.lineTo(x + k, y + tow);
                }
                ctx.stroke();
            }
        }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    // uvs are in meters: a tile every 3 cm
    texture.repeat.set(1 / 0.03, 1 / 0.03);
    return texture;
};

export const carbonMaterial = () => {
    if (!carbon) {
        carbon = new THREE.MeshPhysicalMaterial({
            name: 'garage-carbon',
            map: weave(),
            color: 0xb8bcc4,
            roughness: 0.42,
            metalness: 0.25,
            clearcoat: 1,
            clearcoatRoughness: 0.08,
        });
    }
    return carbon;
};

const anodizedMaterial = () => {
    if (!anodized) {
        anodized = new THREE.MeshStandardMaterial({
            name: 'garage-anodized',
            color: 0x1b1c1f,
            roughness: 0.32,
            metalness: 0.85,
        });
    }
    return anodized;
};

// the lid's trailing edge at x: stepping forward from behind the car, the
// first point within 2.5 cm of the highest point of the lid's last 35 cm
export const lidEdge = (surface: KitSurface, x: number, halfLength: number) => {
    const samples: Array<[number, number]> = [];
    for (let z = -halfLength - 0.4; z < -halfLength + 1.2; z += 0.015) {
        const y = surface(x, z);
        if (y !== null) samples.push([z, y]);
    }
    if (!samples.length) return null;
    const rear = samples[0][0];
    const lid = samples.filter(([z]) => z < rear + 0.35);
    const top = Math.max(...lid.map(([, y]) => y));
    const edge = lid.find(([, y]) => y > top - 0.025)!;
    const ahead = surface(x, edge[0] + 0.12) ?? edge[1];
    return { z: edge[0], y: edge[1], ahead };
};

const smooth = (t: number) => t * t * (3 - 2 * t);

// a strip of profile rings across the car, closed at both ends
const sweep = (rings: THREE.Vector3[][]) => {
    const m = rings[0].length;
    const positions: number[] = [];
    const uvs: number[] = [];
    const index: number[] = [];
    rings.forEach((ring) => {
        let run = 0;
        ring.forEach((p, j) => {
            if (j) run += p.distanceTo(ring[j - 1]);
            positions.push(p.x, p.y, p.z);
            uvs.push(p.x, run);
        });
    });
    for (let i = 0; i + 1 < rings.length; i++) {
        for (let j = 0; j < m; j++) {
            const a = i * m + j;
            const b = i * m + ((j + 1) % m);
            const c = (i + 1) * m + j;
            const d = (i + 1) * m + ((j + 1) % m);
            index.push(a, c, b, b, c, d);
        }
    }
    // end caps, fanned from each end ring's middle
    [0, rings.length - 1].forEach((i, end) => {
        const ring = rings[i];
        const middle = ring
            .reduce((sum, p) => sum.add(p), new THREE.Vector3())
            .divideScalar(m);
        const centre = positions.length / 3;
        positions.push(middle.x, middle.y, middle.z);
        uvs.push(middle.x, 0);
        for (let j = 0; j < m; j++) {
            const a = i * m + j;
            const b = i * m + ((j + 1) % m);
            if (end) index.push(centre, a, b);
            else index.push(centre, b, a);
        }
    });
    // faces out: the enclosed volume comes out positive
    let volume = 0;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (let i = 0; i < index.length; i += 3) {
        a.fromArray(positions, index[i] * 3);
        b.fromArray(positions, index[i + 1] * 3);
        c.fromArray(positions, index[i + 2] * 3);
        volume += a.dot(b.cross(c));
    }
    if (volume < 0) {
        for (let i = 0; i < index.length; i += 3) {
            [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]];
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    return geometry;
};

// a lip kicked up off the lid's trailing edge, following the edge across
// the lid and fading into the body at the corners
const ducktail = (surface: KitSurface, span: number, halfLength: number) => {
    const count = 41;
    const middle = lidEdge(surface, 0, halfLength);
    if (!middle) return null;
    // the lid only: corners that drop away onto the quarter panels are out
    const raw = Array.from({ length: count }, (_, i) => {
        const x = (i / (count - 1) - 0.5) * span;
        const edge = lidEdge(surface, x, halfLength);
        return edge && Math.abs(edge.y - middle.y) < 0.09 ? { x, ...edge } : null;
    });
    let first = Math.floor(count / 2);
    let last = first;
    while (first > 0 && raw[first - 1]) first--;
    while (last < count - 1 && raw[last + 1]) last++;
    const edges = raw.slice(first, last + 1) as Array<{ x: number; z: number; y: number; ahead: number }>;
    if (edges.length < 5) return null;
    // the sampled edge steps with the ray spacing, a running mean smooths it
    const mean = (i: number, key: 'z' | 'y' | 'ahead') => {
        let sum = 0;
        let n = 0;
        for (let k = Math.max(0, i - 3); k <= Math.min(edges.length - 1, i + 3); k++) {
            sum += edges[k][key];
            n++;
        }
        return sum / n;
    };
    const lidHalf = Math.min(Math.abs(edges[0].x), Math.abs(edges[edges.length - 1].x));
    const rings: THREE.Vector3[][] = [];
    edges.forEach((edge, i) => {
        const x = edge.x;
        if (Math.abs(x) > lidHalf + 1e-6) return;
        const z = mean(i, 'z');
        const y = mean(i, 'y');
        const ahead = mean(i, 'ahead');
        const h = 0.15 + 0.85 * smooth(Math.min(1, (lidHalf - Math.abs(x)) / 0.18));
        const lift = 0.05 * h;
        const top: THREE.Vector3[] = [];
        // up the lid and over the edge into the kick
        const p0 = new THREE.Vector2(z + 0.13, ahead + 0.003);
        const p1 = new THREE.Vector2(z + 0.01, y + 0.01 * h);
        const p2 = new THREE.Vector2(z - 0.03 * h - 0.006, y + lift);
        for (let k = 0; k <= 6; k++) {
            const t = k / 6;
            const a = (1 - t) * (1 - t);
            const b = 2 * (1 - t) * t;
            const c = t * t;
            top.push(
                new THREE.Vector3(
                    x,
                    a * p0.y + b * p1.y + c * p2.y,
                    a * p0.x + b * p1.x + c * p2.x
                )
            );
        }
        const under = [
            new THREE.Vector3(x, y + lift - 0.007, z - 0.03 * h - 0.009),
            new THREE.Vector3(x, y - 0.006, z - 0.002),
            new THREE.Vector3(x, ahead - 0.004, z + 0.13),
        ];
        rings.push([...top, ...under]);
    });
    return rings.length > 3 ? sweep(rings) : null;
};

// a cambered airfoil (naca 4412 turned over, so it pulls down), chord 1
const airfoil = (points = 22) => {
    const m = -0.04;
    const p = 0.4;
    const t = 0.12;
    const upper: THREE.Vector2[] = [];
    const lower: THREE.Vector2[] = [];
    for (let i = 0; i <= points; i++) {
        const x = (1 - Math.cos((i / points) * Math.PI)) / 2;
        const yc = x < p ? (m / (p * p)) * (2 * p * x - x * x) : (m / ((1 - p) * (1 - p))) * (1 - 2 * p + 2 * p * x - x * x);
        const dy = x < p ? ((2 * m) / (p * p)) * (p - x) : ((2 * m) / ((1 - p) * (1 - p))) * (p - x);
        const th = Math.atan(dy);
        const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
        upper.push(new THREE.Vector2(x - yt * Math.sin(th), yc + yt * Math.cos(th)));
        lower.push(new THREE.Vector2(x + yt * Math.sin(th), yc - yt * Math.cos(th)));
    }
    return [...upper.reverse(), ...lower.slice(1)];
};

// shape points are (back, up): extruded along +z, then turned so back is -z
// and the extrusion runs across the car (+x)
const across = (shape: THREE.Shape, depth: number) => {
    const geometry = new THREE.ExtrudeGeometry(shape, {
        depth,
        bevelEnabled: false,
        curveSegments: 10,
    });
    geometry.rotateY(Math.PI / 2);
    return geometry;
};

const gtWing = (surface: KitSurface, span: number, halfLength: number) => {
    const edge = lidEdge(surface, 0, halfLength);
    if (!edge) return null;
    const chord = 0.3;
    const aoa = THREE.MathUtils.degToRad(9);
    const lead = edge.z + 0.27;
    const height = edge.y + 0.3;
    const carbonParts: THREE.BufferGeometry[] = [];
    const metalParts: THREE.BufferGeometry[] = [];

    // blade: leading edge low, trailing edge up
    const profile = airfoil().map((v) =>
        v.clone().multiplyScalar(chord).rotateAround(new THREE.Vector2(), aoa)
    );
    const blade = across(new THREE.Shape(profile), span);
    blade.translate(-span / 2, height, lead);
    carbonParts.push(blade);
    const trailing = profile.reduce((best, v) => (v.x > best.x ? v : best));
    // gurney strip along the trailing edge
    const gurney = new THREE.BoxGeometry(span, 0.014, 0.004);
    gurney.translate(0, height + trailing.y + 0.006, lead - trailing.x + 0.001);
    carbonParts.push(gurney.toNonIndexed());

    // end plates, a rounded slab a little bigger than the blade's side
    const plate = new THREE.Shape();
    const back0 = -0.04;
    const back1 = chord + 0.06;
    const low = -0.1;
    const high = trailing.y + 0.07;
    const r = 0.03;
    plate.moveTo(back0 + r, low);
    plate.lineTo(back1 - r, low + 0.03);
    plate.quadraticCurveTo(back1, low + 0.03, back1, low + 0.03 + r);
    plate.lineTo(back1, high - r);
    plate.quadraticCurveTo(back1, high, back1 - r, high);
    plate.lineTo(back0 + 0.06, high - 0.04);
    plate.quadraticCurveTo(back0, high - 0.05, back0, high - 0.08);
    plate.lineTo(back0, low + r);
    plate.quadraticCurveTo(back0, low, back0 + r, low);
    [-1, 1].forEach((side) => {
        const g = across(plate, 0.006);
        g.translate(side > 0 ? span / 2 : -span / 2 - 0.006, height, lead);
        carbonParts.push(g);
    });

    // swan necks: up from the lid behind the blade and over onto its top
    const mountX = span * 0.3;
    [-1, 1].forEach((side) => {
        const x = side * mountX;
        const baseBack = -(edge.z + 0.14) + 0.0;
        const baseY = surface(x, edge.z + 0.14) ?? edge.y;
        const topBack = -(lead - chord * 0.35);
        const topY = height + 0.045;
        const curve = new THREE.CubicBezierCurve(
            new THREE.Vector2(baseBack, baseY - 0.004),
            new THREE.Vector2(baseBack + 0.1, baseY + 0.16),
            new THREE.Vector2(topBack + 0.12, topY + 0.1),
            new THREE.Vector2(topBack, topY)
        );
        const pts = curve.getPoints(18);
        const left: THREE.Vector2[] = [];
        const right: THREE.Vector2[] = [];
        pts.forEach((p, i) => {
            const t = i / (pts.length - 1);
            const tangent = curve.getTangent(t);
            const normal = new THREE.Vector2(-tangent.y, tangent.x);
            const w = THREE.MathUtils.lerp(0.05, 0.028, t) / 2;
            left.push(p.clone().addScaledVector(normal, w));
            right.push(p.clone().addScaledVector(normal, -w));
        });
        // shape x is 'back', so the neck's points go in as (back, up) with
        // back measured from z = 0
        const shape = new THREE.Shape([...left, ...right.reverse()]);
        const g = across(shape, 0.012);
        g.translate(x - 0.006, 0, 0);
        metalParts.push(g);
        const foot = new THREE.BoxGeometry(0.034, 0.008, 0.1);
        foot.translate(x, baseY + 0.001, edge.z + 0.14);
        metalParts.push(foot.toNonIndexed());
    });
    return {
        carbon: mergeGeometries(carbonParts.map((g) => (g.index ? g.toNonIndexed() : g)))!,
        metal: mergeGeometries(metalParts.map((g) => (g.index ? g.toNonIndexed() : g)))!,
    };
};

// the body's paint without its maps (liveries and dirt are laid out for the
// body's uvs, not the kit's), kept in step with repaints by kitPaint again
export const kitPaint = (paint: THREE.Material, into?: THREE.Material) => {
    const source = paint as THREE.MeshPhysicalMaterial;
    const copy = (into as THREE.MeshPhysicalMaterial) || new THREE.MeshPhysicalMaterial({ name: 'garage-kit-paint' });
    if (source.color) copy.color.copy(source.color);
    copy.metalness = source.metalness ?? 0.4;
    copy.roughness = source.roughness ?? 0.35;
    copy.clearcoat = source.clearcoat ?? 0.8;
    copy.clearcoatRoughness = source.clearcoatRoughness ?? 0.1;
    copy.envMapIntensity = source.envMapIntensity ?? 1;
    copy.iridescence = source.iridescence ?? 0;
    copy.needsUpdate = true;
    return copy;
};

// the kit in the parent frame. the ducktail takes the body's paint when
// there is one to take
export const buildKitParts = (
    kind: Spoiler,
    surface: KitSurface,
    width: number,
    length: number,
    paint: THREE.Material | null
) => {
    const group = new THREE.Group();
    const halfLength = length / 2;
    if (kind === 'ducktail') {
        const geometry = ducktail(surface, width * 0.8, halfLength);
        if (geometry) {
            const mesh = new THREE.Mesh(geometry, paint ? kitPaint(paint) : carbonMaterial());
            mesh.name = 'garage-ducktail';
            group.add(mesh);
        }
    } else if (kind === 'wing') {
        const wing = gtWing(surface, Math.min(1.75, width * 0.86), halfLength);
        if (wing) {
            const blade = new THREE.Mesh(wing.carbon, carbonMaterial());
            blade.name = 'garage-wing';
            const mounts = new THREE.Mesh(wing.metal, anodizedMaterial());
            mounts.name = 'garage-wing-mounts';
            group.add(blade, mounts);
        }
    }
    group.traverse((child) => {
        (child as THREE.Mesh).castShadow = true;
        (child as THREE.Mesh).receiveShadow = true;
    });
    return group;
};
