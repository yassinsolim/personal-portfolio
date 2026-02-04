import UIEventBus from '../../UI/EventBus';

type EngineTelemetry = {
    rpm: number;
    throttle: number;
    speedMps: number;
    carId: string;
    gear: number;
    slipRatio: number;
    driftIntensity: number;
    drivetrain: 'RWD' | 'AWD' | 'FWD';
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
    idleFrequency: 26,
    lowFrequency: 42,
    highFrequency: 76,
    idleGain: 0.14,
    lowGain: 0.16,
    highGain: 0.085,
    driveMultiplier: 1,
    waveformIdle: 'sine',
    waveformLow: 'triangle',
    waveformHigh: 'sine',
};

const CAR_PROFILES: Record<string, CarAudioProfile> = {
    'amg-one': {
        idleFrequency: 29,
        lowFrequency: 53,
        highFrequency: 90,
        idleGain: 0.11,
        lowGain: 0.185,
        highGain: 0.12,
        driveMultiplier: 1.12,
        waveformIdle: 'sine',
        waveformLow: 'triangle',
        waveformHigh: 'sine',
    },
    'bmw-e92-m3': {
        idleFrequency: 26,
        lowFrequency: 43,
        highFrequency: 78,
        idleGain: 0.18,
        lowGain: 0.17,
        highGain: 0.082,
        driveMultiplier: 0.96,
        waveformIdle: 'sine',
        waveformLow: 'triangle',
        waveformHigh: 'sine',
    },
    'amg-c63-507': {
        idleFrequency: 24,
        lowFrequency: 40,
        highFrequency: 70,
        idleGain: 0.2,
        lowGain: 0.145,
        highGain: 0.076,
        driveMultiplier: 0.9,
        waveformIdle: 'sine',
        waveformLow: 'triangle',
        waveformHigh: 'sine',
    },
    'amg-c63s-coupe': {
        idleFrequency: 25,
        lowFrequency: 44,
        highFrequency: 76,
        idleGain: 0.175,
        lowGain: 0.17,
        highGain: 0.092,
        driveMultiplier: 0.94,
        waveformIdle: 'sine',
        waveformLow: 'triangle',
        waveformHigh: 'sine',
    },
    'bmw-f82-m4': {
        idleFrequency: 27,
        lowFrequency: 47,
        highFrequency: 81,
        idleGain: 0.16,
        lowGain: 0.165,
        highGain: 0.097,
        driveMultiplier: 1.02,
        waveformIdle: 'sine',
        waveformLow: 'triangle',
        waveformHigh: 'sine',
    },
    'toyota-crown-platinum': {
        idleFrequency: 22,
        lowFrequency: 36,
        highFrequency: 62,
        idleGain: 0.2,
        lowGain: 0.12,
        highGain: 0.056,
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
    effectsGain: GainNode | null;
    idleGain: GainNode | null;
    lowGain: GainNode | null;
    highGain: GainNode | null;
    windGain: GainNode | null;
    roadGain: GainNode | null;
    tireGain: GainNode | null;
    idleOsc: OscillatorNode | null;
    lowOsc: OscillatorNode | null;
    highOsc: OscillatorNode | null;
    windNoise: AudioBufferSourceNode | null;
    roadNoise: AudioBufferSourceNode | null;
    tireNoise: AudioBufferSourceNode | null;
    idleFilter: BiquadFilterNode | null;
    lowFilter: BiquadFilterNode | null;
    highFilter: BiquadFilterNode | null;
    windFilter: BiquadFilterNode | null;
    roadFilter: BiquadFilterNode | null;
    tireFilter: BiquadFilterNode | null;
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
        this.effectsGain = null;
        this.idleGain = null;
        this.lowGain = null;
        this.highGain = null;
        this.windGain = null;
        this.roadGain = null;
        this.tireGain = null;
        this.idleOsc = null;
        this.lowOsc = null;
        this.highOsc = null;
        this.windNoise = null;
        this.roadNoise = null;
        this.tireNoise = null;
        this.idleFilter = null;
        this.lowFilter = null;
        this.highFilter = null;
        this.windFilter = null;
        this.roadFilter = null;
        this.tireFilter = null;
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

    createNoiseSource() {
        if (!this.context) return null;

        const buffer = this.context.createBuffer(1, this.context.sampleRate * 2, this.context.sampleRate);
        const channel = buffer.getChannelData(0);
        for (let i = 0; i < channel.length; i++) {
            channel[i] = (Math.random() * 2 - 1) * 0.7;
        }

        const source = this.context.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        return source;
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
        this.effectsGain = this.context.createGain();
        this.idleGain = this.context.createGain();
        this.lowGain = this.context.createGain();
        this.highGain = this.context.createGain();
        this.windGain = this.context.createGain();
        this.roadGain = this.context.createGain();
        this.tireGain = this.context.createGain();

        this.idleFilter = this.context.createBiquadFilter();
        this.lowFilter = this.context.createBiquadFilter();
        this.highFilter = this.context.createBiquadFilter();
        this.windFilter = this.context.createBiquadFilter();
        this.roadFilter = this.context.createBiquadFilter();
        this.tireFilter = this.context.createBiquadFilter();
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
        this.highFilter.Q.value = 0.38;

        this.windFilter.type = 'highpass';
        this.windFilter.frequency.value = 650;
        this.windFilter.Q.value = 0.3;

        this.roadFilter.type = 'bandpass';
        this.roadFilter.frequency.value = 170;
        this.roadFilter.Q.value = 0.95;

        this.tireFilter.type = 'bandpass';
        this.tireFilter.frequency.value = 1600;
        this.tireFilter.Q.value = 2.8;

        this.compressor.threshold.value = -24;
        this.compressor.knee.value = 20;
        this.compressor.ratio.value = 2.1;
        this.compressor.attack.value = 0.012;
        this.compressor.release.value = 0.2;

        this.finalLowPass.type = 'lowpass';
        this.finalLowPass.frequency.value = 5400;
        this.finalLowPass.Q.value = 0.42;

        this.masterGain.gain.value = 0;
        this.engineGain.gain.value = 0;
        this.effectsGain.gain.value = 0;
        this.idleGain.gain.value = 0;
        this.lowGain.gain.value = 0;
        this.highGain.gain.value = 0;
        this.windGain.gain.value = 0;
        this.roadGain.gain.value = 0;
        this.tireGain.gain.value = 0;

        this.idleOsc = this.context.createOscillator();
        this.lowOsc = this.context.createOscillator();
        this.highOsc = this.context.createOscillator();
        this.windNoise = this.createNoiseSource();
        this.roadNoise = this.createNoiseSource();
        this.tireNoise = this.createNoiseSource();

        this.idleOsc.connect(this.idleFilter);
        this.lowOsc.connect(this.lowFilter);
        this.highOsc.connect(this.highFilter);

        this.idleFilter.connect(this.idleGain);
        this.lowFilter.connect(this.lowGain);
        this.highFilter.connect(this.highGain);

        this.idleGain.connect(this.engineGain);
        this.lowGain.connect(this.engineGain);
        this.highGain.connect(this.engineGain);

        if (this.windNoise && this.windFilter && this.windGain) {
            this.windNoise.connect(this.windFilter);
            this.windFilter.connect(this.windGain);
            this.windGain.connect(this.effectsGain);
        }
        if (this.roadNoise && this.roadFilter && this.roadGain) {
            this.roadNoise.connect(this.roadFilter);
            this.roadFilter.connect(this.roadGain);
            this.roadGain.connect(this.effectsGain);
        }
        if (this.tireNoise && this.tireFilter && this.tireGain) {
            this.tireNoise.connect(this.tireFilter);
            this.tireFilter.connect(this.tireGain);
            this.tireGain.connect(this.effectsGain);
        }

        this.engineGain.connect(this.compressor);
        this.effectsGain.connect(this.compressor);
        this.compressor.connect(this.finalLowPass);
        this.finalLowPass.connect(this.masterGain);
        this.masterGain.connect(this.context.destination);

        this.applyProfile(this.currentCarId);

        this.idleOsc.start();
        this.lowOsc.start();
        this.highOsc.start();
        this.windNoise?.start();
        this.roadNoise?.start();
        this.tireNoise?.start();

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
        if (!this.context || !this.masterGain || !this.engineGain || !this.effectsGain) return;

        const now = this.context.currentTime;
        const masterTarget = this.muted ? 0 : this.masterVolume;
        const engineTarget = this.raceActive && !this.paused ? 0.82 : 0;
        const effectsTarget = this.raceActive && !this.paused ? 0.72 : 0;

        this.masterGain.gain.cancelScheduledValues(now);
        this.masterGain.gain.setTargetAtTime(masterTarget, now, 0.06);

        this.engineGain.gain.cancelScheduledValues(now);
        this.engineGain.gain.setTargetAtTime(engineTarget, now, 0.11);

        this.effectsGain.gain.cancelScheduledValues(now);
        this.effectsGain.gain.setTargetAtTime(effectsTarget, now, 0.12);
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
        filter.frequency.value = nextGear > this.lastGear ? 920 : 760;
        filter.Q.value = 2.6;

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(nextGear > this.lastGear ? 270 : 220, now);
        osc.frequency.exponentialRampToValueAtTime(120, now + 0.18);

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.022, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.engineGain);
        osc.start(now);
        osc.stop(now + 0.26);
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

        const rpm = Math.max(900, Math.min(11000, telemetry.rpm || 900));
        const rpmNormalized = (rpm - 900) / (9000 - 900);
        const rpmClamped = Math.min(1, Math.max(0, rpmNormalized));
        const throttle = Math.min(1, Math.max(0, telemetry.throttle || 0));
        const speed = Math.max(0, Math.abs(telemetry.speedMps || 0));
        const speedNorm = Math.min(1, speed / 88);
        const slipRatio = Math.min(1, Math.max(0, telemetry.slipRatio || 0));
        const driftIntensity = Math.min(
            1,
            Math.max(0, telemetry.driftIntensity || 0)
        );

        const now = this.context.currentTime;
        const smoothing = Math.min(0.12, Math.max(0.035, deltaSeconds * 0.66));
        const fundamentalHz = (rpm / 60) * profile.driveMultiplier;

        const idleFrequency = profile.idleFrequency + fundamentalHz * 0.34;
        const lowFrequency = profile.lowFrequency + fundamentalHz * 0.81;
        const highFrequency = profile.highFrequency + fundamentalHz * 1.42;

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

        const idleTarget = profile.idleGain * idleFadeOut * (0.92 - throttle * 0.2);
        const lowTarget =
            profile.lowGain *
            lowFadeIn *
            (1 - highFadeIn * 0.52) *
            (0.52 + throttle * 0.72);
        const highTarget =
            profile.highGain * highFadeIn * (0.17 + throttle * 0.9);

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
            160 + rpmClamped * 220 + throttle * 120,
            now,
            smoothing
        );
        this.lowFilter.frequency.setTargetAtTime(
            340 + rpmClamped * 760 + throttle * 180,
            now,
            smoothing
        );
        this.highFilter.frequency.setTargetAtTime(
            760 + rpmClamped * 2200 + throttle * 420,
            now,
            smoothing
        );

        this.finalLowPass.frequency.setTargetAtTime(
            3800 + rpmClamped * 2000 + throttle * 560,
            now,
            0.1
        );

        if (
            this.windGain &&
            this.roadGain &&
            this.tireGain &&
            this.windFilter &&
            this.roadFilter &&
            this.tireFilter
        ) {
            const roadTarget = (0.015 + speedNorm * 0.09) * (0.4 + throttle * 0.7);
            const windTarget = Math.max(0, speedNorm - 0.18) * 0.16;
            const drivetrainTireScale = telemetry.drivetrain === 'RWD' ? 1 : 0.85;
            const tireTarget =
                Math.max(0, slipRatio - 0.14) * 0.32 * drivetrainTireScale +
                driftIntensity * 0.25;

            this.roadGain.gain.setTargetAtTime(roadTarget, now, 0.08);
            this.windGain.gain.setTargetAtTime(windTarget, now, 0.12);
            this.tireGain.gain.setTargetAtTime(tireTarget, now, 0.04);

            this.windFilter.frequency.setTargetAtTime(
                560 + speedNorm * 2400,
                now,
                0.1
            );
            this.roadFilter.frequency.setTargetAtTime(
                120 + speedNorm * 380,
                now,
                0.09
            );
            this.tireFilter.frequency.setTargetAtTime(
                1200 + slipRatio * 1800 + driftIntensity * 500,
                now,
                0.04
            );
        }
    }
}
