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
    idleFrequency: 28,
    lowFrequency: 46,
    highFrequency: 82,
    idleGain: 0.16,
    lowGain: 0.18,
    highGain: 0.11,
    driveMultiplier: 1,
    waveformIdle: 'sine',
    waveformLow: 'triangle',
    waveformHigh: 'triangle',
};

const CAR_PROFILES: Record<string, CarAudioProfile> = {
    'amg-one': {
        idleFrequency: 31,
        lowFrequency: 55,
        highFrequency: 95,
        idleGain: 0.13,
        lowGain: 0.2,
        highGain: 0.15,
        driveMultiplier: 1.12,
        waveformIdle: 'triangle',
        waveformLow: 'sawtooth',
        waveformHigh: 'triangle',
    },
    'bmw-e92-m3': {
        idleFrequency: 26,
        lowFrequency: 43,
        highFrequency: 78,
        idleGain: 0.18,
        lowGain: 0.17,
        highGain: 0.09,
        driveMultiplier: 0.96,
        waveformIdle: 'sine',
        waveformLow: 'triangle',
        waveformHigh: 'triangle',
    },
    'amg-c63-507': {
        idleFrequency: 24,
        lowFrequency: 40,
        highFrequency: 74,
        idleGain: 0.21,
        lowGain: 0.15,
        highGain: 0.08,
        driveMultiplier: 0.9,
        waveformIdle: 'triangle',
        waveformLow: 'sawtooth',
        waveformHigh: 'triangle',
    },
    'amg-c63s-coupe': {
        idleFrequency: 25,
        lowFrequency: 44,
        highFrequency: 80,
        idleGain: 0.19,
        lowGain: 0.18,
        highGain: 0.1,
        driveMultiplier: 0.94,
        waveformIdle: 'triangle',
        waveformLow: 'sawtooth',
        waveformHigh: 'triangle',
    },
    'bmw-f82-m4': {
        idleFrequency: 27,
        lowFrequency: 47,
        highFrequency: 84,
        idleGain: 0.17,
        lowGain: 0.18,
        highGain: 0.11,
        driveMultiplier: 1.02,
        waveformIdle: 'sine',
        waveformLow: 'triangle',
        waveformHigh: 'triangle',
    },
    'toyota-crown-platinum': {
        idleFrequency: 22,
        lowFrequency: 36,
        highFrequency: 65,
        idleGain: 0.22,
        lowGain: 0.13,
        highGain: 0.06,
        driveMultiplier: 0.78,
        waveformIdle: 'sine',
        waveformLow: 'triangle',
        waveformHigh: 'sine',
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
    appliedProfileCarId: string;
    lastGear: number;
    masterGain: GainNode | null;
    engineGain: GainNode | null;
    idleGain: GainNode | null;
    lowGain: GainNode | null;
    highGain: GainNode | null;
    idleOsc: OscillatorNode | null;
    lowOsc: OscillatorNode | null;
    highOsc: OscillatorNode | null;
    idleFilter: BiquadFilterNode | null;
    lowFilter: BiquadFilterNode | null;
    highFilter: BiquadFilterNode | null;
    compressor: DynamicsCompressorNode | null;
    finalLowPass: BiquadFilterNode | null;
    unlockHandler: () => void;

    constructor() {
        this.context = null;
        this.initialized = false;
        this.raceActive = false;
        this.paused = false;
        this.muted = false;
        this.masterVolume = 1;
        this.currentCarId = 'amg-one';
        this.appliedProfileCarId = '';
        this.lastGear = 1;

        this.masterGain = null;
        this.engineGain = null;
        this.idleGain = null;
        this.lowGain = null;
        this.highGain = null;
        this.idleOsc = null;
        this.lowOsc = null;
        this.highOsc = null;
        this.idleFilter = null;
        this.lowFilter = null;
        this.highFilter = null;
        this.compressor = null;
        this.finalLowPass = null;

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

        this.idleFilter = this.context.createBiquadFilter();
        this.lowFilter = this.context.createBiquadFilter();
        this.highFilter = this.context.createBiquadFilter();
        this.compressor = this.context.createDynamicsCompressor();
        this.finalLowPass = this.context.createBiquadFilter();

        this.idleFilter.type = 'lowpass';
        this.idleFilter.frequency.value = 240;
        this.idleFilter.Q.value = 0.45;

        this.lowFilter.type = 'bandpass';
        this.lowFilter.frequency.value = 520;
        this.lowFilter.Q.value = 0.72;

        this.highFilter.type = 'highpass';
        this.highFilter.frequency.value = 1100;
        this.highFilter.Q.value = 0.5;

        this.compressor.threshold.value = -22;
        this.compressor.knee.value = 18;
        this.compressor.ratio.value = 2.3;
        this.compressor.attack.value = 0.008;
        this.compressor.release.value = 0.17;

        this.finalLowPass.type = 'lowpass';
        this.finalLowPass.frequency.value = 6000;
        this.finalLowPass.Q.value = 0.45;

        this.masterGain.gain.value = 0;
        this.engineGain.gain.value = 0;
        this.idleGain.gain.value = 0;
        this.lowGain.gain.value = 0;
        this.highGain.gain.value = 0;

        this.idleOsc = this.context.createOscillator();
        this.lowOsc = this.context.createOscillator();
        this.highOsc = this.context.createOscillator();

        this.idleOsc.connect(this.idleFilter);
        this.lowOsc.connect(this.lowFilter);
        this.highOsc.connect(this.highFilter);

        this.idleFilter.connect(this.idleGain);
        this.lowFilter.connect(this.lowGain);
        this.highFilter.connect(this.highGain);

        this.idleGain.connect(this.engineGain);
        this.lowGain.connect(this.engineGain);
        this.highGain.connect(this.engineGain);

        this.engineGain.connect(this.compressor);
        this.compressor.connect(this.finalLowPass);
        this.finalLowPass.connect(this.masterGain);
        this.masterGain.connect(this.context.destination);

        this.applyProfile(this.currentCarId);

        this.idleOsc.start();
        this.lowOsc.start();
        this.highOsc.start();

        this.initialized = true;
        this.applyMasterMix();
    }

    getProfile(carId: string) {
        return CAR_PROFILES[carId] || DEFAULT_PROFILE;
    }

    applyProfile(carId: string) {
        if (!this.idleOsc || !this.lowOsc || !this.highOsc) return;
        if (this.appliedProfileCarId === carId) return;

        const profile = this.getProfile(carId);
        this.idleOsc.type = profile.waveformIdle;
        this.lowOsc.type = profile.waveformLow;
        this.highOsc.type = profile.waveformHigh;

        this.idleOsc.frequency.value = profile.idleFrequency;
        this.lowOsc.frequency.value = profile.lowFrequency;
        this.highOsc.frequency.value = profile.highFrequency;

        this.appliedProfileCarId = carId;
    }

    smoothStep(edge0: number, edge1: number, value: number) {
        const t = Math.min(
            1,
            Math.max(0, (value - edge0) / Math.max(1e-6, edge1 - edge0))
        );
        return t * t * (3 - 2 * t);
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
        const engineTarget = this.raceActive && !this.paused ? 0.86 : 0;

        this.masterGain.gain.cancelScheduledValues(now);
        this.masterGain.gain.setTargetAtTime(masterTarget, now, 0.06);

        this.engineGain.gain.cancelScheduledValues(now);
        this.engineGain.gain.setTargetAtTime(engineTarget, now, 0.11);
    }

    triggerShiftTransient(nextGear: number) {
        if (!this.context || !this.raceActive || this.paused) return;
        if (nextGear === this.lastGear) return;
        if (!this.engineGain) return;

        const now = this.context.currentTime;
        const osc = this.context.createOscillator();
        const gain = this.context.createGain();
        const filter = this.context.createBiquadFilter();

        filter.type = 'bandpass';
        filter.frequency.value = nextGear > this.lastGear ? 1020 : 840;
        filter.Q.value = 3.2;

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(nextGear > this.lastGear ? 320 : 240, now);
        osc.frequency.exponentialRampToValueAtTime(140, now + 0.16);

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.028, now + 0.018);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.engineGain);
        osc.start(now);
        osc.stop(now + 0.22);
    }

    update(telemetry: EngineTelemetry, deltaSeconds: number) {
        this.ensureContext();
        if (!this.context || !this.initialized) return;
        if (
            this.context.state === 'suspended' &&
            this.raceActive &&
            !this.muted
        ) {
            this.context.resume();
        }

        this.currentCarId = telemetry.carId || this.currentCarId;
        this.applyProfile(this.currentCarId);
        const profile = this.getProfile(this.currentCarId);

        if (!this.idleOsc || !this.lowOsc || !this.highOsc) return;
        if (!this.idleGain || !this.lowGain || !this.highGain) return;
        if (!this.idleFilter || !this.lowFilter || !this.highFilter) return;
        if (!this.finalLowPass) return;

        const rpm = Math.max(900, Math.min(8000, telemetry.rpm || 900));
        const rpmNormalized = (rpm - 900) / (7600 - 900);
        const rpmClamped = Math.min(1, Math.max(0, rpmNormalized));
        const throttle = Math.min(1, Math.max(0, telemetry.throttle || 0));

        const now = this.context.currentTime;
        const smoothing = Math.min(0.14, Math.max(0.045, deltaSeconds * 0.72));
        const fundamentalHz = (rpm / 60) * profile.driveMultiplier;

        const idleFrequency = profile.idleFrequency + fundamentalHz * 0.38;
        const lowFrequency = profile.lowFrequency + fundamentalHz * 0.86;
        const highFrequency = profile.highFrequency + fundamentalHz * 1.62;

        this.idleOsc.frequency.setTargetAtTime(
            Math.max(18, idleFrequency),
            now,
            smoothing
        );
        this.lowOsc.frequency.setTargetAtTime(
            Math.max(24, lowFrequency),
            now,
            smoothing
        );
        this.highOsc.frequency.setTargetAtTime(
            Math.max(55, highFrequency),
            now,
            smoothing
        );

        const idleFadeOut = 1 - this.smoothStep(0.12, 0.62, rpmClamped);
        const lowFadeIn = this.smoothStep(0.06, 0.4, rpmClamped);
        const highFadeIn = this.smoothStep(0.46, 0.95, rpmClamped);

        const idleTarget = profile.idleGain * idleFadeOut * (0.95 - throttle * 0.22);
        const lowTarget =
            profile.lowGain *
            lowFadeIn *
            (1 - highFadeIn * 0.55) *
            (0.55 + throttle * 0.68);
        const highTarget =
            profile.highGain * highFadeIn * (0.2 + throttle * 0.94);

        this.idleGain.gain.setTargetAtTime(
            Math.max(0, idleTarget),
            now,
            smoothing
        );
        this.lowGain.gain.setTargetAtTime(
            Math.max(0, lowTarget),
            now,
            smoothing
        );
        this.highGain.gain.setTargetAtTime(
            Math.max(0, highTarget),
            now,
            smoothing
        );

        this.idleFilter.frequency.setTargetAtTime(
            180 + rpmClamped * 240 + throttle * 140,
            now,
            smoothing
        );
        this.lowFilter.frequency.setTargetAtTime(
            380 + rpmClamped * 820 + throttle * 140,
            now,
            smoothing
        );
        this.highFilter.frequency.setTargetAtTime(
            860 + rpmClamped * 2600 + throttle * 520,
            now,
            smoothing
        );

        this.finalLowPass.frequency.setTargetAtTime(
            4200 + rpmClamped * 2200 + throttle * 420,
            now,
            0.09
        );
    }
}

