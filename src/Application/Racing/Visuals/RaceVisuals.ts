import * as THREE from 'three';
import Application from '../../Application';
import UIEventBus from '../../UI/EventBus';
import type NordschleifeTrack from '../Track/NordschleifeTrack';
import type RaceVehicle from '../Vehicle/RaceVehicle';
import RaceAtmosphere from './RaceAtmosphere';
import RacePostProcessing from './RacePostProcessing';
import {
    detectGpuTier,
    resolvePreset,
    settingsFor,
    type GpuTier,
    type PresetSettings,
    type RacePreset,
} from './qualityPresets';
import RaceTerrain from './RaceTerrain';
import RaceForest from './RaceForest';
import RaceTrackside from './RaceTrackside';
import Sparks from '../Effects/Sparks';
import SkidMarks from '../Effects/SkidMarks';

// everything race mode looks like: sky and light, the land around the road,
// sparks and skid marks, and the post chain it all renders through. the room
// scene is untouched, this swaps renderer settings in on enter and out on exit
const EXPOSURE = 0.95;
// the sky probe is bright, at full strength it washes the woods out
const ENVIRONMENT_INTENSITY = 0.6;

type RenderMode = 'auto' | 'quality' | 'performance';

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
    sparks: Sparks;
    skids: SkidMarks;
    post: RacePostProcessing | null;
    active: boolean;
    renderMode: RenderMode;
    effectsLow: boolean;
    tier: GpuTier;
    preset: RacePreset | null;
    settings: PresetSettings;
    saved: {
        toneMapping: THREE.ToneMapping;
        exposure: number;
        environment: THREE.Texture | null;
        environmentIntensity: number;
    } | null;
    private wheelContact: THREE.Vector3;
    private wheelUp: THREE.Vector3;
    private away: THREE.Vector3;
    private light: THREE.Color;

    constructor(
        parent: THREE.Object3D,
        track: NordschleifeTrack,
        vehicle: RaceVehicle
    ) {
        this.application = new Application();
        this.scene = this.application.scene;
        this.track = track;
        this.vehicle = vehicle;
        this.root = new THREE.Group();
        this.root.name = 'race-visuals';
        parent.add(this.root);
        this.tier = detectGpuTier(
            this.application.renderer.instance.getContext()
        );
        this.preset = null;
        this.settings = settingsFor(this.getPreset(), this.tier);
        // tree count is set once at build time, from the gpu tier
        const lite = this.tier === 'low';
        this.atmosphere = new RaceAtmosphere(this.root);
        this.terrain = new RaceTerrain(this.root, track, lite ? 'low' : 'high');
        this.forest = new RaceForest(
            this.root,
            this.application.renderer.instance,
            track,
            this.terrain,
            lite ? 'low' : 'high'
        );
        this.trackside = new RaceTrackside(this.root, track);
        this.sparks = new Sparks(this.root);
        this.skids = new SkidMarks(this.root);
        this.post = null;
        this.active = false;
        this.renderMode = this.application.renderer.renderMode;
        this.effectsLow = this.application.renderer.effectsLow;
        this.saved = null;
        this.wheelContact = new THREE.Vector3();
        this.wheelUp = new THREE.Vector3();
        this.away = new THREE.Vector3();
        // the smoke is lit by the low sun plus the sky
        this.light = new THREE.Color(1.25, 1.12, 1.0);

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
                this.applyQuality();
            }
        );
    }

    getPreset(): RacePreset {
        return resolvePreset(this.renderMode, this.tier, this.effectsLow);
    }

    applyQuality() {
        const preset = this.getPreset();
        const settings = settingsFor(preset, this.tier);
        this.settings = settings;
        this.post?.applyPreset(settings);
        // flipping this recompiles the lit materials, so only on a change
        if (this.atmosphere.sun.castShadow !== settings.shadows) {
            this.atmosphere.sun.castShadow = settings.shadows;
        }
        this.atmosphere.setShadowSize(settings.shadowSize);
        this.atmosphere.setClouds(settings.post);
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
        if (!this.post) {
            this.post = new RacePostProcessing(
                gl,
                this.scene,
                this.application.camera.instance
            );
        }
        renderer.setSceneRenderer(
            (deltaSeconds) => this.render(deltaSeconds),
            () => this.post?.resize(),
            settingsFor(this.getPreset(), this.tier).maxPixelRatio
        );
        this.applyQuality();
        this.skids.clear();
        this.sparks.clear();
    }

    render(deltaSeconds: number) {
        if (this.settings.post && this.post) {
            this.post.render(
                deltaSeconds,
                this.application.time.elapsed / 1000
            );
            return;
        }
        this.application.renderer.instance.render(
            this.scene,
            this.application.camera.instance
        );
    }

    exit() {
        if (!this.active) return;
        this.active = false;
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

    update(deltaSeconds: number) {
        if (!this.active) return;
        const vehicle = this.vehicle;
        this.atmosphere.follow(vehicle.position);
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

        // sparks where the body scrapes a barrier
        if (vehicle.barrierContact !== 0 && speedKph > 25) {
            const frame = vehicle.trackFrame;
            this.away
                .set(frame.leftX, 0, frame.leftZ)
                .multiplyScalar(-vehicle.barrierContact);
            const count = Math.min(
                10,
                2 + Math.round(speedKph / 40 + vehicle.impact * 2)
            );
            this.sparks.emit(
                vehicle.barrierPoint,
                vehicle.velocity,
                this.away,
                count
            );
        }

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
