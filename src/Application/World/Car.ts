import * as THREE from 'three';
import Application from '../Application';
import Resources from '../Utils/Resources';

const CAR_SCALE = 27;
const CAR_POSITION = new THREE.Vector3(-2400, 0, -7600);
const CAR_ROTATION = new THREE.Euler(0, -Math.PI / 2, 0);
const CAR_ENV_INTENSITY = 0.95;
const BODY_BLUE = new THREE.Color(0x050f2f);
const WHEEL_SILVER = new THREE.Color(0xcfd3da);

export default class Car {
    application: Application;
    scene: THREE.Scene;
    resources: Resources;
    camera: THREE.PerspectiveCamera;
    raycaster: THREE.Raycaster;
    model: THREE.Group | null;

    constructor() {
        this.application = new Application();
        this.scene = this.application.scene;
        this.resources = this.application.resources;
        this.camera = this.application.camera.instance;
        this.raycaster = new THREE.Raycaster();
        this.model = null;

        this.setModel();
        this.addLights();
        this.setupInteraction();
    }

    setModel() {
        const gltf = this.resources.items.gltfModel.carModel;
        const car = gltf.scene;

        car.scale.setScalar(CAR_SCALE);
        car.rotation.copy(CAR_ROTATION);
        this.applyEnvironment(car);
        this.applyMaterialStyling(car);

        // Drop the car to the ground plane based on its bounding box
        const bbox = new THREE.Box3().setFromObject(car);
        const groundY = this.getGroundYFromScene();
        const groundOffset = groundY - bbox.min.y;

        car.position.set(CAR_POSITION.x, groundOffset, CAR_POSITION.z);
        car.updateMatrixWorld(true);

        const size = new THREE.Vector3();
        bbox.getSize(size);

        const forward = new THREE.Vector3();
        car.getWorldDirection(forward);
        const backward = forward.multiplyScalar(-1);
        const shiftDistance =
            (1 / 3) *
            (Math.abs(backward.x) * size.x +
                Math.abs(backward.y) * size.y +
                Math.abs(backward.z) * size.z);

        car.position.addScaledVector(backward, shiftDistance);

        car.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });

        this.model = car;
        this.scene.add(car);
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

    applyMaterialStyling(car: THREE.Object3D) {
        const bodyNames = new Set([
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

        const carbonNames = ['carbon', 'carbon_0', 'parts', 'side_wing_carbon_0'];
        const windowNames = ['window', 'window_0', 'window_1', 'window_b', 'light_glass_window_0'];
        const wheelNames = ['wheel', 'wheel_0', 'wheel_d', 'wheel_d_0', 'brake_disc'];
        const tireNames = ['tread', 'tread_0', 'rubber_side', 'rubber_side_0'];
        const silverTrimNames = ['light_line_metalic_silver_0', 'light_block_metalic_silver_0', 'metalic_silver'];

        car.traverse((child) => {
            if (
                child instanceof THREE.Mesh &&
                child.material &&
                !Array.isArray(child.material)
            ) {
                const material = child.material as THREE.MeshStandardMaterial;
                const name = material.name.toLowerCase();

                if (bodyNames.has(name)) {
                    material.color.copy(BODY_BLUE);
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
