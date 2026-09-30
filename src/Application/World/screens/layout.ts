import * as THREE from 'three';
import type { ScreenId } from './types';

// room v2 is built at the car's own scale: the amg one is 4.75 m and drawn 27x
// its glb size, which is 2764 scene units per metre (Car.getSceneUnitsPerMeter).
// scripts/room/setup.json uses the same numbers, and the room glb's
// m1_screen / m2_screen / m3_screen quads sit exactly on these rects
export const UNITS_PER_METRE = 2763.957;
// top of the studio floor (the backdrop mesh), what the room stands on
export const FLOOR_Y = -2984.2;
// where the car's tyres sit. the old room's chair base dipped 11 units under
// the floor and getGroundYFromScene picked that up; keeping the number keeps
// the car (and the race handoff built on its matrix) exactly where it was
export const CAR_GROUND_Y = -2995.0;
// the old computer model's bounds centre, which placed the toyota crown
export const OLD_DESK_CENTER = new THREE.Vector3(10.26, 577.58, 207.9);

// room local metres (x right, y up, z toward the chair, origin on the floor
// under the main screen) to scene units
export const roomPoint = (x: number, y: number, z: number) =>
    new THREE.Vector3(
        x * UNITS_PER_METRE,
        FLOOR_Y + y * UNITS_PER_METRE,
        z * UNITS_PER_METRE
    );

export type ScreenPose = {
    center: THREE.Vector3;
    // out of the glass, toward the viewer
    normal: THREE.Vector3;
    up: THREE.Vector3;
    // active area in scene units
    width: number;
    height: number;
};

const ACTIVE_W = 0.5967;
const ACTIVE_H = 0.3357;
const tilt = THREE.MathUtils.degToRad(10);
const toe = THREE.MathUtils.degToRad(25);

// three identical 27 inch 1440p oleds: m1 main (bottom), m2 stacked on top
// and leaning down 10 degrees, m3 portrait on the right turned in 25
export const SCREEN_POSES: Record<ScreenId, ScreenPose> = {
    m1: {
        center: roomPoint(0, 1.0168, -0.1985),
        normal: new THREE.Vector3(0, 0, 1),
        up: new THREE.Vector3(0, 1, 0),
        width: ACTIVE_W * UNITS_PER_METRE,
        height: ACTIVE_H * UNITS_PER_METRE,
    },
    m2: {
        center: roomPoint(0, 1.3829, -0.1679),
        normal: new THREE.Vector3(0, -Math.sin(tilt), Math.cos(tilt)),
        up: new THREE.Vector3(0, Math.cos(tilt), Math.sin(tilt)),
        width: ACTIVE_W * UNITS_PER_METRE,
        height: ACTIVE_H * UNITS_PER_METRE,
    },
    m3: {
        center: roomPoint(0.4913, 1.1997, -0.1243),
        normal: new THREE.Vector3(-Math.sin(toe), 0, Math.cos(toe)),
        up: new THREE.Vector3(0, 1, 0),
        width: ACTIVE_H * UNITS_PER_METRE,
        height: ACTIVE_W * UNITS_PER_METRE,
    },
};

// fallbacks for the room glb's anchors (empties), in case one is missing
export const DEFAULT_ANCHORS = {
    flipper_spot: roomPoint(-0.36, 0.745, 0.21),
    anchor_keyboard: roomPoint(-0.05, 0.76, 0.2),
    anchor_mouse: roomPoint(0.3, 0.76, 0.21),
    anchor_mug: roomPoint(0.66, 0.835, 0.12),
    anchor_pc: roomPoint(0.62, 0.24, 0.0),
};
export type AnchorName = keyof typeof DEFAULT_ANCHORS;

// the camera's framing of the room. the idle swing keeps today's angle and
// period, aimed between the desk and the car and 28% closer (the new desk is
// smaller than henry's in scene units)
export const IDLE_FOCAL = new THREE.Vector3(300, -1400, -1200);
export const IDLE_SCALE = 0.72;
export const DESK_POSITION = roomPoint(0.1, 1.52, 1.62);
export const DESK_FOCAL = roomPoint(0.14, 1.06, -0.2);
// the whole monitor cluster, for fitting the desk view on narrow screens
export const CLUSTER_WIDTH = 1.1 * UNITS_PER_METRE;
export const ORBIT_FOCAL = new THREE.Vector3(300, -1200, -1800);
