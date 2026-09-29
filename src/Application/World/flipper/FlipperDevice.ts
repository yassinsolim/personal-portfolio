// the page side of the webassembly flipper zero firmware.
//
// the firmware (gpl-3.0, static/handheld, source at github.com/yassinsolim/flipper-wasm)
// runs in its own worker and is only reached through postMessage, so it stays a
// separate program from the portfolio. this file is the portfolio's own code.
//
// buttons send raw press and release like the real switches; the firmware's input
// service decides short, long (300 ms) and repeat (150 ms), so holds are authentic.

import FlipperLcd from './FlipperLcd';
import { assetUrl } from '../../Utils/assetUrl';

export type FlipperButton = 'up' | 'down' | 'right' | 'left' | 'ok' | 'back';
export type FlipperState = 'idle' | 'booting' | 'running' | 'paused' | 'off' | 'crashed';

export const FLIPPER_BUTTONS: FlipperButton[] = ['up', 'down', 'right', 'left', 'ok', 'back'];
const KEY_INDEX: Record<FlipperButton, number> = { up: 0, down: 1, right: 2, left: 3, ok: 4, back: 5 };
// left handed mode: the room shows the screen upright, so the d-pad turns with it
const TURNED: Record<FlipperButton, FlipperButton> = {
    up: 'down',
    down: 'up',
    left: 'right',
    right: 'left',
    ok: 'ok',
    back: 'back',
};
// the input service debounces for 4 ms, keep very quick taps from vanishing
const MIN_HOLD_MS = 45;
// a piezo is loud and harsh, keep it polite
const SPEAKER_GAIN = 0.05;

export type FlipperLed = { red: number; green: number; blue: number; blinkPeriodMs: number; blinkOnMs: number };

type WorkerMessage =
    | { type: 'ready' }
    | { type: 'frame'; pixels: Uint8Array; orientation: number }
    | {
          type: 'hw';
          red: number;
          green: number;
          blue: number;
          backlight: number;
          blinkActive: boolean;
          blinkLight: number;
          blinkBrightness: number;
          blinkOnMs: number;
          blinkPeriodMs: number;
          vibro: boolean;
      }
    | { type: 'speaker'; frequency: number; volume: number }
    | { type: 'power'; what: 'off' | 'reset' }
    | { type: 'crash' | 'error'; text: string; where?: string }
    | { type: 'stats'; busy: number }
    | { type: 'log'; text: string };

export default class FlipperDevice extends EventTarget {
    readonly lcd: FlipperLcd;
    state: FlipperState = 'idle';
    led: FlipperLed = { red: 0, green: 0, blue: 0, blinkPeriodMs: 0, blinkOnMs: 0 };
    vibrating = false;
    // share of the worker's time spent in the firmware (0..1), updated every 2 s
    workerLoad = 0;
    private worker: Worker | null = null;
    private ready: Promise<void> | null = null;
    private awake = false;
    private rebooting = false;
    private pressed = new Map<FlipperButton, { at: number; sent: FlipperButton }>();
    private pendingRelease = new Map<FlipperButton, number>();
    private audio: { context: AudioContext; osc: OscillatorNode; gain: GainNode } | null = null;

    constructor(options: { scale?: number } = {}) {
        super();
        this.lcd = new FlipperLcd(options.scale ?? 4);
    }

    get screenCanvas() {
        return this.lcd.canvas;
    }

    get started() {
        return this.worker !== null;
    }

    start() {
        if (this.worker && this.ready) return this.ready;
        const url = (file: string) => new URL(assetUrl(`handheld/${file}`), document.baseURI).href;
        this.setState('booting');
        this.rebooting = false;
        this.worker = new Worker(url('worker.js'), { type: 'module' });
        this.worker.onmessage = (event) => this.onMessage(event.data as WorkerMessage);
        this.worker.onerror = (event) => this.fail(event.message || 'worker error');
        this.ready = new Promise((resolve, reject) => {
            const done = () => {
                this.removeEventListener('state', check);
            };
            const check = () => {
                if (this.state === 'running') {
                    done();
                    resolve();
                } else if (this.state === 'crashed') {
                    done();
                    reject(new Error('flipper failed to start'));
                }
            };
            this.addEventListener('state', check);
        });
        this.worker.postMessage({
            type: 'init',
            moduleUrl: url('firmware.mjs'),
            wasmUrl: url('firmware.wasm'),
            sdUrl: url('sd.img'),
            name: 'Yassin',
            storageKey: 'ofw',
        });
        return this.ready;
    }

    restart() {
        this.stopWorker();
        return this.start();
    }

    press(button: FlipperButton) {
        this.enableSound();
        if (this.state === 'off') {
            if (button === 'back') void this.start();
            return;
        }
        if (this.pressed.has(button)) return;
        window.clearTimeout(this.pendingRelease.get(button));
        this.pendingRelease.delete(button);
        const sent = this.lcd.flipped ? TURNED[button] : button;
        this.pressed.set(button, { at: performance.now(), sent });
        this.send({ type: 'input', key: KEY_INDEX[sent], pressed: true });
        this.emit('button', { button, pressed: true });
    }

    release(button: FlipperButton) {
        const held = this.pressed.get(button);
        if (!held) return;
        this.pressed.delete(button);
        const up = () => {
            this.pendingRelease.delete(button);
            this.send({ type: 'input', key: KEY_INDEX[held.sent], pressed: false });
            this.emit('button', { button, pressed: false });
        };
        const wait = MIN_HOLD_MS - (performance.now() - held.at);
        if (wait > 0) this.pendingRelease.set(button, window.setTimeout(up, wait));
        else up();
    }

    releaseAll() {
        for (const button of [...this.pressed.keys()]) this.release(button);
    }

    pause() {
        if (this.state !== 'running') return;
        this.releaseAll();
        this.setState('paused');
        this.send({ type: 'pause' });
        void this.audio?.context.suspend();
    }

    resume() {
        if (this.state !== 'paused') return;
        this.setState('running');
        this.send({ type: 'resume' });
        void this.audio?.context.resume();
    }

    // backlight stays on while zoomed in, the 30 s timeout applies otherwise
    setAwake(awake: boolean) {
        this.awake = awake;
        this.send({ type: 'awake', awake });
    }

    // backlight on, like a button press, without pressing anything
    wake() {
        this.send({ type: 'wake' });
    }

    // browsers only allow audio after a gesture; press() is always called from one
    enableSound() {
        if (this.audio || typeof AudioContext === 'undefined') return;
        try {
            const context = new AudioContext();
            const osc = context.createOscillator();
            const gain = context.createGain();
            osc.type = 'square';
            gain.gain.value = 0;
            osc.connect(gain).connect(context.destination);
            osc.start();
            this.audio = { context, osc, gain };
        } catch {
            this.audio = null;
        }
    }

    dispose() {
        this.stopWorker();
        void this.audio?.context.close();
        this.audio = null;
        this.setState('idle');
    }

    private stopWorker() {
        this.releaseAll();
        if (this.worker) {
            this.worker.postMessage({ type: 'flush' });
            this.worker.terminate();
        }
        this.worker = null;
        this.ready = null;
        this.lcd.clear();
        this.lcd.draw();
        this.emit('frame', {});
    }

    private send(msg: object) {
        this.worker?.postMessage(msg);
    }

    private emit(type: string, detail: object) {
        this.dispatchEvent(new CustomEvent(type, { detail }));
    }

    private setState(state: FlipperState) {
        this.state = state;
        this.emit('state', { state });
    }

    private fail(text: string) {
        console.warn('[Flipper]', text);
        this.setState('crashed');
    }

    private onMessage(msg: WorkerMessage) {
        switch (msg.type) {
            case 'ready':
                this.setState('running');
                if (this.awake) this.send({ type: 'awake', awake: true });
                break;
            case 'frame':
                // CanvasOrientationHorizontalFlip is left handed mode
                this.lcd.setFrame(msg.pixels, msg.orientation === 1);
                if (this.lcd.draw()) this.emit('frame', {});
                break;
            case 'hw': {
                this.lcd.setBacklight(msg.backlight);
                if (this.lcd.draw()) this.emit('frame', {});
                const blink = msg.blinkActive && msg.blinkPeriodMs > 0;
                const b = msg.blinkBrightness;
                this.led = blink
                    ? {
                          red: msg.blinkLight & 1 ? b : 0,
                          green: msg.blinkLight & 2 ? b : 0,
                          blue: msg.blinkLight & 4 ? b : 0,
                          blinkPeriodMs: msg.blinkPeriodMs,
                          blinkOnMs: msg.blinkOnMs,
                      }
                    : { red: msg.red, green: msg.green, blue: msg.blue, blinkPeriodMs: 0, blinkOnMs: 0 };
                this.emit('led', this.led);
                if (msg.vibro !== this.vibrating) {
                    this.vibrating = msg.vibro;
                    this.emit('vibro', { on: msg.vibro });
                }
                break;
            }
            case 'speaker': {
                if (!this.audio) break;
                const { context, osc, gain } = this.audio;
                const on = msg.frequency > 0 && msg.volume > 0;
                if (on) osc.frequency.setValueAtTime(msg.frequency, context.currentTime);
                gain.gain.setTargetAtTime(on ? SPEAKER_GAIN * Math.min(1, msg.volume) : 0, context.currentTime, 0.004);
                break;
            }
            case 'stats':
                this.workerLoad = msg.busy;
                break;
            case 'power':
                if (msg.what === 'reset') {
                    // settings, power, reboot: the firmware stops right after this
                    this.rebooting = true;
                    window.setTimeout(() => void this.restart(), 300);
                } else {
                    this.stopWorker();
                    this.setState('off');
                }
                break;
            case 'crash':
            case 'error':
                if (this.rebooting) break;
                this.fail(`${msg.text}${msg.where ? ` (${msg.where})` : ''}`);
                break;
        }
    }
}
