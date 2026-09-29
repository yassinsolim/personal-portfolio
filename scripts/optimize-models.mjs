// usage: node scripts/optimize-models.mjs [--src models-src] [--out static] [--lite] [carId|flipper ...]
// reads the original sketchfab exports from --src and writes web-ready glbs to
// --out at the same relative path, so carOptions model paths stay unchanged.
// --lite reads the web glbs instead and writes <model>.lite.glb next to them:
// the low detail race car weak gpus load (see carOptions litePath)
import fs from 'node:fs/promises';
import path from 'node:path';
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
    dedup,
    draco,
    getBounds,
    prune,
    simplifyPrimitive,
    textureCompress,
    weld,
} from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
import ts from 'typescript';

// node 20 can't import .ts files, so strip the types with the compiler the
// app already uses and import the result from a data url
const loadCarOptions = async () => {
    const source = await fs.readFile(
        new URL('../src/Application/carOptions.ts', import.meta.url),
        'utf8'
    );
    const { outputText } = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2020,
        },
    });
    const encoded = Buffer.from(outputText).toString('base64');
    const loaded = await import(`data:text/javascript;base64,${encoded}`);
    return loaded.carOptions;
};

const carOptions = await loadCarOptions();

// max geometric deviation allowed when simplifying, in real world meters
const SIMPLIFY_ERROR_METERS = 0.0003;
const TEXTURE_MAX_SIZE = 1024;

// simplification only runs on materials listed here. exterior stripes and
// decals float <1mm above the paint, so simplifying either layer lets the
// paint poke through. only list parts nothing else is layered on
const simplifyMaterialsByModel = {
    // four drilled discs are 620k of the car's 1.7M triangles
    'mercedes-gt63s-edition-one': ['Brake Disc'],
};

const extraModels = [
    {
        // self-made (scripts/blender/build-flipper.py), already low poly and baked
        id: 'flipper',
        modelPath: 'models/Props/flipper_device.glb',
        lengthMeters: 0.1003,
        simplifyAll: false,
    },
];

const args = process.argv.slice(2);
const readFlag = (flag, fallback) => {
    const index = args.indexOf(flag);
    if (index < 0) return fallback;
    const value = args[index + 1];
    args.splice(index, 2);
    return value;
};
const liteIndex = args.indexOf('--lite');
const lite = liteIndex >= 0;
if (lite) args.splice(liteIndex, 1);
const srcRoot = readFlag('--src', lite ? 'static' : 'models-src');
const outRoot = readFlag('--out', 'static');
// the lite cars are only seen from the chase camera on weak gpus: a few mm of
// error and small textures, about a fifth of the triangles
const LITE_ERROR_METERS = 0.01;
const LITE_TEXTURE_SIZE = 512;
const litePathOf = (modelPath) => modelPath.replace(/\.glb$/, '.lite.glb');

const models = [
    ...carOptions.map((car) => ({
        id: car.id,
        modelPath: car.modelPath,
        lengthMeters: car.lengthMeters,
        simplifyMaterials: simplifyMaterialsByModel[car.id] || [],
        simplifyAll: lite,
    })),
    ...(lite ? [] : extraModels),
];
const selected = args.length
    ? models.filter((model) => args.includes(model.id))
    : models;

const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
        'draco3d.decoder': await draco3d.createDecoderModule(),
        'draco3d.encoder': await draco3d.createEncoderModule(),
    });

const TRIANGLES = 4;

const countTriangles = (document) => {
    let triangles = 0;
    for (const mesh of document.getRoot().listMeshes()) {
        for (const prim of mesh.listPrimitives()) {
            if (prim.getMode() !== TRIANGLES) continue;
            const indices = prim.getIndices();
            const count = indices
                ? indices.getCount()
                : prim.getAttribute('POSITION').getCount();
            triangles += count / 3;
        }
    }
    return triangles;
};

const maxScale = (matrix) =>
    Math.max(
        Math.hypot(matrix[0], matrix[1], matrix[2]),
        Math.hypot(matrix[4], matrix[5], matrix[6]),
        Math.hypot(matrix[8], matrix[9], matrix[10])
    );

// the largest world scale among nodes sharing a mesh wins, so the error bound
// holds for every instance
const collectMeshScales = (document) => {
    const meshScales = new Map();
    for (const node of document.getRoot().listNodes()) {
        const mesh = node.getMesh();
        if (!mesh) continue;
        const scale = maxScale(node.getWorldMatrix());
        meshScales.set(mesh, Math.max(meshScales.get(mesh) || 0, scale));
    }
    return meshScales;
};

const primitiveExtent = (prim) => {
    const position = prim.getAttribute('POSITION');
    if (!position) return 0;
    const min = position.getMin([]);
    const max = position.getMax([]);
    return Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
};

// meshoptimizer's error is relative to each primitive's own extent, so convert
// one absolute budget into a per primitive relative error
const simplifyByAbsoluteError = (
    document,
    errorModelUnits,
    shouldSimplify,
    lockBorder = true
) => {
    for (const [mesh, scale] of collectMeshScales(document)) {
        const prims = mesh
            .listPrimitives()
            .filter(
                (prim) => prim.getMode() === TRIANGLES && shouldSimplify(prim)
            );
        for (const prim of prims) {
            const extent = primitiveExtent(prim);
            if (!scale || !extent) continue;
            simplifyPrimitive(prim, {
                simplifier: MeshoptSimplifier,
                ratio: 0,
                error: errorModelUnits / scale / extent,
                lockBorder,
            });
        }
    }
};

const modelLength = (document) => {
    const scene =
        document.getRoot().getDefaultScene() ||
        document.getRoot().listScenes()[0];
    const { min, max } = getBounds(scene);
    return Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
};

const formatMb = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;

await MeshoptSimplifier.ready;

for (const model of selected) {
    const input = path.join(srcRoot, model.modelPath);
    const output = path.join(
        outRoot,
        lite ? litePathOf(model.modelPath) : model.modelPath
    );
    const textureSize = lite ? LITE_TEXTURE_SIZE : TEXTURE_MAX_SIZE;
    const inputBytes = (await fs.stat(input)).size;
    const started = Date.now();

    const document = await io.read(input);
    const trianglesBefore = countTriangles(document);
    const unitsPerMeter = modelLength(document) / model.lengthMeters;

    // only textures are deduped. merging meshes would make the four wheels
    // share one geometry, and race mode animates them per corner
    await document.transform(
        dedup({ propertyTypes: [PropertyType.TEXTURE] }),
        prune({ keepLeaves: true, keepExtras: true }),
        weld()
    );
    const simplifyMaterials = new Set(model.simplifyMaterials || []);
    if (model.simplifyAll || simplifyMaterials.size) {
        simplifyByAbsoluteError(
            document,
            (lite ? LITE_ERROR_METERS : SIMPLIFY_ERROR_METERS) * unitsPerMeter,
            (prim) =>
                model.simplifyAll ||
                simplifyMaterials.has(prim.getMaterial()?.getName()),
            // car panels are open shells, locked borders keep most of them
            // untouched. the lite cars accept small seams instead
            !lite
        );
    }
    await document.transform(
        prune({ keepLeaves: true, keepExtras: true }),
        textureCompress({
            encoder: sharp,
            targetFormat: 'webp',
            resize: [textureSize, textureSize],
            slots: /^(?!normalTexture$).*/,
            quality: 85,
        }),
        textureCompress({
            encoder: sharp,
            targetFormat: 'webp',
            resize: [textureSize, textureSize],
            slots: /^normalTexture$/,
            quality: 95,
        }),
        draco({
            method: 'edgebreaker',
            quantizePosition: 16,
            quantizeNormal: 12,
            quantizeTexcoord: 14,
            quantizeColor: 8,
            quantizeGeneric: 12,
        })
    );

    const trianglesAfter = countTriangles(document);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await io.write(output, document);
    const outputBytes = (await fs.stat(output)).size;

    console.log(
        `${model.id}: ${formatMb(inputBytes)} -> ${formatMb(outputBytes)}, ` +
            `${Math.round(trianglesBefore).toLocaleString()} -> ` +
            `${Math.round(trianglesAfter).toLocaleString()} triangles ` +
            `(${((Date.now() - started) / 1000).toFixed(1)}s)`
    );
}
