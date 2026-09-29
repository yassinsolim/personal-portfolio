// runs the webassembly flipper firmware in a dedicated worker.
// the page talks to it only through postMessage, which keeps the gpl firmware
// a separate program from whatever site embeds it.
// gpl-3.0-or-later (part of flipper-wasm).

const STEP_INTERVAL_MS = 16;
const PERSIST_INTERVAL_MS = 2000;
// what the firmware writes that is worth keeping: settings, dolphin state, app data
const PERSIST_ROOTS = ['/sd/.int', '/sd/apps_data'];
const MAX_CATCHUP_MS = 100;

let mod = null;
let running = false;
let timer = 0;
let lastTime = 0;
let carry = 0;
let lastFrameSeq = -1;
let lastLightSeq = -1;
let lastSpeakerSeq = -1;
let crashed = false;
let busyMs = 0;
let statsFrom = 0;
let store = null;
let persistTimer = 0;
const persisted = new Map();

self.onmessage = (event) => {
    const msg = event.data;
    switch (msg.type) {
        case 'init':
            init(msg).catch((err) => post({ type: 'error', text: String(err && err.stack || err) }));
            break;
        case 'input':
            if (mod && !crashed) mod._flipper_input(msg.key, msg.pressed ? 1 : 0);
            break;
        case 'pause':
            pause();
            break;
        case 'resume':
            resume();
            break;
        case 'battery':
            if (mod) mod._flipper_set_battery(msg.percent, msg.usb ? 1 : 0);
            break;
        case 'awake':
            if (mod && !crashed) mod._flipper_set_awake(msg.awake ? 1 : 0);
            break;
        case 'wake':
            if (mod && !crashed) mod._flipper_wake();
            break;
        case 'flush':
            persistNow();
            break;
        case 'reset-storage':
            store.clear().then(() => post({ type: 'storage-cleared' }));
            break;
    }
};

function post(msg, transfer) {
    self.postMessage(msg, transfer || []);
}

async function init({ moduleUrl, wasmUrl, sdUrl, name, storageKey }) {
    store = new SdStore(storageKey || 'ofw');
    const [{ default: createFlipper }, sd, saved] = await Promise.all([
        import(moduleUrl),
        fetch(sdUrl).then((r) => {
            if (!r.ok) throw new Error(`sd image: ${r.status}`);
            // the sd image is a gzipped tar, unpacked here so any static host works
            if (!sdUrl.split('?')[0].endsWith('.tar')) {
                return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
            }
            return r.arrayBuffer();
        }),
        store.load().catch(() => new Map()),
    ]);

    mod = await createFlipper({
        locateFile: (file) => (file.endsWith('.wasm') ? wasmUrl : file),
        print: (text) => post({ type: 'log', text }),
        printErr: (text) => post({ type: 'log', text, error: true }),
        onFlipperCrash: (text, where, halt) => {
            crashed = true;
            post({ type: 'crash', text, where, halt });
        },
        onFlipperPower: (what) => post({ type: 'power', what }),
        preRun: [
            (m) => {
                untar(m.FS, new Uint8Array(sd), '/sd');
                restore(m.FS, saved);
            },
        ],
    });

    if (name) {
        const ptr = mod.stringToNewUTF8(name);
        mod._flipper_set_name(ptr);
        mod._free(ptr);
    }

    mod._flipper_boot();
    post({ type: 'ready' });
    resume();
    persistTimer = setInterval(persistNow, PERSIST_INTERVAL_MS);
}

function resume() {
    if (!mod || running || crashed) return;
    running = true;
    lastTime = performance.now();
    carry = 0;
    tick();
}

function pause() {
    running = false;
    clearTimeout(timer);
    persistNow();
}

function tick() {
    if (!running) return;
    const now = performance.now();
    // virtual time only moves while running, so a paused device just freezes
    carry += Math.min(now - lastTime, MAX_CATCHUP_MS);
    lastTime = now;
    const ms = Math.floor(carry);
    carry -= ms;

    if (ms > 0) {
        try {
            const t0 = performance.now();
            mod._flipper_step(ms);
            busyMs += performance.now() - t0;
        } catch (err) {
            running = false;
            if (!crashed) post({ type: 'crash', text: String(err && err.message || err), where: 'runtime' });
            crashed = true;
            return;
        }
        publish();
    }
    // share of wall time spent running the firmware, every 2 s
    if (now - statsFrom >= 2000) {
        if (statsFrom) post({ type: 'stats', busy: busyMs / (now - statsFrom) });
        statsFrom = now;
        busyMs = 0;
    }
    timer = setTimeout(tick, STEP_INTERVAL_MS);
}

function publish() {
    const heap = mod.HEAPU8;
    const framePtr = mod._flipper_frame();
    const view = new DataView(heap.buffer);
    const seq = view.getUint32(framePtr, true);
    if (seq !== lastFrameSeq) {
        lastFrameSeq = seq;
        const orientation = view.getUint32(framePtr + 4, true);
        const pixels = heap.slice(framePtr + 8, framePtr + 8 + 1024);
        post({ type: 'frame', seq, orientation, pixels }, [pixels.buffer]);
    }

    // layout matches port/target/wasm_hw_state.h
    const hw = mod._flipper_hw_state();
    const lightSeq = view.getUint32(hw, true);
    if (lightSeq !== lastLightSeq) {
        lastLightSeq = lightSeq;
        post({
            type: 'hw',
            red: heap[hw + 4],
            green: heap[hw + 5],
            blue: heap[hw + 6],
            backlight: heap[hw + 7],
            blinkActive: heap[hw + 8] === 1,
            blinkLight: heap[hw + 9],
            blinkBrightness: heap[hw + 10],
            vibro: heap[hw + 11] === 1,
            blinkOnMs: view.getUint16(hw + 12, true),
            blinkPeriodMs: view.getUint16(hw + 14, true),
        });
    }
    const speakerSeq = view.getUint32(hw + 16, true);
    if (speakerSeq !== lastSpeakerSeq) {
        lastSpeakerSeq = speakerSeq;
        post({
            type: 'speaker',
            frequency: view.getFloat32(hw + 20, true),
            volume: view.getFloat32(hw + 24, true),
        });
    }
}

// minimal ustar reader for the sd card image
function untar(FS, bytes, root) {
    const decoder = new TextDecoder();
    const text = (start, length) => {
        let end = start;
        while (end < start + length && bytes[end] !== 0) end++;
        return decoder.decode(bytes.subarray(start, end));
    };
    FS.mkdirTree(root);
    let offset = 0;
    while (offset + 512 <= bytes.length) {
        if (bytes[offset] === 0) break;
        const name = text(offset, 100);
        const size = parseInt(text(offset + 124, 12).trim() || '0', 8);
        const type = String.fromCharCode(bytes[offset + 156] || 48);
        const prefix = text(offset + 345, 155);
        offset += 512;
        const rel = ((prefix ? prefix + '/' : '') + name).replace(/^\.\//, '').replace(/\/$/, '');
        if (rel && rel !== '.' && !rel.split('/').some((part) => part.startsWith('._'))) {
            const full = `${root}/${rel}`;
            if (type === '5') {
                FS.mkdirTree(full);
            } else if (type === '0') {
                FS.mkdirTree(full.slice(0, full.lastIndexOf('/')));
                FS.writeFile(full, bytes.subarray(offset, offset + size));
            }
        }
        offset += Math.ceil(size / 512) * 512;
    }
}

// settings and dolphin progress survive reloads through indexeddb
class SdStore {
    constructor(key) {
        this.name = `flipper-wasm-${key}`;
        this.db = null;
    }

    open() {
        if (this.db) return Promise.resolve(this.db);
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(this.name, 1);
            req.onupgradeneeded = () => req.result.createObjectStore('files');
            req.onsuccess = () => resolve((this.db = req.result));
            req.onerror = () => reject(req.error);
        });
    }

    async load() {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const files = new Map();
            const req = db.transaction('files').objectStore('files').openCursor();
            req.onsuccess = () => {
                const cursor = req.result;
                if (!cursor) return resolve(files);
                files.set(cursor.key, new Uint8Array(cursor.value));
                cursor.continue();
            };
            req.onerror = () => reject(req.error);
        });
    }

    async write(puts, deletes) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('files', 'readwrite');
            const os = tx.objectStore('files');
            for (const [path, data] of puts) os.put(data, path);
            for (const path of deletes) os.delete(path);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
    }

    async clear() {
        const db = await this.open();
        return new Promise((resolve) => {
            const tx = db.transaction('files', 'readwrite');
            tx.objectStore('files').clear();
            tx.oncomplete = resolve;
        });
    }
}

function restore(FS, saved) {
    for (const [path, data] of saved) {
        FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
        FS.writeFile(path, data);
        persisted.set(path, signature(data));
    }
}

function signature(data) {
    let hash = 2166136261;
    for (let i = 0; i < data.length; i++) hash = Math.imul(hash ^ data[i], 16777619);
    return `${data.length}:${hash >>> 0}`;
}

function walk(FS, dir, out) {
    let names;
    try {
        names = FS.readdir(dir);
    } catch {
        return;
    }
    for (const name of names) {
        if (name === '.' || name === '..') continue;
        const path = `${dir}/${name}`;
        const stat = FS.stat(path);
        if (FS.isDir(stat.mode)) walk(FS, path, out);
        else out.push(path);
    }
}

function persistNow() {
    if (!mod || !store) return;
    const files = [];
    for (const root of PERSIST_ROOTS) walk(mod.FS, root, files);
    const puts = [];
    const seen = new Set();
    for (const path of files) {
        seen.add(path);
        const data = mod.FS.readFile(path);
        const sig = signature(data);
        if (persisted.get(path) !== sig) {
            persisted.set(path, sig);
            puts.push([path, data.slice()]);
        }
    }
    const deletes = [...persisted.keys()].filter((path) => !seen.has(path));
    for (const path of deletes) persisted.delete(path);
    if (puts.length || deletes.length) store.write(puts, deletes).catch(() => {});
}
