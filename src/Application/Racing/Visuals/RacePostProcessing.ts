import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

import type { PresetSettings } from './qualityPresets';

// one pass for everything after bloom: speed streaks at the screen edges (the
// middle stays sharp), a touch of chromatic aberration out there too, a mild
// grade, vignette and grain, then the renderer's tone map and output color
// space, so there's no separate output pass
const GradeShader = {
    name: 'RaceGradeShader',
    uniforms: {
        tDiffuse: { value: null as THREE.Texture | null },
        uSpeed: { value: 0 },
        uAspect: { value: 1 },
        uTime: { value: 0 },
        uVignette: { value: 0.28 },
        uGrain: { value: 0.018 },
        uAberration: { value: 0.0012 },
        uTaps: { value: 8 },
    },
    vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float uSpeed;
        uniform float uAspect;
        uniform float uTime;
        uniform float uVignette;
        uniform float uGrain;
        uniform float uAberration;
        uniform int uTaps;
        varying vec2 vUv;

        float hash(vec2 p) {
            p = fract(p * vec2(123.34, 456.21));
            p += dot(p, p + 45.32);
            return fract(p.x * p.y);
        }

        void main() {
            // aim a little below center, where the car sits
            vec2 center = vec2(0.5, 0.46);
            vec2 offset = vUv - center;
            float dist = length(offset * vec2(uAspect, 1.0));
            float edge = smoothstep(0.2, 0.85, dist);

            vec3 color = texture2D(tDiffuse, vUv).rgb;
            float streak = uSpeed * edge * 0.075;
            if (streak > 0.0008) {
                vec3 sum = color;
                float weight = 1.0;
                for (int i = 1; i < 12; i++) {
                    if (i >= uTaps) break;
                    float t = float(i) / float(uTaps - 1);
                    float w = 1.0 - t * 0.6;
                    sum += texture2D(tDiffuse, vUv - offset * streak * t).rgb * w;
                    weight += w;
                }
                color = sum / weight;
            }

            float spread = uAberration * edge * (0.4 + uSpeed);
            if (spread > 0.0001) {
                float r = texture2D(tDiffuse, center + offset * (1.0 + spread)).r;
                float b = texture2D(tDiffuse, center + offset * (1.0 - spread)).b;
                color.r = mix(color.r, r, 0.6);
                color.b = mix(color.b, b, 0.6);
            }

            // a warm push in the lights and a little extra saturation
            float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
            color = mix(vec3(luma), color, 1.08);
            color *= mix(vec3(0.97, 0.99, 1.04), vec3(1.04, 1.0, 0.95), clamp(luma * 1.4, 0.0, 1.0));

            float vignette = smoothstep(1.15, 0.3, dist);
            color *= mix(1.0, vignette, uVignette);

            float noise = hash(vUv * 1024.0 + fract(uTime * 13.7)) - 0.5;
            color += noise * uGrain * (0.25 + luma);

            gl_FragColor = vec4(max(color, 0.0), 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
        }
    `,
};

export default class RacePostProcessing {
    renderer: THREE.WebGLRenderer;
    composer: EffectComposer;
    renderPass: RenderPass;
    bloom: UnrealBloomPass;
    grade: ShaderPass;
    samples: number;
    speed: number;
    private plainTarget: THREE.WebGLRenderTarget;
    private sceneTarget: THREE.WebGLRenderTarget;

    constructor(
        renderer: THREE.WebGLRenderer,
        scene: THREE.Scene,
        camera: THREE.Camera
    ) {
        this.renderer = renderer;
        this.samples = 4;
        this.speed = 0;
        const size = renderer.getDrawingBufferSize(new THREE.Vector2());
        this.plainTarget = new THREE.WebGLRenderTarget(size.x, size.y, {
            type: THREE.HalfFloatType,
        });
        this.sceneTarget = new THREE.WebGLRenderTarget(size.x, size.y, {
            type: THREE.HalfFloatType,
            samples: this.samples,
        });
        this.composer = new EffectComposer(renderer, this.plainTarget);
        // the scene renders into the read buffer and only that one needs msaa.
        // render() puts it back as the read buffer after the grade swaps
        this.composer.renderTarget2.dispose();
        this.composer.renderTarget2 = this.sceneTarget;
        this.composer.readBuffer = this.sceneTarget;

        this.renderPass = new RenderPass(scene, camera);
        this.bloom = new UnrealBloomPass(
            new THREE.Vector2(size.x, size.y),
            0.24,
            0.45,
            2.6
        );
        this.grade = new ShaderPass(GradeShader);
        this.composer.addPass(this.renderPass);
        this.composer.addPass(this.bloom);
        this.composer.addPass(this.grade);
        this.resize();
    }

    setCamera(camera: THREE.Camera) {
        this.renderPass.camera = camera;
    }

    applyPreset(settings: PresetSettings) {
        this.bloom.enabled = settings.bloom;
        const uniforms = this.grade.uniforms;
        uniforms.uTaps.value = settings.streakTaps;
        uniforms.uAberration.value = settings.aberration;
        uniforms.uGrain.value = settings.grain;
        if (settings.msaa !== this.samples) {
            this.samples = settings.msaa;
            this.sceneTarget.samples = settings.msaa;
            this.sceneTarget.dispose();
        }
    }

    resize() {
        const size = this.renderer.getSize(new THREE.Vector2());
        this.composer.setPixelRatio(this.renderer.getPixelRatio());
        this.composer.setSize(size.x, size.y);
        // bloom is soft anyway, run it at a quarter of the pixels
        const ratio = this.renderer.getPixelRatio();
        this.bloom.setSize(
            Math.round((size.x * ratio) / 2),
            Math.round((size.y * ratio) / 2)
        );
        this.grade.uniforms.uAspect.value = size.x / Math.max(1, size.y);
    }

    // 0..1: how hard the speed streaks pull
    setSpeed(speed: number) {
        this.speed = speed;
    }

    render(deltaSeconds: number, elapsedSeconds: number) {
        const uniforms = this.grade.uniforms;
        uniforms.uSpeed.value = this.speed;
        uniforms.uTime.value = elapsedSeconds;
        // count the whole frame in renderer.info, not just the last pass
        const info = this.renderer.info;
        info.autoReset = false;
        info.reset();
        this.composer.render(deltaSeconds);
        info.autoReset = true;
        if (this.composer.readBuffer !== this.sceneTarget)
            this.composer.swapBuffers();
    }

    dispose() {
        this.composer.dispose();
        this.plainTarget.dispose();
        this.sceneTarget.dispose();
        this.bloom.dispose();
    }
}
