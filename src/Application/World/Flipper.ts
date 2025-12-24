import * as THREE from 'three';
import Application from '../Application';
import Resources from '../Utils/Resources';

// Flipper Zero placement next to keyboard, left side of desk
const FLIPPER_TARGET_LENGTH = 420;
const PAPER_ANCHOR = new THREE.Vector3(-2064, -444, 986); // paper center on desk
const FLIPPER_OFFSET = new THREE.Vector3(520, 0, 380); // relative to paper (toward keyboard area)
const FLIPPER_PITCH = 0;
const FLIPPER_YAW = -50 * THREE.MathUtils.DEG2RAD;
const FLIPPER_ROLL = 0;

export default class Flipper {
    application: Application;
    scene: THREE.Scene;
    resources: Resources;
    model: THREE.Group | null;

    constructor() {
        this.application = new Application();
        this.scene = this.application.scene;
        this.resources = this.application.resources;
        this.model = null;
        this.setModel();
    }

    setModel() {
        const gltf = this.resources.items.gltfModel.flipperModel;
        const flipper = gltf.scene;

        this.toneDownWhiteMaterials(flipper);

        const bbox = new THREE.Box3().setFromObject(flipper);
        const size = new THREE.Vector3();
        bbox.getSize(size);
        const maxDimension = Math.max(size.x, size.y, size.z);
        const scale = maxDimension > 0 ? FLIPPER_TARGET_LENGTH / maxDimension : 1;

        const targetPos = new THREE.Vector3().copy(PAPER_ANCHOR).add(FLIPPER_OFFSET);
        flipper.scale.setScalar(scale);
        flipper.rotation.set(FLIPPER_PITCH, FLIPPER_YAW, FLIPPER_ROLL);
        flipper.position.set(0, 0, 0);
        flipper.updateMatrixWorld(true);

        // Ground to desk using bounding box
        const scaledBox = new THREE.Box3().setFromObject(flipper);
        const heightOffset = -scaledBox.min.y;
        flipper.position.set(targetPos.x, targetPos.y + heightOffset, targetPos.z);
        flipper.updateMatrixWorld(true);

        flipper.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });

        this.model = flipper;
        this.scene.add(flipper);
    }

    toneDownWhiteMaterials(flipper: THREE.Object3D) {
        flipper.traverse((child) => {
            if (!(child instanceof THREE.Mesh) || !child.material) return;

            const materials = Array.isArray(child.material)
                ? child.material
                : [child.material];

            materials.forEach((material) => {
                const standardMaterial =
                    material as THREE.MeshStandardMaterial;
                if (!standardMaterial.color) return;

                const color = standardMaterial.color;
                const maxChannel = Math.max(color.r, color.g, color.b);
                const minChannel = Math.min(color.r, color.g, color.b);

                if (maxChannel > 0.85 && maxChannel - minChannel < 0.08) {
                    standardMaterial.color.multiplyScalar(0.75);
                    standardMaterial.roughness = Math.min(
                        Math.max(standardMaterial.roughness, 0.5),
                        1
                    );
                    standardMaterial.metalness = Math.min(
                        standardMaterial.metalness,
                        0.2
                    );
                    standardMaterial.needsUpdate = true;
                }
            });
        });
    }
}
