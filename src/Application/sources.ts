import { carOptions, getStoredCarId } from './carOptions';

const initialCarId = getStoredCarId();
const preloadIds = new Set(
    carOptions.filter((car) => car.preload).map((car) => car.id)
);
preloadIds.add(initialCarId);

const carModelSources: Resource[] = carOptions
    .filter((car) => preloadIds.has(car.id))
    .map((car) => ({
        name: car.resourceName,
        type: 'gltfModel' as const,
        path: car.modelPath,
    }));

const audioSources: Resource[] = [
    {
        name: 'mouseDown',
        type: 'audio',
        path: 'audio/mouse/mouse_down.mp3',
    },
    {
        name: 'mouseUp',
        type: 'audio',
        path: 'audio/mouse/mouse_up.mp3',
    },
    {
        name: 'ccType',
        type: 'audio',
        path: 'audio/cc/type.mp3',
    },
    {
        name: 'keyboardKeydown_1',
        type: 'audio',
        path: 'audio/keyboard/key_1.mp3',
    },
    {
        name: 'keyboardKeydown_2',
        type: 'audio',
        path: 'audio/keyboard/key_2.mp3',
    },
    {
        name: 'keyboardKeydown_3',
        type: 'audio',
        path: 'audio/keyboard/key_3.mp3',
    },
    {
        name: 'keyboardKeydown_4',
        type: 'audio',
        path: 'audio/keyboard/key_4.mp3',
    },
    {
        name: 'keyboardKeydown_5',
        type: 'audio',
        path: 'audio/keyboard/key_5.mp3',
    },
    {
        name: 'keyboardKeydown_6',
        type: 'audio',
        path: 'audio/keyboard/key_6.mp3',
    },
    {
        name: 'engineLoop0',
        type: 'audio',
        path: 'audio/engine/loop_0.wav',
    },
    {
        name: 'engineLoop1',
        type: 'audio',
        path: 'audio/engine/loop_1.wav',
    },
    {
        name: 'engineLoop2',
        type: 'audio',
        path: 'audio/engine/loop_2.wav',
    },
    {
        name: 'engineLoop3',
        type: 'audio',
        path: 'audio/engine/loop_3.wav',
    },
    {
        name: 'engineLoop4',
        type: 'audio',
        path: 'audio/engine/loop_4.wav',
    },
    {
        name: 'engineLoop5',
        type: 'audio',
        path: 'audio/engine/loop_5.wav',
    },
];

const sources: Resource[] = [
    {
        name: 'computerSetupModel',
        type: 'gltfModel',
        path: 'models/Computer/computer_setup.glb',
    },
    {
        name: 'computerSetupTexture',
        type: 'texture',
        path: 'models/Computer/baked_computer.jpg',
    },
    {
        name: 'environmentModel',
        type: 'gltfModel',
        path: 'models/World/environment.glb',
    },
    {
        name: 'environmentTexture',
        type: 'texture',
        path: 'models/World/baked_environment.jpg',
    },
    {
        name: 'decorModel',
        type: 'gltfModel',
        path: 'models/Decor/decor.glb',
    },
    {
        name: 'decorTexture',
        type: 'texture',
        path: 'models/Decor/baked_decor_modified.jpg',
    },
    {
        name: 'monitorSmudgeTexture',
        type: 'texture',
        path: 'textures/monitor/layers/compressed/smudges.jpg',
    },
    {
        name: 'monitorShadowTexture',
        type: 'texture',
        path: 'textures/monitor/layers/compressed/shadow-compressed.png',
    },
    {
        name: 'environmentMapTexture',
        type: 'cubeTexture',
        path: [
            'textures/environmentMap/px.jpg',
            'textures/environmentMap/nx.jpg',
            'textures/environmentMap/py.jpg',
            'textures/environmentMap/ny.jpg',
            'textures/environmentMap/pz.jpg',
            'textures/environmentMap/nz.jpg',
        ],
    },
    ...carModelSources,
    {
        name: 'flipperModel',
        type: 'gltfModel',
        path: 'models/Props/flipper_zero.glb',
    },
    ...audioSources,
];

export default sources;
