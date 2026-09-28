// just enough window and document for the race code to build geometry in node:
// the procedural textures draw on canvases, so those are no-op 2d contexts
// with real image data buffers

const gradient = () => ({ addColorStop() {} });

const context2d = (canvas) => {
    const state = {};
    const special = {
        canvas,
        createLinearGradient: gradient,
        createRadialGradient: gradient,
        createPattern: () => ({}),
        getImageData: (x, y, w, h) => ({
            data: new Uint8ClampedArray(w * h * 4),
            width: w,
            height: h,
        }),
        createImageData: (w, h) => ({
            data: new Uint8ClampedArray(w * h * 4),
            width: w,
            height: h,
        }),
        measureText: (text) => ({ width: String(text).length * 8 }),
    };
    return new Proxy(state, {
        get(target, key) {
            if (key in special) return special[key];
            if (key in target) return target[key];
            return () => {};
        },
        set(target, key, value) {
            target[key] = value;
            return true;
        },
    });
};

const createCanvas = () => {
    const canvas = { width: 300, height: 150, style: {}, nodeName: 'CANVAS' };
    let context = null;
    canvas.getContext = (kind) => {
        if (kind !== '2d') return null;
        context ||= context2d(canvas);
        return context;
    };
    canvas.addEventListener = () => {};
    canvas.removeEventListener = () => {};
    return canvas;
};

if (typeof globalThis.window === 'undefined') {
    globalThis.window = globalThis;
}
if (!globalThis.location) {
    globalThis.location = {
        search: '',
        href: 'http://localhost/',
        hostname: 'localhost',
    };
}
if (typeof globalThis.document === 'undefined') {
    globalThis.document = {
        createElement: (tag) =>
            tag === 'canvas' ? createCanvas() : { style: {} },
        createElementNS: (_ns, tag) =>
            tag === 'canvas' ? createCanvas() : { style: {} },
        addEventListener: () => {},
        removeEventListener: () => {},
        body: { classList: { toggle() {}, add() {}, remove() {} } },
    };
}
