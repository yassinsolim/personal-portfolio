// the garage's ride height on a car model: the body goes up and down, the
// wheels and the contact shadow stay where the ground is. a shadow that
// moved with a lowered body sank under the room's floor and was cut off
//
//   npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import './ts-hooks.mjs';

const { applyCarLook } = await import('../../src/Application/Racing/Garage/carLook.ts');
const { STOCK_LOOK } = await import('../../src/Application/Racing/Garage/garage.ts');

// a body, one wheel node and the shadow plane, in meters or in the room's
// scale (the room car's unit is the race model's scale, see copyCarLook)
const car = (scale) => {
    const model = new THREE.Group();
    model.scale.setScalar(scale);
    const body = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4.5), new THREE.MeshStandardMaterial());
    body.position.y = 0.8;
    const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.35, 0.3),
        new THREE.MeshStandardMaterial()
    );
    wheel.name = 'wheel_fl';
    wheel.position.set(0.9, 0.35, 1.4);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 5), new THREE.MeshBasicMaterial());
    shadow.name = 'car_contact_shadow';
    shadow.position.y = 0.003;
    model.add(body, wheel, shadow);
    model.userData.raceWheelMeta = [{ objectName: 'wheel_fl' }];
    model.updateMatrixWorld(true);
    return { model, body, wheel, shadow };
};

const worldY = (object) => {
    object.updateWorldMatrix(true, false);
    return object.getWorldPosition(new THREE.Vector3()).y;
};

for (const [name, scale, unit] of [
    ['race', 1, undefined],
    ['room', 2763.957, 1],
]) {
    test(`ride height moves the ${name} car's body, not its wheels or contact shadow`, () => {
        const { model, body, wheel, shadow } = car(scale);
        const at = { body: worldY(body), wheel: worldY(wheel), shadow: worldY(shadow) };
        const metre = unit ? scale / unit : 1;
        for (const ride of [-1, 1, 0]) {
            applyCarLook(model, 'amg-one', { ...STOCK_LOOK, ride }, { unit });
            assert.ok(Math.abs(worldY(body) - at.body - ride * 0.03 * metre) < 1e-6 * metre);
            assert.equal(worldY(wheel), at.wheel);
            assert.equal(worldY(shadow), at.shadow);
        }
    });
}
