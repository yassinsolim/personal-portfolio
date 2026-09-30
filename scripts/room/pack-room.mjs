// usage: node scripts/room/pack-room.mjs [--in ~/Assets/portfolio-room/v2/export] [--out static/models/Room]
//   [--webp-quality 88] [--ktx-quality 10] [--gltfpack path]
// packs the raw room glbs from scripts/room/export.py for the site, per tier:
//   room_v2[.low].glb       draco geometry, webp atlases
//   room_v2[.low].ktx2.glb  the same with ktx2 (basisu etc1s) atlases through gltfpack, then draco
// the baked materials, the leds and the screens get KHR_materials_unlit (the site draws them with
// MeshBasicMaterial anyway), normals are dropped everywhere except the glass, the glass blends.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRMaterialsUnlit } from '@gltf-transform/extensions';
import { draco, textureCompress } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : fallback;
};
const inDir = path.resolve(opt('--in', path.join(os.homedir(), 'Assets/portfolio-room/v2/export')));
const outDir = path.resolve(opt('--out', 'static/models/Room'));
const webpQuality = Number(opt('--webp-quality', 88));
const ktxQuality = String(opt('--ktx-quality', 10));
const ktxMode = opt('--ktx-mode', 'etc1s');
const gltfpack = opt('--gltfpack', process.env.GLTFPACK || path.join(os.homedir(), 'Assets/webstrafe/tools/bin/gltfpack'));

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
});
const dracoOptions = {
    method: 'edgebreaker',
    quantizePosition: 16,
    quantizeNormal: 12,
    quantizeTexcoord: 14,
    quantizeColor: 8,
    quantizeGeneric: 12,
};
const UNLIT = /^(bake_(setup|pc|shell)|led|screen)$/;

function prepare(doc) {
    const unlit = doc.createExtension(KHRMaterialsUnlit);
    for (const mat of doc.getRoot().listMaterials()) {
        const name = mat.getName();
        if (UNLIT.test(name)) {
            mat.setExtension('KHR_materials_unlit', unlit.createUnlit());
            mat.setMetallicFactor(0).setRoughnessFactor(1);
        }
        if (name === 'glass') mat.setAlphaMode('BLEND').setDoubleSided(true);
    }
    for (const mesh of doc.getRoot().listMeshes()) {
        for (const prim of mesh.listPrimitives()) {
            const mat = prim.getMaterial();
            if (mat && mat.getName() !== 'glass') {
                const normal = prim.getAttribute('NORMAL');
                if (normal) prim.setAttribute('NORMAL', null);
            }
            // only the atlas uvs are used; the screens keep theirs for the site
            if (!mat || /^(led|glass)$/.test(mat.getName())) prim.setAttribute('TEXCOORD_0', null);
        }
    }
    // drop the accessors that were only used by the removed attributes
    for (const acc of doc.getRoot().listAccessors()) {
        if (acc.listParents().every((p) => p.propertyType === 'Root')) acc.dispose();
    }
    return doc;
}

const kb = (b) => `${(b / 1e3).toFixed(0)} KB`;
await fs.mkdir(outDir, { recursive: true });
const work = await fs.mkdtemp(path.join(os.tmpdir(), 'room-pack-'));
for (const tier of ['', '.low']) {
    const raw = path.join(inDir, `room_v2${tier}.raw.glb`);
    try {
        await fs.access(raw);
    } catch {
        console.log(`skip ${raw} (not exported)`);
        continue;
    }
    // webp twin
    const doc = prepare(await io.read(raw));
    await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', quality: webpQuality }), draco(dracoOptions));
    const webpOut = path.join(outDir, `room_v2${tier}.glb`);
    await io.write(webpOut, doc);

    // ktx2 twin: png in, gltfpack to basisu etc1s (named nodes, materials, extras and attributes
    // kept, geometry left for draco), then draco
    const png = path.join(work, `room${tier}-png.glb`);
    const packed = path.join(work, `room${tier}-ktx.glb`);
    const pdoc = prepare(await io.read(raw));
    await io.write(png, pdoc);
    // -kv keeps the screens' uvs (their material has no texture, so gltfpack would drop them)
    const mode = ktxMode === 'uastc' ? ['-tc', '-tu'] : ['-tc'];
    execFileSync(gltfpack, ['-i', png, '-o', packed, ...mode, '-tq', ktxQuality, '-kn', '-km', '-ke', '-kv', '-noq', '-tj', '8'], { stdio: 'pipe' });
    const kdoc = await io.read(packed);
    await kdoc.transform(draco(dracoOptions));
    const ktxOut = path.join(outDir, `room_v2${tier}.ktx2.glb`);
    await io.write(ktxOut, kdoc);
    const a = (await fs.stat(webpOut)).size;
    const b = (await fs.stat(ktxOut)).size;
    console.log(`room_v2${tier}: ${kb(a)} webp, ${kb(b)} ktx2`);
}
await fs.rm(work, { recursive: true, force: true });
