import * as THREE from 'three';

// the homepage transition builds the ring around the car. every material in
// the race world gets the same uniforms: past uRevealFront (meters from the
// car along the ground, broken up by noise) the world is flat and lost in
// haze, behind it everything has its real shape and color, and across
// uRevealBand the ground rises from flat, instanced things (trees, posts) and
// billboards grow up from their base a little later each, and the color comes
// out of the haze. when no reveal runs the front is huge and it costs one
// uniform branch per vertex and fragment
export type RevealUniforms = {
    uRevealCenter: THREE.IUniform<THREE.Vector3>;
    // the flat world's height, a little under the road at the car so the
    // flattened ground never covers the road
    uRevealBase: THREE.IUniform<number>;
    uRevealFront: THREE.IUniform<number>;
    uRevealBand: THREE.IUniform<number>;
    // how far behind the ground the trees and posts grow, at most
    uRevealLag: THREE.IUniform<number>;
    // in the color space the materials write (linear into the post chain,
    // srgb straight to the screen): near the car, and far off where the
    // ground meets the sky's haze
    uRevealHaze: THREE.IUniform<THREE.Color>;
    uRevealHazeFar: THREE.IUniform<THREE.Color>;
};

export const REVEAL_IDLE = 1e9;

export const createRevealUniforms = (): RevealUniforms => ({
    uRevealCenter: { value: new THREE.Vector3() },
    uRevealBase: { value: 0 },
    uRevealFront: { value: REVEAL_IDLE },
    uRevealBand: { value: 1 },
    uRevealLag: { value: 0 },
    uRevealHaze: { value: new THREE.Color() },
    uRevealHazeFar: { value: new THREE.Color() },
});

// shared by the materials and the room plate, so the room fades out exactly
// where the ring comes in
export const REVEAL_GLSL = /* glsl */ `
float revealHash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
}
float revealNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = revealHash(i);
    float b = revealHash(i + vec2(1.0, 0.0));
    float c = revealHash(i + vec2(0.0, 1.0));
    float d = revealHash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// 1 behind the front, 0 past it, over band meters. rel is meters from the
// center on the ground
float revealAtBand(vec2 rel, float lag, float band) {
    float n = revealNoise(rel * 0.13) * 0.65 + revealNoise(rel * 0.53 + 19.7) * 0.35;
    float d = length(rel) + (n - 0.5) * uRevealBand * 1.5 + lag;
    return 1.0 - smoothstep(uRevealFront - band, uRevealFront, d);
}
float revealAt(vec2 rel, float lag) {
    return revealAtBand(rel, lag, uRevealBand);
}
`;

const DECLARE = /* glsl */ `
#define REVEAL_HOLD 6.0
uniform vec3 uRevealCenter;
uniform float uRevealBase;
uniform float uRevealFront;
uniform float uRevealBand;
uniform float uRevealLag;
uniform vec3 uRevealHaze;
uniform vec3 uRevealHazeFar;
varying vec3 vRevealWorld;
`;

// before project_vertex, so lighting, shadows and fog all see the moved
// vertex. the move is in world space, taken back into the object's frame
const VERTEX = /* glsl */ `
    mat4 revealModel = modelMatrix;
#ifdef USE_INSTANCING
    revealModel = modelMatrix * instanceMatrix;
#endif
    vec3 revealWorld = (revealModel * vec4(transformed, 1.0)).xyz;
    if (uRevealFront < 1.0e8) {
        vec3 revealAnchor = revealWorld;
#if defined(USE_INSTANCING)
        revealAnchor = revealModel[3].xyz;
#elif defined(REVEAL_BILLBOARD)
        revealAnchor = (modelMatrix * vec4(aCenter, 1.0)).xyz;
#endif
        vec2 revealRel = revealAnchor.xz - uRevealCenter.xz;
        // the ground under and around the car never moves, it keeps the car
        // planted while the room's floor turns into the road
        float revealGround = max(
            revealAt(revealRel, 0.0),
            1.0 - smoothstep(REVEAL_HOLD, REVEAL_HOLD * 2.0, length(revealRel))
        );
#if defined(USE_INSTANCING) || defined(REVEAL_BILLBOARD)
        // the whole thing rides its rising ground and grows up from its base,
        // each a little later than the ground and slower than it rises
        float revealRise = revealAtBand(
            revealRel,
            uRevealLag * (0.3 + 0.7 * revealHash(revealAnchor.xz * 0.37)),
            uRevealBand * 1.5
        );
        float revealY = mix(uRevealBase, revealAnchor.y, revealGround) + (revealWorld.y - revealAnchor.y) * revealRise;
#else
        float revealY = mix(uRevealBase, revealWorld.y, revealGround);
#endif
        mat3 revealBasis = mat3(revealModel);
        if (abs(determinant(revealBasis)) > 1.0e-12) {
            transformed += inverse(revealBasis) * vec3(0.0, revealY - revealWorld.y, 0.0);
            revealWorld.y = revealY;
        }
    }
    vRevealWorld = revealWorld;
`;

// with fog, in the color space the material writes. the haze is the room's
// floor close by and its walls further out, so the flat world has no horizon
const FRAGMENT = /* glsl */ `
    if (uRevealFront < 1.0e8) {
        vec2 revealRel = vRevealWorld.xz - uRevealCenter.xz;
        vec3 revealHaze = mix(uRevealHaze, uRevealHazeFar, smoothstep(10.0, 70.0, length(revealRel)));
        gl_FragColor.rgb = mix(revealHaze, gl_FragColor.rgb, revealAt(revealRel, 0.0));
    }
`;

const patched = new WeakSet<THREE.Material>();

// the key three caches the program under. the default key is the source of
// onBeforeCompile, so it has to be read before that is wrapped, or two
// different custom shaders would share one program
const keyWithReveal = (material: THREE.Material) => {
    const own = material.customProgramCacheKey;
    const previous =
        own !== THREE.Material.prototype.customProgramCacheKey
            ? () => own.call(material)
            : (() => {
                  const source = material.onBeforeCompile.toString();
                  return () => source;
              })();
    material.customProgramCacheKey = () => `${previous()}-reveal`;
};

// true when the material wasn't patched before
export const applyReveal = (
    material: THREE.Material,
    uniforms: RevealUniforms
) => {
    // shader materials (sky, smoke, sparks) have their own code
    if (patched.has(material) || (material as THREE.ShaderMaterial).isShaderMaterial)
        return false;
    patched.add(material);
    keyWithReveal(material);
    const previous = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
        previous.call(material, shader, renderer);
        if (
            !shader.vertexShader.includes('#include <project_vertex>') ||
            !shader.fragmentShader.includes('#include <fog_fragment>')
        )
            return;
        Object.assign(shader.uniforms, uniforms);
        // billboards place their corners around an aCenter attribute
        const billboard = /attribute\s+vec3\s+aCenter\s*;/.test(shader.vertexShader);
        shader.vertexShader = shader.vertexShader
            .replace(
                '#include <common>',
                `#include <common>
${billboard ? '#define REVEAL_BILLBOARD' : ''}
${DECLARE}
${REVEAL_GLSL}`
            )
            .replace(
                '#include <project_vertex>',
                `${VERTEX}
#include <project_vertex>`
            );
        shader.fragmentShader = shader.fragmentShader
            .replace(
                '#include <common>',
                `#include <common>
${DECLARE}
${REVEAL_GLSL}`
            )
            .replace(
                '#include <fog_fragment>',
                `#include <fog_fragment>
${FRAGMENT}`
            );
    };
    material.needsUpdate = true;
    return true;
};

// every material under root, whatever built it, so things other code adds to
// the race world join in by themselves. cars (the player's, remote clones and
// ghosts) and anything flagged revealSkip keep their own look. returns how
// many materials were new
export const applyRevealTo = (root: THREE.Object3D, uniforms: RevealUniforms) => {
    let added = 0;
    const visit = (node: THREE.Object3D) => {
        if (node.userData.raceModelRoot || node.userData.revealSkip) return;
        const mesh = node as THREE.Mesh;
        if (mesh.isMesh && mesh.material) {
            const materials = Array.isArray(mesh.material)
                ? mesh.material
                : [mesh.material];
            materials.forEach((material) => {
                if (applyReveal(material, uniforms)) added++;
            });
        }
        node.children.forEach(visit);
    };
    visit(root);
    return added;
};

// the sky has no ground distance, it clears on its own amount. its haze is
// the room's walls: lighter toward the horizon, darker up high
export const applySkyReveal = (
    material: THREE.ShaderMaterial,
    haze: {
        uRevealSkyHaze: THREE.IUniform<THREE.Color>;
        uRevealSkyTop: THREE.IUniform<THREE.Color>;
    },
    amount: THREE.IUniform<number>
) => {
    if (patched.has(material)) return;
    patched.add(material);
    keyWithReveal(material);
    const previous = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
        previous.call(material, shader, renderer);
        Object.assign(shader.uniforms, haze);
        shader.uniforms.uRevealSky = amount;
        shader.fragmentShader = shader.fragmentShader
            .replace(
                'void main()',
                `uniform vec3 uRevealSkyHaze;
uniform vec3 uRevealSkyTop;
uniform float uRevealSky;
void main()`
            )
            .replace(
                '#include <colorspace_fragment>',
                `#include <colorspace_fragment>
    if (uRevealSky < 1.0) {
        float revealUp = normalize(vWorldPosition - cameraPosition).y;
        vec3 revealHaze = mix(uRevealSkyHaze, uRevealSkyTop, smoothstep(0.05, 0.6, revealUp));
        gl_FragColor.rgb = mix(revealHaze, gl_FragColor.rgb, uRevealSky);
    }`
            );
    };
    material.needsUpdate = true;
};
