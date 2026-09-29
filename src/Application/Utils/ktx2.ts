import * as THREE from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

// the decoder runs in a real same origin worker file (scripts/build-ktx2-worker.mjs),
// never a blob, so it gets its own content security policy from vercel.json
// ('unsafe-eval' for the emscripten transcoder) and the page's stays strict
const WORKER_URL = 'basis/ktx2-worker.js';
const HANG_WORKER_URL = 'basis/hang-worker.js';
const WASM_URL = 'basis/basis_transcoder.wasm';
const PROBE_URL = 'textures/ktx2-probe.ktx2';
const PROBE_TIMEOUT_MS = 5000;

// testing: ?raceDebug=1&ktx2fail=worker (worker won't load), hang (worker
// never answers) or probe (probe file missing)
const forcedFailure = () => {
    try {
        const params = new URLSearchParams(window.location.search);
        if (params.get('raceDebug') !== '1') return '';
        return params.get('ktx2fail') || '';
    } catch {
        return '';
    }
};

type LoaderInternals = {
    transcoderPending: Promise<void> | null;
    transcoderBinary: ArrayBuffer;
    workerConfig: unknown;
    workerPool: { setWorkerCreator: (create: () => Worker) => void };
    manager: THREE.LoadingManager;
};

const FORMAT_NAMES: Record<number, string> = {
    [THREE.RGBA_ASTC_4x4_Format]: 'ASTC 4x4',
    [THREE.RGBA_BPTC_Format]: 'BC7',
    [THREE.RGBA_S3TC_DXT5_Format]: 'BC3',
    [THREE.RGB_S3TC_DXT1_Format]: 'BC1',
    [THREE.RGBA_ETC2_EAC_Format]: 'ETC2 RGBA',
    [THREE.RGB_ETC2_Format]: 'ETC2 RGB',
    [THREE.RGB_ETC1_Format]: 'ETC1',
    [THREE.RGBA_PVRTC_4BPPV1_Format]: 'PVRTC',
    [THREE.RGBAFormat]: 'RGBA8',
};

export type TranscodeReport = {
    ms: number;
    width: number;
    height: number;
    format: string;
    probe: boolean;
};

export class SameOriginKTX2Loader extends KTX2Loader {
    failed = false;
    private failureListeners = new Set<() => void>();
    private probing = false;
    // each texture the worker transcodes, for the loading screens
    onTranscode: ((report: TranscodeReport) => void) | null = null;

    async _createTexture(buffer: ArrayBuffer, config = {}) {
        const startedAt = performance.now();
        const probe = this.probing;
        // @ts-ignore three's types don't list the transcode step
        const texture: THREE.Texture = await super._createTexture(buffer, config);
        const image = texture.image as { width?: number; height?: number } | undefined;
        this.onTranscode?.({
            ms: performance.now() - startedAt,
            width: image?.width || 0,
            height: image?.height || 0,
            format: FORMAT_NAMES[texture.format as number] || String(texture.format),
            probe,
        });
        return texture;
    }

    init() {
        const self = this as unknown as LoaderInternals;
        if (!self.transcoderPending) {
            const failure = forcedFailure();
            const workerUrl =
                failure === 'worker'
                    ? 'basis/missing-worker.js'
                    : failure === 'hang'
                      ? HANG_WORKER_URL
                      : WORKER_URL;
            const binaryLoader = new THREE.FileLoader(self.manager);
            binaryLoader.setResponseType('arraybuffer');
            self.transcoderPending = binaryLoader
                .loadAsync(WASM_URL)
                .then((binary) => {
                    self.transcoderBinary = binary as ArrayBuffer;
                    self.workerPool.setWorkerCreator(() => {
                        const worker = new Worker(workerUrl);
                        // a policy block, a missing file or a crash in the
                        // transcoder all land here, and the loads fall back
                        worker.addEventListener('error', () => this.fail());
                        const copy = self.transcoderBinary.slice(0);
                        worker.postMessage(
                            {
                                type: 'init',
                                config: self.workerConfig,
                                transcoderBinary: copy,
                            },
                            [copy]
                        );
                        return worker;
                    });
                });
        }
        return self.transcoderPending;
    }

    onFailure(listener: () => void) {
        if (this.failed) {
            listener();
            return () => undefined;
        }
        this.failureListeners.add(listener);
        return () => this.failureListeners.delete(listener);
    }

    fail() {
        if (this.failed) return;
        this.failed = true;
        console.warn('[KTX2] decoder unavailable, using the webp models');
        this.failureListeners.forEach((listener) => listener());
        this.failureListeners.clear();
    }

    // decodes a 451 byte texture, so a broken or blocked decoder is known
    // before any car commits to its ktx2 file
    probe(): Promise<boolean> {
        const url =
            forcedFailure() === 'probe'
                ? 'textures/missing-probe.ktx2'
                : PROBE_URL;
        this.probing = true;
        return new Promise<boolean>((resolve) => {
            let settled = false;
            const finish = (ok: boolean) => {
                if (settled) return;
                settled = true;
                this.probing = false;
                window.clearTimeout(timer);
                stop();
                if (!ok) this.fail();
                resolve(ok);
            };
            const timer = window.setTimeout(
                () => finish(false),
                PROBE_TIMEOUT_MS
            );
            const stop = this.onFailure(() => finish(false));
            this.loadAsync(url).then(
                (texture) => {
                    texture.dispose();
                    finish(true);
                },
                () => finish(false)
            );
        });
    }
}
