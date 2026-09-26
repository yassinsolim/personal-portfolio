import * as THREE from 'three';
import { CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import Application from './Application';
import Sizes from './Utils/Sizes';
import Camera from './Camera/Camera';
import UIEventBus from './UI/EventBus';
// @ts-ignore
import screenVert from './Shaders/screen/vertex.glsl';
// @ts-ignore
import screenFrag from './Shaders/screen/fragment.glsl';
import Time from './Utils/Time';
import AdaptiveResolution from './Utils/AdaptiveResolution';
import { isLowPowerDevice, isMobileDevice } from './Utils/Device';

type RenderMode = 'auto' | 'quality' | 'performance';

const MIN_PIXEL_RATIO = 0.5;
// once auto has to render below one pixel per css pixel, the extras (film
// grain overlay, heavy drift smoke) switch off too
const EFFECTS_MIN_PIXEL_RATIO = 1;

export default class Renderer {
    application: Application;
    sizes: Sizes;
    scene: THREE.Scene;
    cssScene: THREE.Scene;
    time: Time;
    overlay: THREE.Mesh;
    overlayScene: THREE.Scene;
    camera: Camera;
    overlayInstance: THREE.WebGLRenderer;
    instance: THREE.WebGLRenderer;
    cssInstance: CSS3DRenderer;
    raiseExposure: boolean;
    renderMode: RenderMode;
    adaptive: AdaptiveResolution;
    lastFrameAt: number;
    effectsLow: boolean;
    raceActive: boolean;
    lowPowerDevice: boolean;
    mobileDevice: boolean;
    contextLost: boolean;
    contextLostOverlay: HTMLDivElement | null;
    debugEnabled: boolean;
    uniforms: {
        [uniform: string]: THREE.IUniform<any>;
    };

    constructor() {
        this.application = new Application();
        this.time = this.application.time;
        this.sizes = this.application.sizes;
        this.scene = this.application.scene;
        this.cssScene = this.application.cssScene;
        this.overlayScene = this.application.overlayScene;
        this.camera = this.application.camera;
        this.mobileDevice = isMobileDevice();
        this.lowPowerDevice = isLowPowerDevice();
        this.renderMode = 'auto';
        this.adaptive = new AdaptiveResolution(
            MIN_PIXEL_RATIO,
            this.sizes.pixelRatio,
            this.lowPowerDevice ? 1 : 1.5
        );
        this.lastFrameAt = 0;
        this.effectsLow = false;
        this.raceActive = false;
        this.contextLost = false;
        this.contextLostOverlay = null;
        this.debugEnabled = new URLSearchParams(window.location.search).has(
            'debugGame'
        );

        this.setInstance();
        this.setupQualityListeners();
    }

    setInstance() {
        this.instance = new THREE.WebGLRenderer({
            antialias: !this.lowPowerDevice && !this.mobileDevice,
            alpha: true,
            powerPreference: 'high-performance',
            preserveDrawingBuffer: false,
        });
        // Settings
        // this.instance.physicallyCorrectLights = true;
        this.instance.outputEncoding = THREE.sRGBEncoding;
        // this.instance.toneMapping = THREE.ACESFilmicToneMapping;
        // this.instance.toneMappingExposure = 0.9;
        this.instance.setSize(this.sizes.width, this.sizes.height);
        this.instance.setPixelRatio(this.getPixelRatio());
        this.instance.setClearColor(0x000000, 0.0);

        // Style
        this.instance.domElement.style.position = 'absolute';
        this.instance.domElement.style.zIndex = '1';
        this.instance.domElement.style.top = '0px';

        document.querySelector('#webgl')?.appendChild(this.instance.domElement);
        this.setupContextLossHandlers(this.instance.domElement);

        this.overlayInstance = new THREE.WebGLRenderer({
            antialias: false,
            alpha: true,
            preserveDrawingBuffer: false,
        });
        this.overlayInstance.setSize(this.sizes.width, this.sizes.height);
        this.overlayInstance.setPixelRatio(this.getPixelRatio());
        this.overlayInstance.domElement.style.position = 'absolute';
        this.overlayInstance.domElement.style.top = '0px';
        this.overlayInstance.domElement.style.mixBlendMode = 'soft-light';
        this.overlayInstance.domElement.style.opacity = '0.12';
        // this.overlayInstance.domElement.style.mixBlendMode = 'luminosity';
        // this.overlayInstance.domElement.style.opacity = '1';
        this.overlayInstance.domElement.style.pointerEvents = 'none';
        this.overlayInstance.domElement.style.zIndex = '3';

        document
            .querySelector('#overlay')
            ?.appendChild(this.overlayInstance.domElement);

        this.cssInstance = new CSS3DRenderer();
        this.cssInstance.setSize(this.sizes.width, this.sizes.height);
        this.cssInstance.domElement.style.position = 'absolute';
        this.cssInstance.domElement.style.top = '0px';
        this.cssInstance.domElement.style.zIndex = '0';

        document
            .querySelector('#css')
            ?.appendChild(this.cssInstance.domElement);

        this.uniforms = {
            u_time: { value: 1 },
        };

        this.overlay = new THREE.Mesh(
            new THREE.PlaneGeometry(10000, 10000),
            new THREE.ShaderMaterial({
                vertexShader: screenVert,
                fragmentShader: screenFrag,
                uniforms: this.uniforms,
                depthTest: false,
                depthWrite: false,
            })
        );

        this.overlayScene.add(this.overlay);
        this.applyEffects();
    }

    setupQualityListeners() {
        UIEventBus.on(
            'race:qualityChange',
            (state: { mode?: RenderMode } | undefined) => {
                const mode =
                    state?.mode === 'quality' || state?.mode === 'performance'
                        ? state.mode
                        : 'auto';
                if (this.renderMode === mode) {
                    UIEventBus.dispatch('render:resolution', {
                        mode,
                        ratio: this.getPixelRatio(),
                    });
                    return;
                }
                this.renderMode = mode;
                this.adaptive.reset();
                this.applyPixelRatio();
            }
        );
        // switching scenes spikes frame times, which isn't the steady load
        // the resolution should follow
        UIEventBus.on('carChange', () => this.adaptive.reset());
        UIEventBus.on(
            'raceMode:changed',
            (state: { active?: boolean } | undefined) => {
                const active = Boolean(state?.active);
                if (active === this.raceActive) return;
                this.raceActive = active;
                this.adaptive.reset();
            }
        );
    }

    getPixelRatio() {
        if (this.renderMode === 'quality') return this.sizes.pixelRatio;
        if (this.renderMode === 'performance') {
            return Math.min(this.sizes.pixelRatio, 1);
        }
        return this.adaptive.ratio;
    }

    applyPixelRatio() {
        const ratio = this.getPixelRatio();
        this.instance.setPixelRatio(ratio);
        this.overlayInstance.setPixelRatio(ratio);
        this.applyEffects();
        UIEventBus.dispatch('render:resolution', {
            mode: this.renderMode,
            ratio,
        });
    }

    applyEffects() {
        const low =
            this.renderMode === 'performance' ||
            (this.renderMode === 'auto' &&
                this.adaptive.ratio < EFFECTS_MIN_PIXEL_RATIO - 1e-6);
        this.overlayInstance.domElement.style.display = low ? 'none' : '';
        if (low === this.effectsLow) return;
        this.effectsLow = low;
        UIEventBus.dispatch('render:effects', { low });
    }

    setupContextLossHandlers(canvas: HTMLCanvasElement) {
        canvas.addEventListener('webglcontextlost', (event) => {
            event.preventDefault();
            this.contextLost = true;
            this.showContextLostOverlay();
            UIEventBus.dispatch('graphics:contextLost', {});
        });

        canvas.addEventListener('webglcontextrestored', () => {
            this.contextLost = false;
            this.hideContextLostOverlay();
            this.resize();
            UIEventBus.dispatch('graphics:contextRestored', {});
        });
    }

    showContextLostOverlay() {
        if (this.contextLostOverlay) return;
        const overlay = document.createElement('div');
        overlay.className = 'graphics-context-lost';
        overlay.textContent = 'Graphics context lost. Reload game.';
        overlay.setAttribute('role', 'alert');
        document.body.appendChild(overlay);
        this.contextLostOverlay = overlay;
    }

    hideContextLostOverlay() {
        this.contextLostOverlay?.remove();
        this.contextLostOverlay = null;
    }

    // time frames here instead of time.delta, which is clamped at 50ms
    updateResolution() {
        const now = performance.now();
        const interval = this.lastFrameAt ? now - this.lastFrameAt : 0;
        this.lastFrameAt = now;
        if (this.renderMode !== 'auto' || !interval) return;
        const ratio = this.adaptive.frame(interval, now);
        if (ratio === null) return;
        this.applyPixelRatio();
        if (this.debugEnabled) {
            console.info('[game-debug] resolution', {
                ratio,
                fps: Math.round(this.adaptive.fps * 10) / 10,
            });
        }
    }

    resize() {
        this.adaptive.setBounds(MIN_PIXEL_RATIO, this.sizes.pixelRatio);
        this.adaptive.reset();
        this.instance.setSize(this.sizes.width, this.sizes.height);
        this.cssInstance.setSize(this.sizes.width, this.sizes.height);
        this.overlayInstance.setSize(this.sizes.width, this.sizes.height);
        this.applyPixelRatio();
    }

    update() {
        if (this.contextLost) return;
        this.updateResolution();
        this.application.camera.instance.updateProjectionMatrix();
        if (this.uniforms) {
            this.uniforms.u_time.value = Math.sin(this.time.current * 0.01);
        }

        this.instance.render(this.scene, this.camera.instance);
        this.cssInstance.render(this.cssScene, this.camera.instance);
        if (!this.effectsLow) {
            this.overlayInstance.render(
                this.overlayScene,
                this.camera.instance
            );
        }
        this.overlay.position.copy(this.camera.instance.position);

        if (this.debugEnabled && this.time.elapsed % 1000 < this.time.delta) {
            const fps = Math.round(1000 / Math.max(1, this.time.delta));
            console.info('[game-debug] renderer', {
                fps,
                frameMs: Math.round(this.time.delta * 10) / 10,
                drawCalls: this.instance.info.render.calls,
                geometries: this.instance.info.memory.geometries,
                textures: this.instance.info.memory.textures,
                pixelRatio: this.instance.getPixelRatio(),
                renderMode: this.renderMode,
                measuredFps: Math.round(this.adaptive.fps * 10) / 10,
            });
        }
    }
}
