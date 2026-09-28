// published figures for each car, kept apart from carOptions.ts on purpose:
// race-drivetrain-check.mjs checks the game data against these, then drives
// the real physics and compares. sources and derivations are in
// docs/cars-drivetrain.md, keep the two in step.
//
// times are seconds from a standstill to kph. car and driver leaves out the
// first foot of rollout (0.3 s where they state it), so 0.3 is added back to
// theirs. kind 'mfr' is the maker's claim, 'test' an instrumented road test

export const ROLLOUT_S = 0.3;
const cd = (s) => Math.round((s + ROLLOUT_S) * 100) / 100;
const MPH = 1.609344;

export const REFERENCE = {
    'amg-one': {
        variant: 'Mercedes-AMG ONE, production car (2022)',
        engine: '1.6 V6 turbo hybrid from the PU106 F1 engine, MGU-K, two front axle motors',
        transmission: '7-speed automated manual, 4-disc carbon clutch',
        idleRpm: 1280,
        redlineRpm: 11000,
        // overall ratios, gear times final drive, as mercedes-amg publishes them
        gearRatios: [12.803, 9.267, 7.058, 5.581, 4.562, 3.878, 3.435],
        finalDrive: 1,
        tyreRear: '335/30 ZR20',
        topSpeedKph: 352,
        speedLimitKph: 352,
        times: [
            { kph: 100, s: 2.9, kind: 'mfr' },
            { kph: 200, s: 7.0, kind: 'mfr' },
            { kph: 300, s: 15.6, kind: 'mfr' },
        ],
    },
    'bmw-e92-m3': {
        variant: 'BMW M3 Coupe E92 (2007-2013)',
        engine: 'S65B40 4.0 na V8',
        transmission: '6-speed manual',
        idleRpm: null,
        redlineRpm: 8400,
        gearRatios: [4.055, 2.369, 1.582, 1.192, 1.0, 0.872],
        finalDrive: 3.846,
        tyreRear: '265/40 ZR18',
        revsPerMile: 790,
        topSpeedKph: 250,
        speedLimitKph: 250,
        times: [
            { kph: 100, s: 4.8, kind: 'mfr' },
            { kph: 200, s: 16.3, kind: 'test' },
            { kph: 150 * MPH, s: cd(24.3), kind: 'test' },
        ],
    },
    'amg-c63-507': {
        variant: 'Mercedes-Benz C 63 AMG Coupe Edition 507 (C204, 2013-2014)',
        engine: 'M156 6.2 na V8',
        transmission: 'AMG SPEEDSHIFT MCT 7-speed',
        idleRpm: null,
        redlineRpm: 7200,
        gearRatios: [4.38, 2.86, 1.92, 1.37, 1.0, 0.82, 0.73],
        finalDrive: 2.82,
        tyreRear: '255/30 R19',
        topSpeedKph: 280,
        speedLimitKph: 280,
        times: [
            { kph: 100, s: 4.2, kind: 'mfr' },
            { kph: 60 * MPH, s: cd(3.9), kind: 'test' },
            { kph: 100 * MPH, s: cd(9.2), kind: 'test' },
            { kph: 160 * MPH, s: cd(27.0), kind: 'test' },
        ],
    },
    'amg-c63s-coupe': {
        variant: 'Mercedes-AMG C 63 S Coupe (C205 facelift, 2019)',
        engine: 'M177 4.0 twin turbo V8',
        transmission: 'AMG SPEEDSHIFT MCT 9G',
        idleRpm: null,
        redlineRpm: 7000,
        gearRatios: [5.35, 3.24, 2.25, 1.64, 1.21, 1.0, 0.86, 0.72, 0.6],
        finalDrive: 2.82,
        tyreRear: '285/30 ZR19',
        revsPerMile: 805,
        topSpeedKph: 290,
        speedLimitKph: 290,
        // the car and driver run is the C 63 S sedan, same drivetrain
        times: [
            { kph: 100, s: 3.9, kind: 'mfr' },
            { kph: 100 * MPH, s: cd(8.1), kind: 'test' },
            { kph: 130 * MPH, s: cd(13.5), kind: 'test' },
            { kph: 150 * MPH, s: cd(18.7), kind: 'test' },
        ],
    },
    'bmw-f82-m4': {
        variant: 'BMW M4 Coupe F82 (2014-2016)',
        engine: 'S55B30 3.0 twin turbo inline 6',
        transmission: '7-speed M DCT',
        idleRpm: 720,
        redlineRpm: 7600,
        gearRatios: [4.806, 2.593, 1.701, 1.277, 1.0, 0.844, 0.671],
        finalDrive: 3.462,
        tyreRear: '275/40 ZR18',
        topSpeedKph: 250,
        speedLimitKph: 250,
        // car and driver's 160 mph split is left out: their us car had a
        // 163 mph governor, this one has the 250 km/h limiter
        times: [
            { kph: 100, s: 4.1, kind: 'mfr' },
            { kph: 100 * MPH, s: cd(8.5), kind: 'test' },
            { kph: 130 * MPH, s: cd(14.5), kind: 'test' },
        ],
    },
    'bmw-f90-m5-competition': {
        variant: 'BMW M5 Competition F90 LCI (2021)',
        engine: 'S63B44T4 4.4 twin turbo V8',
        transmission: '8-speed M Steptronic (ZF 8HP), torque converter',
        idleRpm: null,
        redlineRpm: 7200,
        gearRatios: [5, 3.2, 2.143, 1.72, 1.313, 1, 0.823, 0.64],
        finalDrive: 3.15,
        tyreRear: '285/35 ZR20',
        revsPerMile: 746,
        topSpeedKph: 305,
        speedLimitKph: 305,
        times: [
            { kph: 100, s: 3.3, kind: 'mfr' },
            { kph: 200, s: 10.8, kind: 'mfr' },
        ],
    },
    'bmw-m8-competition-coupe': {
        variant: 'BMW M8 Competition Coupe F92 (2020)',
        engine: 'S63B44T4 4.4 twin turbo V8',
        transmission: '8-speed M Steptronic (ZF 8HP), torque converter',
        idleRpm: null,
        redlineRpm: 7200,
        gearRatios: [5, 3.2, 2.143, 1.72, 1.313, 1, 0.823, 0.64],
        finalDrive: 3.154,
        tyreRear: '285/35 ZR20',
        revsPerMile: 746,
        topSpeedKph: 305,
        speedLimitKph: 305,
        times: [
            { kph: 100, s: 3.2, kind: 'mfr' },
            { kph: 200, s: 10.6, kind: 'mfr' },
        ],
    },
    'mercedes-gt63s-edition-one': {
        variant: 'Mercedes-AMG GT 63 S 4MATIC+ 4-Door Coupe Edition 1 (X290, 2019)',
        engine: 'M177 4.0 twin turbo V8',
        transmission: 'AMG SPEEDSHIFT MCT 9G',
        idleRpm: null,
        redlineRpm: 7000,
        gearRatios: [5.35, 3.24, 2.25, 1.64, 1.21, 1.0, 0.86, 0.72, 0.6],
        finalDrive: 3.27,
        tyreRear: '315/30 R21',
        topSpeedKph: 315,
        speedLimitKph: 315,
        times: [
            { kph: 100, s: 3.2, kind: 'mfr' },
            { kph: 160, s: 6.6, kind: 'test' },
            { kph: 200, s: 10.2, kind: 'test' },
        ],
    },
    'toyota-crown-platinum': {
        variant: 'Toyota Crown Platinum (2023-2025), Hybrid MAX',
        engine: 'T24A-FTS 2.4 turbo inline 4, front motor in the transmission, rear eAxle',
        transmission: 'Direct Shift-6AT, wet start clutch',
        idleRpm: null,
        redlineRpm: null,
        gearRatios: [4.475, 2.517, 1.561, 1.143, 0.851, 0.672],
        finalDrive: 3.737,
        tyreRear: '225/45 R21',
        topSpeedKph: 208,
        speedLimitKph: 208,
        times: [
            { kph: 60 * MPH, s: 5.7, kind: 'mfr' },
            { kph: 60 * MPH, s: cd(5.1), kind: 'test' },
            { kph: 100 * MPH, s: cd(13.5), kind: 'test' },
            { kph: 120 * MPH, s: cd(20.8), kind: 'test' },
        ],
    },
};
