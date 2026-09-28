import * as THREE from 'three';

// sparks off the barrier: short bright streaks stretched along their motion,
// added on top so they bloom. same ring buffer idea as the smoke
const CAPACITY = 320;

const vertexShader = /* glsl */ `
    attribute vec3 aOrigin;
    attribute vec3 aVelocity;
    attribute vec2 aTiming;
    uniform float uTime;
    varying float vAlpha;
    varying vec2 vUv;

    void main() {
        float age = uTime - aTiming.x;
        float life = aTiming.y;
        float t = age / life;
        vUv = uv;
        if (t < 0.0 || t > 1.0 || life <= 0.0) {
            vAlpha = 0.0;
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            return;
        }
        vec3 gravity = vec3(0.0, -9.81, 0.0);
        vec3 velocity = aVelocity + gravity * age;
        vec3 head = aOrigin + aVelocity * age + 0.5 * gravity * age * age;
        vec3 tail = head - velocity * 0.035;
        vec3 along = head - tail;
        vec3 toCamera = normalize(cameraPosition - head);
        vec3 across = normalize(cross(along, toCamera)) * 0.018;
        // position.y runs 0..1 from tail to head, position.x is the side
        vec3 world = mix(tail, head, position.y + 0.5) + across * position.x * 2.0;
        vAlpha = 1.0 - t;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
    }
`;

const fragmentShader = /* glsl */ `
    varying float vAlpha;
    varying vec2 vUv;
    void main() {
        float core = 1.0 - abs(vUv.x - 0.5) * 2.0;
        vec3 hot = mix(vec3(6.0, 1.6, 0.35), vec3(9.0, 6.0, 2.4), vUv.y);
        gl_FragColor = vec4(hot * core * vAlpha, core * vAlpha);
    }
`;

export default class Sparks {
    mesh: THREE.Mesh;
    geometry: THREE.InstancedBufferGeometry;
    material: THREE.ShaderMaterial;
    cursor: number;
    time: number;
    private origin: THREE.InstancedBufferAttribute;
    private velocity: THREE.InstancedBufferAttribute;
    private timing: THREE.InstancedBufferAttribute;
    private dirty: boolean;
    private seed: number;

    constructor(parent: THREE.Object3D) {
        const quad = new THREE.PlaneGeometry(1, 1);
        this.geometry = new THREE.InstancedBufferGeometry();
        this.geometry.index = quad.index;
        this.geometry.setAttribute('position', quad.getAttribute('position'));
        this.geometry.setAttribute('uv', quad.getAttribute('uv'));
        this.origin = new THREE.InstancedBufferAttribute(
            new Float32Array(CAPACITY * 3),
            3
        );
        this.velocity = new THREE.InstancedBufferAttribute(
            new Float32Array(CAPACITY * 3),
            3
        );
        this.timing = new THREE.InstancedBufferAttribute(
            new Float32Array(CAPACITY * 2),
            2
        );
        [this.origin, this.velocity, this.timing].forEach((attr) =>
            attr.setUsage(THREE.DynamicDrawUsage)
        );
        this.geometry.setAttribute('aOrigin', this.origin);
        this.geometry.setAttribute('aVelocity', this.velocity);
        this.geometry.setAttribute('aTiming', this.timing);
        this.geometry.instanceCount = CAPACITY;
        this.material = new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader,
            uniforms: { uTime: { value: 0 } },
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.name = 'race-sparks';
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 5;
        parent.add(this.mesh);
        this.cursor = 0;
        this.time = 0;
        this.dirty = false;
        this.seed = 1;
    }

    random() {
        this.seed = (this.seed * 16807) % 2147483647;
        return this.seed / 2147483647;
    }

    // at a scrape point: along the car's travel, kicked away from the wall
    emit(
        point: THREE.Vector3,
        velocity: THREE.Vector3,
        away: THREE.Vector3,
        count: number
    ) {
        const origin = this.origin.array as Float32Array;
        const speed = this.velocity.array as Float32Array;
        const timing = this.timing.array as Float32Array;
        for (let n = 0; n < count; n++) {
            const i = this.cursor;
            this.cursor = (this.cursor + 1) % CAPACITY;
            origin[i * 3] = point.x;
            origin[i * 3 + 1] = point.y + 0.25 + this.random() * 0.3;
            origin[i * 3 + 2] = point.z;
            const drag = 0.45 + this.random() * 0.35;
            const kick = 1.5 + this.random() * 4;
            speed[i * 3] =
                velocity.x * drag + away.x * kick + (this.random() - 0.5) * 3;
            speed[i * 3 + 1] = 1 + this.random() * 3.5;
            speed[i * 3 + 2] =
                velocity.z * drag + away.z * kick + (this.random() - 0.5) * 3;
            timing[i * 2] = this.time;
            timing[i * 2 + 1] = 0.22 + this.random() * 0.35;
        }
        this.dirty = true;
    }

    clear() {
        const timing = this.timing.array as Float32Array;
        for (let i = 0; i < CAPACITY; i++) timing[i * 2 + 1] = 0;
        this.timing.needsUpdate = true;
    }

    update(deltaSeconds: number) {
        this.time += deltaSeconds;
        this.material.uniforms.uTime.value = this.time;
        if (this.dirty) {
            this.origin.needsUpdate = true;
            this.velocity.needsUpdate = true;
            this.timing.needsUpdate = true;
            this.dirty = false;
        }
    }
}
