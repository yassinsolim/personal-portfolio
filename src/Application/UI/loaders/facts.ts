import * as THREE from 'three';
import { DRACO_GLTF_CONFIG } from 'three/examples/jsm/loaders/DRACOLoader.js';
import Application from '../../Application';
import { assetSize } from '../../Utils/assetUrl';

// what a loaded source actually contains, read off the parsed resource, for
// the loading screens' lines

// webpack gives the draco decoder hashed names, say what they are
const KNOWN_FILES = new Map<string, string>([
    [DRACO_GLTF_CONFIG.js, 'draco_wasm_wrapper.js (draco decoder)'],
    [DRACO_GLTF_CONFIG.wasm, 'draco_decoder.wasm (draco decoder)'],
]);

export const fileLabel = (url: string) => {
    const known = KNOWN_FILES.get(url);
    if (known) return known;
    const name = baseName(url) || url;
    // the monitor's static videos, linked from index.html
    return /\.mp4$/i.test(name) ? `${name} (video in index.html)` : name;
};

export const baseName = (url: string) => {
    const clean = url.split(/[?#]/)[0];
    try {
        return decodeURIComponent(clean.split('/').pop() || clean);
    } catch {
        return clean.split('/').pop() || clean;
    }
};

// the file a source line names: the one file, or the folder for a cube map
export const sourceLabel = (source: Resource) => {
    if (Array.isArray(source.path)) {
        const parts = source.path[0].split('/');
        return `${parts[parts.length - 2] || source.name}/ (${source.path.length} faces)`;
    }
    return baseName(source.path);
};

// the source's size from the build (a car counts its ktx2 twin when that's
// what loads), 0 when the build didn't record it
export const sourceSize = (source: Resource) => {
    if (Array.isArray(source.path)) return source.path.reduce((sum, face) => sum + assetSize(face), 0);
    if (source.type === 'gltfModel') {
        return assetSize(source.path.replace(/\.glb$/, '.ktx2.glb')) || assetSize(source.path);
    }
    return assetSize(source.path);
};

const count = (value: number) => value.toLocaleString('en-US');

export const modelFacts = (group: THREE.Object3D) => {
    let meshes = 0;
    let triangles = 0;
    let vertices = 0;
    group.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry || mesh.userData.pipelineIntroPart) return;
        meshes++;
        const position = mesh.geometry.getAttribute('position');
        const index = mesh.geometry.getIndex();
        vertices += position ? position.count : 0;
        triangles += Math.floor((index ? index.count : position ? position.count : 0) / 3);
    });
    return { meshes, triangles, vertices };
};

export const sourceFacts = (source: Resource): string => {
    const items = new Application().resources.items;
    if (source.type === 'gltfModel') {
        const gltf = items.gltfModel[source.name];
        if (!gltf) return '';
        const facts = modelFacts(gltf.scene);
        return `${count(facts.meshes)} meshes, ${count(facts.triangles)} triangles`;
    }
    if (source.type === 'texture') {
        const image = items.texture[source.name]?.image as
            | { width?: number; height?: number }
            | undefined;
        return image?.width ? `${image.width}x${image.height}` : '';
    }
    if (source.type === 'cubeTexture') {
        const images = items.cubeTexture[source.name]?.image as
            | { width?: number; height?: number }[]
            | undefined;
        const face = images?.[0];
        return face?.width ? `6 x ${face.width}x${face.height}` : '';
    }
    if (source.type === 'json') {
        const data = items.json[source.name] as
            | { name?: string; length?: number; points?: unknown[] }
            | undefined;
        if (!data) return '';
        const parts = [
            data.name,
            data.length ? `${(data.length / 1000).toFixed(2)} km` : '',
            data.points ? `${count(data.points.length)} points` : '',
        ].filter(Boolean);
        return parts.join(', ');
    }
    return '';
};
