import * as THREE from 'three';
import AudioManager from './AudioManager';
import type { EngineAudioProfile } from '../carOptions';

const DEFAULT_REF_DISTANCE = 14000;
type ShiftProfile = {
    duration: number;
    detune: number;
    volumeCut?: number;
    volumeBoost?: number;
    transientVolume: number;
};

type ResolvedProfile = {
    rpmMax: number;
    rpmCurve: number;
    minDetune: number;
    maxDetune: number;
    highDetuneOffset: number;
    lowVolume: number;
    highVolume: number;
    idleVolume: number;
    throttleBoost: number;
    lowpass: number;
    highpass: number;
    shiftUp: ShiftProfile;
    shiftDown: ShiftProfile;
};

const DEFAULT_PROFILE: ResolvedProfile = {
    rpmMax: 7200,
    rpmCurve: 1.05,
    minDetune: -260,
    maxDetune: 1300,
    highDetuneOffset: 120,
    lowVolume: 0.85,
    highVolume: 0.95,
    idleVolume: 0.1,
    throttleBoost: 0.18,
    lowpass: 20000,
    highpass: 20,
    shiftUp: {
        duration: 0.18,
        detune: -260,
        volumeCut: 0.5,
        transientVolume: 0.16,
    },
    shiftDown: {
        duration: 0.14,
        detune: 220,
        volumeBoost: 0.2,
        transientVolume: 0.12,
    },
};

export default class EngineAudio {
    manager: AudioManager;
    low: THREE.PositionalAudio | null;
    high: THREE.PositionalAudio | null;
    attached: boolean;
    lowName: string;
    highName: string;
    target: THREE.Object3D | null;
    active: boolean;
    profile: ResolvedProfile;
    shiftTimer: number;
    shiftDuration: number;
    shiftDetune: number;
    shiftVolumeMul: number;
    shiftTransientVolume: number;
    shiftAudio: THREE.PositionalAudio | null;
    shiftBufferUp: AudioBuffer | null;
    shiftBufferDown: AudioBuffer | null;

    constructor(
        manager: AudioManager,
        lowName: string,
        highName: string,
        profile?: EngineAudioProfile
    ) {
        this.manager = manager;
        this.low = null;
        this.high = null;
        this.attached = false;
        this.lowName = lowName;
        this.highName = highName;
        this.target = null;
        this.active = false;
        this.profile = this.resolveProfile(profile);
        this.shiftTimer = 0;
        this.shiftDuration = 0;
        this.shiftDetune = 0;
        this.shiftVolumeMul = 1;
        this.shiftTransientVolume = 0;
        this.shiftAudio = null;
        this.shiftBufferUp = null;
        this.shiftBufferDown = null;

        this.setupAudio();
    }

    resolveProfile(profile?: EngineAudioProfile): ResolvedProfile {
        const shiftUp = {
            ...DEFAULT_PROFILE.shiftUp,
            ...(profile?.shiftUp || {}),
        };
        const shiftDown = {
            ...DEFAULT_PROFILE.shiftDown,
            ...(profile?.shiftDown || {}),
        };
        return {
            ...DEFAULT_PROFILE,
            ...(profile || {}),
            shiftUp,
            shiftDown,
        };
    }

    applyFilters(
        audio: THREE.PositionalAudio,
        profile: ResolvedProfile
    ) {
        const filters: AudioNode[] = [];
        const context = audio.context;
        if (profile.highpass && profile.highpass > 0) {
            const highpass = context.createBiquadFilter();
            highpass.type = 'highpass';
            highpass.frequency.setValueAtTime(
                profile.highpass,
                context.currentTime
            );
            filters.push(highpass);
        }
        if (profile.lowpass && profile.lowpass < 22050) {
            const lowpass = context.createBiquadFilter();
            lowpass.type = 'lowpass';
            lowpass.frequency.setValueAtTime(
                profile.lowpass,
                context.currentTime
            );
            filters.push(lowpass);
        }
        if (filters.length) {
            audio.setFilters(filters);
        }
    }

    ensureShiftAudio() {
        if (!this.manager.context) return;
        if (!this.shiftAudio) {
            this.shiftAudio = new THREE.PositionalAudio(this.manager.listener);
            this.shiftAudio.setLoop(false);
            this.shiftAudio.setVolume(0);
            this.shiftAudio.setRefDistance(DEFAULT_REF_DISTANCE);
            if (this.target) {
                this.target.add(this.shiftAudio);
            }
        }
        if (!this.shiftBufferUp) {
            this.shiftBufferUp = this.createTransientBuffer(
                this.manager.context,
                0.08
            );
        }
        if (!this.shiftBufferDown) {
            this.shiftBufferDown = this.createTransientBuffer(
                this.manager.context,
                0.06
            );
        }
    }

    createTransientBuffer(context: AudioContext, duration: number) {
        const sampleRate = context.sampleRate;
        const length = Math.floor(sampleRate * duration);
        const buffer = context.createBuffer(1, length, sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < length; i++) {
            const t = i / length;
            const envelope = 1 - t;
            data[i] = (Math.random() * 2 - 1) * envelope * 0.6;
        }
        return buffer;
    }

    setupAudio() {
        const lowBuffer = this.manager.loadedAudio[this.lowName];
        const highBuffer = this.manager.loadedAudio[this.highName];
        if (!lowBuffer || !highBuffer) return;

        this.low = new THREE.PositionalAudio(this.manager.listener);
        this.low.setBuffer(lowBuffer);
        this.low.setLoop(true);
        this.low.setVolume(0);
        this.low.setRefDistance(DEFAULT_REF_DISTANCE);
        this.applyFilters(this.low, this.profile);

        this.high = new THREE.PositionalAudio(this.manager.listener);
        this.high.setBuffer(highBuffer);
        this.high.setLoop(true);
        this.high.setVolume(0);
        this.high.setRefDistance(DEFAULT_REF_DISTANCE);
        this.applyFilters(this.high, this.profile);
    }

    attachTo(target: THREE.Object3D) {
        if (!this.low || !this.high) return;
        if (this.target && this.target !== target) {
            this.detach();
        }
        this.target = target;
        if (!this.attached && this.target) {
            this.target.add(this.low);
            this.target.add(this.high);
            if (this.shiftAudio) {
                this.target.add(this.shiftAudio);
            }
            this.attached = true;
        }
    }

    start() {
        if (!this.low || !this.high) return;
        this.active = true;
        if (this.manager.context) {
            this.manager.context.resume();
        }
        if (!this.low.isPlaying) this.low.play();
        if (!this.high.isPlaying) this.high.play();
    }

    stop() {
        this.active = false;
        if (this.shiftAudio && this.shiftAudio.isPlaying) {
            this.shiftAudio.stop();
        }
        if (!this.low || !this.high) return;
        if (this.low.isPlaying) this.low.stop();
        if (this.high.isPlaying) this.high.stop();
    }

    detach() {
        if (this.target) {
            if (this.low) this.target.remove(this.low);
            if (this.high) this.target.remove(this.high);
            if (this.shiftAudio) this.target.remove(this.shiftAudio);
        }
        this.attached = false;
        this.target = null;
    }

    setSoundSet(
        lowName: string,
        highName: string,
        profile?: EngineAudioProfile
    ) {
        if (
            lowName === this.lowName &&
            highName === this.highName &&
            !profile
        ) {
            return;
        }
        const previousTarget = this.target;
        const wasActive = this.active;
        this.stop();
        this.detach();
        this.lowName = lowName;
        this.highName = highName;
        if (profile) {
            this.profile = this.resolveProfile(profile);
        }
        this.setupAudio();
        if (previousTarget && this.low && this.high) {
            this.attachTo(previousTarget);
            if (wasActive) {
                this.start();
            }
        }
    }

    setProfile(profile?: EngineAudioProfile) {
        if (!profile) return;
        this.profile = this.resolveProfile(profile);
        if (this.low) this.applyFilters(this.low, this.profile);
        if (this.high) this.applyFilters(this.high, this.profile);
    }

    onShift(direction: 'up' | 'down') {
        const shiftProfile =
            direction === 'up' ? this.profile.shiftUp : this.profile.shiftDown;
        this.shiftDuration = shiftProfile.duration;
        this.shiftTimer = 0;
        this.shiftDetune = shiftProfile.detune;
        this.shiftVolumeMul =
            direction === 'up'
                ? shiftProfile.volumeCut ?? 1
                : 1 + (shiftProfile.volumeBoost ?? 0);
        this.shiftTransientVolume = shiftProfile.transientVolume;

        this.ensureShiftAudio();
        if (
            this.shiftAudio &&
            this.manager.context &&
            this.shiftBufferUp &&
            this.shiftBufferDown
        ) {
            const buffer =
                direction === 'up' ? this.shiftBufferUp : this.shiftBufferDown;
            this.shiftAudio.setBuffer(buffer);
            this.shiftAudio.setVolume(this.shiftTransientVolume);
            if (this.shiftAudio.isPlaying) {
                this.shiftAudio.stop();
            }
            this.shiftAudio.play();
        }
    }

    update(rpm: number, throttle: number, dt: number) {
        if (!this.low || !this.high) return;

        const rpmClamped = Math.min(
            Math.max(rpm, 0),
            this.profile.rpmMax
        );
        const rpmNormBase = THREE.MathUtils.clamp(
            rpmClamped / this.profile.rpmMax,
            0,
            1
        );
        const rpmNorm = Math.pow(rpmNormBase, this.profile.rpmCurve);
        const throttleBoost = THREE.MathUtils.clamp(throttle, 0, 1);

        let lowVolume =
            (1 - rpmNorm) * this.profile.lowVolume +
            this.profile.idleVolume +
            throttleBoost * this.profile.throttleBoost;
        let highVolume =
            rpmNorm * this.profile.highVolume +
            throttleBoost * this.profile.throttleBoost;

        let detune = THREE.MathUtils.lerp(
            this.profile.minDetune,
            this.profile.maxDetune,
            rpmNorm
        );

        if (this.shiftTimer < this.shiftDuration) {
            const shiftBlend = 1 - this.shiftTimer / this.shiftDuration;
            detune += this.shiftDetune * shiftBlend;
            const volumeMul = THREE.MathUtils.lerp(
                1,
                this.shiftVolumeMul,
                shiftBlend
            );
            lowVolume *= volumeMul;
            highVolume *= volumeMul;
            this.shiftTimer += dt;
        }

        this.low.setVolume(THREE.MathUtils.clamp(lowVolume, 0, 1));
        this.high.setVolume(THREE.MathUtils.clamp(highVolume, 0, 1));

        this.low.setDetune(detune);
        this.high.setDetune(detune + this.profile.highDetuneOffset);
    }
}
