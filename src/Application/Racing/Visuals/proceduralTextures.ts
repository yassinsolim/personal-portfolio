import * as THREE from 'three';

// every texture race mode needs is drawn here at runtime, so there's nothing
// extra to download. seeded, so the track looks the same every visit

const rng = (seed: number) => {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

const canvas2d = (width: number, height: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    return { canvas, context };
};

const finish = (
    canvas: HTMLCanvasElement,
    srgb: boolean,
    repeat = true
): THREE.CanvasTexture => {
    const texture = new THREE.CanvasTexture(canvas);
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    if (repeat) {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
    }
    texture.anisotropy = 8;
    texture.needsUpdate = true;
    return texture;
};

// draws a blob at x,y and again across the edges, so the texture tiles
const wrapped = (
    width: number,
    height: number,
    x: number,
    y: number,
    radius: number,
    draw: (x: number, y: number) => void
) => {
    for (const dx of [-width, 0, width]) {
        for (const dy of [-height, 0, height]) {
            const px = x + dx;
            const py = y + dy;
            if (px + radius < 0 || px - radius > width) continue;
            if (py + radius < 0 || py - radius > height) continue;
            draw(px, py);
        }
    }
};

// asphalt across the road (u, 16 m) and along it (v, 32 m): fine aggregate,
// lighter stones, a few repair patches, and darker rubber where the cars run
export const createAsphaltTextures = () => {
    const width = 512;
    const height = 1024;
    const random = rng(1711);
    const albedo = canvas2d(width, height);
    const rough = canvas2d(width, height);
    const ctx = albedo.context;
    const rctx = rough.context;
    if (!ctx || !rctx) {
        return { map: new THREE.Texture(), roughnessMap: new THREE.Texture() };
    }
    ctx.fillStyle = '#4a4c50';
    ctx.fillRect(0, 0, width, height);
    rctx.fillStyle = '#e0e0e0';
    rctx.fillRect(0, 0, width, height);

    // rubbered band: darker and a bit smoother across the middle of the road
    const band = ctx.createLinearGradient(0, 0, width, 0);
    band.addColorStop(0, 'rgba(0,0,0,0)');
    band.addColorStop(0.25, 'rgba(18,18,20,0.22)');
    band.addColorStop(0.5, 'rgba(14,14,16,0.3)');
    band.addColorStop(0.75, 'rgba(18,18,20,0.22)');
    band.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = band;
    ctx.fillRect(0, 0, width, height);
    const roughBand = rctx.createLinearGradient(0, 0, width, 0);
    roughBand.addColorStop(0, 'rgba(0,0,0,0)');
    roughBand.addColorStop(0.5, 'rgba(0,0,0,0.18)');
    roughBand.addColorStop(1, 'rgba(0,0,0,0)');
    rctx.fillStyle = roughBand;
    rctx.fillRect(0, 0, width, height);

    // repair patches
    for (let i = 0; i < 6; i++) {
        const x = random() * width;
        const y = random() * height;
        const w = 60 + random() * 200;
        const h = 80 + random() * 260;
        const shade =
            random() < 0.5 ? 'rgba(20,20,22,0.28)' : 'rgba(95,95,98,0.16)';
        wrapped(width, height, x, y, Math.max(w, h), (px, py) => {
            ctx.fillStyle = shade;
            ctx.fillRect(px, py, w, h);
        });
    }
    // aggregate: many tiny specks, some lighter stones
    const image = ctx.getImageData(0, 0, width, height);
    const roughImage = rctx.getImageData(0, 0, width, height);
    const data = image.data;
    const rdata = roughImage.data;
    for (let i = 0; i < width * height; i++) {
        const n = (random() - 0.5) * 34;
        const stone = random() < 0.035 ? 30 + random() * 40 : 0;
        const pit = random() < 0.02 ? -25 : 0;
        const value = n + stone + pit;
        data[i * 4] = Math.max(0, Math.min(255, data[i * 4] + value));
        data[i * 4 + 1] = Math.max(0, Math.min(255, data[i * 4 + 1] + value));
        data[i * 4 + 2] = Math.max(
            0,
            Math.min(255, data[i * 4 + 2] + value * 1.04)
        );
        const r = (random() - 0.5) * 40 - stone * 0.6;
        rdata[i * 4] = Math.max(0, Math.min(255, rdata[i * 4] + r));
        rdata[i * 4 + 1] = rdata[i * 4];
        rdata[i * 4 + 2] = rdata[i * 4];
    }
    ctx.putImageData(image, 0, 0);
    rctx.putImageData(roughImage, 0, 0);

    // hairline cracks
    ctx.strokeStyle = 'rgba(12,12,14,0.35)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 26; i++) {
        let x = random() * width;
        let y = random() * height;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let k = 0; k < 8; k++) {
            x += (random() - 0.5) * 40;
            y += (random() - 0.5) * 60;
            ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    const map = finish(albedo.canvas as HTMLCanvasElement, true);
    const roughnessMap = finish(rough.canvas as HTMLCanvasElement, false);
    return { map, roughnessMap };
};

// small grass and soil detail, multiplied over the terrain's vertex colors
export const createGrassTexture = () => {
    const size = 256;
    const random = rng(733);
    const { canvas, context } = canvas2d(size, size);
    if (!context) return new THREE.Texture();
    context.fillStyle = '#c4c4c4';
    context.fillRect(0, 0, size, size);
    const image = context.getImageData(0, 0, size, size);
    const data = image.data;
    for (let i = 0; i < size * size; i++) {
        const n = (random() - 0.5) * 70;
        const clump = random() < 0.08 ? 25 : 0;
        data[i * 4] = Math.max(0, Math.min(255, data[i * 4] + n - clump * 0.4));
        data[i * 4 + 1] = Math.max(
            0,
            Math.min(255, data[i * 4 + 1] + n + clump)
        );
        data[i * 4 + 2] = Math.max(0, Math.min(255, data[i * 4 + 2] + n * 0.7));
    }
    context.putImageData(image, 0, 0);
    // blades: short strokes, lighter and darker
    for (let i = 0; i < 1400; i++) {
        const x = random() * size;
        const y = random() * size;
        const light = random() < 0.5;
        context.strokeStyle = light
            ? 'rgba(235,245,215,0.25)'
            : 'rgba(40,50,30,0.25)';
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x + (random() - 0.5) * 3, y - 2 - random() * 4);
        context.stroke();
    }
    return finish(canvas as HTMLCanvasElement, true);
};

export const createCheckerTexture = (columns: number, rows: number) => {
    const cell = 32;
    const { canvas, context } = canvas2d(columns * cell, rows * cell);
    if (!context) return new THREE.Texture();
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < columns; x++) {
            context.fillStyle = (x + y) % 2 === 0 ? '#f2f2ee' : '#141414';
            context.fillRect(x * cell, y * cell, cell, cell);
        }
    }
    const texture = finish(canvas as HTMLCanvasElement, true, false);
    texture.magFilter = THREE.NearestFilter;
    return texture;
};

// white paint letters on the asphalt, a bit rough at the edges
// the timing board on the start gantry
export const createGantryTexture = () => {
    const width = 1024;
    const height = 128;
    const { canvas, context } = canvas2d(width, height);
    if (!context) return new THREE.Texture();
    context.fillStyle = '#0c0f14';
    context.fillRect(0, 0, width, height);
    const cell = 16;
    for (let x = 0; x < 6; x++) {
        for (let y = 0; y < height / cell; y++) {
            context.fillStyle = (x + y) % 2 === 0 ? '#ffffff' : '#101010';
            context.fillRect(x * cell, y * cell, cell, cell);
            context.fillRect(width - (x + 1) * cell, y * cell, cell, cell);
        }
    }
    context.fillStyle = '#f5f5f0';
    context.font = '800 64px "Arial Black", Impact, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('NORDSCHLEIFE', width / 2, height / 2 + 4);
    return finish(canvas as HTMLCanvasElement, true, false);
};

// soft puff with some structure, for tire smoke
export const createSmokeTexture = () => {
    const size = 128;
    const random = rng(99);
    const { canvas, context } = canvas2d(size, size);
    if (!context) return new THREE.Texture();
    context.clearRect(0, 0, size, size);
    for (let i = 0; i < 22; i++) {
        const angle = random() * Math.PI * 2;
        const radius = random() * size * 0.18;
        const x = size / 2 + Math.cos(angle) * radius;
        const y = size / 2 + Math.sin(angle) * radius;
        const r = size * (0.16 + random() * 0.18);
        const gradient = context.createRadialGradient(x, y, 0, x, y, r);
        gradient.addColorStop(0, 'rgba(255,255,255,0.22)');
        gradient.addColorStop(0.6, 'rgba(255,255,255,0.08)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        context.fillStyle = gradient;
        context.fillRect(0, 0, size, size);
    }
    const texture = finish(canvas as HTMLCanvasElement, false, false);
    return texture;
};

// the karussell's concrete slabs: pale, with joints across every few meters
export const createConcreteTexture = () => {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    if (!ctx) return texture;
    const random = rng(97);
    ctx.fillStyle = '#9d9a92';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 2600; i++) {
        const shade = 120 + Math.floor(random() * 60);
        ctx.fillStyle = `rgba(${shade},${shade - 2},${shade - 8},0.35)`;
        ctx.fillRect(
            random() * size,
            random() * size,
            1 + random() * 3,
            1 + random() * 3
        );
    }
    // slab joints and a dark wear line where the tires run
    ctx.fillStyle = 'rgba(40,38,34,0.7)';
    ctx.fillRect(0, 0, size, 3);
    ctx.fillRect(Math.round(size / 2) - 1, 0, 2, size);
    ctx.fillStyle = 'rgba(30,30,30,0.18)';
    ctx.fillRect(size * 0.22, 0, size * 0.14, size);
    ctx.fillRect(size * 0.64, 0, size * 0.14, size);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
    return texture;
};
