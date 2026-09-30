import * as THREE from 'three';
import Application from '../Application';
import { DEFAULT_ANCHORS, UNITS_PER_METRE, type AnchorName } from './screens/layout';
import type { FocusTarget } from './screens/Screens';

// room v2: yassin's real setup (scripts/room, static/models/Room). lighting
// and colour are baked into three atlases and drawn unlit, like henry's
// room was. the furniture groups become top level scene objects, because the
// race transition's fly path takes each one's box as an obstacle and race
// mode hides the room by hiding top level objects

const LED_COLOR = new THREE.Color(0xbcd4ec);
const LED_HOVER = new THREE.Color(0xffffff);
const U = UNITS_PER_METRE;

export default class Room {
    application: Application;
    scene: THREE.Scene;
    groups: THREE.Object3D[] = [];
    anchors = new Map<string, THREE.Vector3>();
    ledMaterial: THREE.MeshBasicMaterial;
    pc: THREE.Object3D | null = null;

    constructor() {
        this.application = new Application();
        this.scene = this.application.scene;
        this.ledMaterial = new THREE.MeshBasicMaterial({ color: LED_COLOR.clone() });
        this.setModel();
    }

    setModel() {
        const gltf = this.application.resources.items.gltfModel.roomModel;
        const root = gltf.scene as THREE.Group;
        root.updateMatrixWorld(true);
        root.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) this.setMaterial(child as THREE.Mesh);
            else if (child.name in DEFAULT_ANCHORS || /^anchor_|_spot$/.test(child.name)) {
                this.anchors.set(child.name, child.getWorldPosition(new THREE.Vector3()));
            }
        });
        // the greybox has no room_ groups: it goes in whole
        const groups = root.children.filter((child) => /^room_/.test(child.name));
        if (groups.length) {
            groups.forEach((group) => this.scene.attach(group));
            // screens, leds, glass and empties that sit outside the groups
            const rest = root.children.slice();
            if (rest.length) {
                const loose = new THREE.Group();
                loose.name = 'room_loose';
                rest.forEach((child) => loose.attach(child));
                this.scene.add(loose);
                groups.push(loose);
            }
            this.groups = groups;
        } else {
            this.scene.add(root);
            this.groups = [root];
        }
        this.pc = this.scene.getObjectByName('room_pc') || null;
    }

    setMaterial(mesh: THREE.Mesh) {
        const material = mesh.material as THREE.MeshStandardMaterial;
        const name = material?.name || '';
        // the css screens (World/screens) sit exactly on these quads, their
        // gl holes replace them
        if (/^m[123]_screen$/.test(mesh.name)) {
            mesh.visible = false;
            return;
        }
        if (name.startsWith('bake_')) {
            mesh.material = new THREE.MeshBasicMaterial({ map: material.map, name });
        } else if (name === 'glass') {
            mesh.material = new THREE.MeshBasicMaterial({
                name,
                color: 0xdfe8f2,
                transparent: true,
                opacity: 0.08,
                depthWrite: false,
            });
            mesh.renderOrder = 2;
        } else if (name === 'led') {
            mesh.material = this.ledMaterial;
        } else if (name === 'screen') {
            // the css screen shows through a hole in front of it
            mesh.material = new THREE.MeshBasicMaterial({ name, color: 0x000000 });
        }
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
    }

    anchor(name: AnchorName) {
        return (this.anchors.get(name) || DEFAULT_ANCHORS[name]).clone();
    }

    // what can block the pointer (the shell can't, it's behind everything)
    occluders() {
        return this.groups.filter((group) => group.name !== 'room_shell');
    }

    meshes() {
        const list: THREE.Mesh[] = [];
        this.groups.forEach((group) =>
            group.traverse((child) => {
                if ((child as THREE.Mesh).isMesh) list.push(child as THREE.Mesh);
            })
        );
        return list;
    }

    setHover(target: FocusTarget | null) {
        this.ledMaterial.color.copy(target === 'pc' ? LED_HOVER : LED_COLOR);
    }

    // the pc's panoramic corner, from low in front and to the left
    pcPose() {
        const center = this.anchor('anchor_pc');
        return {
            position: center.clone().add(new THREE.Vector3(-0.75 * U, 0.28 * U, 1.05 * U)),
            focal: center.clone().add(new THREE.Vector3(0, 0.02 * U, 0)),
        };
    }
}
