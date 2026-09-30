// puts a garage look on a prepared car model: paint and finish, rim and
// caliper colors, rims from another car, a body kit and the ride height. it
// works by material and node names, so it also works on the clones remote
// cars use, and it can be applied again at any time (live garage preview).
// materials are copied before they're changed, clones share them otherwise
import * as THREE from 'three';
import type { CarLook, PaintFinish } from './garage';
import { rideOffsetMeters, STOCK_LOOK } from './garage';
import { buildKitParts, kitPaint } from './bodyKit';

// body paint material names per car, lowercase substrings
const PAINT: Record<string, string[]> = {
    'amg-one': [
        'body_color',
        'piano_black',
        'black_m_nc_black_0',
        'black_under_black_0',
        'mizo',
    ],
    'bmw-e92-m3': ['e92_paint'],
    'amg-c63-507': ['2014paint_material'],
    'amg-c63s-coupe': ['c63mat_amg_c63_base'],
    'bmw-f82-m4': ['arm4_main'],
    'bmw-f90-m5-competition': ['m5_metallic'],
    'bmw-m8-competition-coupe': ['m8competition_2020paint'],
    'mercedes-gt63s-edition-one': ['carpaint'],
    'toyota-crown-platinum': ['body', 'blue'],
};
// the amg one's painted panels are plain 'black' too, which only counts as
// paint off the wheels
const PAINT_EXACT: Record<string, string[]> = {
    'amg-one': ['black', 'material'],
};
const CALIPER = /callipergloss|calliperanodised|_caliper|tire_brake|^brakes$/;
const TIRE =
    /tire|tyre|tread|rubber|michelin|pirelli|sidewall|disc|disk|brake|calip/;

// what the weak gpu merge has to keep apart so the garage can recolor it
export const isGarageMaterial = (carId: string, name: string) =>
    isPaint(carId, name) || CALIPER.test(name.toLowerCase());

export const carHasCalipers = (carId: string) =>
    [
        'bmw-e92-m3',
        'amg-c63-507',
        'amg-c63s-coupe',
        'bmw-f82-m4',
        'bmw-m8-competition-coupe',
        'mercedes-gt63s-edition-one',
    ].includes(carId);

type Finish = {
    metalness: number;
    roughness: number;
    clearcoat: number;
    clearcoatRoughness: number;
    iridescence: number;
};
const FINISHES: Record<Exclude<PaintFinish, 'stock'>, Finish> = {
    gloss: {
        metalness: 0.05,
        roughness: 0.28,
        clearcoat: 1,
        clearcoatRoughness: 0.04,
        iridescence: 0,
    },
    metallic: {
        metalness: 0.85,
        roughness: 0.32,
        clearcoat: 1,
        clearcoatRoughness: 0.06,
        iridescence: 0,
    },
    pearl: {
        metalness: 0.45,
        roughness: 0.25,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        iridescence: 0.6,
    },
    matte: {
        metalness: 0.15,
        roughness: 0.78,
        clearcoat: 0,
        clearcoatRoughness: 0.5,
        iridescence: 0,
    },
    chrome: {
        metalness: 1,
        roughness: 0.06,
        clearcoat: 0.4,
        clearcoatRoughness: 0.02,
        iridescence: 0,
    },
};

type Stock = {
    color: THREE.Color;
    metalness?: number;
    roughness?: number;
    clearcoat?: number;
    clearcoatRoughness?: number;
    iridescence?: number;
    map: THREE.Texture | null;
    shininess?: number;
};

const wheelRoots = (model: THREE.Object3D) => {
    const roots: THREE.Object3D[] = [];
    const meta = model.userData.raceWheelMeta as
        Array<{ objectName: string }> | undefined;
    (meta || []).forEach((entry) => {
        const node = entry.objectName
            ? model.getObjectByName(entry.objectName)
            : undefined;
        if (node) roots.push(node);
    });
    return roots;
};

const underAny = (
    object: THREE.Object3D,
    roots: Set<THREE.Object3D>,
    stop: THREE.Object3D
) => {
    for (
        let node: THREE.Object3D | null = object;
        node && node !== stop;
        node = node.parent
    ) {
        if (roots.has(node)) return node;
    }
    return null;
};

// this model's own copy of a mesh's material, with the factory values kept
const ownMaterial = (model: THREE.Object3D, mesh: THREE.Mesh) => {
    const current = mesh.material as THREE.MeshPhysicalMaterial;
    if (current.userData.garageOwner === model.uuid) return current;
    const copy = current.clone();
    copy.userData = {
        ...current.userData,
        garageOwner: model.uuid,
        garageStock: {
            color: current.color.clone(),
            metalness: current.metalness,
            roughness: current.roughness,
            clearcoat: current.clearcoat,
            clearcoatRoughness: current.clearcoatRoughness,
            iridescence: current.iridescence,
            map: current.map,
            shininess: (current as unknown as THREE.MeshPhongMaterial)
                .shininess,
        } as Stock,
    };
    mesh.material = copy;
    return copy;
};

// paint needs clearcoat, which only the physical material has
const physicalPaint = (model: THREE.Object3D, mesh: THREE.Mesh) => {
    const material = ownMaterial(model, mesh);
    if (
        !(material as THREE.MeshStandardMaterial).isMeshStandardMaterial ||
        material.isMeshPhysicalMaterial
    ) {
        return material;
    }
    const physical = new THREE.MeshPhysicalMaterial();
    THREE.MeshStandardMaterial.prototype.copy.call(physical, material);
    physical.userData = material.userData;
    mesh.material = physical;
    return physical;
};

const restore = (material: THREE.MeshPhysicalMaterial) => {
    const stock = material.userData.garageStock as Stock | undefined;
    if (!stock) return;
    material.color.copy(stock.color);
    if (stock.metalness !== undefined) material.metalness = stock.metalness;
    if (stock.roughness !== undefined) material.roughness = stock.roughness;
    if (material.isMeshPhysicalMaterial) {
        material.clearcoat = stock.clearcoat ?? 0;
        material.clearcoatRoughness = stock.clearcoatRoughness ?? 0;
        material.iridescence = stock.iridescence ?? 0;
    }
    if (
        (material as unknown as THREE.MeshPhongMaterial).isMeshPhongMaterial &&
        stock.shininess !== undefined
    ) {
        (material as unknown as THREE.MeshPhongMaterial).shininess =
            stock.shininess;
    }
    material.map = stock.map;
    material.needsUpdate = true;
};

const paintMaterial = (
    material: THREE.MeshPhysicalMaterial,
    hex: string | null,
    finish: PaintFinish
) => {
    restore(material);
    if (hex) {
        material.color.set(hex);
        // factory liveries are baked into the map, a repaint covers them
        material.map = null;
    }
    if (finish !== 'stock') {
        const f = FINISHES[finish];
        if (
            (material as unknown as THREE.MeshPhongMaterial).isMeshPhongMaterial
        ) {
            // weak gpu cars: just the shine
            (material as unknown as THREE.MeshPhongMaterial).shininess =
                Math.max(4, (1 - f.roughness) * 100);
        } else {
            material.metalness = f.metalness;
            material.roughness = f.roughness;
            if (material.isMeshPhysicalMaterial) {
                material.clearcoat = f.clearcoat;
                material.clearcoatRoughness = f.clearcoatRoughness;
                material.iridescence = f.iridescence;
                material.iridescenceIOR = 1.6;
            }
        }
    }
    material.needsUpdate = true;
};

const isPaint = (carId: string, name: string) => {
    const lower = name.toLowerCase();
    if ((PAINT_EXACT[carId] || []).includes(lower)) return true;
    return (PAINT[carId] || []).some((part) => lower.includes(part));
};

// the model's local offset for a pivot space vector, for a mesh's parent
const localDelta = (
    model: THREE.Object3D,
    parent: THREE.Object3D,
    up: number
) => {
    model.updateMatrixWorld(true);
    const toParent = new THREE.Matrix4()
        .copy(parent.matrixWorld)
        .invert()
        .multiply(model.matrixWorld);
    const scale = model.scale.y || 1;
    const a = new THREE.Vector3(0, 0, 0).applyMatrix4(toParent);
    const b = new THREE.Vector3(0, up / scale, 0).applyMatrix4(toParent);
    return b.sub(a);
};

// ride height moves the body, not the wheels
const applyRide = (
    model: THREE.Object3D,
    roots: Set<THREE.Object3D>,
    meters: number
) => {
    const moved: THREE.Object3D[] = [];
    model.traverse((child) => {
        if (child === model || roots.has(child)) return;
        const kit = child.name === 'garage-kit';
        if (!kit && (!(child as THREE.Mesh).isMesh || child.userData.garageKit))
            return;
        if (underAny(child, roots, model)) return;
        moved.push(child);
    });
    // a mesh under a moved mesh already moves with it
    const set = new Set(moved);
    const top = moved.filter((child) => {
        for (
            let node = child.parent;
            node && node !== model;
            node = node.parent
        ) {
            if (set.has(node)) return false;
        }
        return true;
    });
    moved.length = 0;
    moved.push(...top);
    moved.forEach((child) => {
        if (!child.userData.garageBase)
            child.userData.garageBase = child.position.clone();
        const base = child.userData.garageBase as THREE.Vector3;
        child.position.copy(base);
        if (meters !== 0 && child.parent)
            child.position.add(localDelta(model, child.parent, meters));
    });
};

// the model's box in its parent's frame (pivot frame for the player's car)
const pivotBox = (model: THREE.Object3D, roots: Set<THREE.Object3D>) => {
    const saved = model.parent;
    const inverse = new THREE.Matrix4();
    model.updateMatrixWorld(true);
    if (saved) inverse.copy(saved.matrixWorld).invert();
    const box = new THREE.Box3();
    const part = new THREE.Box3();
    model.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || !mesh.visible || child.userData.garageKit) return;
        if (underAny(mesh, roots, model)) return;
        // the contact shadow is a big plane under the car, not body
        if (
            /shadow/i.test(mesh.name) ||
            (mesh.material as THREE.Material).transparent
        )
            return;
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        part.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld);
        if (saved) part.applyMatrix4(inverse);
        box.union(part);
    });
    return box;
};

// the body's top surface over the back of the car, looked at from above:
// the highest point in each 1 cm cell, in the parent frame. one pass over
// the triangles, where a ray per sample took seconds on the big merged
// meshes. glass, shadows, wheels and the kit itself don't count
const topField = (
    model: THREE.Object3D,
    roots: Set<THREE.Object3D>,
    width: number,
    length: number
) => {
    const cell = 0.01;
    const x0 = -width / 2;
    const z0 = -length / 2 - 0.5;
    const nx = Math.ceil(width / cell) + 1;
    const nz = Math.ceil(2.1 / cell) + 1;
    const top = new Float32Array(nx * nz).fill(-Infinity);
    model.updateMatrixWorld(true);
    const toParent = new THREE.Matrix4();
    const inverseParent = model.parent
        ? new THREE.Matrix4().copy(model.parent.matrixWorld).invert()
        : new THREE.Matrix4();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    model.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || !mesh.visible || Array.isArray(mesh.material)) return;
        if (child.userData.garageKit || /shadow/i.test(mesh.name)) return;
        if ((mesh.material as THREE.Material).transparent) return;
        if (underAny(mesh, roots, model)) return;
        const position = mesh.geometry.getAttribute('position');
        if (!position) return;
        toParent.multiplyMatrices(inverseParent, mesh.matrixWorld);
        const index = mesh.geometry.index;
        const count = index ? index.count : position.count;
        for (let i = 0; i + 2 < count; i += 3) {
            a.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(toParent);
            b.fromBufferAttribute(position, index ? index.getX(i + 1) : i + 1).applyMatrix4(toParent);
            c.fromBufferAttribute(position, index ? index.getX(i + 2) : i + 2).applyMatrix4(toParent);
            const minX = Math.max(0, Math.floor((Math.min(a.x, b.x, c.x) - x0) / cell));
            const maxX = Math.min(nx - 1, Math.ceil((Math.max(a.x, b.x, c.x) - x0) / cell));
            const minZ = Math.max(0, Math.floor((Math.min(a.z, b.z, c.z) - z0) / cell));
            const maxZ = Math.min(nz - 1, Math.ceil((Math.max(a.z, b.z, c.z) - z0) / cell));
            if (minX > maxX || minZ > maxZ) continue;
            const d = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
            if (Math.abs(d) < 1e-12) continue;
            for (let iz = minZ; iz <= maxZ; iz++) {
                const z = z0 + iz * cell;
                for (let ix = minX; ix <= maxX; ix++) {
                    const x = x0 + ix * cell;
                    const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / d;
                    const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / d;
                    const w = 1 - u - v;
                    if (u < -1e-4 || v < -1e-4 || w < -1e-4) continue;
                    const y = u * a.y + v * b.y + w * c.y;
                    const k = iz * nx + ix;
                    if (y > top[k]) top[k] = y;
                }
            }
        }
    });
    return (x: number, z: number) => {
        const ix = Math.round((x - x0) / cell);
        const iz = Math.round((z - z0) / cell);
        if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) return null;
        const y = top[iz * nx + ix];
        return Number.isFinite(y) ? y : null;
    };
};

// a ducktail or a gt wing shaped on the boot (bodyKit.ts). the boot is found
// with rays straight down on the body, in the parent frame, and the kit is
// moved into the model's frame
const buildKit = (
    model: THREE.Object3D,
    roots: Set<THREE.Object3D>,
    kind: CarLook['spoiler'],
    paint: THREE.Material | null
) => {
    // mesh boxes blow up under the models' rotations, so width and length
    // come from the measured body size
    const body = model.userData.raceBodySize as number[] | undefined;
    const fallback = pivotBox(model, roots).getSize(new THREE.Vector3());
    const width = body ? body[0] : fallback.x;
    const length = body ? body[2] : fallback.z;
    const surface = topField(model, roots, width, length);
    const group = buildKitParts(kind, surface, width, length, paint);
    group.traverse((child) => {
        child.userData.garageKit = true;
    });
    group.applyMatrix4(new THREE.Matrix4().copy(model.matrix).invert());
    group.name = 'garage-kit';
    return group;
};

// the body's paint material as it is now (the garage swaps in copies)
const bodyPaint = (
    model: THREE.Object3D,
    carId: string,
    roots: Set<THREE.Object3D>
) => {
    let found: THREE.Material | null = null;
    model.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (found || !mesh.isMesh || Array.isArray(mesh.material)) return;
        if (child.userData.garageKit || underAny(mesh, roots, model)) return;
        if (isPaint(carId, (mesh.material as THREE.Material).name || ''))
            found = mesh.material as THREE.Material;
    });
    return found;
};

const setKit = (
    model: THREE.Object3D,
    roots: Set<THREE.Object3D>,
    kind: CarLook['spoiler'],
    carId: string
) => {
    const paint = bodyPaint(model, carId, roots);
    const old = model.getObjectByName('garage-kit');
    if (old && old.userData.kind === kind) {
        // a repaint swaps the body's material, the ducktail follows it
        const tail = old.getObjectByName('garage-ducktail') as THREE.Mesh | undefined;
        if (tail && paint) kitPaint(paint, tail.material as THREE.Material);
        return;
    }
    if (old) {
        old.removeFromParent();
        old.traverse((child) => (child as THREE.Mesh).geometry?.dispose());
    }
    if (kind === 'none') return;
    const kit = buildKit(model, roots, kind, paint);
    kit.userData.kind = kind;
    model.add(kit);
};

type Part = {
    geometry: THREE.BufferGeometry;
    material: THREE.Material | THREE.Material[];
    castShadow: boolean;
    // mesh to its model's frame
    matrix: THREE.Matrix4;
};

// a wheel node's meshes in its model's frame
const wheelParts = (model: THREE.Object3D, root: THREE.Object3D) => {
    const toModel = new THREE.Matrix4().copy(model.matrixWorld).invert();
    const parts: Part[] = [];
    root.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || child.userData.garageRim) return;
        parts.push({
            geometry: mesh.geometry,
            material: mesh.material,
            castShadow: mesh.castShadow,
            matrix: new THREE.Matrix4().multiplyMatrices(toModel, mesh.matrixWorld),
        });
    });
    return parts;
};

const partsBox = (parts: Part[]) => {
    const box = new THREE.Box3();
    parts.forEach((part) => {
        if (!part.geometry.boundingBox) part.geometry.computeBoundingBox();
        box.union(part.geometry.boundingBox!.clone().applyMatrix4(part.matrix));
    });
    return box;
};

// the triangles on one side of the car, for a donor node holding both
// wheels of an axle. kept per geometry and side, clones share them
const halves = new WeakMap<THREE.BufferGeometry, Map<string, THREE.BufferGeometry | null>>();
const sideGeometry = (
    geometry: THREE.BufferGeometry,
    toParent: THREE.Matrix4,
    side: number
) => {
    const key = `${side}:${toParent.elements.map((e) => e.toFixed(4)).join(',')}`;
    let cache = halves.get(geometry);
    if (!cache) {
        cache = new Map();
        halves.set(geometry, cache);
    }
    if (cache.has(key)) return cache.get(key)!;
    const position = geometry.getAttribute('position');
    const index = geometry.index;
    const count = index ? index.count : position.count;
    const kept: number[] = [];
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (let i = 0; i + 2 < count; i += 3) {
        const i0 = index ? index.getX(i) : i;
        const i1 = index ? index.getX(i + 1) : i + 1;
        const i2 = index ? index.getX(i + 2) : i + 2;
        a.fromBufferAttribute(position, i0);
        b.fromBufferAttribute(position, i1);
        c.fromBufferAttribute(position, i2);
        const x = a.add(b).add(c).divideScalar(3).applyMatrix4(toParent).x;
        if (Math.sign(x) === side) kept.push(i0, i1, i2);
    }
    let half: THREE.BufferGeometry | null = null;
    if (kept.length) {
        const cut = new THREE.BufferGeometry();
        Object.entries(geometry.attributes).forEach(([name, attribute]) =>
            cut.setAttribute(name, attribute)
        );
        cut.setIndex(kept);
        // only the kept vertices, so its bounds are the one wheel's
        half = cut.toNonIndexed();
        half.computeBoundingBox();
        half.computeBoundingSphere();
    }
    cache.set(key, half);
    return half;
};

// a donor wheel's parts for one side: as they are for a single wheel, cut
// down when the node spans the axle
const sidePart = (donor: THREE.Object3D, parts: Part[], side: number) => {
    const toParent = new THREE.Matrix4().compose(
        new THREE.Vector3(),
        donor.quaternion,
        donor.scale
    );
    const box = partsBox(parts);
    if (box.isEmpty()) return [];
    const size = box.getSize(new THREE.Vector3()).applyMatrix4(toParent);
    const center = box.getCenter(new THREE.Vector3()).applyMatrix4(toParent);
    if (Math.abs(size.x) < 0.9) return Math.sign(center.x) === side ? parts : [];
    return parts
        .map((part) => {
            const geometry = sideGeometry(
                part.geometry,
                toParent.clone().multiply(part.matrix),
                side
            );
            return geometry ? { ...part, geometry } : null;
        })
        .filter((part): part is Part => part !== null);
};

// rims from another car: its wheel meshes, scaled to this car's wheel size
// and placed where this car's wheels are. the originals are only hidden
const setWheels = (
    model: THREE.Object3D,
    roots: THREE.Object3D[],
    donor: THREE.Object3D | null,
    donorId: string
) => {
    roots.forEach((root) => {
        const own = root.children.filter((child) => !child.userData.garageRim);
        const swapped = root.children.filter(
            (child) => child.userData.garageRim
        );
        if (root.userData.garageDonor === donorId) return;
        swapped.forEach((child) => child.removeFromParent());
        own.forEach((child) => {
            if (child.userData.garageVisible === undefined)
                child.userData.garageVisible = child.visible;
            child.visible = child.userData.garageVisible;
        });
        // a root that's a mesh itself (the e92's) got an invisible material
        const rootMesh = root as THREE.Mesh;
        if (rootMesh.isMesh && root.userData.garageOwnMaterial) {
            rootMesh.material = root.userData.garageOwnMaterial;
            delete root.userData.garageOwnMaterial;
        }
        root.userData.garageDonor = 'stock';
    });
    if (!donor) return;
    const donorRoots = wheelRoots(donor);
    if (!donorRoots.length) return;
    model.updateMatrixWorld(true);
    donor.updateMatrixWorld(true);
    const toParent = (m: THREE.Object3D) =>
        new THREE.Matrix4().compose(new THREE.Vector3(), m.quaternion, m.scale);
    roots.forEach((root) => {
        if (root.userData.garageDonor === donorId) return;
        const myParts = wheelParts(model, root);
        const myBox = partsBox(myParts);
        if (myBox.isEmpty()) return;
        const mySide =
            Math.sign(
                myBox.getCenter(new THREE.Vector3()).applyMatrix4(toParent(model)).x
            ) || 1;
        // the donor wheel on the same side, cut to that side when the donor
        // keeps a whole axle in one node (the amg one)
        let theirParts: Part[] = [];
        for (const candidate of donorRoots) {
            theirParts = sidePart(donor, wheelParts(donor, candidate), mySide);
            if (theirParts.length) break;
        }
        const theirBox = partsBox(theirParts);
        if (theirBox.isEmpty()) return;
        const mySize = myBox.getSize(new THREE.Vector3()).applyMatrix4(toParent(model));
        const theirSize = theirBox
            .getSize(new THREE.Vector3())
            .applyMatrix4(toParent(donor));
        // diameter is the larger of the height and length in the parent
        // frame, width is across the car
        const myDiameter = Math.max(Math.abs(mySize.y), Math.abs(mySize.z));
        const theirDiameter = Math.max(Math.abs(theirSize.y), Math.abs(theirSize.z));
        if (!(myDiameter > 0 && theirDiameter > 0)) return;
        const k = myDiameter / theirDiameter;
        // the new rim and tyre take this car's tyre width, so they sit in the
        // arch like the factory ones instead of poking out or sinking in
        const kx = THREE.MathUtils.clamp(
            Math.abs(mySize.x) / Math.max(1e-6, Math.abs(theirSize.x) * k),
            0.7,
            1.5
        ) * k;
        // donor model frame -> parent frame, rescaled about the wheel center
        // -> this model -> this wheel root
        const theirCenter = theirBox.getCenter(new THREE.Vector3());
        const myCenter = myBox.getCenter(new THREE.Vector3());
        const transform = new THREE.Matrix4()
            .makeTranslation(myCenter.x, myCenter.y, myCenter.z)
            .multiply(toParent(model).invert())
            .multiply(new THREE.Matrix4().makeScale(kx, k, k))
            .multiply(toParent(donor))
            .multiply(
                new THREE.Matrix4().makeTranslation(
                    -theirCenter.x,
                    -theirCenter.y,
                    -theirCenter.z
                )
            );
        const toRoot = new THREE.Matrix4()
            .copy(root.matrixWorld)
            .invert()
            .multiply(model.matrixWorld);
        theirParts.forEach((part) => {
            const copy = new THREE.Mesh(part.geometry, part.material);
            // a width change isn't a plain scale in the wheel's frame, so the
            // matrix is set as it is
            copy.matrixAutoUpdate = false;
            copy.matrix
                .multiplyMatrices(toRoot, transform)
                .multiply(part.matrix);
            copy.castShadow = part.castShadow;
            copy.userData.garageRim = true;
            root.add(copy);
        });
        root.children.forEach((child) => {
            if (child.userData.garageRim) return;
            if (child.userData.garageVisible === undefined)
                child.userData.garageVisible = child.visible;
            child.visible = false;
        });
        const rootMesh = root as THREE.Mesh;
        if (rootMesh.isMesh && !root.userData.garageOwnMaterial) {
            // hiding the mesh would hide the new rims under it too
            root.userData.garageOwnMaterial = rootMesh.material;
            const hidden = (rootMesh.material as THREE.Material).clone();
            hidden.visible = false;
            rootMesh.material = hidden;
        }
        root.userData.garageDonor = donorId;
    });
};

// the paint materials of any clone of this car's model (the homepage's own
// car too, which has no wheel rig), and the metalness and roughness a finish
// paints them with (null keeps the factory values)
export const paintMaterialsOf = (model: THREE.Object3D, carId: string) => {
    const found = new Set<THREE.MeshStandardMaterial>();
    model.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || Array.isArray(mesh.material)) return;
        const material = mesh.material as THREE.MeshStandardMaterial;
        if (material.isMeshStandardMaterial && isPaint(carId, material.name || ''))
            found.add(material);
    });
    return [...found];
};

export const finishOf = (finish: PaintFinish) =>
    finish === 'stock' ? null : { metalness: FINISHES[finish].metalness, roughness: FINISHES[finish].roughness };

export type LookOptions = {
    // a prepared model of the car whose rims look.wheels asks for
    donor?: THREE.Object3D | null;
};

export const applyCarLook = (
    model: THREE.Object3D,
    carId: string,
    look: CarLook = STOCK_LOOK,
    options: LookOptions = {}
) => {
    const rootList = wheelRoots(model);
    // brakes and the like grouped per wheel stay with the wheels too
    const hubs = model.children.filter((child) => child.userData.raceHub);
    const roots = new Set([...rootList, ...hubs]);
    const spinning = new Set(rootList);
    setWheels(
        model,
        rootList,
        look.wheels !== 'stock' ? options.donor || null : null,
        look.wheels
    );
    model.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (
            !mesh.isMesh ||
            Array.isArray(mesh.material) ||
            child.userData.garageKit
        )
            return;
        const name = (mesh.material as THREE.Material).name || '';
        const lower = name.toLowerCase();
        const wheel = underAny(mesh, spinning, model);
        if (!wheel && isPaint(carId, name)) {
            const touched =
                (mesh.material as THREE.Material).userData.garageOwner ===
                model.uuid;
            if (!touched && !look.paint && look.finish === 'stock') return;
            paintMaterial(physicalPaint(model, mesh), look.paint, look.finish);
            return;
        }
        if (CALIPER.test(lower) && !/badge/.test(lower)) {
            const material =
                (mesh.material as THREE.Material).userData.garageOwner ===
                model.uuid
                    ? (mesh.material as THREE.MeshPhysicalMaterial)
                    : look.calipers
                      ? ownMaterial(model, mesh)
                      : null;
            if (!material) return;
            restore(material);
            if (look.calipers) {
                material.color.set(look.calipers);
                material.map = null;
            }
            material.needsUpdate = true;
            return;
        }
        if (wheel && !TIRE.test(lower)) {
            const m = mesh.material as THREE.MeshStandardMaterial;
            const rimLike =
                /wheel|rim|hub/.test(lower) || (m.metalness ?? 0) >= 0.3;
            if (!rimLike) return;
            const material =
                m.userData.garageOwner === model.uuid
                    ? (m as THREE.MeshPhysicalMaterial)
                    : look.rims
                      ? ownMaterial(model, mesh)
                      : null;
            if (!material) return;
            restore(material);
            if (look.rims) {
                // rim and tire often share one textured material, dark grey
                // rim and near black rubber. a brightened tint over the map
                // colors the rim and leaves the rubber black
                material.color.set(look.rims);
                if (material.map) material.color.multiplyScalar(3.2);
            }
            material.needsUpdate = true;
        }
    });
    // the kit is sized on the car at stock height, then moves with the body
    applyRide(model, roots, 0);
    setKit(model, roots, look.spoiler, carId);
    applyRide(model, roots, rideOffsetMeters(look));
};

// the homepage's car takes the look off the race's prepared model of the same
// car: its wheel node names, then paint and ride height done here, and the
// rims and body kit copied over. both are clones of one gltf scene, so a
// part's transform under the root, or under a wheel node, means the same
// thing in both. without every wheel node (the crown's split wheels are made
// by the race) it gets the paint only
export const copyCarLook = (
    source: THREE.Object3D,
    target: THREE.Object3D,
    carId: string,
    look: CarLook
) => {
    const meta = (source.userData.raceWheelMeta || []) as Array<{ objectName: string }>;
    const names = meta.map((entry) => entry.objectName);
    const complete = names.length > 0 && names.every((name) => target.getObjectByName(name));
    target.userData.raceWheelMeta = complete ? meta : [];
    applyCarLook(target, carId, {
        ...look,
        wheels: 'stock',
        spoiler: 'none',
        ride: complete ? look.ride : 0,
    });
    if (!complete) return;
    names.forEach((name) => {
        const from = source.getObjectByName(name)!;
        const to = target.getObjectByName(name)!;
        const rims = from.children.filter((child) => child.userData.garageRim);
        if (!rims.length) return;
        rims.forEach((rim) => to.add(rim.clone()));
        to.children.forEach((child) => {
            if (child.userData.garageRim) return;
            if (child.userData.garageVisible === undefined)
                child.userData.garageVisible = child.visible;
            child.visible = false;
        });
        const toMesh = to as THREE.Mesh;
        if (toMesh.isMesh && !to.userData.garageOwnMaterial) {
            to.userData.garageOwnMaterial = toMesh.material;
            const hidden = (toMesh.material as THREE.Material).clone();
            hidden.visible = false;
            toMesh.material = hidden;
        }
        to.userData.garageDonor = look.wheels;
    });
    const kit = source.getObjectByName('garage-kit');
    if (kit) target.add(kit.clone());
};
