import * as THREE from 'three';
import { CopyShader } from 'three/examples/jsm/shaders/CopyShader.js';
import { HorizontalBlurShader } from 'three/examples/jsm/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/examples/jsm/shaders/VerticalBlurShader.js';

// the room floor is baked and unlit, so nothing can cast a real shadow on it.
// this renders the car from underneath once when it's prepared (closer to the
// ground = darker), blurs it, and lays it on the floor as a child of the car
const TEXTURE_SIZE = 1024;
// the blur runs at half size with its taps one texel apart: stretched taps
// left offset copies of thin parts along the edges, the streaks
const BLUR_SCALE = 0.5;
const BLUR_PASSES = 9;
const MARGIN = 0.1;
const HEIGHT_FACTOR = 0.5;
const DARKNESS = 1.6;
const OPACITY = 0.85;
const LIFT = 4;

let depthMaterial: THREE.MeshDepthMaterial | null = null;
let quad: THREE.Mesh | null = null;
const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
// own uniforms: the shader objects are shared with the race's passes
const pass = (shader: {
    uniforms: Record<string, THREE.IUniform>;
    vertexShader: string;
    fragmentShader: string;
}) =>
    new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.clone(shader.uniforms),
        vertexShader: shader.vertexShader,
        fragmentShader: shader.fragmentShader,
        depthTest: false,
    });
const horizontalBlur = pass(HorizontalBlurShader);
const verticalBlur = pass(VerticalBlurShader);
const copy = pass(CopyShader);

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

const getQuad = () => {
    if (!quad) {
        quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), copy);
        quad.position.z = -0.5;
        // rendering a bare mesh skips the scene's matrix update
        quad.updateMatrixWorld();
    }
    return quad;
};

const draw = (
    renderer: THREE.WebGLRenderer,
    material: THREE.ShaderMaterial,
    target: THREE.WebGLRenderTarget
) => {
    const mesh = getQuad();
    mesh.material = material;
    renderer.setRenderTarget(target);
    renderer.render(mesh, quadCamera);
};

const blur = (
    renderer: THREE.WebGLRenderer,
    target: THREE.WebGLRenderTarget,
    scratch: THREE.WebGLRenderTarget,
    passes: number
) => {
    horizontalBlur.uniforms.h.value = 1 / target.width;
    verticalBlur.uniforms.v.value = 1 / target.height;
    for (let i = 0; i < passes; i++) {
        horizontalBlur.uniforms.tDiffuse.value = target.texture;
        draw(renderer, horizontalBlur, scratch);
        verticalBlur.uniforms.tDiffuse.value = scratch.texture;
        draw(renderer, verticalBlur, target);
    }
};

const copyInto = (
    renderer: THREE.WebGLRenderer,
    source: THREE.WebGLRenderTarget,
    target: THREE.WebGLRenderTarget
) => {
    copy.uniforms.tDiffuse.value = source.texture;
    draw(renderer, copy, target);
};

// groundY is where the tyres touch, lift raises the plane from there. both are
// in the car's world units: room scene units, race mode meters
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

    const target = new THREE.WebGLRenderTarget(texWidth, texHeight, {
        samples: 4,
    });
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

    // half float keeps the soft tails through the passes where it's supported
    const blurWidth = Math.round(texWidth * BLUR_SCALE);
    const blurHeight = Math.round(texHeight * BLUR_SCALE);
    const halfFloat =
        renderer.extensions.has('EXT_color_buffer_float') ||
        renderer.extensions.has('EXT_color_buffer_half_float');
    const type = halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType;
    const small = new THREE.WebGLRenderTarget(blurWidth, blurHeight, { type });
    const scratch = new THREE.WebGLRenderTarget(blurWidth, blurHeight, {
        type,
    });
    const result = new THREE.WebGLRenderTarget(blurWidth, blurHeight);
    copyInto(renderer, target, small);
    blur(renderer, small, scratch, BLUR_PASSES);
    copyInto(renderer, small, result);

    // read it back so the shadow is a plain texture: no render targets kept
    // alive per cached car, and the scene exporter can handle it
    const pixels = new Uint8Array(blurWidth * blurHeight * 4);
    renderer.readRenderTargetPixels(
        result,
        0,
        0,
        blurWidth,
        blurHeight,
        pixels
    );
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousColor, previousAlpha);
    [target, small, scratch, result].forEach((t) => t.dispose());

    const texture = new THREE.DataTexture(pixels, blurWidth, blurHeight);
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
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
        // pulled harder than the kerbs, lines and decals on the race's road
        polygonOffset: true,
        polygonOffsetFactor: -8,
        polygonOffsetUnits: -20,
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
