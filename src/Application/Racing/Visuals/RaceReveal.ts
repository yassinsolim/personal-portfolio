import * as THREE from 'three';
import {
    createRevealUniforms,
    REVEAL_GLSL,
    REVEAL_IDLE,
    type RevealUniforms,
} from './reveal';

// the race side of the homepage transition. the room's last frame (the
// plate) sits over the race and melts away from the car outward, exactly
// where the ring comes out of the haze under it (same front, same noise), so
// the floor under the tyres turns into the road. the room car cross-fades
// into the race car in one piece: they cover the same pixels, so only the
// light on it changes. the haze starts as the room's grey and turns into the
// eifel's, the sky clears last and the sun shadows fade in

// the room's last frame and, per pixel, where that point lands on the ring:
// meters from the reveal center along the ground (rg), height above the road
// (b) and whether it's the car (a)
export type RevealPlate = {
    color: THREE.Texture;
    ground: THREE.Texture;
};

// the front in meters from the car at t seconds: a steady start across the
// car and the road under it, then faster and faster out into the haze. about
// 3 m at 1 s, 18 m at 2.2 s, 160 m at 3.4 s, 3 km by 4.8 s, where the fog
// hides the rest anyway. it starts short of the car so nothing moves on the
// first frames
const frontAt = (t: number) => 0.12 * (Math.exp(2.1 * t) - 1) + 3.1 * t - 1.2;
const FRONT_END = 3000;
// the soft edge is the same share of the distance everywhere, so the front
// looks alike near and far
const band = (front: number) => 1.2 + 0.3 * Math.max(0, front);
// trees and posts start growing behind the ground by up to this share of the
// band (and grow over 1.5 bands, in the shader)
const LAG = 0.5;
// the flat world sits this far under the road at the car
const FLAT_BELOW = 2;
// the room car turns into the race car over these seconds
const CAR_FADE: [number, number] = [0.35, 1.4];
const HAZE_TINT: [number, number] = [1.4, 4.1];
const SKY_CLEAR: [number, number] = [3.1, 4.7];
const SHADOWS_IN: [number, number] = [0.8, 3.2];
const GRAIN_OUT: [number, number] = [0, 1.4];
// the room as the race camera's view of it shows (srgb): its floor, for the
// ground past the front, and its walls, for the sky, a little darker up high
const ROOM_FLOOR = new THREE.Color().setRGB(0.725, 0.72, 0.73, THREE.SRGBColorSpace);
const ROOM_WALL = new THREE.Color().setRGB(0.635, 0.63, 0.65, THREE.SRGBColorSpace);
const ROOM_CEILING = new THREE.Color().setRGB(0.565, 0.56, 0.58, THREE.SRGBColorSpace);
// without the spatial reveal (reduced motion) the plate just fades
const CROSSFADE_SECONDS = 0.45;
// the race grade's warm push on bright colors, which the haze has to undo
const GRADE_WARM = [1.04, 1.0, 0.95];

const smooth = ([edge0, edge1]: [number, number], x: number) => {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
};

// three's agx curve for a grey (its matrices keep greys grey)
const agxGrey = (value: number, exposure: number) => {
    let x = Math.log2(Math.max(value * exposure, 1e-10));
    x = Math.min(1, Math.max(0, (x + 12.47393) / (4.026069 + 12.47393)));
    const x2 = x * x;
    const x4 = x2 * x2;
    const y =
        15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
    return Math.min(1, Math.pow(Math.max(0, y), 2.2));
};

// the linear value agx turns into `shown` (linear), by bisection
const agxInverse = (shown: number, exposure: number) => {
    let lo = 0;
    let hi = 64;
    for (let i = 0; i < 48; i++) {
        const mid = (lo + hi) / 2;
        if (agxGrey(mid, exposure) < shown) lo = mid;
        else hi = mid;
    }
    return (lo + hi) / 2;
};

export const PLATE_GLSL = /* glsl */ `
uniform sampler2D tPlate;
uniform sampler2D tPlateGround;
uniform float uPlateFade;
uniform float uPlateSpatial;
uniform float uPlateCar;
uniform float uRevealFront;
uniform float uRevealBand;
${REVEAL_GLSL}
// how much of the room still shows here. walls and furniture melt from the
// floor up: height counts as more distance, and moves the noise too so a
// wall breaks up in patches instead of running in streaks. on the floor it's
// exactly the ring's front. the car goes in one piece
float plateCover(vec2 uv) {
    if (uPlateFade <= 0.0) return 0.0;
    if (uPlateSpatial < 0.5) return uPlateFade;
    vec4 ground = texture2D(tPlateGround, uv);
    float h = max(0.0, ground.z);
    float gone = ground.w > 0.5
        ? uPlateCar
        : revealAt(ground.xy + vec2(0.8, -0.6) * h, h * 0.7);
    return uPlateFade * (1.0 - gone);
}
`;

export type PlateUniforms = {
    tPlate: THREE.IUniform<THREE.Texture | null>;
    tPlateGround: THREE.IUniform<THREE.Texture | null>;
    uPlateFade: THREE.IUniform<number>;
    uPlateSpatial: THREE.IUniform<number>;
    uPlateCar: THREE.IUniform<number>;
    uRevealFront: THREE.IUniform<number>;
    uRevealBand: THREE.IUniform<number>;
};

export default class RaceReveal {
    uniforms: RevealUniforms;
    plateUniforms: PlateUniforms;
    // 0 the sky is haze, 1 it's clear
    sky: THREE.IUniform<number>;
    // sun shadow strength
    shadows: number;
    // the room's film grain fades with the room
    roomGrain: number;
    armed: boolean;
    running: boolean;
    spatial: boolean;
    time: number;
    // the sky's haze, toward the horizon and straight up, in the space the
    // sky writes (like uRevealHaze)
    skyHaze: { uRevealSkyHaze: THREE.IUniform<THREE.Color>; uRevealSkyTop: THREE.IUniform<THREE.Color> };
    // the wall haze in linear, for a plain color background
    background: THREE.Color;
    // each haze starts as a room grey, one version for the post chain (the
    // grade tone maps it after, so it's solved backwards through that) and
    // one for drawing straight to the screen (the grey itself), and ends as
    // the eifel's fog color
    private hazes: { target: THREE.Color; graded: THREE.Color; screen: THREE.Color }[];
    private hazeEnd: THREE.Color;
    private hazeT: number;
    private scratch: THREE.Color;
    private startedAt = 0;
    private overlayScene: THREE.Scene;
    private overlayCamera: THREE.OrthographicCamera;
    overlayMaterial: THREE.ShaderMaterial;

    constructor(fogColor: THREE.Color, exposure: number) {
        this.uniforms = createRevealUniforms();
        this.plateUniforms = {
            tPlate: { value: null },
            tPlateGround: { value: null },
            uPlateFade: { value: 0 },
            uPlateSpatial: { value: 1 },
            uPlateCar: { value: 0 },
            uRevealFront: this.uniforms.uRevealFront,
            uRevealBand: this.uniforms.uRevealBand,
        };
        this.sky = { value: 1 };
        this.shadows = 1;
        this.roomGrain = 0;
        this.armed = false;
        this.running = false;
        this.spatial = true;
        this.time = 0;
        this.hazeT = 0;
        this.hazeEnd = fogColor.clone();
        this.scratch = new THREE.Color();
        this.background = new THREE.Color();
        this.skyHaze = {
            uRevealSkyHaze: { value: new THREE.Color() },
            uRevealSkyTop: { value: new THREE.Color() },
        };
        // the grey that comes out of the race grade (warm push, then agx) as
        // the room's grey
        const graded = (shown: THREE.Color) =>
            new THREE.Color(
                agxInverse(shown.r, exposure) / GRADE_WARM[0],
                agxInverse(shown.g, exposure) / GRADE_WARM[1],
                agxInverse(shown.b, exposure) / GRADE_WARM[2]
            );
        this.hazes = [
            [this.uniforms.uRevealHaze.value, ROOM_FLOOR],
            [this.uniforms.uRevealHazeFar.value, ROOM_WALL],
            [this.skyHaze.uRevealSkyHaze.value, ROOM_WALL],
            [this.skyHaze.uRevealSkyTop.value, ROOM_CEILING],
        ].map(([target, room]) => ({ target, graded: graded(room), screen: room.clone() }));

        // the plate over the frame when there's no post chain to do it in
        this.overlayMaterial = new THREE.ShaderMaterial({
            name: 'race-reveal-plate',
            uniforms: this.plateUniforms,
            vertexShader: /* glsl */ `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4(position.xy, 0.0, 1.0);
                }
            `,
            // the plate is the screen's own srgb bytes, written back as is
            fragmentShader: /* glsl */ `
                varying vec2 vUv;
                ${PLATE_GLSL}
                void main() {
                    gl_FragColor = vec4(texture2D(tPlate, vUv).rgb, plateCover(vUv));
                }
            `,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
        });
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.overlayMaterial);
        quad.frustumCulled = false;
        this.overlayScene = new THREE.Scene();
        this.overlayScene.add(quad);
        this.overlayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    }

    get active() {
        return this.armed || this.running;
    }

    // everything at the first frame: the plate covers the whole screen and
    // the ring past the car is flat haze. center is the car's spot on the road
    arm(center: THREE.Vector3, road: number, plate: RevealPlate | null, spatial: boolean) {
        this.armed = true;
        this.running = false;
        this.spatial = spatial;
        this.time = 0;
        this.uniforms.uRevealCenter.value.copy(center);
        this.uniforms.uRevealBase.value = road - FLAT_BELOW;
        this.plateUniforms.tPlate.value = plate?.color || null;
        this.plateUniforms.tPlateGround.value = plate?.ground || null;
        this.plateUniforms.uPlateSpatial.value = spatial ? 1 : 0;
        this.plateUniforms.uPlateFade.value = plate ? 1 : 0;
        this.apply(0);
    }

    // on the wall clock, so a slow frame moves the front on instead of
    // stretching the whole reveal
    start() {
        if (!this.armed) return;
        this.running = true;
        this.time = 0;
        this.startedAt = performance.now();
    }

    // straight to the end state, the race as it always looks
    finish() {
        this.armed = false;
        this.running = false;
        this.uniforms.uRevealFront.value = REVEAL_IDLE;
        this.plateUniforms.uPlateFade.value = 0;
        this.plateUniforms.tPlate.value = null;
        this.plateUniforms.tPlateGround.value = null;
        this.sky.value = 1;
        this.shadows = 1;
        this.roomGrain = 0;
    }

    get duration() {
        if (!this.spatial) return CROSSFADE_SECONDS;
        let lo = 0;
        let hi = 10;
        for (let i = 0; i < 40; i++) {
            const mid = (lo + hi) / 2;
            if (frontAt(mid) < FRONT_END) lo = mid;
            else hi = mid;
        }
        return hi;
    }

    get done() {
        return this.running && this.time >= this.duration;
    }

    update() {
        if (!this.running) return;
        this.time = (performance.now() - this.startedAt) / 1000;
        this.apply(this.time);
    }

    private apply(t: number) {
        const u = this.uniforms;
        if (!this.spatial) {
            // reduced motion: the ring is simply there, the room fades off it
            const shown = Math.min(1, Math.max(0, t / CROSSFADE_SECONDS));
            u.uRevealFront.value = REVEAL_IDLE;
            this.plateUniforms.uPlateFade.value = this.plateUniforms.tPlate.value ? 1 - shown : 0;
            this.sky.value = 1;
            this.shadows = shown;
            this.roomGrain = 1 - shown;
            this.hazeT = 1;
            return;
        }
        const front = frontAt(t);
        const width = band(front);
        u.uRevealFront.value = front;
        u.uRevealBand.value = width;
        u.uRevealLag.value = width * LAG;
        this.plateUniforms.uPlateCar.value = smooth(CAR_FADE, t);
        this.hazeT = smooth(HAZE_TINT, t);
        this.sky.value = smooth(SKY_CLEAR, t);
        this.shadows = smooth(SHADOWS_IN, t);
        this.roomGrain = 1 - smooth(GRAIN_OUT, t);
    }

    // the hazes for how the materials write: linear into the post chain (the
    // grade tone maps it after), srgb when they draw straight to the screen
    setOutput(linear: boolean) {
        const space = linear ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace;
        this.hazes.forEach((haze) => {
            this.scratch
                .copy(linear ? haze.graded : haze.screen)
                .lerp(this.hazeEnd, this.hazeT)
                .getRGB(haze.target, space);
        });
        this.background.copy(this.hazes[2].screen).lerp(this.hazeEnd, this.hazeT);
    }

    // the plate over whatever was drawn, for the path with no post chain
    drawOverlay(renderer: THREE.WebGLRenderer) {
        if (this.plateUniforms.uPlateFade.value <= 0 || !this.plateUniforms.tPlate.value) return;
        const autoClear = renderer.autoClear;
        renderer.autoClear = false;
        renderer.render(this.overlayScene, this.overlayCamera);
        renderer.autoClear = autoClear;
    }

    // the overlay's program, ahead of its first frame
    compileOverlay(renderer: THREE.WebGLRenderer) {
        return renderer.compileAsync(this.overlayScene, this.overlayCamera);
    }
}
