import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SameOriginKTX2Loader } from './ktx2';
import {
    DRACO_GLTF_CONFIG,
    DRACOLoader,
} from 'three/examples/jsm/loaders/DRACOLoader.js';
import Application from '../Application';
import UIEventBus from '../UI/EventBus';
import EventEmitter from './EventEmitter';
import Loading from './Loading';
import { disableTransmission } from './Transmission';

// browsers without 'wasm-unsafe-eval' support in CSP block wasm entirely,
// so draco has to fall back to its asm.js decoder there
const canCompileWasm = () => {
    if (typeof WebAssembly !== 'object') return false;
    try {
        new WebAssembly.Module(
            new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])
        );
        return true;
    } catch {
        // compiling throws exactly when csp blocks wasm, which is the case
        // this check exists to detect
        return false;
    }
};

// ?ktx2=0 loads the webp cars instead, for comparing
const ktx2Enabled = () => {
    try {
        return (
            canCompileWasm() &&
            typeof Worker !== 'undefined' &&
            new URLSearchParams(window.location.search).get('ktx2') !== '0'
        );
    } catch {
        return false;
    }
};

// cars, full and lite, have a ktx2 twin (scripts/build-ktx2-cars.mjs)
const hasKtx2Twin = (path: string) => /models\/Cars\/.+(?<!\.ktx2)\.glb$/.test(path);
// once a ktx2 car has downloaded, its parse (draco and texture transcode)
// gets this long before the webp one is loaded instead
const KTX2_PARSE_TIMEOUT_MS = 15000;
// and in case the size is unknown and the download never reports done
const KTX2_TOTAL_TIMEOUT_MS = 90000;
// the probe answers within 5 s, this covers a renderer that never arrives
const KTX2_READY_TIMEOUT_MS = 8000;

export default class Resources extends EventEmitter {
    sources: Resource[];
    // Not sure about this one
    items: {
        texture: { [name: string]: LoadedTexture };
        cubeTexture: { [name: string]: LoadedCubeTexture };
        gltfModel: { [name: string]: LoadedModel };
        audio: { [name: string]: LoadedAudio };
        json: { [name: string]: LoadedJson };
    };
    toLoad: number;
    loaded: number;
    failed: number;
    settled: Set<string>;

        loaders: {
        gltfLoader: GLTFLoader;
        textureLoader: THREE.TextureLoader;
        cubeTextureLoader: THREE.CubeTextureLoader;
        audioLoader: THREE.AudioLoader;
        jsonLoader: THREE.FileLoader;
    };
    application: Application;
    loading: Loading;

    ktx2Loader: SameOriginKTX2Loader | null = null;
    // whether the decoder works here, known once the probe texture decodes
    ktx2Ready: Promise<boolean> = Promise.resolve(false);
    private resolveKtx2: ((ok: boolean) => void) | null = null;

    // picks the gpu's compressed texture format for the ktx2 transcoder and
    // checks the decoder with a tiny texture
    setRenderer(renderer: THREE.WebGLRenderer) {
        if (!this.ktx2Loader || !this.resolveKtx2) return;
        this.ktx2Loader.detectSupport(renderer);
        this.ktx2Loader.probe().then(this.resolveKtx2);
        this.resolveKtx2 = null;
    }

    // a gltf model, a car as ktx2 when the decoder works. a failed, blocked
    // or stuck ktx2 load (probe, worker error, parse timeout) falls back to
    // the webp file, so a decoder problem never holds the page. onUrl hears
    // which file is being fetched, for the loading screens
    loadModel(
        path: string,
        onLoad: (gltf: GLTF) => void,
        onError: (error: unknown) => void,
        onProgress?: (event: ProgressEvent) => void,
        onUrl?: (url: string) => void
    ) {
        const loader = this.loaders.gltfLoader;
        const webp = () => {
            onUrl?.(path);
            loader.load(path, onLoad, onProgress, onError);
        };
        const ktx2Loader = this.ktx2Loader;
        if (!ktx2Loader || !hasKtx2Twin(path)) {
            webp();
            return;
        }
        const ready = Promise.race([
            this.ktx2Ready,
            new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), KTX2_READY_TIMEOUT_MS)),
        ]);
        void ready.then((ok) => {
            if (!ok || ktx2Loader.failed) {
                webp();
                return;
            }
            let done = false;
            let parseTimer = 0;
            const fallback = () => {
                if (done) return;
                done = true;
                window.clearTimeout(parseTimer);
                window.clearTimeout(totalTimer);
                stop();
                webp();
            };
            const totalTimer = window.setTimeout(fallback, KTX2_TOTAL_TIMEOUT_MS);
            const stop = ktx2Loader.onFailure(fallback);
            const ktx2Path = path.replace(/\.glb$/, '.ktx2.glb');
            onUrl?.(ktx2Path);
            loader.load(
                ktx2Path,
                (gltf) => {
                    if (done) return;
                    done = true;
                    window.clearTimeout(parseTimer);
                    window.clearTimeout(totalTimer);
                    stop();
                    onLoad(gltf);
                },
                (event) => {
                    if (!done) onProgress?.(event);
                    if (!parseTimer && event.lengthComputable && event.loaded >= event.total) {
                        parseTimer = window.setTimeout(fallback, KTX2_PARSE_TIMEOUT_MS);
                    }
                },
                fallback
            );
        });
    }

    constructor(sources: Resource[]) {
        super();

        this.sources = sources;

        this.items = {
            texture: {},
            cubeTexture: {},
            gltfModel: {},
            audio: {},
            json: {},
        };
        this.toLoad = this.sources.length;
        this.loaded = 0;
        this.failed = 0;
        this.settled = new Set();
        this.application = new Application();
        this.loading = this.application.loading;

        this.setLoaders();
        this.startLoading();
    }

    setLoaders() {
        // webpack emits the decoders that ship with three, so they can't drift
        // out of sync with the loader again. the glTF build is the smaller
        // wasm, but only the default paths include the asm.js fallback
        const dracoLoader = new DRACOLoader();
        if (canCompileWasm()) {
            dracoLoader.setDecoderPath(DRACO_GLTF_CONFIG);
        } else {
            dracoLoader.setDecoderConfig({ type: 'js' });
        }

        const gltfLoader = new GLTFLoader();
        gltfLoader.setDRACOLoader(dracoLoader);
        // cars come as ktx2, which stays compressed on the gpu. the decoder
        // is checked once the renderer exists (setRenderer)
        if (ktx2Enabled()) {
            this.ktx2Loader = new SameOriginKTX2Loader();
            this.ktx2Loader.onTranscode = (report) =>
                this.loading.item(
                    'transcode',
                    report.probe ? 'decoder probe' : 'car texture',
                    report.ms,
                    `${report.width}x${report.height} ${report.format}`
                );
            gltfLoader.setKTX2Loader(this.ktx2Loader);
            this.ktx2Ready = new Promise<boolean>((resolve) => {
                this.resolveKtx2 = resolve;
            });
        }
        gltfLoader.register(() => ({
            name: 'yassin_disable_transmission',
            afterRoot: (gltf: { scene: THREE.Group }) => {
                disableTransmission(gltf.scene);
                return null;
            },
        }));

        this.loaders = {
            gltfLoader,
            textureLoader: new THREE.TextureLoader(),
            cubeTextureLoader: new THREE.CubeTextureLoader(),
            audioLoader: new THREE.AudioLoader(),
            jsonLoader: new THREE.FileLoader(),
        };
    }

    startLoading() {

        // Load each source
        for (const source of this.sources) {
            const paths = Array.isArray(source.path) ? source.path : [source.path];
            this.loading.sourceStart(source, paths);
            const progress = (event: ProgressEvent) =>
                this.loading.sourceProgress(source, event);
            if (source.type === 'gltfModel') {
                this.loadModel(
                    source.path,
                    (file) => this.sourceLoaded(source, file),
                    (error) => this.sourceFailed(source, error),
                    progress,
                    (url) => this.loading.sourceUrls(source, [url])
                );
            } else if (source.type === 'texture') {
                this.loaders.textureLoader.load(
                    source.path,
                    (file) => {
                        file.colorSpace = THREE.SRGBColorSpace;
                        this.sourceLoaded(source, file);
                    },
                    undefined,
                    (error) => {
                        this.sourceFailed(source, error);
                    }
                );
            } else if (source.type === 'cubeTexture') {
                this.loaders.cubeTextureLoader.load(
                    source.path,
                    (file) => {
                        this.sourceLoaded(source, file);
                    },
                    undefined,
                    (error) => {
                        this.sourceFailed(source, error);
                    }
                );
            } else if (source.type === 'audio') {
                this.loaders.audioLoader.load(
                    source.path,
                    (buffer) => {
                        this.sourceLoaded(source, buffer);
                    },
                    progress,
                    (error) => {
                        this.sourceFailed(source, error);
                    }
                );
            } else if (source.type === 'json') {
                this.loaders.jsonLoader.load(
                    source.path,
                    (file) => {
                        try {
                            const parsed = JSON.parse(file as string);
                            this.sourceLoaded(source, parsed);
                        } catch (error) {
                            this.sourceFailed(source, error);
                        }
                    },
                    progress,
                    (error) => {
                        this.sourceFailed(source, error);
                    }
                );
            }
        }
    }

    // CubeTextureLoader forwards these callbacks to each of its six faces, so a
    // source can report more than once. Only the first result may settle it.
    settleSource(source: Resource): boolean {
        const key = `${source.type}:${source.name}`;

        if (this.settled.has(key)) return false;

        this.settled.add(key);

        return true;
    }

    sourceLoaded(source: Resource, file: LoadedResource) {
        if (!this.settleSource(source)) return;

        this.items[source.type][source.name] = file;
        this.loaded++;
        this.loading.sourceDone(source, true);

        this.loading.trigger('loadedSource', [
            source.name,
            this.loaded,
            this.toLoad,
        ]);

        if (this.loaded === this.toLoad) {
            if (this.failed === 0) {
                this.trigger('ready');
            } else {
                this.trigger('error');
            }
        }
    }

    sourceFailed(source: Resource, error: unknown) {
        console.error(`[Resources] Failed to load: ${source.name}`, error);

        if (!this.settleSource(source)) return;

        this.failed++;
        this.loaded++;
        this.loading.sourceDone(source, false);
        this.loading.trigger('failedSource', [
            source.name,
            this.loaded,
            this.toLoad,
        ]);

        if (this.loaded === this.toLoad) {
            this.trigger('error', [source, error]);
        }
    }

}
