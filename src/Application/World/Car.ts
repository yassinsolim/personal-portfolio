import * as THREE from 'three';
import Application from '../Application';
import Resources from '../Utils/Resources';
import UIEventBus from '../UI/EventBus';
import { carOptionsById, defaultCarId, getStoredCarId } from '../carOptions';
import type { CarOption } from '../carOptions';

const BASE_CAR_SCALE = 27;
const CAR_POSITION = new THREE.Vector3(-2400, 0, -7600);
const CAR_ROTATION = new THREE.Euler(0, -Math.PI / 2, 0);
const CAR_ENV_INTENSITY = 0.95;
const TOYOTA_CROWN_ID = 'toyota-crown-platinum';
const BODY_BLUE = new THREE.Color(0x050f2f);
const TOYOTA_CROWN_GRAY = new THREE.Color(0x8f9296);
const TOYOTA_CROWN_SCALE = 0.95;
const TOYOTA_CROWN_ROTATION_OFFSET = Math.PI / 2;
const TOYOTA_CROWN_POSITION_OFFSET = new THREE.Vector3(400, 0, 0);
const TOYOTA_CROWN_BACK_SHIFT = 1 / 6;
const TOYOTA_CROWN_FORWARD_SHIFT = -0.5;
const TOYOTA_CROWN_DESK_WIDTH_SHIFT = 0.15;
const WHEEL_SILVER = new THREE.Color(0xcfd3da);

export default class Car {
    application: Application;
    scene: THREE.Scene;
    resources: Resources;
    camera: THREE.PerspectiveCamera;
    raycaster: THREE.Raycaster;
    model: THREE.Group | null;
    currentCarId: string;
    cachedModels: Map<string, THREE.Group>;
    loadingPromises: Map<string, Promise<THREE.Group>>;
    sceneUnitsPerMeter: number;

    constructor() {
        this.application = new Application();
        this.scene = this.application.scene;
        this.resources = this.application.resources;
        this.camera = this.application.camera.instance;
        this.raycaster = new THREE.Raycaster();
        this.model = null;
        this.currentCarId = getStoredCarId();
        this.cachedModels = new Map();
        this.loadingPromises = new Map();
        this.sceneUnitsPerMeter = this.getSceneUnitsPerMeter();

        this.setModel(this.currentCarId);
        this.addLights();
        this.setupInteraction();
        this.setupCarSwitcher();
    }

    setupCarSwitcher() {
        UIEventBus.on('carChange', (carId: string) => {
            if (!carId || carId === this.currentCarId) return;
            if (!carOptionsById[carId]) return;
            this.currentCarId = carId;
            this.setModel(carId);
        });
    }

    setModel(carId: string) {
        const car = this.getPreparedCar(carId);
        if (car) {
            this.swapCar(car);
            return;
        }

        this.loadCarModel(carId);
    }

    swapCar(car: THREE.Group) {
        if (this.model && this.model !== car) {
            this.scene.remove(this.model);
        }

        this.model = car;
        this.scene.add(car);
    }

    swapCarIfCurrent(carId: string, car: THREE.Group) {
        if (this.currentCarId !== carId) return;
        this.swapCar(car);
    }

    loadCarModel(carId: string) {
        const carOption = carOptionsById[carId];
        if (!carOption) return;

        const existing = this.loadingPromises.get(carId);
        if (existing) {
            existing
                .then((car) => this.swapCarIfCurrent(carId, car))
                .catch(() => {});
            return;
        }

        const loadPromise = new Promise<THREE.Group>((resolve, reject) => {
            this.resources.loaders.gltfLoader.load(
                carOption.modelPath,
                (gltf) => {
                    this.resources.items.gltfModel[carOption.resourceName] = gltf;
                    const car = gltf.scene.clone(true);
                    this.cloneMaterials(car);
                    this.prepareCarModel(car, carOption);
                    resolve(car);
                },
                undefined,
                (error) => {
                    reject(error);
                }
            );
        });

        this.loadingPromises.set(carId, loadPromise);

        loadPromise
            .then((car) => {
                this.cachedModels.set(carId, car);
                this.swapCarIfCurrent(carId, car);
            })
            .catch(() => {})
            .finally(() => {
                this.loadingPromises.delete(carId);
            });
    }

    getPreparedCar(carId: string) {
        const cached = this.cachedModels.get(carId);
        if (cached) return cached;

        const carOption = carOptionsById[carId];
        if (!carOption) return null;

        const gltf = this.resources.items.gltfModel[carOption.resourceName];
        if (!gltf) return null;

        const car = gltf.scene.clone(true);
        this.cloneMaterials(car);
        this.prepareCarModel(car, carOption);

        this.cachedModels.set(carId, car);

        return car;
    }

    prepareCarModel(car: THREE.Group, carOption: CarOption) {
        if (!this.sceneUnitsPerMeter) {
            this.sceneUnitsPerMeter = this.getSceneUnitsPerMeter();
        }
        const scale = this.getCarScale(car, carOption) * this.getCarScaleFactor(
            carOption
        );
        car.scale.setScalar(scale);
        car.rotation.copy(this.getCarRotation(carOption));
        this.applyEnvironment(car);
        this.applyMaterialStyling(car, carOption);

        car.updateMatrixWorld(true);

        // Drop the car to the ground plane based on its bounding box
        const bbox = new THREE.Box3().setFromObject(car);
        // Some models (e.g., Toyota) have their geometry offset from origin.
        const pivotOffset = this.getPivotOffset(bbox, carOption);
        const groundY = this.getGroundYFromScene();
        const groundOffset = groundY - bbox.min.y;

        car.position.set(CAR_POSITION.x, groundOffset, CAR_POSITION.z);
        if (pivotOffset) {
            car.position.sub(pivotOffset);
        }
        car.updateMatrixWorld(true);

        const size = new THREE.Vector3();
        bbox.getSize(size);

        const forward = new THREE.Vector3();
        car.getWorldDirection(forward);
        forward.y = 0;
        if (forward.lengthSq() > 0) {
            forward.normalize();
        }
        const backward = forward.clone().multiplyScalar(-1);
        const carLength =
            Math.abs(backward.x) * size.x +
            Math.abs(backward.y) * size.y +
            Math.abs(backward.z) * size.z;
        const shiftDistance = (1 / 3) * carLength;
        const shiftDirection =
            carOption.id === TOYOTA_CROWN_ID ? forward : backward;

        car.position.addScaledVector(shiftDirection, shiftDistance);
        if (carOption.id === TOYOTA_CROWN_ID) {
            car.position.addScaledVector(
                backward,
                carLength * TOYOTA_CROWN_BACK_SHIFT
            );
            const deskCenter = this.getDeskCenter();
            const toDesk = deskCenter.sub(car.position);
            toDesk.y = 0;
            if (toDesk.lengthSq() > 0) {
                toDesk.normalize();
            }
            const left = new THREE.Vector3().crossVectors(
                toDesk,
                new THREE.Vector3(0, 1, 0)
            );
            if (left.lengthSq() > 0) {
                left.normalize();
            }
            const deskWidth =
                Math.abs(toDesk.x) * size.x +
                Math.abs(toDesk.y) * size.y +
                Math.abs(toDesk.z) * size.z;
            car.position.addScaledVector(
                toDesk,
                deskWidth * TOYOTA_CROWN_DESK_WIDTH_SHIFT
            );
            car.position.addScaledVector(
                left,
                carLength * TOYOTA_CROWN_FORWARD_SHIFT
            );
        }
        car.position.add(this.getCarPositionOffset(carOption));

        car.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });
    }

    cloneMaterials(car: THREE.Object3D) {
        car.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                if (Array.isArray(child.material)) {
                    child.material = child.material.map((material) =>
                        material.clone()
                    );
                } else if (child.material) {
                    child.material = child.material.clone();
                }
            }
        });
    }

    getCarScale(car: THREE.Object3D, carOption: CarOption) {
        const rawLength = this.getModelLength(car);
        if (!rawLength || !this.sceneUnitsPerMeter) {
            return BASE_CAR_SCALE;
        }

        return (this.sceneUnitsPerMeter * carOption.lengthMeters) / rawLength;
    }

    getSceneUnitsPerMeter() {
        const baseOption = carOptionsById[defaultCarId];
        if (!baseOption) return 0;

        const gltf = this.resources.items.gltfModel[baseOption.resourceName];
        if (!gltf) return 0;

        const baseLength = this.getModelLength(gltf.scene);
        if (!baseLength || !baseOption.lengthMeters) return 0;

        return (baseLength * BASE_CAR_SCALE) / baseOption.lengthMeters;
    }

    getModelLength(model: THREE.Object3D) {
        const bbox = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        bbox.getSize(size);
        return Math.max(size.x, size.y, size.z);
    }

    getCarRotation(carOption: CarOption) {
        const rotation = CAR_ROTATION.clone();
        if (carOption.id === TOYOTA_CROWN_ID) {
            rotation.y += TOYOTA_CROWN_ROTATION_OFFSET;
        }
        return rotation;
    }

    getCarScaleFactor(carOption: CarOption) {
        if (carOption.id === TOYOTA_CROWN_ID) return TOYOTA_CROWN_SCALE;
        return 1;
    }

    getCarPositionOffset(carOption: CarOption) {
        if (carOption.id === TOYOTA_CROWN_ID) {
            return TOYOTA_CROWN_POSITION_OFFSET.clone();
        }
        return new THREE.Vector3();
    }

    getPivotOffset(bbox: THREE.Box3, carOption: CarOption) {
        if (carOption.id !== TOYOTA_CROWN_ID) return null;
        const center = new THREE.Vector3();
        bbox.getCenter(center);
        center.y = 0;
        return center;
    }

    getDeskCenter() {
        const deskModel = this.resources.items.gltfModel.computerSetupModel;
        if (!deskModel) return new THREE.Vector3();
        const bbox = new THREE.Box3().setFromObject(deskModel.scene);
        const center = new THREE.Vector3();
        bbox.getCenter(center);
        return center;
    }

    applyEnvironment(car: THREE.Object3D) {
        const envMap =
            this.resources.items.cubeTexture.environmentMapTexture ||
            undefined;
        if (!envMap) return;
        envMap.encoding = THREE.sRGBEncoding;
        car.traverse((child) => {
            if (
                child instanceof THREE.Mesh &&
                child.material &&
                !Array.isArray(child.material)
            ) {
                const material = child.material as THREE.MeshStandardMaterial;
                material.envMap = envMap;
                material.envMapIntensity = CAR_ENV_INTENSITY;
                material.needsUpdate = true;
            }
        });
    }

    applyMaterialStyling(car: THREE.Object3D, carOption: CarOption) {
        const defaultBodyNames = new Set([
            'body_color',
            'piano_black',
            'piano_black_0',
            'piano_black_1',
            'piano_black_2',
            'black',
            'black_m_nc_black_0',
            'black_under_black_0',
            'material',
            'mizo',
        ]);
        const toyotaBodyNames = new Set(['body']);
        const isToyotaCrown = carOption.id === TOYOTA_CROWN_ID;
        const bodyNames = isToyotaCrown ? toyotaBodyNames : defaultBodyNames;
        const bodyColor = isToyotaCrown ? TOYOTA_CROWN_GRAY : BODY_BLUE;

        const carbonNames = ['carbon', 'carbon_0', 'parts', 'side_wing_carbon_0'];
        const windowNames = [
            'window',
            'window_0',
            'window_1',
            'window_b',
            'light_glass_window_0',
        ];
        const wheelNames = [
            'wheel',
            'wheel_0',
            'wheel_d',
            'wheel_d_0',
            'brake_disc',
        ];
        const tireNames = ['tread', 'tread_0', 'rubber_side', 'rubber_side_0'];
        const silverTrimNames = [
            'light_line_metalic_silver_0',
            'light_block_metalic_silver_0',
            'metalic_silver',
        ];

        car.traverse((child) => {
            if (
                child instanceof THREE.Mesh &&
                child.material &&
                !Array.isArray(child.material)
            ) {
                const material = child.material as THREE.MeshStandardMaterial;
                const name = material.name.toLowerCase();

                if (bodyNames.has(name)) {
                    material.color.copy(bodyColor);
                    material.metalness = 1;
                    material.roughness = 0.18;
                    material.envMapIntensity = 1.1;
                } else if (carbonNames.some((n) => name.includes(n))) {
                    material.color.multiplyScalar(0.6);
                    material.metalness = 0.1;
                    material.roughness = 0.35;
                } else if (windowNames.some((n) => name.includes(n))) {
                    material.color.setHex(0x000000);
                    material.metalness = 0.2;
                    material.roughness = 0.12;
                    material.opacity = 0.45;
                    material.transparent = true;
                    material.envMapIntensity = 0.5;
                } else if (wheelNames.some((n) => name.includes(n))) {
                    material.color.copy(WHEEL_SILVER);
                    material.metalness = 1;
                    material.roughness = 0.1;
                    material.envMapIntensity = 1.5;
                } else if (tireNames.some((n) => name.includes(n))) {
                    material.color.setHex(0x111111);
                    material.metalness = 0.05;
                    material.roughness = 0.9;
                } else if (silverTrimNames.some((n) => name.includes(n))) {
                    material.color.copy(WHEEL_SILVER);
                    material.metalness = 1;
                    material.roughness = 0.12;
                    material.envMapIntensity = 1.4;
                }
            }
        });
    }

    getGroundYFromScene() {
        let groundY = Infinity;
        this.scene.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                const box = new THREE.Box3().setFromObject(child);
                groundY = Math.min(groundY, box.min.y);
            }
        });
        return groundY === Infinity ? 0 : groundY;
    }

    addLights() {
        const hemiLight = new THREE.HemisphereLight(0xffffff, 0x2a2a2a, 0.55);
        hemiLight.position.set(0, 6000, 0);

        const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
        keyLight.position.set(8000, 11000, 5500);
        keyLight.target.position.set(0, 0, 0);

        const rimLight = new THREE.DirectionalLight(0xffffff, 0.4);
        rimLight.position.set(-9000, 7000, -5000);
        rimLight.target.position.set(0, 0, -2000);

        this.scene.add(hemiLight);
        this.scene.add(keyLight);
        this.scene.add(keyLight.target);
        this.scene.add(rimLight);
        this.scene.add(rimLight.target);
    }

    setupInteraction() {
        const canvas = this.application.renderer.instance.domElement;
        window.addEventListener('mousedown', (event) => {
            if (event.button !== 0 || !this.model) return;
            const rect = canvas.getBoundingClientRect();
            const pointer = new THREE.Vector2(
                ((event.clientX - rect.left) / rect.width) * 2 - 1,
                -((event.clientY - rect.top) / rect.height) * 2 + 1
            );
            this.raycaster.setFromCamera(pointer, this.camera);
            const hit = this.raycaster.intersectObject(this.model, true);
            if (hit.length > 0) {
                this.application.camera.enableFreeCam();
            }
        });
    }
}
