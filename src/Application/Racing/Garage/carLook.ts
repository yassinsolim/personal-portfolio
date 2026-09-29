// puts a garage look on a prepared car model: paint and finish, rim and
// caliper colors, rims from another car, a body kit and the ride height. it
// works by material and node names, so it also works on the clones remote
// cars use, and it can be applied again at any time (live garage preview).
// materials are copied before they're changed, clones share them otherwise
import * as THREE from 'three';
import type { CarLook, PaintFinish } from './garage';
import { rideOffsetMeters, STOCK_LOOK } from './garage';

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

let kitMaterial: THREE.MeshStandardMaterial | null = null;
const getKitMaterial = () => {
    if (!kitMaterial) {
        kitMaterial = new THREE.MeshStandardMaterial({
            color: 0x15171a,
            roughness: 0.35,
            metalness: 0.4,
        });
    }
    return kitMaterial;
};

// a ducktail lip or a gt wing on the boot, sized from the car's box. built in
// the parent frame (forward is +z) and moved into the model's
const buildKit = (
    model: THREE.Object3D,
    roots: Set<THREE.Object3D>,
    kind: CarLook['spoiler']
) => {
    // mesh boxes blow up under the models' rotations, so width and length
    // come from the measured body size and the boot from rays on the mesh
    const body = model.userData.raceBodySize as number[] | undefined;
    const fallback = pivotBox(model, roots).getSize(new THREE.Vector3());
    const size = new THREE.Vector3(
        body ? body[0] : fallback.x,
        body ? body[1] : fallback.y,
        body ? body[2] : fallback.z
    );
    model.updateMatrixWorld(true);
    const parentMatrix = model.parent
        ? model.parent.matrixWorld
        : new THREE.Matrix4();
    const inverseParent = new THREE.Matrix4().copy(parentMatrix).invert();
    const raycaster = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0).transformDirection(parentMatrix);
    // highest body point straight down at (0, z) in the parent frame
    const heightAt = (z: number) => {
        raycaster.set(
            new THREE.Vector3(0, 20, z).applyMatrix4(parentMatrix),
            down
        );
        const hit = raycaster
            .intersectObject(model, true)
            .find(
                (h) =>
                    !h.object.userData.garageKit &&
                    !/shadow/i.test(h.object.name) &&
                    !((h.object as THREE.Mesh).material as THREE.Material)
                        .transparent &&
                    !underAny(h.object, roots, model)
            );
        return hit ? hit.point.clone().applyMatrix4(inverseParent).y : null;
    };
    // step forward from behind the car to its rear edge
    let rear = -size.z / 2;
    for (let z = -size.z / 2 - 0.4; z < 0; z += 0.04) {
        if (heightAt(z) !== null) {
            rear = z;
            break;
        }
    }
    let boot = -Infinity;
    for (let z = rear; z < rear + 0.45; z += 0.05) {
        const y = heightAt(z);
        if (y !== null) boot = Math.max(boot, y);
    }
    if (!Number.isFinite(boot)) boot = size.y * 0.6;
    const group = new THREE.Group();
    const material = getKitMaterial();
    const span = size.x * (kind === 'wing' ? 0.86 : 0.78);
    if (kind === 'ducktail') {
        const lip = new THREE.Mesh(
            new THREE.BoxGeometry(span, 0.012, 0.11),
            material
        );
        lip.position.set(0, boot + 0.02, rear + size.z * 0.05);
        lip.rotation.x = -0.35;
        group.add(lip);
    } else {
        const height = 0.3;
        const z = rear + size.z * 0.07;
        const blade = new THREE.Mesh(
            new THREE.BoxGeometry(span, 0.018, 0.27),
            material
        );
        blade.position.set(0, boot + height, z - 0.03);
        blade.rotation.x = -0.14;
        group.add(blade);
        [-1, 1].forEach((side) => {
            const upright = new THREE.Mesh(
                new THREE.BoxGeometry(0.025, height, 0.1),
                material
            );
            upright.position.set(side * span * 0.32, boot + height / 2, z);
            group.add(upright);
            const plate = new THREE.Mesh(
                new THREE.BoxGeometry(0.012, 0.12, 0.32),
                material
            );
            plate.position.set(
                side * span * 0.5,
                boot + height - 0.01,
                z - 0.03
            );
            group.add(plate);
        });
    }
    group.traverse((child) => {
        child.userData.garageKit = true;
        (child as THREE.Mesh).castShadow = true;
    });
    group.applyMatrix4(new THREE.Matrix4().copy(model.matrix).invert());
    group.name = 'garage-kit';
    return group;
};

const setKit = (
    model: THREE.Object3D,
    roots: Set<THREE.Object3D>,
    kind: CarLook['spoiler']
) => {
    const old = model.getObjectByName('garage-kit');
    if (old && old.userData.kind === kind) return;
    if (old) {
        old.removeFromParent();
        old.traverse((child) => (child as THREE.Mesh).geometry?.dispose());
    }
    if (kind === 'none') return;
    const kit = buildKit(model, roots, kind);
    kit.userData.kind = kind;
    model.add(kit);
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
    // centers and radii in each model's own frame
    const measure = (m: THREE.Object3D, root: THREE.Object3D) => {
        const box = new THREE.Box3();
        const toModel = new THREE.Matrix4().copy(m.matrixWorld).invert();
        root.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (!mesh.isMesh || child.userData.garageRim) return;
            if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
            box.union(
                mesh.geometry
                    .boundingBox!.clone()
                    .applyMatrix4(
                        new THREE.Matrix4().multiplyMatrices(
                            toModel,
                            mesh.matrixWorld
                        )
                    )
            );
        });
        return box;
    };
    const side = (m: THREE.Object3D, root: THREE.Object3D) => {
        const center = measure(m, root).getCenter(new THREE.Vector3());
        return Math.sign(center.clone().applyQuaternion(m.quaternion).x) || 1;
    };
    roots.forEach((root) => {
        if (root.userData.garageDonor === donorId) return;
        const mySide = side(model, root);
        const source =
            donorRoots.find((candidate) => side(donor, candidate) === mySide) ||
            donorRoots[0];
        const myBox = measure(model, root);
        const theirBox = measure(donor, source);
        const mySize = myBox
            .getSize(new THREE.Vector3())
            .applyQuaternion(model.quaternion);
        const theirSize = theirBox
            .getSize(new THREE.Vector3())
            .applyQuaternion(donor.quaternion);
        // diameter is the larger of the height and length in the parent frame
        const myDiameter =
            Math.max(Math.abs(mySize.y), Math.abs(mySize.z)) * model.scale.x;
        const theirDiameter =
            Math.max(Math.abs(theirSize.y), Math.abs(theirSize.z)) *
            donor.scale.x;
        if (!(myDiameter > 0 && theirDiameter > 0)) return;
        // donor wheel frame -> donor model frame -> parent frame, rescaled
        // about the wheel center -> this model -> this wheel root
        const theirCenter = theirBox.getCenter(new THREE.Vector3());
        const myCenter = myBox.getCenter(new THREE.Vector3());
        const donorToParent = new THREE.Matrix4().compose(
            new THREE.Vector3(),
            donor.quaternion,
            donor.scale
        );
        const parentToModel = new THREE.Matrix4()
            .compose(new THREE.Vector3(), model.quaternion, model.scale)
            .invert();
        const k = myDiameter / theirDiameter;
        const transform = new THREE.Matrix4()
            .makeTranslation(myCenter.x, myCenter.y, myCenter.z)
            .multiply(parentToModel)
            .multiply(new THREE.Matrix4().makeScale(k, k, k))
            .multiply(donorToParent)
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
        const donorToModelSpace = new THREE.Matrix4()
            .copy(donor.matrixWorld)
            .invert();
        source.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (!mesh.isMesh || child.userData.garageRim) return;
            const copy = new THREE.Mesh(mesh.geometry, mesh.material);
            const inDonor = new THREE.Matrix4().multiplyMatrices(
                donorToModelSpace,
                mesh.matrixWorld
            );
            const matrix = new THREE.Matrix4()
                .multiplyMatrices(toRoot, transform)
                .multiply(inDonor);
            matrix.decompose(copy.position, copy.quaternion, copy.scale);
            copy.castShadow = mesh.castShadow;
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
    const roots = new Set(rootList);
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
        const wheel = underAny(mesh, roots, model);
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
    setKit(model, roots, look.spoiler);
    applyRide(model, roots, rideOffsetMeters(look));
};
