// controllers through the gamepad api: which pad is in use, its sticks with a
// dead zone, and the buttons of the standard layout (xbox names). no dom here
// beyond navigator, so the tests run it in node

export const BUTTON = {
    A: 0,
    B: 1,
    X: 2,
    Y: 3,
    LB: 4,
    RB: 5,
    LT: 6,
    RT: 7,
    VIEW: 8,
    MENU: 9,
    L3: 10,
    R3: 11,
    UP: 12,
    DOWN: 13,
    LEFT: 14,
    RIGHT: 15,
} as const;

export type Direction = 'up' | 'down' | 'left' | 'right';
export type PadKind = 'xbox' | 'playstation' | 'nintendo';

type PadButton = { pressed: boolean; value: number };
export type PadLike = {
    index: number;
    connected: boolean;
    mapping: string;
    buttons: ReadonlyArray<PadButton>;
    axes: ReadonlyArray<number>;
};

// what the page and the race share: the menus take the pad from the car
// while one is open, and pad mode is on while the pad was the last input
export const padShared = {
    menuOpen: false,
    active: false,
};

// microsoft's, sony's and nintendo's usb vendor ids, or the names browsers
// give the pads (a ps4 pad is just "Wireless Controller" with sony's id)
export const padKind = (id: string): PadKind => {
    const name = id.toLowerCase();
    if (/045e|xbox|xinput/.test(name)) return 'xbox';
    if (/054c|dualsense|dualshock|playstation/.test(name)) return 'playstation';
    if (/057e|nintendo|pro controller|joy-con/.test(name)) return 'nintendo';
    return 'xbox';
};

// a round dead zone, rescaled so a full push still reads 1
export const stick = (
    x: number,
    y: number,
    deadzone = 0.2,
): [number, number] => {
    const length = Math.hypot(x, y);
    if (!Number.isFinite(length) || length <= deadzone) return [0, 0];
    const scale = Math.min(1, (length - deadzone) / (1 - deadzone)) / length;
    return [x * scale, y * scale];
};

// a pad that isn't in the standard layout can rest its triggers at -1 on
// the axes past the left stick, so only that stick counts there
const hasInput = (pad: PadLike) =>
    pad.buttons.some((button) => button.pressed) ||
    (pad.mapping === 'standard' ? pad.axes : pad.axes.slice(0, 2)).some(
        (value) => Math.abs(value) > 0.5,
    );

// stays on one pad until another one is used while it sits idle, so a
// second pad lying around (or a drifting stick) can't take over
export class PadPicker {
    index = -1;

    pick<T extends PadLike>(pads: ArrayLike<T | null>): T | null {
        let current: T | null = null;
        let used: T | null = null;
        let fallback: T | null = null;
        for (let i = 0; i < pads.length; i++) {
            const pad = pads[i];
            if (!pad?.connected) continue;
            if (pad.index === this.index) current = pad;
            else if (!used && hasInput(pad)) used = pad;
            if (
                !fallback ||
                (pad.mapping === 'standard' && fallback.mapping !== 'standard')
            ) {
                fallback = pad;
            }
        }
        const pad =
            current && (!used || hasInput(current))
                ? current
                : used || current || fallback;
        this.index = pad ? pad.index : -1;
        return pad;
    }
}

const picker = new PadPicker();

// the pad in use, for the page and the race alike
export const currentPad = (): Gamepad | null => {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    try {
        return picker.pick(navigator.getGamepads());
    } catch {
        // a permissions policy can turn the api off
        return null;
    }
};

// the d-pad, or the left stick pushed most of the way
export const padDirection = (pad: PadLike): Direction | null => {
    const held = (index: number) => Boolean(pad.buttons[index]?.pressed);
    if (held(BUTTON.UP)) return 'up';
    if (held(BUTTON.DOWN)) return 'down';
    if (held(BUTTON.LEFT)) return 'left';
    if (held(BUTTON.RIGHT)) return 'right';
    const x = pad.axes[0] ?? 0;
    const y = pad.axes[1] ?? 0;
    if (Math.max(Math.abs(x), Math.abs(y)) < 0.55) return null;
    if (Math.abs(x) > Math.abs(y)) return x > 0 ? 'right' : 'left';
    return y > 0 ? 'down' : 'up';
};

// a held direction moves once, then again after a pause, then steadily
export class Repeat {
    held: Direction | null = null;
    next = 0;

    constructor(
        public delay = 380,
        public interval = 110,
    ) {}

    step(direction: Direction | null, now: number): Direction | null {
        if (direction !== this.held) {
            this.held = direction;
            this.next = now + this.delay;
            return direction;
        }
        if (!direction || now < this.next) return null;
        this.next = now + this.interval;
        return direction;
    }
}

const LABELS: Record<PadKind, Record<string, string>> = {
    xbox: {
        A: 'A',
        B: 'B',
        X: 'X',
        Y: 'Y',
        LB: 'LB',
        RB: 'RB',
        LT: 'LT',
        RT: 'RT',
        VIEW: 'View',
        MENU: 'Menu',
    },
    playstation: {
        A: '✕',
        B: '○',
        X: '□',
        Y: '△',
        LB: 'L1',
        RB: 'R1',
        LT: 'L2',
        RT: 'R2',
        VIEW: 'Create',
        MENU: 'Options',
    },
    // the standard layout goes by position: nintendo's bottom button is B
    nintendo: {
        A: 'B',
        B: 'A',
        X: 'Y',
        Y: 'X',
        LB: 'L',
        RB: 'R',
        LT: 'ZL',
        RT: 'ZR',
        VIEW: '−',
        MENU: '+',
    },
};

// what a button is called on the pad in the player's hands
export const buttonLabel = (kind: PadKind, button: string) =>
    LABELS[kind][button] || button;
