import * as THREE from 'three';

// dark rubber on the road where a tire slides. each wheel lays quads from its
// last point to the new one into a shared ring buffer, and old marks fade out
// in the shader
const SEGMENTS = 1800;
const MARK_WIDTH = 0.24;
const MIN_STEP = 0.45;
const LIFETIME = 40;
const LIFT = 0.014;

const vertexShader = /* glsl */ `
    attribute vec2 aMark;
    uniform float uTime;
    varying float vAlpha;
    varying float vSide;
    void main() {
        float age = uTime - aMark.x;
        vAlpha = aMark.y * (1.0 - smoothstep(${(LIFETIME * 0.6).toFixed(
            1
        )}, ${LIFETIME.toFixed(1)}, age));
        vSide = uv.x;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const fragmentShader = /* glsl */ `
    varying float vAlpha;
    varying float vSide;
    void main() {
        // softer at the tread edges
        float edge = 1.0 - pow(abs(vSide - 0.5) * 2.0, 3.0);
        gl_FragColor = vec4(vec3(0.012, 0.012, 0.014), vAlpha * edge * 0.72);
    }
`;

export default class SkidMarks {
    mesh: THREE.Mesh;
    geometry: THREE.BufferGeometry;
    material: THREE.ShaderMaterial;
    cursor: number;
    time: number;
    last: (THREE.Vector3 | null)[];
    private positions: THREE.BufferAttribute;
    private marks: THREE.BufferAttribute;
    private dirty: boolean;
    private across: THREE.Vector3;
    private step: THREE.Vector3;

    constructor(parent: THREE.Object3D) {
        this.geometry = new THREE.BufferGeometry();
        this.positions = new THREE.BufferAttribute(
            new Float32Array(SEGMENTS * 4 * 3),
            3
        );
        this.marks = new THREE.BufferAttribute(
            new Float32Array(SEGMENTS * 4 * 2),
            2
        );
        const uvs = new Float32Array(SEGMENTS * 4 * 2);
        const indices = new Uint32Array(SEGMENTS * 6);
        for (let i = 0; i < SEGMENTS; i++) {
            const v = i * 4;
            uvs.set([0, 0, 1, 0, 0, 1, 1, 1], v * 2);
            indices.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], i * 6);
        }
        this.positions.setUsage(THREE.DynamicDrawUsage);
        this.marks.setUsage(THREE.DynamicDrawUsage);
        this.geometry.setAttribute('position', this.positions);
        this.geometry.setAttribute('aMark', this.marks);
        this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        this.material = new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader,
            uniforms: { uTime: { value: 0 } },
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -8,
            polygonOffsetUnits: -16,
        });
        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.name = 'race-skid-marks';
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 3;
        parent.add(this.mesh);
        this.cursor = 0;
        this.time = 0;
        this.last = [null, null, null, null];
        this.dirty = false;
        this.across = new THREE.Vector3();
        this.step = new THREE.Vector3();
    }

    // contact point of a wheel on the road, and how hard it's sliding (0..1).
    // below a small slide the mark lifts off and the next one starts fresh
    track(
        wheel: number,
        contact: THREE.Vector3,
        up: THREE.Vector3,
        slide: number
    ) {
        const previous = this.last[wheel];
        if (slide < 0.2) {
            this.last[wheel] = null;
            return;
        }
        if (!previous) {
            this.last[wheel] = contact.clone();
            return;
        }
        this.step.subVectors(contact, previous);
        const length = this.step.length();
        if (length < MIN_STEP) return;
        if (length > 4) {
            previous.copy(contact);
            return;
        }
        this.across
            .crossVectors(this.step, up)
            .normalize()
            .multiplyScalar(MARK_WIDTH / 2);
        const i = this.cursor;
        this.cursor = (this.cursor + 1) % SEGMENTS;
        const positions = this.positions.array as Float32Array;
        const marks = this.marks.array as Float32Array;
        const base = i * 12;
        const lift = up.clone().multiplyScalar(LIFT);
        const corners = [
            previous.clone().add(this.across).add(lift),
            previous.clone().sub(this.across).add(lift),
            contact.clone().add(this.across).add(lift),
            contact.clone().sub(this.across).add(lift),
        ];
        corners.forEach((corner, k) => {
            positions[base + k * 3] = corner.x;
            positions[base + k * 3 + 1] = corner.y;
            positions[base + k * 3 + 2] = corner.z;
            marks[i * 8 + k * 2] = this.time;
            marks[i * 8 + k * 2 + 1] = Math.min(1, 0.35 + slide * 0.8);
        });
        previous.copy(contact);
        this.dirty = true;
    }

    clear() {
        const marks = this.marks.array as Float32Array;
        marks.fill(0);
        this.marks.needsUpdate = true;
        this.last = [null, null, null, null];
    }

    update(deltaSeconds: number) {
        this.time += deltaSeconds;
        this.material.uniforms.uTime.value = this.time;
        if (this.dirty) {
            this.positions.needsUpdate = true;
            this.marks.needsUpdate = true;
            this.dirty = false;
        }
    }
}
