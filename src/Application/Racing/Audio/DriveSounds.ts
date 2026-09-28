import type { AudioBankData, LoopMeta } from './AudioBank';
import { getNoiseBuffer } from './EngineVoice';

// everything around the engine for the player car: tire squeal and scrub
// from recorded skids, wind and road noise from filtered noise, and
// recorded impacts for hits and hard landings.

export type DriveInput = {
    speedMps: number;
    slip: number;
    drift: number;
    grounded: boolean;
    throttle: number;
    kerb?: boolean;
    grass?: boolean;
    // 0..1 while a side of the car rubs a barrier
    scrape?: number;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smooth = (a: number, b: number, v: number) => {
    const t = clamp((v - a) / Math.max(1e-6, b - a), 0, 1);
    return t * t * (3 - 2 * t);
};

type LoopNode = {
    source: AudioBufferSourceNode;
    gain: GainNode;
    base: number;
};

export default class DriveSounds {
    context: BaseAudioContext;
    output: GainNode;
    bank: AudioBankData | null;
    squeal: LoopNode[];
    scrub: LoopNode | null;
    scrubFilter: BiquadFilterNode | null;
    windSource: AudioBufferSourceNode;
    windFilter: BiquadFilterNode;
    windGain: GainNode;
    roadSource: AudioBufferSourceNode;
    roadFilter: BiquadFilterNode;
    roadGain: GainNode;
    kerbOsc: OscillatorNode;
    kerbGain: GainNode;
    grassGain: GainNode;
    scrapeFilter: BiquadFilterNode;
    scrapeGain: GainNode;
    lastImpactAt: number;
    time: number;
    random: () => number;

    constructor(context: BaseAudioContext, destination: AudioNode, random: () => number = Math.random) {
        this.context = context;
        this.random = random;
        this.output = context.createGain();
        this.output.connect(destination);
        this.bank = null;
        this.squeal = [];
        this.scrub = null;
        this.scrubFilter = null;
        this.lastImpactAt = -10;
        this.time = 0;

        const noise = getNoiseBuffer(context);
        this.windSource = context.createBufferSource();
        this.windSource.buffer = noise;
        this.windSource.loop = true;
        this.windFilter = context.createBiquadFilter();
        this.windFilter.type = 'bandpass';
        this.windFilter.frequency.value = 500;
        this.windFilter.Q.value = 0.5;
        this.windGain = context.createGain();
        this.windGain.gain.value = 0;
        this.windSource.connect(this.windFilter);
        this.windFilter.connect(this.windGain);
        this.windGain.connect(this.output);

        this.roadSource = context.createBufferSource();
        this.roadSource.buffer = noise;
        this.roadSource.loop = true;
        // a different offset keeps road and wind from sharing the same noise
        this.roadFilter = context.createBiquadFilter();
        this.roadFilter.type = 'lowpass';
        this.roadFilter.frequency.value = 180;
        this.roadFilter.Q.value = 0.8;
        this.roadGain = context.createGain();
        this.roadGain.gain.value = 0;
        this.roadSource.connect(this.roadFilter);
        this.roadFilter.connect(this.roadGain);
        this.roadGain.connect(this.output);

        // kerb rumble: the tires drum over the kerb blocks
        this.kerbOsc = context.createOscillator();
        this.kerbOsc.type = 'sawtooth';
        this.kerbOsc.frequency.value = 20;
        const kerbFilter = context.createBiquadFilter();
        kerbFilter.type = 'lowpass';
        kerbFilter.frequency.value = 260;
        this.kerbGain = context.createGain();
        this.kerbGain.gain.value = 0;
        this.kerbOsc.connect(kerbFilter);
        kerbFilter.connect(this.kerbGain);
        this.kerbGain.connect(this.output);

        const grassFilter = context.createBiquadFilter();
        grassFilter.type = 'lowpass';
        grassFilter.frequency.value = 900;
        this.grassGain = context.createGain();
        this.grassGain.gain.value = 0;
        this.roadSource.connect(grassFilter);
        grassFilter.connect(this.grassGain);
        this.grassGain.connect(this.output);

        this.scrapeFilter = context.createBiquadFilter();
        this.scrapeFilter.type = 'bandpass';
        this.scrapeFilter.frequency.value = 2400;
        this.scrapeFilter.Q.value = 1.3;
        this.scrapeGain = context.createGain();
        this.scrapeGain.gain.value = 0;
        this.windSource.connect(this.scrapeFilter);
        this.scrapeFilter.connect(this.scrapeGain);
        this.scrapeGain.connect(this.output);

        this.windSource.start(0, 0);
        this.roadSource.start(0, 0.97);
        this.kerbOsc.start();
    }

    setBank(bank: AudioBankData | null) {
        if (!bank || this.bank === bank) return;
        this.bank = bank;
        const loops = bank.manifest.loops.filter((loop) => loop.kind === 'squeal');
        const make = (meta: LoopMeta, rate: number, target: AudioNode): LoopNode => {
            const source = this.context.createBufferSource();
            source.buffer = bank.buffer;
            source.loop = true;
            source.loopStart = meta.start;
            source.loopEnd = meta.start + meta.dur;
            source.playbackRate.value = rate;
            const gain = this.context.createGain();
            gain.gain.value = 0;
            source.connect(gain);
            gain.connect(target);
            source.start(0, meta.start + this.random() * meta.dur * 0.9);
            return { source, gain, base: rate };
        };
        this.squeal = loops.map((meta, i) => make(meta, i === 0 ? 1 : 0.94, this.output));
        if (loops.length) {
            this.scrubFilter = this.context.createBiquadFilter();
            this.scrubFilter.type = 'lowpass';
            this.scrubFilter.frequency.value = 1400;
            this.scrubFilter.connect(this.output);
            this.scrub = make(loops[loops.length - 1], 0.72, this.scrubFilter);
        }
    }

    update(input: DriveInput, dt: number) {
        const now = this.context.currentTime;
        this.time += dt;
        const v = Math.abs(input.speedMps || 0);
        const slip = clamp(input.slip || 0, 0, 1);
        const drift = clamp(input.drift || 0, 0, 1);
        const onGround = input.grounded !== false;
        const rolling = smooth(2, 7, v);

        // squeal needs real slip; scrub covers the edge of grip
        const grip = Math.max(slip, drift * 0.9);
        const squealLevel = onGround ? smooth(0.18, 0.7, grip) * rolling : 0;
        const scrubLevel = onGround ? smooth(0.06, 0.3, grip) * (1 - smooth(0.4, 0.8, grip) * 0.6) * rolling : 0;
        this.squeal.forEach((node, i) => {
            const share = i === 0 ? 1 - drift * 0.5 : 0.35 + drift * 0.65;
            node.gain.gain.setTargetAtTime(0.5 * squealLevel * share, now, 0.05);
            node.source.playbackRate.setTargetAtTime(node.base * (0.92 + 0.14 * grip + 0.04 * smooth(10, 50, v)), now, 0.08);
        });
        if (this.scrub) {
            this.scrub.gain.gain.setTargetAtTime(0.35 * scrubLevel, now, 0.06);
        }

        const windLevel = 0.3 * Math.min(1, Math.pow(v / 85, 2));
        this.windGain.gain.setTargetAtTime(windLevel, now, 0.15);
        this.windFilter.frequency.setTargetAtTime(350 + 1500 * smooth(5, 90, v), now, 0.2);
        const roadLevel = onGround ? 0.14 * smooth(1, 45, v) : 0.02;
        this.roadGain.gain.setTargetAtTime(roadLevel, now, 0.1);
        this.roadFilter.frequency.setTargetAtTime(120 + 260 * smooth(5, 70, v), now, 0.2);

        const kerb = onGround && input.kerb ? 0.22 * smooth(2, 14, v) : 0;
        this.kerbGain.gain.setTargetAtTime(kerb, now, 0.03);
        this.kerbOsc.frequency.setTargetAtTime(Math.max(8, v / 0.75), now, 0.05);
        const grass = onGround && input.grass ? 0.2 * smooth(1, 20, v) : 0;
        this.grassGain.gain.setTargetAtTime(grass, now, 0.06);
        const scrape = clamp(input.scrape || 0, 0, 1) * 0.35 * smooth(1, 18, v) * (0.75 + 0.5 * this.random());
        this.scrapeGain.gain.setTargetAtTime(scrape, now, 0.02);
        this.scrapeFilter.frequency.setTargetAtTime(1800 + 1600 * smooth(3, 40, v), now, 0.05);
    }

    // strength 0..1: kerb thump, landing, wall hit, big crash
    impact(strength: number) {
        const bank = this.bank;
        if (!bank) return;
        const s = clamp(strength, 0, 1);
        if (s < 0.04 || this.time - this.lastImpactAt < 0.12) return;
        this.lastImpactAt = this.time;
        const kind =
            s < 0.2 ? 'bump' : s < 0.45 ? 'impact_light' : s < 0.75 ? 'impact_medium' : 'impact_heavy';
        const shots = bank.shotsByKind[kind] || bank.shotsByKind.bump;
        if (!shots || !shots.length) return;
        const shot = shots[Math.floor(this.random() * shots.length) % shots.length];
        const source = this.context.createBufferSource();
        source.buffer = bank.buffer;
        source.playbackRate.value = Math.pow(2, ((this.random() * 2 - 1) * 150) / 1200);
        const gain = this.context.createGain();
        gain.gain.value = 0.25 + 0.75 * s;
        source.connect(gain);
        gain.connect(this.output);
        source.start(this.context.currentTime, shot.start, shot.dur);
        source.onended = () => {
            source.disconnect();
            gain.disconnect();
        };
    }

    silence() {
        const now = this.context.currentTime;
        [...this.squeal, this.scrub].forEach((node) => node?.gain.gain.setTargetAtTime(0, now, 0.05));
        [this.windGain, this.roadGain, this.kerbGain, this.grassGain, this.scrapeGain].forEach((gain) =>
            gain.gain.setTargetAtTime(0, now, 0.1)
        );
    }
}
