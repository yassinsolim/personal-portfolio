import * as THREE from 'three';
import { CameraKey } from './Camera';
import Time from '../Utils/Time';
import Application from '../Application';
import Mouse from '../Utils/Mouse';
import Sizes from '../Utils/Sizes';
import {
    CLUSTER_WIDTH,
    DESK_FOCAL,
    DESK_POSITION,
    IDLE_FOCAL,
    IDLE_SCALE,
    ORBIT_FOCAL,
} from '../World/screens/layout';
import { roomTier } from '../Utils/roomTier';

// the low tier keeps today's idle framing: in software gl the closer one
// cost 35 to 50 ms a frame (the car and the room fill more pixels), measured
// at the same swing pose in both builds. the high tier gets the closer view
const LOW_TIER = roomTier() === 'low';
const IDLE_AIM = LOW_TIER ? new THREE.Vector3(0, -1000, 0) : IDLE_FOCAL;
const IDLE_DISTANCE = LOW_TIER ? 1 : IDLE_SCALE;

export class CameraKeyframeInstance {
    position: THREE.Vector3;
    focalPoint: THREE.Vector3;

    constructor(keyframe: CameraKeyframe) {
        this.position = keyframe.position;
        this.focalPoint = keyframe.focalPoint;
    }

    update() {}
}

const getAspect = (sizes: Sizes) => {
    const width = Number.isFinite(sizes.width) && sizes.width > 0 ? sizes.width : 1;
    const height = Number.isFinite(sizes.height) && sizes.height > 0 ? sizes.height : 1;
    return width / height;
};

// below 1.5 the idle widens, pulls back and aims nearer the car, fully by a
// portrait phone: at 35 degrees a car can't fit across one from inside the room
const NARROW_FROM = 1.5;
const NARROW_FULL = 0.46;
const NARROW_FOV = 52;
const NARROW_SCALE = 1.5;
const NARROW_AIM = 0.8;
const BASE_FOV = 35;
// under 1.9 the car drifts off the right edge at that end of the swing, so the
// idle slides sideways there instead, most by 1.5 where the narrow ramp starts
const SLIDE = 3600;
const SLIDE_FROM = 1.9;
const UP = new THREE.Vector3(0, 1, 0);

const narrowness = (sizes: Sizes) =>
    THREE.MathUtils.clamp(
        (NARROW_FROM - getAspect(sizes)) / (NARROW_FROM - NARROW_FULL),
        0,
        1
    );

const slideFor = (sizes: Sizes) =>
    SLIDE *
    THREE.MathUtils.clamp(
        (SLIDE_FROM - getAspect(sizes)) / (SLIDE_FROM - NARROW_FROM),
        0,
        1
    ) *
    (1 - narrowness(sizes));

// the room camera's vertical fov for this screen
export const roomFov = (sizes: Sizes) =>
    BASE_FOV + (NARROW_FOV - BASE_FOV) * narrowness(sizes);

// the idle swing as henry tuned it, around the old focal point
const OLD_IDLE_FOCAL = new THREE.Vector3(0, -1000, 0);
const OLD_ORBIT_POSITION = new THREE.Vector3(-15000, 10000, 15000);
const OLD_ORBIT_FOCAL = new THREE.Vector3(-100, 350, 0);

const keys: { [key in CameraKey]: CameraKeyframe } = {
    idle: {
        position: new THREE.Vector3(-20000, 12000, 20000),
        focalPoint: IDLE_AIM.clone(),
    },
    // set by focusOn, from the target's own framing
    focus: {
        position: DESK_POSITION.clone(),
        focalPoint: DESK_FOCAL.clone(),
    },
    desk: {
        position: DESK_POSITION.clone(),
        focalPoint: DESK_FOCAL.clone(),
    },
    loading: {
        position: new THREE.Vector3(-35000, 35000, 35000),
        focalPoint: new THREE.Vector3(0, -5000, 0),
    },
    orbitControlsStart: {
        position: ORBIT_FOCAL.clone().add(
            OLD_ORBIT_POSITION.clone().sub(OLD_ORBIT_FOCAL).multiplyScalar(IDLE_SCALE)
        ),
        focalPoint: ORBIT_FOCAL.clone(),
    },
    // placeholder, World/Flipper.ts frames the device from its real size every frame
    flipper: {
        position: new THREE.Vector3(-1500, 300, 2000),
        focalPoint: new THREE.Vector3(-1500, -400, 1300),
    },
};

export class FocusKeyframe extends CameraKeyframeInstance {
    provider: (() => { position: THREE.Vector3; focal: THREE.Vector3 } | null) | null = null;

    constructor() {
        super(keys.focus);
    }

    update() {
        const pose = this.provider?.();
        if (!pose) return;
        this.position.copy(pose.position);
        this.focalPoint.copy(pose.focal);
    }
}

export class LoadingKeyframe extends CameraKeyframeInstance {
    constructor() {
        super(keys.loading);
    }
}

// in front of the chair at standing eye height, looking at the three screens,
// drifting a little with the mouse
export class DeskKeyframe extends CameraKeyframeInstance {
    application: Application;
    mouse: Mouse;
    sizes: Sizes;
    base: THREE.Vector3;
    offset: THREE.Vector2;

    constructor() {
        super(keys.desk);
        this.application = new Application();
        this.mouse = this.application.mouse;
        this.sizes = this.application.sizes;
        this.base = new THREE.Vector3();
        this.offset = new THREE.Vector2();
    }

    update() {
        const moved = this.mouse.x || this.mouse.y;
        const nx = moved ? (this.mouse.x / this.sizes.width) * 2 - 1 : 0;
        const ny = moved ? (this.mouse.y / this.sizes.height) * 2 - 1 : 0;
        this.offset.x += (nx - this.offset.x) * 0.05;
        this.offset.y += (ny - this.offset.y) * 0.05;

        const direction = this.base.copy(DESK_POSITION).sub(DESK_FOCAL);
        const halfFovTan = Math.tan(THREE.MathUtils.degToRad(roomFov(this.sizes)) / 2);
        const fit = CLUSTER_WIDTH / 2 / (halfFovTan * getAspect(this.sizes)) / 0.9;
        const distance = Math.max(direction.length(), fit);
        direction.setLength(distance);
        this.position
            .copy(DESK_FOCAL)
            .add(direction)
            .add(new THREE.Vector3(this.offset.x * 260, -this.offset.y * 160, 0));
        this.focalPoint
            .copy(DESK_FOCAL)
            .add(new THREE.Vector3(this.offset.x * 380, -this.offset.y * 220, 0));
    }
}

export class IdleKeyframe extends CameraKeyframeInstance {
    time: Time;
    application: Application;
    sizes: Sizes;
    carModel: THREE.Object3D | null = null;
    carCenter = new THREE.Vector3();
    side = new THREE.Vector3();

    constructor() {
        super(keys.idle);
        this.application = new Application();
        this.time = this.application.time;
        this.sizes = this.application.sizes;
    }

    // the car's middle, measured once per car (the idle doesn't move it)
    getCarCenter() {
        const model = this.application.world?.car?.model;
        if (!model) return null;
        if (model !== this.carModel) {
            this.carModel = model;
            new THREE.Box3().setFromObject(model).getCenter(this.carCenter);
        }
        return this.carCenter;
    }

    update() {
        // henry's swing: x across the front over about 78 s, y drifting slowly
        const swing = Math.sin((this.time.elapsed + 19000) * 0.00008);
        const x = swing * -20000;
        const y = Math.sin((this.time.elapsed + 1000) * 0.000004) * 4000 + 9000;
        const narrow = narrowness(this.sizes);
        const scale = IDLE_DISTANCE + (NARROW_SCALE - IDLE_DISTANCE) * narrow;
        this.focalPoint.copy(IDLE_AIM);
        const car = narrow > 0 ? this.getCarCenter() : null;
        if (car) this.focalPoint.lerp(car, NARROW_AIM * narrow);
        this.position
            .set(x, y, 20000)
            .sub(OLD_IDLE_FOCAL)
            .multiplyScalar(scale)
            .add(this.focalPoint);
        const slide =
            slideFor(this.sizes) *
            THREE.MathUtils.smoothstep(Math.max(0, -swing), 0, 1);
        if (slide > 0) {
            this.side
                .subVectors(this.focalPoint, this.position)
                .cross(UP)
                .setLength(slide);
            this.position.add(this.side);
            this.focalPoint.add(this.side);
        }
    }
}

export class OrbitControlsStart extends CameraKeyframeInstance {
    constructor() {
        super(keys.orbitControlsStart);
    }
}

export class FlipperKeyframe extends CameraKeyframeInstance {
    constructor() {
        super(keys.flipper);
    }

    setPose(position: THREE.Vector3, focalPoint: THREE.Vector3) {
        this.position.copy(position);
        this.focalPoint.copy(focalPoint);
    }
}
