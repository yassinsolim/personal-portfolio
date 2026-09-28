// usage: node scripts/build-ktx2-cars.mjs [--gltfpack path] [carId ...]
// writes <model>.ktx2.glb next to each web car glb: the same model with its
// textures as KTX2 (BasisU ETC1S, UASTC for normal maps), which stay
// compressed on the gpu. the webp glb stays as the fallback for browsers
// where the basis transcoder can't load. needs gltfpack 0.18 or newer (built
// in BasisU); webp is expanded to png first since gltfpack can't read it
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { draco, textureCompress } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
import ts from 'typescript';

const args = process.argv.slice(2);
const flag = args.indexOf('--gltfpack');
const gltfpack =
    flag >= 0
        ? args.splice(flag, 2)[1]
        : process.env.GLTFPACK || path.join(os.homedir(), 'Assets/webstrafe/tools/bin/gltfpack');

const loadCarOptions = async () => {
    const source = await fs.readFile(new URL('../src/Application/carOptions.ts', import.meta.url), 'utf8');
    const { outputText } = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
    });
    return (await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)).carOptions;
};

const cars = (await loadCarOptions()).filter((car) => !args.length || args.includes(car.id));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
});
const work = await fs.mkdtemp(path.join(os.tmpdir(), 'ktx2-cars-'));
const mb = (bytes) => `${(bytes / 1e6).toFixed(2)} MB`;

for (const car of cars) {
    const input = path.join('static', car.modelPath);
    const output = input.replace(/\.glb$/, '.ktx2.glb');
    const png = path.join(work, `${car.id}-png.glb`);
    const packed = path.join(work, `${car.id}-ktx.glb`);

    const doc = await io.read(input);
    doc.getRoot()
        .listExtensionsUsed()
        .filter((ext) => ext.extensionName === 'KHR_draco_mesh_compression')
        .forEach((ext) => ext.dispose());
    await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'png' }));
    await io.write(png, doc);

    // -kn -km -ke keep the node names (wheel rigs), materials and extras,
    // -noq leaves the geometry as it is for draco below
    execFileSync(gltfpack, ['-i', png, '-o', packed, '-tc', '-tu', 'normal', '-kn', '-km', '-ke', '-noq', '-tj', '8'], {
        stdio: 'pipe',
    });

    const result = await io.read(packed);
    await result.transform(
        draco({
            method: 'edgebreaker',
            quantizePosition: 16,
            quantizeNormal: 12,
            quantizeTexcoord: 14,
            quantizeColor: 8,
            quantizeGeneric: 12,
        })
    );
    await io.write(output, result);
    const before = (await fs.stat(input)).size;
    const after = (await fs.stat(output)).size;
    const textures = result.getRoot().listTextures().length;
    console.log(`${car.id}: ${mb(before)} webp -> ${mb(after)} ktx2 (${textures} textures)`);
}
await fs.rm(work, { recursive: true, force: true });
