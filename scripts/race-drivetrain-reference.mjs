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
    'lamborghini-huracan': {
        variant: 'Lamborghini Huracán LP 610-4 coupe (2014-2019)',
        engine: '5.2 na V10',
        transmission: '7-speed LDF dual clutch',
        idleRpm: null,
        redlineRpm: 8500,
        // overall ratios: 3.133, 1.244, 0.979 on the 4.89 final drive, the
        // rest on the 3.938 one (huracán handbook, the sto's copy)
        gearRatios: [15.32, 10.19, 7.711, 6.083, 4.787, 3.843, 3.312],
        finalDrive: 1,
        tyreRear: '305/30 R20',
        topSpeedKph: 325,
        speedLimitKph: null,
        times: [
            { kph: 100, s: 3.2, kind: 'mfr' },
            { kph: 60 * MPH, s: cd(2.5), kind: 'test' },
            { kph: 100 * MPH, s: cd(5.7), kind: 'test' },
            { kph: 150 * MPH, s: cd(13.3), kind: 'test' },
        ],
    },
    'lamborghini-aventador-s': {
        variant: 'Lamborghini Aventador S LP 740-4 coupe (2017)',
        engine: 'L539 6.5 na V12',
        transmission: '7-speed ISR, single clutch',
        idleRpm: null,
        redlineRpm: 8500,
        gearRatios: [3.909, 2.438, 1.81, 1.458, 1.185, 0.967, 0.844],
        finalDrive: 2.867,
        tyreRear: '355/25 R21',
        topSpeedKph: 350,
        speedLimitKph: null,
        times: [
            { kph: 100, s: 2.9, kind: 'mfr' },
            { kph: 200, s: 8.8, kind: 'mfr' },
            { kph: 300, s: 24.2, kind: 'mfr' },
        ],
    },
    'ferrari-laferrari': {
        variant: 'Ferrari LaFerrari (2013-2016)',
        engine: 'F140FE 6.3 na V12 with HY-KERS',
        transmission: '7-speed dual clutch',
        idleRpm: null,
        redlineRpm: 9250,
        // the f12berlinetta's box; motor trend measured the same axle
        gearRatios: [3.077, 2.185, 1.626, 1.286, 1.028, 0.839, 0.693],
        finalDrive: 4.375,
        tyreRear: '345/30 ZR20',
        topSpeedKph: 350,
        speedLimitKph: 350,
        times: [
            { kph: 100, s: 3.0, kind: 'mfr' },
            { kph: 200, s: 7.0, kind: 'mfr' },
        ],
    },
    'mclaren-p1': {
        variant: 'McLaren P1 (2013-2015)',
        engine: 'M838TQ 3.8 twin turbo V8 with IPAS',
        transmission: '7-speed SSG dual clutch',
        idleRpm: null,
        redlineRpm: 8500,
        gearRatios: [3.981, 2.613, 1.905, 1.479, 1.161, 0.906, 0.686],
        finalDrive: 3.308,
        tyreRear: '315/30 R20',
        topSpeedKph: 350,
        speedLimitKph: 350,
        times: [
            { kph: 100, s: 2.8, kind: 'mfr' },
            { kph: 200, s: 6.8, kind: 'mfr' },
            { kph: 300, s: 16.5, kind: 'mfr' },
        ],
    },
    'porsche-918-spyder': {
        variant: 'Porsche 918 Spyder (2013-2015)',
        engine: '4.6 na V8 with front and rear motors',
        transmission: '7-speed PDK',
        idleRpm: null,
        redlineRpm: 9150,
        gearRatios: [3.91, 2.29, 1.58, 1.19, 0.97, 0.83, 0.67],
        finalDrive: 3.09,
        tyreRear: '325/30 ZR21',
        topSpeedKph: 345,
        speedLimitKph: null,
        times: [
            { kph: 100, s: 2.6, kind: 'mfr' },
            { kph: 200, s: 7.3, kind: 'mfr' },
            { kph: 300, s: 20.9, kind: 'mfr' },
        ],
    },
    'bugatti-chiron-super-sport': {
        variant: 'Bugatti Chiron Super Sport (2021-2022)',
        engine: '8.0 W16 with four turbos',
        transmission: '7-speed DSG dual clutch',
        idleRpm: null,
        redlineRpm: 7100,
        // overall ratios: bugatti gives the speed in each gear at the
        // limiter (100, 160, 210, 280, 340 and 415 km/h); 7th is the one the
        // 300+ reached 490.48 km/h in
        gearRatios: [9.229, 5.768, 4.395, 3.296, 2.714, 2.224, 1.882],
        finalDrive: 1,
        tyreRear: '355/25 R21',
        topSpeedKph: 440,
        speedLimitKph: 440,
        times: [
            { kph: 100, s: 2.4, kind: 'mfr' },
            { kph: 200, s: 5.8, kind: 'mfr' },
            { kph: 300, s: 12.1, kind: 'mfr' },
            { kph: 400, s: 28.6, kind: 'mfr' },
        ],
    },
    'koenigsegg-jesko': {
        variant: 'Koenigsegg Jesko Attack (2022), on E85',
        engine: '5.0 twin turbo flat-plane V8',
        transmission: '9-speed Light Speed Transmission',
        idleRpm: null,
        redlineRpm: 8500,
        // only 9th (0.66) is published; the final drive puts the absolut's
        // 531 km/h at 8,500 rpm on the tyre's nominal size, the other gears
        // are an even spread
        gearRatios: [4.62, 3.62, 2.84, 2.23, 1.75, 1.37, 1.07, 0.84, 0.66],
        finalDrive: 3.33,
        tyreRear: '325/30 R21',
        // not published for the attack: the sim's drag limit with the drag
        // estimated from its downforce
        topSpeedKph: 413,
        speedLimitKph: null,
        times: [],
    },
    'pagani-huayra': {
        variant: 'Pagani Huayra coupe (2012-2017)',
        engine: 'Mercedes-AMG M158 6.0 twin turbo V12',
        transmission: '7-speed Xtrac sequential, single clutch',
        idleRpm: null,
        redlineRpm: null,
        // not published: estimated overall ratios
        gearRatios: [8.87, 6.019, 4.555, 3.586, 2.957, 2.515, 2.161],
        finalDrive: 1,
        tyreRear: '335/30 ZR20',
        // top gear's "over 230 mph"; no times worth testing against
        topSpeedKph: 370,
        speedLimitKph: null,
        times: [],
    },
    'mclaren-senna': {
        variant: 'McLaren Senna (2018)',
        engine: 'M840TR 4.0 twin turbo flat-plane V8',
        transmission: '7-speed SSG dual clutch',
        idleRpm: null,
        redlineRpm: 8500,
        // not published: the p1's ratios, from the same ssg family
        gearRatios: [3.981, 2.613, 1.905, 1.479, 1.161, 0.906, 0.686],
        finalDrive: 3.308,
        tyreRear: '315/30 R20',
        topSpeedKph: 335,
        speedLimitKph: null,
        // car and driver's run (2.8 s to 60, 5.1 to 100 and 12.5 to 160 mph)
        // is left out: it is about 15% behind mclaren's own figures, and no
        // car can meet both
        times: [
            { kph: 100, s: 2.8, kind: 'mfr' },
            { kph: 200, s: 6.8, kind: 'mfr' },
        ],
    },
    'ferrari-sf90-stradale': {
        variant: 'Ferrari SF90 Stradale (2020)',
        engine: 'F154 4.0 twin turbo flat-plane V8 with three motors',
        transmission: '8-speed dual clutch',
        idleRpm: null,
        redlineRpm: 8000,
        // not published: estimated overall ratios, top speed in 7th
        gearRatios: [11.328, 7.842, 5.927, 4.742, 3.921, 3.289, 2.832, 2.427],
        finalDrive: 1,
        tyreRear: '315/30 ZR20',
        topSpeedKph: 340,
        speedLimitKph: null,
        times: [
            { kph: 100, s: 2.5, kind: 'mfr' },
            { kph: 200, s: 6.7, kind: 'mfr' },
            { kph: 60 * MPH, s: cd(2.0), kind: 'test' },
        ],
    },
    'aston-martin-valkyrie': {
        variant: 'Aston Martin Valkyrie coupe (2021)',
        engine: 'Cosworth 6.5 na V12 with a motor between engine and gearbox',
        transmission: '7-speed sequential, single clutch',
        idleRpm: 1200,
        redlineRpm: 11100,
        // not published: estimated overall ratios
        gearRatios: [14.783, 10.195, 7.781, 6.291, 5.28, 4.549, 3.995],
        finalDrive: 1,
        tyreRear: '325/30 ZR21',
        topSpeedKph: 354,
        speedLimitKph: 354,
        times: [],
    },
    'toyota-supra-mk4': {
        variant: 'Toyota Supra Turbo (JZA80), export 6-speed (1993-1998)',
        engine: '2JZ-GTE 3.0 sequential twin turbo inline six',
        transmission: 'Getrag V160 6-speed manual',
        idleRpm: 700,
        redlineRpm: 6800,
        gearRatios: [3.827, 2.36, 1.685, 1.312, 1.0, 0.793],
        finalDrive: 3.133,
        tyreRear: '255/40 ZR17',
        // car and driver's car hit its governor at 160 mph
        topSpeedKph: 257,
        speedLimitKph: 257,
        times: [
            { kph: 60 * MPH, s: cd(4.6), kind: 'test' },
            { kph: 100 * MPH, s: cd(11.1), kind: 'test' },
            { kph: 130 * MPH, s: cd(19.9), kind: 'test' },
            { kph: 150 * MPH, s: cd(29.6), kind: 'test' },
        ],
    },
};
