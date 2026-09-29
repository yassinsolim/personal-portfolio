// draws the flipper's 128x64 framebuffer like its backlit st7567 lcd.
// the framebuffer is u8g2's tile layout: 8 pages of 128 bytes, bit 0 of each
// byte is the top pixel of that page.

export const LCD_WIDTH = 128;
export const LCD_HEIGHT = 64;

type Rgb = [number, number, number];

// by eye against photos of the device: warm orange backlight, near black ink
const LIT = { ghost: [246, 130, 18] as Rgb, gap: [236, 122, 16] as Rgb, ink: [26, 16, 6] as Rgb };
const DARK = { ghost: [40, 30, 20] as Rgb, gap: [36, 27, 18] as Rgb, ink: [16, 12, 8] as Rgb };

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
];

export default class FlipperLcd {
    readonly canvas: HTMLCanvasElement;
    readonly scale: number;
    private readonly grid: boolean;
    private readonly ctx: CanvasRenderingContext2D;
    private readonly image: ImageData;
    private pixels = new Uint8Array(1024);
    private dirty = true;
    backlight = 0;
    // left handed mode draws the frame upside down; the room shows it upright
    flipped = false;

    constructor(scale = 4) {
        this.scale = scale;
        this.grid = scale >= 3;
        this.canvas = document.createElement('canvas');
        this.canvas.width = LCD_WIDTH * scale;
        this.canvas.height = LCD_HEIGHT * scale;
        this.ctx = this.canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
        this.image = this.ctx.createImageData(this.canvas.width, this.canvas.height);
        this.draw();
    }

    setFrame(pixels: Uint8Array, flipped: boolean) {
        this.pixels.set(pixels);
        this.flipped = flipped;
        this.dirty = true;
    }

    clear() {
        this.pixels.fill(0);
        this.backlight = 0;
        this.dirty = true;
    }

    setBacklight(value: number) {
        if (value === this.backlight) return;
        this.backlight = value;
        this.dirty = true;
    }

    // returns true when the canvas changed
    draw() {
        if (!this.dirty) return false;
        this.dirty = false;
        const { scale, grid, pixels, flipped } = this;
        const data = this.image.data;
        const width = this.canvas.width;
        const t = this.backlight / 255;
        const ghost = mix(DARK.ghost, LIT.ghost, t);
        const gap = mix(DARK.gap, LIT.gap, t);
        const ink = mix(DARK.ink, LIT.ink, t);

        for (let y = 0; y < LCD_HEIGHT; y++) {
            const sy0 = flipped ? LCD_HEIGHT - 1 - y : y;
            for (let x = 0; x < LCD_WIDTH; x++) {
                const sx0 = flipped ? LCD_WIDTH - 1 - x : x;
                const on = (pixels[(sy0 >> 3) * LCD_WIDTH + sx0] >> (sy0 & 7)) & 1;
                const fill = on ? ink : ghost;
                for (let sy = 0; sy < scale; sy++) {
                    let offset = ((y * scale + sy) * width + x * scale) * 4;
                    for (let sx = 0; sx < scale; sx++) {
                        const edge = grid && (sx === scale - 1 || sy === scale - 1);
                        const c = edge && !on ? gap : fill;
                        data[offset] = c[0];
                        data[offset + 1] = c[1];
                        data[offset + 2] = c[2];
                        data[offset + 3] = 255;
                        offset += 4;
                    }
                }
            }
        }
        this.ctx.putImageData(this.image, 0, 0);
        return true;
    }
}
