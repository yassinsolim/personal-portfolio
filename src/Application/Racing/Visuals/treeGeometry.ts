import * as THREE from 'three';
import {
    barkRect,
    foliageRect,
    type Species,
    type UvRect,
} from './foliageTextures';

// procedural trees at unit height (base at y = 0, top at y = 1), scaled per
// instance. trunks and limbs are tapered tubes, foliage is alpha tested cards.
// foliage normals point out of the crown instead of along the card, so a crown
// shades like one soft volume. vertex colors carry the ambient occlusion and
// aWind carries (sway weight, flutter phase) for the wind in the shader

class TreeBuilder {
    positions: number[] = [];
    normals: number[] = [];
    uvs: number[] = [];
    colors: number[] = [];
    wind: number[] = [];
    indices: number[] = [];
    random: () => number;

    constructor(seed: number) {
        let state = seed >>> 0;
        this.random = () => {
            state = (state + 0x6d2b79f5) >>> 0;
            let t = state;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    vertex(
        p: THREE.Vector3,
        n: THREE.Vector3,
        u: number,
        v: number,
        shade: number,
        sway: number,
        phase: number
    ) {
        this.positions.push(p.x, p.y, p.z);
        this.normals.push(n.x, n.y, n.z);
        this.uvs.push(u, v);
        this.colors.push(shade, shade, shade);
        this.wind.push(sway, phase);
        return this.positions.length / 3 - 1;
    }

    // a tapered tube along a straight segment
    tube(
        start: THREE.Vector3,
        end: THREE.Vector3,
        r0: number,
        r1: number,
        rect: UvRect,
        radial = 6,
        rings = 3,
        shade: [number, number] = [0.55, 0.95]
    ) {
        const axis = new THREE.Vector3().subVectors(end, start);
        const length = axis.length();
        axis.normalize();
        const side =
            Math.abs(axis.y) < 0.95
                ? new THREE.Vector3(0, 1, 0)
                : new THREE.Vector3(1, 0, 0);
        const a = new THREE.Vector3().crossVectors(axis, side).normalize();
        const b = new THREE.Vector3().crossVectors(axis, a).normalize();
        const base = this.positions.length / 3;
        const p = new THREE.Vector3();
        const n = new THREE.Vector3();
        for (let ring = 0; ring <= rings; ring++) {
            const t = ring / rings;
            const radius = r0 + (r1 - r0) * t;
            const center = new THREE.Vector3()
                .copy(start)
                .addScaledVector(axis, length * t);
            const height = center.y;
            for (let i = 0; i <= radial; i++) {
                const angle = (i / radial) * Math.PI * 2;
                n.copy(a)
                    .multiplyScalar(Math.cos(angle))
                    .addScaledVector(b, Math.sin(angle));
                p.copy(center).addScaledVector(n, radius);
                const u = rect.u0 + (rect.u1 - rect.u0) * (i / radial);
                const v = rect.v0 + (rect.v1 - rect.v0) * Math.min(1, height);
                this.vertex(
                    p,
                    n,
                    u,
                    v,
                    shade[0] +
                        (shade[1] - shade[0]) * Math.min(1, height * 1.6),
                    height * height,
                    0
                );
            }
        }
        for (let ring = 0; ring < rings; ring++) {
            for (let i = 0; i < radial; i++) {
                const row = base + ring * (radial + 1);
                const next = row + radial + 1;
                this.indices.push(
                    row + i,
                    next + i,
                    row + i + 1,
                    row + i + 1,
                    next + i,
                    next + i + 1
                );
            }
        }
    }

    // one foliage card. u runs along uAxis, v along vAxis, centered on center
    card(
        center: THREE.Vector3,
        uAxis: THREE.Vector3,
        vAxis: THREE.Vector3,
        width: number,
        height: number,
        normal: THREE.Vector3,
        rect: UvRect,
        shade: number,
        flip: boolean
    ) {
        const sway = center.y * center.y;
        const phase = this.random() * Math.PI * 2;
        const corners: [number, number][] = [
            [-0.5, -0.5],
            [0.5, -0.5],
            [0.5, 0.5],
            [-0.5, 0.5],
        ];
        const base = this.positions.length / 3;
        const p = new THREE.Vector3();
        corners.forEach(([cu, cv]) => {
            p.copy(center)
                .addScaledVector(uAxis, cu * width)
                .addScaledVector(vAxis, cv * height);
            const uu = flip ? 0.5 - cu : cu + 0.5;
            this.vertex(
                p,
                normal,
                rect.u0 + (rect.u1 - rect.u0) * uu,
                rect.v0 + (rect.v1 - rect.v0) * (cv + 0.5),
                shade,
                sway,
                phase
            );
        });
        this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }

    build() {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
            'position',
            new THREE.Float32BufferAttribute(this.positions, 3)
        );
        geometry.setAttribute(
            'normal',
            new THREE.Float32BufferAttribute(this.normals, 3)
        );
        geometry.setAttribute(
            'uv',
            new THREE.Float32BufferAttribute(this.uvs, 2)
        );
        geometry.setAttribute(
            'color',
            new THREE.Float32BufferAttribute(this.colors, 3)
        );
        geometry.setAttribute(
            'aWind',
            new THREE.Float32BufferAttribute(this.wind, 2)
        );
        geometry.setIndex(this.indices);
        geometry.computeBoundingSphere();
        geometry.computeBoundingBox();
        return geometry;
    }
}

const UP = new THREE.Vector3(0, 1, 0);

const randomDirection = (random: () => number, target: THREE.Vector3) => {
    const z = random() * 2 - 1;
    const a = random() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    return target.set(r * Math.cos(a), z, r * Math.sin(a));
};

// cards facing out of a lumpy crown made of a few lobes
const crownCards = (
    builder: TreeBuilder,
    lobes: { center: THREE.Vector3; radius: THREE.Vector3 }[],
    crownCenter: THREE.Vector3,
    crownRadius: number,
    count: number,
    size: [number, number],
    rect: UvRect,
    hang: number
) => {
    const random = builder.random;
    const dir = new THREE.Vector3();
    const center = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const uAxis = new THREE.Vector3();
    const vAxis = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
        const lobe = lobes[Math.floor(random() * lobes.length)];
        randomDirection(random, dir);
        // mostly on the surface, some inside to fill it
        const depth = 0.55 + Math.pow(random(), 0.5) * 0.45;
        center.set(
            lobe.center.x + dir.x * lobe.radius.x * depth,
            lobe.center.y + dir.y * lobe.radius.y * depth,
            lobe.center.z + dir.z * lobe.radius.z * depth
        );
        normal
            .subVectors(center, crownCenter)
            .normalize()
            .lerp(UP, 0.25)
            .normalize();
        // the card faces roughly out of the crown, spun randomly in its plane,
        // hanging leaves tip toward vertical
        uAxis
            .crossVectors(
                normal,
                Math.abs(normal.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : UP
            )
            .normalize();
        vAxis.crossVectors(uAxis, normal).normalize();
        const spin = random() * Math.PI * 2;
        const u2 = uAxis
            .clone()
            .multiplyScalar(Math.cos(spin))
            .addScaledVector(vAxis, Math.sin(spin));
        const v2 = new THREE.Vector3().crossVectors(u2, normal).normalize();
        if (hang > 0) {
            v2.lerp(new THREE.Vector3(0, -1, 0), hang * random()).normalize();
        }
        const s = size[0] + random() * (size[1] - size[0]);
        const outside = center.distanceTo(crownCenter) / crownRadius;
        const shade = THREE.MathUtils.clamp(
            0.35 + outside * 0.55 + dir.y * 0.12,
            0.3,
            1.05
        );
        builder.card(center, u2, v2, s, s, normal, rect, shade, random() < 0.5);
    }
};

export const buildSpruce = (seed: number) => {
    const builder = new TreeBuilder(seed);
    const random = builder.random;
    const bark = barkRect('spruce');
    const needles = foliageRect('spruce');
    builder.tube(
        new THREE.Vector3(0, -0.02, 0),
        new THREE.Vector3(0, 1, 0),
        0.02,
        0.002,
        bark,
        6,
        4
    );
    const crownBase = 0.1 + random() * 0.05;
    const radiusAt = (y: number) =>
        0.2 *
            Math.pow(Math.max(0, 1 - (y - crownBase) / (1 - crownBase)), 0.92) +
        0.012;
    const dir = new THREE.Vector3();
    const side = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const center = new THREE.Vector3();
    let y = crownBase;
    while (y < 0.97) {
        const radius = radiusAt(y);
        const branches = 5 + Math.floor(random() * 3);
        const offset = random() * Math.PI * 2;
        for (let i = 0; i < branches; i++) {
            const a =
                offset + (i / branches) * Math.PI * 2 + (random() - 0.5) * 0.5;
            const length = radius * (0.85 + random() * 0.25);
            // lower branches droop more, like real norway spruce
            const droop = 0.12 + (1 - y) * 0.3;
            dir.set(Math.cos(a), -droop, Math.sin(a)).normalize();
            side.crossVectors(dir, UP).normalize();
            const tilt = (random() - 0.5) * 0.7;
            const across = side.clone().applyAxisAngle(dir, tilt);
            normal.set(Math.cos(a), 0.9, Math.sin(a)).normalize();
            const low = 1 - Math.min(1, (y - crownBase) * 1.4);
            for (const [t, w, h] of [
                [0.34, 0.78, 0.62],
                [0.78, 0.6, 0.46],
            ]) {
                center.set(0, y, 0).addScaledVector(dir, length * t);
                const shade = 0.4 + t * 0.5 + (1 - low) * 0.12;
                builder.card(
                    center,
                    dir,
                    across,
                    length * w,
                    length * h,
                    normal,
                    needles,
                    shade,
                    false
                );
            }
        }
        y += 0.04 + random() * 0.016;
    }
    // the leader at the top
    for (let i = 0; i < 2; i++) {
        const a = (i * Math.PI) / 2 + random();
        const uAxis = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        builder.card(
            new THREE.Vector3(0, 0.96, 0),
            UP,
            uAxis,
            0.1,
            0.05,
            new THREE.Vector3(Math.cos(a), 0.6, Math.sin(a)).normalize(),
            needles,
            0.9,
            false
        );
    }
    return builder.build();
};

export const buildBeech = (seed: number) => {
    const builder = new TreeBuilder(seed);
    const random = builder.random;
    const bark = barkRect('beech');
    const leaves = foliageRect('beech');
    const lean = new THREE.Vector3(
        (random() - 0.5) * 0.04,
        0,
        (random() - 0.5) * 0.04
    );
    const top = new THREE.Vector3(0, 0.62, 0).add(lean);
    builder.tube(new THREE.Vector3(0, -0.02, 0), top, 0.032, 0.014, bark, 7, 4);
    const crownCenter = new THREE.Vector3(lean.x, 0.66, lean.z);
    const lobes: { center: THREE.Vector3; radius: THREE.Vector3 }[] = [];
    const lobeCount = 6;
    for (let i = 0; i < lobeCount; i++) {
        const a = (i / lobeCount) * Math.PI * 2 + random();
        const r = 0.12 + random() * 0.1;
        const center = new THREE.Vector3(
            Math.cos(a) * r,
            0.58 + random() * 0.26,
            Math.sin(a) * r
        ).add(lean);
        lobes.push({
            center,
            radius: new THREE.Vector3(
                0.15 + random() * 0.06,
                0.13 + random() * 0.05,
                0.15 + random() * 0.06
            ),
        });
        // a limb out to each lobe
        builder.tube(
            new THREE.Vector3(0, 0.38 + random() * 0.12, 0).add(lean),
            center,
            0.012,
            0.004,
            bark,
            5,
            2
        );
    }
    lobes.push({
        center: new THREE.Vector3(0, 0.86, 0).add(lean),
        radius: new THREE.Vector3(0.14, 0.12, 0.14),
    });
    crownCards(builder, lobes, crownCenter, 0.34, 105, [0.16, 0.23], leaves, 0);
    return builder.build();
};

export const buildBirch = (seed: number) => {
    const builder = new TreeBuilder(seed);
    const random = builder.random;
    const bark = barkRect('birch');
    const leaves = foliageRect('birch');
    const lean = new THREE.Vector3(
        (random() - 0.5) * 0.08,
        0,
        (random() - 0.5) * 0.08
    );
    const mid = new THREE.Vector3(0, 0.5, 0).addScaledVector(lean, 0.5);
    const top = new THREE.Vector3(0, 0.95, 0).add(lean);
    builder.tube(new THREE.Vector3(0, -0.02, 0), mid, 0.016, 0.011, bark, 6, 2);
    builder.tube(mid, top, 0.011, 0.003, bark, 6, 2);
    const crownCenter = new THREE.Vector3(lean.x * 0.8, 0.66, lean.z * 0.8);
    const lobes: { center: THREE.Vector3; radius: THREE.Vector3 }[] = [];
    for (let i = 0; i < 4; i++) {
        const y = 0.46 + i * 0.13;
        lobes.push({
            center: new THREE.Vector3(0, y, 0).addScaledVector(lean, y),
            radius: new THREE.Vector3(0.13 - i * 0.015, 0.1, 0.13 - i * 0.015),
        });
    }
    crownCards(
        builder,
        lobes,
        crownCenter,
        0.26,
        60,
        [0.12, 0.17],
        leaves,
        0.6
    );
    return builder.build();
};

export const buildPine = (seed: number) => {
    const builder = new TreeBuilder(seed);
    const random = builder.random;
    const bark = barkRect('pine');
    const needles = foliageRect('pine');
    const bend = new THREE.Vector3(
        (random() - 0.5) * 0.06,
        0,
        (random() - 0.5) * 0.06
    );
    const mid = new THREE.Vector3(0, 0.45, 0).addScaledVector(bend, -0.5);
    const top = new THREE.Vector3(0, 0.9, 0).add(bend);
    builder.tube(new THREE.Vector3(0, -0.02, 0), mid, 0.02, 0.014, bark, 6, 2);
    builder.tube(mid, top, 0.014, 0.004, bark, 6, 2);
    const crownCenter = new THREE.Vector3(bend.x, 0.82, bend.z);
    const lobes: { center: THREE.Vector3; radius: THREE.Vector3 }[] = [];
    for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + random();
        const r = i === 0 ? 0 : 0.07 + random() * 0.06;
        const center = new THREE.Vector3(
            Math.cos(a) * r,
            0.74 + random() * 0.18,
            Math.sin(a) * r
        ).add(bend);
        lobes.push({ center, radius: new THREE.Vector3(0.1, 0.06, 0.1) });
        if (i > 0) {
            builder.tube(
                new THREE.Vector3(0, 0.66 + random() * 0.1, 0).add(bend),
                center,
                0.007,
                0.003,
                bark,
                4,
                1
            );
        }
    }
    crownCards(builder, lobes, crownCenter, 0.2, 50, [0.11, 0.15], needles, 0);
    return builder.build();
};

export const TREE_BUILDERS: Record<
    Species,
    (seed: number) => THREE.BufferGeometry
> = {
    spruce: buildSpruce,
    beech: buildBeech,
    birch: buildBirch,
    pine: buildPine,
};

// how wide each species is at unit height, for the impostor bake
export const TREE_HALF_WIDTH: Record<Species, number> = {
    spruce: 0.25,
    beech: 0.4,
    birch: 0.26,
    pine: 0.24,
};
