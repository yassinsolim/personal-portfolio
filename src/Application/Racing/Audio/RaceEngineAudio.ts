import UIEventBus from '../../UI/EventBus';

type EngineTelemetry = {
    rpm: number;
    throttle: number;
    speedMps: number;
    carId: string;
    gear: number;
};

type CarAudioProfile = {
    idleFrequency: number;
    lowFrequency: number;
    highFrequency: number;
    idleGain: number;
    lowGain: number;
    highGain: number;
    driveMultiplier: number;
    waveformIdle: OscillatorType;
    waveformLow: OscillatorType;
    waveformHigh: OscillatorType;
};

const DEFAULT_PROFILE: CarAudioProfile = {
    idleFrequency: 32,
    lowFrequency: 55,
    highFrequency: 95,
    idleGain: 0.22,
    lowGain: 0.22,
    highGain: 0.14,
    driveMultiplier: 1,
    waveformIdle: 'sawtooth',
    waveformLow: 'triangle',
    waveformHigh: 'square',
};

const CAR_PROFILES: Record<string, CarAudioProfile> = {
    'amg-one': {
        idleFrequency: 36,
        lowFrequency: 60,
        highFrequency: 110,
        idleGain: 0.2,
        lowGain: 0.23,
        highGain: 0.18,
        driveMultiplier: 1.18,
        waveformIdle: 'sawtooth',
        waveformLow: 'triangle',
        waveformHigh: 'square',
    },
    'bmw-e92-m3': {
        idleFrequency: 30,
        lowFrequency: 54,
        highFrequency: 90,
        idleGain: 0.25,
        lowGain: 0.2,
        highGain: 0.12,
        driveMultiplier: 1,
        waveformIdle: 'triangle',
        waveformLow: 'sawtooth',
        waveformHigh: 'triangle',
    },
    'amg-c63-507': {
        idleFrequency: 28,
        lowFrequency: 48,
        highFrequency: 84,
        idleGain: 0.28,
        lowGain: 0.19,
        highGain: 0.11,
        driveMultiplier: 0.93,
        waveformIdle: 'sawtooth',
        waveformLow: 'triangle',
        waveformHigh: 'square',
    },
    'amg-c63s-coupe': {
        idleFrequency: 31,
        lowFrequency: 52,
        highFrequency: 88,
        idleGain: 0.24,
        lowGain: 0.22,
        highGain: 0.14,
        driveMultiplier: 0.98,
        waveformIdle: 'sawtooth',
        waveformLow: 'triangle',
        waveformHigh: 'square',
    },
    'bmw-f82-m4': {
        idleFrequency: 34,
        lowFrequency: 58,
        highFrequency: 99,
        idleGain: 0.22,
        lowGain: 0.21,
        highGain: 0.15,
        driveMultiplier: 1.06,
        waveformIdle: 'triangle',
        waveformLow: 'sawtooth',
        waveformHigh: 'square',
    },
    'toyota-crown-platinum': {
        idleFrequency: 25,
        lowFrequency: 40,
        highFrequency: 70,
        idleGain: 0.3,
        lowGain: 0.16,
        highGain: 0.08,
        driveMultiplier: 0.85,
        waveformIdle: 'triangle',
        waveformLow: 'sine',
        waveformHigh: 'triangle',
    },
};

export default class RaceEngineAudio {
    context: AudioContext | null;
    initialized: boolean;
    raceActive: boolean;
    paused: boolean;
    muted: boolean;
    masterVolume: number;
    currentCarId: string;
    lastGear: number;
    masterGain: GainNode | null;
    engineGain: GainNode | null;
    idleGain: GainNode | null;
    lowGain: GainNode | null;
    highGain: GainNode | null;
    idleOsc: OscillatorNode | null;
    lowOsc: OscillatorNode | null;
    highOsc: OscillatorNode | null;
    unlockHandler: () => void;

    constructor() {
        this.context = null;
        this.initialized = false;
        this.raceActive = false;
        this.paused = false;
        this.muted = false;
        this.masterVolume = 1;
        this.currentCarId = 'amg-one';
        this.lastGear = 1;

        this.masterGain = null;
        this.engineGain = null;
        this.idleGain = null;
        this.lowGain = null;
        this.highGain = null;
        this.idleOsc = null;
        this.lowOsc = null;
        this.highOsc = null;

        this.unlockHandler = () => {
            this.ensureContext();
            if (this.context && this.context.state === 'suspended') {
                this.context.resume();
            }
        };

        document.addEventListener('mousedown', this.unlockHandler, {
            passive: true,
        });
        document.addEventListener('keydown', this.unlockHandler, {
            passive: true,
        });

        UIEventBus.on('muteToggle', (muted: boolean) => {
            this.muted = Boolean(muted);
            this.applyMasterMix();
        });

        UIEventBus.on(
            'masterVolumeChange',
            (payload: { volume?: number } | undefined) => {
                const volume = payload?.volume;
                this.masterVolume =
                    typeof volume === 'number'
                        ? Math.min(1, Math.max(0, volume))
                        : this.masterVolume;
                this.applyMasterMix();
            }
        );

        UIEventBus.on(
            'race:gearShift',
            (payload: { gear?: number; carId?: string } | undefined) => {
                if (payload?.carId) {
                    this.currentCarId = payload.carId;
                }
                if (typeof payload?.gear === 'number') {
                    this.triggerShiftTransient(payload.gear);
                    this.lastGear = payload.gear;
                }
            }
        );
    }

    ensureContext() {
        if (this.initialized) return;

        const AudioContextRef =
            // @ts-ignore
            window.AudioContext || window.webkitAudioContext;
        if (!AudioContextRef) return;

        this.context = new AudioContextRef();

        this.masterGain = this.context.createGain();
        this.engineGain = this.context.createGain();
        this.idleGain = this.context.createGain();
        this.lowGain = this.context.createGain();
        this.highGain = this.context.createGain();

        this.masterGain.gain.value = 0;
        this.engineGain.gain.value = 0;
        this.idleGain.gain.value = 0;
        this.lowGain.gain.value = 0;
        this.highGain.gain.value = 0;

        this.idleOsc = this.context.createOscillator();
        this.lowOsc = this.context.createOscillator();
        this.highOsc = this.context.createOscillator();

        this.idleOsc.connect(this.idleGain);
        this.lowOsc.connect(this.lowGain);
        this.highOsc.connect(this.highGain);

        this.idleGain.connect(this.engineGain);
        this.lowGain.connect(this.engineGain);
        this.highGain.connect(this.engineGain);
        this.engineGain.connect(this.masterGain);
        this.masterGain.connect(this.context.destination);

        const profile = this.getProfile(this.currentCarId);
        this.idleOsc.type = profile.waveformIdle;
        this.lowOsc.type = profile.waveformLow;
        this.highOsc.type = profile.waveformHigh;
        this.idleOsc.frequency.value = profile.idleFrequency;
        this.lowOsc.frequency.value = profile.lowFrequency;
        this.highOsc.frequency.value = profile.highFrequency;

        this.idleOsc.start();
        this.lowOsc.start();
        this.highOsc.start();

        this.initialized = true;
        this.applyMasterMix();
    }

    getProfile(carId: string) {
        return CAR_PROFILES[carId] || DEFAULT_PROFILE;
    }

    setRaceActive(active: boolean) {
        this.raceActive = active;
        this.applyMasterMix();
    }

    setPaused(paused: boolean) {
        this.paused = paused;
        this.applyMasterMix();
    }

    applyMasterMix() {
        if (!this.context || !this.masterGain || !this.engineGain) return;

        const now = this.context.currentTime;
        const masterTarget = this.muted ? 0 : this.masterVolume;
        const engineTarget = this.raceActive && !this.paused ? 1 : 0;

        this.masterGain.gain.cancelScheduledValues(now);
        this.masterGain.gain.setTargetAtTime(masterTarget, now, 0.03);

        this.engineGain.gain.cancelScheduledValues(now);
        this.engineGain.gain.setTargetAtTime(engineTarget, now, 0.08);
    }

    triggerShiftTransient(nextGear: number) {
        if (!this.context || !this.raceActive || this.paused) return;
        if (nextGear === this.lastGear) return;

        const now = this.context.currentTime;
        const osc = this.context.createOscillator();
        const gain = this.context.createGain();
        const filter = this.context.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 1400;
        filter.Q.value = 5;

        osc.type = 'square';
        osc.frequency.setValueAtTime(240, now);
        osc.frequency.exponentialRampToValueAtTime(80, now + 0.11);

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.11, now + 0.018);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.engineGain as GainNode);
        osc.start(now);
        osc.stop(now + 0.16);
    }

    update(telemetry: EngineTelemetry, deltaSeconds: number) {
        this.ensureContext();
        if (!this.context || !this.initialized) return;
        if (this.context.state === 'suspended' && this.raceActive) {
            this.context.resume();
        }

        this.currentCarId = telemetry.carId || this.currentCarId;
        const profile = this.getProfile(this.currentCarId);

        if (!this.idleOsc || !this.lowOsc || !this.highOsc) return;
        if (!this.idleGain || !this.lowGain || !this.highGain) return;

        const rpm = Math.max(900, Math.min(8000, telemetry.rpm || 900));
        const rpmNormalized = (rpm - 900) / (7600 - 900);
        const clamped = Math.min(1, Math.max(0, rpmNormalized));
        const throttle = Math.min(1, Math.max(0, telemetry.throttle || 0));

        this.idleOsc.type = profile.waveformIdle;
        this.lowOsc.type = profile.waveformLow;
        this.highOsc.type = profile.waveformHigh;

        const now = this.context.currentTime;
        const smoothing = Math.min(0.08, Math.max(0.02, deltaSeconds * 0.35));

        const idleFrequency =
            profile.idleFrequency +
            clamped * 28 * profile.driveMultiplier +
            throttle * 6;
        const lowFrequency =
            profile.lowFrequency +
            clamped * 95 * profile.driveMultiplier +
            throttle * 18;
        const highFrequency =
            profile.highFrequency +
            clamped * 220 * profile.driveMultiplier +
            throttle * 35;

        this.idleOsc.frequency.setTargetAtTime(idleFrequency, now, smoothing);
        this.lowOsc.frequency.setTargetAtTime(lowFrequency, now, smoothing);
        this.highOsc.frequency.setTargetAtTime(highFrequency, now, smoothing);

        const idleTarget = profile.idleGain * (1 - clamped * 0.82);
        const lowTarget =
            profile.lowGain * Math.min(1, clamped * 1.55 + throttle * 0.22);
        const highTarget =
            profile.highGain * Math.max(0, (clamped - 0.18) * 1.25 + throttle * 0.3);

        this.idleGain.gain.setTargetAtTime(idleTarget, now, smoothing);
        this.lowGain.gain.setTargetAtTime(lowTarget, now, smoothing);
        this.highGain.gain.setTargetAtTime(highTarget, now, smoothing);
    }
}

