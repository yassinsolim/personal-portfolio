// per-car mixing for the race audio. the loops themselves live in
// static/sounds/race/<carId>.json + .webm/.m4a (built by scripts/audio).
// idleRpm is the rpm the idle loop was recorded or rendered at, so the
// engine sits on that pitch at the game's idle.
import type { EngineSound } from '../Garage/engines';

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
    // supercharger whine from the garage, hz per engine rev per second
    superWhine?: { ratio: number; gain: number } | null;
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
        limiterRpm: 6500,
        gain: 0.85,
        onDb: [-10, -1],
        offDb: [-23, -15],
        pops: null,
        shiftCrackle: 0,
        turbo: subtleTurbo({ whistleGain: 0.01, releaseGain: 0.12, spool: [1500, 2600] }),
        motorWhine: { hzPerMps: 22, gain: 0.02 },
        limiterHz: 10,
    },
    'lamborghini-huracan': {
        engine: 'Lamborghini 5.2 V10, 8,500 rpm',
        idleRpm: 801,
        limiterRpm: 8500,
        gain: 1,
        onDb: [-9, 0],
        offDb: [-21, -11],
        pops: { rate: 2.5, minRpm: 3000, window: 1.4, gain: 0.7 },
        shiftCrackle: 0.6,
        turbo: null,
        motorWhine: null,
        limiterHz: 14,
    },
    'lamborghini-aventador-s': {
        engine: 'Lamborghini L539 6.5 V12, 8,500 rpm, single clutch ISR box',
        idleRpm: 989,
        limiterRpm: 8500,
        gain: 1,
        onDb: [-9, 0],
        offDb: [-21, -11],
        pops: { rate: 2, minRpm: 3500, window: 1.2, gain: 0.75 },
        shiftCrackle: 0.9,
        turbo: null,
        motorWhine: null,
        limiterHz: 14,
    },
    'ferrari-laferrari': {
        engine: 'Ferrari F140FE 6.3 V12 with HY-KERS, 9,250 rpm',
        idleRpm: 939,
        limiterRpm: 9250,
        gain: 1,
        onDb: [-10, 0],
        offDb: [-22, -12],
        pops: { rate: 1, minRpm: 4000, window: 0.9, gain: 0.45 },
        shiftCrackle: 0.4,
        turbo: null,
        motorWhine: { hzPerMps: 18, gain: 0.016 },
        limiterHz: 16,
    },
    'mclaren-p1': {
        engine: 'McLaren M838TQ 3.8 twin-turbo flat-plane V8 with IPAS',
        idleRpm: 829,
        limiterRpm: 8500,
        gain: 1,
        onDb: [-9, 0],
        offDb: [-21, -12],
        pops: { rate: 1.5, minRpm: 3500, window: 1, gain: 0.5 },
        shiftCrackle: 0.5,
        turbo: {
            whistleHz: [2400, 7000],
            whistleGain: 0.03,
            spool: [2200, 4000],
            spoolTime: 0.3,
            releaseGain: 0.55,
            hissGain: 0.05,
        },
        motorWhine: { hzPerMps: 16, gain: 0.016 },
        limiterHz: 14,
    },
    'porsche-918-spyder': {
        engine: 'Porsche 4.6 flat-plane V8 with two motors, 9,150 rpm, top exit pipes',
        idleRpm: 1015,
        limiterRpm: 9150,
        gain: 1,
        onDb: [-9, 0],
        offDb: [-21, -11],
        pops: { rate: 1.2, minRpm: 4000, window: 1, gain: 0.5 },
        shiftCrackle: 0.45,
        turbo: null,
        motorWhine: { hzPerMps: 20, gain: 0.02 },
        limiterHz: 15,
    },
};

export const DEFAULT_CAR_AUDIO_PROFILE = CAR_AUDIO_PROFILES['bmw-e92-m3'];

export const getCarAudioProfile = (carId: string) =>
    CAR_AUDIO_PROFILES[carId] || DEFAULT_CAR_AUDIO_PROFILE;

const DEFAULT_POPS = { rate: 1.8, minRpm: 3000, window: 1.2, gain: 0.55 };
const louder = (pair: [number, number], db: [number, number]): [number, number] => [pair[0] + db[0], pair[1] + db[1]];

// a bank's mix with the garage's induction and exhaust on top
export const engineProfile = (sound: EngineSound): CarAudioProfile => {
    const base = getCarAudioProfile(sound.sound);
    const redline = sound.redlineRpm;
    const profile: CarAudioProfile = { ...base, limiterRpm: redline };
    if (sound.turbo === 'none') profile.turbo = null;
    if (sound.turbo === 'twin') {
        profile.turbo =
            base.turbo ||
            subtleTurbo({ whistleGain: 0.022, hissGain: 0.035, releaseGain: 0.35, spool: [0.3 * redline, 0.5 * redline] });
    }
    if (sound.turbo === 'quad') {
        const t = base.turbo || subtleTurbo();
        profile.turbo = {
            ...t,
            whistleGain: t.whistleGain * 2.2 + 0.01,
            hissGain: t.hissGain * 2,
            releaseGain: Math.max(0.6, t.releaseGain),
            spool: [0.4 * redline, 0.62 * redline],
            spoolTime: 0.6,
        };
    }
    if (sound.supercharger) profile.superWhine = { ratio: 9, gain: 0.018 };
    const pops = base.pops || DEFAULT_POPS;
    if (sound.exhaust === 'sport') {
        profile.gain = base.gain * 1.1;
        profile.onDb = louder(base.onDb, [1, 1.5]);
        profile.pops = { ...pops, rate: pops.rate * 1.6, gain: Math.min(1, pops.gain * 1.2) };
        profile.shiftCrackle = base.shiftCrackle + 0.2;
    } else if (sound.exhaust === 'straight') {
        profile.gain = base.gain * 1.2;
        profile.onDb = louder(base.onDb, [2, 3]);
        profile.offDb = louder(base.offDb, [3, 3]);
        profile.pops = { ...pops, rate: pops.rate * 2.6, window: pops.window * 1.4, gain: Math.min(1, pops.gain * 1.5) };
        profile.shiftCrackle = base.shiftCrackle + 0.45;
    }
    return profile;
};
