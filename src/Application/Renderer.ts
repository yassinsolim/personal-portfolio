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
    qualityMode: 'quality' | 'performance';
    lowPowerDevice: boolean;
    mobileDevice: boolean;
    contextLost: boolean;
    contextLostOverlay: HTMLDivElement | null;
    frameSamples: number[];
    lastAdaptiveQualityMs: number;
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
        this.qualityMode = 'quality';
        this.mobileDevice = this.detectMobileDevice();
        this.lowPowerDevice = this.detectLowPowerDevice();
        this.contextLost = false;
        this.contextLostOverlay = null;
        this.frameSamples = [];
        this.lastAdaptiveQualityMs = 0;
        this.debugEnabled = new URLSearchParams(window.location.search).has(
            'debugGame'
        );
        if (this.lowPowerDevice) {
            this.qualityMode = 'performance';
        }

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
        this.instance.setPixelRatio(
            Math.min(this.sizes.pixelRatio, this.getPixelRatioCap())
        );
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
        this.overlayInstance.setPixelRatio(
            Math.min(this.sizes.pixelRatio, this.getPixelRatioCap())
        );
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
        this.applyQualityMode();
    }

    setupQualityListeners() {
        UIEventBus.on(
            'race:qualityChange',
            (state: { mode?: 'quality' | 'performance' } | undefined) => {
                const nextMode =
                    state?.mode === 'performance' ? 'performance' : 'quality';
                if (this.qualityMode === nextMode) return;
                this.qualityMode = nextMode;
                this.applyQualityMode();
                this.resize();
            }
        );
    }

    detectMobileDevice() {
        return (
            window.matchMedia?.('(pointer: coarse)').matches ||
            window.matchMedia?.('(max-width: 820px)').matches ||
            window.matchMedia?.('(max-height: 520px)').matches
        );
    }

    detectLowPowerDevice() {
        const navigatorWithHints = navigator as Navigator & {
            deviceMemory?: number;
        };
        const cores = navigator.hardwareConcurrency || 4;
        const memory = navigatorWithHints.deviceMemory || 4;
        return this.detectMobileDevice() || cores <= 4 || memory <= 4;
    }

    getPixelRatioCap() {
        if (this.qualityMode === 'performance') return 1;
        if (this.mobileDevice) return 1.25;
        return 1.5;
    }

    applyQualityMode() {
        this.overlayInstance.domElement.style.opacity =
            this.qualityMode === 'performance' ? '0.06' : '0.12';
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

    updateAdaptiveQuality() {
        if (this.qualityMode === 'performance') return;
        if (this.time.elapsed < 6000) return;
        if (this.time.elapsed - this.lastAdaptiveQualityMs < 2500) return;

        const frameMs = Math.max(1, this.time.delta);
        this.frameSamples.push(frameMs);
        if (this.frameSamples.length > 90) {
            this.frameSamples.shift();
        }
        if (this.frameSamples.length < 60) return;

        const averageFrameMs =
            this.frameSamples.reduce((sum, value) => sum + value, 0) /
            this.frameSamples.length;
        const averageFps = 1000 / averageFrameMs;
        if (averageFps >= 42) return;

        this.lastAdaptiveQualityMs = this.time.elapsed;
        this.qualityMode = 'performance';
        this.applyQualityMode();
        this.resize();
        UIEventBus.dispatch('race:qualityAutoDowngrade', {
            averageFps,
        });
    }

    resize() {
        this.instance.setSize(this.sizes.width, this.sizes.height);
        this.instance.setPixelRatio(
            Math.min(this.sizes.pixelRatio, this.getPixelRatioCap())
        );

        this.cssInstance.setSize(this.sizes.width, this.sizes.height);

        this.overlayInstance.setSize(this.sizes.width, this.sizes.height);
        this.overlayInstance.setPixelRatio(
            Math.min(this.sizes.pixelRatio, this.getPixelRatioCap())
        );
    }

    update() {
        if (this.contextLost) return;
        this.updateAdaptiveQuality();
        this.application.camera.instance.updateProjectionMatrix();
        if (this.uniforms) {
            this.uniforms.u_time.value = Math.sin(this.time.current * 0.01);
        }

        this.instance.render(this.scene, this.camera.instance);
        this.cssInstance.render(this.cssScene, this.camera.instance);
        this.overlayInstance.render(this.overlayScene, this.camera.instance);
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
                qualityMode: this.qualityMode,
            });
        }
    }
}
