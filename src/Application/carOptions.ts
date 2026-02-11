export type CarOption = {
    id: string;
    label: string;
    resourceName: string;
    modelPath: string;
    lengthMeters: number;
    race: CarRaceConfig;
    preload?: boolean;
};

export type DrivetrainType = 'RWD' | 'AWD' | 'FWD';

export type CarPerformanceReference = {
    label: string;
    url: string;
};

export type CarRaceConfig = {
    visualForwardAxis?: 'positiveZ' | 'negativeZ';
    groundOffsetMeters?: number;
    cameraFollowDistanceOffsetMeters?: number;
    wheelNodeMap?: {
        frontLeft?: string[];
        frontRight?: string[];
        rearLeft?: string[];
        rearRight?: string[];
        candidates?: string[];
    };
    drivetrain: DrivetrainType;
    topSpeedKph: number;
    zeroToHundredSec: number;
    massKg: number;
    wheelRadiusMeters: number;
    idleRpm: number;
    redlineRpm: number;
    shiftUpRpm: number;
    shiftDownRpm: number;
    finalDrive: number;
    gearRatios: number[];
    reverseRatio: number;
    steerRateLow: number;
    steerRateHigh: number;
    maxSteerAngleDeg: number;
    brakeDecel: number;
    references: CarPerformanceReference[];
};

export const carOptions: CarOption[] = [
    {
        id: 'amg-one',
        label: 'Mercedes-AMG One',
        resourceName: 'carModelAmgOne',
        modelPath:
            'models/Cars/mercedes_amg_project_one/source/mercedes_amg_project_one.glb',
        lengthMeters: 4.75,
        race: {
            visualForwardAxis: 'positiveZ',
            groundOffsetMeters: -0.01,
            wheelNodeMap: {
                candidates: ['rim', 'rim1', 'tire_f', 'tire_r'],
            },
            drivetrain: 'AWD',
            topSpeedKph: 352,
            zeroToHundredSec: 2.9,
            massKg: 1695,
            wheelRadiusMeters: 0.34,
            idleRpm: 1250,
            redlineRpm: 11000,
            shiftUpRpm: 10400,
            shiftDownRpm: 3800,
            finalDrive: 3.08,
            gearRatios: [3.15, 2.38, 1.87, 1.53, 1.27, 1.07, 0.9],
            reverseRatio: 3.0,
            steerRateLow: 0.78,
            steerRateHigh: 1.65,
            maxSteerAngleDeg: 34,
            brakeDecel: 44,
            references: [
                {
                    label: 'Mercedes-AMG ONE Technical Data',
                    url: 'https://www.mercedes-amg.com/en/home/vehicles/amg-one/hypercar.html',
                },
            ],
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
        race: {
            visualForwardAxis: 'positiveZ',
            wheelNodeMap: {
                frontLeft: ['e92_wheel_05a_19x9.002'],
                frontRight: ['e92_wheel_05a_19x9'],
                rearLeft: ['e92_wheel_05a_19x9.003'],
                rearRight: ['e92_wheel_05a_19x9.001'],
            },
            drivetrain: 'RWD',
            topSpeedKph: 250,
            zeroToHundredSec: 4.8,
            massKg: 1655,
            wheelRadiusMeters: 0.335,
            idleRpm: 900,
            redlineRpm: 8400,
            shiftUpRpm: 8100,
            shiftDownRpm: 3200,
            finalDrive: 3.85,
            gearRatios: [4.06, 2.4, 1.58, 1.19, 1.0, 0.87],
            reverseRatio: 3.68,
            steerRateLow: 0.72,
            steerRateHigh: 1.58,
            maxSteerAngleDeg: 35,
            brakeDecel: 40,
            references: [
                {
                    label: 'BMW Group M3 Coupe Press Data',
                    url: 'https://www.press.bmwgroup.com/middle-east/article/detail/T0048125EN/the-new-bmw-m3-coupe-turning-powerful-passion-into-supreme-performance?language=en',
                },
            ],
        },
    },
    {
        id: 'amg-c63-507',
        label: 'Mercedes-AMG C63 507',
        resourceName: 'carModelAmgC63507',
        modelPath:
            'models/Cars/2014_mercedes-benz_c63_amg_edition_507/source/2014_mercedes-benz_c63_amg_edition_507.glb',
        lengthMeters: 4.72,
        race: {
            visualForwardAxis: 'positiveZ',
            wheelNodeMap: {
                frontLeft: ['3dwheel front l'],
                frontRight: ['3dwheel front r'],
                rearLeft: ['3dwheel rear l'],
                rearRight: ['3dwheel rear r'],
            },
            drivetrain: 'RWD',
            topSpeedKph: 280,
            zeroToHundredSec: 4.2,
            massKg: 1798,
            wheelRadiusMeters: 0.34,
            idleRpm: 900,
            redlineRpm: 7000,
            shiftUpRpm: 6800,
            shiftDownRpm: 2600,
            finalDrive: 3.06,
            gearRatios: [4.38, 2.86, 1.92, 1.37, 1.0, 0.82, 0.73],
            reverseRatio: 3.42,
            steerRateLow: 0.7,
            steerRateHigh: 1.5,
            maxSteerAngleDeg: 34,
            brakeDecel: 42,
            references: [
                {
                    label: 'Car and Driver C63 AMG 507 Test',
                    url: 'https://www.caranddriver.com/reviews/a15111205/2014-mercedes-benz-c63-amg-edition-507-test-review/',
                },
            ],
        },
    },
    {
        id: 'amg-c63s-coupe',
        label: 'Mercedes-AMG C63s Coupe',
        resourceName: 'carModelAmgC63sCoupe',
        modelPath:
            'models/Cars/2019_mercedes-benz_c63_s_amg_coupe/source/2019_mercedes-benz_c63_s_amg_coupe.glb',
        lengthMeters: 4.75,
        race: {
            visualForwardAxis: 'positiveZ',
            wheelNodeMap: {
                frontLeft: [
                    'polySurface1_wheeMercedesAMG_S63CoupeRewardRecycled_2020_Wheel1A_3D_3DWh_c96cb19_0',
                ],
                frontRight: [
                    'polySurface237_wheeMercedesAMG_S63CoupeRewardRecycled_2020_Wheel1A_3D_3DWh_c96cb19_0',
                ],
                rearLeft: [
                    'polySurface473_wheeMercedesAMG_S63CoupeRewardRecycled_2020_Wheel1A_3D_3DWh_c96cb19_0',
                ],
                rearRight: [
                    'polySurface671_wheeMercedesAMG_S63CoupeRewardRecycled_2020_Wheel1A_3D_3DWh_c96cb19_0',
                ],
            },
            drivetrain: 'RWD',
            topSpeedKph: 290,
            zeroToHundredSec: 3.9,
            massKg: 1815,
            wheelRadiusMeters: 0.345,
            idleRpm: 850,
            redlineRpm: 7000,
            shiftUpRpm: 6750,
            shiftDownRpm: 2500,
            finalDrive: 2.82,
            gearRatios: [5.35, 3.24, 2.25, 1.64, 1.21, 1.0, 0.86, 0.72, 0.6],
            reverseRatio: 4.8,
            steerRateLow: 0.74,
            steerRateHigh: 1.56,
            maxSteerAngleDeg: 33,
            brakeDecel: 43,
            references: [
                {
                    label: 'Car and Driver 2019 AMG C63 Specs',
                    url: 'https://www.caranddriver.com/mercedes-amg/c63-2019',
                },
            ],
        },
    },
    {
        id: 'bmw-f82-m4',
        label: 'BMW F82 M4',
        resourceName: 'carModelBmwF82M4',
        modelPath: 'models/Cars/bmw_m4_f82/source/bmw_m4_f82.glb',
        lengthMeters: 4.67,
        race: {
            visualForwardAxis: 'positiveZ',
            wheelNodeMap: {
                frontLeft: ['arm4_vt_wheel.002'],
                frontRight: ['arm4_vt_wheel'],
                rearLeft: ['arm4_vt_wheel.003'],
                rearRight: ['arm4_vt_wheel.001'],
            },
            drivetrain: 'RWD',
            topSpeedKph: 250,
            zeroToHundredSec: 4.1,
            massKg: 1625,
            wheelRadiusMeters: 0.34,
            idleRpm: 900,
            redlineRpm: 7600,
            shiftUpRpm: 7350,
            shiftDownRpm: 2400,
            finalDrive: 3.46,
            gearRatios: [4.81, 2.59, 1.7, 1.28, 1.0, 0.84, 0.67],
            reverseRatio: 3.68,
            steerRateLow: 0.75,
            steerRateHigh: 1.62,
            maxSteerAngleDeg: 34,
            brakeDecel: 41,
            references: [
                {
                    label: 'Car and Driver 2015 BMW M4 Info',
                    url: 'https://www.caranddriver.com/news/a15110475/2015-bmw-m4-coupe-photos-and-info-news/',
                },
            ],
        },
    },
    {
        id: 'toyota-crown-platinum',
        label: 'Toyota Crown Platinum',
        resourceName: 'carModelToyotaCrownPlatinum',
        modelPath:
            'models/Cars/toyota_crown_2025/source/toyota_crown_2025.glb',
        lengthMeters: 4.98,
        race: {
            visualForwardAxis: 'positiveZ',
            groundOffsetMeters: 0.4,
            cameraFollowDistanceOffsetMeters: 3.8,
            drivetrain: 'AWD',
            wheelNodeMap: {
                frontLeft: ['316_black_0'],
                frontRight: ['340_black_0'],
                rearLeft: ['356_black_0'],
                rearRight: ['348_black_0'],
            },
            topSpeedKph: 208,
            zeroToHundredSec: 5.3,
            massKg: 1968,
            wheelRadiusMeters: 0.35,
            idleRpm: 850,
            redlineRpm: 6200,
            shiftUpRpm: 6000,
            shiftDownRpm: 1900,
            finalDrive: 3.33,
            gearRatios: [4.02, 2.55, 1.66, 1.27, 1.0, 0.8],
            reverseRatio: 3.9,
            steerRateLow: 0.66,
            steerRateHigh: 1.46,
            maxSteerAngleDeg: 33,
            brakeDecel: 39,
            references: [
                {
                    label: 'Car and Driver 2023 Toyota Crown Tested',
                    url: 'https://www.caranddriver.com/reviews/a41711747/2023-toyota-crown-drive/',
                },
            ],
        },
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
