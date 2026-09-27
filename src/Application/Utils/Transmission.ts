import * as THREE from 'three';

// a single material with transmission > 0 makes three re-render every opaque
// object into an offscreen target each frame, doubling the cost of the whole
// scene. plain alpha blended glass looks the same at the sizes we render
const OPAQUE_GLASS_FALLBACK_OPACITY = 0.4;

export const disableTransmission = (root: THREE.Object3D) => {
    root.traverse((child) => {
        if (!(child instanceof THREE.Mesh) || !child.material) return;

        const materials = Array.isArray(child.material)
            ? child.material
            : [child.material];

        materials.forEach((material) => {
            const physical = material as THREE.MeshPhysicalMaterial;
            if (!physical.transmission) return;

            physical.transmission = 0;
            physical.transparent = true;
            physical.depthWrite = false;
            if (physical.opacity >= 0.95) {
                physical.opacity = OPAQUE_GLASS_FALLBACK_OPACITY;
            }
            physical.needsUpdate = true;
        });
    });
};
