import * as THREE from 'three';
import {
    bodyProfile,
    findHood,
    GLASS_AHEAD,
    type BodyProfile,
} from '../Camera/hoodProbe';

// the cockpit cam's driver: where the eyes are and which parts are the
// steering wheel. everything is in the car's frame (the pivot's): +z forward,
// +y up, +x the driver's side on these left hand drive cars

export const STEERING_SPIN = 'race-steering-spin';
export const CABIN = 'race-cabin';
// the most a tinted pane hides from inside (Utils/CarFinish.ts tints them
// for the look from outside, the windscreen lighter than the rest)
export type GlassZone = 'windshield' | 'surround';
export const COCKPIT_GLASS_OPACITY: Record<GlassZone, number> = {
    windshield: 0.12,
    surround: 0.45,
};

// per car: the steering wheel by node name (the node or one above it) or by
// material, for the models that keep it apart (the rest keep a still wheel),
// and eyes set by hand where the body throws the guess off
const COCKPITS: Record<
    string,
    { node?: RegExp; material?: RegExp; eye?: [number, number, number] }
> = {
    // its roof scoop reads as the top of the roof
    'amg-one': { eye: [0.37, 0.55, -0.06] },
    'amg-c63s-coupe': { node: /SteeringWheel_\d+$/ },
    'bmw-e92-m3': { node: /^e92_steer_m3$/ },
    'bmw-f82-m4': { node: /^ARm4_steer_(carbon|stick_msport)$/ },
    'koenigsegg-jesko': { node: /INT_STEERING_WHEEL/ },
    'lamborghini-aventador-s': { node: /SteeringWheel5/ },
    'mclaren-p1': { node: /^STEER_HR$/ },
    'mercedes-gt63s-edition-one': { material: /^Steering wheel$/ },
    'pagani-huayra': { material: /^PAG_HUAYRA_SW$/ },
};

// a driver's eyes from the middle of the wheel: up, and back toward the seat
const EYE_FROM_WHEEL = new THREE.Vector3(0, 0.26, -0.42);
// a head's room under the top of the roof, which also caps the eyes from
// the wheel (a low supercar's driver sits further down behind it)
const EYE_UNDER_ROOF = 0.24;
// without a wheel to go by: in from the side, and back from the foot of the
// windscreen. a cab forward car (its roof highest ahead of the middle, the
// mid engined ones) has a longer, more raked screen, so the eyes are further
// from its foot. measured on the cars whose wheels are known
const DRIVER_SIDE = 0.37;
const EYE_BEHIND_GLASS = 0.74;
const EYE_BEHIND_RAKED_GLASS = 0.92;
// parts a weak gpu's chase cam can't see through tinted glass. they used to
// be dropped; the cockpit cam needs them, so they're kept in a group shown
// only from in there
const CABIN_PARTS =
    /interior|carpet|leather|alcantara|stitch|gauge|dashscreen|shifter|seat|belt|pedal|steering|cockpit|_int1|details_int/i;

const named = (
    object: THREE.Object3D,
    model: THREE.Object3D,
    pattern: RegExp,
) => {
    for (
        let node: THREE.Object3D | null = object;
        node && node !== model;
        node = node.parent
    ) {
        if (pattern.test(node.name)) return true;
    }
    return false;
};

// largest eigenvector of a symmetric 3x3 by power iteration, or the largest
// across skip when it's given
const principal = (m: THREE.Matrix3, skip?: THREE.Vector3) => {
    const v = new THREE.Vector3(0.6, 0.5, 0.62);
    for (let i = 0; i < 48; i++) {
        v.applyMatrix3(m);
        if (skip) v.addScaledVector(skip, -v.dot(skip));
        if (v.lengthSq() < 1e-20) return null;
        v.normalize();
    }
    return v;
};

export type WheelFrame = {
    center: THREE.Vector3;
    axis: THREE.Vector3;
    radius: number;
};

// the wheel's middle and the axis it turns on, from its vertices: a rim is a
// flat ring, so the axis is the way the points spread least, and the middle
// is halfway across the ring (spokes and a hub off center don't move it)
export const wheelFrame = (parts: THREE.Mesh[]): WheelFrame | null => {
    const v = new THREE.Vector3();
    const mean = new THREE.Vector3();
    let count = 0;
    const each = (visit: (point: THREE.Vector3) => void) =>
        parts.forEach((mesh) => {
            const position = mesh.geometry.getAttribute('position');
            if (!position) return;
            for (let i = 0; i < position.count; i++) {
                visit(
                    v
                        .fromBufferAttribute(position, i)
                        .applyMatrix4(mesh.matrixWorld),
                );
            }
        });
    each((point) => {
        mean.add(point);
        count++;
    });
    if (count < 12) return null;
    mean.divideScalar(count);
    const c = [0, 0, 0, 0, 0, 0];
    each((point) => {
        const x = point.x - mean.x;
        const y = point.y - mean.y;
        const z = point.z - mean.z;
        c[0] += x * x;
        c[1] += x * y;
        c[2] += x * z;
        c[3] += y * y;
        c[4] += y * z;
        c[5] += z * z;
    });
    const cov = new THREE.Matrix3().set(
        c[0],
        c[1],
        c[2],
        c[1],
        c[3],
        c[4],
        c[2],
        c[4],
        c[5],
    );
    const first = principal(cov);
    const second = first && principal(cov, first);
    if (!first || !second) return null;
    const axis = new THREE.Vector3().crossVectors(first, second).normalize();
    // up the column, toward the driver
    if (axis.z > 0) axis.negate();
    const span = [Infinity, -Infinity, Infinity, -Infinity];
    each((point) => {
        v.copy(point).sub(mean);
        const a = v.dot(first);
        const b = v.dot(second);
        span[0] = Math.min(span[0], a);
        span[1] = Math.max(span[1], a);
        span[2] = Math.min(span[2], b);
        span[3] = Math.max(span[3], b);
    });
    const center = mean
        .clone()
        .addScaledVector(first, (span[0] + span[1]) / 2)
        .addScaledVector(second, (span[2] + span[3]) / 2);
    const radius = Math.max(span[1] - span[0], span[3] - span[2]) / 2;
    // a wheel faces the driver and is wheel sized, or it's the wrong parts
    if (-axis.z < 0.6 || radius < 0.1 || radius > 0.26) return null;
    return { center, axis, radius };
};

// the roof's highest point over the middle of the car, as the hood probe
// finds it
const roofOf = (profile: BodyProfile) => {
    const { length, start, step, heights } = profile;
    let top = -Infinity;
    let at = 0;
    heights.forEach((height, i) => {
        const z = start + (i + 0.5) * step;
        if (
            Number.isFinite(height) &&
            Math.abs(z) < length * 0.22 &&
            height > top
        ) {
            top = height;
            at = z;
        }
    });
    return Number.isFinite(top) ? { top, at } : null;
};

// the driver's eyes from the wheel when the model names it, else from the
// body: the roof sets the height, the windscreen's foot how far back
export const eyeFrom = (
    profile: BodyProfile,
    ride: number,
    wheel: WheelFrame | null,
) => {
    const roof = roofOf(profile);
    const fromWheel = wheel ? wheel.center.clone().add(EYE_FROM_WHEEL) : null;
    if (!roof) return fromWheel;
    const height = roof.top - EYE_UNDER_ROOF;
    if (fromWheel) {
        fromWheel.y = Math.min(fromWheel.y, height);
        return fromWheel;
    }
    const hood = findHood(profile, ride);
    if (!hood) return new THREE.Vector3(DRIVER_SIDE, height, roof.at);
    const back = roof.at < 0 ? EYE_BEHIND_GLASS : EYE_BEHIND_RAKED_GLASS;
    return new THREE.Vector3(
        DRIVER_SIDE,
        height,
        hood.along - GLASS_AHEAD - back,
    );
};

// before the car is merged: the steering wheel goes in a group of its own,
// turning about its column, and the eyes are worked out. the model isn't on
// the car yet, so its world is the car's frame. returns the group to merge
// the wheel within, and the eyes (plain numbers in userData, the model gets
// cloned through json). ride is how high the car's frame is off the ground
export const prepareCockpit = (
    model: THREE.Object3D,
    carId: string,
    length: number,
    ride: number,
) => {
    model.updateMatrixWorld(true);
    const spec = COCKPITS[carId];
    const parts: THREE.Mesh[] = [];
    if (spec && (spec.node || spec.material)) {
        model.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (!mesh.isMesh || Array.isArray(mesh.material)) return;
            const byNode = spec.node && named(mesh, model, spec.node);
            const byMaterial =
                spec.material && spec.material.test(mesh.material.name || '');
            if (byNode || byMaterial) parts.push(mesh);
        });
    }
    const frame = parts.length ? wheelFrame(parts) : null;
    let spin: THREE.Group | null = null;
    if (frame) {
        // moved as one with the body by the garage's ride height, so the
        // wheel turns about its own middle whatever the height
        const mount = new THREE.Group();
        mount.name = 'race-steering';
        mount.userData.raceRidesWithBody = true;
        spin = new THREE.Group();
        spin.name = STEERING_SPIN;
        mount.add(spin);
        model.add(mount);
        const onCar = new THREE.Matrix4().compose(
            frame.center,
            new THREE.Quaternion().setFromUnitVectors(
                new THREE.Vector3(0, 0, 1),
                frame.axis,
            ),
            new THREE.Vector3(1, 1, 1),
        );
        new THREE.Matrix4()
            .copy(model.matrixWorld)
            .invert()
            .multiply(onCar)
            .decompose(mount.position, mount.quaternion, mount.scale);
        mount.updateMatrixWorld(true);
        parts.forEach((mesh) => spin!.attach(mesh));
    }
    const eye = spec?.eye
        ? new THREE.Vector3().fromArray(spec.eye)
        : eyeFrom(
              bodyProfile(new THREE.Object3D(), model, length),
              ride,
              frame,
          );
    if (eye) model.userData.raceCockpitEye = eye.toArray();
    return spin;
};

// weak gpus: the cabin's parts go in a group, hidden unless the cockpit cam
// is on. the steering wheel's group goes with them
export const groupCabin = (model: THREE.Object3D) => {
    model.updateMatrixWorld(true);
    const parts: THREE.Object3D[] = [];
    model.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (child.name === 'race-steering') {
            parts.push(child);
            return;
        }
        if (!mesh.isMesh || Array.isArray(mesh.material)) return;
        if (named(mesh, model, /^race-steering$/)) return;
        if (CABIN_PARTS.test(mesh.material.name || '')) parts.push(mesh);
    });
    if (!parts.length) return null;
    const cabin = new THREE.Group();
    cabin.name = CABIN;
    cabin.visible = false;
    cabin.userData.raceRidesWithBody = true;
    model.add(cabin);
    cabin.updateMatrixWorld(true);
    parts.forEach((part) => cabin.attach(part));
    return cabin;
};
