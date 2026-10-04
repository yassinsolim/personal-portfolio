import { carOptions, getStoredCarId } from './carOptions';
import { roomTier } from './Utils/roomTier';
import { isLowPowerDevice } from './Utils/Device';
import { loadLook, needsRaceModel } from './Racing/Garage/garage';

const initialCarId = getStoredCarId();
const preloadIds = new Set(
    carOptions.filter((car) => car.preload).map((car) => car.id)
);
preloadIds.add(initialCarId);
// a returning visitor's look that needs the race's prepared car: the room car
// is dressed before it's shown (RaceTransition.dressAtStart), and a car whose
// wheels it wears loads with the room
const initialLook = loadLook(initialCarId);
export const dressRoomCarAtStart = needsRaceModel(initialLook) && !isLowPowerDevice();
if (dressRoomCarAtStart) preloadIds.add(initialLook.wheels);

const carModelSources: Resource[] = carOptions
    .filter((car) => preloadIds.has(car.id))
    .map((car) => ({
        name: car.resourceName,
        type: 'gltfModel' as const,
        path: car.modelPath,
    }));

const sources: Resource[] = [
    {
        // room v2 (scripts/room). low tier gpus, low power devices and
        // phones get the lighter one: simpler pc and keyboard, 1k atlases
        name: 'roomModel',
        type: 'gltfModel',
        path: roomTier() === 'low' ? 'models/Room/room_v2.low.glb' : 'models/Room/room_v2.glb',
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
        path: 'models/Props/handheld.glb',
    },
];

// race mode only: fetched with the race code, on the car hover or a race
// button, never by the homepage (World.ensureRaceManager)
export const raceSources: Resource[] = [
    {
        name: 'nordschleifeData',
        type: 'json',
        path: 'models/Tracks/Nordschleife/nordschleife.json',
    },
];

export default sources;
