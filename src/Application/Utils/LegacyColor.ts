import * as THREE from 'three';

// these colors were tuned by eye on three r137, which sent hex values to the
// shaders untouched. with color management a hex is read as srgb, so reading
// them as linear keeps every tuned paint, trim and tint looking the same
export const legacyColor = (hex: number) =>
    new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace);

export const setLegacyHex = (color: THREE.Color, hex: number) =>
    color.setHex(hex, THREE.LinearSRGBColorSpace);

// r137 scaled ambient, hemisphere and directional light by pi internally
export const LEGACY_LIGHT_SCALE = Math.PI;
