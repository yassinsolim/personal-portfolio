import * as THREE from 'three';
import Application from '../Application';
import Resources from '../Utils/Resources';
import { UNITS_PER_METRE } from './screens/layout';

// the flipper zero's reserved spot left of the keyboard (the room's
// flipper_spot), at its real 100 mm length. a clickable one that runs its os
// replaces this model later
const FLIPPER_TARGET_LENGTH = 0.1 * UNITS_PER_METRE;
const FLIPPER_PITCH = 0;
const FLIPPER_YAW = -30 * THREE.MathUtils.DEG2RAD;
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

        const targetPos = this.application.world.room.anchor('flipper_spot');
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
