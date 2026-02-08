import UIEventBus from '../../UI/EventBus';

const STEER_LEFT_VALUE = -1;
const STEER_RIGHT_VALUE = 1;

type DrivingInputState = {
    throttle: number;
    brake: number;
    steer: number;
    handbrake: number;
};

export default class DrivingInput {
    enabled: boolean;
    keyState: Record<string, boolean>;
    smoothState: DrivingInputState;
    keyDownHandler: (event: KeyboardEvent) => void;
    keyUpHandler: (event: KeyboardEvent) => void;
    blurHandler: () => void;
    visibilityChangeHandler: () => void;
    pointerLockChangeHandler: () => void;

    constructor() {
        this.enabled = false;
        this.keyState = {};
        this.smoothState = {
            throttle: 0,
            brake: 0,
            steer: 0,
            handbrake: 0,
        };

        this.keyDownHandler = (event: KeyboardEvent) => {
            if (!this.enabled) return;
            if ((event as any).inComputer) return;
            if (this.shouldIgnoreInputTarget(event.target)) {
                return;
            }
            if (event.code === 'Space') {
                event.preventDefault();
            }
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
        }
    }

    reset() {
        this.keyState = {};
        this.smoothState.throttle = 0;
        this.smoothState.brake = 0;
        this.smoothState.steer = 0;
        this.smoothState.handbrake = 0;
    }

    update(deltaSeconds: number) {
        const smoothing = Math.min(1, Math.max(0.08, deltaSeconds * 8));
        const targetThrottle = this.keyState.KeyW ? 1 : 0;
        const targetBrake = this.keyState.KeyS ? 1 : 0;
        const steerLeft = this.keyState.KeyA ? STEER_LEFT_VALUE : 0;
        const steerRight = this.keyState.KeyD ? STEER_RIGHT_VALUE : 0;
        const steerTarget = steerLeft + steerRight;
        const handbrakeTarget = this.keyState.Space ? 1 : 0;

        this.smoothState.throttle +=
            (targetThrottle - this.smoothState.throttle) * smoothing;
        this.smoothState.brake +=
            (targetBrake - this.smoothState.brake) * smoothing;
        this.smoothState.steer +=
            (steerTarget - this.smoothState.steer) * smoothing;
        this.smoothState.handbrake +=
            (handbrakeTarget - this.smoothState.handbrake) * smoothing;
    }

    getState() {
        return this.smoothState;
    }
}
