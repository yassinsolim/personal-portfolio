import * as THREE from 'three';
import Application from '../../Application';
import UIEventBus from '../../UI/EventBus';
import type { LoadStage } from '../../Utils/loadStages';
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
// joins at the stage the frame has reached. once the loading is done, a
// camera move that takes the room over (the hybrid's pull-back, follow())
// drives the stages still to come, so the room is live the frame it settles.
// the end is the room as it always runs: no cut

export const STAGES = ['input', 'vertex', 'primitive', 'raster', 'texture', 'lighting', 'output'] as const;
export type PipelineStageName = (typeof STAGES)[number];
const S = { input: 0, vertex: 1, primitive: 2, raster: 3, texture: 4, lighting: 5, output: 6 };

// the room is one model (World/Room.ts), the car and the flipper come after
const ROOM_MODEL = 'roomModel';
// a sweep, and how long a reached stage stays on screen before the next one
// may start (returning visitors get shorter ones). once the loading is done
// whatever is left has to finish inside CATCH_UP_MS, so the pictures never
// hold the room back by more than that
const WIPE_MS = 360;
const WIPE_FAST_MS = 180;
const DWELL_MS = 220;
const DWELL_FAST_MS = 90;
const CATCH_UP_MS = 300;
const CATCH_UP_FAST_MS = 200;
const MIN_WIPE_MS = 90;
// the stand ins compile while the real materials do; the release waits at
// most this long for them, so they never hold the room back
const STAND_IN_WAIT_MS = 250;
const STAND_IN_REPS = ['points', 'wire', 'flat', 'albedo'] as const;
// the stage each stand in shows at
const REP_STAGE = { points: S.vertex, wire: S.primitive, flat: S.raster, albedo: S.texture };

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

export type PipelineOptions = {
    // the loading screen that owns the moment the room goes live (the hybrid
    // types its command first); default: this dispatches loadingScreenDone
    onRelease?: (catchUpMs: number) => void;
    // the screens that turn on at the lighting stage (World/screens registry
    // names); the one the loader writes on stays lit
    lightScreens?: string[];
};

// eased 0..1 of the camera move the last stages follow
export type PullbackDetail = { progress: () => number };

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
    private downloaded = false;
    private screensHidden = false;
    private built = false;
    private warmed = false;
    private framed = false;
    private reduced = prefersReducedMotion();
    private wipeMs = isReturningVisitor() ? WIPE_FAST_MS : WIPE_MS;
    private dwellMs = isReturningVisitor() ? DWELL_FAST_MS : DWELL_MS;
    private catchUpMs = isReturningVisitor() ? CATCH_UP_FAST_MS : CATCH_UP_MS;
    private stageReachedAt = 0;
    private releasedAt = 0;
    private options: PipelineOptions;
    private hidden = new THREE.MeshBasicMaterial({ visible: false });
    private grain: HTMLDivElement | null = null;
    private grainOpacity = 0;
    private styles = new Map<HTMLElement, string>();
    private standIns: Promise<unknown> | null = null;
    private standInsPrimed = false;
    private dressWait: Promise<void> | null = null;
    private dressed = false;
    // the stages left when the camera move began, and the last announced
    private pull: { progress: () => number; from: number; front: number; announced: number } | null = null;

    constructor(options: PipelineOptions = {}) {
        this.options = options;
        this.application = new Application();

        // the renderer's css film grain layer, faded in at the output stage
        this.grain = this.application.renderer.grain;
        this.grainOpacity = this.application.renderer.grainOpacity;
        this.grain.style.opacity = '0';

        UIEventBus.on('loadedSource', ({ sourceName }: { sourceName: string }) => this.onSource(sourceName));
        UIEventBus.on('load:stage', (stage: LoadStage) => this.onStage(stage));
        // World's build handler was added first, this one runs right after it
        this.application.resources.on('ready', () => this.onBuilt());
        UIEventBus.on('intro:pullback', ({ progress }: PullbackDetail) => this.follow(progress));
        // World.update() calls update(), after the camera and before the draw
    }

    // the camera move that takes the room over after the loading: the stages
    // still to come split its progress, a sweep in flight carries on from
    // where its front is
    private follow(progress: () => number) {
        if (this.finished || this.pull) return;
        const sweeping = this.stage < this.target && this.sweepStartedAt > 0;
        this.pull = {
            progress,
            from: this.stage,
            front: sweeping ? this.front : 0,
            announced: sweeping ? this.stage + 1 : this.stage,
        };
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
    private onSource(name: string) {
        // the room model can be the last file in: then its event comes after
        // the download's, right before the build, too late to stand in
        if (this.built || this.downloaded) return;
        if (name !== ROOM_MODEL) {
            // a second model in (the car or the flipper): the room's triangles
            if (this.roomModels.size) this.raise(S.primitive);
            return;
        }
        if (this.roomModels.has(name)) return;
        const gltf = this.application.resources.items.gltfModel[name];
        if (!gltf) return;
        this.roomModels.add(name);
        // where Room puts it: the model's own transforms, no scale
        this.application.scene.add(gltf.scene);
        this.manageTree(gltf.scene, 'room');
        this.raise(S.vertex);
    }

    private onStage(stage: LoadStage) {
        if (stage.scope !== 'homepage') return;
        // the build is next, in the same task: the stand ins leave the scene
        // for it, or BakedModel would scale them with the room and the car
        // would ground itself on their bounds
        if (stage.stage === 'download' && stage.done && !this.built) {
            this.downloaded = true;
            this.raise(S.primitive);
            // and their own materials back: Room picks each mesh's baked
            // material by the name of the one it has
            this.managed.forEach((m) => {
                m.mesh.remove(m.points, m.twin);
                m.mesh.material = m.real;
            });
        }
        // the room's programs are compiled and it has drawn once
        if (stage.stage === 'ready' && !this.warmed) {
            this.warmed = true;
            this.framed = true;
            const go = () => {
                this.prime();
                this.primeStandIns();
                this.raise(S.texture);
                this.checkLighting();
            };
            if (!this.standIns || this.standInsPrimed) go();
            else
                void Promise.race([this.standIns, new Promise((r) => window.setTimeout(r, STAND_IN_WAIT_MS))]).then(
                    go
                );
        }
    }

    private onBuilt() {
        if (this.built) return;
        this.built = true;
        this.adoptScene();
        this.raise(S.raster);
    }

    // the stand ins' own prime, once: on its own task as soon as they're
    // compiled (so the release doesn't pay for it), or at the release if
    // they were late. only the ones a stage still to come shows
    private primeStandIns() {
        if (this.standInsPrimed || this.finished) return;
        this.standInsPrimed = true;
        const reps = STAND_IN_REPS.filter((rep) => REP_STAGE[rep] > this.stage);
        if (reps.length) this.prime(reps);
    }

    // one draw of the real materials, or of each given stand in, into a
    // single pixel: their programs' first use (uniform lookups) happens now,
    // before the camera moves, not in the frame they appear
    private prime(standIns: (typeof STAND_IN_REPS)[number][] = []) {
        const renderer = this.application.renderer.instance;
        const draw = () => renderer.render(this.application.scene, this.application.camera.instance);
        const restore = this.swapReal();
        const test = renderer.getScissorTest();
        const rect = renderer.getScissor(new THREE.Vector4());
        renderer.setScissorTest(true);
        renderer.setScissor(0, 0, 1, 1);
        try {
            if (!standIns.length) draw();
            standIns.forEach((rep) => {
                this.showAll(rep);
                draw();
            });
        } finally {
            renderer.setScissor(rect);
            renderer.setScissorTest(test);
            restore();
        }
    }

    // every mesh as one stand in, twins too (a twin is a plain mesh, its
    // primary can be instanced), for compiling and priming
    private showAll(rep: (typeof STAND_IN_REPS)[number]) {
        this.managed.forEach((m) => {
            if (m.kind === 'late') return;
            m.points.visible = rep === 'points';
            const material = rep === 'points' ? this.hidden : this.material(m, rep);
            m.mesh.material = material;
            m.twin.visible = true;
            m.twin.material = material;
        });
    }

    // World.warmUp's compile: the stand ins still to come compile alongside
    // the real materials (compileAsync takes its materials when it's called),
    // then the real ones go in for World's own call
    warmUpSwap() {
        const renderer = this.application.renderer.instance;
        const camera = this.application.camera.instance;
        const jobs = STAND_IN_REPS.map((rep) => {
            this.showAll(rep);
            return renderer.compileAsync(this.application.scene, camera);
        });
        this.standIns = Promise.all(jobs).catch(() => undefined);
        void this.standIns.then(() => window.setTimeout(() => this.primeStandIns(), 0));
        return this.swapReal();
    }

    private checkLighting() {
        if (!this.warmed || !this.framed || this.released) return;
        // a returning visitor's car comes into view in its saved look, not
        // stock and then fitted (World.carDressing, capped there)
        const dressing = this.application.world?.carDressing;
        if (dressing && !this.dressed) {
            this.dressWait ||= dressing.then(() => {
                this.dressed = true;
                this.checkLighting();
            });
            return;
        }
        this.raise(S.lighting);
        this.raise(S.output);
        // the work is done: the room takes input now, the last stages finish
        // their sweep over the live scene
        this.released = true;
        this.releasedAt = performance.now();
        mark('ready');
        const catchUp = this.reduced ? 0 : this.catchUpMs;
        if (this.options.onRelease) {
            this.options.onRelease(catchUp);
            return;
        }
        mark('done');
        UIEventBus.dispatch('loadingScreenDone', { variant: 'pipeline', hintAfter: catchUp });
        const ui = document.getElementById('ui');
        if (ui) ui.style.pointerEvents = 'none';
        markIntroSeen();
    }

    private raise(stage: number) {
        this.target = Math.max(this.target, stage);
    }

    // while loading, a full sweep; after it, whatever is left shares the
    // catch up time, so the picture is never far behind what has happened
    private sweepFor(queued: number, now: number) {
        if (!this.released) return this.wipeMs;
        const left = this.releasedAt + this.catchUpMs - now;
        return Math.min(this.wipeMs, Math.max(MIN_WIPE_MS, left / Math.max(1, queued)));
    }

    // the screens that light up late, by registry name
    private screenContainers() {
        const screens = this.application.world.screens;
        return (this.options.lightScreens ?? ['m1', 'm2'])
            .map((name) => screens?.get(name)?.container)
            .filter(Boolean) as HTMLElement[];
    }

    // the build gave the room its baked materials and added the car, the
    // flipper and the steam: take them all in
    private adoptScene() {
        const world = this.application.world;
        const car = world.car?.model;
        const flipper = world.flipper?.model;
        const steam = world.coffeeSteam?.model?.mesh as THREE.Mesh | undefined;
        const room = new Set(world.room?.meshes() ?? []);
        this.managed.forEach((m) => {
            m.real = m.mesh.material;
            m.mesh.add(m.points, m.twin);
        });
        this.screenContainers().forEach((el) => (el.style.opacity = '0'));
        const found: [THREE.Mesh, Kind][] = [];
        this.application.scene.traverse((object) => {
            const mesh = object as THREE.Mesh;
            if (!mesh.isMesh || this.managed.has(mesh) || mesh.userData.pipelineIntroPart) return;
            // the screens' canvas holes always punch through
            if (mesh.name.startsWith('screen_hole_')) return;
            let kind: Kind = 'prop';
            if (mesh === steam || mesh.name === 'car_contact_shadow') kind = 'late';
            else if (car && isDescendant(mesh, car)) kind = 'car';
            else if (room.has(mesh)) kind = 'room';
            else if (flipper && isDescendant(mesh, flipper)) kind = 'prop';
            found.push([mesh, kind]);
        });
        found.forEach(([mesh, kind]) => this.manage(mesh, kind));
        this.apply();
    }

    private manageTree(root: THREE.Object3D, kind: Kind) {
        const meshes: THREE.Mesh[] = [];
        root.traverse((object) => {
            const mesh = object as THREE.Mesh;
            if (mesh.isMesh && !mesh.userData.pipelineIntroPart && !this.managed.has(mesh) && !mesh.name.startsWith('screen_hole_')) {
                meshes.push(mesh);
            }
        });
        meshes.forEach((mesh) => this.manage(mesh, kind));
        this.apply();
    }

    private manage(mesh: THREE.Mesh, kind: Kind) {
        const real = mesh.material;
        const base = firstMaterial(real);
        // hit boxes and hidden quads (the flipper's keys, the room's screen
        // quads) stay out of it
        if (base && base.visible === false) return;
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

    // the real materials in for a moment (World.warmUp's compile, the prime draw)
    swapReal() {
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

    // a change to the car while the stages are up (a returning visitor's
    // look): made on the real materials, then the materials it swapped and
    // the parts it added are taken in like the rest
    alter(change: () => void) {
        if (this.finished) {
            change();
            return;
        }
        const restore = this.swapReal();
        try {
            change();
        } finally {
            this.managed.forEach((m) => {
                m.real = m.mesh.material;
                // a part it hid with an invisible material (a wheel node that
                // is a mesh itself) leaves the stages, or its stand ins show it
                if (firstMaterial(m.real)?.visible === false) this.drop(m);
            });
            const car = this.application.world.car?.model;
            if (car) this.manageTree(car, 'car');
            restore();
        }
    }

    private drop(m: Managed) {
        m.mesh.remove(m.points, m.twin);
        [m.pointsMaterial, m.wire, m.flat, m.albedo].forEach((material) => material.dispose());
        this.managed.delete(m.mesh);
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

    // inline styles written only when they change
    private setStyle(el: HTMLElement, opacity: string) {
        if (this.styles.get(el) === opacity) return;
        this.styles.set(el, opacity);
        el.style.opacity = opacity;
    }

    // the stages left, over the camera move's eased progress: each gets an
    // equal share, the room is live the frame the camera settles
    private followPull() {
        const pull = this.pull as NonNullable<PipelineIntro['pull']>;
        const e = Math.min(1, Math.max(0, pull.progress()));
        const left = S.output - pull.from;
        const announce = (upTo: number) => {
            for (let n = pull.announced + 1; n <= upTo; n++) {
                UIEventBus.dispatch('pipeline:stage', { stage: n, name: STAGES[n] });
            }
            pull.announced = Math.max(pull.announced, upTo);
        };
        const reach = (upTo: number) => {
            while (this.stage < upTo) {
                this.stage++;
                UIEventBus.dispatch('pipeline:reached', { stage: this.stage, name: STAGES[this.stage] });
            }
        };
        if (left <= 0 || e >= 1) {
            announce(S.output);
            reach(S.output);
            this.front = 0;
            shared.uFront.value = 0;
            this.finish();
            return;
        }
        // reduced motion: the stage holds until the cut behind the fade
        if (this.reduced) {
            UIEventBus.dispatch('pipeline:state', this.state());
            return;
        }
        const at = e * left;
        const segment = Math.min(left - 1, Math.floor(at));
        const local = easeInOutSine(at - segment);
        reach(pull.from + segment);
        announce(pull.from + segment + 1);
        this.front = segment === 0 ? pull.front + (1 - pull.front) * local : local;
        shared.uFront.value = this.front;
        const next = this.stage + 1;
        const screens = next === S.lighting ? this.front : this.stage >= S.lighting ? 1 : 0;
        this.screenContainers().forEach((el) => this.setStyle(el, String(screens)));
        if (this.grain) {
            const grain = next === S.output ? this.front : 0;
            this.setStyle(this.grain, String(this.grainOpacity * grain));
        }
        this.apply();
        UIEventBus.dispatch('pipeline:state', this.state());
    }

    update() {
        if (this.finished) return;
        // the screens that light up late are dark from the first frame (World
        // exists by the first tick, not when this is constructed)
        if (!this.screensHidden) {
            this.screensHidden = true;
            this.screenContainers().forEach((el) => (el.style.opacity = '0'));
        }
        const renderer = this.application.renderer.instance;
        renderer.getDrawingBufferSize(shared.uResolution.value);
        if (this.pull) {
            this.followPull();
            return;
        }
        if (this.reduced) {
            // no sweeps: the stages switch as they're reached
            if (this.stage < this.target) {
                for (let next = this.stage + 1; next <= this.target; next++) {
                    UIEventBus.dispatch('pipeline:stage', { stage: next, name: STAGES[next] });
                    UIEventBus.dispatch('pipeline:reached', { stage: next, name: STAGES[next] });
                }
                this.stage = this.target;
                this.apply();
            }
        } else if (this.stage < this.target) {
            const now = performance.now();
            if (!this.sweepStartedAt) {
                // a reached stage gets its moment, unless the loading is done
                const dwell = this.released || this.stage === S.input ? 0 : this.dwellMs;
                if (now - this.stageReachedAt < dwell) {
                    UIEventBus.dispatch('pipeline:state', this.state());
                    return;
                }
                this.sweepStartedAt = now;
                this.sweepMs = this.sweepFor(this.target - this.stage, now);
                UIEventBus.dispatch('pipeline:stage', { stage: this.stage + 1, name: STAGES[this.stage + 1] });
            }
            const t = Math.min(1, (now - this.sweepStartedAt) / this.sweepMs);
            this.front = easeInOutSine(t);
            shared.uFront.value = this.front;
            if (this.stage + 1 === S.lighting) {
                this.screenContainers().forEach((el) => (el.style.opacity = String(this.front)));
            }
            if (this.stage + 1 === S.output && this.grain) {
                this.grain.style.opacity = String(this.grainOpacity * this.front);
            }
            if (t >= 1) {
                this.stage++;
                this.stageReachedAt = now;
                UIEventBus.dispatch('pipeline:reached', { stage: this.stage, name: STAGES[this.stage] });
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
        this.screenContainers().forEach((el) => (el.style.opacity = ''));
        if (this.grain) this.grain.style.opacity = String(this.grainOpacity);
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
