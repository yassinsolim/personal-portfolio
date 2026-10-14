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

type Vec3 = [number, number, number];

// a steering wheel the model doesn't keep apart, cut from the cabin's meshes:
// the parts wholly inside a cylinder round its column (a part reaching out of
// it, like the dash or a column mounted paddle, stays). center is on the
// column, axis toward the driver, along how far either way (- toward the
// dash)
type WheelCut = {
    center: Vec3;
    axis: Vec3;
    radius: number;
    along: [number, number];
    material: RegExp;
};

// per car: the driver's eyes, and the steering wheel by node name (the node
// or one above it) or material for the models that keep it apart, or cut
// from the cabin. measured from each model and set by hand, so nothing is
// worked out from the body when a car loads. solid is cabin materials the
// model blends though they're solid (their alpha only cuts out decals):
// blended parts don't hide each other by depth, which shows from the seat
const COCKPITS: Record<
    string,
    {
        eye: Vec3;
        node?: RegExp;
        material?: RegExp;
        cut?: WheelCut;
        solid?: RegExp;
    }
> = {
    'amg-one': {
        eye: [0.332, 0.578, 0.145],
        cut: {
            center: [0.332, 0.343, 0.595],
            axis: [0, 0.233, -0.972],
            radius: 0.21,
            along: [-0.1, 0.05],
            material: /Details_INT1|Carbon_039|Details_MAT_016|Details_Add/,
        },
        solid: /Details_INT1/,
    },
    'amg-c63-507': {
        eye: [0.35, 0.764, -0.305],
        cut: {
            center: [0.35, 0.51, 0.145],
            axis: [0, 0.453, -0.891],
            radius: 0.2,
            along: [-0.11, 0.05],
            material: /InteriorA|Badge/,
        },
        solid: /InteriorA/,
    },
    'amg-c63s-coupe': {
        eye: [0.346, 0.816, -0.28],
        node: /SteeringWheel_\d+$/,
    },
    'aston-martin-valkyrie': {
        eye: [0.225, 0.532, 0.365],
        cut: {
            center: [0.225, 0.278, 0.815],
            axis: [0.078, 0.1, -0.99],
            radius: 0.2,
            along: [-0.085, 0.045],
            material: /_int|alcantara|black1|lcd_digital|stro4ka|badge/,
        },
    },
    'bmw-e92-m3': { eye: [0.362, 0.775, -0.25], node: /^e92_steer_m3$/ },
    'bmw-f82-m4': {
        eye: [0.357, 0.842, -0.236],
        node: /^ARm4_steer_(carbon|stick_msport)$/,
    },
    'bmw-f90-m5-competition': {
        eye: [0.398, 0.865, -0.287],
        cut: {
            center: [0.398, 0.608, 0.163],
            axis: [0.004, 0.39, -0.92],
            radius: 0.2,
            along: [-0.085, 0.04],
            material: /bMAT_Details_(MAT1|INT1)|Badge/,
        },
    },
    'bmw-m8-competition-coupe': {
        eye: [0.395, 0.803, -0.34],
        cut: {
            center: [0.395, 0.544, 0.11],
            axis: [0, 0.352, -0.936],
            radius: 0.2,
            along: [-0.075, 0.05],
            material: /InteriorA|Coloured|Badge/,
        },
    },
    'bugatti-chiron-super-sport': {
        eye: [0.392, 0.656, 0.31],
        cut: {
            center: [0.392, 0.395, 0.76],
            axis: [0, 0.292, -0.957],
            radius: 0.21,
            along: [-0.095, 0.06],
            material: /InteriorB|Carbon1|CUERO|Badge/,
        },
        solid: /InteriorB/,
    },
    'ferrari-laferrari': {
        eye: [0.324, 0.618, 0.286],
        cut: {
            center: [0.324, 0.357, 0.736],
            axis: [0, 0.291, -0.957],
            radius: 0.19,
            along: [-0.035, 0.04],
            material: /Details_|Carbon|INT|Badge/,
        },
    },
    'ferrari-sf90-stradale': {
        eye: [0.342, 0.645, 0.171],
        cut: {
            center: [0.342, 0.383, 0.621],
            axis: [0, 0.23, -0.973],
            radius: 0.2,
            along: [-0.1, 0.03],
            material: /InteriorA|InteriorTilling|BadgeA/,
        },
    },
    'koenigsegg-jesko': {
        eye: [0.315, 0.628, 0.241],
        node: /INT_STEERING_WHEEL/,
    },
    'lamborghini-aventador-s': {
        eye: [0.372, 0.657, 0.19],
        node: /SteeringWheel5/,
        solid: /^LamboM_Interior/,
    },
    'lamborghini-huracan': {
        eye: [0.359, 0.612, 0.216],
        cut: {
            center: [0.359, 0.352, 0.666],
            axis: [0, 0.31, -0.951],
            radius: 0.2,
            along: [-0.1, 0.05],
            material: /InteriorA|InteriorTilling|Badge/,
        },
    },
    'mclaren-p1': { eye: [0.318, 0.637, 0.336], node: /^STEER_HR$/ },
    'mclaren-senna': {
        eye: [0.317, 0.612, 0.378],
        cut: {
            center: [0.317, 0.35, 0.828],
            axis: [0, 0.22, -0.975],
            radius: 0.2,
            along: [-0.1, 0.06],
            material: /InteriorB|Carbon1M|Coloured|BadgeA/,
        },
    },
    'mercedes-gt63s-edition-one': {
        eye: [0.388, 0.815, -0.311],
        cut: {
            center: [0.388, 0.561, 0.139],
            axis: [0, 0.454, -0.891],
            radius: 0.21,
            along: [-0.1, 0.03],
            material:
                /Satin|Leather Black|Alcantara Black|Aluminum|Central console|Steering wheel|Yellow plastic/,
        },
    },
    'pagani-huayra': {
        eye: [0.319, 0.574, 0.318],
        material: /^PAG_HUAYRA_SW$/,
    },
    'porsche-918-spyder': {
        eye: [0.334, 0.613, 0.205],
        cut: {
            center: [0.334, 0.352, 0.655],
            axis: [0, 0.258, -0.966],
            radius: 0.2,
            along: [-0.09, 0.04],
            material: /InteriorA|Badge/,
        },
    },
    'toyota-crown-platinum': {
        eye: [0.401, 0.92, -0.1],
        cut: {
            center: [0.401, 0.721, 0.309],
            axis: [0, 0.35, -0.937],
            radius: 0.2,
            along: [-0.05, 0.05],
            material: /^black$/,
        },
    },
    'toyota-supra-mk4': {
        eye: [0.341, 0.71, -0.41],
        node: /^Animate_SteeringWheel/,
    },
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

// the triangles of a mesh by index (a mesh without one is its own index)
const corner = (index: THREE.BufferAttribute | null, i: number) =>
    index ? index.getX(i) : i;

// a mesh's geometry down to the given triangles, sharing its attributes (a
// clone of the model shares its geometries, so they're never changed)
const keepTriangles = (geometry: THREE.BufferGeometry, triangles: number[]) => {
    const part = new THREE.BufferGeometry();
    Object.entries(geometry.attributes).forEach(([name, attribute]) =>
        part.setAttribute(name, attribute),
    );
    part.setIndex(triangles);
    return part;
};

// cuts a steering wheel out of the cabin's meshes (WheelCut): one new mesh
// per mesh it's in, same parent and material, the rest stays
export const cutWheel = (model: THREE.Object3D, cut: WheelCut) => {
    const center = new THREE.Vector3().fromArray(cut.center);
    const axis = new THREE.Vector3().fromArray(cut.axis).normalize();
    const meshes: THREE.Mesh[] = [];
    model.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || Array.isArray(mesh.material)) return;
        if (cut.material.test(mesh.material.name || '')) meshes.push(mesh);
    });
    const toMesh = new THREE.Matrix4();
    const middle = new THREE.Vector3();
    const column = new THREE.Vector3();
    const point = new THREE.Vector3();
    const pieces: THREE.Mesh[] = [];
    meshes.forEach((mesh) => {
        const geometry = mesh.geometry;
        const position = geometry.getAttribute('position');
        if (!position) return;
        // the cylinder in the mesh's own units (the models scale evenly)
        toMesh.copy(mesh.matrixWorld).invert();
        middle.copy(center).applyMatrix4(toMesh);
        column.copy(axis).transformDirection(toMesh);
        const scale = 1 / mesh.matrixWorld.getMaxScaleOnAxis();
        const radius = cut.radius * scale;
        const from = cut.along[0] * scale;
        const to = cut.along[1] * scale;
        const inside = new Uint8Array(position.count);
        let any = false;
        for (let i = 0; i < position.count; i++) {
            point.fromBufferAttribute(position, i).sub(middle);
            const along = point.dot(column);
            if (along < from || along > to) continue;
            if (point.lengthSq() - along * along > radius * radius) continue;
            inside[i] = 1;
            any = true;
        }
        if (!any) return;
        const index = geometry.index;
        const count = index ? index.count : position.count;
        // the parts touching the cylinder: vertices joined by the triangles
        // that reach into it. a part with a vertex outside stays whole
        const root = new Int32Array(position.count);
        for (let i = 0; i < root.length; i++) root[i] = i;
        const find = (i: number) => {
            while (root[i] !== i) {
                root[i] = root[root[i]];
                i = root[i];
            }
            return i;
        };
        const touching: number[] = [];
        for (let i = 0; i + 2 < count; i += 3) {
            const a = corner(index, i);
            const b = corner(index, i + 1);
            const c = corner(index, i + 2);
            if (!inside[a] && !inside[b] && !inside[c]) continue;
            touching.push(i);
            root[find(a)] = find(b);
            root[find(b)] = find(c);
        }
        const out = new Uint8Array(position.count);
        touching.forEach((i) => {
            for (let k = 0; k < 3; k++) {
                const v = corner(index, i + k);
                if (!inside[v]) out[find(v)] = 1;
            }
        });
        const taken = new Uint8Array(count / 3);
        const wheel: number[] = [];
        touching.forEach((i) => {
            const a = corner(index, i);
            const b = corner(index, i + 1);
            const c = corner(index, i + 2);
            if (!inside[a] || !inside[b] || !inside[c] || out[find(a)]) return;
            taken[i / 3] = 1;
            wheel.push(a, b, c);
        });
        if (!wheel.length) return;
        const rest: number[] = [];
        for (let i = 0; i + 2 < count; i += 3) {
            if (!taken[i / 3]) {
                rest.push(
                    corner(index, i),
                    corner(index, i + 1),
                    corner(index, i + 2),
                );
            }
        }
        const piece = new THREE.Mesh(
            keepTriangles(geometry, wheel).toNonIndexed(),
            mesh.material,
        );
        piece.name = `${mesh.name}-steering`;
        piece.castShadow = mesh.castShadow;
        piece.receiveShadow = mesh.receiveShadow;
        mesh.parent?.add(piece);
        piece.position.copy(mesh.position);
        piece.quaternion.copy(mesh.quaternion);
        piece.scale.copy(mesh.scale);
        piece.updateMatrixWorld(true);
        pieces.push(piece);
        if (rest.length) mesh.geometry = keepTriangles(geometry, rest);
        else mesh.removeFromParent();
    });
    return pieces;
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
// turning about its column, and the eyes are set. the model isn't on the car
// yet, so its world is the car's frame. returns the group to merge the wheel
// within, and the eyes (plain numbers in userData, the model gets cloned
// through json). ride is how high the car's frame is off the ground; length
// and ride only matter for a car without a cockpit set here, whose eyes are
// guessed from its body
export const prepareCockpit = (
    model: THREE.Object3D,
    carId: string,
    length: number,
    ride: number,
) => {
    model.updateMatrixWorld(true);
    const spec = COCKPITS[carId];
    if (spec?.solid) {
        const solid = spec.solid;
        model.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (!mesh.isMesh || Array.isArray(mesh.material)) return;
            const material = mesh.material;
            if (!material.transparent || !solid.test(material.name || ''))
                return;
            material.transparent = false;
            material.depthWrite = true;
            material.alphaTest = 0.5;
        });
    }
    let parts: THREE.Mesh[] = [];
    let frame: WheelFrame | null = null;
    if (spec?.cut) {
        parts = cutWheel(model, spec.cut);
        if (parts.length) {
            frame = {
                center: new THREE.Vector3().fromArray(spec.cut.center),
                axis: new THREE.Vector3().fromArray(spec.cut.axis).normalize(),
                radius: spec.cut.radius,
            };
        }
    } else if (spec && (spec.node || spec.material)) {
        model.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (!mesh.isMesh || Array.isArray(mesh.material)) return;
            const byNode = spec.node && named(mesh, model, spec.node);
            const byMaterial =
                spec.material && spec.material.test(mesh.material.name || '');
            if (byNode || byMaterial) parts.push(mesh);
        });
        frame = parts.length ? wheelFrame(parts) : null;
    }
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
    const eye = spec
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

// a clone of the player's car (a remote player in the same car) as seen from
// outside: glass of its own at its tint, since the player's clears from the
// seat, and a weak gpu's cabin hidden
export const outsideView = (model: THREE.Object3D) =>
    model.traverse((child) => {
        if (child.name === CABIN) child.visible = false;
        const mesh = child as THREE.Mesh;
        const material = mesh.material;
        if (!material || Array.isArray(material)) return;
        const tinted = material.userData.tintOpacity as number | undefined;
        if (tinted === undefined) return;
        const own = material.clone();
        own.opacity = tinted;
        mesh.material = own;
    });
