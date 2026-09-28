import * as THREE from 'three';
import { TREE_SHADOW_LAYER } from './RaceForest';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

// late afternoon in the eifel: low warm sun, blue haze, long shadows. the sky
// is three's preetham sky, and the same sky baked into a pmrem map lights and
// reflects on everything, so the cars pick up the sunset instead of the room
const SUN_ELEVATION_DEG = 22;
const CLOUD_COVERAGE = 0.4;
const SUN_AZIMUTH_DEG = 212;
const SKY_SCALE = 18000;
const SHADOW_EXTENT = 70;
const SHADOW_DISTANCE = 220;
const FOG_COLOR = new THREE.Color(0xa9b7c6);
const FOG_DENSITY = 0.00042;

export default class RaceAtmosphere {
    root: THREE.Group;
    sky: Sky;
    sun: THREE.DirectionalLight;
    hemi: THREE.HemisphereLight;
    sunDirection: THREE.Vector3;
    environment: THREE.Texture | null;
    fog: THREE.FogExp2;
    shadowSize: number;
    private snap: THREE.Vector3;

    constructor(parent: THREE.Object3D) {
        this.root = new THREE.Group();
        this.root.name = 'race-atmosphere';
        parent.add(this.root);

        const elevation = THREE.MathUtils.degToRad(SUN_ELEVATION_DEG);
        const azimuth = THREE.MathUtils.degToRad(SUN_AZIMUTH_DEG);
        this.sunDirection = new THREE.Vector3().setFromSphericalCoords(
            1,
            Math.PI / 2 - elevation,
            azimuth
        );

        this.sky = new Sky();
        this.sky.name = 'race-sky';
        this.sky.scale.setScalar(SKY_SCALE);
        this.sky.frustumCulled = false;
        this.sky.renderOrder = -10;
        // the sun disc is tens of thousands bright, which floods the bloom
        // over the whole frame. the sky stays under the bloom threshold and
        // only the disc itself runs hot
        this.sky.material.fragmentShader =
            this.sky.material.fragmentShader.replace(
                'gl_FragColor = vec4( texColor, 1.0 );',
                'gl_FragColor = vec4( min( texColor, vec3( SKY_MAX + sundisc * 10.0 ) ), 1.0 );'
            );
        this.sky.material.defines = {
            ...this.sky.material.defines,
            SKY_MAX: '2.0',
        };
        const uniforms = this.sky.material.uniforms;
        uniforms.turbidity.value = 6.5;
        uniforms.rayleigh.value = 1.6;
        uniforms.mieCoefficient.value = 0.004;
        uniforms.mieDirectionalG.value = 0.8;
        uniforms.sunPosition.value.copy(this.sunDirection);
        this.root.add(this.sky);

        // warm, low sun. physical units: the pmrem sky does most of the fill
        this.sun = new THREE.DirectionalLight(0xffdcb8, 2.6);
        this.sun.name = 'race-sun';
        this.sun.castShadow = true;
        // the forest's shadow only casters live on their own layer
        this.sun.shadow.camera.layers.enable(TREE_SHADOW_LAYER);
        this.shadowSize = 2048;
        this.configureShadow(this.shadowSize);
        this.root.add(this.sun);
        this.root.add(this.sun.target);

        this.hemi = new THREE.HemisphereLight(0xa8c0dc, 0x4a5236, 0.55);
        this.hemi.name = 'race-hemi';
        this.root.add(this.hemi);

        this.fog = new THREE.FogExp2(FOG_COLOR.getHex(), FOG_DENSITY);
        this.environment = null;
        this.snap = new THREE.Vector3();
    }

    configureShadow(size: number) {
        const shadow = this.sun.shadow;
        shadow.mapSize.set(size, size);
        shadow.camera.left = -SHADOW_EXTENT;
        shadow.camera.right = SHADOW_EXTENT;
        shadow.camera.top = SHADOW_EXTENT;
        shadow.camera.bottom = -SHADOW_EXTENT;
        shadow.camera.near = 1;
        shadow.camera.far = SHADOW_DISTANCE * 2;
        shadow.bias = -0.0004;
        shadow.normalBias = 0.04;
        shadow.camera.updateProjectionMatrix();
        if (shadow.map) {
            shadow.map.dispose();
            shadow.map = null;
        }
        this.shadowSize = size;
    }

    // a short draw distance pulls the fog in so the far plane is hidden in
    // it (95% fog there), otherwise the normal haze. off: the sky mesh is
    // replaced by the fog color, which on a software rasterizer is most of
    // the frame's cost
    setDistance(drawDistance: number, sky: boolean, scene: THREE.Scene) {
        this.fog.density = Math.max(
            FOG_DENSITY,
            drawDistance > 0 ? 1.75 / drawDistance : 0
        );
        this.sky.visible = sky;
        // the box has to sit inside the far plane, corners included (the
        // shader only uses the view direction, so size doesn't show)
        this.sky.scale.setScalar(
            drawDistance > 0
                ? Math.min(SKY_SCALE, drawDistance * 1.1)
                : SKY_SCALE
        );
        scene.background = sky ? null : this.fog.color;
    }

    // the per pixel cloud noise is the priciest part of the sky
    setClouds(on: boolean) {
        this.sky.material.uniforms.cloudCoverage.value = on
            ? CLOUD_COVERAGE
            : 0;
    }

    setShadowSize(size: number) {
        if (size !== this.shadowSize) this.configureShadow(size);
    }

    // bakes the sky into a prefiltered environment map, once
    buildEnvironment(renderer: THREE.WebGLRenderer) {
        if (this.environment) return this.environment;
        const pmrem = new THREE.PMREMGenerator(renderer);
        const skyScene = new THREE.Scene();
        const sky = new Sky();
        sky.scale.setScalar(1000);
        Object.entries(this.sky.material.uniforms).forEach(([key, uniform]) => {
            const target = sky.material.uniforms[key];
            if (!target) return;
            if (uniform.value?.clone) target.value = uniform.value.clone();
            else target.value = uniform.value;
        });
        // the sun disc itself would blow out every reflection
        if (sky.material.uniforms.showSunDisc) {
            sky.material.uniforms.showSunDisc.value = false;
        }
        skyScene.add(sky);
        // a dark ground so reflections have a horizon under them
        const ground = new THREE.Mesh(
            new THREE.CircleGeometry(900, 24),
            new THREE.MeshBasicMaterial({ color: 0x2c3322 })
        );
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -20;
        skyScene.add(ground);
        const target = pmrem.fromScene(skyScene, 0.02, 0.1, 2000);
        this.environment = target.texture;
        pmrem.dispose();
        sky.geometry.dispose();
        sky.material.dispose();
        ground.geometry.dispose();
        (ground.material as THREE.Material).dispose();
        return this.environment;
    }

    // keeps the shadow camera around the car, snapped to whole shadow texels
    // so the edges don't crawl as it moves
    follow(focus: THREE.Vector3) {
        const texel = (SHADOW_EXTENT * 2) / this.shadowSize;
        this.snap.set(
            Math.round(focus.x / texel) * texel,
            Math.round(focus.y / texel) * texel,
            Math.round(focus.z / texel) * texel
        );
        this.sun.target.position.copy(this.snap);
        this.sun.position
            .copy(this.snap)
            .addScaledVector(this.sunDirection, SHADOW_DISTANCE);
        this.sun.target.updateMatrixWorld();
        this.sky.position.copy(focus);
    }

    getFogColor() {
        return FOG_COLOR;
    }
}
