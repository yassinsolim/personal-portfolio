// the garage the car is shown in while it's being modified: a tuner shop
// in the spirit of gta's customs garages. concrete floor with the bay
// painted out, block walls, a roller door, strip lights under steel beams,
// tool chests, a lift, tyre stacks and a neon sign. all of it is made here
// (boxes, cylinders and canvas textures), merged per material into a few
// draws, built once on the first visit and parked far under the track
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

// under the terrain, so nothing of the track shows through
export const GARAGE_ORIGIN = new THREE.Vector3(0, -3000, 0);
const WIDTH = 18;
const DEPTH = 16;
const HEIGHT = 6;

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

// floor: sealed concrete, oil stains and tyre marks, the bay's lines and a
// hazard band along the back
const floorTexture = () =>
    canvasTexture(2048, 2048, (ctx, w, h) => {
        const px = w / WIDTH;
        const pz = h / DEPTH;
        ctx.fillStyle = '#50555c';
        ctx.fillRect(0, 0, w, h);
        // slab seams every 3 m
        ctx.strokeStyle = 'rgba(20,22,25,0.55)';
        ctx.lineWidth = 3;
        for (let x = 3; x < WIDTH; x += 3) {
            ctx.beginPath();
            ctx.moveTo(x * px, 0);
            ctx.lineTo(x * px, h);
            ctx.stroke();
        }
        for (let z = 3; z < DEPTH; z += 3) {
            ctx.beginPath();
            ctx.moveTo(0, z * pz);
            ctx.lineTo(w, z * pz);
            ctx.stroke();
        }
        speckle(ctx, w, h, 60000, 0.12);
        // big soft patches of wear
        for (let i = 0; i < 40; i++) {
            const x = random() * w;
            const y = random() * h;
            const r = 60 + random() * 260;
            const g = ctx.createRadialGradient(x, y, 0, x, y, r);
            g.addColorStop(0, `rgba(${random() > 0.5 ? '255,255,255' : '0,0,0'},0.07)`);
            g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g;
            ctx.fillRect(x - r, y - r, r * 2, r * 2);
        }
        // oil stains
        for (let i = 0; i < 14; i++) {
            const x = (WIDTH / 2 + (random() - 0.5) * 12) * px;
            const y = (DEPTH / 2 + (random() - 0.5) * 9) * pz;
            const r = 20 + random() * 70;
            const g = ctx.createRadialGradient(x, y, 0, x, y, r);
            g.addColorStop(0, 'rgba(12,10,8,0.55)');
            g.addColorStop(0.6, 'rgba(12,10,8,0.25)');
            g.addColorStop(1, 'rgba(12,10,8,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.ellipse(x, y, r, r * (0.5 + random() * 0.5), random() * Math.PI, 0, Math.PI * 2);
            ctx.fill();
        }
        // tyre marks turning into the bay
        ctx.strokeStyle = 'rgba(10,10,10,0.18)';
        ctx.lineWidth = 16;
        for (let i = 0; i < 4; i++) {
            ctx.beginPath();
            const x = (WIDTH / 2 + (i % 2 ? 0.8 : -0.8)) * px;
            ctx.moveTo(x + (i < 2 ? 0 : 40), h);
            ctx.bezierCurveTo(x, h * 0.8, x + 30, h * 0.65, x, h * 0.45);
            ctx.stroke();
        }
        // the bay: yellow lines round the car, 3.6 x 6.4 m
        const bay = (x0: number, z0: number, x1: number, z1: number) => {
            ctx.strokeStyle = '#e8b400';
            ctx.lineWidth = 0.1 * px;
            ctx.strokeRect(x0 * px, z0 * pz, (x1 - x0) * px, (z1 - z0) * pz);
        };
        bay(WIDTH / 2 - 1.9, DEPTH / 2 - 3.3, WIDTH / 2 + 1.9, DEPTH / 2 + 3.3);
        bay(WIDTH / 2 - 7.6, DEPTH / 2 - 3.3, WIDTH / 2 - 3.8, DEPTH / 2 + 3.3);
        // hazard band along the back wall (z = 0 edge)
        const band = 0.5 * pz;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0.6 * pz, w, band);
        ctx.clip();
        ctx.fillStyle = '#e8b400';
        ctx.fillRect(0, 0.6 * pz, w, band);
        ctx.fillStyle = '#16171a';
        for (let x = -band; x < w + band; x += band * 1.2) {
            ctx.beginPath();
            ctx.moveTo(x, 0.6 * pz);
            ctx.lineTo(x + band * 0.6, 0.6 * pz);
            ctx.lineTo(x + band * 0.6 + band, 0.6 * pz + band);
            ctx.lineTo(x + band, 0.6 * pz + band);
            ctx.fill();
        }
        ctx.restore();
        // stencilled bay number
        ctx.fillStyle = 'rgba(232,180,0,0.85)';
        ctx.font = `bold ${Math.round(0.7 * pz)}px Impact, Arial Black, sans-serif`;
        ctx.textAlign = 'center';
        ctx.save();
        ctx.translate((WIDTH / 2) * px, (DEPTH / 2 + 4.1) * pz);
        ctx.fillText('BAY 01', 0, 0);
        ctx.restore();
    });

// painted blocks: dark to shoulder height, an orange stripe, grey above
const wallTexture = () =>
    canvasTexture(2048, 683, (ctx, w, h) => {
        const pm = w / WIDTH;
        const band = (y0: number, y1: number, color: string) => {
            ctx.fillStyle = color;
            ctx.fillRect(0, h - y1 * pm, w, (y1 - y0) * pm);
        };
        band(0, 1.3, '#2b2e33');
        band(1.3, 1.45, '#e0561f');
        band(1.45, HEIGHT, '#8b9199');
        // block joints, 40 x 20 cm, staggered
        ctx.strokeStyle = 'rgba(0,0,0,0.22)';
        ctx.lineWidth = 2;
        for (let row = 0; row * 0.2 < HEIGHT; row++) {
            const y = h - row * 0.2 * pm;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
            const shift = row % 2 ? 0.2 : 0;
            for (let x = shift; x < WIDTH; x += 0.4) {
                ctx.beginPath();
                ctx.moveTo(x * pm, y);
                ctx.lineTo(x * pm, y - 0.2 * pm);
                ctx.stroke();
            }
        }
        speckle(ctx, w, h, 30000, 0.1);
        // grime near the floor
        const g = ctx.createLinearGradient(0, h, 0, h - 0.8 * pm);
        g.addColorStop(0, 'rgba(0,0,0,0.45)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, h - 0.8 * pm, w, 0.8 * pm);
    });

// a roller shutter: pressed ribs every 8 cm
const shutterTexture = () =>
    canvasTexture(256, 512, (ctx, w, h) => {
        for (let y = 0; y < h; y += 16) {
            const g = ctx.createLinearGradient(0, y, 0, y + 16);
            g.addColorStop(0, '#9aa0a8');
            g.addColorStop(0.45, '#c3c8ce');
            g.addColorStop(0.55, '#6f757d');
            g.addColorStop(1, '#8a9098');
            ctx.fillStyle = g;
            ctx.fillRect(0, y, w, 16);
        }
        speckle(ctx, w, h, 4000, 0.12);
    });

// pegboard with the outlines of the tools hung on it
const pegboardTexture = () =>
    canvasTexture(1024, 512, (ctx, w, h) => {
        ctx.fillStyle = '#3b4148';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        for (let x = 12; x < w; x += 24)
            for (let y = 12; y < h; y += 24) {
                ctx.beginPath();
                ctx.arc(x, y, 3, 0, Math.PI * 2);
                ctx.fill();
            }
        const steel = (x: number, y: number, len: number, angle: number, head: number) => {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(angle);
            ctx.fillStyle = '#c9ced4';
            ctx.strokeStyle = '#6d737a';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.roundRect(-6, 0, 12, len, 5);
            ctx.fill();
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(0, 0, head, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = '#3b4148';
            ctx.beginPath();
            ctx.arc(0, -head * 0.2, head * 0.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        };
        for (let i = 0; i < 9; i++) steel(70 + i * 44, 60, 150 + i * 12, 0, 16 + i);
        // screwdrivers, red and yellow handles
        for (let i = 0; i < 6; i++) {
            const x = 520 + i * 40;
            ctx.fillStyle = i % 2 ? '#d62828' : '#f2b705';
            ctx.beginPath();
            ctx.roundRect(x - 9, 50, 18, 70, 6);
            ctx.fill();
            ctx.fillStyle = '#b8bec5';
            ctx.fillRect(x - 3, 120, 6, 90 + i * 8);
        }
        // hammers and a pry bar
        ctx.fillStyle = '#6b4a2b';
        ctx.fillRect(800, 60, 16, 200);
        ctx.fillStyle = '#2a2d31';
        ctx.fillRect(772, 50, 72, 30);
        ctx.fillStyle = '#b8bec5';
        ctx.fillRect(880, 40, 12, 260);
        // pliers
        ctx.strokeStyle = '#1f4fa8';
        ctx.lineWidth = 12;
        for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.moveTo(120 + i * 110, 320);
            ctx.lineTo(100 + i * 110, 470);
            ctx.moveTo(130 + i * 110, 320);
            ctx.lineTo(150 + i * 110, 470);
            ctx.stroke();
        }
        // a sticker row
        ctx.fillStyle = '#e0561f';
        ctx.fillRect(560, 360, 220, 60);
        ctx.fillStyle = '#16171a';
        ctx.font = 'bold 40px Impact, Arial Black, sans-serif';
        ctx.fillText('TORQUE', 590, 405);
    });

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

// the fronts of a tool chest's drawers
const drawerTexture = () =>
    canvasTexture(256, 512, (ctx, w, h) => {
        ctx.fillStyle = '#b3141c';
        ctx.fillRect(0, 0, w, h);
        const rows = [0, 50, 100, 150, 210, 280, 360, 440, 512];
        for (let i = 0; i + 1 < rows.length; i++) {
            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            ctx.fillRect(0, rows[i], w, 3);
            const g = ctx.createLinearGradient(0, rows[i] + 8, 0, rows[i] + 16);
            g.addColorStop(0, '#e6e9ec');
            g.addColorStop(1, '#8a9097');
            ctx.fillStyle = g;
            ctx.fillRect(16, rows[i] + 8, w - 32, 8);
        }
        speckle(ctx, w, h, 3000, 0.08);
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

    // the showroom reflections the paint picks up in here
    buildEnvironment(renderer: THREE.WebGLRenderer) {
        if (this.environment) return this.environment;
        const pmrem = new THREE.PMREMGenerator(renderer);
        this.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        pmrem.dispose();
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
        const floor = std(0xffffff, 0.42, 0.05, { map: floorTexture() });
        const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH, DEPTH), floor);
        floorMesh.rotation.x = -Math.PI / 2;
        floorMesh.receiveShadow = true;
        floorMesh.name = 'garage-floor';
        this.root.add(floorMesh);

        const wallMap = wallTexture();
        const walls = std(0xffffff, 0.85, 0, { map: wallMap });
        const sideMap = wallMap.clone();
        sideMap.repeat.set(DEPTH / WIDTH, 1);
        sideMap.wrapS = THREE.RepeatWrapping;
        sideMap.needsUpdate = true;
        const sideWalls = std(0xffffff, 0.85, 0, { map: sideMap });
        const wall = (w: number, material: THREE.Material, x: number, z: number, ry: number) => {
            const plane = new THREE.PlaneGeometry(w, HEIGHT);
            put(plane, material, at(x, HEIGHT / 2, z, ry));
        };
        wall(WIDTH, walls, 0, -DEPTH / 2, 0);
        wall(WIDTH, walls, 0, DEPTH / 2, Math.PI);
        wall(DEPTH, sideWalls, -WIDTH / 2, 0, Math.PI / 2);
        wall(DEPTH, sideWalls, WIDTH / 2, 0, -Math.PI / 2);
        const ceiling = std(0x1c1e22, 0.9);
        put(new THREE.PlaneGeometry(WIDTH, DEPTH), ceiling, at(0, HEIGHT, 0, 0, Math.PI / 2));

        // roller door on the front wall, behind where the camera starts
        const shutter = std(0xffffff, 0.45, 0.55, { map: shutterTexture() });
        (shutter.map as THREE.Texture).wrapS = THREE.RepeatWrapping;
        (shutter.map as THREE.Texture).wrapT = THREE.RepeatWrapping;
        (shutter.map as THREE.Texture).repeat.set(3, 6);
        put(new THREE.PlaneGeometry(5.2, 4.2), shutter, at(1.5, 2.1, DEPTH / 2 - 0.02, Math.PI));
        const steelDark = std(0x2a2d31, 0.5, 0.7);
        box(5.6, 0.35, 0.35, steelDark, 1.5, 4.2, DEPTH / 2 - 0.2);
        box(0.18, 4.2, 0.18, steelDark, 1.5 - 2.7, 0, DEPTH / 2 - 0.12);
        box(0.18, 4.2, 0.18, steelDark, 1.5 + 2.7, 0, DEPTH / 2 - 0.12);

        // steel beams across the roof and strip lights between them
        const beam = std(0x3a3f46, 0.55, 0.6);
        for (let z = -6; z <= 6; z += 3) {
            box(WIDTH, 0.35, 0.16, beam, 0, HEIGHT - 0.35, z);
            box(WIDTH, 0.03, 0.34, beam, 0, HEIGHT - 0.38, z);
        }
        const tube = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xf4f8ff, emissiveIntensity: 3.2, roughness: 1 });
        const housing = std(0x9ea4ab, 0.5, 0.4);
        for (let x = -6; x <= 6; x += 3) {
            for (let z = -4.5; z <= 4.5; z += 3) {
                box(2.4, 0.06, 0.2, housing, x, HEIGHT - 0.95, z);
                box(2.3, 0.03, 0.12, tube, x, HEIGHT - 0.98, z);
                // hanging wires
                box(0.01, 0.55, 0.01, beam, x - 1.1, HEIGHT - 0.9, z);
                box(0.01, 0.55, 0.01, beam, x + 1.1, HEIGHT - 0.9, z);
            }
        }

        // high windows on the left wall, bright with daylight
        const daylight = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xcfe3ff, emissiveIntensity: 1.6, roughness: 1 });
        const frame = std(0x2a2d31, 0.6, 0.5);
        for (let z = -5; z <= 5; z += 3.4) {
            put(new THREE.PlaneGeometry(2.4, 0.9), daylight, at(-WIDTH / 2 + 0.02, 4.6, z, Math.PI / 2));
            box(0.08, 0.06, 2.5, frame, -WIDTH / 2 + 0.04, 4.12, z);
            box(0.08, 0.06, 2.5, frame, -WIDTH / 2 + 0.04, 5.02, z);
            box(0.08, 0.9, 0.05, frame, -WIDTH / 2 + 0.04, 4.15, z);
        }

        // back wall: pegboard over a long workbench, tool chests, posters
        const peg = std(0xffffff, 0.8, 0.1, { map: pegboardTexture() });
        put(new THREE.PlaneGeometry(5, 2.5), peg, at(-3.2, 2.55, -DEPTH / 2 + 0.03));
        const benchTop = std(0x6e5234, 0.7, 0);
        const benchSteel = std(0x23262a, 0.45, 0.7);
        box(5.2, 0.06, 0.8, benchTop, -3.2, 0.92, -DEPTH / 2 + 0.45);
        box(5.2, 0.04, 0.7, benchSteel, -3.2, 0.25, -DEPTH / 2 + 0.45);
        [-5.7, -3.2, -0.7].forEach((x) => {
            box(0.06, 0.92, 0.06, benchSteel, x, 0, -DEPTH / 2 + 0.1);
            box(0.06, 0.92, 0.06, benchSteel, x, 0, -DEPTH / 2 + 0.8);
        });
        // a vise and a few things on the bench
        box(0.2, 0.14, 0.3, benchSteel, -5.2, 0.98, -DEPTH / 2 + 0.55);
        box(0.12, 0.08, 0.34, std(0x1f4fa8, 0.4, 0.3), -5.2, 1.12, -DEPTH / 2 + 0.55);
        box(0.35, 0.25, 0.25, std(0xd62828, 0.4, 0.2), -2.2, 0.98, -DEPTH / 2 + 0.4);
        box(0.5, 0.18, 0.3, std(0x2a2d31, 0.6, 0.3), -1.3, 0.98, -DEPTH / 2 + 0.45);

        const chestFront = std(0xffffff, 0.32, 0.35, { map: drawerTexture() });
        const chestRed = std(0xb3141c, 0.32, 0.35);
        const chestTop = std(0x151618, 0.6, 0.2);
        const toolChest = (x: number, z: number, ry: number, w: number) => {
            // body, drawer front, rubber top, casters
            const m = at(x, 0, z, ry);
            const part = (g: THREE.BufferGeometry, mat: THREE.Material, px: number, py: number, pz: number) =>
                put(g, mat, m.clone().multiply(at(px, py, pz)));
            part(new THREE.BoxGeometry(w, 1.05, 0.6), chestRed, 0, 0.62, 0);
            part(new THREE.PlaneGeometry(w - 0.04, 1.0), chestFront, 0, 0.62, 0.301);
            part(new THREE.BoxGeometry(w + 0.02, 0.03, 0.62), chestTop, 0, 1.16, 0);
            [-1, 1].forEach((sx) =>
                [-1, 1].forEach((sz) =>
                    part(new THREE.CylinderGeometry(0.045, 0.045, 0.04, 10), chestTop, sx * (w / 2 - 0.08), 0.05, sz * 0.22)
                )
            );
            // a top box with its own drawers
            part(new THREE.BoxGeometry(w, 0.45, 0.5), chestRed, 0, 1.4, -0.03);
            part(new THREE.PlaneGeometry(w - 0.04, 0.42), chestFront, 0, 1.4, 0.221);
        };
        toolChest(1.6, -DEPTH / 2 + 0.45, 0, 1.4);
        toolChest(3.2, -DEPTH / 2 + 0.45, 0, 1.0);
        toolChest(WIDTH / 2 - 0.45, 3.4, -Math.PI / 2, 1.4);

        const posters: Array<[string, string, string, string, number, number, number]> = [
            ['TURBO', 'BOOST IS LIFE', '#e0561f', '#6b1fa8', 5.2, 2.4, -DEPTH / 2 + 0.03],
            ['20.8 KM', 'NORDSCHLEIFE', '#0b7d8c', '#16171a', 6.6, 2.4, -DEPTH / 2 + 0.03],
            ['SEND IT', 'NO LIFT', '#c8102e', '#111214', 7.95, 2.4, -DEPTH / 2 + 0.03],
        ];
        posters.forEach(([title, sub, a, b, x, y, z]) => {
            const material = std(0xffffff, 0.7, 0, { map: posterTexture(title, sub, a, b) });
            put(new THREE.PlaneGeometry(1.0, 1.4), material, at(x, y, z));
        });

        // the neon sign over the roller door side of the back wall
        const neon = new THREE.MeshBasicMaterial({ map: neonTexture(), transparent: true, toneMapped: false, depthWrite: false });
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), neon);
        sign.position.set(2.6, 4.3, -DEPTH / 2 + 0.06);
        sign.name = 'garage-neon';
        this.root.add(sign);
        box(6.2, 1.6, 0.04, std(0x0d0e10, 0.8), 2.6, 3.5, -DEPTH / 2 + 0.02);

        // the lift in the second bay, arms down
        const liftBlue = std(0x1f4fa8, 0.35, 0.4);
        const liftSteel = std(0x8a9097, 0.4, 0.8);
        [-1, 1].forEach((side) => {
            const x = -5.7 + side * 2.2;
            box(0.32, 3.8, 0.32, liftBlue, x, 0, 0);
            box(0.5, 0.04, 0.6, liftSteel, x, 0, 0);
            box(0.14, 0.1, 1.4, liftSteel, x - side * 0.6, 0.12, 0.6, side * 0.5);
            box(0.14, 0.1, 1.4, liftSteel, x - side * 0.6, 0.12, -0.6, -side * 0.5);
        });
        box(4.7, 0.18, 0.2, liftBlue, -5.7, 3.8, 0);

        // tyre stacks
        const rubber = std(0x141416, 0.92, 0);
        const rim = std(0xb7bcc2, 0.3, 0.9);
        const tyreStack = (x: number, z: number, n: number) => {
            for (let i = 0; i < n; i++) {
                const t = new THREE.TorusGeometry(0.27, 0.11, 10, 28);
                put(t, rubber, at(x + (random() - 0.5) * 0.04, 0.11 + i * 0.22, z + (random() - 0.5) * 0.04, 0, Math.PI / 2));
            }
        };
        tyreStack(WIDTH / 2 - 0.6, -DEPTH / 2 + 0.7, 5);
        tyreStack(WIDTH / 2 - 1.4, -DEPTH / 2 + 0.7, 4);
        tyreStack(WIDTH / 2 - 0.6, -DEPTH / 2 + 1.5, 3);
        tyreStack(-WIDTH / 2 + 0.7, DEPTH / 2 - 1.0, 4);
        // a wheel leaning on the stack
        put(new THREE.TorusGeometry(0.28, 0.1, 10, 28), rubber, at(WIDTH / 2 - 1.5, 0.39, -DEPTH / 2 + 1.5, 0.4));
        put(new THREE.CylinderGeometry(0.22, 0.22, 0.2, 20), rim, at(WIDTH / 2 - 1.5, 0.39, -DEPTH / 2 + 1.5, 0.4, 0, Math.PI / 2));

        // drums, a compressor, cones and a jack
        const drum = (x: number, z: number, color: number) => {
            const mat = std(color, 0.45, 0.35);
            put(new THREE.CylinderGeometry(0.29, 0.29, 0.88, 22), mat, at(x, 0.44, z));
            [0.18, 0.7].forEach((y) =>
                put(new THREE.TorusGeometry(0.29, 0.012, 6, 22), mat, at(x, y, z, 0, Math.PI / 2))
            );
        };
        drum(-WIDTH / 2 + 0.5, -DEPTH / 2 + 0.5, 0x1f4fa8);
        drum(-WIDTH / 2 + 1.15, -DEPTH / 2 + 0.5, 0xc8102e);
        drum(-WIDTH / 2 + 0.5, -DEPTH / 2 + 1.15, 0x2e8b3d);
        const compressorRed = std(0xc8102e, 0.4, 0.3);
        put(new THREE.CylinderGeometry(0.3, 0.3, 1.2, 20), compressorRed, at(WIDTH / 2 - 0.5, 0.45, 1.2, 0, Math.PI / 2));
        box(0.4, 0.3, 0.35, std(0x2a2d31, 0.5, 0.5), WIDTH / 2 - 0.5, 0.75, 1.0);
        const coneOrange = std(0xff5a1f, 0.6, 0);
        const coneWhite = std(0xf0f0f0, 0.5, 0);
        [[4.2, 5.8], [4.9, 6.4], [-3.4, 6.1]].forEach(([x, z]) => {
            box(0.36, 0.03, 0.36, coneOrange, x, 0, z);
            put(new THREE.ConeGeometry(0.15, 0.62, 16), coneOrange, at(x, 0.34, z));
            put(new THREE.CylinderGeometry(0.083, 0.1, 0.08, 16), coneWhite, at(x, 0.36, z));
        });
        const jackRed = std(0xd62828, 0.4, 0.3);
        box(0.35, 0.15, 0.8, jackRed, 3.4, 0, 3.8, 0.4);
        box(0.04, 0.04, 1.1, liftSteel, 3.6, 0.5, 4.5, 0.4);

        // shelving along the right wall with boxes and bottles
        const shelfSteel = std(0x4a5058, 0.5, 0.6);
        const cardboard = std(0xa47b4a, 0.9, 0);
        for (let i = 0; i < 4; i++) {
            box(0.5, 0.03, 2.4, shelfSteel, WIDTH / 2 - 0.3, 0.3 + i * 0.6, -3.2);
        }
        [-4.4, -2.0].forEach((z) => {
            box(0.04, 2.3, 0.04, shelfSteel, WIDTH / 2 - 0.08, 0, z);
            box(0.04, 2.3, 0.04, shelfSteel, WIDTH / 2 - 0.52, 0, z);
        });
        for (let i = 0; i < 3; i++) {
            for (let k = 0; k < 4; k++) {
                if (random() < 0.3) continue;
                const s = 0.25 + random() * 0.15;
                box(0.4, s, s + 0.1, cardboard, WIDTH / 2 - 0.3, 0.33 + i * 0.6, -4.2 + k * 0.6);
            }
        }
        const bottles = [0xf2b705, 0x1f4fa8, 0xc8102e, 0x2e8b3d];
        for (let k = 0; k < 8; k++) {
            put(
                new THREE.CylinderGeometry(0.05, 0.05, 0.26, 10),
                std(bottles[k % 4], 0.4, 0.1),
                at(WIDTH / 2 - 0.3, 0.33 + 1.8 + 0.13, -4.2 + k * 0.28)
            );
        }

        // a stool by the bench
        box(0.36, 0.05, 0.36, std(0x1a1b1e, 0.6, 0.2), -1.8, 0.62, -DEPTH / 2 + 1.4);
        put(new THREE.CylinderGeometry(0.03, 0.03, 0.62, 8), liftSteel, at(-1.8, 0.31, -DEPTH / 2 + 1.4));

        // a turntable plate under the car, brushed steel, a step off the floor
        const plate = std(0x3a3d42, 0.55, 0.6);
        put(new THREE.CylinderGeometry(3.3, 3.34, 0.03, 64), plate, at(0, 0.015, 0));
        put(new THREE.TorusGeometry(3.3, 0.02, 6, 64), std(0xe8b400, 0.4, 0.2), at(0, 0.03, 0, 0, Math.PI / 2));

        buckets.forEach((geometries, material) => {
            const merged = mergeGeometries(geometries);
            geometries.forEach((g) => g.dispose());
            if (!merged) return;
            const mesh = new THREE.Mesh(merged, material);
            mesh.receiveShadow = true;
            mesh.castShadow = material !== ceiling && material !== walls && material !== sideWalls;
            this.root.add(mesh);
        });

        // light: strips overhead (a hemisphere for their spill), a key spot on
        // the bay that casts the car's shadow, warm fill from the neon side
        const hemi = new THREE.HemisphereLight(0xe8eef8, 0x3c3934, 0.85);
        const key = new THREE.SpotLight(0xffffff, 130, 20, 0.75, 0.7, 2);
        key.position.set(0.8, HEIGHT - 0.4, 1.2);
        key.target.position.set(0, 0, 0);
        key.castShadow = true;
        key.shadow.mapSize.set(2048, 2048);
        key.shadow.bias = -0.0004;
        key.shadow.normalBias = 0.02;
        key.shadow.camera.near = 1;
        key.shadow.camera.far = 12;
        const rimLight = new THREE.SpotLight(0xcfe3ff, 90, 20, 0.8, 0.8, 2);
        rimLight.position.set(-4, HEIGHT - 0.6, -3);
        rimLight.target.position.set(0, 0.5, 0);
        const warm = new THREE.PointLight(0xff8a3a, 18, 12, 2);
        warm.position.set(2.6, 3.6, -DEPTH / 2 + 1.2);
        const cool = new THREE.PointLight(0x5ad8ff, 10, 10, 2);
        cool.position.set(5, 3.6, -DEPTH / 2 + 1.2);
        this.lights = [hemi, key, rimLight, warm, cool];
        this.root.add(hemi, key, key.target, rimLight, rimLight.target, warm, cool);
    }
}
