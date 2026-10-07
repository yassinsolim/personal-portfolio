import UIEventBus from '../../UI/EventBus';
import { BUTTON, currentPad, padShared, stick } from '../../Gamepad/pad';
import { clampSteering, readSteering, steerRates, stickCurve } from './steering';

// steer is positive to the left (toward positive yaw): A and the left arrow
// give +1, D and the right arrow give -1
const STEER_LEFT_KEYS = ['KeyA', 'ArrowLeft'];
const STEER_RIGHT_KEYS = ['KeyD', 'ArrowRight'];
const THROTTLE_KEYS = ['KeyW', 'ArrowUp'];
const BRAKE_KEYS = ['KeyS', 'ArrowDown'];
const HANDBRAKE_KEYS = ['Space'];
const RESET_KEYS = ['KeyR'];
const RESTART_KEYS = ['KeyT', 'Backspace'];
const SHIFT_UP_KEYS = ['KeyE'];
const SHIFT_DOWN_KEYS = ['KeyQ'];
const HORN_KEYS = ['KeyH'];
const REWIND_KEYS = ['KeyZ'];
const PREVENT_DEFAULT_KEYS = new Set([
    'Space',
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'Backspace',
]);

// keyboard ramps per second (the steering's are in ./steering.ts)
const THROTTLE_RISE = 7;
const THROTTLE_RELEASE = 11;
const BRAKE_RISE = 9;
const BRAKE_RELEASE = 12;
const HANDBRAKE_RISE = 16;
const HANDBRAKE_RELEASE = 12;

// standard gamepad layout
const PAD_A = BUTTON.A;
const PAD_B = BUTTON.B;
const PAD_X = BUTTON.X;
const PAD_Y = BUTTON.Y;
const PAD_LB = BUTTON.LB;
const PAD_RB = BUTTON.RB;
const PAD_LT = BUTTON.LT;
const PAD_RT = BUTTON.RT;
const PAD_VIEW = BUTTON.VIEW;
const PAD_MENU = BUTTON.MENU;
const PAD_LEFT = BUTTON.LEFT;
const PAD_RIGHT = BUTTON.RIGHT;
const PAD_HORN = BUTTON.L3;
const PAD_REWIND = BUTTON.DOWN;
const STICK_DEADZONE = 0.08;
const LOOK_DEADZONE = 0.2;
const TRIGGER_DEADZONE = 0.04;
const RUMBLE_INTERVAL_MS = 90;

export type InputSource = 'keyboard' | 'gamepad' | 'touch';

export type DrivingInputState = {
    throttle: number;
    brake: number;
    steer: number;
    handbrake: number;
};

type TouchControlName =
    | 'throttle'
    | 'brake'
    | 'steerLeft'
    | 'steerRight'
    | 'handbrake';

type RumbleActuator = {
    playEffect?: (
        type: string,
        params: {
            duration: number;
            strongMagnitude: number;
            weakMagnitude: number;
        }
    ) => Promise<unknown>;
};

const moveToward = (value: number, target: number, maxDelta: number) =>
    value < target
        ? Math.min(target, value + maxDelta)
        : Math.max(target, value - maxDelta);

export default class DrivingInput {
    enabled: boolean;
    keyState: Record<string, boolean>;
    touchState: Record<TouchControlName, boolean>;
    smoothState: DrivingInputState;
    // what the driver asks for this step before any smoothing (a held key,
    // a pad trigger), so a lap clock can tell real input from a ramp down
    intent = { throttle: 0, brake: 0 };
    // the right stick looks around the car and B looks back, read by the
    // chase camera
    look = { x: 0, y: 0, back: false };
    // held: h or the left stick click
    horn = false;
    padHorn = false;
    // held: z or down on the d-pad
    rewind = false;
    padRewind = false;
    source: InputSource;
    padButtons: boolean[];
    pendingShift: number;
    // the pause menu's steering slider
    sensitivity = readSteering();
    rumbleEnabled: boolean;
    lastRumbleAt: number;
    keyDownHandler: (event: KeyboardEvent) => void;
    keyUpHandler: (event: KeyboardEvent) => void;
    blurHandler: () => void;
    visibilityChangeHandler: () => void;
    pointerLockChangeHandler: () => void;

    constructor() {
        this.enabled = false;
        this.keyState = {};
        this.touchState = {
            throttle: false,
            brake: false,
            steerLeft: false,
            steerRight: false,
            handbrake: false,
        };
        this.smoothState = {
            throttle: 0,
            brake: 0,
            steer: 0,
            handbrake: 0,
        };
        this.source = 'keyboard';
        this.padButtons = [];
        this.pendingShift = 0;
        this.rumbleEnabled = true;
        this.lastRumbleAt = 0;

        this.keyDownHandler = (event: KeyboardEvent) => {
            if (!this.enabled) return;
            if (
                (event as KeyboardEvent & { inComputer?: boolean }).inComputer
            ) {
                return;
            }
            if (this.shouldIgnoreInputTarget(event.target)) {
                return;
            }
            if (PREVENT_DEFAULT_KEYS.has(event.code)) {
                event.preventDefault();
            }
            this.source = 'keyboard';
            if (!event.repeat) this.handleActionKey(event.code);
            this.keyState[event.code] = true;
        };

        this.keyUpHandler = (event: KeyboardEvent) => {
            this.keyState[event.code] = false;
        };

        this.blurHandler = () => {
            this.reset();
        };

        this.visibilityChangeHandler = () => {
            if (document.visibilityState !== 'visible') {
                this.reset();
            }
        };

        this.pointerLockChangeHandler = () => {
            if (!this.enabled) return;
            if (document.pointerLockElement === null) {
                this.reset();
            }
        };

        document.addEventListener('keydown', this.keyDownHandler);
        document.addEventListener('keyup', this.keyUpHandler);
        window.addEventListener('blur', this.blurHandler);
        document.addEventListener(
            'visibilitychange',
            this.visibilityChangeHandler
        );
        document.addEventListener(
            'pointerlockchange',
            this.pointerLockChangeHandler
        );

        UIEventBus.on('race:inputReset', () => {
            this.reset();
        });

        UIEventBus.on(
            'race:touchControl',
            (
                payload:
                    | {
                          control?: TouchControlName;
                          active?: boolean;
                      }
                    | undefined
            ) => {
                if (!payload?.control) return;
                if (!(payload.control in this.touchState)) return;
                this.touchState[payload.control] = Boolean(payload.active);
                this.source = 'touch';
            }
        );

        UIEventBus.on(
            'race:rumble',
            (payload: { enabled?: boolean } | undefined) => {
                this.rumbleEnabled = payload?.enabled !== false;
            }
        );

        UIEventBus.on(
            'race:steering',
            (payload: { sensitivity?: number } | undefined) => {
                this.sensitivity = clampSteering(Number(payload?.sensitivity));
            }
        );
    }

    handleActionKey(code: string) {
        if (RESET_KEYS.includes(code)) {
            UIEventBus.dispatch('race:resetVehicle', { source: 'keyboard' });
        } else if (RESTART_KEYS.includes(code)) {
            UIEventBus.dispatch('race:restartLap', { source: 'keyboard' });
        } else if (SHIFT_UP_KEYS.includes(code)) {
            this.pendingShift = 1;
        } else if (SHIFT_DOWN_KEYS.includes(code)) {
            this.pendingShift = -1;
        }
    }

    shouldIgnoreInputTarget(target: EventTarget | null) {
        if (!(target instanceof HTMLElement)) return false;
        const tag = (target.tagName || '').toLowerCase();
        return tag === 'input' || tag === 'textarea' || tag === 'select';
    }

    setEnabled(enabled: boolean) {
        this.enabled = enabled;
        if (!enabled) {
            this.reset();
            return;
        }
        // a button still held from the menu that started or resumed the
        // race isn't a new press
        const pad = this.getGamepad();
        if (pad) this.syncPad(pad);
    }

    reset() {
        this.keyState = {};
        this.touchState.throttle = false;
        this.touchState.brake = false;
        this.touchState.steerLeft = false;
        this.touchState.steerRight = false;
        this.touchState.handbrake = false;
        this.smoothState.throttle = 0;
        this.smoothState.brake = 0;
        this.intent.throttle = 0;
        this.intent.brake = 0;
        this.smoothState.steer = 0;
        this.smoothState.handbrake = 0;
        this.pendingShift = 0;
        this.look.x = 0;
        this.look.y = 0;
        this.look.back = false;
        this.horn = false;
        this.padHorn = false;
        this.rewind = false;
        this.padRewind = false;
    }

    anyKey(codes: string[]) {
        return codes.some((code) => this.keyState[code]);
    }

    // the pad in use, shared with the page (Gamepad/pad.ts): any layout, the
    // last one used
    getGamepad(): Gamepad | null {
        return currentPad();
    }

    syncPad(pad: Gamepad) {
        pad.buttons.forEach((button, index) => {
            this.padButtons[index] = button.pressed;
        });
    }

    // edge-triggered buttons on the pad
    padPressed(pad: Gamepad, index: number) {
        const down = Boolean(pad.buttons[index]?.pressed);
        const was = this.padButtons[index] === true;
        this.padButtons[index] = down;
        return down && !was;
    }

    readGamepad(): DrivingInputState | null {
        const pad = this.getGamepad();
        // a menu over the race (lobby card, garage) or the fly in has the pad
        if (!pad || padShared.menuOpen) {
            if (pad) this.syncPad(pad);
            this.look.x = 0;
            this.look.y = 0;
            this.look.back = false;
            this.padHorn = false;
            this.padRewind = false;
            return null;
        }
        const steerAxis = pad.axes[0] ?? 0;
        const magnitude = Math.max(
            0,
            (Math.abs(steerAxis) - STICK_DEADZONE) / (1 - STICK_DEADZONE)
        );
        let steer =
            -Math.sign(steerAxis) *
            Math.pow(Math.min(1, magnitude), stickCurve(this.sensitivity));
        if (steer === 0) {
            if (pad.buttons[PAD_LEFT]?.pressed) steer = 1;
            if (pad.buttons[PAD_RIGHT]?.pressed) steer = -1;
        }
        const trigger = (index: number) => {
            const value = pad.buttons[index]?.value ?? 0;
            return value > TRIGGER_DEADZONE ? value : 0;
        };
        const state = {
            throttle: trigger(PAD_RT),
            brake: trigger(PAD_LT),
            steer,
            handbrake: pad.buttons[PAD_A]?.pressed ? 1 : 0,
        };

        if (this.padPressed(pad, PAD_Y)) {
            UIEventBus.dispatch('race:resetVehicle', { source: 'gamepad' });
        }
        if (this.padPressed(pad, PAD_VIEW)) {
            UIEventBus.dispatch('race:restartLap', { source: 'gamepad' });
        }
        if (this.padPressed(pad, PAD_MENU)) {
            UIEventBus.dispatch('race:pauseRequest', { source: 'gamepad' });
        }
        if (this.padPressed(pad, PAD_RB)) this.pendingShift = 1;
        if (this.padPressed(pad, PAD_LB)) this.pendingShift = -1;
        if (this.padPressed(pad, PAD_X)) {
            UIEventBus.dispatch('race:cycleCamera', { source: 'gamepad' });
        }
        const [lookX, lookY] = stick(pad.axes[2] ?? 0, pad.axes[3] ?? 0, LOOK_DEADZONE);
        this.look.x = lookX;
        this.look.y = lookY;
        this.look.back = Boolean(pad.buttons[PAD_B]?.pressed);
        this.padHorn = Boolean(pad.buttons[PAD_HORN]?.pressed);
        this.padRewind = Boolean(pad.buttons[PAD_REWIND]?.pressed);

        const active =
            state.throttle > 0 ||
            state.brake > 0 ||
            state.handbrake > 0 ||
            Math.abs(steer) > 0 ||
            lookX !== 0 ||
            lookY !== 0 ||
            this.look.back;
        if (active) this.source = 'gamepad';
        return state;
    }

    update(deltaSeconds: number) {
        const dt = Math.min(0.1, Math.max(0, deltaSeconds));
        const pad = this.enabled ? this.readGamepad() : null;
        const smooth = this.smoothState;
        this.horn = this.enabled && (this.anyKey(HORN_KEYS) || (pad !== null && this.padHorn));
        this.rewind =
            this.enabled && (this.anyKey(REWIND_KEYS) || (pad !== null && this.padRewind));

        if (pad && this.source === 'gamepad') {
            this.intent.throttle = pad.throttle;
            this.intent.brake = pad.brake;
            // analog: follow the pad closely, just take the edge off
            const follow = Math.min(1, dt * 30);
            smooth.throttle += (pad.throttle - smooth.throttle) * follow;
            smooth.brake += (pad.brake - smooth.brake) * follow;
            smooth.steer += (pad.steer - smooth.steer) * Math.min(1, dt * 22);
            smooth.handbrake = moveToward(
                smooth.handbrake,
                pad.handbrake,
                dt * HANDBRAKE_RISE
            );
            return;
        }

        const throttleTarget =
            this.anyKey(THROTTLE_KEYS) || this.touchState.throttle ? 1 : 0;
        const brakeTarget =
            this.anyKey(BRAKE_KEYS) || this.touchState.brake ? 1 : 0;
        this.intent.throttle = throttleTarget;
        this.intent.brake = brakeTarget;
        // the touch buttons keep their old names: steerRight is the A button,
        // which steers left
        const left = this.anyKey(STEER_LEFT_KEYS) || this.touchState.steerRight;
        const right =
            this.anyKey(STEER_RIGHT_KEYS) || this.touchState.steerLeft;
        const steerTarget = (left ? 1 : 0) - (right ? 1 : 0);
        const handbrakeTarget =
            this.anyKey(HANDBRAKE_KEYS) || this.touchState.handbrake ? 1 : 0;

        smooth.throttle = moveToward(
            smooth.throttle,
            throttleTarget,
            dt *
                (throttleTarget > smooth.throttle
                    ? THROTTLE_RISE
                    : THROTTLE_RELEASE)
        );
        smooth.brake = moveToward(
            smooth.brake,
            brakeTarget,
            dt * (brakeTarget > smooth.brake ? BRAKE_RISE : BRAKE_RELEASE)
        );
        const rates = steerRates(this.sensitivity);
        let steerRate = rates.rise;
        if (steerTarget === 0) steerRate = rates.release;
        else if (
            Math.sign(steerTarget) !== Math.sign(smooth.steer) &&
            smooth.steer !== 0
        ) {
            steerRate = rates.reverse;
        }
        smooth.steer = moveToward(smooth.steer, steerTarget, dt * steerRate);
        smooth.handbrake = moveToward(
            smooth.handbrake,
            handbrakeTarget,
            dt *
                (handbrakeTarget > smooth.handbrake
                    ? HANDBRAKE_RISE
                    : HANDBRAKE_RELEASE)
        );
    }

    consumeShift() {
        const shift = this.pendingShift;
        this.pendingShift = 0;
        return shift;
    }

    // short rumble pulses on the pad: slides buzz lightly, hits thump
    rumble(slide: number, impact: number) {
        if (!this.rumbleEnabled || this.source !== 'gamepad') return;
        const now = performance.now();
        if (now - this.lastRumbleAt < RUMBLE_INTERVAL_MS) return;
        const strong = Math.min(1, impact * 0.12);
        const weak = Math.min(0.6, slide * 0.5);
        if (strong < 0.05 && weak < 0.08) return;
        const pad = this.getGamepad();
        const actuator = (
            pad as (Gamepad & { vibrationActuator?: RumbleActuator }) | null
        )?.vibrationActuator;
        if (!actuator?.playEffect) return;
        this.lastRumbleAt = now;
        actuator
            .playEffect('dual-rumble', {
                duration: strong > 0.05 ? 160 : RUMBLE_INTERVAL_MS + 20,
                strongMagnitude: strong,
                weakMagnitude: weak,
            })
            .catch(() => undefined);
    }

    getSource() {
        return this.source;
    }

    getState() {
        return this.smoothState;
    }
}
