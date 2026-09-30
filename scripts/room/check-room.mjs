// room v2 budget and layout check.
//   node scripts/room/check-room.mjs [--json] [file.glb ...]
// defaults to the four exports in static/models/Room. per file: triangles,
// draws (mesh x material), texture and geometry bytes, gpu memory estimate,
// the node and material names, each top level node's box (against the car's),
// and the three screens' corners and uvs read back from the glb next to the
// ones setup.json asks for. exits 1 when a tier file is over budget or a
// screen corner is off by more than 0.5 site units.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const files = args.filter((a) => !a.startsWith('--'));
if (!files.length) {
    for (const name of ['room_v2.glb', 'room_v2.ktx2.glb', 'room_v2.low.glb', 'room_v2.low.ktx2.glb']) {
        files.push(path.join(repo, 'static/models/Room', name));
    }
}

const setup = JSON.parse(await fs.readFile(path.join(here, 'setup.json'), 'utf8'));
const BUDGET = {
    high: { tris: 60000, draws: 30, textures: 2.0e6, geometry: 400e3 },
    low: { tris: 30000, draws: 18, textures: 0.6e6, geometry: 250e3 },
};
const U = setup.units.per_metre;
const FY = setup.units.floor_y;
const toThree = ([x, y, z]) => [x * U, FY + y * U, z * U];
const rad = (d) => (d * Math.PI) / 180;

function expectedCorners(name) {
    const e = setup.screens[name];
    const [aw, ah] = setup.screens.active;
    const [w, h] = e.portrait ? [ah, aw] : [aw, ah];
    const a = rad(e.yaw || 0);
    const t = rad(e.tilt || 0);
    const right = [Math.cos(a), 0, -Math.sin(a)];
    const up = [Math.sin(t) * Math.sin(a), Math.cos(t), Math.sin(t) * Math.cos(a)];
    const c = e.center;
    const corner = (su, sv) => toThree(c.map((v, i) => v + right[i] * su * (w / 2) + up[i] * sv * (h / 2)));
    // keyed by the uv the corner should carry (u right, v up)
    return { '0,0': corner(-1, -1), '1,0': corner(1, -1), '1,1': corner(1, 1), '0,1': corner(-1, 1) };
}

function readGlbJson(buf) {
    const len = buf.readUInt32LE(12);
    return JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
}

function ktx2Info(bytes) {
    // KTX2 header: identifier(12) vkFormat(4) typeSize(4) w(4) h(4) d(4) layers(4) faces(4) levels(4) supercompression(4)
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = dv.getUint32(20, true);
    const height = dv.getUint32(24, true);
    const levels = dv.getUint32(40, true);
    const scheme = dv.getUint32(44, true);
    const dfdOffset = dv.getUint32(48, true);
    const colorModel = bytes[dfdOffset + 12];
    const channels = [];
    const blockSize = dv.getUint16(dfdOffset + 10, true);
    for (let i = 0; i < (blockSize - 24) / 16 && i < 4; i++) channels.push(bytes[dfdOffset + 31 + 16 * i] & 0x0f);
    return { width, height, levels, scheme, colorModel, channels };
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
});

let failed = false;
const results = [];
for (const file of files) {
    const buf = await fs.readFile(file);
    const json = readGlbJson(buf);
    const tier = /\.low\./.test(path.basename(file)) ? 'low' : 'high';
    const isTier = !/greybox/.test(path.basename(file));
    const imageViews = new Set((json.images || []).filter((i) => i.bufferView !== undefined).map((i) => i.bufferView));
    let textures = 0;
    let geometry = 0;
    (json.bufferViews || []).forEach((v, i) => {
        if (imageViews.has(i)) textures += v.byteLength;
        else geometry += v.byteLength;
    });
    let gpu = 0;
    let gpuRgba = 0;
    const images = [];
    (json.images || []).forEach((img) => {
        if (img.bufferView === undefined) return;
        const v = json.bufferViews[img.bufferView];
        const bytes = buf.subarray(20 + buf.readUInt32LE(12) + 8 + (v.byteOffset || 0), 20 + buf.readUInt32LE(12) + 8 + (v.byteOffset || 0) + v.byteLength);
        if (img.mimeType === 'image/ktx2') {
            const k = ktx2Info(bytes);
            const etc1s = k.colorModel === 163;
            const opaque = etc1s && k.channels.length <= 1;
            const bpp = etc1s && opaque ? 0.5 : 1;
            const mem = k.width * k.height * bpp * (k.levels > 1 ? 4 / 3 : 1);
            gpu += mem;
            images.push({ mime: img.mimeType, size: `${k.width}x${k.height}`, levels: k.levels, codec: etc1s ? 'etc1s' : 'uastc', bytes: v.byteLength, gpuMB: +(mem / 1e6).toFixed(1) });
        } else {
            images.push({ mime: img.mimeType, bytes: v.byteLength });
        }
    });

    const doc = await io.readBinary(new Uint8Array(buf));
    const root = doc.getRoot();
    // dims of non ktx2 images (webp/png) through the decoded document
    for (const tex of root.listTextures()) {
        const size = tex.getSize();
        if (tex.getMimeType() !== 'image/ktx2' && size) {
            const mem = size[0] * size[1] * 4 * (4 / 3);
            gpuRgba += mem;
            const entry = images.find((i) => i.mime === tex.getMimeType() && !i.size && i.bytes === tex.getImage().byteLength);
            if (entry) Object.assign(entry, { size: `${size[0]}x${size[1]}`, gpuMB: +(mem / 1e6).toFixed(1) });
        }
    }
    const scene = root.getDefaultScene() || root.listScenes()[0];
    let tris = 0;
    let draws = 0;
    const nodes = [];
    const boxes = {};
    const empties = {};
    let minY = Infinity;
    const screens = {};
    const walk = (node, depth, top) => {
        const mesh = node.getMesh();
        const entry = { name: node.getName(), depth, mesh: mesh ? mesh.getName() : null, materials: [], tris: 0 };
        if (mesh) {
            const m = node.getWorldMatrix();
            for (const prim of mesh.listPrimitives()) {
                draws += 1;
                const idx = prim.getIndices();
                const pos = prim.getAttribute('POSITION');
                const t = (idx ? idx.getCount() : pos.getCount()) / 3;
                entry.tris += t;
                tris += t;
                entry.materials.push(prim.getMaterial() ? prim.getMaterial().getName() : null);
                const arr = pos.getArray();
                const box = boxes[top] || (boxes[top] = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
                for (let i = 0; i < arr.length; i += 3) {
                    const p = [0, 1, 2].map((r) => m[r] * arr[i] + m[4 + r] * arr[i + 1] + m[8 + r] * arr[i + 2] + m[12 + r]);
                    for (let k = 0; k < 3; k++) {
                        box.min[k] = Math.min(box.min[k], p[k]);
                        box.max[k] = Math.max(box.max[k], p[k]);
                    }
                    if (top !== 'room_shell') minY = Math.min(minY, p[1]);
                }
                if (/^m[123]_screen$/.test(node.getName())) {
                    const uv = prim.getAttribute('TEXCOORD_0');
                    const uvs = uv ? uv.getArray() : null;
                    const corners = {};
                    for (let i = 0; i < pos.getCount(); i++) {
                        const p = [0, 1, 2].map((r) => m[r] * arr[3 * i] + m[4 + r] * arr[3 * i + 1] + m[8 + r] * arr[3 * i + 2] + m[12 + r]);
                        const key = uvs ? `${Math.round(uvs[2 * i])},${Math.round(uvs[2 * i + 1])}` : String(i);
                        corners[key] = p;
                    }
                    screens[node.getName()] = corners;
                }
            }
        } else {
            empties[node.getName()] = { at: node.getWorldTranslation().map((v) => +v.toFixed(2)), rotation: node.getRotation().map((v) => +v.toFixed(4)) };
        }
        nodes.push(entry);
        for (const child of node.listChildren()) walk(child, depth + 1, top);
    };
    for (const node of scene.listChildren()) walk(node, 0, node.getName());

    const car = setup.car_box_three;
    const overlaps = Object.entries(boxes)
        .filter(([name]) => name !== 'room_shell')
        .filter(([, b]) => b.min.every((v, k) => v < car.max[k]) && b.max.every((v, k) => v > car.min[k]))
        .map(([name]) => name);

    let maxErr = 0;
    const screenReport = {};
    for (const name of ['m1', 'm2', 'm3']) {
        const got = screens[`${name}_screen`];
        const want = expectedCorners(name);
        const rows = {};
        for (const key of Object.keys(want)) {
            const g = got ? got[key] : null;
            const err = g ? Math.hypot(...g.map((v, k) => v - want[key][k])) : Infinity;
            maxErr = Math.max(maxErr, err);
            rows[`uv ${key}`] = { glb: g ? g.map((v) => +v.toFixed(2)) : null, setup: want[key].map((v) => +v.toFixed(2)), err: +err.toFixed(3) };
        }
        screenReport[name] = rows;
    }

    const budget = BUDGET[tier];
    const checks = isTier
        ? {
              tris: [tris, budget.tris],
              draws: [draws, budget.draws],
              textures: [textures, budget.textures],
              geometry: [geometry, budget.geometry],
          }
        : {};
    const over = Object.entries(checks).filter(([, [v, lim]]) => v > lim).map(([k]) => k);
    if (over.length || maxErr > 0.5 || overlaps.length) failed = true;
    const result = {
        file: path.relative(process.cwd(), file),
        tier,
        bytes: buf.length,
        tris,
        draws,
        textures,
        geometry,
        gpuMB: { ktx2: +(gpu / 1e6).toFixed(1), rgba: +(gpuRgba / 1e6).toFixed(1) },
        images,
        over,
        carOverlaps: overlaps,
        minYNonShell: +minY.toFixed(2),
        screenMaxErr: +maxErr.toFixed(3),
        nodes: nodes.map((n) => `${'  '.repeat(n.depth)}${n.name}${n.mesh ? ` [mesh ${n.mesh}, ${n.tris} tris, ${n.materials.join(', ')}]` : ' [empty]'}`),
        empties,
        screens: screenReport,
        boxes: Object.fromEntries(Object.entries(boxes).map(([k, b]) => [k, { min: b.min.map((v) => Math.round(v)), max: b.max.map((v) => Math.round(v)) }])),
    };
    results.push(result);
}

if (asJson) {
    console.log(JSON.stringify(results, null, 1));
} else {
    const kb = (b) => `${(b / 1e3).toFixed(0)} KB`;
    for (const r of results) {
        console.log(`\n${r.file} (${r.tier}) ${kb(r.bytes)}`);
        console.log(`  triangles ${r.tris}, draws ${r.draws}, textures ${kb(r.textures)}, geometry ${kb(r.geometry)}, gpu ${r.gpuMB.ktx2 || r.gpuMB.rgba} MB`);
        if (r.over.length) console.log(`  OVER BUDGET: ${r.over.join(', ')}`);
        if (r.carOverlaps.length) console.log(`  INSIDE THE CAR BOX: ${r.carOverlaps.join(', ')}`);
        console.log(`  lowest non shell vertex y ${r.minYNonShell}, screen corner max error ${r.screenMaxErr}`);
        for (const img of r.images) console.log(`  image ${img.mime} ${img.size || ''} ${img.codec || ''} ${kb(img.bytes)} gpu ${img.gpuMB ?? '?'} MB`);
        console.log('  nodes:');
        for (const n of r.nodes) console.log(`    ${n}`);
        for (const [name, e] of Object.entries(r.empties)) console.log(`  empty ${name} at ${e.at.join(', ')} rot ${e.rotation.join(', ')}`);
        for (const [name, rows] of Object.entries(r.screens)) {
            for (const [key, row] of Object.entries(rows)) console.log(`  ${name} ${key}: glb ${row.glb} setup ${row.setup} err ${row.err}`);
        }
    }
}
process.exit(failed ? 1 : 0);
