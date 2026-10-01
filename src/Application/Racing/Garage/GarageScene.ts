// the garage the car is shown in while it's being modified: a clean customs
// studio. dark epoxy floor, charcoal panel walls with led strips, a hexagon
// led grid over the bay (the reflections come from the same shapes), a
// turntable with a light ring, tool chests, a tyre rack and the shop's neon.
// all of it is made here (boxes, tubes and canvas textures), merged per
// material into a few draws, built once on the first visit and parked far
// under the track
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// under the terrain, so nothing of the track shows through
export const GARAGE_ORIGIN = new THREE.Vector3(0, -3000, 0);
const WIDTH = 18;
const DEPTH = 16;
const HEIGHT = 6;
// the hexagon grid: edge length, tube size, the frame it fills, and how far
// it hangs under the ceiling
const HEX_EDGE = 0.6;
const HEX_TUBE = 0.055;
const HEX_HALF_X = 3.9;
const HEX_HALF_Z = 5.1;
const HEX_DROP = 0.45;
// the reflections are seen from about the middle of the car
const ENV_EYE = 0.7;
// upright light bars down the side walls
const LIGHT_BARS = [-3.6, -1.2, 1.2, 3.6];
const LIGHT_BAR_FOOT = 0.9;
const LIGHT_BAR_HEIGHT = 3.2;

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

const canvasTexture = (w: number, h: number, draw: Draw, repeat = false) => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    draw(canvas.getContext('2d')!, w, h);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    if (repeat) {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
    }
    return texture;
};

// a little seeded randomness, so the shop looks the same on every visit
const random = (() => {
    let seed = 7;
    return () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
    };
})();

const speckle = (ctx: CanvasRenderingContext2D, w: number, h: number, count: number, alpha: number) => {
    for (let i = 0; i < count; i++) {
        const light = random() > 0.5;
        ctx.fillStyle = light ? `rgba(255,255,255,${alpha * random()})` : `rgba(0,0,0,${alpha * random()})`;
        const s = 1 + random() * 2.5;
        ctx.fillRect(random() * w, random() * h, s, s);
    }
};

// floor: dark epoxy with a fine flake and the bay outlined in white
const floorTexture = () =>
    canvasTexture(2048, 2048, (ctx, w, h) => {
        const px = w / WIDTH;
        const pz = h / DEPTH;
        ctx.fillStyle = '#24272c';
        ctx.fillRect(0, 0, w, h);
        speckle(ctx, w, h, 90000, 0.07);
        ctx.strokeStyle = 'rgba(232,238,244,0.82)';
        ctx.lineWidth = 0.05 * px;
        ctx.strokeRect(
            (WIDTH / 2 - 3.7) * px,
            (DEPTH / 2 - 4.3) * pz,
            7.4 * px,
            8.6 * pz
        );
        ctx.fillStyle = 'rgba(232,238,244,0.55)';
        ctx.font = `600 ${Math.round(0.3 * pz)}px "Helvetica Neue", Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('BAY 01', (WIDTH / 2) * px, (DEPTH / 2 + 3.95) * pz);
    });

// walls: charcoal panels, a seam every 1.2 m, a touch darker low down
const wallTexture = () =>
    canvasTexture(2048, 683, (ctx, w, h) => {
        const pm = w / WIDTH;
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#454a52');
        g.addColorStop(1, '#2b2e34');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        for (let x = 1.2; x < WIDTH; x += 1.2) ctx.fillRect(x * pm - 1, 0, 2, h);
        ctx.fillRect(0, h - 2.4 * pm - 1, w, 2);
        speckle(ctx, w, h, 12000, 0.04);
    });

// a roller shutter in anthracite: pressed ribs every 8 cm
const shutterTexture = () =>
    canvasTexture(256, 512, (ctx, w, h) => {
        for (let y = 0; y < h; y += 16) {
            const g = ctx.createLinearGradient(0, y, 0, y + 16);
            g.addColorStop(0, '#3e434a');
            g.addColorStop(0.45, '#5b6068');
            g.addColorStop(0.55, '#2b2f35');
            g.addColorStop(1, '#3a3f46');
            ctx.fillStyle = g;
            ctx.fillRect(0, y, w, 16);
        }
        speckle(ctx, w, h, 4000, 0.08);
    });

// a honeycomb of light tubes in the xz plane, filling a frame round the bay:
// cells cut at the frame like a real install, each shared edge once
const hexGrid = () => {
    const parts: THREE.BufferGeometry[] = [];
    const seen = new Set<string>();
    const key = (x: number, z: number) => `${Math.round(x * 100)},${Math.round(z * 100)}`;
    const tube = (ax: number, az: number, bx: number, bz: number) => {
        const id = [key(ax, az), key(bx, bz)].sort().join('|');
        if (seen.has(id)) return;
        seen.add(id);
        const length = Math.hypot(bx - ax, bz - az);
        if (length < 0.02) return;
        const g = new THREE.BoxGeometry(length + HEX_TUBE * 0.5, HEX_TUBE * 0.6, HEX_TUBE);
        g.rotateY(-Math.atan2(bz - az, bx - ax));
        g.translate((ax + bx) / 2, 0, (az + bz) / 2);
        parts.push(g.toNonIndexed());
    };
    // liang barsky against the frame
    const clipped = (ax: number, az: number, bx: number, bz: number) => {
        let t0 = 0;
        let t1 = 1;
        const dx = bx - ax;
        const dz = bz - az;
        const sides: Array<[number, number]> = [
            [-dx, ax + HEX_HALF_X],
            [dx, HEX_HALF_X - ax],
            [-dz, az + HEX_HALF_Z],
            [dz, HEX_HALF_Z - az],
        ];
        for (const [p, q] of sides) {
            if (Math.abs(p) < 1e-9) {
                if (q < 0) return;
                continue;
            }
            const r = q / p;
            if (p < 0) t0 = Math.max(t0, r);
            else t1 = Math.min(t1, r);
            if (t0 >= t1) return;
        }
        tube(ax + t0 * dx, az + t0 * dz, ax + t1 * dx, az + t1 * dz);
    };
    // flat topped cells: columns 1.5 edges apart, rows root 3 edges apart,
    // every other column half a row down
    const row = Math.sqrt(3) * HEX_EDGE;
    for (let col = -8; col <= 8; col++) {
        for (let r = -8; r <= 8; r++) {
            const cx = col * 1.5 * HEX_EDGE;
            const cz = r * row + (Math.abs(col) % 2 ? row / 2 : 0);
            for (let k = 0; k < 6; k++) {
                const a0 = (k * Math.PI) / 3;
                const a1 = ((k + 1) * Math.PI) / 3;
                clipped(
                    cx + HEX_EDGE * Math.cos(a0),
                    cz + HEX_EDGE * Math.sin(a0),
                    cx + HEX_EDGE * Math.cos(a1),
                    cz + HEX_EDGE * Math.sin(a1)
                );
            }
        }
    }
    tube(-HEX_HALF_X, -HEX_HALF_Z, HEX_HALF_X, -HEX_HALF_Z);
    tube(HEX_HALF_X, -HEX_HALF_Z, HEX_HALF_X, HEX_HALF_Z);
    tube(HEX_HALF_X, HEX_HALF_Z, -HEX_HALF_X, HEX_HALF_Z);
    tube(-HEX_HALF_X, HEX_HALF_Z, -HEX_HALF_X, -HEX_HALF_Z);
    const merged = mergeGeometries(parts)!;
    parts.forEach((part) => part.dispose());
    return merged;
};

const posterTexture = (title: string, sub: string, a: string, b: string) =>
    canvasTexture(512, 720, (ctx, w, h) => {
        const g = ctx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, a);
        g.addColorStop(1, b);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        // speed lines
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 6;
        for (let i = 0; i < 14; i++) {
            ctx.beginPath();
            const y = 180 + i * 26;
            ctx.moveTo(-20, y);
            ctx.lineTo(w + 20, y - 120);
            ctx.stroke();
        }
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 96px Impact, Arial Black, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(title, w / 2, h - 170);
        ctx.font = 'bold 36px Arial, sans-serif';
        ctx.fillText(sub, w / 2, h - 110);
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 8;
        ctx.strokeRect(20, 20, w - 40, h - 40);
        speckle(ctx, w, h, 6000, 0.15);
    });

// the shop's name in glass tubes
const neonTexture = () =>
    canvasTexture(1024, 256, (ctx, w, h) => {
        ctx.clearRect(0, 0, w, h);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'italic bold 120px "Brush Script MT", "Segoe Script", cursive';
        ctx.shadowColor = '#ff6a1a';
        ctx.shadowBlur = 40;
        ctx.strokeStyle = '#ffb27a';
        ctx.lineWidth = 10;
        ctx.strokeText('Yassin', w * 0.36, h * 0.5);
        ctx.fillStyle = '#fff4e6';
        ctx.fillText('Yassin', w * 0.36, h * 0.5);
        ctx.font = 'bold 76px Impact, Arial Black, sans-serif';
        ctx.shadowColor = '#1ad5ff';
        ctx.strokeStyle = '#8fe9ff';
        ctx.lineWidth = 8;
        ctx.strokeText('CUSTOMS', w * 0.74, h * 0.56);
        ctx.fillStyle = '#eafcff';
        ctx.fillText('CUSTOMS', w * 0.74, h * 0.56);
    });

// the fronts of a tool chest's drawers: graphite, aluminium pulls
const drawerTexture = () =>
    canvasTexture(256, 512, (ctx, w, h) => {
        ctx.fillStyle = '#25282d';
        ctx.fillRect(0, 0, w, h);
        const rows = [0, 50, 100, 150, 210, 280, 360, 440, 512];
        for (let i = 0; i + 1 < rows.length; i++) {
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillRect(0, rows[i], w, 3);
            const g = ctx.createLinearGradient(0, rows[i] + 8, 0, rows[i] + 14);
            g.addColorStop(0, '#eef1f4');
            g.addColorStop(1, '#8d939a');
            ctx.fillStyle = g;
            ctx.fillRect(20, rows[i] + 8, w - 40, 6);
        }
        speckle(ctx, w, h, 2000, 0.05);
    });

export default class GarageScene {
    root: THREE.Group;
    // the car goes on this: its floor contact lands on the garage floor
    stand: THREE.Group;
    lights: THREE.Light[] = [];
    environment: THREE.Texture | null = null;
    private built = false;

    constructor(parent: THREE.Object3D) {
        this.root = new THREE.Group();
        this.root.name = 'garage-scene';
        this.root.position.copy(GARAGE_ORIGIN);
        this.root.visible = false;
        this.stand = new THREE.Group();
        this.stand.name = 'garage-stand';
        this.root.add(this.stand);
        parent.add(this.root);
    }

    // what the paint and the floor reflect: a dark room with the hexagon
    // grid overhead, soft boxes down both sides and the wall strips, the
    // shapes the room really has, seen from the middle of the car
    buildEnvironment(renderer: THREE.WebGLRenderer) {
        if (this.environment) return this.environment;
        const scene = new THREE.Scene();
        const glow = (hex: number, strength: number) =>
            new THREE.MeshBasicMaterial({
                color: new THREE.Color(hex).multiplyScalar(strength),
                side: THREE.DoubleSide,
            });
        const room = new THREE.Mesh(
            new THREE.BoxGeometry(WIDTH, HEIGHT, DEPTH),
            new THREE.MeshBasicMaterial({ color: 0x1a1c20, side: THREE.BackSide })
        );
        room.position.y = HEIGHT / 2 - ENV_EYE;
        const floor = new THREE.Mesh(
            new THREE.PlaneGeometry(WIDTH, DEPTH),
            new THREE.MeshBasicMaterial({ color: 0x0c0d0f })
        );
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = 0.005 - ENV_EYE;
        const grid = new THREE.Mesh(hexGrid(), glow(0xf3f8ff, 7));
        grid.position.y = HEIGHT - HEX_DROP - ENV_EYE;
        scene.add(room, floor, grid);
        [-1, 1].forEach((side) => {
            LIGHT_BARS.forEach((z) => {
                const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, LIGHT_BAR_HEIGHT, 0.09), glow(0xe8f1ff, 4));
                bar.position.set(side * (WIDTH / 2 - 0.05), LIGHT_BAR_FOOT + LIGHT_BAR_HEIGHT / 2 - ENV_EYE, z);
                scene.add(bar);
            });
            const strip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, DEPTH - 0.4), glow(0xbfe6ff, 3));
            strip.position.set(side * (WIDTH / 2 - 0.05), 0.18 - ENV_EYE, 0);
            scene.add(strip);
        });
        const pmrem = new THREE.PMREMGenerator(renderer);
        this.environment = pmrem.fromScene(scene, 0.02).texture;
        pmrem.dispose();
        scene.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (!mesh.isMesh) return;
            mesh.geometry.dispose();
            (mesh.material as THREE.Material).dispose();
        });
        return this.environment;
    }

    build() {
        if (this.built) return;
        this.built = true;
        const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
        const put = (geometry: THREE.BufferGeometry, material: THREE.Material, matrix?: THREE.Matrix4) => {
            if (matrix) geometry.applyMatrix4(matrix);
            const g = geometry.index ? geometry.toNonIndexed() : geometry;
            if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.getAttribute('position').count) * 2), 2));
            const list = buckets.get(material);
            if (list) list.push(g);
            else buckets.set(material, [g]);
        };
        const at = (x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) =>
            new THREE.Matrix4().compose(
                new THREE.Vector3(x, y, z),
                new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
                new THREE.Vector3(1, 1, 1)
            );
        const box = (w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number, ry = 0) =>
            put(new THREE.BoxGeometry(w, h, d), material, at(x, y + h / 2, z, ry));
        const std = (color: number, roughness: number, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}) =>
            new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });

        // shell
        const floor = std(0xffffff, 0.36, 0, { map: floorTexture() });
        const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH, DEPTH), floor);
        floorMesh.rotation.x = -Math.PI / 2;
        floorMesh.receiveShadow = true;
        floorMesh.name = 'garage-floor';
        this.root.add(floorMesh);

        const wallMap = wallTexture();
        const walls = std(0xffffff, 0.75, 0.05, { map: wallMap });
        const sideMap = wallMap.clone();
        sideMap.repeat.set(DEPTH / WIDTH, 1);
        sideMap.wrapS = THREE.RepeatWrapping;
        sideMap.needsUpdate = true;
        const sideWalls = std(0xffffff, 0.75, 0.05, { map: sideMap });
        const wall = (w: number, material: THREE.Material, x: number, z: number, ry: number) => {
            const plane = new THREE.PlaneGeometry(w, HEIGHT);
            put(plane, material, at(x, HEIGHT / 2, z, ry));
        };
        wall(WIDTH, walls, 0, -DEPTH / 2, 0);
        wall(WIDTH, walls, 0, DEPTH / 2, Math.PI);
        wall(DEPTH, sideWalls, -WIDTH / 2, 0, Math.PI / 2);
        wall(DEPTH, sideWalls, WIDTH / 2, 0, -Math.PI / 2);
        const ceiling = std(0x0e0f12, 0.95);
        put(new THREE.PlaneGeometry(WIDTH, DEPTH), ceiling, at(0, HEIGHT, 0, 0, Math.PI / 2));

        // roller door on the front wall, behind where the camera starts
        const shutter = std(0xffffff, 0.45, 0.55, { map: shutterTexture() });
        (shutter.map as THREE.Texture).wrapS = THREE.RepeatWrapping;
        (shutter.map as THREE.Texture).wrapT = THREE.RepeatWrapping;
        (shutter.map as THREE.Texture).repeat.set(3, 6);
        put(new THREE.PlaneGeometry(5.2, 4.2), shutter, at(1.5, 2.1, DEPTH / 2 - 0.02, Math.PI));
        const steelDark = std(0x1d2024, 0.45, 0.7);
        box(5.6, 0.35, 0.35, steelDark, 1.5, 4.2, DEPTH / 2 - 0.2);
        box(0.18, 4.2, 0.18, steelDark, 1.5 - 2.7, 0, DEPTH / 2 - 0.12);
        box(0.18, 4.2, 0.18, steelDark, 1.5 + 2.7, 0, DEPTH / 2 - 0.12);

        // the hexagon grid over the bay, hung on four rods
        const glow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xf3f8ff, emissiveIntensity: 3, roughness: 1 });
        put(hexGrid(), glow, at(0, HEIGHT - HEX_DROP, 0));
        [-1, 1].forEach((sx) =>
            [-1, 1].forEach((sz) =>
                box(0.02, HEX_DROP, 0.02, steelDark, sx * HEX_HALF_X, HEIGHT - HEX_DROP, sz * HEX_HALF_Z)
            )
        );

        // led strips at the foot of the walls and round the top, light bars
        // down both sides (the ones the paint reflects)
        const strip = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xbfe6ff, emissiveIntensity: 2.2, roughness: 1 });
        const run = (length: number, x: number, y: number, z: number, ry: number) =>
            box(length, 0.035, 0.035, strip, x, y, z, ry);
        [0.16, HEIGHT - 0.06].forEach((y) => {
            run(WIDTH - 0.2, 0, y, -DEPTH / 2 + 0.03, 0);
            run(DEPTH - 0.2, -WIDTH / 2 + 0.03, y, 0, Math.PI / 2);
            run(DEPTH - 0.2, WIDTH / 2 - 0.03, y, 0, Math.PI / 2);
        });
        run(WIDTH - 0.2, 0, HEIGHT - 0.06, DEPTH / 2 - 0.03, 0);
        run(7.5, -5.15, 0.16, DEPTH / 2 - 0.03, 0);
        run(4.5, 6.65, 0.16, DEPTH / 2 - 0.03, 0);
        const panel = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xe8f1ff, emissiveIntensity: 2, roughness: 1 });
        [-1, 1].forEach((side) =>
            LIGHT_BARS.forEach((z) =>
                box(0.05, LIGHT_BAR_HEIGHT, 0.09, panel, side * (WIDTH / 2 - 0.04), LIGHT_BAR_FOOT, z)
            )
        );

        // tool chests in graphite with a red line round the top, posters
        const chestFront = std(0xffffff, 0.35, 0.4, { map: drawerTexture() });
        const chestBody = std(0x1b1d21, 0.3, 0.5);
        const chestTop = std(0x0f1012, 0.6, 0.2);
        const trim = std(0xc8102e, 0.35, 0.3);
        const toolChest = (x: number, z: number, ry: number, w: number) => {
            // body, drawer front, rubber top, casters
            const m = at(x, 0, z, ry);
            const part = (g: THREE.BufferGeometry, mat: THREE.Material, px: number, py: number, pz: number) =>
                put(g, mat, m.clone().multiply(at(px, py, pz)));
            part(new THREE.BoxGeometry(w, 1.05, 0.6), chestBody, 0, 0.62, 0);
            part(new THREE.PlaneGeometry(w - 0.04, 1.0), chestFront, 0, 0.62, 0.301);
            part(new THREE.BoxGeometry(w + 0.02, 0.03, 0.62), chestTop, 0, 1.16, 0);
            part(new THREE.BoxGeometry(w + 0.03, 0.02, 0.63), trim, 0, 1.13, 0);
            [-1, 1].forEach((sx) =>
                [-1, 1].forEach((sz) =>
                    part(new THREE.CylinderGeometry(0.045, 0.045, 0.04, 10), chestTop, sx * (w / 2 - 0.08), 0.05, sz * 0.22)
                )
            );
            // a top box with its own drawers
            part(new THREE.BoxGeometry(w, 0.45, 0.5), chestBody, 0, 1.4, -0.03);
            part(new THREE.PlaneGeometry(w - 0.04, 0.42), chestFront, 0, 1.4, 0.221);
        };
        toolChest(-3.4, -DEPTH / 2 + 0.45, 0, 1.6);
        toolChest(-1.6, -DEPTH / 2 + 0.45, 0, 1.2);
        toolChest(WIDTH / 2 - 0.45, 3.4, -Math.PI / 2, 1.4);

        const posters: Array<[string, string, string, string, number, number, number]> = [
            ['TURBO', 'BOOST IS LIFE', '#e0561f', '#6b1fa8', 5.2, 2.4, -DEPTH / 2 + 0.03],
            ['20.8 KM', 'NORDSCHLEIFE', '#0b7d8c', '#16171a', 6.6, 2.4, -DEPTH / 2 + 0.03],
            ['SEND IT', 'NO LIFT', '#c8102e', '#111214', 7.95, 2.4, -DEPTH / 2 + 0.03],
        ];
        posters.forEach(([title, sub, a, b, x, y, z]) => {
            const material = std(0xffffff, 0.7, 0, { map: posterTexture(title, sub, a, b) });
            put(new THREE.PlaneGeometry(1.0, 1.4), material, at(x, y, z + 0.015));
            box(1.08, 1.48, 0.02, chestTop, x, y - 0.74, z);
        });

        // the neon sign over the roller door side of the back wall
        const neon = new THREE.MeshBasicMaterial({ map: neonTexture(), transparent: true, toneMapped: false, depthWrite: false });
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), neon);
        sign.position.set(2.6, 4.3, -DEPTH / 2 + 0.06);
        sign.name = 'garage-neon';
        this.root.add(sign);
        box(6.2, 1.6, 0.04, std(0x0d0e10, 0.8), 2.6, 3.5, -DEPTH / 2 + 0.02);

        // a tyre rack on the left wall: two rails with a row of tyres each
        const rail = std(0x2a2d32, 0.4, 0.7);
        const rubber = std(0x121315, 0.9, 0);
        const rim = std(0xc9ced4, 0.25, 0.9);
        [-7.4, -4.2].forEach((z) => {
            box(0.05, 2.0, 0.05, rail, -WIDTH / 2 + 0.3, 0, z);
            box(0.05, 2.0, 0.05, rail, -WIDTH / 2 + 0.66, 0, z);
        });
        [0.5, 1.4].forEach((y) => {
            box(0.05, 0.05, 3.4, rail, -WIDTH / 2 + 0.3, y, -5.8);
            box(0.05, 0.05, 3.4, rail, -WIDTH / 2 + 0.66, y, -5.8);
            for (let k = 0; k < 4; k++) {
                const z = -7.1 + k * 0.85;
                put(new THREE.TorusGeometry(0.3, 0.11, 12, 32), rubber, at(-WIDTH / 2 + 0.48, y + 0.43, z, Math.PI / 2));
                put(new THREE.CylinderGeometry(0.22, 0.22, 0.2, 24), rim, at(-WIDTH / 2 + 0.48, y + 0.43, z, 0, 0, Math.PI / 2));
            }
        });

        // the turntable: a gloss black plate with a light ring round its edge
        const plate = std(0x0c0d0f, 0.38, 0.4);
        put(new THREE.CylinderGeometry(3.3, 3.34, 0.03, 96), plate, at(0, 0.015, 0));
        const ring = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xe8f4ff, emissiveIntensity: 2.4, roughness: 1 });
        put(new THREE.TorusGeometry(3.32, 0.016, 8, 160), ring, at(0, 0.03, 0, 0, Math.PI / 2));

        const unlit = new Set<THREE.Material>([ceiling, walls, sideWalls, glow, strip, panel, ring]);
        buckets.forEach((geometries, material) => {
            const merged = mergeGeometries(geometries);
            geometries.forEach((g) => g.dispose());
            if (!merged) return;
            const mesh = new THREE.Mesh(merged, material);
            mesh.receiveShadow = true;
            mesh.castShadow = !unlit.has(material);
            this.root.add(mesh);
        });

        // the room lights the car mostly through what it reflects (the
        // environment), so the lamps are soft: sky and floor bounce, a wide
        // key under the hexagons for the shadow, cool fills off the panels
        const hemi = new THREE.HemisphereLight(0xdde8f6, 0x1d1f23, 1);
        const key = new THREE.SpotLight(0xffffff, 55, 16, 0.95, 1, 2);
        key.position.set(0, HEIGHT - HEX_DROP - 0.1, 0.4);
        key.target.position.set(0, 0, 0);
        key.castShadow = true;
        key.shadow.mapSize.set(2048, 2048);
        key.shadow.radius = 6;
        key.shadow.bias = -0.0004;
        key.shadow.normalBias = 0.02;
        key.shadow.camera.near = 1;
        key.shadow.camera.far = 10;
        const fills = [-1, 1].map((side) => {
            const fill = new THREE.SpotLight(0xe3eeff, 35, 16, 0.8, 1, 2);
            fill.position.set(side * (WIDTH / 2 - 1), 2.6, 0);
            fill.target.position.set(0, 0.6, 0);
            return fill;
        });
        const warm = new THREE.PointLight(0xff8a3a, 8, 8, 2);
        warm.position.set(2.6, 3.6, -DEPTH / 2 + 1.2);
        this.lights = [hemi, key, ...fills, warm];
        this.root.add(hemi, key, key.target, warm);
        fills.forEach((fill) => this.root.add(fill, fill.target));
    }
}
