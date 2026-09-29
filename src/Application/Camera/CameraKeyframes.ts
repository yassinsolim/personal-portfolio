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

// narrow viewports pull the wide views back so the car and desk still fit
const narrowPullback = (sizes: Sizes) => Math.max(1, 1.25 / getAspect(sizes));

const HALF_FOV_TAN = Math.tan(THREE.MathUtils.degToRad(35) / 2);

// the idle swing as henry tuned it, around the old focal point
const OLD_IDLE_FOCAL = new THREE.Vector3(0, -1000, 0);
const OLD_ORBIT_POSITION = new THREE.Vector3(-15000, 10000, 15000);
const OLD_ORBIT_FOCAL = new THREE.Vector3(-100, 350, 0);

const keys: { [key in CameraKey]: CameraKeyframe } = {
    idle: {
        position: new THREE.Vector3(-20000, 12000, 20000),
        focalPoint: IDLE_FOCAL.clone(),
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
        const fit = CLUSTER_WIDTH / 2 / (HALF_FOV_TAN * getAspect(this.sizes)) / 0.9;
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

    constructor() {
        super(keys.idle);
        this.application = new Application();
        this.time = this.application.time;
        this.sizes = this.application.sizes;
    }

    update() {
        // henry's swing: x across the front over about 78 s, y drifting slowly
        const x = Math.sin((this.time.elapsed + 19000) * 0.00008) * -20000;
        const y = Math.sin((this.time.elapsed + 1000) * 0.000004) * 4000 + 9000;
        const scale = IDLE_SCALE * narrowPullback(this.sizes);
        this.position
            .set(x, y, 20000)
            .sub(OLD_IDLE_FOCAL)
            .multiplyScalar(scale)
            .add(IDLE_FOCAL);
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
