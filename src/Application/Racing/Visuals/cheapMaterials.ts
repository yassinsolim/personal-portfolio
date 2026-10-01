import * as THREE from 'three';

// on a weak gpu the road, verges, armco and boards don't need pbr: a lambert
// copy keeps the colors and textures and costs a fraction per pixel
const toLambert = (source: THREE.MeshStandardMaterial) => {
    const material = new THREE.MeshLambertMaterial({
        name: source.name,
        color: source.color,
        map: source.map,
        emissive: source.emissive,
        emissiveMap: source.emissiveMap,
        emissiveIntensity: source.emissiveIntensity,
        vertexColors: source.vertexColors,
        side: source.side,
        transparent: source.transparent,
        opacity: source.opacity,
        alphaTest: source.alphaTest,
        depthWrite: source.depthWrite,
        polygonOffset: source.polygonOffset,
        polygonOffsetFactor: source.polygonOffsetFactor,
        polygonOffsetUnits: source.polygonOffsetUnits,
    });
    return material;
};

export const useCheapMaterials = (root: THREE.Object3D) => {
    const swapped = new Map<THREE.Material, THREE.Material>();
    root.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || Array.isArray(mesh.material)) return;
        const source = mesh.material as THREE.MeshStandardMaterial;
        if (!source.isMeshStandardMaterial) return;
        let cheap = swapped.get(source);
        if (!cheap) {
            cheap = toLambert(source);
            swapped.set(source, cheap);
        }
        mesh.material = cheap;
    });
};

// the car on a weak gpu: phong with a plain cube reflection instead of pbr,
// clearcoat and the prefiltered sky, which was the biggest single cost on a
// software rasterizer. keeps the paint color, textures and lights
export const toCheapCarMaterial = (
    source: THREE.Material,
    envMap: THREE.Texture | null
) => {
    const m = source as THREE.MeshPhysicalMaterial;
    if (!m.isMeshStandardMaterial) return source;
    const metal = m.metalness ?? 0;
    const rough = m.roughness ?? 1;
    const phong = new THREE.MeshPhongMaterial({
        name: m.name,
        color: m.color,
        map: m.map,
        emissive: m.emissive,
        emissiveMap: m.emissiveMap,
        emissiveIntensity: m.emissiveIntensity,
        normalMap: m.normalMap,
        alphaMap: m.alphaMap,
        envMap,
        reflectivity:
            Math.min(0.45, 0.05 + metal * 0.25 + (m.clearcoat ?? 0) * 0.12) *
            (1 - rough * 0.6),
        combine: THREE.MixOperation,
        specular: new THREE.Color().setScalar(0.25 + metal * 0.35),
        shininess: Math.max(4, (1 - rough) * 90),
        vertexColors: m.vertexColors,
        side: m.side,
        transparent: m.transparent,
        opacity: m.opacity,
        alphaTest: m.alphaTest,
        depthWrite: m.depthWrite,
        polygonOffset: m.polygonOffset,
        polygonOffsetFactor: m.polygonOffsetFactor,
        polygonOffsetUnits: m.polygonOffsetUnits,
    });
    // the garage tells rims apart by it (Garage/carLook.ts)
    phong.userData.garageMetalness = metal;
    return phong;
};

// a tiny sky cube for those reflections: blue above, dark green below. six 16 px faces, sampled directly (no prefiltering)
let skyCube: THREE.CubeTexture | null = null;
export const getCheapSkyCube = () => {
    if (skyCube) return skyCube;
    const face = (top: string, bottom: string) => {
        const canvas = document.createElement('canvas');
        canvas.width = 16;
        canvas.height = 16;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            const gradient = ctx.createLinearGradient(0, 0, 0, 16);
            gradient.addColorStop(0, top);
            gradient.addColorStop(1, bottom);
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 16, 16);
        }
        return canvas;
    };
    const sky = '#6f9bd1';
    const ground = '#3f4a33';
    const side = face(sky, ground);
    skyCube = new THREE.CubeTexture([
        side,
        side,
        face(sky, sky),
        face(ground, ground),
        side,
        side,
    ]);
    skyCube.colorSpace = THREE.SRGBColorSpace;
    skyCube.needsUpdate = true;
    return skyCube;
};
