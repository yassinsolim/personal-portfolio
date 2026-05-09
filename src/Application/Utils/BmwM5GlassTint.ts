import * as THREE from 'three';

const M5_GLASS_MATERIAL_HINT = 'bmat_glass1';
const M5_SIDE_WINDOW_MESH_HINTS = [
    'sm_base_0000_001_sm_base_0000',
    'anc_door_l_03',
];
const M5_REAR_GLASS_MESH_HINT = 'sm_rearkit_0000_001';
const M5_REAR_GLASS_WINDOW_MIN_Y = 83;
const M5_FRONT_WINDSHIELD_MIN_X = 45;

type TintSettings = {
    color: number;
    opacity: number;
    metalness: number;
    roughness: number;
    envMapIntensity: number;
};

const M5_SIDE_AND_REAR_WINDOW_TINT: TintSettings = {
    color: 0x05070c,
    opacity: 0.72,
    metalness: 0.35,
    roughness: 0.08,
    envMapIntensity: 0.85,
};

const M5_FRONT_WINDSHIELD_TINT: TintSettings = {
    color: 0x080b12,
    opacity: 0.32,
    metalness: 0.25,
    roughness: 0.08,
    envMapIntensity: 0.7,
};

const applyGlassTint = (
    material: THREE.MeshStandardMaterial,
    tint: TintSettings
) => {
    material.map = null;
    material.alphaMap = null;
    material.color.setHex(tint.color);
    material.metalness = tint.metalness;
    material.roughness = tint.roughness;
    material.opacity = tint.opacity;
    material.transparent = true;
    material.depthWrite = false;
    material.envMapIntensity = tint.envMapIntensity;
    material.needsUpdate = true;
};

const buildGeometryFromTriangleIndices = (
    source: THREE.BufferGeometry,
    triangleIndices: number[]
) => {
    if (triangleIndices.length === 0) return null;

    const geometry = new THREE.BufferGeometry();
    Object.entries(source.attributes).forEach(([name, attribute]) => {
        if (
            !attribute ||
            (attribute as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute
        ) {
            return;
        }

        const sourceAttribute = attribute as THREE.BufferAttribute;
        const SourceArray = sourceAttribute.array.constructor as {
            new (length: number): typeof sourceAttribute.array;
        };
        const targetArray = new SourceArray(
            triangleIndices.length * sourceAttribute.itemSize
        );

        triangleIndices.forEach((sourceIndex, vertexIndex) => {
            const sourceOffset = sourceIndex * sourceAttribute.itemSize;
            const targetOffset = vertexIndex * sourceAttribute.itemSize;
            for (let i = 0; i < sourceAttribute.itemSize; i++) {
                (targetArray as any)[targetOffset + i] =
                    sourceAttribute.array[sourceOffset + i];
            }
        });

        geometry.setAttribute(
            name,
            new THREE.BufferAttribute(
                targetArray,
                sourceAttribute.itemSize,
                sourceAttribute.normalized
            )
        );
    });

    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
};

const addTintedGlassMesh = (
    sourceMesh: THREE.Mesh,
    geometry: THREE.BufferGeometry | null,
    tint: TintSettings,
    suffix: string
) => {
    if (!geometry || !sourceMesh.parent) return;
    if (!sourceMesh.material || Array.isArray(sourceMesh.material)) return;

    const material = (sourceMesh.material as THREE.MeshStandardMaterial).clone();
    applyGlassTint(material, tint);

    const tintMesh = new THREE.Mesh(geometry, material);
    tintMesh.name = `${sourceMesh.name}_${suffix}`;
    tintMesh.position.copy(sourceMesh.position);
    tintMesh.quaternion.copy(sourceMesh.quaternion);
    tintMesh.scale.copy(sourceMesh.scale);
    tintMesh.castShadow = sourceMesh.castShadow;
    tintMesh.receiveShadow = sourceMesh.receiveShadow;
    tintMesh.renderOrder = sourceMesh.renderOrder + 1;
    tintMesh.userData.bmwM5GlassTint = true;
    sourceMesh.parent.add(tintMesh);
};

const splitM5RearGlass = (
    mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
) => {
    if (mesh.userData.bmwM5GlassSplit) return;

    const position = mesh.geometry.getAttribute('position');
    if (!position || position.itemSize < 3) return;

    const sourceIndex = mesh.geometry.getIndex();
    const triangleCount = sourceIndex
        ? sourceIndex.count / 3
        : position.count / 3;
    const lampIndices: number[] = [];
    const rearWindowIndices: number[] = [];
    const windshieldIndices: number[] = [];

    const readIndex = (triangleIndex: number, cornerIndex: number) =>
        sourceIndex
            ? sourceIndex.getX(triangleIndex * 3 + cornerIndex)
            : triangleIndex * 3 + cornerIndex;

    for (let triangle = 0; triangle < triangleCount; triangle++) {
        const indices = [0, 1, 2].map((corner) => readIndex(triangle, corner));
        const centroidX =
            indices.reduce((sum, index) => sum + position.getX(index), 0) / 3;
        const centroidY =
            indices.reduce((sum, index) => sum + position.getY(index), 0) / 3;
        const target =
            centroidY > M5_REAR_GLASS_WINDOW_MIN_Y
                ? centroidX > M5_FRONT_WINDSHIELD_MIN_X
                    ? windshieldIndices
                    : rearWindowIndices
                : lampIndices;
        target.push(...indices);
    }

    const lampGeometry = buildGeometryFromTriangleIndices(
        mesh.geometry,
        lampIndices
    );
    const rearWindowGeometry = buildGeometryFromTriangleIndices(
        mesh.geometry,
        rearWindowIndices
    );
    const windshieldGeometry = buildGeometryFromTriangleIndices(
        mesh.geometry,
        windshieldIndices
    );

    if (lampGeometry) {
        mesh.geometry = lampGeometry;
    }
    addTintedGlassMesh(
        mesh,
        windshieldGeometry,
        M5_FRONT_WINDSHIELD_TINT,
        'front_windshield_tint'
    );
    addTintedGlassMesh(
        mesh,
        rearWindowGeometry,
        M5_SIDE_AND_REAR_WINDOW_TINT,
        'rear_window_tint'
    );

    mesh.userData.bmwM5GlassSplit = true;
};

export const applyBmwM5GlassTint = (model: THREE.Object3D) => {
    model.traverse((child) => {
        if (!(child instanceof THREE.Mesh) || !child.material) return;
        if (Array.isArray(child.material)) return;

        const material = child.material as THREE.MeshStandardMaterial;
        const materialName = (material.name || '').toLowerCase();
        if (!materialName.includes(M5_GLASS_MATERIAL_HINT)) return;

        const objectName = (child.name || '').toLowerCase();
        if (
            M5_SIDE_WINDOW_MESH_HINTS.some((hint) =>
                objectName.includes(hint)
            )
        ) {
            applyGlassTint(material, M5_SIDE_AND_REAR_WINDOW_TINT);
            return;
        }

        if (objectName.includes(M5_REAR_GLASS_MESH_HINT)) {
            splitM5RearGlass(
                child as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
            );
        }
    });
};
