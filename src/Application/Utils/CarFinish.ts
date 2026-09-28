import * as THREE from 'three';
import type { CarOption, CarPaint, CarWindowTint } from '../carOptions';
import { setLegacyHex } from './LegacyColor';

type GlassZone = 'windshield' | 'surround';

const DEFAULT_TINT_COLOR = 0x05070b;
// windows sit above the beltline and are big. lamp lenses and sensor covers
// often share the glass material, so they're filtered out by height and size
const MIN_WINDOW_HEIGHT = 0.3;
const MIN_WINDOW_SIZE = 0.04;
const SIDE_NORMAL_MIN = 0.7;
const WINDSHIELD_FORWARD_MIN = 0.25;
// glass edges face every direction, so both zones need a real share of a
// mesh's area before that mesh gets split
const MIN_SPLIT_AREA_SHARE = 0.1;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _ac = new THREE.Vector3();
const _centroid = new THREE.Vector3();
const _outward = new THREE.Vector3();
const _box = new THREE.Box3();

const getCarSpaceMatrix = (model: THREE.Object3D, mesh: THREE.Mesh) => {
    const toCar = model.matrixWorld.clone().invert();
    return toCar.multiply(mesh.matrixWorld);
};

const getCarSpaceBox = (model: THREE.Object3D) => {
    const box = new THREE.Box3();
    model.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const geometry = child.geometry as THREE.BufferGeometry;
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        _box.copy(geometry.boundingBox!).applyMatrix4(
            getCarSpaceMatrix(model, child)
        );
        box.union(_box);
    });
    return box;
};

const isWindowMesh = (
    model: THREE.Object3D,
    mesh: THREE.Mesh,
    carBox: THREE.Box3
) => {
    const geometry = mesh.geometry as THREE.BufferGeometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const box = geometry
        .boundingBox!.clone()
        .applyMatrix4(getCarSpaceMatrix(model, mesh));
    const carSize = carBox.getSize(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const height =
        ((center.y - carBox.min.y) / Math.max(carSize.y, 1e-6)) * 2 - 1;
    const length = Math.max(carSize.x, carSize.y, carSize.z);
    const bigSides = [size.x, size.y, size.z].filter(
        (side) => side >= length * MIN_WINDOW_SIZE
    ).length;
    return height > MIN_WINDOW_HEIGHT && bigSides >= 2;
};

// loads one triangle into _a/_b/_c (car space) and returns its vertex ids
const readTriangle = (
    geometry: THREE.BufferGeometry,
    triangle: number,
    matrix: THREE.Matrix4
) => {
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex();
    const vertices = [0, 1, 2].map((corner) =>
        index ? index.getX(triangle * 3 + corner) : triangle * 3 + corner
    );
    _a.fromBufferAttribute(position, vertices[0]).applyMatrix4(matrix);
    _b.fromBufferAttribute(position, vertices[1]).applyMatrix4(matrix);
    _c.fromBufferAttribute(position, vertices[2]).applyMatrix4(matrix);
    return vertices;
};

// the windshield is glass whose outward normal points forward. side glass,
// the rear window and roof glass all take the main tint
const classifyTriangle = (
    normal: THREE.Vector3,
    centroid: THREE.Vector3,
    carCenter: THREE.Vector3,
    forwardSign: number
): GlassZone => {
    if (normal.dot(_outward.subVectors(centroid, carCenter)) < 0) {
        normal.negate();
    }
    if (Math.abs(normal.x) >= SIDE_NORMAL_MIN) return 'surround';
    return normal.z * forwardSign > WINDSHIELD_FORWARD_MIN
        ? 'windshield'
        : 'surround';
};

const buildGeometry = (source: THREE.BufferGeometry, vertices: number[]) => {
    const geometry = new THREE.BufferGeometry();
    Object.entries(source.attributes).forEach(([name, attribute]) => {
        const sourceAttribute = attribute as THREE.BufferAttribute;
        if ((sourceAttribute as any).isInterleavedBufferAttribute) return;
        const ArrayType = sourceAttribute.array.constructor as new (
            length: number
        ) =>
            | Float32Array
            | Uint32Array
            | Uint16Array
            | Int16Array
            | Uint8Array
            | Int8Array;
        const size = sourceAttribute.itemSize;
        const array = new ArrayType(vertices.length * size);
        vertices.forEach((vertex, i) => {
            for (let k = 0; k < size; k++) {
                array[i * size + k] = sourceAttribute.array[vertex * size + k];
            }
        });
        geometry.setAttribute(
            name,
            new THREE.BufferAttribute(array, size, sourceAttribute.normalized)
        );
    });
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
};

const createTintMaterial = (
    source: THREE.MeshStandardMaterial,
    tint: CarWindowTint,
    opacity: number
) => {
    const material = source.clone();
    material.map = null;
    material.alphaMap = null;
    setLegacyHex(material.color, tint.color ?? DEFAULT_TINT_COLOR);
    material.metalness = 0;
    material.roughness = 0.02;
    material.envMapIntensity = 0.5;
    material.opacity = opacity;
    material.transparent = true;
    material.depthWrite = false;
    material.needsUpdate = true;
    return material;
};

export const applyWindowTint = (
    model: THREE.Object3D,
    tint: CarWindowTint,
    forwardSign: 1 | -1
) => {
    model.updateMatrixWorld(true);
    const carBox = getCarSpaceBox(model);
    const carCenter = carBox.getCenter(new THREE.Vector3());
    const materialNames = new Set(tint.materials);
    const opacityByZone: Record<GlassZone, number> = {
        surround: tint.opacity,
        windshield: tint.windshieldOpacity,
    };
    const tintedMaterials = new Map<string, THREE.MeshStandardMaterial>();
    const materialFor = (
        source: THREE.MeshStandardMaterial,
        zone: GlassZone
    ) => {
        const key = `${source.uuid}:${zone}`;
        if (!tintedMaterials.has(key)) {
            tintedMaterials.set(
                key,
                createTintMaterial(source, tint, opacityByZone[zone])
            );
        }
        return tintedMaterials.get(key)!;
    };

    const windows: THREE.Mesh[] = [];
    model.traverse((child) => {
        if (!(child instanceof THREE.Mesh) || Array.isArray(child.material)) {
            return;
        }
        const name = (child.material.name || '').toLowerCase();
        if (materialNames.has(name) && isWindowMesh(model, child, carBox)) {
            windows.push(child);
        }
    });

    windows.forEach((mesh) => {
        const source = mesh.material as THREE.MeshStandardMaterial;
        const geometry = mesh.geometry as THREE.BufferGeometry;
        const matrix = getCarSpaceMatrix(model, mesh);
        const triangleCount =
            (geometry.getIndex()?.count ??
                geometry.getAttribute('position').count) / 3;
        const zoneVertices: Record<GlassZone, number[]> = {
            surround: [],
            windshield: [],
        };
        const zoneArea: Record<GlassZone, number> = {
            surround: 0,
            windshield: 0,
        };
        for (let triangle = 0; triangle < triangleCount; triangle++) {
            const vertices = readTriangle(geometry, triangle, matrix);
            const normal = _ab.subVectors(_b, _a).cross(_ac.subVectors(_c, _a));
            const area = normal.length();
            _centroid.copy(_a).add(_b).add(_c).divideScalar(3);
            const zone = classifyTriangle(
                normal.normalize(),
                _centroid,
                carCenter,
                forwardSign
            );
            zoneVertices[zone].push(...vertices);
            zoneArea[zone] += area;
        }

        const totalArea = zoneArea.surround + zoneArea.windshield;
        const minorArea = Math.min(zoneArea.surround, zoneArea.windshield);
        if (minorArea < totalArea * MIN_SPLIT_AREA_SHARE) {
            const zone =
                zoneArea.windshield > zoneArea.surround
                    ? 'windshield'
                    : 'surround';
            mesh.material = materialFor(source, zone);
            return;
        }

        // mixed glass (like a windshield and rear window in one mesh) gets
        // split so each part takes its own tint level
        mesh.geometry = buildGeometry(geometry, zoneVertices.surround);
        mesh.material = materialFor(source, 'surround');
        const windshield = new THREE.Mesh(
            buildGeometry(geometry, zoneVertices.windshield),
            materialFor(source, 'windshield')
        );
        windshield.name = `${mesh.name}_windshield`;
        windshield.position.copy(mesh.position);
        windshield.quaternion.copy(mesh.quaternion);
        windshield.scale.copy(mesh.scale);
        windshield.renderOrder = mesh.renderOrder;
        windshield.castShadow = mesh.castShadow;
        windshield.receiveShadow = mesh.receiveShadow;
        mesh.parent?.add(windshield);
    });
};

export const applyPaint = (model: THREE.Object3D, paint: CarPaint) => {
    const materialNames = new Set(paint.materials);
    model.traverse((child) => {
        if (!(child instanceof THREE.Mesh) || Array.isArray(child.material)) {
            return;
        }
        const material = child.material as THREE.MeshPhysicalMaterial;
        if (!materialNames.has((material.name || '').toLowerCase())) return;
        material.map = null;
        // beamng exports carry vertex color paint masks (magenta on the e92
        // bumper and trunk) that tint a solid repaint
        material.vertexColors = false;
        setLegacyHex(material.color, paint.color);
        material.metalness = paint.metalness;
        material.roughness = paint.roughness;
        if (
            paint.clearcoatRoughness !== undefined &&
            material instanceof THREE.MeshPhysicalMaterial
        ) {
            material.clearcoat = 1;
            material.clearcoatRoughness = paint.clearcoatRoughness;
        }
        material.needsUpdate = true;
    });
};

export const applyCarFinish = (model: THREE.Object3D, option?: CarOption) => {
    if (!option) return;
    const forwardSign = option.race.visualForwardAxis === 'negativeZ' ? -1 : 1;
    if (option.windowTint) {
        applyWindowTint(model, option.windowTint, forwardSign);
    }
    if (option.paint) {
        applyPaint(model, option.paint);
    }
};
