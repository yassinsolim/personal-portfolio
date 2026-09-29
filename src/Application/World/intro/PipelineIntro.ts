import * as THREE from 'three';
import Application from '../../Application';
import { CameraKey } from '../../Camera/Camera';
import UIEventBus from '../../UI/EventBus';
import type { SourceProgress, StageProgress } from '../../Utils/Loading';
import { warmUp } from '../../Utils/warmup';
import {
    isReturningVisitor,
    mark,
    markIntroSeen,
    prefersReducedMotion,
} from '../../UI/loaders/variant';

// ?loader=pipeline. the room assembles like a frame through a gpu pipeline,
// each stage gated by a real loading step:
//   vertex     a room model's geometry is decoded: its vertices, as points
//   primitive  all three room models are in: their triangles, as wireframe
//   raster     the scene is built: flat shaded, while the real shaders
//              compile and the textures upload
//   texture    every texture is on the gpu: the baked textures (their light
//              and shadows are baked in), the car's albedo unlit
//   lighting   the real materials are compiled and a frame has drawn: the car
//              lit by the environment map, its contact shadow, the monitor on
//   output     the film grain pass, then this is simply the live scene
// the stage fronts sweep down the screen like a raster scan. a mesh that
// shows up late (the car and flipper only exist once the scene is built)
// joins at the stage the frame has reached. the camera sits on the idle
// view from the start, so the end is the room as it always runs: no cut

export const STAGES = ['input', 'vertex', 'primitive', 'raster', 'texture', 'lighting', 'output'] as const;
export type PipelineStageName = (typeof STAGES)[number];
const S = { input: 0, vertex: 1, primitive: 2, raster: 3, texture: 4, lighting: 5, output: 6 };

const ROOM_MODELS = ['computerSetupModel', 'environmentModel', 'decorModel'];
// BakedModel's scale for the room models
const BAKED_SCALE = 900;
const WIPE_MS = 420;
const WIPE_FAST_MS = 160;
const GRAIN_OPACITY = 0.12;

type Kind = 'room' | 'car' | 'prop' | 'late';

type Managed = {
    mesh: THREE.Mesh;
    kind: Kind;
    real: THREE.Material | THREE.Material[];
    realOpacity: number;
    points: THREE.Points;
    twin: THREE.Mesh;
    pointsMaterial: THREE.ShaderMaterial;
    wire: THREE.ShaderMaterial;
    flat: THREE.ShaderMaterial;
    albedo: THREE.ShaderMaterial;
};

// what a mesh shows at a stage: nothing, points, wire, flat, albedo or real
type Rep = 'none' | 'points' | 'wire' | 'flat' | 'albedo' | 'real';

const shared = {
    uFront: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
};

// role: 0 draws everywhere, 1 only above the sweeping front (the new stage),
// 2 only below it (the old one, over the new when that's a real material)
const CLIP = /* glsl */ `
    uniform float uFront;
    uniform float uRole;
    uniform vec2 uResolution;
    void clipRole() {
        float y = 1.0 - gl_FragCoord.y / uResolution.y;
        if (uRole > 0.5 && uRole < 1.5 && y > uFront) discard;
        if (uRole > 1.5 && y < uFront) discard;
    }
`;

const VERTEX = /* glsl */ `
    varying vec3 vViewPosition;
    varying vec2 vUv;
    void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mv.xyz;
        gl_Position = projectionMatrix * mv;
    }
`;

const POINTS_VERTEX = /* glsl */ `
    uniform float uSize;
    void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uSize;
    }
`;

const SOLID_FRAGMENT = /* glsl */ `
    ${CLIP}
    uniform vec3 uColor;
    uniform float uOpacity;
    void main() {
        clipRole();
        gl_FragColor = vec4(uColor, uOpacity);
        #include <colorspace_fragment>
    }
`;

// face normals from screen space derivatives, one fixed light in view space
const FLAT_FRAGMENT = /* glsl */ `
    ${CLIP}
    uniform vec3 uColor;
    uniform float uOpacity;
    varying vec3 vViewPosition;
    void main() {
        clipRole();
        vec3 n = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
        if (dot(n, vViewPosition) < 0.0) n = -n;
        float light = max(dot(n, normalize(vec3(0.35, 0.75, 0.55))), 0.0);
        gl_FragColor = vec4(uColor * (0.3 + 0.7 * light), uOpacity);
        #include <colorspace_fragment>
    }
`;

const ALBEDO_FRAGMENT = /* glsl */ `
    ${CLIP}
    uniform vec3 uColor;
    uniform float uOpacity;
    uniform sampler2D uMap;
    uniform float uHasMap;
    varying vec2 vUv;
    void main() {
        clipRole();
        vec4 color = vec4(uColor, uOpacity);
        if (uHasMap > 0.5) color *= texture2D(uMap, vUv);
        gl_FragColor = color;
        #include <colorspace_fragment>
    }
`;

const POINT_COLOR = new THREE.Color(0x8fe3ff);
const WIRE_COLOR = new THREE.Color(0x4f9fd6);
const FLAT_COLOR = new THREE.Color(0xaeb8c2);

const firstMaterial = (material: THREE.Material | THREE.Material[]) =>
    (Array.isArray(material) ? material[0] : material) as THREE.MeshStandardMaterial;

const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;

export type PipelineState = {
    stage: number;
    // 0..1 while the next stage sweeps down, else 0
    front: number;
    sweeping: boolean;
    done: boolean;
};

export default class PipelineIntro {
    application: Application;
    managed = new Map<THREE.Mesh, Managed>();
    stage = S.input;
    target = S.input;
    front = 0;
    sweepStartedAt = 0;
    sweepMs = WIPE_MS;
    finished = false;
    released = false;
    private roomModels = new Set<string>();
    private built = false;
    private warmed = false;
    private framed = false;
    private reduced = prefersReducedMotion();
    private wipeMs = isReturningVisitor() ? WIPE_FAST_MS : WIPE_MS;
    private hidden = new THREE.MeshBasicMaterial({ visible: false });
    private grain: HTMLCanvasElement | null = null;

    constructor() {
        this.application = new Application();
        const camera = this.application.camera;
        // the idle view from the first frame: the loading happens in the room
        camera.currentKeyframe = CameraKey.IDLE;
        camera.introLock = true;

        this.grain = this.application.renderer.overlayInstance.domElement;
        this.grain.style.opacity = '0';

        UIEventBus.on('loading:source', (source: SourceProgress) => this.onSource(source));
        UIEventBus.on('loading:stage', (stage: StageProgress) => this.onStage(stage));
        this.application.time.on('tick', () => this.update());
    }

    state(): PipelineState {
        return {
            stage: this.stage,
            front: this.front,
            sweeping: this.stage < this.target,
            done: this.finished,
        };
    }

    // a room model's geometry is decoded: into the scene as points right away,
    // placed the way BakedModel will place it (the build then takes over the
    // same meshes)
    private onSource(source: SourceProgress) {
        if (source.state !== 'ready' || !ROOM_MODELS.includes(source.name)) return;
        if (this.roomModels.has(source.name) || this.built) return;
        const gltf = this.application.resources.items.gltfModel[source.name];
        if (!gltf) return;
        this.roomModels.add(source.name);
        gltf.scene.traverse((child) => {
            if (child instanceof THREE.Mesh) child.scale.set(BAKED_SCALE, BAKED_SCALE, BAKED_SCALE);
        });
        this.application.scene.add(gltf.scene);
        this.manageTree(gltf.scene, 'room');
        this.raise(S.vertex);
        if (this.roomModels.size === ROOM_MODELS.length) this.raise(S.primitive);
    }

    private onStage(stage: StageProgress) {
        if (!stage.doneAt) return;
        // the build is next, in the same task: the stand ins leave the scene
        // for it, or BakedModel would scale them with the room and the car
        // would ground itself on their bounds
        if (stage.name === 'download' && !this.built) {
            this.managed.forEach((m) => m.mesh.remove(m.points, m.twin));
        }
        if (stage.name === 'build' && !this.built) {
            this.built = true;
            this.adoptScene();
            this.raise(S.raster);
            void warmUp(this.application.camera.instance, {
                hold: false,
                swap: () => this.swapReal(),
            }).then(() => {
                this.warmed = true;
                this.raise(S.texture);
                this.checkLighting();
            });
        }
        if (stage.name === 'frame') {
            this.framed = true;
            this.checkLighting();
        }
    }

    private checkLighting() {
        if (!this.warmed || !this.framed || this.released) return;
        this.raise(S.lighting);
        this.raise(S.output);
        // the work is done: the room takes input now, the last stages finish
        // their sweep over the live scene
        this.released = true;
        mark('ready');
        mark('done');
        const camera = this.application.camera;
        camera.introLock = false;
        // the room takes clicks now; the site's own ui waits for the sweeps
        const left = S.output - this.stage;
        UIEventBus.dispatch('loadingScreenDone', {
            variant: 'pipeline',
            camera: 'intro',
            keepClock: true,
            hintAfter: this.reduced ? 0 : Math.round(left * this.sweepFor(left)),
        });
        const ui = document.getElementById('ui');
        if (ui) ui.style.pointerEvents = 'none';
        markIntroSeen();
    }

    private raise(stage: number) {
        this.target = Math.max(this.target, stage);
    }

    // stages the loading has already passed sweep faster, so the picture is
    // never far behind what has really happened
    private sweepFor(queued: number) {
        return this.wipeMs / Math.min(3, Math.max(1, queued));
    }

    // the build replaced the room meshes' materials with the baked ones and
    // added the car, flipper, monitor and steam: take them all in
    private adoptScene() {
        const world = this.application.world;
        const occlusion = world.monitorScreen?.monitorOcclusionPlane;
        const car = world.car?.model;
        const steam = world.coffeeSteam?.model?.mesh as THREE.Mesh | undefined;
        this.managed.forEach((m) => {
            // BakedModel set the real material over ours
            if (m.mesh.material !== m.flat && m.mesh.material !== this.hidden) {
                m.real = m.mesh.material;
            }
            m.mesh.add(m.points, m.twin);
        });
        const monitor = world.monitorScreen;
        if (monitor) monitor.screenOpacity = 0;
        const found: [THREE.Mesh, Kind][] = [];
        this.application.scene.traverse((object) => {
            const mesh = object as THREE.Mesh;
            if (!mesh.isMesh || this.managed.has(mesh) || mesh === occlusion) return;
            if (mesh.userData.pipelineIntroPart) return;
            let kind: Kind = 'prop';
            if (mesh === steam || mesh.name === 'car_contact_shadow') kind = 'late';
            else if (car && isDescendant(mesh, car)) kind = 'car';
            found.push([mesh, kind]);
        });
        found.forEach(([mesh, kind]) => this.manage(mesh, kind));
        this.apply();
    }

    private manageTree(root: THREE.Object3D, kind: Kind) {
        const meshes: THREE.Mesh[] = [];
        root.traverse((object) => {
            const mesh = object as THREE.Mesh;
            if (mesh.isMesh && !mesh.userData.pipelineIntroPart && !this.managed.has(mesh)) {
                meshes.push(mesh);
            }
        });
        meshes.forEach((mesh) => this.manage(mesh, kind));
        this.apply();
    }

    private manage(mesh: THREE.Mesh, kind: Kind) {
        const real = mesh.material;
        const base = firstMaterial(real);
        const transparent = Boolean(base?.transparent) && (base?.opacity ?? 1) < 1;
        const opacity = transparent ? Math.max(0.25, base.opacity) : 1;
        const color =
            kind === 'car' || kind === 'prop'
                ? (base?.color?.clone?.() ?? FLAT_COLOR.clone())
                : FLAT_COLOR.clone();
        const make = (fragmentShader: string, vertexShader: string, uniforms: Record<string, THREE.IUniform>) => {
            const material = new THREE.ShaderMaterial({
                vertexShader,
                fragmentShader,
                uniforms: {
                    ...uniforms,
                    uFront: shared.uFront,
                    uResolution: shared.uResolution,
                    uRole: { value: 0 },
                },
                transparent,
                depthWrite: !transparent,
                side: base?.side ?? THREE.FrontSide,
            });
            return material;
        };
        const pointsMaterial = make(SOLID_FRAGMENT, POINTS_VERTEX, {
            uColor: { value: POINT_COLOR },
            uOpacity: { value: 1 },
            uSize: { value: 2 * Math.min(2, window.devicePixelRatio || 1) },
        });
        pointsMaterial.transparent = false;
        pointsMaterial.depthWrite = true;
        const wire = make(SOLID_FRAGMENT, VERTEX, {
            uColor: { value: WIRE_COLOR },
            uOpacity: { value: 1 },
        });
        wire.wireframe = true;
        wire.transparent = false;
        wire.depthWrite = true;
        const flat = make(FLAT_FRAGMENT, VERTEX, {
            uColor: { value: color },
            uOpacity: { value: opacity },
        });
        const map = (base as THREE.MeshStandardMaterial | undefined)?.map || null;
        const albedo = make(ALBEDO_FRAGMENT, VERTEX, {
            uColor: { value: base?.color?.clone?.() ?? new THREE.Color(1, 1, 1) },
            uOpacity: { value: opacity },
            uMap: { value: map },
            uHasMap: { value: map ? 1 : 0 },
        });
        const points = new THREE.Points(mesh.geometry, pointsMaterial);
        points.userData.pipelineIntroPart = true;
        points.raycast = () => {};
        const twin = new THREE.Mesh(mesh.geometry, this.hidden);
        twin.userData.pipelineIntroPart = true;
        twin.raycast = () => {};
        mesh.add(points, twin);
        this.managed.set(mesh, {
            mesh,
            kind,
            real,
            realOpacity: base?.opacity ?? 1,
            points,
            twin,
            pointsMaterial,
            wire,
            flat,
            albedo,
        });
    }

    // the real materials in for a moment (compile, texture list, prime draw)
    private swapReal() {
        this.managed.forEach((m) => {
            m.mesh.material = m.real;
            m.points.visible = false;
            m.twin.visible = false;
        });
        return () => {
            this.managed.forEach((m) => {
                m.twin.visible = true;
            });
            this.apply();
        };
    }

    // the highest stage a mesh can show with what has loaded
    private cap(m: Managed) {
        if (m.kind === 'late') return this.warmed ? S.output : S.input;
        if (!this.built) return S.raster;
        if (!this.warmed) return S.raster;
        return S.output;
    }

    private rep(m: Managed, stage: number): Rep {
        const s = Math.min(stage, this.cap(m));
        if (m.kind === 'late') return s >= S.lighting ? 'real' : 'none';
        if (s <= S.input) return 'none';
        if (s === S.vertex) return 'points';
        if (s === S.primitive) return 'wire';
        if (s === S.raster) return 'flat';
        if (s === S.texture) return m.kind === 'room' ? 'real' : 'albedo';
        return 'real';
    }

    private material(m: Managed, rep: Rep) {
        if (rep === 'wire') return m.wire;
        if (rep === 'flat') return m.flat;
        if (rep === 'albedo') return m.albedo;
        if (rep === 'real') return m.real;
        return this.hidden;
    }

    private setRole(material: THREE.Material | THREE.Material[], role: number) {
        const single = material as THREE.ShaderMaterial;
        if (!Array.isArray(material) && single.uniforms?.uRole) {
            single.uniforms.uRole.value = role;
            // the old stage over the new one's real material: nudge it closer
            single.polygonOffset = role === 2;
            single.polygonOffsetFactor = role === 2 ? -1 : 0;
            single.polygonOffsetUnits = role === 2 ? -4 : 0;
        }
    }

    // each mesh shows its stage, or during a sweep the next stage above the
    // front and the current one below it
    private apply() {
        const lo = this.stage;
        const hi = this.stage < this.target ? this.stage + 1 : this.stage;
        this.managed.forEach((m) => {
            const repLo = this.rep(m, lo);
            const repHi = this.rep(m, hi);
            m.points.visible = false;
            m.twin.material = this.hidden;
            m.mesh.material = this.hidden;
            if (repLo === repHi) {
                this.show(m, repHi, 0, 'primary');
                return;
            }
            this.show(m, repHi, 1, 'primary');
            this.show(m, repLo, 2, 'twin');
            if (m.kind === 'late') {
                const material = firstMaterial(m.real);
                if (material && 'opacity' in material) {
                    material.opacity = m.realOpacity * (repHi === 'real' ? this.front : 1);
                }
            }
        });
    }

    private show(m: Managed, rep: Rep, role: number, slot: 'primary' | 'twin') {
        if (rep === 'none') return;
        if (rep === 'points') {
            m.points.visible = true;
            this.setRole(m.pointsMaterial, role);
            return;
        }
        const material = this.material(m, rep);
        this.setRole(material, role);
        if (slot === 'primary' || rep === 'real') m.mesh.material = material;
        else m.twin.material = material;
    }

    private update() {
        if (this.finished) return;
        const renderer = this.application.renderer.instance;
        renderer.getDrawingBufferSize(shared.uResolution.value);
        if (this.reduced) {
            // no sweeps: the stages switch as they're reached
            if (this.stage < this.target) {
                this.stage = this.target;
                this.apply();
            }
        } else if (this.stage < this.target) {
            const now = performance.now();
            if (!this.sweepStartedAt) {
                this.sweepStartedAt = now;
                this.sweepMs = this.sweepFor(this.target - this.stage);
            }
            const t = Math.min(1, (now - this.sweepStartedAt) / this.sweepMs);
            this.front = easeInOutSine(t);
            shared.uFront.value = this.front;
            if (this.stage + 1 === S.lighting) {
                const monitor = this.application.world.monitorScreen;
                if (monitor) monitor.screenOpacity = this.front;
            }
            if (this.stage + 1 === S.output && this.grain) {
                this.grain.style.opacity = String(GRAIN_OPACITY * this.front);
            }
            if (t >= 1) {
                this.stage++;
                this.sweepStartedAt = 0;
                this.front = 0;
                shared.uFront.value = 0;
            }
            this.apply();
        }
        UIEventBus.dispatch('pipeline:state', this.state());
        if (this.stage === S.output && this.released) this.finish();
    }

    // the live scene, exactly: real materials back, the stand ins gone
    private finish() {
        this.finished = true;
        this.managed.forEach((m) => {
            m.mesh.material = m.real;
            m.mesh.remove(m.points, m.twin);
            m.pointsMaterial.dispose();
            m.wire.dispose();
            m.flat.dispose();
            m.albedo.dispose();
            if (m.kind === 'late') {
                const material = firstMaterial(m.real);
                if (material && 'opacity' in material) material.opacity = m.realOpacity;
            }
        });
        this.managed.clear();
        const monitor = this.application.world.monitorScreen;
        if (monitor) monitor.screenOpacity = 1;
        if (this.grain) this.grain.style.opacity = String(GRAIN_OPACITY);
        this.hidden.dispose();
        mark('handoff');
        UIEventBus.dispatch('pipeline:state', this.state());
    }
}

const isDescendant = (object: THREE.Object3D, root: THREE.Object3D) => {
    for (let node: THREE.Object3D | null = object; node; node = node.parent) {
        if (node === root) return true;
    }
    return false;
};
