export type CarOption = {
    id: string;
    label: string;
    resourceName: string;
    modelPath: string;
    lengthMeters: number;
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
        preload: true,
    },
    {
        id: 'bmw-e92-m3',
        label: 'BMW E92 M3',
        resourceName: 'carModelBmwE92',
        modelPath:
            'models/Cars/bmw_m3_e92_stance/source/bmw_m3_e92_stance.glb',
        lengthMeters: 4.615,
    },
    {
        id: 'amg-c63-507',
        label: 'Mercedes-AMG C63 507',
        resourceName: 'carModelAmgC63507',
        modelPath:
            'models/Cars/2014_mercedes-benz_c63_amg_edition_507/source/2014_mercedes-benz_c63_amg_edition_507.glb',
        lengthMeters: 4.72,
    },
    {
        id: 'amg-c63s-coupe',
        label: 'Mercedes-AMG C63s Coupe',
        resourceName: 'carModelAmgC63sCoupe',
        modelPath:
            'models/Cars/2019_mercedes-benz_c63_s_amg_coupe/source/2019_mercedes-benz_c63_s_amg_coupe.glb',
        lengthMeters: 4.75,
    },
    {
        id: 'bmw-f82-m4',
        label: 'BMW F82 M4',
        resourceName: 'carModelBmwF82M4',
        modelPath: 'models/Cars/bmw_m4_f82/source/bmw_m4_f82.glb',
        lengthMeters: 4.67,
    },
    {
        id: 'toyota-crown-platinum',
        label: 'Toyota Crown Platinum',
        resourceName: 'carModelToyotaCrownPlatinum',
        modelPath:
            'models/Cars/toyota_crown_2025/source/toyota_crown_2025.glb',
        lengthMeters: 4.98,
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
