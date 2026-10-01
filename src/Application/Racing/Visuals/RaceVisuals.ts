import * as THREE from 'three';
import Application from '../../Application';
import UIEventBus from '../../UI/EventBus';
import type NordschleifeTrack from '../Track/NordschleifeTrack';
import type RaceVehicle from '../Vehicle/RaceVehicle';
import RaceAtmosphere from './RaceAtmosphere';
import RacePostProcessing from './RacePostProcessing';
import {
    detectGpu,
    isSoftwareGl,
    resolvePreset,
    settingsFor,
    type GpuTier,
    type PresetSettings,
    type RacePreset,
} from './qualityPresets';
import {
    calibrate,
    readSlowHint,
    writeSlowHint,
    type GpuClass,
} from '../../Utils/gpuClass';
import RaceTerrain from './RaceTerrain';
import RaceForest from './RaceForest';
import RaceTrackside from './RaceTrackside';
import RaceTracksideExtras from './RaceTracksideExtras';
import Sparks from '../Effects/Sparks';
import SkidMarks from '../Effects/SkidMarks';
import { useCheapMaterials } from './cheapMaterials';
import { applyRevealTo, applySkyReveal } from './reveal';
import RaceReveal from './RaceReveal';
import { afterFrame, drain, slice, type Steps } from '../slicing';

// everything race mode looks like: sky and light, the land around the road,
// sparks and skid marks, and the post chain it all renders through. the room
// scene is untouched, this swaps renderer settings in on enter and out on exit
const EXPOSURE = 0.95;
// the sky probe is bright, at full strength it washes the woods out. its sun
// haze is capped (glare off the car), so it runs a little higher than it did
const ENVIRONMENT_INTENSITY = 0.75;
// streaming the race world's uploads: a spare layer (1 is the collider, 3
// the trees' shadow casters) and meshes per frame
const UPLOAD_LAYER = 6;
const UPLOAD_BATCH = 24;
// materials per program compile while prewarming
const COMPILE_BATCH = 6;

type RenderMode = 'auto' | 'quality' | 'performance';

// auto's governor: the frame times it steps down or up at, and how long
// they have to hold
const AUTO_CHECK_MS = 1000;
const AUTO_SLOW_MS = 21.5;
const AUTO_FAST_MS = 13;
const AUTO_FAST_WORK_MS = 9;
const AUTO_DOWN_AFTER_MS = 4000;
const AUTO_DOWN_GAP_MS = 8000;
const AUTO_UP_AFTER_MS = 20000;
const AUTO_UP_GAP_MS = 30000;
// a barrier hit (m/s taken out at the contact) that bursts sparks and flashes
const HIT_MIN_IMPACT = 1.5;
const HIT_GAP_MS = 150;

const freezeStatic = (root: THREE.Object3D) => {
    root.traverse((object) => {
        if (object.name === 'nordschleife-collider-ray-debug') return;
        object.updateMatrix();
        object.matrixAutoUpdate = false;
    });
    root.updateMatrixWorld(true);
};

// a lap and what's built around it: the land, trees and trackside
export type TrackWorld = {
    track: NordschleifeTrack;
    terrain: RaceTerrain;
    forest: RaceForest;
    trackside: RaceTrackside;
    extras: RaceTracksideExtras;
};

const worldRoots = (world: TrackWorld) => [
    world.track.root,
    world.terrain.root,
    world.forest.root,
    world.trackside.root,
    world.extras.root,
];

export default class RaceVisuals {
    application: Application;
    scene: THREE.Scene;
    track: NordschleifeTrack;
    vehicle: RaceVehicle;
    root: THREE.Group;
    atmosphere: RaceAtmosphere;
    terrain: RaceTerrain;
    forest: RaceForest;
    trackside: RaceTrackside;
    extras: RaceTracksideExtras;
    sparks: Sparks;
    skids: SkidMarks;
    post: RacePostProcessing | null;
    active: boolean;
    renderMode: RenderMode;
    effectsLow: boolean;
    tier: GpuTier;
    // the gpu is high tier but the homepage or an old slow race made it low
    calibratedDown = false;
    // software gl: shader compiles take seconds, the transition does them
    // where nothing on screen moves
    software: boolean;
    // what auto found and why, for the graphics info panel
    gpu: GpuClass & { renderer: string; vendor: string; forced: boolean };
    // auto's steps down from the tier it started at: 1 is the performance
    // preset, 2 the light limits on top
    autoStep: number;
    autoSlowMs: number;
    autoFastMs: number;
    autoChangedAt: number;
    autoCheckedAt: number;
    singlePassModel: THREE.Object3D | null;
    preset: RacePreset | null;
    settings: PresetSettings;
    saved: {
        toneMapping: THREE.ToneMapping;
        exposure: number;
        environment: THREE.Texture | null;
        environmentIntensity: number;
    } | null;
    raceRoot: THREE.Object3D;
    reveal: RaceReveal;
    prewarming: Promise<void> | null = null;
    private prewarmKey = '';
    private uploads: {
        camera: THREE.PerspectiveCamera;
        textures: THREE.Texture[];
        batches: THREE.Mesh[][];
    } | null = null;
    private uploadTarget: THREE.WebGLRenderTarget | null = null;
    private texturesSent = new WeakSet<THREE.Texture>();
    private revealBackground: THREE.Color;
    private wheelContact: THREE.Vector3;
    private wheelUp: THREE.Vector3;
    private away: THREE.Vector3;
    private light: THREE.Color;
    // barrier sparks: fractional sparks owed, and the last frame's contact
    private sparkDebt = 0;
    private scraping = false;
    private lastImpact = 0;
    private lastHitAt = 0;
    private hitPoint = new THREE.Vector3();

    // built when constructed, or with defer by running pending
    pending: Steps;

    constructor(
        parent: THREE.Object3D,
        track: NordschleifeTrack,
        vehicle: RaceVehicle,
        defer = false
    ) {
        this.pending = this.build(parent, track, vehicle);
        if (!defer) drain(this.pending);
    }

    private *build(
        parent: THREE.Object3D,
        track: NordschleifeTrack,
        vehicle: RaceVehicle
    ): Steps {
        this.application = new Application();
        this.scene = this.application.scene;
        this.track = track;
        this.vehicle = vehicle;
        this.raceRoot = parent;
        this.root = new THREE.Group();
        this.root.name = 'race-visuals';
        parent.add(this.root);
        const renderer = this.application.renderer;
        const found = detectGpu(renderer.instance.getContext());
        const home = renderer.frameStats.home;
        this.renderMode = renderer.renderMode;
        // an explicit quality pick gets the world the gpu itself earned: the
        // homepage timing and an old slow race only steer auto
        this.gpu =
            found.forced || this.renderMode === 'quality'
                ? found
                : {
                      ...found,
                      ...calibrate(found, {
                          homeP50: home.percentile(0.5),
                          homeFrames: home.count,
                          slowBefore: readSlowHint(found.renderer),
                      }),
                  };
        this.tier = this.gpu.tier;
        this.calibratedDown = found.tier === 'high' && this.tier === 'low';
        this.autoStep = 0;
        this.autoSlowMs = 0;
        this.autoFastMs = 0;
        this.autoChangedAt = 0;
        this.autoCheckedAt = 0;
        this.singlePassModel = null;
        this.software = isSoftwareGl(this.application.renderer.instance.getContext());
        this.preset = null;
        this.settings = settingsFor(this.getPreset(), this.tier);
        // tree count is set once at build time, from the gpu tier
        const lite = this.tier === 'low';
        this.atmosphere = new RaceAtmosphere(this.root);
        yield 'visuals:atmosphere';
        this.terrain = new RaceTerrain(this.root, track, lite ? 'low' : 'high', true);
        yield* this.terrain.pending;
        this.forest = new RaceForest(
            this.root,
            this.application.renderer.instance,
            track,
            this.terrain,
            lite ? 'low' : 'high',
            true
        );
        yield* this.forest.pending;
        this.trackside = new RaceTrackside(this.root, track, lite, true);
        yield* this.trackside.pending;
        this.extras = new RaceTracksideExtras(this.root, track, this.terrain, lite, true);
        yield* this.extras.pending;
        this.sparks = new Sparks(this.root);
        this.skids = new SkidMarks(this.root);
        this.post = null;
        this.active = false;
        this.effectsLow = this.application.renderer.effectsLow;
        this.saved = null;
        this.wheelContact = new THREE.Vector3();
        this.wheelUp = new THREE.Vector3();
        this.away = new THREE.Vector3();
        // the smoke is lit by the low sun plus the sky
        this.light = new THREE.Color(1.25, 1.12, 1.0);

        if (lite) {
            vehicle.useCheapMaterials();
            useCheapMaterials(track.root);
            useCheapMaterials(this.trackside.root);
            useCheapMaterials(this.extras.root);
        }
        yield 'visuals:misc';
        // the homepage transition builds the ring out from the car. one set
        // of uniforms in every race world material, so whatever else lands
        // in the race root joins in (prepareReveal catches late additions)
        this.reveal = new RaceReveal(this.atmosphere.fog.color, EXPOSURE);
        this.revealBackground = new THREE.Color();
        applyRevealTo(parent, this.reveal.uniforms);
        applySkyReveal(this.atmosphere.sky.material, this.reveal.skyHaze, this.reveal.sky);
        yield 'visuals:reveal';
        // none of this moves once built, so its matrices needn't be redone
        // every frame (about 800 objects)
        [
            this.terrain.root,
            this.forest.root,
            this.trackside.root,
            this.extras.root,
            track.root,
        ].forEach(freezeStatic);

        UIEventBus.on(
            'render:effects',
            (state: { low?: boolean } | undefined) => {
                this.effectsLow = Boolean(state?.low);
                this.applyQuality();
            }
        );
        UIEventBus.on(
            'race:qualityChange',
            (state: { mode?: RenderMode } | undefined) => {
                this.renderMode =
                    state?.mode === 'quality' || state?.mode === 'performance'
                        ? state.mode
                        : 'auto';
                // the world stays as built, the car can come back now
                if (this.renderMode === 'quality' && this.calibratedDown)
                    this.vehicle.useFullMaterials();
                this.applyQuality();
            }
        );
    }

    getPreset(): RacePreset {
        return resolvePreset(
            this.renderMode,
            this.tier,
            this.effectsLow ||
                (this.renderMode === 'auto' && this.autoStep >= 1)
        );
    }

    world(): TrackWorld {
        return {
            track: this.track,
            terrain: this.terrain,
            forest: this.forest,
            trackside: this.trackside,
            extras: this.extras,
        };
    }

    // another lap's land, trees and trackside, built the way the ring's are.
    // it starts hidden, useWorld puts it in place of the one showing
    *buildWorld(track: NordschleifeTrack): Generator<string | void, TrackWorld, void> {
        const lite = this.tier === 'low';
        const terrain = new RaceTerrain(this.root, track, lite ? 'low' : 'high', true);
        yield* terrain.pending;
        const forest = new RaceForest(
            this.root,
            this.application.renderer.instance,
            track,
            terrain,
            lite ? 'low' : 'high',
            true
        );
        yield* forest.pending;
        const trackside = new RaceTrackside(this.root, track, lite, true);
        yield* trackside.pending;
        const extras = new RaceTracksideExtras(this.root, track, terrain, lite, true);
        yield* extras.pending;
        if (lite) {
            useCheapMaterials(track.root);
            useCheapMaterials(trackside.root);
            useCheapMaterials(extras.root);
        }
        const world = { track, terrain, forest, trackside, extras };
        worldRoots(world).forEach((root) => {
            freezeStatic(root);
            root.visible = false;
        });
        yield 'visuals:world';
        return world;
    }

    useWorld(world: TrackWorld) {
        worldRoots(this.world()).forEach((root) => (root.visible = false));
        this.track = world.track;
        this.terrain = world.terrain;
        this.forest = world.forest;
        this.trackside = world.trackside;
        this.extras = world.extras;
        worldRoots(world).forEach((root) => (root.visible = true));
        this.skids.clear();
        this.sparks.clear();
        this.applyQuality();
    }

    // the tier the settings follow: auto's second step puts a gpu it built
    // the full world for on the light limits
    settingsTier(): GpuTier {
        return this.renderMode === 'auto' && this.autoStep >= 2
            ? 'low'
            : this.tier;
    }

    // once a second in auto: step down when frames stay long after the
    // resolution has done what it can (or the cpu is what's slow), step back
    // up only after a long run with headroom. never in a manual mode
    updateAuto() {
        const now = performance.now();
        if (now - this.autoCheckedAt < AUTO_CHECK_MS) return;
        const elapsed = this.autoCheckedAt ? now - this.autoCheckedAt : 0;
        this.autoCheckedAt = now;
        if (this.renderMode !== 'auto' || this.gpu.forced) return;
        const renderer = this.application.renderer;
        const stats = renderer.frameStats.summary(90);
        if (stats.frames < 20) return;
        const slow = stats.frameP50 > AUTO_SLOW_MS;
        // at a capped refresh rate the frame time can't show headroom, the
        // work inside it can
        const work = Math.max(stats.cpuP50, stats.gpuP50 ?? 0);
        const fast =
            stats.frameP50 < AUTO_FAST_MS ||
            (stats.gpuP50 !== null && work < AUTO_FAST_WORK_MS);
        this.autoSlowMs = slow ? this.autoSlowMs + elapsed : 0;
        this.autoFastMs = fast ? this.autoFastMs + elapsed : 0;
        // light because of an old slow race, and fast now: the next visit
        // measures the full world again
        if (
            this.calibratedDown &&
            this.autoStep === 0 &&
            this.autoFastMs >= AUTO_UP_AFTER_MS &&
            readSlowHint(this.gpu.renderer)
        )
            writeSlowHint(this.gpu.renderer, false);
        const adaptive = renderer.adaptive;
        const scaled = adaptive.ratio <= adaptive.min + 0.051;
        if (
            this.autoStep < 2 &&
            this.autoSlowMs >= AUTO_DOWN_AFTER_MS &&
            now - this.autoChangedAt > AUTO_DOWN_GAP_MS &&
            (scaled ||
                stats.bound === 'cpu' ||
                stats.frameP50 > AUTO_SLOW_MS * 2.5)
        ) {
            this.setAutoStep(this.autoStep + 1, now);
        } else if (
            this.autoStep > 0 &&
            this.autoFastMs >= AUTO_UP_AFTER_MS &&
            now - this.autoChangedAt > AUTO_UP_GAP_MS
        ) {
            this.setAutoStep(this.autoStep - 1, now);
        }
    }

    setAutoStep(step: number, now: number) {
        this.autoStep = step;
        this.autoChangedAt = now;
        this.autoSlowMs = 0;
        this.autoFastMs = 0;
        writeSlowHint(this.gpu.renderer, step >= 2);
        const renderer = this.application.renderer;
        renderer.frameStats.reset();
        renderer.adaptive.reset();
        this.applyQuality();
        UIEventBus.dispatch('race:autoStep', { step });
    }

    // three draws a transparent double sided material twice a frame (backs,
    // then fronts), rebuilding its program lookup both times. the car's glass
    // is 17 of those; one pass looks the same from outside
    singlePassGlass() {
        const model = this.vehicle.carModel;
        if (!model || model === this.singlePassModel) return;
        this.singlePassModel = model;
        model.traverse((object) => {
            const mesh = object as THREE.Mesh;
            if (!mesh.isMesh) return;
            (Array.isArray(mesh.material)
                ? mesh.material
                : [mesh.material]
            ).forEach((material) => {
                if (material.transparent && material.side === THREE.DoubleSide)
                    material.forceSinglePass = true;
            });
        });
    }

    applyQuality() {
        const preset = this.getPreset();
        const settings = settingsFor(preset, this.settingsTier());
        this.settings = settings;
        this.post?.applyPreset(settings);
        // flipping this recompiles the lit materials, so only on a change
        if (this.atmosphere.sun.castShadow !== settings.shadows) {
            this.atmosphere.sun.castShadow = settings.shadows;
        }
        this.atmosphere.setShadowSize(settings.shadowSize);
        this.atmosphere.setClouds(settings.post);
        document.body.classList.toggle(
            'race-lite',
            this.active && (this.tier === 'low' || preset === 'performance')
        );
        if (this.active) {
            this.atmosphere.setDistance(
                settings.drawDistance,
                settings.sky,
                this.scene
            );
            UIEventBus.dispatch('race:drawDistance', {
                far: settings.drawDistance,
            });
        }
        this.forest.applyPreset(settings);
        if (this.active) {
            this.application.renderer.setSceneMaxPixelRatio(
                settings.maxPixelRatio
            );
        }
        if (preset !== this.preset) {
            this.preset = preset;
            UIEventBus.dispatch('race:preset', { preset });
        }
        this.application.renderer.raceGraphics = {
            tier: this.settingsTier(),
            reason: this.gpu.reason,
            forced: this.gpu.forced,
            preset,
            autoStep: this.autoStep,
        };
    }

    enter() {
        if (this.active) return;
        this.active = true;
        const renderer = this.application.renderer;
        const gl = renderer.instance;
        this.saved = {
            toneMapping: gl.toneMapping,
            exposure: gl.toneMappingExposure,
            environment: this.scene.environment,
            environmentIntensity: this.scene.environmentIntensity,
        };
        gl.toneMapping = THREE.AgXToneMapping;
        gl.toneMappingExposure = EXPOSURE;
        this.scene.environment = this.atmosphere.buildEnvironment(gl);
        this.scene.environmentIntensity = ENVIRONMENT_INTENSITY;
        this.scene.background = null;
        this.scene.fog = this.atmosphere.fog;
        this.vehicle.smoke.setLight(this.light);
        this.ensurePost();
        renderer.setSceneRenderer(
            (deltaSeconds) => this.render(deltaSeconds),
            () => this.post?.resize(),
            settingsFor(this.getPreset(), this.settingsTier()).maxPixelRatio
        );
        this.applyQuality();
        this.atmosphere.sun.shadow.intensity = this.reveal.shadows;
        this.skids.clear();
        this.sparks.clear();
    }

    // the race world's first frame uploads every buffer and texture it draws
    // (tens of ms, far more in webkit). the homepage transition streams them
    // during its camera move instead: from where the race camera starts, a
    // texture and a batch of meshes a frame, drawn into a tiny target in
    // the race's own state (its lights, sky, fog, tone mapping) so nothing
    // new compiles. only the batch and the race lights are on the camera's
    // layer
    streamStart(position: THREE.Vector3, look: THREE.Vector3, up: THREE.Vector3, fov: number, aspect: number) {
        const camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, this.settings.drawDistance || 16000);
        camera.position.copy(position);
        camera.up.copy(up);
        camera.lookAt(look);
        camera.updateMatrixWorld();
        camera.layers.set(UPLOAD_LAYER);
        // the trees the first frames draw
        this.forest.update(camera, this.vehicle.position, 0);
        const meshes: THREE.Mesh[] = [];
        this.raceRoot.traverse((node) => {
            const mesh = node as THREE.Mesh;
            if (mesh.isMesh && mesh.layers.isEnabled(0)) meshes.push(mesh);
        });
        const batches: THREE.Mesh[][] = [];
        for (let i = 0; i < meshes.length; i += UPLOAD_BATCH) batches.push(meshes.slice(i, i + UPLOAD_BATCH));
        const sent = this.texturesSent;
        this.uploads = {
            camera,
            textures: this.raceTextures().filter((texture) => !sent.has(texture)),
            batches,
        };
    }

    // true while there's more to stream. one thing a frame: a texture (the
    // hover prewarm has usually sent them already, a big canvas one takes
    // webkit ~20 ms) or a batch of meshes
    streamStep() {
        const uploads = this.uploads;
        if (!uploads) return false;
        const texture = uploads.textures.shift();
        if (texture) this.application.renderer.instance.initTexture(texture);
        else {
            const batch = uploads.batches.shift();
            if (batch) this.drawForUpload(batch, uploads.camera);
        }
        if (!uploads.textures.length && !uploads.batches.length) this.uploads = null;
        return Boolean(this.uploads);
    }

    // every texture the race world draws with, sent to the gpu (a no op for
    // ones already there)
    raceTextures() {
        const textures = new Set<THREE.Texture>();
        this.raceRoot.traverse((node) => {
            const mesh = node as THREE.Mesh;
            if (!mesh.isMesh || !mesh.layers.isEnabled(0)) return;
            (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((material) => {
                Object.values(material).forEach((value) => {
                    const texture = value as THREE.Texture & { isRenderTargetTexture?: boolean };
                    if (texture?.isTexture && !texture.isRenderTargetTexture) textures.add(texture);
                });
            });
        });
        return [...textures];
    }

    private drawForUpload(batch: THREE.Mesh[], camera: THREE.Camera) {
        const gl = this.application.renderer.instance;
        const settings = settingsFor(this.getPreset(), this.tier);
        const lights = [this.atmosphere.sun, this.atmosphere.hemi];
        batch.forEach((mesh) => mesh.layers.enable(UPLOAD_LAYER));
        lights.forEach((light) => light.layers.enable(UPLOAD_LAYER));
        const saved = {
            raceVisible: this.raceRoot.visible,
            environment: this.scene.environment,
            environmentIntensity: this.scene.environmentIntensity,
            fog: this.scene.fog,
            background: this.scene.background,
            toneMapping: gl.toneMapping,
            exposure: gl.toneMappingExposure,
            castShadow: this.atmosphere.sun.castShadow,
            target: gl.getRenderTarget(),
            viewport: gl.getViewport(new THREE.Vector4()),
        };
        this.raceRoot.visible = true;
        this.scene.environment = this.atmosphere.buildEnvironment(gl);
        this.scene.environmentIntensity = ENVIRONMENT_INTENSITY;
        this.scene.fog = this.atmosphere.fog;
        this.scene.background = null;
        gl.toneMapping = THREE.AgXToneMapping;
        gl.toneMappingExposure = EXPOSURE;
        this.atmosphere.sun.castShadow = settings.shadows;
        // into the kind of target race mode draws into. straight to the
        // screen, one pixel of it, which the frame's own draw then covers
        if (settings.post) {
            if (!this.uploadTarget) {
                this.uploadTarget = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
            }
            gl.setRenderTarget(this.uploadTarget);
        } else {
            gl.setRenderTarget(null);
            gl.setViewport(0, 0, 1, 1);
        }
        try {
            gl.render(this.scene, camera);
        } finally {
            gl.setRenderTarget(saved.target);
            gl.setViewport(saved.viewport);
            this.raceRoot.visible = saved.raceVisible;
            this.scene.environment = saved.environment;
            this.scene.environmentIntensity = saved.environmentIntensity;
            this.scene.fog = saved.fog;
            this.scene.background = saved.background;
            gl.toneMapping = saved.toneMapping;
            gl.toneMappingExposure = saved.exposure;
            this.atmosphere.sun.castShadow = saved.castShadow;
            batch.forEach((mesh) => mesh.layers.disable(UPLOAD_LAYER));
            lights.forEach((light) => light.layers.disable(UPLOAD_LAYER));
        }
    }

    // the resolution cap race mode will draw with
    maxPixelRatio() {
        return settingsFor(this.getPreset(), this.tier).maxPixelRatio;
    }

    ensurePost() {
        if (this.post) return this.post;
        this.post = new RacePostProcessing(
            this.application.renderer.instance,
            this.scene,
            this.application.camera.instance,
            this.reveal.plateUniforms
        );
        return this.post;
    }

    // things added to the race world since it was built join the reveal.
    // returns how many materials were new
    prepareReveal() {
        return applyRevealTo(this.raceRoot, this.reveal.uniforms);
    }

    // the state race mode draws with, for fn: only its own lights, its sky
    // map and fog, its tone mapping and the post chain's kind of target
    // bound. three keys programs on exactly these, so compiling in it has
    // the race frames find them ready. the stand-in scene carries the sky
    // and fog, the race root brings its lights (it has to be visible for that)
    private inRaceState<T>(fn: (stage: THREE.Scene) => T): T {
        const gl = this.application.renderer.instance;
        const settings = settingsFor(this.getPreset(), this.tier);
        const stage = new THREE.Scene();
        stage.environment = this.atmosphere.buildEnvironment(gl);
        stage.environmentIntensity = ENVIRONMENT_INTENSITY;
        stage.fog = this.atmosphere.fog;
        const saved = {
            raceVisible: this.raceRoot.visible,
            toneMapping: gl.toneMapping,
            exposure: gl.toneMappingExposure,
            castShadow: this.atmosphere.sun.castShadow,
            target: gl.getRenderTarget(),
        };
        this.raceRoot.visible = true;
        gl.toneMapping = THREE.AgXToneMapping;
        gl.toneMappingExposure = EXPOSURE;
        this.atmosphere.sun.castShadow = settings.shadows;
        const target = settings.post
            ? new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType })
            : null;
        gl.setRenderTarget(target);
        try {
            return fn(stage);
        } finally {
            gl.setRenderTarget(saved.target);
            target?.dispose();
            this.raceRoot.visible = saved.raceVisible;
            gl.toneMapping = saved.toneMapping;
            gl.toneMappingExposure = saved.exposure;
            this.atmosphere.sun.castShadow = saved.castShadow;
        }
    }

    // a few materials at a time, each batch done before the next: all of
    // them at once queued so much in the gpu process that the room's next
    // frame waited on it (60 ms and more). the rest have no material for
    // the compile, which is how three skips them
    private async compileRaceWorld(camera: THREE.Camera) {
        const gl = this.application.renderer.instance;
        const drawn: { material: THREE.Material | THREE.Material[] | null }[] = [];
        const materials = new Set<THREE.Material>();
        this.raceRoot.traverse((node) => {
            const object = node as unknown as { material?: THREE.Material | THREE.Material[] | null };
            if (!object.material) return;
            drawn.push(object as { material: THREE.Material | THREE.Material[] });
            (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) =>
                materials.add(material)
            );
        });
        const list = [...materials];
        for (let i = 0; i < list.length; i += COMPILE_BATCH) {
            const batch = new Set(list.slice(i, i + COMPILE_BATCH));
            const kept = drawn.map((object) => object.material);
            drawn.forEach((object, k) => {
                const own = kept[k]!;
                const inBatch = Array.isArray(own) ? own.some((m) => batch.has(m)) : batch.has(own);
                if (!inBatch) object.material = null;
            });
            let pending: Promise<unknown>;
            try {
                pending = this.inRaceState((stage) => gl.compileAsync(this.raceRoot, camera, stage));
            } finally {
                drawn.forEach((object, k) => (object.material = kept[k]));
            }
            await pending;
            await afterFrame();
        }
    }

    // the sun's shadow programs only build in a shadow pass, which links
    // them on the spot (about 60 ms for all of them). so a pass per caster
    // material, around the car's start with the trees there filled in. the
    // lights only compile before each is what sets up the race lights for it
    private *warmShadows(camera: THREE.Camera): Steps {
        if (!settingsFor(this.getPreset(), this.tier).shadows) return;
        const gl = this.application.renderer.instance;
        this.atmosphere.follow(this.vehicle.position);
        this.forest.update(camera, this.vehicle.position, 0);
        this.raceRoot.updateMatrixWorld(true);
        const casters: THREE.Mesh[] = [];
        const groups = new Map<string, THREE.Mesh[]>();
        this.raceRoot.traverse((node) => {
            const mesh = node as THREE.Mesh;
            if (!mesh.isMesh || !mesh.castShadow) return;
            casters.push(mesh);
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            const key = materials.map((material) => material.uuid).join() + mesh.customDepthMaterial?.uuid;
            groups.set(key, [...(groups.get(key) || []), mesh]);
        });
        const lightsOnly = new THREE.Scene();
        yield 'shadows:casters';
        for (const group of groups.values()) {
            casters.forEach((mesh) => (mesh.castShadow = false));
            group.forEach((mesh) => (mesh.castShadow = true));
            try {
                this.inRaceState(() => {
                    gl.compile(lightsOnly, camera, this.raceRoot as THREE.Scene);
                    gl.shadowMap.render([this.atmosphere.sun], this.raceRoot as THREE.Scene, camera);
                });
            } finally {
                casters.forEach((mesh) => (mesh.castShadow = true));
            }
            yield 'shadows:pass';
        }
    }

    // what the first race frame would otherwise do at once: the sky's
    // environment map, the post chain, and every race program, compiled in
    // parallel (off the main thread where the driver can) for the exact state
    // race mode draws with. one step per frame so none of it is a long one.
    // the homepage starts this when the car is hovered
    prewarm(camera: THREE.Camera) {
        // again if the preset moved on since (the room's resolution can drop
        // it to performance) or the car did (the lite car loads late, a
        // garage look adds parts), new programs only
        const settings = settingsFor(this.getPreset(), this.tier);
        const car = this.vehicle.carModel;
        const key = `${settings.post}-${settings.shadows}-${car?.uuid}-${JSON.stringify(this.vehicle.look)}`;
        const added = this.prepareReveal();
        if (this.prewarming && this.prewarmKey === key && !added) return this.prewarming;
        this.prewarmKey = key;
        const gl = this.application.renderer.instance;
        // each step in a task of its own after a frame, not in the frame's
        const frame = afterFrame;
        this.prewarming = this.application.renderer.holdResolution((async () => {
            await frame();
            this.atmosphere.buildEnvironment(gl);
            await frame();
            await this.compileRaceWorld(camera);
            await (settings.post
                ? this.ensurePost().compileAsync(camera, THREE.AgXToneMapping)
                : this.reveal.compileOverlay(gl));
            await slice(this.warmShadows(camera));
            // the first time three draws with a program it reads back its
            // info log and uniform locations, which stalls, and forty at once
            // made the first race frame long. a few a frame now instead
            const programs = gl.info.programs || [];
            for (let i = 0; i < programs.length; i += 6) {
                programs.slice(i, i + 6).forEach((program) => {
                    program.getUniforms();
                    program.getAttributes();
                });
                await frame();
            }
            // and the textures, one a frame while the room is still, not
            // waited for. once the transition streams, it sends the rest
            void (async () => {
                for (const texture of this.raceTextures()) {
                    if (this.uploads || this.active) return;
                    if (this.texturesSent.has(texture)) continue;
                    gl.initTexture(texture);
                    this.texturesSent.add(texture);
                    await frame();
                }
            })();
        })());
        return this.prewarming;
    }

    render(deltaSeconds: number) {
        const reveal = this.reveal;
        const post = this.settings.post ? this.post : null;
        reveal.setOutput(Boolean(post));
        if (post) {
            post.render(deltaSeconds, this.application.time.elapsed / 1000);
            return;
        }
        const gl = this.application.renderer.instance;
        gl.render(this.scene, this.application.camera.instance);
        if (reveal.active) reveal.drawOverlay(gl);
    }

    exit() {
        if (!this.active) return;
        this.active = false;
        this.reveal.finish();
        document.body.classList.remove('race-lite');
        const renderer = this.application.renderer;
        renderer.setSceneRenderer(null, null);
        if (this.saved) {
            renderer.instance.toneMapping = this.saved.toneMapping;
            renderer.instance.toneMappingExposure = this.saved.exposure;
            this.scene.environment = this.saved.environment;
            this.scene.environmentIntensity = this.saved.environmentIntensity;
        }
        this.saved = null;
    }

    // how hard one wheel is sliding or spinning, 0..1
    wheelSlide(index: number) {
        const physics = this.vehicle.physics;
        const spec = physics.spec;
        const lateral = Math.abs(physics.slipAngle[index]);
        const longitudinal = Math.abs(physics.slipRatio[index]);
        const slide =
            (lateral - spec.slipAnglePeak) / (spec.slipAnglePeak * 1.8);
        const spin =
            (longitudinal - spec.slipRatioPeak * 1.3) /
            (spec.slipRatioPeak * 2.5);
        return Math.min(1, Math.max(0, slide, spin));
    }

    // the homepage transition's timeline: shadows fade in, and with no sky
    // shader the background clears from the haze to the fog color
    updateReveal() {
        const reveal = this.reveal;
        reveal.update();
        this.atmosphere.sun.shadow.intensity = reveal.shadows;
        if (!this.settings.sky) {
            this.scene.background = reveal.active
                ? this.revealBackground
                      .copy(reveal.background)
                      .lerp(this.atmosphere.fog.color, reveal.sky.value)
                : this.atmosphere.fog.color;
        }
    }

    update(deltaSeconds: number) {
        if (!this.active) return;
        const vehicle = this.vehicle;
        this.updateAuto();
        this.singlePassGlass();
        this.updateReveal();
        this.atmosphere.follow(vehicle.position);
        this.extras.update(this.application.camera.instance.position);
        this.terrain.update(this.application.camera.instance);
        this.forest.update(
            this.application.camera.instance,
            vehicle.position,
            this.application.time.elapsed / 1000
        );
        const sky = this.atmosphere.sky.material.uniforms;
        if (sky.time) sky.time.value = this.application.time.elapsed / 1000;

        const speedKph =
            Math.hypot(vehicle.speedMps, vehicle.lateralSpeed) * 3.6;
        const streak = Math.min(1, Math.max(0, (speedKph - 120) / 200));
        this.post?.setSpeed(Math.pow(streak, 1.25));

        // sparks where the body grinds a barrier: a stream by the second while
        // it scrapes, and a burst with a flash when it hits
        if (vehicle.barrierContact !== 0 && speedKph > 20) {
            const frame = vehicle.trackFrame;
            this.away
                .set(frame.leftX, 0, frame.leftZ)
                .multiplyScalar(-vehicle.barrierContact);
            const ground = vehicle.position.y - vehicle.rideHeight;
            const point = vehicle.barrierPoint;
            const impact = vehicle.impact;
            const now = this.application.time.elapsed;
            // a scrape keeps touching and letting go: only a real hit flashes
            if (
                impact > HIT_MIN_IMPACT &&
                (!this.scraping || impact > this.lastImpact * 1.5 + 0.5) &&
                now - this.lastHitAt > HIT_GAP_MS
            ) {
                this.lastHitAt = now;
                const strength = Math.min(1, impact / 12 + speedKph / 400);
                this.sparks.burst(point, vehicle.velocity, this.away, strength, ground);
                if (strength > 0.3) {
                    this.hitPoint.set(point.x, ground, point.z);
                    vehicle.smoke.emit(this.hitPoint, strength * 0.8, speedKph / 3.6);
                    vehicle.smoke.emit(this.hitPoint, strength * 0.6, speedKph / 3.6);
                }
            }
            this.sparkDebt += deltaSeconds * Math.min(150, 20 + speedKph * 0.7);
            const count = Math.floor(this.sparkDebt);
            this.sparkDebt -= count;
            if (count > 0)
                this.sparks.emit(
                    point,
                    vehicle.velocity,
                    this.away,
                    count,
                    ground,
                    Math.min(1, speedKph / 250)
                );
            this.scraping = true;
        } else {
            this.scraping = false;
            this.sparkDebt = 0;
        }
        this.lastImpact = vehicle.impact;

        // skid marks under sliding tires on the road
        const up = this.wheelUp
            .set(0, 1, 0)
            .applyQuaternion(vehicle.carPivot.quaternion);
        const wheels = vehicle.getWheelContactPoints();
        wheels.forEach((point, index) => {
            const surface = vehicle.wheelSurfaces[index];
            const onRoad = surface === 'asphalt' || surface === 'kerb';
            const slide =
                vehicle.grounded && onRoad ? this.wheelSlide(index) : 0;
            this.wheelContact.copy(point);
            this.skids.track(index, this.wheelContact, up, slide);
        });
        this.sparks.update(deltaSeconds);
        this.skids.update(deltaSeconds);
    }
}
