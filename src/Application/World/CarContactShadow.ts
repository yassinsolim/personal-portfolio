import * as THREE from 'three';
import { HorizontalBlurShader } from 'three/examples/jsm/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/examples/jsm/shaders/VerticalBlurShader.js';

// the room floor is baked and unlit, so nothing can cast a real shadow on it.
// this renders the car from underneath once when it's prepared (closer to the
// ground = darker), blurs it, and lays it on the floor as a child of the car
const TEXTURE_SIZE = 1024;
const MARGIN = 0.1;
const HEIGHT_FACTOR = 0.5;
const DARKNESS = 1.6;
const OPACITY = 0.85;
const BLUR = 4;
const LIFT = 4;

let depthMaterial: THREE.MeshDepthMaterial | null = null;
let blurQuad: THREE.Mesh | null = null;
const blurCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const horizontalBlur = new THREE.ShaderMaterial(HorizontalBlurShader);
const verticalBlur = new THREE.ShaderMaterial(VerticalBlurShader);
horizontalBlur.depthTest = false;
verticalBlur.depthTest = false;

const getDepthMaterial = () => {
    if (depthMaterial) return depthMaterial;
    // double sided so models without an underbody still block the floor
    depthMaterial = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
    depthMaterial.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
            'gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );',
            `gl_FragColor = vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) * ${DARKNESS.toFixed(2)} );`
        );
    };
    return depthMaterial;
};

const getBlurQuad = () => {
    if (!blurQuad) {
        blurQuad = new THREE.Mesh(
            new THREE.PlaneGeometry(2, 2),
            horizontalBlur
        );
        blurQuad.position.z = -0.5;
        // rendering a bare mesh skips the scene's matrix update
        blurQuad.updateMatrixWorld();
    }
    return blurQuad;
};

const blur = (
    renderer: THREE.WebGLRenderer,
    target: THREE.WebGLRenderTarget,
    scratch: THREE.WebGLRenderTarget,
    amount: number
) => {
    const quad = getBlurQuad();
    quad.material = horizontalBlur;
    horizontalBlur.uniforms.tDiffuse.value = target.texture;
    horizontalBlur.uniforms.h.value = amount / target.width;
    renderer.setRenderTarget(scratch);
    renderer.render(quad, blurCamera);

    quad.material = verticalBlur;
    verticalBlur.uniforms.tDiffuse.value = scratch.texture;
    verticalBlur.uniforms.v.value = amount / target.height;
    renderer.setRenderTarget(target);
    renderer.render(quad, blurCamera);
};

// lift is in the car's world units: the room is in centimeters, race mode in
// meters
export const addContactShadow = (
    renderer: THREE.WebGLRenderer,
    car: THREE.Object3D,
    groundY: number,
    lift = LIFT
) => {
    car.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(car);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const margin = Math.max(size.x, size.z) * MARGIN;
    const width = size.x + margin * 2;
    const depth = size.z + margin * 2;
    const long = Math.max(width, depth);
    const texWidth = Math.round((TEXTURE_SIZE * width) / long);
    const texHeight = Math.round((TEXTURE_SIZE * depth) / long);

    // looking straight up from the floor, so image right is +x and image up is +z
    const camera = new THREE.OrthographicCamera(
        -width / 2,
        width / 2,
        depth / 2,
        -depth / 2,
        0,
        size.y * HEIGHT_FACTOR
    );
    camera.position.set(center.x, groundY, center.z);
    camera.rotation.x = Math.PI / 2;
    camera.updateMatrixWorld();

    const target = new THREE.WebGLRenderTarget(texWidth, texHeight);
    const scratch = new THREE.WebGLRenderTarget(texWidth, texHeight);
    const scene = new THREE.Scene();
    scene.overrideMaterial = getDepthMaterial();

    const previousTarget = renderer.getRenderTarget();
    const previousColor = renderer.getClearColor(new THREE.Color());
    const previousAlpha = renderer.getClearAlpha();
    const parent = car.parent;
    renderer.setClearColor(0x000000, 0);
    scene.add(car);
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    scene.remove(car);
    parent?.add(car);
    blur(renderer, target, scratch, BLUR);
    blur(renderer, target, scratch, BLUR * 0.4);

    // read it back so the shadow is a plain texture: no render targets kept
    // alive per cached car, and the scene exporter can handle it
    const pixels = new Uint8Array(texWidth * texHeight * 4);
    renderer.readRenderTargetPixels(target, 0, 0, texWidth, texHeight, pixels);
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousColor, previousAlpha);
    target.dispose();
    scratch.dispose();

    const texture = new THREE.DataTexture(pixels, texWidth, texHeight);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;

    const geometry = new THREE.PlaneGeometry(width, depth).rotateX(
        -Math.PI / 2
    );
    const uv = geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) {
        uv.setY(i, 1 - uv.getY(i));
    }
    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: OPACITY,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -4,
    });
    const shadow = new THREE.Mesh(geometry, material);
    shadow.name = 'car_contact_shadow';
    shadow.raycast = () => {};

    const world = new THREE.Matrix4().makeTranslation(
        center.x,
        groundY + lift,
        center.z
    );
    car.matrixWorld
        .clone()
        .invert()
        .multiply(world)
        .decompose(shadow.position, shadow.quaternion, shadow.scale);
    car.add(shadow);
    return shadow;
};
