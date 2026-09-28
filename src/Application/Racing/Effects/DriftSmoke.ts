import * as THREE from 'three';
import Application from '../../Application';
import UIEventBus from '../../UI/EventBus';
import { createSmokeTexture } from '../Visuals/proceduralTextures';

// tire smoke and grass dust as one instanced mesh: a ring buffer of puffs
// that the vertex shader moves, grows, turns to face the camera and fades.
// the cpu only writes a puff when it's born
const QUALITY_PARTICLE_LIMIT = 420;
const PERFORMANCE_PARTICLE_LIMIT = 160;

export type PuffKind = 'smoke' | 'dust';

const SMOKE_COLOR = new THREE.Color(0xd9dcde);
const DUST_COLOR = new THREE.Color(0x9a8a6a);

const vertexShader = /* glsl */ `
    attribute vec3 aOrigin;
    attribute vec3 aVelocity;
    attribute vec4 aTiming;
    attribute vec3 aColor;
    uniform float uTime;
    varying vec2 vUv;
    varying float vAlpha;
    varying vec3 vColor;

    void main() {
        float birth = aTiming.x;
        float life = aTiming.y;
        float size = aTiming.z;
        float seed = aTiming.w;
        float age = uTime - birth;
        float t = age / life;
        vUv = uv;
        vColor = aColor;
        if (t < 0.0 || t > 1.0 || life <= 0.0) {
            vAlpha = 0.0;
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            return;
        }
        // drag on the launch speed, then it drifts up and spreads
        float drag = 1.6;
        vec3 travel = aVelocity * (1.0 - exp(-drag * age)) / drag;
        vec3 center = aOrigin + travel + vec3(0.0, age * age * 0.35 + age * 0.4, 0.0);
        float grow = size * (0.8 + t * 3.4);
        float spin = seed * 6.2831 + age * (seed - 0.5) * 1.6;
        float c = cos(spin);
        float s = sin(spin);
        vec2 corner = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * grow;
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 world = center + right * corner.x + up * corner.y;
        // quick fade in, long fade out
        vAlpha = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.35, 1.0, t));
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
    }
`;

const fragmentShader = /* glsl */ `
    uniform sampler2D uMap;
    uniform vec3 uLight;
    uniform float uOpacity;
    varying vec2 vUv;
    varying float vAlpha;
    varying vec3 vColor;

    void main() {
        vec4 puff = texture2D(uMap, vUv);
        float alpha = puff.a * vAlpha * uOpacity;
        if (alpha < 0.004) discard;
        // brighter toward the top of the puff, like it catches the sky
        vec3 color = vColor * uLight * mix(0.72, 1.08, vUv.y);
        gl_FragColor = vec4(color, alpha);
    }
`;

export default class DriftSmoke {
    root: THREE.Group;
    mesh: THREE.Mesh;
    geometry: THREE.InstancedBufferGeometry;
    material: THREE.ShaderMaterial;
    active: boolean;
    lowQuality: boolean;
    capacity: number;
    cursor: number;
    time: number;
    alive: number;
    private origin: THREE.InstancedBufferAttribute;
    private velocity: THREE.InstancedBufferAttribute;
    private timing: THREE.InstancedBufferAttribute;
    private color: THREE.InstancedBufferAttribute;
    private dirty: boolean;

    constructor(parent: THREE.Object3D) {
        this.root = new THREE.Group();
        this.root.name = 'race-drift-smoke-root';
        parent.add(this.root);
        this.active = false;
        // the renderer decides: performance mode, or auto running below native res
        this.lowQuality = new Application().renderer.effectsLow;
        this.capacity = QUALITY_PARTICLE_LIMIT;
        this.cursor = 0;
        this.time = 0;
        this.alive = 0;
        this.dirty = false;

        const quad = new THREE.PlaneGeometry(1, 1);
        this.geometry = new THREE.InstancedBufferGeometry();
        this.geometry.index = quad.index;
        this.geometry.setAttribute('position', quad.getAttribute('position'));
        this.geometry.setAttribute('uv', quad.getAttribute('uv'));
        this.origin = new THREE.InstancedBufferAttribute(
            new Float32Array(this.capacity * 3),
            3
        );
        this.velocity = new THREE.InstancedBufferAttribute(
            new Float32Array(this.capacity * 3),
            3
        );
        this.timing = new THREE.InstancedBufferAttribute(
            new Float32Array(this.capacity * 4),
            4
        );
        this.color = new THREE.InstancedBufferAttribute(
            new Float32Array(this.capacity * 3),
            3
        );
        [this.origin, this.velocity, this.timing, this.color].forEach((attr) =>
            attr.setUsage(THREE.DynamicDrawUsage)
        );
        this.geometry.setAttribute('aOrigin', this.origin);
        this.geometry.setAttribute('aVelocity', this.velocity);
        this.geometry.setAttribute('aTiming', this.timing);
        this.geometry.setAttribute('aColor', this.color);
        this.geometry.instanceCount = this.capacity;

        this.material = new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader,
            uniforms: {
                uTime: { value: 0 },
                uMap: { value: createSmokeTexture() },
                uLight: { value: new THREE.Color(1, 1, 1) },
                uOpacity: { value: 1 },
            },
            transparent: true,
            depthWrite: false,
        });
        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.name = 'race-drift-smoke';
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 4;
        this.root.add(this.mesh);

        UIEventBus.on(
            'render:effects',
            (state: { low?: boolean } | undefined) => {
                this.lowQuality = Boolean(state?.low);
            }
        );
    }

    // light the puffs with the scene's sun and sky, in linear color
    setLight(color: THREE.Color) {
        (this.material.uniforms.uLight.value as THREE.Color).copy(color);
    }

    setActive(active: boolean) {
        this.active = active;
        this.mesh.visible = active;
        if (!active) {
            this.clear();
        }
    }

    clear() {
        const timing = this.timing.array as Float32Array;
        for (let i = 0; i < this.capacity; i++) timing[i * 4 + 1] = 0;
        this.timing.needsUpdate = true;
        this.alive = 0;
    }

    getParticleLimit() {
        return this.lowQuality
            ? PERFORMANCE_PARTICLE_LIMIT
            : QUALITY_PARTICLE_LIMIT;
    }

    emit(
        position: THREE.Vector3,
        intensity: number,
        speedMps: number,
        kind: PuffKind = 'smoke'
    ) {
        if (!this.active || intensity <= 0.05) return;
        const limit = this.getParticleLimit();
        const index = this.cursor % limit;
        this.cursor = (this.cursor + 1) % limit;
        const i3 = index * 3;
        const origin = this.origin.array as Float32Array;
        const velocity = this.velocity.array as Float32Array;
        const timing = this.timing.array as Float32Array;
        const color = this.color.array as Float32Array;
        const seed =
            (Math.sin(this.cursor * 12.9898 + this.time * 78.233) *
                43758.5453) %
            1;
        const jitter = Math.abs(seed);
        origin[i3] = position.x + (jitter - 0.5) * 0.4;
        origin[i3 + 1] = position.y - 0.15;
        origin[i3 + 2] = position.z + (0.5 - jitter) * 0.4;
        const kick = Math.min(6, speedMps * 0.08);
        velocity[i3] = (jitter - 0.5) * kick;
        velocity[i3 + 1] = 0.6 + intensity * 1.4;
        velocity[i3 + 2] = (0.5 - jitter) * kick;
        timing[index * 4] = this.time;
        timing[index * 4 + 1] =
            (kind === 'dust' ? 1.1 : 1.6) +
            intensity * (kind === 'dust' ? 0.6 : 1.4);
        timing[index * 4 + 2] =
            0.9 + intensity * 1.1 + Math.min(0.8, speedMps * 0.012);
        timing[index * 4 + 3] = jitter;
        const tint = kind === 'dust' ? DUST_COLOR : SMOKE_COLOR;
        const strength =
            kind === 'dust' ? 0.55 + intensity * 0.3 : 0.35 + intensity * 0.55;
        color[i3] = tint.r * strength;
        color[i3 + 1] = tint.g * strength;
        color[i3 + 2] = tint.b * strength;
        this.dirty = true;
        this.alive = Math.min(limit, this.alive + 1);
    }

    update(deltaSeconds: number) {
        this.time += deltaSeconds;
        this.material.uniforms.uTime.value = this.time;
        this.material.uniforms.uOpacity.value = this.lowQuality ? 0.7 : 0.9;
        this.geometry.instanceCount = this.getParticleLimit();
        if (this.dirty) {
            this.origin.needsUpdate = true;
            this.velocity.needsUpdate = true;
            this.timing.needsUpdate = true;
            this.color.needsUpdate = true;
            this.dirty = false;
        }
    }
}
