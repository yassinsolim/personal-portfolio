// renders the demo clip for one car with the real race audio code on an
// OfflineAudioContext: idle, a full throttle pull through the gears to the
// limiter, then a lift. scripts/render-audio-samples.mjs drives this page.
import CarAudio from '../../../src/Application/Racing/Audio/CarAudio';
import { carOptionsById } from '../../../src/Application/carOptions';
import { carRollingRadius } from '../../../src/Application/Racing/Vehicle/carPhysics';
import type { EngineSound } from '../../../src/Application/Racing/Garage/engines';

type Frame = {
    t: number;
    rpm: number;
    throttle: number;
    speedKph: number;
    gear: number;
    shifting: boolean;
    limiter: boolean;
};

const SR = 48000;
const STEP = 768 / SR;

// simple longitudinal drive using each car's real gearing and 0-100 time
const planDrive = (carId: string) => {
    const race = carOptionsById[carId].race;
    const frames: Frame[] = [];
    const ratios = race.gearRatios;
    const radius = carRollingRadius(carOptionsById[carId]);
    const wheelRpm = (v: number) => (v / (Math.PI * 2 * radius)) * 60;
    const rpmFor = (v: number, g: number) =>
        Math.max(race.idleRpm, wheelRpm(v) * ratios[g - 1] * race.finalDrive);
    const vmax = race.topSpeedKph / 3.6;
    const a0 = (27.78 / race.zeroToHundredSec) * 1.25;
    let v = 0;
    let gear = 1;
    let rpm = race.idleRpm;
    // the game's gearbox eases rpm toward the wheel speed the same way
    let shown = race.idleRpm;
    let t = 0;
    let shiftLeft = 0;
    let limiterLeft = 0.6;
    let liftAt = -1;
    const idleEnd = 2.2;
    const launchRpm = race.transmission.launchRpm;
    // fourth to the limiter, or a lower gear when fourth runs out near the
    // top speed (the crown's does)
    const gearTopKph = (g: number) => ((race.redlineRpm / 60) * 2 * Math.PI * radius * 3.6) / (ratios[g - 1] * race.finalDrive);
    let lastPullGear = Math.min(4, ratios.length);
    while (lastPullGear > 2 && gearTopKph(lastPullGear) > race.topSpeedKph * 0.9) lastPullGear--;
    const end = () => (liftAt > 0 ? liftAt + 4.2 : 99);
    while (t < end() && t < 22) {
        let throttle = 0;
        let shifting = false;
        let limiter = false;
        if (t < idleEnd) {
            rpm += (race.idleRpm - rpm) * 0.2;
        } else if (liftAt < 0) {
            throttle = 1;
            if (shiftLeft > 0) {
                shiftLeft -= STEP;
                shifting = true;
                throttle = 1;
                v += a0 * 0.15 * STEP;
            } else {
                const accel = a0 * Math.max(0.12, 1 - Math.pow(v / vmax, 1.6)) * (gear === 1 ? 0.9 : 1);
                v += accel * STEP;
            }
            // clutch slip off the line, then locked to the wheels
            const locked = rpmFor(v, gear);
            rpm = gear === 1 ? Math.max(locked, Math.min(launchRpm, race.idleRpm + (t - idleEnd) * 9000)) : locked;
            if (rpm >= race.redlineRpm) {
                rpm = race.redlineRpm;
                if (gear < lastPullGear) {
                    gear += 1;
                    shiftLeft = 0.11;
                } else {
                    limiter = true;
                    limiterLeft -= STEP;
                    v -= a0 * STEP * 0.5;
                    if (limiterLeft <= 0) liftAt = t;
                }
            }
        } else {
            // off throttle: engine braking plus drag, downshifting as it slows
            v = Math.max(0, v - (2.2 + 0.0006 * v * v) * STEP);
            rpm = Math.max(race.idleRpm, rpmFor(v, gear));
            if (rpm < race.shiftDownRpm && gear > 2) {
                gear -= 1;
                rpm = rpmFor(v, gear);
            }
        }
        shown += (rpm - shown) * (1 - Math.exp(-STEP / 0.07));
        frames.push({ t, rpm: shown, throttle, speedKph: v * 3.6, gear, shifting, limiter });
        t += STEP;
    }
    return frames;
};

const toWav = (buffer: AudioBuffer) => {
    const ch = buffer.numberOfChannels;
    const n = buffer.length;
    const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
    const w = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF');
    out.setUint32(4, 36 + n * ch * 2, true);
    w(8, 'WAVE');
    w(12, 'fmt ');
    out.setUint32(16, 16, true);
    out.setUint16(20, 1, true);
    out.setUint16(22, ch, true);
    out.setUint32(24, buffer.sampleRate, true);
    out.setUint32(28, buffer.sampleRate * ch * 2, true);
    out.setUint16(32, ch * 2, true);
    out.setUint16(34, 16, true);
    w(36, 'data');
    out.setUint32(40, n * ch * 2, true);
    const data = [...Array(ch)].map((_, c) => buffer.getChannelData(c));
    let peak = 0;
    for (let i = 0; i < n; i++) {
        for (let c = 0; c < ch; c++) {
            const s = Math.max(-1, Math.min(1, data[c][i]));
            peak = Math.max(peak, Math.abs(s));
            out.setInt16(44 + (i * ch + c) * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        }
    }
    let binary = '';
    const bytes = new Uint8Array(out.buffer);
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return { base64: btoa(binary), peak };
};

// deterministic random so every render of a car comes out the same
const seeded = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
};

// garage options on top of the car's own engine (exhaust, turbos), or none
const render = async (carId: string, options: Partial<EngineSound> = {}) => {
    const frames = planDrive(carId);
    const duration = frames[frames.length - 1].t + 0.6;
    const context = new OfflineAudioContext(2, Math.ceil(duration * SR), SR);
    const audio = new CarAudio({ context, random: seeded(carId.length * 7919) });
    const race = carOptionsById[carId].race;
    const engine: EngineSound = {
        sound: carId,
        idleRpm: race.idleRpm,
        redlineRpm: race.redlineRpm,
        turbo: 'stock',
        supercharger: false,
        exhaust: 'stock',
        ...options,
    };
    await audio.setCar(carId, engine);
    for (let i = 0; i < 200 && !audio.isReady(); i++) {
        await new Promise((r) => setTimeout(r, 25));
    }
    if (!audio.isReady()) throw new Error(`audio for ${carId} did not load`);
    audio.setActive(true);
    const apply = (f: Frame) =>
        audio.update(
            {
                rpm: f.rpm,
                throttle: f.throttle,
                speedKph: f.speedKph,
                gear: f.gear,
                slip: 0,
                grounded: true,
                shifting: f.shifting,
                limiter: f.limiter,
                engine,
            },
            STEP
        );
    apply(frames[0]);
    frames.slice(1).forEach((f, i) => {
        context.suspend((i + 1) * STEP).then(() => {
            apply(f);
            context.resume();
        });
    });
    const buffer = await context.startRendering();
    const wav = toWav(buffer);
    const shifts = frames.filter((f, i) => i > 0 && f.gear !== frames[i - 1].gear).map((f) => [Number(f.t.toFixed(2)), f.gear]);
    return {
        carId,
        seconds: Number(duration.toFixed(2)),
        peak: wav.peak,
        wav: wav.base64,
        format: audio.stats().format,
        bytes: audio.stats().loadedBytes,
        maxRpm: Math.round(Math.max(...frames.map((f) => f.rpm))),
        shots: audio.stats().shots,
        liftAt: Number((frames.find((f, i) => i > 0 && f.throttle === 0 && frames[i - 1].throttle === 1)?.t || 0).toFixed(2)),
        shifts,
    };
};

(window as unknown as { renderCarSample: typeof render }).renderCarSample = render;
(window as unknown as { harnessReady: boolean }).harnessReady = true;
