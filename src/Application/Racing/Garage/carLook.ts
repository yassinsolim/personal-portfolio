// puts a garage look on a prepared car model: paint and finish, rim and
// caliper colors, rims from another car, a body kit and the ride height. it
// works by material and node names, so it also works on the clones remote
// cars use, and it can be applied again at any time (live garage preview).
// materials are copied before they're changed, clones share them otherwise
import * as THREE from 'three';
import type { CarLook, PaintFinish, Spoiler } from './garage';
import { rideOffsetMeters, STOCK_LOOK } from './garage';
import { buildKitParts, type KitSurface } from './bodyKit';

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
    'lamborghini-huracan': ['paint_material'],
    'ferrari-laferrari': ['mat_carpaint_red'],
    'porsche-918-spyder': ['paint_material'],
    'bugatti-chiron-super-sport': ['paint_material'],
    'mclaren-senna': ['paint_material'],
    'ferrari-sf90-stradale': ['paint_material'],
    'toyota-supra-mk4': ['carpaint'],
};
// the amg one's painted panels are plain 'black' too, which only counts as
// paint off the wheels. the p1 and aventador name their black trim after the
// paint, and the huayra and valkyrie their second colour
const PAINT_EXACT: Record<string, string[]> = {
    'amg-one': ['black', 'material'],
    'mclaren-p1': ['carpaint'],
    'lamborghini-aventador-s': ['lambom_carpaint_max1'],
    'koenigsegg-jesko': ['jeskovehicle_exterior_mm_ext1'],
    'pagani-huayra': ['pag_huayra_paint'],
    'aston-martin-valkyrie': ['body'],
};
const CALIPER = /callipergloss|calliperanodised|_caliper|tire_brake|^brakes$/;
const BRAKE = /disc|disk|brake|calip|rotor/;
// rims named and finished like nothing in particular (the valkyrie's merged spokes)
const RIM_EXACT: Record<string, string[]> = {
    'aston-martin-valkyrie': ['material'],
};
// rim or tire goes by shape, whatever the materials are called (some exports
// name the tire 'wheel' and the rim 'tire_hub'). as shares of the wheel's
// radius: a tire reaches the tread and sits mostly out past where a sidewall
// can start, a rim and tire made as one piece are cut at the band (a rim's
// lip reaches about 0.8)
const TIRE_REACH = 0.93;
const TIRE_EDGE = 0.72;
const TIRE_BAND = 0.81;
// a wheel node under this share of its race wheel's size holds only the rim
const RIM_ONLY_SHARE = 0.9;
// a colored rim is painted: the color reads on every rim, not just as a
// tint on chrome
const RIM_PAINT = { metalness: 0.45, roughness: 0.32, clearcoat: 0.6 };

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
    vertexColors?: boolean;
    shininess?: number;
    reflectivity?: number;
    specular?: THREE.Color;
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
// (a copy of another model's copy keeps that one's factory values)
const ownMaterial = (model: THREE.Object3D, mesh: THREE.Mesh) => {
    const current = mesh.material as THREE.MeshPhysicalMaterial;
    if (current.userData.garageOwner === model.uuid) return current;
    const copy = current.clone();
    copy.userData = {
        ...current.userData,
        garageOwner: model.uuid,
        garageStock: current.userData.garageStock ?? ({
            color: current.color.clone(),
            metalness: current.metalness,
            roughness: current.roughness,
            clearcoat: current.clearcoat,
            clearcoatRoughness: current.clearcoatRoughness,
            iridescence: current.iridescence,
            map: current.map,
            vertexColors: current.vertexColors,
            shininess: (current as unknown as THREE.MeshPhongMaterial)
                .shininess,
            reflectivity: (current as unknown as THREE.MeshPhongMaterial)
                .reflectivity,
            specular: (current as unknown as THREE.MeshPhongMaterial).specular?.clone(),
        } as Stock),
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

// a colored rim's texture keeps its shading (spokes over a dark barrel), but
// a dark texture doesn't swallow the color: its darkest parts keep 40% of it
const TINT_MAP = /* glsl */ `
#ifdef USE_MAP
    vec4 garageTexel = texture2D( map, vMapUv );
    float garageLuma = dot( garageTexel.rgb, vec3( 0.299, 0.587, 0.114 ) );
    diffuseColor.rgb *= mix( 0.4, 1.0, smoothstep( 0.0, 0.5, garageLuma ) );
    diffuseColor.a *= garageTexel.a;
#endif
`;
const tintMap = (material: THREE.Material, on: boolean) => {
    const tinted = material.userData.garageTint === true;
    if (tinted === on) return;
    material.userData.garageTint = on;
    material.onBeforeCompile = on
        ? (shader) => {
              shader.fragmentShader = shader.fragmentShader.replace(
                  '#include <map_fragment>',
                  TINT_MAP
              );
          }
        : THREE.Material.prototype.onBeforeCompile;
    material.customProgramCacheKey = on
        ? () => 'garage-rim-tint'
        : THREE.Material.prototype.customProgramCacheKey;
    material.needsUpdate = true;
};

const restore = (material: THREE.MeshPhysicalMaterial) => {
    const stock = material.userData.garageStock as Stock | undefined;
    if (!stock) return;
    tintMap(material, false);
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
        const phong = material as unknown as THREE.MeshPhongMaterial;
        phong.shininess = stock.shininess;
        if (stock.reflectivity !== undefined) phong.reflectivity = stock.reflectivity;
        if (stock.specular) phong.specular.copy(stock.specular);
    }
    material.map = stock.map;
    if (stock.vertexColors !== undefined) material.vertexColors = stock.vertexColors;
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
        // factory liveries are baked into the map, a repaint covers them,
        // and the paint masks some exports keep in their vertex colours
        material.map = null;
        material.vertexColors = false;
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
    up: number,
    // meters in one of the model's units
    unit = model.scale.y || 1
) => {
    model.updateMatrixWorld(true);
    const toParent = new THREE.Matrix4()
        .copy(parent.matrixWorld)
        .invert()
        .multiply(model.matrixWorld);
    const a = new THREE.Vector3(0, 0, 0).applyMatrix4(toParent);
    const b = new THREE.Vector3(0, up / unit, 0).applyMatrix4(toParent);
    return b.sub(a);
};

// ride height moves the body, not the wheels
const applyRide = (
    model: THREE.Object3D,
    roots: Set<THREE.Object3D>,
    meters: number,
    unit?: number
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
            child.position.add(localDelta(model, child.parent, meters, unit));
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
    length: number,
    center: THREE.Vector3
) => {
    const cell = 0.01;
    const x0 = center.x - width / 2;
    const z0 = center.z - length / 2 - 0.5;
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
    kind: CarLook['spoiler']
) => {
    // mesh boxes blow up under the models' rotations, so width and length
    // come from the measured body size
    const body = model.userData.raceBodySize as number[] | undefined;
    const bounds = pivotBox(model, roots);
    const fallback = bounds.getSize(new THREE.Vector3());
    const width = body ? body[0] : fallback.x;
    const length = body ? body[2] : fallback.z;
    // not every model sits centered on its pivot (the crown's starts at its
    // nose), so the boot is looked for around the body's own middle
    const center = bounds.getCenter(new THREE.Vector3());
    const field = topField(model, roots, width, length, center);
    const surface: KitSurface = (x, z) => field(x + center.x, z + center.z);
    const group = buildKitParts(kind, surface, width, length);
    group.traverse((child) => {
        child.userData.garageKit = true;
    });
    group.position.set(center.x, 0, center.z);
    group.applyMatrix4(new THREE.Matrix4().copy(model.matrix).invert());
    group.name = 'garage-kit';
    return group;
};

// the kits that can be shaped on this car's boot (a hypercar's tail has no
// lid for a ducktail), worked out once per model
export const kitsThatFit = (model: THREE.Object3D) => {
    const known = model.userData.garageKitsFit as Spoiler[] | undefined;
    if (known) return known;
    const roots = new Set([
        ...wheelRoots(model),
        ...model.children.filter((child) => child.userData.raceHub),
    ]);
    const fits = (['ducktail', 'wing'] as Spoiler[]).filter((kind) => {
        const kit = buildKit(model, roots, kind);
        let meshes = 0;
        kit.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (!mesh.isMesh) return;
            meshes++;
            mesh.geometry.dispose();
        });
        return meshes > 0;
    });
    model.userData.garageKitsFit = fits;
    return fits;
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

type Part = {
    geometry: THREE.BufferGeometry;
    material: THREE.Material | THREE.Material[];
    castShadow: boolean;
    // mesh to its model's frame
    matrix: THREE.Matrix4;
    // rim or tire, once the wheel is marked (markWheels)
    part?: string;
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
            part: child.userData.garagePart,
        });
    });
    return parts;
};

// a wheel node's own parts under swapped rims: all hidden, or all but the
// tire when the swapped wheel brings none of its own
const hideOwn = (root: THREE.Object3D, keepTire: boolean) => {
    root.traverse((child) => {
        if (child === root || child.userData.garageRim) return;
        if (!(child as THREE.Mesh).isMesh) return;
        if (keepTire && child.userData.garagePart === 'tire') return;
        if (child.userData.garageVisible === undefined)
            child.userData.garageVisible = child.visible;
        child.visible = false;
    });
    const rootMesh = root as THREE.Mesh;
    const keepRoot = keepTire && root.userData.garagePart === 'tire';
    if (rootMesh.isMesh && !root.userData.garageOwnMaterial && !keepRoot) {
        // hiding the mesh would hide the new rims under it too
        root.userData.garageOwnMaterial = rootMesh.material;
        const hidden = (rootMesh.material as THREE.Material).clone();
        hidden.visible = false;
        rootMesh.material = hidden;
    }
};

const showOwn = (root: THREE.Object3D) => {
    root.traverse((child) => {
        if (child === root || child.userData.garageRim) return;
        if (child.userData.garageVisible !== undefined)
            child.visible = child.userData.garageVisible;
    });
    // a root that's a mesh itself (the e92's) got an invisible material
    const rootMesh = root as THREE.Mesh;
    if (rootMesh.isMesh && root.userData.garageOwnMaterial) {
        rootMesh.material = root.userData.garageOwnMaterial;
        delete root.userData.garageOwnMaterial;
    }
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

type Line = { center: THREE.Vector3; axis: THREE.Vector3 };

// the line the race turns a wheel node about (its spin centre and axis), in
// the model's parent frame. spin and steer both turn the node about it, so it
// holds in any pose. a model's wheels are drawn true to it, cambered or not
const spinLine = (model: THREE.Object3D, root: THREE.Object3D): Line | null => {
    const meta = (model.userData.raceWheelMeta || []) as Array<{
        objectName: string;
        spinCenter?: number[];
        spinAxis?: number[];
    }>;
    const entry = meta.find((item) => item.objectName === root.name);
    if (!entry?.spinCenter || !entry.spinAxis || !root.parent) return null;
    const toFrame = new THREE.Matrix4()
        .compose(new THREE.Vector3(), model.quaternion, model.scale)
        .multiply(new THREE.Matrix4().copy(model.matrixWorld).invert());
    const center = root.parent
        .localToWorld(new THREE.Vector3().fromArray(entry.spinCenter))
        .applyMatrix4(toFrame);
    const axis = new THREE.Vector3()
        .fromArray(entry.spinAxis)
        .transformDirection(new THREE.Matrix4().multiplyMatrices(toFrame, root.matrixWorld));
    if (!(axis.lengthSq() > 0.5)) return null;
    return { center, axis };
};

// a wheel's size about the line it turns on, through a frame: its outer
// radius, its width along the line, and the point on the line halfway across
// it. without a line, its box with the axle across the car (frame x)
const measureWheel = (parts: Part[], frame: THREE.Matrix4, line: Line | null) => {
    if (!line) {
        const box = partsBox(parts).applyMatrix4(frame);
        const size = box.getSize(new THREE.Vector3());
        return {
            center: box.getCenter(new THREE.Vector3()),
            axis: new THREE.Vector3(1, 0, 0),
            radius: Math.max(size.y, size.z) / 2,
            width: size.x,
        };
    }
    const point = new THREE.Vector3();
    let low = Infinity;
    let high = -Infinity;
    let radius = 0;
    parts.forEach((part) => {
        const position = part.geometry.getAttribute('position');
        const index = part.geometry.index;
        if (!position) return;
        const matrix = frame.clone().multiply(part.matrix);
        // the vertices the triangles use: a cut half keeps the whole attribute
        const count = index ? index.count : position.count;
        const step = Math.max(1, Math.floor(count / 6000));
        for (let i = 0; i < count; i += step) {
            point
                .fromBufferAttribute(position, index ? index.getX(i) : i)
                .applyMatrix4(matrix)
                .sub(line.center);
            const along = point.dot(line.axis);
            low = Math.min(low, along);
            high = Math.max(high, along);
            radius = Math.max(radius, Math.sqrt(Math.max(0, point.lengthSq() - along * along)));
        }
    });
    if (!(high >= low)) return measureWheel(parts, frame, null);
    return {
        center: line.center.clone().addScaledVector(line.axis, (low + high) / 2),
        axis: line.axis.clone(),
        radius,
        width: high - low,
    };
};

// along times along a unit axis, across times across it
const scaleAlong = (axis: THREE.Vector3, along: number, across: number) => {
    const d = along - across;
    const { x, y, z } = axis;
    return new THREE.Matrix4().set(
        across + d * x * x, d * x * y, d * x * z, 0,
        d * y * x, across + d * y * y, d * y * z, 0,
        d * z * x, d * z * y, across + d * z * z, 0,
        0, 0, 0, 1
    );
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
        const swapped = root.children.filter(
            (child) => child.userData.garageRim
        );
        if (root.userData.garageDonor === donorId) return;
        swapped.forEach((child) => child.removeFromParent());
        showOwn(root);
        root.userData.garageDonor = 'stock';
    });
    if (!donor) return;
    const donorRoots = wheelRoots(donor);
    if (!donorRoots.length) return;
    // which of the donor's parts are tire, told in its own frame
    markWheels(donor, donorRoots);
    model.updateMatrixWorld(true);
    donor.updateMatrixWorld(true);
    const toParent = (m: THREE.Object3D) =>
        new THREE.Matrix4().compose(new THREE.Vector3(), m.quaternion, m.scale);
    roots.forEach((root) => {
        if (root.userData.garageDonor === donorId) return;
        const own = wheelParts(model, root);
        const ownBox = partsBox(own);
        if (ownBox.isEmpty()) return;
        // a node holding a whole axle (the amg one's) takes a wheel each side
        const across = Math.abs(
            ownBox.getSize(new THREE.Vector3()).applyMatrix4(toParent(model)).x
        );
        const sides =
            across >= 0.9
                ? [-1, 1]
                : [
                      Math.sign(
                          ownBox.getCenter(new THREE.Vector3()).applyMatrix4(toParent(model)).x
                      ) || 1,
                  ];
        let theirTire = false;
        let fitted = false;
        const spin = spinLine(model, root);
        sides.forEach((mySide) => {
            const myParts = sides.length > 1 ? sidePart(model, own, mySide) : own;
            if (partsBox(myParts).isEmpty()) return;
            // the donor wheel on the same side, cut to that side when the donor
            // keeps a whole axle in one node
            let theirParts: Part[] = [];
            let theirRoot: THREE.Object3D | null = null;
            for (const candidate of donorRoots) {
                theirParts = sidePart(donor, wheelParts(donor, candidate), mySide);
                theirRoot = candidate;
                if (theirParts.length) break;
            }
            if (!theirRoot || partsBox(theirParts).isEmpty()) return;
            // a donor wheel node can hold only the rim (the e92's): then it's
            // sized by its real tire and goes inside this car's tire
            theirTire = theirTire || theirParts.some((part) => part.part === 'tire');
            // each wheel about the line its car turns it on, in its parent frame
            // (x across the car). a model can draw its wheels cambered or tipped
            // off the car's axes; the donor wheel's own line is stood on this
            // one's, or it wobbles as it turns
            const mine = measureWheel(myParts, toParent(model), spin);
            const theirs = measureWheel(theirParts, toParent(donor), spinLine(donor, theirRoot));
            // a donor node well short of its race wheel radius holds only the
            // rim, which is sized by that radius so it lands inside this car's tire
            const theirRace = Number(donor.userData.raceWheelRadius) || 0;
            const theirRadius =
                theirs.radius >= theirRace * RIM_ONLY_SHARE ? theirs.radius : theirRace;
            if (!(mine.radius > 0 && theirRadius > 0)) return;
            const k = mine.radius / theirRadius;
            // the new rim and tyre take this car's tyre width, so they sit in the
            // arch like the factory ones instead of poking out or sinking in
            const kx = THREE.MathUtils.clamp(
                mine.width / Math.max(1e-6, theirs.width * k),
                0.7,
                1.5
            ) * k;
            // both axles pointing out of their cars
            const outward = (axis: THREE.Vector3) =>
                axis.x * mySide < 0 ? axis.clone().negate() : axis.clone();
            const myAxis = outward(mine.axis);
            const theirAxis = outward(theirs.axis);
            // donor model frame -> its parent frame -> donor wheel at the origin,
            // resized along and across its axle -> turned onto this axle -> this
            // wheel's middle -> this model -> this wheel root
            const transform = new THREE.Matrix4()
                .copy(toParent(model).invert())
                .multiply(
                    new THREE.Matrix4().makeTranslation(
                        mine.center.x,
                        mine.center.y,
                        mine.center.z
                    )
                )
                .multiply(
                    new THREE.Matrix4().makeRotationFromQuaternion(
                        new THREE.Quaternion().setFromUnitVectors(theirAxis, myAxis)
                    )
                )
                .multiply(scaleAlong(theirAxis, kx, k))
                .multiply(
                    new THREE.Matrix4().makeTranslation(
                        -theirs.center.x,
                        -theirs.center.y,
                        -theirs.center.z
                    )
                )
                .multiply(toParent(donor));
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
                copy.userData.garagePart = part.part;
                root.add(copy);
            });
            fitted = true;
        });
        if (!fitted) return;
        hideOwn(root, !theirTire);
        root.userData.garageDonor = donorId;
    });
};

// the model's rotation and scale: x across the car, lengths in meters
const parentFrame = (model: THREE.Object3D) =>
    new THREE.Matrix4().compose(new THREE.Vector3(), model.quaternion, model.scale);

type WheelCircle = { y: number; z: number; r: number };

// a wheel's circle in the parent frame: the middle of its own parts, and the
// tire's radius. a node that comes near the race model's wheel radius has its
// tire, one well short holds only the rim and the race radius is the tire's
const wheelCircle = (model: THREE.Object3D, root: THREE.Object3D) => {
    const cached = root.userData.garageCircle as WheelCircle | undefined;
    if (cached) return cached;
    const box = partsBox(wheelParts(model, root));
    if (box.isEmpty()) return null;
    box.applyMatrix4(parentFrame(model));
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const own = Math.max(size.y / 2, size.z / 2);
    const tire = Number(model.userData.raceWheelRadius) || 0;
    const circle = {
        y: center.y,
        z: center.z,
        r: own >= tire * RIM_ONLY_SHARE ? own : tire,
    };
    root.userData.garageCircle = circle;
    return circle;
};

type WheelSplit = {
    part: 'rim' | 'tire' | 'both';
    tire?: THREE.BufferGeometry;
    rim?: THREE.BufferGeometry;
};
// per geometry, clones and swapped rims share them
const wheelSplits = new WeakMap<THREE.BufferGeometry, WheelSplit>();

const subset = (geometry: THREE.BufferGeometry, indices: number[]) => {
    const part = new THREE.BufferGeometry();
    Object.entries(geometry.attributes).forEach(([name, attribute]) =>
        part.setAttribute(name, attribute)
    );
    part.setIndex(indices);
    part.computeBoundingBox();
    part.computeBoundingSphere();
    return part;
};

// the welded piece of each triangle. uv seams split vertices, not surfaces,
// and a seam's two sides can be a rounding apart
const piecesOf = (geometry: THREE.BufferGeometry, corners: Uint32Array) => {
    const position = geometry.getAttribute('position');
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    const snap = 1e4 / Math.max(geometry.boundingSphere!.radius, 1e-9);
    const ids = new Map<string, number>();
    const weld = new Uint32Array(position.count);
    for (let i = 0; i < position.count; i++) {
        const key = `${Math.round(position.getX(i) * snap)},${Math.round(
            position.getY(i) * snap
        )},${Math.round(position.getZ(i) * snap)}`;
        let id = ids.get(key);
        if (id === undefined) {
            id = ids.size;
            ids.set(key, id);
        }
        weld[i] = id;
    }
    const parent = Uint32Array.from({ length: ids.size }, (_, i) => i);
    const find = (x: number) => {
        while (parent[x] !== x) x = parent[x] = parent[parent[x]];
        return x;
    };
    for (let i = 0; i < corners.length; i += 3) {
        const a = find(weld[corners[i]]);
        parent[find(weld[corners[i + 1]])] = a;
        parent[find(weld[corners[i + 2]])] = a;
    }
    const piece = new Uint32Array(corners.length / 3);
    for (let t = 0; t < piece.length; t++) piece[t] = find(weld[corners[t * 3]]);
    return piece;
};

// rim or tire by where the triangles sit on the wheel. a mesh with both
// (one textured material for the pair) is cut in two
const splitOf = (
    model: THREE.Object3D,
    circle: WheelCircle,
    mesh: THREE.Mesh
): WheelSplit => {
    const known = wheelSplits.get(mesh.geometry);
    if (known) return known;
    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    const toFrame = parentFrame(model)
        .multiply(new THREE.Matrix4().copy(model.matrixWorld).invert())
        .multiply(mesh.matrixWorld);
    const v = new THREE.Vector3();
    const radius = new Float32Array(position.count);
    let max = 0;
    for (let i = 0; i < position.count; i++) {
        v.fromBufferAttribute(position, i).applyMatrix4(toFrame);
        radius[i] = Math.hypot(v.y - circle.y, v.z - circle.z) / circle.r;
        max = Math.max(max, radius[i]);
    }
    const index = geometry.index;
    const corners = new Uint32Array(
        index ? index.count - (index.count % 3) : position.count - (position.count % 3)
    );
    for (let i = 0; i < corners.length; i++) corners[i] = index ? index.getX(i) : i;
    const middle = new Float32Array(corners.length / 3);
    let outer = 0;
    for (let t = 0; t < middle.length; t++) {
        middle[t] =
            (radius[corners[t * 3]] + radius[corners[t * 3 + 1]] + radius[corners[t * 3 + 2]]) / 3;
        if (middle[t] >= TIRE_EDGE) outer++;
    }
    let split: WheelSplit;
    if (max < TIRE_REACH) split = { part: 'rim' };
    else if (outer >= middle.length * 0.9) split = { part: 'tire' };
    else {
        const piece = piecesOf(geometry, corners);
        const pieces = new Map<number, { count: number; outer: number; reach: number }>();
        for (let t = 0; t < middle.length; t++) {
            const entry = pieces.get(piece[t]) || { count: 0, outer: 0, reach: 0 };
            entry.count++;
            if (middle[t] >= TIRE_EDGE) entry.outer++;
            for (let k = 0; k < 3; k++)
                entry.reach = Math.max(entry.reach, radius[corners[t * 3 + k]]);
            pieces.set(piece[t], entry);
        }
        const tire: number[] = [];
        const rim: number[] = [];
        for (let t = 0; t < middle.length; t++) {
            const entry = pieces.get(piece[t])!;
            const out =
                entry.reach >= TIRE_REACH &&
                (entry.outer >= entry.count * 0.6 || middle[t] >= TIRE_BAND);
            (out ? tire : rim).push(corners[t * 3], corners[t * 3 + 1], corners[t * 3 + 2]);
        }
        if (!rim.length) split = { part: 'tire' };
        else if (!tire.length) split = { part: 'rim' };
        else {
            split = { part: 'both', tire: subset(geometry, tire), rim: subset(geometry, rim) };
            wheelSplits.set(split.tire!, { part: 'tire' });
            wheelSplits.set(split.rim!, { part: 'rim' });
        }
    }
    wheelSplits.set(geometry, split);
    return split;
};

// marks every mesh on the spinning wheels rim or tire, cutting the ones with
// both: the mesh keeps the tire, a child with the same material takes the rim
const markWheels = (model: THREE.Object3D, roots: THREE.Object3D[]) => {
    model.updateMatrixWorld(true);
    roots.forEach((root) => {
        const circle = wheelCircle(model, root);
        const meshes: THREE.Mesh[] = [];
        root.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (mesh.isMesh && !mesh.userData.garagePart && !Array.isArray(mesh.material))
                meshes.push(mesh);
        });
        meshes.forEach((mesh) => {
            const split = circle ? splitOf(model, circle, mesh) : { part: 'rim' as const };
            if (split.part !== 'both') {
                mesh.userData.garagePart = split.part;
                return;
            }
            mesh.geometry = split.tire!;
            mesh.userData.garagePart = 'tire';
            const rim = new THREE.Mesh(split.rim!, mesh.material);
            rim.name = `${mesh.name}-rim`;
            rim.castShadow = mesh.castShadow;
            rim.receiveShadow = mesh.receiveShadow;
            rim.userData = { ...mesh.userData, garagePart: 'rim' };
            mesh.add(rim);
        });
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
    // meters in one of the model's units, when its parent isn't in meters (the room)
    unit?: number;
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
    markWheels(model, rootList);
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
        if (wheel && mesh.userData.garagePart === 'rim' && !BRAKE.test(lower)) {
            const m = mesh.material as THREE.MeshStandardMaterial;
            const metal = m.metalness ?? m.userData.garageMetalness ?? 0;
            const rimCar = mesh.userData.garageRim ? wheel.userData.garageDonor : carId;
            const rimLike =
                /wheel|rim|hub/.test(lower) ||
                metal >= 0.3 ||
                Boolean(RIM_EXACT[rimCar]?.includes(lower));
            if (!rimLike) return;
            // swapped rims can arrive in the donor car's own colors
            const owner = m.userData.garageOwner;
            const material =
                owner === model.uuid
                    ? (m as THREE.MeshPhysicalMaterial)
                    : look.rims || owner
                      ? ownMaterial(model, mesh)
                      : null;
            if (!material) return;
            restore(material);
            if (look.rims) {
                material.color.set(look.rims);
                tintMap(material, Boolean(material.map));
                if (material.isMeshStandardMaterial) {
                    material.metalness = RIM_PAINT.metalness;
                    material.roughness = RIM_PAINT.roughness;
                }
                if (material.isMeshPhysicalMaterial) {
                    material.clearcoat = RIM_PAINT.clearcoat;
                    material.clearcoatRoughness = 0.06;
                }
                const phong = material as unknown as THREE.MeshPhongMaterial;
                if (phong.isMeshPhongMaterial) {
                    // the cheap sky reflection would wash a painted rim to silver
                    phong.reflectivity = 0.06;
                    phong.specular.setScalar(0.35);
                    phong.shininess = 70;
                }
            }
            material.needsUpdate = true;
        }
    });
    // the kit is sized on the car at stock height, then moves with the body
    applyRide(model, roots, 0);
    setKit(model, roots, look.spoiler);
    applyRide(model, roots, rideOffsetMeters(look), options.unit);
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
    const meta = (source.userData.raceWheelMeta || []) as Array<{
        objectName: string;
        parts?: string[];
    }>;
    const names = meta.map((entry) => entry.objectName);
    const complete = names.length > 0 && names.every((name) => target.getObjectByName(name));
    target.userData.raceWheelMeta = complete ? meta : [];
    // the tire's radius, from the race model's frame into this one's
    const radius = Number(source.userData.raceWheelRadius);
    if (radius > 0 && source.scale.x > 0)
        target.userData.raceWheelRadius = (radius * target.scale.x) / source.scale.x;
    target.traverse((child) => {
        if (!child.userData.garageHiddenPart) return;
        child.visible = true;
        delete child.userData.garageHiddenPart;
    });
    applyCarLook(
        target,
        carId,
        {
            ...look,
            wheels: 'stock',
            spoiler: 'none',
            ride: complete ? look.ride : 0,
        },
        { unit: source.scale.y || 1 }
    );
    if (!complete) return;
    const related = (a: THREE.Object3D, b: THREE.Object3D) => {
        for (let node: THREE.Object3D | null = a; node; node = node.parent) if (node === b) return true;
        for (let node: THREE.Object3D | null = b; node; node = node.parent) if (node === a) return true;
        return false;
    };
    meta.forEach((entry) => {
        const from = source.getObjectByName(entry.objectName)!;
        const to = target.getObjectByName(entry.objectName)!;
        const rims = from.children.filter((child) => child.userData.garageRim);
        if (!rims.length) return;
        rims.forEach((rim) => to.add(rim.clone()));
        const withTire = rims.some((rim) => rim.userData.garagePart === 'tire');
        hideOwn(to, !withTire);
        to.userData.garageDonor = look.wheels;
        if (!withTire) return;
        // the race merged its wheel from parts this copy keeps apart (the
        // m5's tire and spokes), which would show through the new wheel
        (entry.parts || []).forEach((name) => {
            const part = target.getObjectByName(name);
            if (!part || !part.visible || related(part, to)) return;
            part.visible = false;
            part.userData.garageHiddenPart = true;
        });
    });
    const kit = source.getObjectByName('garage-kit');
    if (kit) target.add(kit.clone());
};
