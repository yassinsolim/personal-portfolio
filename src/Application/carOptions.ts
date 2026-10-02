export type CarOption = {
    id: string;
    label: string;
    resourceName: string;
    modelPath: string;
    lengthMeters: number;
    race: CarRaceConfig;
    windowTint?: CarWindowTint;
    paint?: CarPaint;
    preload?: boolean;
};

// opacity works like tint darkness: 0.8 is roughly a 20% film, 0.5 is 50%
export type CarWindowTint = {
    materials: string[];
    opacity: number;
    windshieldOpacity: number;
    color?: number;
};

export type CarPaint = {
    materials: string[];
    color: number;
    metalness: number;
    roughness: number;
    clearcoatRoughness?: number;
};

export type DrivetrainType = 'RWD' | 'AWD' | 'FWD';

export type CarPerformanceReference = {
    label: string;
    url: string;
};

// power and torque are the published peaks. torqueCurve is the full load
// curve, [rpm, Nm], through the gearbox (hybrid motors on the same shaft
// included): the published plateau and peak power points plus estimated ends,
// see docs/cars-drivetrain.md. the rest are tuning values
export type CarPhysicsConfig = {
    powerKw: number;
    powerRpm: number;
    torqueNm: number;
    torqueRpm: number;
    torqueCurve: [number, number][];
    weightFront: number;
    cgHeight: number;
    tireGrip: number;
    cdA: number;
    clA?: number;
    frontTorqueShare?: number;
};

export type TransmissionType = 'manual' | 'dct' | 'mct' | 'amt' | 'automatic';

export type CarTransmission = {
    type: TransmissionType;
    name: string;
    // how long a gear change takes at full throttle, and the share of drive
    // torque that still gets through meanwhile: a dual clutch hands over
    // between its clutches, a manual or single clutch box cuts it
    shiftTime: number;
    shiftTorque: number;
    // revs the launch clutch or converter holds from rest at full throttle
    launchRpm: number;
    // torque multiplication of a torque converter at stall
    converterRatio?: number;
};

// the driven axle's tyre sets the rolling radius (tyres.ts). revsPerMile is
// the tyre maker's measured figure for the size when there is one
export type CarTyres = {
    front: string;
    rear: string;
    revsPerMile?: number;
};

export type CarRaceConfig = {
    visualForwardAxis?: 'positiveZ' | 'negativeZ';
    visualYawOffsetDeg?: number;
    groundOffsetMeters?: number;
    cameraFollowDistanceOffsetMeters?: number;
    startForwardOffsetMeters?: number;
    allowRwdDrift?: boolean;
    wheelSpinDirectionMultiplier?: 1 | -1;
    wheelNodeMap?: {
        frontLeft?: string[];
        frontRight?: string[];
        rearLeft?: string[];
        rearRight?: string[];
        candidates?: string[];
    };
    drivetrain: DrivetrainType;
    // published top speed and 0-100
    topSpeedKph: number;
    zeroToHundredSec: number;
    // electronic top speed limiter, null when the car has none
    speedLimitKph: number | null;
    massKg: number;
    // size of the model's wheels, for placing them. the drivetrain uses the
    // tyres' rolling radius
    wheelRadiusMeters: number;
    tyres: CarTyres;
    transmission: CarTransmission;
    idleRpm: number;
    // published redline, where the rev limiter cuts
    redlineRpm: number;
    // full scale of the hud tach
    tachMaxRpm: number;
    // automatic upshift at full throttle, and the downshift point
    shiftUpRpm: number;
    shiftDownRpm: number;
    finalDrive: number;
    gearRatios: number[];
    reverseRatio: number;
    steerRateLow: number;
    steerRateHigh: number;
    maxSteerAngleDeg: number;
    brakeDecel: number;
    physics: CarPhysicsConfig;
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
        // the canopy is two stacked glass shells, so each layer is lighter
        // and the pair lands near the 0.8 / 0.5 the other cars use
        windowTint: {
            materials: ['window', 'window_0', 'window_1', 'window_b'],
            opacity: 0.55,
            windshieldOpacity: 0.3,
        },
        race: {
            visualForwardAxis: 'positiveZ',
            wheelNodeMap: {
                frontLeft: ['rim_wheel_0'],
                frontRight: ['rim_wheel_d_0'],
                rearLeft: ['rim1_wheel_0'],
                rearRight: ['rim1_wheel_d_0'],
                candidates: ['rim', 'rim1', 'tire_f', 'tire_r'],
            },
            drivetrain: 'AWD',
            topSpeedKph: 352,
            zeroToHundredSec: 2.9,
            speedLimitKph: 352,
            massKg: 1695,
            wheelRadiusMeters: 0.34,
            tyres: { front: '285/35 ZR19', rear: '335/30 ZR20' },
            transmission: {
                type: 'amt',
                name: '7-speed automated manual, single carbon clutch',
                shiftTime: 0.1,
                // the front motors keep pulling while the clutch is open
                shiftTorque: 0.3,
                launchRpm: 5500,
            },
            idleRpm: 1280,
            redlineRpm: 11000,
            tachMaxRpm: 12000,
            shiftUpRpm: 10800,
            shiftDownRpm: 4200,
            // mercedes publishes the overall ratios (gear times final drive)
            finalDrive: 1,
            gearRatios: [12.803, 9.267, 7.058, 5.581, 4.562, 3.878, 3.435],
            reverseRatio: 14.599,
            steerRateLow: 0.78,
            steerRateHigh: 1.65,
            maxSteerAngleDeg: 34,
            brakeDecel: 44,
            physics: {
                powerKw: 782,
                powerRpm: 9000,
                torqueNm: 830,
                torqueRpm: 9000,
                // system output: the v6 (422 kW at 9,000) with the crank and
                // front axle motors. only the 782 kW peak is published; the
                // peaky shape and the drag are fitted to 0-100, 0-200, 0-300
                torqueCurve: [
                    [1280, 300],
                    [3000, 380],
                    [4500, 450],
                    [6000, 560],
                    [7000, 650],
                    [8000, 750],
                    [9000, 829.7],
                    [10000, 736.7],
                    [11000, 660.6],
                ],
                weightFront: 0.42,
                cgHeight: 0.42,
                tireGrip: 1.32,
                cdA: 1.15,
                clA: 1.2,
                frontTorqueShare: 0.3,
            },
            references: [
                {
                    label: 'Mercedes-AMG ONE Technical Data',
                    url: 'https://www.mercedes-amg.com/en/home/vehicles/amg-one/hypercar.html',
                },
                {
                    label: 'AMG ONE press data (gear ratios, tyres)',
                    url: 'https://www.amginyears.com/amg-overview/amg-project-one/',
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
        windowTint: {
            materials: ['e92_glass', 'e92_glass_int'],
            opacity: 0.8,
            windshieldOpacity: 0.5,
        },
        // polar white: solid (non-metallic) white under a glossy clearcoat
        paint: {
            materials: ['e92_paint'],
            color: 0xd8d9d6,
            metalness: 0,
            roughness: 0.28,
            clearcoatRoughness: 0.03,
        },
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
            speedLimitKph: 250,
            massKg: 1655,
            wheelRadiusMeters: 0.335,
            tyres: {
                front: '245/40 ZR18',
                rear: '265/40 ZR18',
                revsPerMile: 790,
            },
            transmission: {
                type: 'manual',
                name: '6-speed manual (Getrag), twin plate clutch',
                // a quick driver's full throttle shift, clutch in and out
                shiftTime: 0.3,
                shiftTorque: 0,
                launchRpm: 4200,
            },
            idleRpm: 700,
            redlineRpm: 8400,
            tachMaxRpm: 9000,
            shiftUpRpm: 8250,
            shiftDownRpm: 3200,
            finalDrive: 3.846,
            gearRatios: [4.055, 2.369, 1.582, 1.192, 1.0, 0.872],
            reverseRatio: 3.678,
            steerRateLow: 0.72,
            steerRateHigh: 1.58,
            maxSteerAngleDeg: 35,
            brakeDecel: 40,
            physics: {
                powerKw: 309,
                powerRpm: 8300,
                torqueNm: 400,
                torqueRpm: 3900,
                // 400 Nm at 3,900 and 309 kW at 8,300 are bmw's; 85% of the
                // peak holds over a 6,500 rpm span. the rest is shape
                torqueCurve: [
                    [700, 250],
                    [1000, 290],
                    [1800, 340],
                    [2500, 360],
                    [3000, 375],
                    [3900, 400],
                    [5000, 395],
                    [6000, 390],
                    [7000, 380],
                    [8300, 355.5],
                    [8400, 350],
                ],
                weightFront: 0.52,
                cgHeight: 0.48,
                tireGrip: 1.15,
                cdA: 0.684,
            },
            references: [
                {
                    label: 'BMW Group M3 Coupe Press Data',
                    url: 'https://www.press.bmwgroup.com/middle-east/article/detail/T0048125EN/the-new-bmw-m3-coupe-turning-powerful-passion-into-supreme-performance?language=en',
                },
                {
                    label: 'BMW M3 press kit technical data (2007)',
                    url: 'https://www.e46fanatics.com/d1/pdf/the_new_bmw_m3.pdf',
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
                frontLeft: ['polySurface1_whee'],
                frontRight: ['polySurface237_whee'],
                rearLeft: ['polySurface473_whee'],
                rearRight: ['polySurface671_whee'],
            },
            drivetrain: 'RWD',
            topSpeedKph: 280,
            zeroToHundredSec: 4.2,
            speedLimitKph: 280,
            massKg: 1798,
            wheelRadiusMeters: 0.34,
            tyres: { front: '235/35 R19', rear: '255/30 R19' },
            transmission: {
                type: 'mct',
                name: 'AMG SPEEDSHIFT MCT 7-speed, wet start clutch',
                shiftTime: 0.1,
                shiftTorque: 0.3,
                launchRpm: 3500,
            },
            idleRpm: 700,
            redlineRpm: 7200,
            tachMaxRpm: 8000,
            shiftUpRpm: 7050,
            shiftDownRpm: 2600,
            finalDrive: 2.82,
            gearRatios: [4.38, 2.86, 1.92, 1.37, 1.0, 0.82, 0.73],
            reverseRatio: 3.42,
            steerRateLow: 0.7,
            steerRateHigh: 1.5,
            maxSteerAngleDeg: 34,
            brakeDecel: 42,
            physics: {
                powerKw: 373,
                powerRpm: 6800,
                torqueNm: 610,
                torqueRpm: 5200,
                // 610 Nm at 5,200 and 373 kW at 6,800 are mercedes'; the rest
                // is the usual shape of the big na v8
                torqueCurve: [
                    [700, 380],
                    [1500, 450],
                    [2000, 500],
                    [3000, 555],
                    [4000, 590],
                    [5200, 610],
                    [6000, 580],
                    [6800, 523.8],
                    [7200, 480],
                ],
                weightFront: 0.54,
                cgHeight: 0.5,
                tireGrip: 1.12,
                // not published, fitted to car and driver's high speed times
                cdA: 0.85,
            },
            references: [
                {
                    label: 'Car and Driver C63 AMG 507 Test',
                    url: 'https://www.caranddriver.com/reviews/a15111205/2014-mercedes-benz-c63-amg-edition-507-test-review/',
                },
                {
                    label: 'Mercedes-Benz archive, C 63 AMG Edition 507 data',
                    url: 'https://mercedes-benz-publicarchive.com/marsClassic/en/instance/ko/C-63-AMG-Edition-507-2013---2014.xhtml?oid=189266535',
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
        windowTint: {
            materials: ['c63mat_glass1'],
            opacity: 0.8,
            windshieldOpacity: 0.5,
        },
        race: {
            visualForwardAxis: 'positiveZ',
            wheelNodeMap: {
                frontLeft: ['3DWheel_Front_L', 'polySurface1_whee'],
                frontRight: ['3DWheel_Front_R', 'polySurface237_whee'],
                rearLeft: ['3DWheel_Rear_L', 'polySurface473_whee'],
                rearRight: ['3DWheel_Rear_R', 'polySurface671_whee'],
            },
            wheelSpinDirectionMultiplier: -1,
            drivetrain: 'RWD',
            topSpeedKph: 290,
            zeroToHundredSec: 3.9,
            speedLimitKph: 290,
            massKg: 1815,
            wheelRadiusMeters: 0.345,
            tyres: {
                front: '255/35 ZR19',
                rear: '285/30 ZR19',
                revsPerMile: 805,
            },
            transmission: {
                type: 'mct',
                name: 'AMG SPEEDSHIFT MCT 9G, wet start clutch',
                shiftTime: 0.1,
                shiftTorque: 0.3,
                launchRpm: 3000,
            },
            idleRpm: 700,
            redlineRpm: 7000,
            tachMaxRpm: 8000,
            shiftUpRpm: 6850,
            shiftDownRpm: 2500,
            finalDrive: 2.82,
            gearRatios: [5.35, 3.24, 2.25, 1.64, 1.21, 1.0, 0.86, 0.72, 0.6],
            reverseRatio: 4.8,
            steerRateLow: 0.74,
            steerRateHigh: 1.56,
            maxSteerAngleDeg: 33,
            brakeDecel: 43,
            physics: {
                powerKw: 375,
                powerRpm: 6250,
                torqueNm: 700,
                torqueRpm: 2000,
                // 700 Nm from 2,000 to 4,500 and 375 kW from 5,500 to 6,250
                // are mercedes'; below the plateau and past it are estimates
                torqueCurve: [
                    [700, 380],
                    [1000, 450],
                    [1500, 600],
                    [2000, 700],
                    [4500, 700],
                    [5500, 651.1],
                    [5750, 622.8],
                    [6000, 596.8],
                    [6250, 573],
                    [7000, 477.5],
                ],
                weightFront: 0.54,
                cgHeight: 0.5,
                tireGrip: 1.18,
                cdA: 0.72,
            },
            references: [
                {
                    label: 'Car and Driver 2019 AMG C63 Specs',
                    url: 'https://www.caranddriver.com/mercedes-amg/c63-2019',
                },
                {
                    label: 'Car and Driver 2019 AMG C63 S test',
                    url: 'https://www.caranddriver.com/reviews/a22174935/2019-mercedes-amg-c63-first-drive-review/',
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
        windowTint: {
            materials: ['arm4_glass', 'arm4_glass_tinted'],
            opacity: 0.8,
            windshieldOpacity: 0.5,
        },
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
            speedLimitKph: 250,
            massKg: 1625,
            wheelRadiusMeters: 0.34,
            tyres: { front: '255/40 ZR18', rear: '275/40 ZR18' },
            transmission: {
                type: 'dct',
                name: '7-speed M DCT (Getrag 7DCT)',
                shiftTime: 0.1,
                shiftTorque: 0.7,
                launchRpm: 2500,
            },
            idleRpm: 720,
            redlineRpm: 7600,
            tachMaxRpm: 8000,
            shiftUpRpm: 7450,
            shiftDownRpm: 2400,
            finalDrive: 3.462,
            gearRatios: [4.806, 2.593, 1.701, 1.277, 1.0, 0.844, 0.671],
            reverseRatio: 4.172,
            steerRateLow: 0.75,
            steerRateHigh: 1.62,
            maxSteerAngleDeg: 34,
            brakeDecel: 41,
            physics: {
                powerKw: 317,
                powerRpm: 7300,
                torqueNm: 550,
                torqueRpm: 1850,
                // 550 Nm from 1,850 to 5,500 and 317 kW from 5,500 to 7,300
                // are bmw's; below 1,850 and past 7,300 are estimates
                torqueCurve: [
                    [720, 300],
                    [1000, 380],
                    [1500, 480],
                    [1850, 550],
                    [5500, 550],
                    [6000, 504.5],
                    [6500, 465.7],
                    [7000, 432.4],
                    [7300, 414.7],
                    [7600, 383.2],
                ],
                weightFront: 0.52,
                cgHeight: 0.48,
                tireGrip: 1.2,
                cdA: 0.758,
            },
            references: [
                {
                    label: 'BMW USA M4 Coupe media information',
                    url: 'https://www.press.bmwgroup.com/usa/article/attachment/T0160684EN_US/391903',
                },
                {
                    label: 'Car and Driver 2015 BMW M4 DCT test',
                    url: 'https://www.caranddriver.com/reviews/a15110053/2015-bmw-m4-dct-automatic-test-review/',
                },
            ],
        },
    },
    {
        id: 'bmw-f90-m5-competition',
        label: 'BMW F90 M5 Competition',
        resourceName: 'carModelBmwF90M5Competition',
        modelPath:
            'models/Cars/bmw_f90_m5_competition/source/2021_bmw_m5_competition.glb',
        lengthMeters: 4.983,
        race: {
            visualForwardAxis: 'positiveZ',
            allowRwdDrift: true,
            wheelNodeMap: {
                frontLeft: ['polySurface213'],
                frontRight: ['polySurface455'],
                rearLeft: ['polySurface697'],
                rearRight: ['polySurface939'],
                candidates: [
                    'polySurface213',
                    'polySurface455',
                    'polySurface697',
                    'polySurface939',
                ],
            },
            wheelSpinDirectionMultiplier: -1,
            drivetrain: 'AWD',
            topSpeedKph: 305,
            zeroToHundredSec: 3.3,
            // with the M Driver's Package, 250 without
            speedLimitKph: 305,
            massKg: 1935,
            wheelRadiusMeters: 0.35,
            tyres: {
                front: '275/35 ZR20',
                rear: '285/35 ZR20',
                revsPerMile: 746,
            },
            transmission: {
                type: 'automatic',
                name: '8-speed M Steptronic (ZF 8HP), torque converter',
                shiftTime: 0.15,
                shiftTorque: 0.4,
                launchRpm: 3000,
                converterRatio: 1.8,
            },
            idleRpm: 650,
            redlineRpm: 7200,
            tachMaxRpm: 8000,
            shiftUpRpm: 7000,
            shiftDownRpm: 2200,
            finalDrive: 3.15,
            gearRatios: [5, 3.2, 2.143, 1.72, 1.313, 1, 0.823, 0.64],
            reverseRatio: 3.478,
            steerRateLow: 0.72,
            steerRateHigh: 1.55,
            maxSteerAngleDeg: 34,
            brakeDecel: 43,
            physics: {
                powerKw: 460,
                powerRpm: 6000,
                torqueNm: 750,
                torqueRpm: 1800,
                // 750 Nm from 1,800 to 5,860 and 460 kW at 6,000 are bmw's;
                // below the plateau and the fall to the limiter are estimates
                torqueCurve: [
                    [650, 330],
                    [1000, 420],
                    [1500, 620],
                    [1800, 750],
                    [5860, 750],
                    [6000, 732.1],
                    [6500, 653.8],
                    [7000, 586.6],
                    [7200, 557],
                ],
                weightFront: 0.54,
                cgHeight: 0.52,
                tireGrip: 1.15,
                cdA: 0.758,
                frontTorqueShare: 0.35,
            },
            references: [
                {
                    label: 'BMW M5 Competition Technical Data',
                    url: 'https://www.bmw-m.com/en/topics/magazine-article-pool/bmw-m5-competition-f90-technical-data.html',
                },
                {
                    label: 'BMW M5 Competition specifications (2018)',
                    url: 'https://www.press.bmwgroup.com/global/article/attachment/T0280678EN/412670',
                },
            ],
        },
    },
    {
        id: 'bmw-m8-competition-coupe',
        label: 'BMW M8 Competition Coupe',
        resourceName: 'carModelBmwM8CompetitionCoupe',
        modelPath:
            'models/Cars/bmw_m8_competition_coupe/source/2020_bmw_m8_competition_coupe.glb',
        lengthMeters: 4.867,
        race: {
            visualForwardAxis: 'positiveZ',
            allowRwdDrift: true,
            wheelNodeMap: {
                frontLeft: ['3DWheel Front L'],
                frontRight: ['3DWheel Front R'],
                rearLeft: ['3DWheel Rear L'],
                rearRight: ['3DWheel Rear R'],
                candidates: [
                    '3DWheel Front L',
                    '3DWheel Front R',
                    '3DWheel Rear L',
                    '3DWheel Rear R',
                ],
            },
            wheelSpinDirectionMultiplier: -1,
            drivetrain: 'AWD',
            topSpeedKph: 305,
            zeroToHundredSec: 3.2,
            // with the M Driver's Package, 250 without
            speedLimitKph: 305,
            massKg: 1960,
            wheelRadiusMeters: 0.35,
            tyres: {
                front: '275/35 ZR20',
                rear: '285/35 ZR20',
                revsPerMile: 746,
            },
            transmission: {
                type: 'automatic',
                name: '8-speed M Steptronic (ZF 8HP), torque converter',
                shiftTime: 0.15,
                shiftTorque: 0.4,
                launchRpm: 3000,
                converterRatio: 1.8,
            },
            idleRpm: 650,
            redlineRpm: 7200,
            tachMaxRpm: 8000,
            shiftUpRpm: 7000,
            shiftDownRpm: 2200,
            finalDrive: 3.154,
            gearRatios: [5, 3.2, 2.143, 1.72, 1.313, 1, 0.823, 0.64],
            reverseRatio: 3.478,
            steerRateLow: 0.72,
            steerRateHigh: 1.55,
            maxSteerAngleDeg: 34,
            brakeDecel: 43,
            physics: {
                powerKw: 460,
                powerRpm: 6000,
                torqueNm: 750,
                torqueRpm: 1800,
                // same S63 as the M5 Competition: 750 Nm from 1,800 to 5,860
                // and 460 kW at 6,000 are bmw's, the ends are estimates
                torqueCurve: [
                    [650, 330],
                    [1000, 420],
                    [1500, 620],
                    [1800, 750],
                    [5860, 750],
                    [6000, 732.1],
                    [6500, 653.8],
                    [7000, 586.6],
                    [7200, 557],
                ],
                weightFront: 0.53,
                cgHeight: 0.5,
                tireGrip: 1.2,
                cdA: 0.7425,
                frontTorqueShare: 0.35,
            },
            references: [
                {
                    label: 'BMW M8 Competition Coupe Technical Data',
                    url: 'https://www.bmw-m.com/en/topics/magazine-article-pool/bmw-m8-competition-coupe-f92-technical-data.html',
                },
                {
                    label: 'BMW M8 Coupe and M8 Competition specifications',
                    url: 'https://www.press.bmwgroup.com/global/article/attachment/T0330570EN/477179',
                },
            ],
        },
    },
    {
        id: 'mercedes-gt63s-edition-one',
        label: 'Mercedes-AMG GT63s Edition One',
        resourceName: 'carModelMercedesGt63sEditionOne',
        modelPath:
            'models/Cars/mercedes_benz_gt63s_edition_one/source/gt63s_edition1.glb',
        lengthMeters: 5.054,
        windowTint: {
            materials: ['window tint 20', 'glass'],
            opacity: 0.8,
            windshieldOpacity: 0.5,
        },
        race: {
            visualForwardAxis: 'positiveZ',
            allowRwdDrift: true,
            wheelNodeMap: {
                frontLeft: ['Mesh038', 'Mesh.038'],
                frontRight: ['Mesh020', 'Mesh.020'],
                rearLeft: ['Mesh023', 'Mesh.023'],
                rearRight: ['Mesh010', 'Mesh.010'],
                candidates: [
                    'Mesh038',
                    'Mesh020',
                    'Mesh023',
                    'Mesh010',
                    'Mesh.038',
                    'Mesh.020',
                    'Mesh.023',
                    'Mesh.010',
                ],
            },
            wheelSpinDirectionMultiplier: -1,
            drivetrain: 'AWD',
            topSpeedKph: 315,
            zeroToHundredSec: 3.2,
            speedLimitKph: 315,
            massKg: 2120,
            wheelRadiusMeters: 0.355,
            tyres: { front: '275/35 R21', rear: '315/30 R21' },
            transmission: {
                type: 'mct',
                name: 'AMG SPEEDSHIFT MCT 9G, wet start clutch',
                shiftTime: 0.1,
                shiftTorque: 0.3,
                launchRpm: 3000,
            },
            idleRpm: 700,
            redlineRpm: 7000,
            tachMaxRpm: 8000,
            shiftUpRpm: 6850,
            shiftDownRpm: 2200,
            finalDrive: 3.27,
            gearRatios: [5.35, 3.24, 2.25, 1.64, 1.21, 1, 0.86, 0.72, 0.6],
            reverseRatio: 4.8,
            steerRateLow: 0.69,
            steerRateHigh: 1.46,
            maxSteerAngleDeg: 32,
            brakeDecel: 44,
            physics: {
                powerKw: 470,
                powerRpm: 6500,
                torqueNm: 900,
                torqueRpm: 2500,
                // 900 Nm from 2,500 to 4,500 and 470 kW from 5,500 to 6,500
                // are mercedes'; below the plateau and past it are estimates
                torqueCurve: [
                    [700, 450],
                    [1000, 520],
                    [1500, 650],
                    [2000, 800],
                    [2500, 900],
                    [4500, 900],
                    [5500, 816],
                    [6000, 748],
                    [6500, 690.5],
                    [7000, 613.9],
                ],
                weightFront: 0.55,
                cgHeight: 0.53,
                tireGrip: 1.15,
                cdA: 0.78,
                frontTorqueShare: 0.4,
            },
            references: [
                {
                    label: 'Car and Driver 2020 AMG GT63 S Specs',
                    url: 'https://www.caranddriver.com/mercedes-amg/gt63',
                },
                {
                    label: 'Mercedes-AMG GT 63 S 4MATIC+ Edition 1 press data',
                    url: 'https://www.caricos.com/cars/m/mercedes-benz/2019_mercedes-amg_gt63_s_edition_1/',
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
            visualForwardAxis: 'negativeZ',
            visualYawOffsetDeg: 0,
            groundOffsetMeters: 0,
            startForwardOffsetMeters: 0,
            wheelSpinDirectionMultiplier: -1,
            drivetrain: 'AWD',
            wheelNodeMap: {
                frontLeft: ['316_black_0'],
                frontRight: ['356_black_0'],
                rearLeft: ['340_black_0'],
                rearRight: ['348_black_0'],
                candidates: ['340_black_0', '316_black_0', '348_black_0', '356_black_0'],
            },
            topSpeedKph: 208,
            zeroToHundredSec: 5.6,
            speedLimitKph: 208,
            massKg: 1968,
            wheelRadiusMeters: 0.35,
            tyres: { front: '225/45 R21', rear: '225/45 R21' },
            transmission: {
                type: 'automatic',
                name: 'Direct Shift-6AT, wet start clutch instead of a converter',
                shiftTime: 0.3,
                shiftTorque: 0.4,
                launchRpm: 2400,
            },
            idleRpm: 800,
            redlineRpm: 6500,
            tachMaxRpm: 7000,
            shiftUpRpm: 6200,
            shiftDownRpm: 1900,
            // toyota doesn't publish these; they're lexus' figures for the
            // same hybrid max transaxle in the RX 500h
            finalDrive: 3.737,
            gearRatios: [4.475, 2.517, 1.561, 1.143, 0.851, 0.672],
            reverseRatio: 3.196,
            steerRateLow: 0.66,
            steerRateHigh: 1.46,
            maxSteerAngleDeg: 33,
            brakeDecel: 39,
            physics: {
                powerKw: 254,
                powerRpm: 6000,
                torqueNm: 542,
                torqueRpm: 2000,
                // hybrid max output through the gearbox: 400 lb-ft (542 Nm)
                // is toyota's system torque. the 340 hp system peak needs the
                // small battery, so past the plateau the curve is fitted to
                // car and driver's full throttle run (about 217 kW sustained)
                torqueCurve: [
                    [800, 380],
                    [1500, 480],
                    [2000, 542],
                    [3000, 542],
                    [4000, 470],
                    [5000, 400],
                    [6000, 345],
                    [6500, 310],
                ],
                weightFront: 0.58,
                cgHeight: 0.58,
                tireGrip: 1.0,
                cdA: 0.75,
                frontTorqueShare: 0.45,
            },
            references: [
                {
                    label: 'Car and Driver 2023 Toyota Crown Tested',
                    url: 'https://www.caranddriver.com/reviews/a41711747/2023-toyota-crown-drive/',
                },
                {
                    label: 'Toyota Canada 2025 Crown product information',
                    url: 'https://toyotacanada.scene7.com/is/content/toyotacanada/2025%20Crown%20Product%20Informationpdf',
                },
                {
                    label: 'Lexus UK RX technical specifications (Hybrid MAX ratios)',
                    url: 'https://media.lexus.co.uk/wp-content/uploads/sites/3/pdf/230217M-RX-Tech-Spec.pdf',
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
