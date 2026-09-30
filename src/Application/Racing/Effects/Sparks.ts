import * as THREE from 'three';

// barrier sparks: tiny white hot heads with short soft tails that cool to
// orange and red, fall, and skip once off the road, plus a flash of glow at
// each hit. one instanced quad each, moved by the vertex shader and added on
// top so the hot ones bloom a little. same ring buffer idea as the smoke
const CAPACITY = 480;

const vertexShader = /* glsl */ `
    attribute vec3 aOrigin;
    attribute vec3 aVelocity;
    // birth, life, the road's height under it, kind (0 spark, 1 flash)
    attribute vec4 aTiming;
    attribute float aSize;
    uniform float uTime;
    varying vec2 vUv;
    varying float vT;
    varying float vKind;
    varying float vAspect;

    const float G = 9.81;

    void main() {
        float age = uTime - aTiming.x;
        float life = aTiming.y;
        float t = age / life;
        vUv = uv;
        vT = t;
        vKind = aTiming.w;
        vAspect = 1.0;
        if (t < 0.0 || t > 1.0 || life <= 0.0) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            return;
        }
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        if (aTiming.w > 0.5) {
            vec2 corner = position.xy * aSize * (0.7 + t * 0.6);
            vec3 glow = aOrigin + right * corner.x + up * corner.y;
            gl_Position = projectionMatrix * viewMatrix * vec4(glow, 1.0);
            return;
        }
        // one skip off the road, then it lies there cooling
        float ground = aTiming.z;
        vec3 v0 = aVelocity;
        float drop = max(0.0, aOrigin.y - ground);
        float land = (v0.y + sqrt(v0.y * v0.y + 2.0 * G * drop)) / G;
        vec3 head;
        vec3 velocity;
        if (age < land) {
            head = aOrigin + v0 * age;
            head.y -= 0.5 * G * age * age;
            velocity = v0 - vec3(0.0, G * age, 0.0);
        } else {
            vec3 at = aOrigin + v0 * land;
            at.y = ground;
            vec3 skip = vec3(v0.x * 0.5, (G * land - v0.y) * 0.3, v0.z * 0.5);
            float after = age - land;
            head = at + skip * after;
            head.y = max(ground + 0.01, head.y - 0.5 * G * after * after);
            velocity = skip - vec3(0.0, G * after, 0.0);
        }
        // a short tail along the motion, round at both ends
        float width = aSize * (1.0 - 0.45 * t);
        vec3 streak = velocity * 0.012;
        float len = length(streak);
        vec3 dir = len > 1e-4 ? streak / len : up;
        vec3 side = cross(dir, normalize(cameraPosition - head));
        float sideLength = length(side);
        side = sideLength > 1e-4 ? side / sideLength : right;
        float total = len + width;
        vec3 world = head - dir * len * 0.5 + dir * position.y * total + side * position.x * width;
        vAspect = total / width;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
    }
`;

const fragmentShader = /* glsl */ `
    varying vec2 vUv;
    varying float vT;
    varying float vKind;
    varying float vAspect;

    void main() {
        float t = vT;
        vec3 color;
        float alpha;
        if (vKind > 0.5) {
            float r = length(vUv - 0.5) * 2.0;
            alpha = exp(-r * r * 5.0) * (1.0 - t) * (1.0 - t);
            color = mix(vec3(1.6, 1.25, 0.9), vec3(1.4, 0.55, 0.12), t);
        } else {
            // a capsule in units of the width: a bright core, soft edges
            vec2 p = vec2(vUv.x - 0.5, (vUv.y - 0.5) * vAspect);
            float halfLength = max(0.0, vAspect - 1.0) * 0.5;
            float d = length(vec2(p.x, max(abs(p.y) - halfLength, 0.0)));
            vec3 hot = mix(vec3(1.0, 0.93, 0.78), vec3(1.0, 0.5, 0.12), smoothstep(0.0, 0.45, t));
            // the head burns brightest, the tail is where it was a moment ago
            color = mix(hot, vec3(0.75, 0.16, 0.03), smoothstep(0.45, 1.0, t))
                * mix(3.0, 0.9, t) * mix(0.35, 1.0, vUv.y);
            alpha = smoothstep(0.5, 0.05, d) * (1.0 - t) * (1.0 - 0.5 * t);
        }
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(color, alpha);
        // straight to the screen (no post chain) it still gets the tone
        // map, so orange doesn't clip to yellow
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
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
    private size: THREE.InstancedBufferAttribute;
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
            new Float32Array(CAPACITY * 4),
            4
        );
        this.size = new THREE.InstancedBufferAttribute(
            new Float32Array(CAPACITY),
            1
        );
        [this.origin, this.velocity, this.timing, this.size].forEach((attr) =>
            attr.setUsage(THREE.DynamicDrawUsage)
        );
        this.geometry.setAttribute('aOrigin', this.origin);
        this.geometry.setAttribute('aVelocity', this.velocity);
        this.geometry.setAttribute('aTiming', this.timing);
        this.geometry.setAttribute('aSize', this.size);
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

    private spawn(
        x: number,
        y: number,
        z: number,
        vx: number,
        vy: number,
        vz: number,
        life: number,
        size: number,
        ground: number,
        kind: number
    ) {
        const i = this.cursor;
        this.cursor = (this.cursor + 1) % CAPACITY;
        const origin = this.origin.array as Float32Array;
        const velocity = this.velocity.array as Float32Array;
        const timing = this.timing.array as Float32Array;
        origin[i * 3] = x;
        origin[i * 3 + 1] = y;
        origin[i * 3 + 2] = z;
        velocity[i * 3] = vx;
        velocity[i * 3 + 1] = vy;
        velocity[i * 3 + 2] = vz;
        timing[i * 4] = this.time;
        timing[i * 4 + 1] = life;
        timing[i * 4 + 2] = ground;
        timing[i * 4 + 3] = kind;
        (this.size.array as Float32Array)[i] = size;
        this.dirty = true;
    }

    // a scrape: sparks off the body where it grinds the barrier, dragged
    // along the car's travel and kicked away from the wall. ground is the
    // road's height there. force (0..1) makes them faster and hotter
    emit(
        point: THREE.Vector3,
        velocity: THREE.Vector3,
        away: THREE.Vector3,
        count: number,
        ground: number,
        force = 0
    ) {
        for (let n = 0; n < count; n++) {
            const drag = 0.35 + this.random() * 0.45;
            const kick = 1.5 + this.random() * (3 + force * 5);
            const spread = 2.5 + force * 3;
            this.spawn(
                point.x + (this.random() - 0.5) * 0.3,
                ground + 0.12 + this.random() * 0.35,
                point.z + (this.random() - 0.5) * 0.3,
                velocity.x * drag + away.x * kick + (this.random() - 0.5) * spread,
                0.4 + this.random() * (2.2 + force * 3),
                velocity.z * drag + away.z * kick + (this.random() - 0.5) * spread,
                0.25 + this.random() * (0.35 + force * 0.3),
                0.01 + this.random() * 0.012,
                ground,
                0
            );
        }
    }

    // a hit: a spray of fast sparks and a flash where the body met the wall
    burst(
        point: THREE.Vector3,
        velocity: THREE.Vector3,
        away: THREE.Vector3,
        strength: number,
        ground: number
    ) {
        const force = THREE.MathUtils.clamp(strength, 0, 1);
        this.emit(point, velocity, away, Math.round(14 + force * 40), ground, force);
        this.spawn(
            point.x + away.x * 0.15,
            ground + 0.35,
            point.z + away.z * 0.15,
            0,
            0,
            0,
            0.1 + force * 0.08,
            0.7 + force * 1.3,
            ground,
            1
        );
    }

    clear() {
        const timing = this.timing.array as Float32Array;
        for (let i = 0; i < CAPACITY; i++) timing[i * 4 + 1] = 0;
        this.timing.needsUpdate = true;
    }

    update(deltaSeconds: number) {
        this.time += deltaSeconds;
        this.material.uniforms.uTime.value = this.time;
        if (this.dirty) {
            this.origin.needsUpdate = true;
            this.velocity.needsUpdate = true;
            this.timing.needsUpdate = true;
            this.size.needsUpdate = true;
            this.dirty = false;
        }
    }
}
