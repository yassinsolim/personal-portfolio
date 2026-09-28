import * as THREE from 'three';

// the ring building itself around the car: everything past uRevealRadius from
// the car is cut away, with a bright band at the edge. radius is huge when
// no reveal runs, so it costs one distance per fragment
export type RevealUniforms = {
    uRevealCenter: THREE.IUniform<THREE.Vector3>;
    uRevealRadius: THREE.IUniform<number>;
};

export const createRevealUniforms = (): RevealUniforms => ({
    uRevealCenter: { value: new THREE.Vector3() },
    uRevealRadius: { value: 1e9 },
});

const patched = new WeakSet<THREE.Material>();

// grow: how the geometry rises out of the ground as the wave passes. trees
// scale up from their base, billboards stretch up from theirs
export type RevealGrow = 'none' | 'instanced' | 'billboard';

export const applyReveal = (
    material: THREE.Material,
    uniforms: RevealUniforms,
    grow: RevealGrow = 'none'
) => {
    if (patched.has(material)) return;
    patched.add(material);
    const previous = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey.bind(material);
    material.onBeforeCompile = (shader, renderer) => {
        previous.call(material, shader, renderer);
        Object.assign(shader.uniforms, uniforms);
        const growth =
            grow === 'instanced'
                ? `
#ifdef USE_INSTANCING
    float revealGrow = smoothstep(uRevealRadius, uRevealRadius - REVEAL_GROW_BAND, distance(instanceMatrix[3].xz, uRevealCenter.xz));
    transformed.y *= revealGrow;
#endif`
                : grow === 'billboard'
                ? `
    float revealGrow = smoothstep(uRevealRadius, uRevealRadius - REVEAL_GROW_BAND, distance(aCenter.xz, uRevealCenter.xz));
    transformed.y = aCenter.y + (transformed.y - aCenter.y) * revealGrow;`
                : '';
        shader.vertexShader = shader.vertexShader
            .replace(
                '#include <common>',
                `#include <common>
varying vec3 vRevealWorld;
uniform vec3 uRevealCenter;
uniform float uRevealRadius;
#define REVEAL_GROW_BAND 45.0`
            )
            .replace(
                '#include <project_vertex>',
                `${growth}
#include <project_vertex>`
            )
            .replace(
                '#include <project_vertex>',
                `#include <project_vertex>
#ifdef USE_INSTANCING
    vRevealWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
    vRevealWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif`
            );
        shader.fragmentShader = shader.fragmentShader
            .replace(
                '#include <common>',
                `#include <common>
varying vec3 vRevealWorld;
uniform vec3 uRevealCenter;
uniform float uRevealRadius;`
            )
            .replace(
                '#include <clipping_planes_fragment>',
                `#include <clipping_planes_fragment>
    float revealDistance = distance(vRevealWorld.xz, uRevealCenter.xz);
    if (revealDistance > uRevealRadius) discard;`
            )
            .replace(
                '#include <dithering_fragment>',
                `#include <dithering_fragment>
    float revealEdge = 1.0 - smoothstep(0.0, 10.0, uRevealRadius - revealDistance);
    gl_FragColor.rgb += vec3(0.35, 0.75, 1.0) * revealEdge * revealEdge * 3.0;`
            );
    };
    material.customProgramCacheKey = () => `${previousKey()}-reveal`;
    material.needsUpdate = true;
};

export const applyRevealTo = (
    root: THREE.Object3D,
    uniforms: RevealUniforms,
    grow: RevealGrow = 'none'
) => {
    root.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || !mesh.material) return;
        const materials = Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material];
        materials.forEach((material) => {
            // shader materials (sky, smoke, sparks) have their own code
            if ((material as THREE.ShaderMaterial).isShaderMaterial) return;
            applyReveal(material, uniforms, grow);
        });
    });
};
