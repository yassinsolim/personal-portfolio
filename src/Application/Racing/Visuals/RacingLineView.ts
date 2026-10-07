// the driving line on the road ahead, coloured like Forza's: green where the
// car's speed is fine for that bit of the line, yellow to ease off, red to
// brake. each point takes the drawn road's height and tilt the first time
// it's shown
import * as THREE from 'three';
import type { RacingLine } from '../Track/racingLine';
import type { LineMode } from '../Track/lineMode';

const WINDOW = 140;
const START = 3;
const HALF_WIDTH = 0.6;
const LIFT = 0.03;
// m/s over the line's speed for yellow and for red
const EASE = 1.5;
const BRAKE = 5;
const GREEN = new THREE.Color(0.2, 1, 0.35);
const YELLOW = new THREE.Color(1, 0.8, 0.05);
const RED = new THREE.Color(1, 0.12, 0.08);

// the drawn road's height at a line point (its index and offset from the
// centre), with the road's normal there
type RoadSampler = (index: number, offset: number, normal: THREE.Vector3) => number;

export default class RacingLineView {
    line: RacingLine;
    // the speed the line asks for at each point, m/s
    targets: Float32Array | null = null;
    mode: LineMode = 'off';
    mesh: THREE.Mesh;
    positions: THREE.BufferAttribute;
    colors: THREE.BufferAttribute;
    // road height and normal under each point, NaN until first drawn
    heights: Float32Array;
    normals: Float32Array;
    sampleRoad: RoadSampler;
    index = -1;
    normal = new THREE.Vector3();
    color = new THREE.Color();

    constructor(parent: THREE.Object3D, line: RacingLine, sampleRoad: RoadSampler) {
        this.line = line;
        this.sampleRoad = sampleRoad;
        this.heights = new Float32Array(line.count).fill(NaN);
        this.normals = new Float32Array(line.count * 3);
        const geometry = new THREE.BufferGeometry();
        this.positions = new THREE.BufferAttribute(new Float32Array(WINDOW * 2 * 3), 3);
        this.colors = new THREE.BufferAttribute(new Float32Array(WINDOW * 2 * 4), 4);
        this.positions.setUsage(THREE.DynamicDrawUsage);
        this.colors.setUsage(THREE.DynamicDrawUsage);
        const indices: number[] = [];
        for (let i = 0; i < WINDOW - 1; i++) {
            const v = i * 2;
            indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
        }
        geometry.setAttribute('position', this.positions);
        geometry.setAttribute('color', this.colors);
        geometry.setIndex(indices);
        this.mesh = new THREE.Mesh(
            geometry,
            new THREE.MeshBasicMaterial({
                vertexColors: true,
                transparent: true,
                depthWrite: false,
                side: THREE.DoubleSide,
                polygonOffset: true,
                polygonOffsetFactor: -6,
                polygonOffsetUnits: -12,
            })
        );
        this.mesh.name = 'race-driving-line';
        this.mesh.frustumCulled = false;
        // over the road's lines, under the skid marks
        this.mesh.renderOrder = 2.6;
        this.mesh.visible = false;
        parent.add(this.mesh);
    }

    // the nearest line point, searched near the last one
    nearest(x: number, z: number) {
        const { line } = this;
        const n = line.count;
        let best = this.index;
        let bestD = Infinity;
        const scan = (from: number, to: number) => {
            for (let k = from; k <= to; k++) {
                const i = ((k % n) + n) % n;
                const d = (line.x[i] - x) ** 2 + (line.z[i] - z) ** 2;
                if (d < bestD) {
                    bestD = d;
                    best = i;
                }
            }
        };
        if (this.index >= 0) scan(this.index - 60, this.index + 60);
        if (this.index < 0 || bestD > 40 * 40) scan(0, n - 1);
        this.index = best;
        return best;
    }

    groundAt(i: number) {
        if (Number.isNaN(this.heights[i])) {
            this.heights[i] = this.sampleRoad(i, this.line.offset[i], this.normal);
            this.normals[i * 3] = this.normal.x;
            this.normals[i * 3 + 1] = this.normal.y;
            this.normals[i * 3 + 2] = this.normal.z;
        }
        return this.heights[i];
    }

    update(x: number, z: number, speed: number) {
        const targets = this.targets;
        this.mesh.visible = this.mode !== 'off' && Boolean(targets);
        if (!this.mesh.visible || !targets) return;
        const { line } = this;
        const n = line.count;
        const here = this.nearest(x, z);
        const pos = this.positions.array as Float32Array;
        const col = this.colors.array as Float32Array;
        for (let k = 0; k < WINDOW; k++) {
            const i = (here + START + k) % n;
            const j = (i + 1) % n;
            const y = this.groundAt(i);
            // across the line, from its direction here
            let ax = line.z[j] - line.z[i];
            let az = -(line.x[j] - line.x[i]);
            const length = Math.hypot(ax, az) || 1;
            ax = (ax / length) * HALF_WIDTH;
            az = (az / length) * HALF_WIDTH;
            const nx = this.normals[i * 3];
            const ny = Math.max(0.2, this.normals[i * 3 + 1]);
            const nz = this.normals[i * 3 + 2];
            // the road's tilt across the line
            const tilt = (nx * ax + nz * az) / ny;
            const v = k * 6;
            pos[v] = line.x[i] + ax;
            pos[v + 1] = y + LIFT - tilt;
            pos[v + 2] = line.z[i] + az;
            pos[v + 3] = line.x[i] - ax;
            pos[v + 4] = y + LIFT + tilt;
            pos[v + 5] = line.z[i] - az;

            const over = speed - targets[i];
            let alpha = 0.9;
            if (over > BRAKE) this.color.copy(RED);
            else if (over > EASE) this.color.copy(YELLOW);
            else {
                this.color.copy(GREEN);
                if (this.mode === 'braking') alpha = 0;
            }
            // fades in past the car and out at the far end
            alpha *= Math.min(1, k / 6) * Math.min(1, (WINDOW - 1 - k) / 30);
            const c = k * 8;
            col[c] = col[c + 4] = this.color.r;
            col[c + 1] = col[c + 5] = this.color.g;
            col[c + 2] = col[c + 6] = this.color.b;
            col[c + 3] = col[c + 7] = alpha;
        }
        this.positions.needsUpdate = true;
        this.colors.needsUpdate = true;
    }

    dispose() {
        this.mesh.removeFromParent();
        this.mesh.geometry.dispose();
        (this.mesh.material as THREE.Material).dispose();
    }
}
