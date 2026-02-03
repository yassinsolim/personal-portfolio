export type EngineAudioProfile = {
    rpmMax?: number;
    rpmCurve?: number;
    minDetune?: number;
    maxDetune?: number;
    highDetuneOffset?: number;
    lowVolume?: number;
    highVolume?: number;
    idleVolume?: number;
    throttleBoost?: number;
    lowpass?: number;
    highpass?: number;
    shiftUp?: {
        duration?: number;
        detune?: number;
        volumeCut?: number;
        transientVolume?: number;
    };
    shiftDown?: {
        duration?: number;
        detune?: number;
        volumeBoost?: number;
        transientVolume?: number;
    };
};

export type EngineSoundConfig = {
    low: string;
    high: string;
    profile?: EngineAudioProfile;
};

export type CarOption = {
    id: string;
    label: string;
    resourceName: string;
    modelPath: string;
    lengthMeters: number;
    engineSound: EngineSoundConfig;
    deskYawOffset?: number;
    driveYawOffset?: number;
    preload?: boolean;
};

export const carOptions: CarOption[] = [
    {
        id: 'amg-one',
        label: 'Mercedes-AMG One',
        resourceName: 'carModelAmgOne',
        modelPath:
            'models/Cars/mercedes_amg_project_one/source/mercedes_amg_project_one.glb',
        lengthMeters: 4.75,
        engineSound: {
            low: 'engineLoop4',
            high: 'engineLoop5',
            profile: {
                rpmMax: 9000,
                rpmCurve: 1.2,
                minDetune: -120,
                maxDetune: 1600,
                highDetuneOffset: 220,
                lowVolume: 0.7,
                highVolume: 1.05,
                idleVolume: 0.1,
                throttleBoost: 0.22,
                lowpass: 19000,
                highpass: 60,
                shiftUp: {
                    duration: 0.16,
                    detune: -320,
                    volumeCut: 0.45,
                    transientVolume: 0.18,
                },
                shiftDown: {
                    duration: 0.12,
                    detune: 260,
                    volumeBoost: 0.18,
                    transientVolume: 0.14,
                },
            },
        },
        preload: true,
    },
    {
        id: 'bmw-e92-m3',
        label: 'BMW E92 M3',
        resourceName: 'carModelBmwE92',
        modelPath:
            'models/Cars/bmw_m3_e92_stance/source/bmw_m3_e92_stance.glb',
        lengthMeters: 4.615,
        engineSound: {
            low: 'engineLoop0',
            high: 'engineLoop1',
            profile: {
                rpmMax: 8400,
                rpmCurve: 1.05,
                minDetune: -260,
                maxDetune: 1350,
                highDetuneOffset: 140,
                lowVolume: 0.95,
                highVolume: 0.85,
                idleVolume: 0.09,
                throttleBoost: 0.18,
                lowpass: 13500,
                highpass: 30,
                shiftUp: {
                    duration: 0.18,
                    detune: -260,
                    volumeCut: 0.5,
                    transientVolume: 0.16,
                },
                shiftDown: {
                    duration: 0.14,
                    detune: 220,
                    volumeBoost: 0.22,
                    transientVolume: 0.12,
                },
            },
        },
    },
    {
        id: 'amg-c63-507',
        label: 'Mercedes-AMG C63 507',
        resourceName: 'carModelAmgC63507',
        modelPath:
            'models/Cars/2014_mercedes-benz_c63_amg_edition_507/source/2014_mercedes-benz_c63_amg_edition_507.glb',
        lengthMeters: 4.72,
        engineSound: {
            low: 'engineLoop1',
            high: 'engineLoop2',
            profile: {
                rpmMax: 7200,
                rpmCurve: 0.9,
                minDetune: -320,
                maxDetune: 1180,
                highDetuneOffset: 120,
                lowVolume: 1,
                highVolume: 0.8,
                idleVolume: 0.12,
                throttleBoost: 0.2,
                lowpass: 12000,
                highpass: 25,
                shiftUp: {
                    duration: 0.2,
                    detune: -300,
                    volumeCut: 0.55,
                    transientVolume: 0.2,
                },
                shiftDown: {
                    duration: 0.15,
                    detune: 200,
                    volumeBoost: 0.2,
                    transientVolume: 0.14,
                },
            },
        },
    },
    {
        id: 'amg-c63s-coupe',
        label: 'Mercedes-AMG C63s Coupe',
        resourceName: 'carModelAmgC63sCoupe',
        modelPath:
            'models/Cars/2019_mercedes-benz_c63_s_amg_coupe/source/2019_mercedes-benz_c63_s_amg_coupe.glb',
        lengthMeters: 4.75,
        engineSound: {
            low: 'engineLoop2',
            high: 'engineLoop3',
            profile: {
                rpmMax: 7000,
                rpmCurve: 0.92,
                minDetune: -300,
                maxDetune: 1200,
                highDetuneOffset: 130,
                lowVolume: 0.98,
                highVolume: 0.82,
                idleVolume: 0.11,
                throttleBoost: 0.19,
                lowpass: 11500,
                highpass: 30,
                shiftUp: {
                    duration: 0.2,
                    detune: -280,
                    volumeCut: 0.52,
                    transientVolume: 0.18,
                },
                shiftDown: {
                    duration: 0.15,
                    detune: 190,
                    volumeBoost: 0.19,
                    transientVolume: 0.13,
                },
            },
        },
    },
    {
        id: 'bmw-f82-m4',
        label: 'BMW F82 M4',
        resourceName: 'carModelBmwF82M4',
        modelPath: 'models/Cars/bmw_m4_f82/source/bmw_m4_f82.glb',
        lengthMeters: 4.67,
        engineSound: {
            low: 'engineLoop3',
            high: 'engineLoop4',
            profile: {
                rpmMax: 7600,
                rpmCurve: 1.1,
                minDetune: -220,
                maxDetune: 1400,
                highDetuneOffset: 160,
                lowVolume: 0.85,
                highVolume: 0.95,
                idleVolume: 0.08,
                throttleBoost: 0.2,
                lowpass: 15000,
                highpass: 45,
                shiftUp: {
                    duration: 0.18,
                    detune: -260,
                    volumeCut: 0.48,
                    transientVolume: 0.16,
                },
                shiftDown: {
                    duration: 0.14,
                    detune: 210,
                    volumeBoost: 0.2,
                    transientVolume: 0.12,
                },
            },
        },
    },
    {
        id: 'toyota-crown-platinum',
        label: 'Toyota Crown Platinum',
        resourceName: 'carModelToyotaCrownPlatinum',
        modelPath:
            'models/Cars/toyota_crown_2025/source/toyota_crown_2025.glb',
        lengthMeters: 4.98,
        engineSound: {
            low: 'engineLoop5',
            high: 'engineLoop0',
            profile: {
                rpmMax: 6500,
                rpmCurve: 1.25,
                minDetune: -180,
                maxDetune: 1200,
                highDetuneOffset: 140,
                lowVolume: 0.7,
                highVolume: 0.9,
                idleVolume: 0.07,
                throttleBoost: 0.16,
                lowpass: 15500,
                highpass: 90,
                shiftUp: {
                    duration: 0.16,
                    detune: -220,
                    volumeCut: 0.42,
                    transientVolume: 0.12,
                },
                shiftDown: {
                    duration: 0.12,
                    detune: 180,
                    volumeBoost: 0.15,
                    transientVolume: 0.1,
                },
            },
        },
        deskYawOffset: Math.PI / 2,
        driveYawOffset: 0,
    },
];

export const defaultCarId = 'amg-one';

export const carOptionsById = carOptions.reduce((acc, option) => {
    acc[option.id] = option;
    return acc;
}, {} as Record<string, CarOption>);

const CAR_STORAGE_KEY = 'yassinverse:selectedCar';

export const getStoredCarId = () => {
    if (typeof window === 'undefined') return defaultCarId;
    try {
        const stored = window.localStorage.getItem(CAR_STORAGE_KEY);
        if (stored && carOptionsById[stored]) {
            return stored;
        }
    } catch (error) {
        return defaultCarId;
    }
    return defaultCarId;
};

export const storeCarId = (carId: string) => {
    if (typeof window === 'undefined') return;
    if (!carOptionsById[carId]) return;
    try {
        window.localStorage.setItem(CAR_STORAGE_KEY, carId);
    } catch (error) {
        return;
    }
};
