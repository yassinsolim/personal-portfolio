// per-car mixing for the race audio. the loops themselves live in
// static/sounds/race/<carId>.json + .webm/.m4a (built by scripts/audio).
// idleRpm is the rpm the idle loop was recorded or rendered at, so the
// engine sits on that pitch at the game's idle.

export type TurboProfile = {
    // whistle pitch at zero and full boost
    whistleHz: [number, number];
    whistleGain: number;
    // rpm where the turbo starts to build boost and where it is fully lit
    spool: [number, number];
    spoolTime: number;
    // lift-off release level (diverter valves are soft, the amg one's
    // wastegate is not)
    releaseGain: number;
    hissGain: number;
};

export type CarAudioProfile = {
    engine: string;
    idleRpm: number;
    limiterRpm: number;
    gain: number;
    // full-load level at idle rpm and at the limiter (db)
    onDb: [number, number];
    offDb: [number, number];
    pops: { rate: number; minRpm: number; window: number; gain: number } | null;
    // upshift crackle on dual clutch and mct boxes
    shiftCrackle: number;
    turbo: TurboProfile | null;
    // electric motor whine (hybrids), in hz per m/s of road speed
    motorWhine: { hzPerMps: number; gain: number } | null;
    limiterHz: number;
};

const subtleTurbo = (overrides: Partial<TurboProfile> = {}): TurboProfile => ({
    whistleHz: [1800, 5200],
    whistleGain: 0.012,
    spool: [1800, 3200],
    spoolTime: 0.35,
    releaseGain: 0.18,
    hissGain: 0.02,
    ...overrides,
});

export const CAR_AUDIO_PROFILES: Record<string, CarAudioProfile> = {
    'amg-one': {
        engine: '1.6 V6 turbo hybrid from the PU106B F1 engine, 11,000 rpm',
        idleRpm: 1250,
        limiterRpm: 11000,
        gain: 0.9,
        onDb: [-10, 0],
        offDb: [-23, -12],
        pops: { rate: 1.2, minRpm: 5000, window: 1.1, gain: 0.52 },
        shiftCrackle: 0.55,
        turbo: {
            whistleHz: [2200, 7800],
            whistleGain: 0.03,
            spool: [2500, 5000],
            spoolTime: 0.18,
            releaseGain: 0.45,
            hissGain: 0.05,
        },
        motorWhine: { hzPerMps: 14, gain: 0.018 },
        limiterHz: 16,
    },
    'bmw-e92-m3': {
        engine: 'S65 4.0 na V8, 8,400 rpm, individual throttle bodies',
        idleRpm: 900,
        limiterRpm: 8400,
        gain: 1,
        onDb: [-9, 0],
        offDb: [-22, -12],
        pops: { rate: 0.7, minRpm: 4000, window: 0.9, gain: 0.45 },
        shiftCrackle: 0.3,
        turbo: null,
        motorWhine: null,
        limiterHz: 14,
    },
    'amg-c63-507': {
        engine: 'M156 6.2 na V8',
        idleRpm: 1181,
        limiterRpm: 7200,
        gain: 1,
        onDb: [-8, 0],
        offDb: [-20, -11],
        pops: { rate: 3, minRpm: 3000, window: 1.6, gain: 0.75 },
        shiftCrackle: 0.45,
        turbo: null,
        motorWhine: null,
        limiterHz: 12,
    },
    'amg-c63s-coupe': {
        engine: 'M177 4.0 twin-turbo V8',
        idleRpm: 999,
        limiterRpm: 7000,
        gain: 1,
        onDb: [-8, 0],
        offDb: [-20, -11],
        pops: { rate: 4.5, minRpm: 2800, window: 2, gain: 0.9 },
        shiftCrackle: 0.8,
        turbo: subtleTurbo({ releaseGain: 0.22 }),
        motorWhine: null,
        limiterHz: 12,
    },
    'bmw-f82-m4': {
        engine: 'S55 3.0 twin-turbo inline-6',
        idleRpm: 721,
        limiterRpm: 7600,
        gain: 1,
        onDb: [-9, 0],
        offDb: [-21, -12],
        pops: { rate: 2.2, minRpm: 3200, window: 1.3, gain: 0.68 },
        shiftCrackle: 0.6,
        turbo: subtleTurbo({ whistleHz: [2000, 6000], whistleGain: 0.016, spool: [1700, 3000] }),
        motorWhine: null,
        limiterHz: 13,
    },
    'bmw-f90-m5-competition': {
        engine: 'S63 4.4 twin-turbo V8, cross-bank manifold',
        idleRpm: 1110,
        limiterRpm: 7200,
        gain: 1,
        onDb: [-9, 0],
        offDb: [-21, -12],
        pops: { rate: 1.4, minRpm: 3200, window: 1.1, gain: 0.52 },
        shiftCrackle: 0.25,
        turbo: subtleTurbo({ spool: [1600, 2800] }),
        motorWhine: null,
        limiterHz: 12,
    },
    'bmw-m8-competition-coupe': {
        engine: 'S63 4.4 twin-turbo V8, cross-bank manifold',
        idleRpm: 1110,
        limiterRpm: 7200,
        gain: 1,
        onDb: [-9, 0],
        offDb: [-21, -12],
        pops: { rate: 1.6, minRpm: 3200, window: 1.2, gain: 0.57 },
        shiftCrackle: 0.25,
        turbo: subtleTurbo({ spool: [1600, 2800] }),
        motorWhine: null,
        limiterHz: 12,
    },
    'mercedes-gt63s-edition-one': {
        engine: 'M177 4.0 twin-turbo V8',
        idleRpm: 999,
        limiterRpm: 7000,
        gain: 1,
        onDb: [-8, 0],
        offDb: [-20, -11],
        pops: { rate: 3, minRpm: 2800, window: 1.6, gain: 0.75 },
        shiftCrackle: 0.6,
        turbo: subtleTurbo({ releaseGain: 0.2 }),
        motorWhine: null,
        limiterHz: 12,
    },
    'toyota-crown-platinum': {
        engine: 'T24A-FTS 2.4 turbo inline-4 hybrid',
        idleRpm: 850,
        limiterRpm: 6200,
        gain: 0.85,
        onDb: [-10, -1],
        offDb: [-23, -15],
        pops: null,
        shiftCrackle: 0,
        turbo: subtleTurbo({ whistleGain: 0.01, releaseGain: 0.12, spool: [1500, 2600] }),
        motorWhine: { hzPerMps: 22, gain: 0.02 },
        limiterHz: 10,
    },
};

export const DEFAULT_CAR_AUDIO_PROFILE = CAR_AUDIO_PROFILES['bmw-e92-m3'];

export const getCarAudioProfile = (carId: string) =>
    CAR_AUDIO_PROFILES[carId] || DEFAULT_CAR_AUDIO_PROFILE;
