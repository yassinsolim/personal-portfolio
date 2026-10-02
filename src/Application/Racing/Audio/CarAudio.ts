import AudioBank, { type AudioBankData, RACE_AUDIO_BASE } from './AudioBank';
import EngineVoice from './EngineVoice';
import DriveSounds from './DriveSounds';
import DerivedDrivetrain from './derivedDrivetrain';
import { bankOf, engineProfile, getCarAudioProfile } from './carAudioProfiles';
import { carOptionsById } from '../../carOptions';
import type { EngineSound } from '../Garage/engines';

// race audio entry point. small surface on purpose:
//   carAudio.setCar(carId, engine?)
//   carAudio.update({ rpm, throttle, speedKph, gear, slip, boost }, dt)
//   carAudio.impact(strength)
//   carAudio.setListener(position, forward, up)
//   carAudio.updateRemotes([...], dt)
//   carAudio.setActive / setPaused / setMuted / setVolume
// it also works on an OfflineAudioContext, which is how the demo clips in
// docs/audio-samples are rendered.

export type CarAudioState = {
    carId?: string;
    rpm: number;
    throttle: number;
    speedKph: number;
    gear: number;
    slip: number;
    boost?: number | null;
    drift?: number;
    grounded?: boolean;
    suspension?: number[];
    // optional, used when the driving model reports them
    limiter?: boolean;
    shifting?: boolean;
    impact?: number;
    scrape?: number;
    kerb?: boolean;
    grass?: boolean;
    // the garage's engine, turbos and exhaust; the car's own when left out
    engine?: EngineSound;
};

export type Vec3 = { x: number; y: number; z: number };

export type RemoteCarAudioState = {
    id: string;
    carId: string;
    position: Vec3;
    // worked out from the position when left out (ghost replays)
    speedKph?: number;
    gear?: number;
    rpm?: number;
    ghost?: boolean;
};

export type CarAudioOptions = {
    context?: BaseAudioContext;
    destination?: AudioNode;
    base?: string;
    random?: () => number;
};

type RemoteVoice = {
    id: string;
    carId: string;
    ghost: boolean;
    voice: EngineVoice | null;
    loading: boolean;
    drivetrain: DerivedDrivetrain;
    gain: GainNode;
    filter: BiquadFilterNode;
    panner: PannerNode;
    lastDistance: number;
    lastPosition: Vec3 | null;
    speedMps: number;
    missing: number;
};

const MAX_REMOTE_VOICES = 6;
const UNLOCK_EVENTS = ['pointerdown', 'touchend', 'keydown', 'mousedown'];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const stockEngine = (carId: string): EngineSound => {
    const race = carOptionsById[carId]?.race;
    return {
        sound: carId,
        idleRpm: race?.idleRpm || 900,
        redlineRpm: race?.redlineRpm || 7000,
        turbo: 'stock',
        supercharger: false,
        exhaust: 'stock',
    };
};
const keyOf = (engine: EngineSound | null) =>
    engine
        ? [engine.sound, engine.turbo, engine.supercharger ? 's' : '', engine.exhaust, engine.idleRpm, engine.redlineRpm].join('|')
        : '';

const setParam = (param: AudioParam | undefined, value: number, time: number, tau = 0.05) => {
    if (!param) return;
    param.setTargetAtTime(value, time, tau);
};

export default class CarAudio {
    context: BaseAudioContext | null;
    offline: boolean;
    banks: AudioBank;
    random: () => number;
    externalDestination: AudioNode | null;
    master: GainNode | null;
    raceGain: GainNode | null;
    engineBus: GainNode | null;
    fxBus: GainNode | null;
    remoteBus: GainNode | null;
    voice: EngineVoice | null;
    voiceCarId: string;
    voiceKey: string;
    wantedCarId: string;
    wantedEngine: EngineSound | null;
    loadSerial: number;
    drive: DriveSounds | null;
    common: AudioBankData | null;
    active: boolean;
    paused: boolean;
    muted: boolean;
    volume: number;
    lastGear: number;
    lastSpeed: number;
    wasGrounded: boolean;
    airTime: number;
    lastSuspension: number;
    lastImpact: number;
    time: number;
    remotes: Map<string, RemoteVoice>;
    listenerPosition: Vec3;
    unlockHandler: () => void;
    visibilityHandler: () => void;
    suspendTimer: number | null;
    startupUntil: number;
    lastError: string | null;

    constructor(options: CarAudioOptions = {}) {
        this.context = options.context || null;
        this.offline = Boolean(options.context);
        this.banks = new AudioBank(options.base || RACE_AUDIO_BASE);
        this.random = options.random || Math.random;
        this.externalDestination = options.destination || null;
        this.master = null;
        this.raceGain = null;
        this.engineBus = null;
        this.fxBus = null;
        this.remoteBus = null;
        this.voice = null;
        this.voiceCarId = '';
        this.voiceKey = '';
        this.wantedCarId = '';
        this.wantedEngine = null;
        this.loadSerial = 0;
        this.drive = null;
        this.common = null;
        this.active = false;
        this.paused = false;
        this.muted = false;
        this.volume = 1;
        this.lastGear = 1;
        this.lastSpeed = 0;
        this.wasGrounded = true;
        this.airTime = 0;
        this.lastSuspension = 0;
        this.lastImpact = 0;
        this.time = 0;
        this.remotes = new Map();
        this.listenerPosition = { x: 0, y: 0, z: 0 };
        this.suspendTimer = null;
        this.startupUntil = 0;
        this.lastError = null;

        this.unlockHandler = () => this.unlock();
        this.visibilityHandler = () => this.onVisibility();
        if (this.context) {
            this.buildGraph(this.context);
        } else if (typeof document !== 'undefined') {
            UNLOCK_EVENTS.forEach((type) =>
                document.addEventListener(type, this.unlockHandler, { passive: true, capture: true })
            );
            document.addEventListener('visibilitychange', this.visibilityHandler);
        }
    }

    // ------------------------------------------------------------ context

    // browsers only let audio start after the user has interacted with the
    // page, and ios wants resume() inside the gesture itself
    unlock() {
        const context = this.ensureContext(true);
        if (!context || this.offline) return;
        const live = context as AudioContext;
        if (live.state !== 'running' && this.active && !this.paused) {
            live.resume().catch(() => undefined);
        }
        if (live.state !== 'running') {
            // a one sample buffer started inside the gesture wakes up old ios
            const buffer = live.createBuffer(1, 1, live.sampleRate);
            const source = live.createBufferSource();
            source.buffer = buffer;
            source.connect(live.destination);
            source.start(0);
        }
    }

    ensureContext(fromGesture = false): BaseAudioContext | null {
        if (this.context) return this.context;
        if (typeof window === 'undefined') return null;
        const activation = (navigator as unknown as { userActivation?: { hasBeenActive: boolean } }).userActivation;
        if (!fromGesture && activation && !activation.hasBeenActive) return null;
        const Ctor =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return null;
        let context: AudioContext;
        try {
            context = new Ctor({ latencyHint: 'interactive' });
        } catch {
            return null;
        }
        this.context = context;
        context.addEventListener('statechange', () => {
            // ios parks the context as "interrupted" after calls or siri
            if (context.state !== 'running' && this.active && !this.paused && !document.hidden) {
                context.resume().catch(() => undefined);
            }
        });
        this.buildGraph(context);
        if (!this.active || this.paused) {
            context.suspend().catch(() => undefined);
        }
        if (this.wantedCarId) {
            void this.setCar(this.wantedCarId, this.wantedEngine || undefined);
        }
        return context;
    }

    buildGraph(context: BaseAudioContext) {
        this.master = context.createGain();
        this.raceGain = context.createGain();
        this.raceGain.gain.value = this.offline ? 1 : 0;
        const compressor = context.createDynamicsCompressor();
        compressor.threshold.value = -10;
        compressor.knee.value = 10;
        compressor.ratio.value = 2.5;
        compressor.attack.value = 0.005;
        compressor.release.value = 0.2;
        this.engineBus = context.createGain();
        this.fxBus = context.createGain();
        this.remoteBus = context.createGain();
        this.engineBus.connect(compressor);
        this.fxBus.connect(compressor);
        this.remoteBus.connect(compressor);
        compressor.connect(this.raceGain);
        this.raceGain.connect(this.master);
        this.master.connect(this.externalDestination || context.destination);
        this.drive = new DriveSounds(context, this.fxBus, this.random);
        this.applyMix();
        void this.banks.load(context, 'common').then((bank) => {
            this.common = bank;
            this.drive?.setBank(bank);
        });
    }

    onVisibility() {
        const context = this.context as AudioContext | null;
        if (!context || this.offline) return;
        if (document.hidden) {
            context.suspend().catch(() => undefined);
        } else if (this.active && !this.paused) {
            context.resume().catch(() => undefined);
        }
    }

    setAudioSession(type: 'playback' | 'auto') {
        const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
        if (!session) return;
        try {
            // lets ios play race audio with the ringer switch on silent
            session.type = type;
        } catch {
            // older safari
        }
    }

    // ------------------------------------------------------------ settings

    setActive(active: boolean) {
        if (this.active === active) return;
        this.active = active;
        if (active) {
            this.ensureContext();
            this.startupUntil = this.time + 1.4;
            if (this.voice?.hasShot('start') && !this.offline) {
                this.voice.fadeTo(0, 0.05);
                this.voice.playStart(0.4);
            }
            if (!this.offline) this.setAudioSession('playback');
        } else if (!this.offline) {
            this.setAudioSession('auto');
        }
        this.applyMix();
    }

    setPaused(paused: boolean) {
        this.paused = paused;
        this.applyMix();
    }

    setMuted(muted: boolean) {
        this.muted = muted;
        this.applyMix();
    }

    setVolume(volume: number) {
        this.volume = clamp(Number.isFinite(volume) ? volume : 1, 0, 1);
        this.applyMix();
    }

    applyMix() {
        const context = this.context;
        if (!context || !this.master || !this.raceGain) return;
        const now = context.currentTime;
        setParam(this.master.gain, this.muted ? 0 : this.volume, now, 0.03);
        const running = this.active && !this.paused;
        setParam(this.raceGain.gain, running || this.offline ? 1 : 0, now, running ? 0.05 : 0.08);
        if (this.offline) return;
        const live = context as AudioContext;
        if (this.suspendTimer !== null) {
            window.clearTimeout(this.suspendTimer);
            this.suspendTimer = null;
        }
        if (running) {
            if (live.state !== 'running' && !document.hidden) {
                live.resume().catch(() => undefined);
            }
        } else {
            // let the fade finish, then stop the audio thread
            this.suspendTimer = window.setTimeout(() => {
                this.suspendTimer = null;
                if (!this.active || this.paused) live.suspend().catch(() => undefined);
            }, 600);
        }
    }

    // ------------------------------------------------------------ cars

    async setCar(carId: string, engine?: EngineSound) {
        if (!carId) return;
        const wanted = engine || stockEngine(carId);
        const key = keyOf(wanted);
        this.wantedCarId = carId;
        this.wantedEngine = wanted;
        const context = this.context;
        if (!context || !this.engineBus) return;
        if (this.voiceKey === key && this.voice) return;
        const serial = ++this.loadSerial;
        const bank = await this.banks.load(context, bankOf(wanted.sound));
        if (serial !== this.loadSerial || !bank || !this.engineBus) {
            if (!bank) this.lastError = `no audio for ${wanted.sound}`;
            return;
        }
        const old = this.voice;
        this.voice = new EngineVoice(context, bank, engineProfile(wanted), this.engineBus, {
            gameIdleRpm: wanted.idleRpm,
            gameRedlineRpm: wanted.redlineRpm,
        }, this.random);
        this.voiceCarId = carId;
        this.voiceKey = key;
        old?.dispose(0.3);
        if (this.active && !this.offline && this.voice.hasShot('start')) {
            this.voice.fadeTo(0, 0.05);
            this.voice.playStart(0.4);
            this.startupUntil = this.time + 1.4;
        }
    }

    isReady() {
        return Boolean(this.voice && this.voiceKey === keyOf(this.wantedEngine) && this.common);
    }

    // ------------------------------------------------------------ per frame

    update(state: CarAudioState, dt: number) {
        const step = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
        this.time += step;
        if (
            state.carId &&
            (state.carId !== this.wantedCarId ||
                (state.engine && keyOf(state.engine) !== keyOf(this.wantedEngine)))
        ) {
            void this.setCar(state.carId, state.engine);
        }
        const context = this.context;
        const voice = this.voice;
        if (!context || !voice) return;
        const speedMps = Math.abs(state.speedKph || 0) / 3.6;
        const throttle = clamp(state.throttle || 0, 0, 1);

        if (this.time < this.startupUntil) {
            // the recorded start-up carries the first second or so
            if (this.time > this.startupUntil - 0.5) voice.fadeTo(1, 0.4);
        } else if (voice.output.gain.value < 0.01 && this.active) {
            voice.fadeTo(1, 0.3);
        }

        const gear = Math.round(state.gear || 1);
        if (gear >= 1 && this.lastGear >= 1 && gear !== this.lastGear) {
            voice.shift(gear > this.lastGear, throttle);
        }
        this.lastGear = gear;

        voice.update(
            {
                rpm: state.rpm,
                throttle,
                speedMps,
                boost: state.boost,
                limiter: state.limiter,
                shifting: state.shifting,
            },
            step
        );
        this.drive?.update(
            {
                speedMps,
                slip: state.slip || 0,
                drift: state.drift || 0,
                grounded: state.grounded !== false,
                throttle,
                kerb: state.kerb,
                grass: state.grass,
                scrape: state.scrape,
            },
            step
        );
        this.detectHits(state, speedMps, step);
    }

    // hits and landings from telemetry, for driving models that don't report
    // collisions themselves
    detectHits(state: CarAudioState, speedMps: number, dt: number) {
        const grounded = state.grounded !== false;
        if (!grounded) {
            this.airTime += dt;
        } else {
            if (!this.wasGrounded && this.airTime > 0.22) {
                this.impact(clamp((this.airTime - 0.12) * 0.8, 0.08, 0.7));
            }
            this.airTime = 0;
        }
        this.wasGrounded = grounded;

        if (Array.isArray(state.suspension) && state.suspension.length) {
            const mean = state.suspension.reduce((a, b) => a + b, 0) / state.suspension.length;
            const rate = (mean - this.lastSuspension) / Math.max(dt, 1e-3);
            this.lastSuspension = mean;
            if (grounded && rate > 4 && speedMps > 3) {
                this.impact(clamp(rate / 30, 0.05, 0.35));
            }
        }

        if (typeof state.impact === 'number') {
            // the driving model reports the velocity change into the wall (m/s)
            // and lets it decay, so only a fresh rise is a new hit
            if (state.impact > this.lastImpact * 1.3 && state.impact > 1.5) {
                this.impact(clamp(state.impact / 22, 0.1, 1));
            }
            this.lastImpact = state.impact;
            this.lastSpeed = speedMps;
            return;
        }

        if (dt > 0) {
            const decel = (this.lastSpeed - speedMps) / dt;
            const race = carOptionsById[this.voiceCarId]?.race;
            const limit = Math.max(32, (race?.brakeDecel || 40) * 1.35);
            // a drop straight to a standstill is a reset, not a wall
            const teleport = speedMps < 0.3 && this.lastSpeed > 10;
            if (decel > limit && this.lastSpeed > 4 && !teleport) {
                this.impact(clamp(0.3 + (decel - limit) / 60, 0.3, 1));
            }
        }
        this.lastSpeed = speedMps;
    }

    impact(strength: number) {
        this.drive?.impact(strength);
    }

    // after a reset or teleport, so the jump in speed doesn't read as a crash
    resetMotion() {
        this.lastSpeed = 0;
        this.airTime = 0;
        this.wasGrounded = true;
        this.lastSuspension = 0;
        this.lastImpact = 0;
    }

    // ------------------------------------------------------------ 3d

    setListener(position: Vec3, forward: Vec3, up: Vec3) {
        const context = this.context;
        if (!context) return;
        const l = context.listener;
        const now = context.currentTime;
        this.listenerPosition = { x: position.x, y: position.y, z: position.z };
        if (l.positionX) {
            setParam(l.positionX, position.x, now, 0.02);
            setParam(l.positionY, position.y, now, 0.02);
            setParam(l.positionZ, position.z, now, 0.02);
            setParam(l.forwardX, forward.x, now, 0.02);
            setParam(l.forwardY, forward.y, now, 0.02);
            setParam(l.forwardZ, forward.z, now, 0.02);
            setParam(l.upX, up.x, now, 0.02);
            setParam(l.upY, up.y, now, 0.02);
            setParam(l.upZ, up.z, now, 0.02);
        } else {
            l.setPosition(position.x, position.y, position.z);
            l.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
        }
    }

    updateRemotes(cars: RemoteCarAudioState[], dt: number) {
        const context = this.context;
        if (!context || !this.remoteBus) return;
        const lp = this.listenerPosition;
        const dist = (p: Vec3) => Math.hypot(p.x - lp.x, p.y - lp.y, p.z - lp.z);
        const nearest = cars
            .filter((car) => car && car.carId && car.position)
            .sort((a, b) => dist(a.position) - dist(b.position))
            .slice(0, MAX_REMOTE_VOICES);
        const seen = new Set<string>();
        const now = context.currentTime;
        nearest.forEach((car) => {
            seen.add(car.id);
            let remote = this.remotes.get(car.id);
            if (remote && remote.carId !== car.carId) {
                this.dropRemote(remote);
                remote = undefined;
            }
            if (!remote) remote = this.addRemote(car);
            remote.missing = 0;
            const d = dist(car.position);
            let speedMps = remote.speedMps;
            if (typeof car.speedKph === 'number' && Number.isFinite(car.speedKph)) {
                speedMps = Math.abs(car.speedKph) / 3.6;
            } else if (remote.lastPosition && dt > 0) {
                const p0 = remote.lastPosition;
                const moved = Math.hypot(car.position.x - p0.x, car.position.y - p0.y, car.position.z - p0.z);
                // replays loop back to the start line, ignore that jump
                if (moved / dt < 150) speedMps += (moved / dt - speedMps) * (1 - Math.exp(-dt / 0.15));
            }
            remote.speedMps = speedMps;
            remote.lastPosition = { x: car.position.x, y: car.position.y, z: car.position.z };
            const derived = remote.drivetrain.update(speedMps, dt, car.gear);
            const rpm = typeof car.rpm === 'number' && car.rpm > 0 ? car.rpm : derived.rpm;
            // doppler, which web audio's panner no longer does on its own
            const radial = dt > 0 && Number.isFinite(remote.lastDistance) ? (d - remote.lastDistance) / dt : 0;
            remote.lastDistance = d;
            const doppler = clamp(343 / (343 + clamp(radial, -80, 80)), 0.86, 1.16);
            const p = remote.panner;
            if (p.positionX) {
                setParam(p.positionX, car.position.x, now, 0.03);
                setParam(p.positionY, car.position.y, now, 0.03);
                setParam(p.positionZ, car.position.z, now, 0.03);
            } else {
                p.setPosition(car.position.x, car.position.y, car.position.z);
            }
            // air soaks up the top end with distance
            setParam(remote.filter.frequency, clamp(18000 * Math.exp(-d / 140), 900, 18000), now, 0.1);
            if (remote.voice) {
                remote.voice.rateScale = doppler;
                if (derived.shifted) remote.voice.shift(derived.shifted > 0, derived.throttle);
                remote.voice.update({ rpm, throttle: derived.throttle, speedMps }, dt);
            }
        });
        this.remotes.forEach((remote) => {
            if (seen.has(remote.id)) return;
            remote.missing += dt;
            if (remote.missing > 0.5) this.dropRemote(remote);
        });
    }

    addRemote(car: RemoteCarAudioState): RemoteVoice {
        const context = this.context as BaseAudioContext;
        const gain = context.createGain();
        gain.gain.value = car.ghost ? 0.35 : 0.8;
        const filter = context.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 12000;
        const panner = context.createPanner();
        const mobile = typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
        panner.panningModel = mobile ? 'equalpower' : 'HRTF';
        panner.distanceModel = 'inverse';
        panner.refDistance = 6;
        panner.rolloffFactor = 1.1;
        panner.maxDistance = 700;
        gain.connect(filter);
        filter.connect(panner);
        panner.connect(this.remoteBus as GainNode);
        const remote: RemoteVoice = {
            id: car.id,
            carId: car.carId,
            ghost: Boolean(car.ghost),
            voice: null,
            loading: true,
            drivetrain: new DerivedDrivetrain(car.carId),
            gain,
            filter,
            panner,
            lastDistance: NaN,
            lastPosition: null,
            speedMps: 0,
            missing: 0,
        };
        this.remotes.set(car.id, remote);
        void this.banks.load(context, bankOf(car.carId)).then((bank) => {
            remote.loading = false;
            if (!bank || this.remotes.get(car.id) !== remote) return;
            const race = carOptionsById[car.carId]?.race;
            remote.voice = new EngineVoice(context, bank, getCarAudioProfile(car.carId), gain, {
                remote: true,
                gameIdleRpm: race?.idleRpm || 900,
                gameRedlineRpm: race?.redlineRpm || 7000,
            }, this.random);
        });
        return remote;
    }

    dropRemote(remote: RemoteVoice) {
        remote.voice?.dispose(0.3);
        const { gain, filter, panner } = remote;
        if (typeof window !== 'undefined') {
            window.setTimeout(() => {
                gain.disconnect();
                filter.disconnect();
                panner.disconnect();
            }, 600);
        }
        this.remotes.delete(remote.id);
    }

    clearRemotes() {
        Array.from(this.remotes.values()).forEach((remote) => this.dropRemote(remote));
    }

    // ------------------------------------------------------------ debug

    stats() {
        return {
            state: (this.context as AudioContext | null)?.state || 'none',
            car: this.voiceCarId,
            format: this.voice?.bank.format || null,
            carBytes: this.voice?.bank.bytes || 0,
            commonBytes: this.common?.bytes || 0,
            loadedBytes: this.banks.loadedBytes,
            remotes: this.remotes.size,
            rpm: Math.round(this.voice?.rpm || 0),
            load: Number((this.voice?.load || 0).toFixed(2)),
            boost: Number((this.voice?.boost || 0).toFixed(2)),
            shots: { ...(this.voice?.shotCounts || {}) },
            error: this.lastError,
        };
    }
}
