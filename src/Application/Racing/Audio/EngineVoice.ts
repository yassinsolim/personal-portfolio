import type { AudioBankData, LoopMeta, ShotMeta } from './AudioBank';
import type { CarAudioProfile, ExhaustTone } from './carAudioProfiles';

// one engine: crossfades the recorded/rendered rpm loops by rpm and load,
// pitch shifts them to the exact rpm, and adds shift cuts, the rev limiter,
// overrun pops, the turbo and hybrid motor whine. the loops go out through
// the exhaust's tone. the player car and every remote or ghost car each get
// their own voice.

export type EngineInput = {
    rpm: number;
    throttle: number;
    speedMps: number;
    boost?: number | null;
    // from a gearbox model that reports them; guessed from rpm otherwise
    limiter?: boolean | null;
    shifting?: boolean | null;
};

type LoopVoice = {
    meta: LoopMeta;
    gain: GainNode;
    source: AudioBufferSourceNode | null;
    quietFor: number;
};

type VoiceOptions = {
    remote?: boolean;
    gameIdleRpm: number;
    gameRedlineRpm: number;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, v: number) => {
    const t = clamp((v - a) / Math.max(1e-6, b - a), 0, 1);
    return t * t * (3 - 2 * t);
};
const dbToGain = (db: number) => Math.pow(10, db / 20);

let noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

export const getNoiseBuffer = (context: BaseAudioContext) => {
    const cached = noiseCache.get(context);
    if (cached) return cached;
    const length = Math.floor(context.sampleRate * 2);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    // cheap deterministic white noise so offline renders repeat exactly
    let seed = 0x9e3779b9;
    for (let i = 0; i < length; i++) {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        data[i] = ((seed >>> 0) / 4294967296) * 2 - 1;
    }
    noiseCache.set(context, buffer);
    return buffer;
};

export const resetNoiseCache = () => {
    noiseCache = new WeakMap();
};

// soft clipping with unity gain for small signals: loud pulses round off
// and pick up odd harmonics, the rasp of an open pipe
const clipCurve = (k: number) => {
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        curve[i] = Math.tanh(k * x) / k;
    }
    return curve;
};

// the exhaust's tone on the loops: bass shelf, rasp band, top shelf, then
// the clipping. null when it leaves them as they are
const buildTone = (context: BaseAudioContext, tone: ExhaustTone | null | undefined, out: AudioNode) => {
    if (!tone) return null;
    const input = context.createGain();
    const low = context.createBiquadFilter();
    low.type = 'lowshelf';
    low.frequency.value = 120;
    low.gain.value = tone.lowDb;
    const mid = context.createBiquadFilter();
    mid.type = 'peaking';
    mid.frequency.value = tone.midHz;
    mid.Q.value = 0.8;
    mid.gain.value = tone.midDb;
    const high = context.createBiquadFilter();
    high.type = 'highshelf';
    high.frequency.value = 5500;
    high.gain.value = tone.highDb;
    const level = context.createGain();
    level.gain.value = dbToGain(tone.levelDb);
    input.connect(low);
    low.connect(mid);
    mid.connect(high);
    if (tone.drive > 0) {
        const shaper = context.createWaveShaper();
        shaper.curve = clipCurve(1 + tone.drive * 3.5);
        shaper.oversample = '2x';
        high.connect(shaper);
        shaper.connect(level);
    } else {
        high.connect(level);
    }
    level.connect(out);
    return input;
};

export default class EngineVoice {
    context: BaseAudioContext;
    bank: AudioBankData;
    profile: CarAudioProfile;
    output: GainNode;
    remote: boolean;
    gameIdleRpm: number;
    gameRedlineRpm: number;
    idle: LoopVoice | null;
    onLoops: LoopVoice[];
    offLoops: LoopVoice[];
    rpm: number;
    load: number;
    boost: number;
    rateScale: number;
    lastThrottle: number;
    throttleHighAt: number;
    popTimer: number;
    cutUntil: number;
    blipUntil: number;
    upshifting: boolean;
    limiterPhase: number;
    time: number;
    random: () => number;
    // the loops' bus, into the exhaust's tone
    loopBus: GainNode;
    // turbo: a narrow band of noise and a faint tone for the whistle, and the
    // air rushing in while it spools
    whistle: OscillatorNode | null;
    whistleTone: GainNode | null;
    whistleAir: AudioBufferSourceNode | null;
    whistleBands: BiquadFilterNode[];
    whistleGain: GainNode | null;
    whoosh: AudioBufferSourceNode | null;
    whooshFilter: BiquadFilterNode | null;
    whooshGain: GainNode | null;
    spoolRise: number;
    whine: OscillatorNode | null;
    whineGain: GainNode | null;
    blower: OscillatorNode | null;
    blowerGain: GainNode | null;
    disposed: boolean;
    shotCounts: Record<string, number>;

    constructor(
        context: BaseAudioContext,
        bank: AudioBankData,
        profile: CarAudioProfile,
        destination: AudioNode,
        options: VoiceOptions,
        random: () => number = Math.random
    ) {
        this.context = context;
        this.bank = bank;
        this.profile = profile;
        this.remote = Boolean(options.remote);
        this.gameIdleRpm = options.gameIdleRpm || profile.idleRpm;
        this.gameRedlineRpm = options.gameRedlineRpm || profile.limiterRpm;
        this.random = random;
        this.output = context.createGain();
        this.output.gain.value = 0;
        this.output.connect(destination);
        this.loopBus = context.createGain();
        this.loopBus.connect(buildTone(context, profile.tone, this.output) || this.output);

        const makeLoop = (meta: LoopMeta): LoopVoice => {
            const gain = context.createGain();
            gain.gain.value = 0;
            gain.connect(this.loopBus);
            return { meta, gain, source: null, quietFor: 0 };
        };
        const loops = bank.manifest.loops;
        const idleMeta = loops.find((loop) => loop.kind === 'idle');
        this.idle = idleMeta ? makeLoop(idleMeta) : null;
        this.onLoops = loops
            .filter((loop) => loop.kind === 'on')
            .sort((a, b) => a.rpm - b.rpm)
            .map(makeLoop);
        this.offLoops = loops
            .filter((loop) => loop.kind === 'off')
            .sort((a, b) => a.rpm - b.rpm)
            .map(makeLoop);

        this.rpm = this.gameIdleRpm;
        this.load = 0;
        this.boost = 0;
        this.rateScale = 1;
        this.lastThrottle = 0;
        this.throttleHighAt = -10;
        this.popTimer = 0;
        this.cutUntil = -1;
        this.blipUntil = -1;
        this.upshifting = false;
        this.limiterPhase = 0;
        this.time = 0;
        this.disposed = false;
        this.shotCounts = {};

        this.whistle = null;
        this.whistleTone = null;
        this.whistleAir = null;
        this.whistleBands = [];
        this.whistleGain = null;
        this.whoosh = null;
        this.whooshFilter = null;
        this.whooshGain = null;
        this.spoolRise = 0;
        this.whine = null;
        this.whineGain = null;
        this.blower = null;
        this.blowerGain = null;
        if (!this.remote) {
            this.buildExtras();
        }
        this.output.gain.setTargetAtTime(profile.gain, context.currentTime, 0.08);
    }

    buildExtras() {
        const { context, profile } = this;
        if (profile.turbo) {
            const noise = getNoiseBuffer(context);
            this.whistleGain = context.createGain();
            this.whistleGain.gain.value = 0;
            this.whistleGain.connect(this.output);
            // the compressor's whistle is air, not a pure tone: noise through
            // two narrow bands, with a quiet wavering tone at its core
            this.whistleAir = context.createBufferSource();
            this.whistleAir.buffer = noise;
            this.whistleAir.loop = true;
            let into: AudioNode = this.whistleAir;
            for (let i = 0; i < 2; i++) {
                const band = context.createBiquadFilter();
                band.type = 'bandpass';
                band.frequency.value = profile.turbo.whistleHz[0];
                band.Q.value = 14;
                into.connect(band);
                into = band;
                this.whistleBands.push(band);
            }
            const air = context.createGain();
            // two q 14 bands keep only a sliver of the noise
            air.gain.value = 9;
            into.connect(air);
            air.connect(this.whistleGain);
            this.whistle = context.createOscillator();
            this.whistle.type = 'sine';
            this.whistle.frequency.value = profile.turbo.whistleHz[0];
            this.whistleTone = context.createGain();
            this.whistleTone.gain.value = 0.35;
            this.whistle.connect(this.whistleTone);
            this.whistleTone.connect(this.whistleGain);
            this.whistleAir.start(0, this.random() * 1.5);
            this.whistle.start();

            this.whoosh = context.createBufferSource();
            this.whoosh.buffer = noise;
            this.whoosh.loop = true;
            this.whooshFilter = context.createBiquadFilter();
            this.whooshFilter.type = 'bandpass';
            this.whooshFilter.frequency.value = 700;
            this.whooshFilter.Q.value = 0.7;
            this.whooshGain = context.createGain();
            this.whooshGain.gain.value = 0;
            this.whoosh.connect(this.whooshFilter);
            this.whooshFilter.connect(this.whooshGain);
            this.whooshGain.connect(this.output);
            this.whoosh.start(0, 0.7 + this.random() * 0.6);
        }
        if (profile.motorWhine) {
            this.whine = context.createOscillator();
            this.whine.type = 'triangle';
            this.whine.frequency.value = 200;
            this.whineGain = context.createGain();
            this.whineGain.gain.value = 0;
            this.whine.connect(this.whineGain);
            this.whineGain.connect(this.output);
            this.whine.start();
        }
        if (profile.superWhine) {
            // a roots blower's lobes: a buzzy whine an octave of harmonics deep
            this.blower = context.createOscillator();
            this.blower.type = 'sawtooth';
            this.blower.frequency.value = 300;
            const tame = context.createBiquadFilter();
            tame.type = 'lowpass';
            tame.frequency.value = 4500;
            this.blowerGain = context.createGain();
            this.blowerGain.gain.value = 0;
            this.blower.connect(tame);
            tame.connect(this.blowerGain);
            this.blowerGain.connect(this.output);
            this.blower.start();
        }
    }

    // the idle loop keeps its own recorded pitch at the game's idle, then the
    // mapping eases back onto the real rpm by the time the car is driving
    audioRpm(gameRpm: number) {
        const gi = this.gameIdleRpm;
        const ai = this.profile.idleRpm;
        const knee = Math.max(2600, gi * 2.4);
        if (gameRpm <= gi) return (ai * gameRpm) / gi;
        if (gameRpm >= knee) return gameRpm;
        return lerp(ai, knee, (gameRpm - gi) / (knee - gi));
    }

    startLoop(loop: LoopVoice, rate: number, when: number) {
        const source = this.context.createBufferSource();
        source.buffer = this.bank.buffer;
        source.loop = true;
        source.loopStart = loop.meta.start;
        source.loopEnd = loop.meta.start + loop.meta.dur;
        source.playbackRate.value = rate;
        source.connect(loop.gain);
        source.start(when, loop.meta.start + this.random() * loop.meta.dur * 0.98);
        loop.source = source;
        loop.quietFor = 0;
    }

    stopLoop(loop: LoopVoice, when: number) {
        if (!loop.source) return;
        try {
            loop.source.stop(when + 0.05);
        } catch {
            // already stopped
        }
        const source = loop.source;
        source.onended = () => source.disconnect();
        loop.source = null;
    }

    driveLoop(loop: LoopVoice, weight: number, rpm: number, now: number, dt: number) {
        const rate = clamp(rpm / loop.meta.rpm, 0.3, 3) * this.rateScale;
        if (weight > 0.0006) {
            if (!loop.source) this.startLoop(loop, rate, now);
            loop.quietFor = 0;
        } else {
            loop.quietFor += dt;
            if (loop.source && loop.quietFor > 0.6) this.stopLoop(loop, now);
        }
        loop.gain.gain.setTargetAtTime(weight, now, 0.035);
        if (loop.source) {
            loop.source.playbackRate.setTargetAtTime(rate, now, 0.018);
        }
    }

    // equal power crossfade between the two loops around rpm
    spread(loops: LoopVoice[], rpm: number, out: Map<LoopVoice, number>, scale: number) {
        if (!loops.length || scale <= 0) return;
        if (rpm <= loops[0].meta.rpm) {
            out.set(loops[0], (out.get(loops[0]) || 0) + scale);
            return;
        }
        const last = loops[loops.length - 1];
        if (rpm >= last.meta.rpm) {
            out.set(last, (out.get(last) || 0) + scale);
            return;
        }
        for (let i = 0; i < loops.length - 1; i++) {
            const a = loops[i];
            const b = loops[i + 1];
            if (rpm >= a.meta.rpm && rpm < b.meta.rpm) {
                const t = Math.log(rpm / a.meta.rpm) / Math.log(b.meta.rpm / a.meta.rpm);
                out.set(a, (out.get(a) || 0) + Math.cos((t * Math.PI) / 2) * scale);
                out.set(b, (out.get(b) || 0) + Math.sin((t * Math.PI) / 2) * scale);
                return;
            }
        }
    }

    update(input: EngineInput, dt: number) {
        if (this.disposed) return;
        const now = this.context.currentTime;
        this.time += dt;
        const profile = this.profile;
        const throttle = clamp(input.throttle || 0, 0, 1);
        const gameRpm = clamp(input.rpm || this.gameIdleRpm, 0, this.gameRedlineRpm * 1.05);

        // load follows the pedal quickly up and a bit slower down
        const k = 1 - Math.exp(-dt / (throttle > this.load ? 0.05 : 0.09));
        this.load += (throttle - this.load) * k;
        let load = this.load;
        let rpm = this.audioRpm(gameRpm);

        if (this.time < this.cutUntil || (input.shifting && this.upshifting)) load = Math.min(load, 0.08);
        if (this.time < this.blipUntil) load = Math.max(load, 0.75);
        if (!input.shifting) this.upshifting = false;

        // hard cut limiter: fire, cut, fire
        const onLimiter =
            typeof input.limiter === 'boolean'
                ? input.limiter
                : gameRpm >= Math.min(profile.limiterRpm, this.gameRedlineRpm) * 0.985 && throttle > 0.5;
        if (onLimiter) {
            this.limiterPhase += dt * profile.limiterHz;
            const cut = this.limiterPhase % 1 < 0.42;
            if (cut) {
                load = 0.05;
                rpm *= 0.985;
            }
        } else {
            this.limiterPhase = 0;
        }

        const idleRpm = profile.idleRpm;
        const firstDrive = Math.min(
            this.onLoops[0]?.meta.rpm ?? idleRpm * 2,
            this.offLoops[0]?.meta.rpm ?? idleRpm * 2
        );
        const idleWeight = this.idle
            ? 1 - smooth(idleRpm * 1.03, lerp(idleRpm, Math.max(firstDrive, idleRpm * 1.4), 0.9), rpm)
            : 0;
        const gIdle = Math.cos(((1 - idleWeight) * Math.PI) / 2);
        const gDrive = Math.sin(((1 - idleWeight) * Math.PI) / 2);
        const span = clamp((rpm - idleRpm) / Math.max(1, profile.limiterRpm - idleRpm), 0, 1);
        const onLevel = dbToGain(lerp(profile.onDb[0], profile.onDb[1], span));
        const offLevel = dbToGain(lerp(profile.offDb[0], profile.offDb[1], span));
        const gOn = Math.sin((load * Math.PI) / 2);
        const gOff = Math.cos((load * Math.PI) / 2);

        const weights = new Map<LoopVoice, number>();
        this.spread(this.onLoops, rpm, weights, gDrive * gOn * onLevel);
        this.spread(this.offLoops, rpm, weights, gDrive * gOff * offLevel);
        this.onLoops.forEach((loop) => this.driveLoop(loop, weights.get(loop) || 0, rpm, now, dt));
        this.offLoops.forEach((loop) => this.driveLoop(loop, weights.get(loop) || 0, rpm, now, dt));
        if (this.idle) {
            // idle sits a little above the overrun level so it reads in the mix
            const idleLevel = dbToGain(lerp(profile.offDb[0] + 5, profile.onDb[0], load));
            this.driveLoop(this.idle, gIdle * idleLevel, rpm, now, dt);
        }

        if (!this.remote) {
            this.updatePops(throttle, rpm, dt);
            this.updateTurbo(throttle, rpm, span, input.boost, dt, now);
            this.updateWhine(throttle, input.speedMps, now);
            this.updateBlower(throttle, rpm, now);
        }
        this.rpm = rpm;
        this.lastThrottle = throttle;
    }

    updatePops(throttle: number, rpm: number, dt: number) {
        const pops = this.profile.pops;
        if (!pops) return;
        // an open pipe bangs: deeper and louder than a muffled pop
        const open = (this.profile.tone?.drive || 0) >= 0.5;
        if (throttle > 0.55) this.throttleHighAt = this.time;
        const lifted = this.lastThrottle > 0.6 && throttle < 0.15;
        if (lifted && rpm > pops.minRpm && this.random() < (open ? 0.85 : 0.55)) {
            this.playShot('crackle', pops.gain * (0.6 + 0.4 * this.random()));
            this.popTimer = 0.12 + this.random() * 0.2;
        }
        const sinceLift = this.time - this.throttleHighAt;
        if (throttle < 0.12 && rpm > pops.minRpm * 0.85 && sinceLift < pops.window) {
            this.popTimer -= dt;
            if (this.popTimer <= 0) {
                const fade = 1 - sinceLift / pops.window;
                const bang = open && this.random() < 0.4;
                this.playShot(
                    'pop',
                    pops.gain * (0.35 + 0.65 * this.random()) * (0.4 + 0.6 * fade) * (bang ? 1.3 : 1),
                    180,
                    0,
                    bang ? 0.75 : 1
                );
                this.popTimer = -Math.log(1 - this.random() * 0.999) / pops.rate;
            }
        }
    }

    updateTurbo(throttle: number, rpm: number, span: number, boostIn: number | null | undefined, dt: number, now: number) {
        const turbo = this.profile.turbo;
        if (!turbo || !this.whistle || !this.whistleGain || !this.whooshGain || !this.whooshFilter) return;
        const prev = this.boost;
        if (typeof boostIn === 'number' && Number.isFinite(boostIn)) {
            this.boost = clamp(boostIn, 0, 1);
        } else {
            const target = throttle * smooth(turbo.spool[0], turbo.spool[1], rpm);
            const tau = target > this.boost ? turbo.spoolTime : turbo.spoolTime * 0.4;
            this.boost += (target - this.boost) * (1 - Math.exp(-dt / tau));
        }
        const boost = this.boost;
        if (prev > 0.4 && this.lastThrottle > 0.6 && throttle < 0.2) {
            if (turbo.release === 'flutter') this.playFlutter(turbo.releaseGain * prev);
            else this.playShot('bov', turbo.releaseGain * prev);
        }
        // how fast the boost is building, a full spool in spoolTime reading
        // about 1. the rush of air and most of the whistle ride on this
        const rise = dt > 0 ? Math.max(0, boost - prev) / dt : 0;
        const k = 1 - Math.exp(-dt / (rise > this.spoolRise ? 0.05 : 0.25));
        this.spoolRise += (clamp(rise * turbo.spoolTime, 0, 1.5) - this.spoolRise) * k;
        const spooling = this.spoolRise;
        const freq = lerp(turbo.whistleHz[0], turbo.whistleHz[1], boost) * (0.9 + 0.2 * span);
        // a slow waver, the shaft never holds one speed exactly
        const waver = 1 + 0.006 * Math.sin(this.time * 5.3) + 0.004 * Math.sin(this.time * 2.1 + 1);
        this.whistle.frequency.setTargetAtTime(freq * waver, now, 0.05);
        this.whistleBands.forEach((band) => band.frequency.setTargetAtTime(freq, now, 0.05));
        const held = 0.25 * boost * boost * (0.3 + 0.7 * throttle);
        this.whistleGain.gain.setTargetAtTime(turbo.whistleGain * (held + 0.9 * spooling * throttle), now, 0.06);
        this.whooshFilter.frequency.setTargetAtTime(500 + 900 * boost, now, 0.1);
        this.whooshGain.gain.setTargetAtTime(turbo.whooshGain * spooling * throttle, now, 0.08);
    }

    // compressor surge with no valve to let the boost go: the air chugs back
    // out through the compressor in bursts that slow and fade as the turbo
    // spins down, "stu-tu-tu-tu". a shift only lets a few out
    playFlutter(level: number, most = Infinity) {
        if (level <= 0.001) return;
        const context = this.context;
        const now = context.currentTime + 0.02;
        this.shotCounts.flutter = (this.shotCounts.flutter || 0) + 1;
        const source = context.createBufferSource();
        source.buffer = getNoiseBuffer(context);
        const band = context.createBiquadFilter();
        band.type = 'bandpass';
        band.Q.value = 1.1;
        // the hollow "tu": the intake pipe's resonance under the burst
        const body = context.createBiquadFilter();
        body.type = 'peaking';
        body.frequency.value = 520;
        body.Q.value = 1.3;
        body.gain.value = 8;
        const gain = context.createGain();
        gain.gain.value = 0;
        source.connect(band);
        band.connect(body);
        body.connect(gain);
        gain.connect(this.output);
        const count = Math.min(
            most,
            7 + Math.round(4 * clamp(level / 0.8, 0, 1)) + Math.floor(this.random() * 2)
        );
        let t = now;
        let gap = 0.062 + this.random() * 0.01;
        let amp = level * 1.6;
        for (let i = 0; i < count; i++) {
            band.frequency.setValueAtTime(1500 * Math.pow(0.95, i), t);
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(amp, t + 0.004);
            gain.gain.setTargetAtTime(0, t + 0.006, 0.013 + 0.002 * i);
            t += gap * (0.92 + 0.16 * this.random());
            gap *= 1.1;
            amp *= 0.84;
        }
        source.start(now, this.random() * 1.2);
        source.stop(t + 0.15);
        source.onended = () => {
            source.disconnect();
            band.disconnect();
            body.disconnect();
            gain.disconnect();
        };
    }

    updateWhine(throttle: number, speedMps: number, now: number) {
        const whine = this.profile.motorWhine;
        if (!whine || !this.whine || !this.whineGain) return;
        const v = Math.abs(speedMps || 0);
        this.whine.frequency.setTargetAtTime(Math.max(40, whine.hzPerMps * v), now, 0.05);
        const level = whine.gain * smooth(0.5, 6, v) * (0.35 + 0.65 * throttle) * (1 - 0.5 * smooth(40, 80, v));
        this.whineGain.gain.setTargetAtTime(level, now, 0.08);
    }

    updateBlower(throttle: number, rpm: number, now: number) {
        const blower = this.profile.superWhine;
        if (!blower || !this.blower || !this.blowerGain) return;
        this.blower.frequency.setTargetAtTime(Math.max(60, (rpm / 60) * blower.ratio), now, 0.03);
        const level = blower.gain * (0.3 + 0.7 * throttle) * smooth(this.profile.idleRpm, this.profile.limiterRpm * 0.6, rpm);
        this.blowerGain.gain.setTargetAtTime(level, now, 0.05);
    }

    // gear change from the gearbox model
    shift(up: boolean, throttle: number) {
        if (up) {
            if (throttle > 0.45) {
                this.cutUntil = this.time + 0.085;
                this.upshifting = true;
                if (this.profile.shiftCrackle > 0 && !this.remote) {
                    this.playShot('shift', this.profile.shiftCrackle * throttle);
                }
                // the throttle shuts for the shift: with no valve the boost
                // chatters out between gears
                const turbo = this.profile.turbo;
                if (turbo?.release === 'flutter' && this.boost > 0.4 && !this.remote) {
                    this.playFlutter(turbo.releaseGain * this.boost * 0.7, 4);
                }
            }
        } else if (throttle < 0.5) {
            // rev-matched downshift blip
            this.blipUntil = this.time + 0.14;
            if (this.profile.pops && !this.remote && this.random() < 0.45) {
                this.playShot('pop', this.profile.pops.gain * 0.6, 200, 0.16);
            }
        }
    }

    playShot(kind: string, gain: number, detuneCents = 120, delay = 0, pitch = 1) {
        const shots = this.bank.shotsByKind[kind];
        if (!shots || !shots.length || gain <= 0.001) return;
        this.shotCounts[kind] = (this.shotCounts[kind] || 0) + 1;
        const shot: ShotMeta = shots[Math.floor(this.random() * shots.length) % shots.length];
        const when = this.context.currentTime + delay + this.random() * 0.01;
        const source = this.context.createBufferSource();
        source.buffer = this.bank.buffer;
        source.playbackRate.value = pitch * Math.pow(2, ((this.random() * 2 - 1) * detuneCents) / 1200);
        const g = this.context.createGain();
        g.gain.value = gain;
        source.connect(g);
        // everything but the blow-off comes out of the exhaust, through its tone
        g.connect(kind === 'bov' ? this.output : this.loopBus);
        source.start(when, shot.start, shot.dur);
        source.onended = () => {
            source.disconnect();
            g.disconnect();
        };
    }

    playStart(gain = 0.8) {
        this.playShot('start', gain, 0);
    }

    hasShot(kind: string) {
        return Boolean(this.bank.shotsByKind[kind]?.length);
    }

    fadeTo(level: number, time = 0.15) {
        this.output.gain.setTargetAtTime(level * this.profile.gain, this.context.currentTime, time / 3);
    }

    dispose(fade = 0.25) {
        if (this.disposed) return;
        this.disposed = true;
        const now = this.context.currentTime;
        this.output.gain.cancelScheduledValues(now);
        this.output.gain.setTargetAtTime(0, now, fade / 4);
        const end = now + fade + 0.05;
        [this.idle, ...this.onLoops, ...this.offLoops].forEach((loop) => {
            if (loop) this.stopLoop(loop, end);
        });
        [this.whistle, this.whistleAir, this.whoosh, this.whine, this.blower].forEach((node) => {
            try {
                node?.stop(end);
            } catch {
                // not started
            }
        });
        const output = this.output;
        if (typeof window !== 'undefined') {
            window.setTimeout(() => output.disconnect(), (fade + 0.2) * 1000);
        }
    }
}
