import * as THREE from 'three';
import AudioManager from './AudioManager';

const DEFAULT_REF_DISTANCE = 14000;
const MIN_DETUNE = -250;
const MAX_DETUNE = 1250;

export default class EngineAudio {
    manager: AudioManager;
    low: THREE.PositionalAudio | null;
    high: THREE.PositionalAudio | null;
    attached: boolean;
    lowName: string;
    highName: string;
    target: THREE.Object3D | null;
    active: boolean;

    constructor(manager: AudioManager, lowName: string, highName: string) {
        this.manager = manager;
        this.low = null;
        this.high = null;
        this.attached = false;
        this.lowName = lowName;
        this.highName = highName;
        this.target = null;
        this.active = false;

        this.setupAudio();
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

        this.high = new THREE.PositionalAudio(this.manager.listener);
        this.high.setBuffer(highBuffer);
        this.high.setLoop(true);
        this.high.setVolume(0);
        this.high.setRefDistance(DEFAULT_REF_DISTANCE);
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
        if (!this.low || !this.high) return;
        this.active = false;
        if (this.low.isPlaying) this.low.stop();
        if (this.high.isPlaying) this.high.stop();
    }

    detach() {
        if (this.target) {
            if (this.low) this.target.remove(this.low);
            if (this.high) this.target.remove(this.high);
        }
        this.attached = false;
        this.target = null;
    }

    setSoundSet(lowName: string, highName: string) {
        if (lowName === this.lowName && highName === this.highName) return;
        const previousTarget = this.target;
        const wasActive = this.active;
        this.stop();
        this.detach();
        this.lowName = lowName;
        this.highName = highName;
        this.setupAudio();
        if (previousTarget && this.low && this.high) {
            this.attachTo(previousTarget);
            if (wasActive) {
                this.start();
            }
        }
    }

    update(rpm: number, throttle: number) {
        if (!this.low || !this.high) return;

        const rpmClamped = Math.min(Math.max(rpm, 0), 9000);
        const rpmNorm = THREE.MathUtils.clamp(rpmClamped / 7000, 0, 1);
        const throttleBoost = THREE.MathUtils.clamp(throttle, 0, 1);

        const lowVolume =
            (1 - rpmNorm) * 0.8 + 0.1 + throttleBoost * 0.15;
        const highVolume = rpmNorm * 0.9 + throttleBoost * 0.2;

        this.low.setVolume(THREE.MathUtils.clamp(lowVolume, 0, 1));
        this.high.setVolume(THREE.MathUtils.clamp(highVolume, 0, 1));

        const detune = THREE.MathUtils.lerp(MIN_DETUNE, MAX_DETUNE, rpmNorm);
        this.low.setDetune(detune);
        this.high.setDetune(detune + 120);
    }
}
