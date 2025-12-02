import * as THREE from 'three';
import Application from '../Application';
import Resources from '../Utils/Resources';

// Nintendo DS Lite placement next to keyboard, left side of desk
const DS_SCALE = 4.5;
const PAPER_ANCHOR = new THREE.Vector3(-2064, -444, 986); // paper center on desk
const DS_OFFSET = new THREE.Vector3(520, 0, 380); // relative to paper (toward keyboard area)
const DS_YAW = Math.PI / 2 - 0.1 - Math.PI / 3; // face right with 60° counterclockwise twist from the base

export default class DS {
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
        const gltf = this.resources.items.gltfModel.dsModel;
        const ds = gltf.scene;

        ds.scale.setScalar(DS_SCALE);
        ds.rotation.set(0, DS_YAW, 0);

        // Ground to desk using bounding box
        const targetPos = new THREE.Vector3().copy(PAPER_ANCHOR).add(DS_OFFSET);
        const bbox = new THREE.Box3().setFromObject(ds);
        const heightOffset = -bbox.min.y;
        ds.position.set(targetPos.x, targetPos.y + heightOffset, targetPos.z);

        ds.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });

        this.model = ds;
        this.scene.add(ds);
    }
}
