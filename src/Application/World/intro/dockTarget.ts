import * as THREE from 'three';
import Application from '../../Application';

// where a loading screen can dock in the room, looked up by name so a new
// room only has to name its screens (?dock=<name> or HYBRID.dockTarget):
//   'monitor'  the current room's monitor (MonitorScreen's css3d screen)
//   any other  a mesh with that name, e.g. a panel over a new monitor's
//              glass: its two largest extents are the screen, the third the
//              normal, turned toward the camera
// a target reports its world center, orientation (x right, y up, z out of
// the glass), world size, and what's on it already so that can be hidden
// under the dock and brought back after

export type DockTarget = {
    name: string;
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    width: number;
    height: number;
    // the screen's own content, if the room has some (yassinOS on 'monitor')
    content: {
        setOpacity: (value: number) => void;
        setInert: (inert: boolean) => void;
        load: () => void;
        onLoad: (fn: () => void) => void;
    } | null;
};

const monitorTarget = (): DockTarget | null => {
    const monitor = new Application().world.monitorScreen;
    if (!monitor) return null;
    const iframe = monitor.monitorIframe;
    return {
        name: 'monitor',
        position: monitor.position.clone(),
        quaternion: new THREE.Quaternion().setFromEuler(monitor.rotation),
        width: monitor.screenSize.x,
        height: monitor.screenSize.y,
        content: {
            setOpacity: (value) => (monitor.screenOpacity = value),
            setInert: (inert) => {
                if (monitor.monitorContainer) monitor.monitorContainer.inert = inert;
            },
            load: () => monitor.loadIframe(),
            onLoad: (fn) => iframe?.addEventListener('load', fn, { once: true }),
        },
    };
};

const meshTarget = (name: string): DockTarget | null => {
    const application = new Application();
    const object = application.scene.getObjectByName(name) as THREE.Mesh | undefined;
    if (!object || !object.isMesh || !object.geometry) return null;
    object.updateWorldMatrix(true, false);
    object.geometry.computeBoundingBox();
    const box = object.geometry.boundingBox as THREE.Box3;
    const size = box.getSize(new THREE.Vector3());
    const scale = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    object.matrixWorld.decompose(new THREE.Vector3(), rotation, scale);
    // each local axis: its world direction and world length
    const axes = [
        { dir: new THREE.Vector3(1, 0, 0), length: size.x * scale.x },
        { dir: new THREE.Vector3(0, 1, 0), length: size.y * scale.y },
        { dir: new THREE.Vector3(0, 0, 1), length: size.z * scale.z },
    ]
        .map(({ dir, length }) => ({ dir: dir.applyQuaternion(rotation), length }))
        .sort((p, q) => q.length - p.length);
    const position = box.getCenter(new THREE.Vector3()).applyMatrix4(object.matrixWorld);
    const normal = axes[2].dir.clone();
    // out of the glass means toward the camera
    const toCamera = application.camera.instance.position.clone().sub(position);
    if (normal.dot(toCamera) < 0) normal.negate();
    // the screen's up is whichever long axis is closer to world up
    const up = new THREE.Vector3(0, 1, 0);
    const [first, second] = axes;
    const vertical = Math.abs(first.dir.dot(up)) > Math.abs(second.dir.dot(up)) ? first : second;
    const horizontal = vertical === first ? second : first;
    const yAxis = vertical.dir.clone();
    if (yAxis.dot(up) < 0) yAxis.negate();
    const xAxis = new THREE.Vector3().crossVectors(yAxis, normal).normalize();
    const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, normal);
    return {
        name,
        position,
        quaternion: new THREE.Quaternion().setFromRotationMatrix(basis),
        width: horizontal.length,
        height: vertical.length,
        content: null,
    };
};

export const resolveDockTarget = (name: string): DockTarget | null =>
    name === 'monitor' ? monitorTarget() : meshTarget(name);

// the four corners in world space: top left, top right, bottom right, bottom left
export const dockCorners = (target: DockTarget) => {
    const x = new THREE.Vector3(1, 0, 0).applyQuaternion(target.quaternion);
    const y = new THREE.Vector3(0, 1, 0).applyQuaternion(target.quaternion);
    const hx = x.multiplyScalar(target.width / 2);
    const hy = y.multiplyScalar(target.height / 2);
    const c = target.position;
    return [
        c.clone().sub(hx).add(hy),
        c.clone().add(hx).add(hy),
        c.clone().add(hx).sub(hy),
        c.clone().sub(hx).sub(hy),
    ];
};
