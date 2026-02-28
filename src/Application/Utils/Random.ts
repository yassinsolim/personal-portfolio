let fallbackState = 0;
let fallbackCounter = 0;

const UINT32_RANGE = 0x100000000;
const UINT32_MAX = 0xffffffff;

function seedFallbackState() {
    if (fallbackState !== 0) return;

    const now = Date.now() >>> 0;
    const perf =
        typeof performance !== 'undefined'
            ? Math.floor(performance.now() * 1000) >>> 0
            : 0;
    fallbackState = (now ^ perf ^ 0x9e3779b9) >>> 0;
    if (fallbackState === 0) {
        fallbackState = 0x6d2b79f5;
    }
}

function nextFallbackUint32() {
    seedFallbackState();
    fallbackCounter = (fallbackCounter + 0x9e3779b9) >>> 0;
    let x = (fallbackState + fallbackCounter) >>> 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    fallbackState = x >>> 0;
    return fallbackState;
}

function getCrypto() {
    if (typeof globalThis === 'undefined') return null;
    if (!globalThis.crypto || !globalThis.crypto.getRandomValues) return null;
    return globalThis.crypto;
}

export function randomUint32() {
    const cryptoRef = getCrypto();
    if (cryptoRef) {
        const values = new Uint32Array(1);
        cryptoRef.getRandomValues(values);
        return values[0] >>> 0;
    }
    return nextFallbackUint32();
}

export function randomFloat01() {
    return randomUint32() / UINT32_RANGE;
}

export function randomRange(min: number, max: number) {
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
        return min;
    }
    const low = Math.min(min, max);
    const high = Math.max(min, max);
    return low + randomFloat01() * (high - low);
}

export function randomInt(maxExclusive: number) {
    const max = Math.floor(maxExclusive);
    if (!Number.isFinite(max) || max <= 0) return 0;

    const limit = UINT32_MAX - ((UINT32_MAX + 1) % max);
    let value = randomUint32();
    while (value > limit) {
        value = randomUint32();
    }
    return value % max;
}

export function randomChoice<T>(values: T[], fallback: T) {
    if (!Array.isArray(values) || values.length === 0) {
        return fallback;
    }
    return values[randomInt(values.length)] ?? fallback;
}
