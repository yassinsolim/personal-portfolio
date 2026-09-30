import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SameOriginKTX2Loader } from './ktx2';
import { SameOriginDRACOLoader } from './draco';
import Application from '../Application';
import UIEventBus from '../UI/EventBus';
import EventEmitter from './EventEmitter';
import Loading from './Loading';
import { disableTransmission } from './Transmission';
import { assetSize, versionLoaderUrls } from './assetUrl';
import { reportStage } from './loadStages';
import { afterFrame } from '../Racing/slicing';

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

// cars, full and lite, have a ktx2 twin (scripts/build-ktx2-cars.mjs), and
// so does the room (scripts/room)
const hasKtx2Twin = (path: string) => /models\/(Cars|Room)\/.+(?<!\.ktx2)\.glb$/.test(path);
// once a ktx2 car has downloaded and the decoder is known to work, its parse
// (draco and texture transcode) gets this long before the webp one is
// loaded instead
const KTX2_PARSE_TIMEOUT_MS = 15000;
// a download (the car, or the transcoder the probe waits for) that never
// finishes, and a renderer that never arrives
const KTX2_TOTAL_TIMEOUT_MS = 90000;

// the frame with the loading screen is presented a frame after it's painted,
// and the downloads start after that, so nothing they do sits in front of it
const afterPaint = () => afterFrame().then(afterFrame);

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
        const ktx2Loader = this.ktx2Loader;
        const resolve = this.resolveKtx2;
        this.resolveKtx2 = null;
        ktx2Loader.detectSupport(renderer);
        // with the downloads, once the loading screen is up
        void afterPaint().then(() => ktx2Loader.probe().then(resolve));
    }

    // a gltf model, a car as ktx2 when the decoder works. the ktx2 file
    // downloads while the probe checks the decoder (on a slow connection the
    // transcoder alone takes seconds), and is parsed once both are in. a
    // failed, blocked or stuck ktx2 load (probe, worker error, parse timeout)
    // falls back to the webp file, so a decoder problem never holds the page
    loadModel(
        path: string,
        onLoad: (gltf: GLTF) => void,
        onError: (error: unknown) => void,
        onBytes?: (loaded: number) => void
    ) {
        const loader = this.loaders.gltfLoader;
        const progress = onBytes && ((event: ProgressEvent) => onBytes(event.loaded));
        const webp = () => loader.load(path, onLoad, progress, onError);
        const ktx2Loader = this.ktx2Loader;
        if (!ktx2Loader || ktx2Loader.failed || !hasKtx2Twin(path)) {
            webp();
            return;
        }
        let done = false;
        let parseTimer = 0;
        const bytesLoader = new THREE.FileLoader();
        bytesLoader.setResponseType('arraybuffer');
        const fallback = () => {
            if (done) return;
            done = true;
            window.clearTimeout(parseTimer);
            window.clearTimeout(totalTimer);
            stop();
            bytesLoader.abort();
            webp();
        };
        const totalTimer = window.setTimeout(fallback, KTX2_TOTAL_TIMEOUT_MS);
        const stop = ktx2Loader.onFailure(fallback);
        const url = path.replace(/\.glb$/, '.ktx2.glb');
        const bytes = new Promise<ArrayBuffer>((resolve, reject) =>
            bytesLoader.load(url, (data) => resolve(data as ArrayBuffer), progress, reject)
        );
        void Promise.all([this.ktx2Ready, bytes]).then(
            ([ok, data]) => {
                if (done) return;
                if (!ok || ktx2Loader.failed) {
                    fallback();
                    return;
                }
                parseTimer = window.setTimeout(fallback, KTX2_PARSE_TIMEOUT_MS);
                loader.parse(
                    data,
                    THREE.LoaderUtils.extractUrlBase(url),
                    (gltf) => {
                        if (done) return;
                        done = true;
                        window.clearTimeout(parseTimer);
                        window.clearTimeout(totalTimer);
                        stop();
                        onLoad(gltf);
                    },
                    fallback
                );
            },
            fallback
        );
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

        versionLoaderUrls();
        this.setLoaders();
        // the loading screen is on screen first (two frames, or right away in
        // a hidden tab), then everything downloads
        void afterPaint().then(() => this.startLoading());
    }

    setLoaders() {
        // the build makes the decoder workers from the files that ship with
        // three, so they can't drift out of sync with the loader. the glTF
        // wasm build, or asm.js where the policy support blocks wasm
        const dracoLoader = new SameOriginDRACOLoader(canCompileWasm());

        const gltfLoader = new GLTFLoader();
        gltfLoader.setDRACOLoader(dracoLoader);
        // cars come as ktx2, which stays compressed on the gpu. the decoder
        // is checked once the renderer exists (setRenderer)
        if (ktx2Enabled()) {
            this.ktx2Loader = new SameOriginKTX2Loader();
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
        for (const source of this.sources) {
            this.expectedBytes.set(source.name, this.sizeOf(source));
        }
        this.reportDownload();
        for (const source of this.sources) {
            this.loadSource(
                source,
                (file) => this.sourceLoaded(source, file),
                (error) => this.sourceFailed(source, error),
                (loaded) => {
                    this.receivedBytes.set(source.name, loaded);
                    this.reportDownloadSoon();
                }
            );
        }
    }

    // loading progress by bytes: what each source should weigh (the build
    // knows the sizes; cars count as their ktx2 twin when that is tried
    // first) and what has arrived. models and json report as they stream,
    // images when they're done. without sizes (dev) it counts sources
    private expectedBytes = new Map<string, number>();
    private receivedBytes = new Map<string, number>();
    private downloadFrame = 0;

    sizeOf(source: Resource) {
        if (source.type === 'cubeTexture') {
            return source.path.reduce((sum, face) => sum + assetSize(face), 0);
        }
        if (source.type === 'gltfModel' && this.ktx2Loader && hasKtx2Twin(source.path)) {
            return assetSize(source.path.replace(/\.glb$/, '.ktx2.glb')) || assetSize(source.path);
        }
        return assetSize(source.path);
    }

    reportDownloadSoon() {
        if (this.downloadFrame) return;
        this.downloadFrame = window.requestAnimationFrame(() => {
            this.downloadFrame = 0;
            this.reportDownload();
        });
    }

    reportDownload() {
        let total = 0;
        let received = 0;
        this.expectedBytes.forEach((expected, name) => {
            total += expected;
            received += Math.min(expected, this.receivedBytes.get(name) || 0);
        });
        const progress = total > 0 ? received / total : this.loaded / Math.max(1, this.toLoad);
        reportStage('homepage', 'download', this.loaded === this.toLoad ? 1 : Math.min(progress, 0.999), {
            loaded: this.loaded,
            total: this.toLoad,
            bytesLoaded: received,
            bytesTotal: total,
        });
    }

    // fetches one source with the loader for its type
    loadSource(
        source: Resource,
        onLoad: (file: LoadedResource) => void,
        onError: (error: unknown) => void,
        onBytes?: (loaded: number) => void
    ) {
        const progress = onBytes && ((event: ProgressEvent) => onBytes(event.loaded));
        if (source.type === 'gltfModel') {
            this.loadModel(source.path, onLoad, onError, onBytes);
        } else if (source.type === 'texture') {
            this.loaders.textureLoader.load(
                source.path,
                (file) => {
                    file.colorSpace = THREE.SRGBColorSpace;
                    if (source.flipY !== undefined) file.flipY = source.flipY;
                    onLoad(file);
                },
                undefined,
                onError
            );
        } else if (source.type === 'cubeTexture') {
            this.loaders.cubeTextureLoader.load(source.path, onLoad, undefined, onError);
        } else if (source.type === 'audio') {
            this.loaders.audioLoader.load(source.path, onLoad, undefined, onError);
        } else if (source.type === 'json') {
            this.loaders.jsonLoader.load(
                source.path,
                (file) => {
                    try {
                        onLoad(JSON.parse(file as string));
                    } catch (error) {
                        onError(error);
                    }
                },
                progress,
                onError
            );
        }
    }

    // sources that aren't part of the homepage load (race mode's track data):
    // same items table, but they don't count towards the loading screen or
    // its 'ready'. each source is fetched once, a failed one can be retried
    private extraLoads = new Map<string, Promise<void>>();

    loadExtra(sources: Resource[]): Promise<void> {
        return Promise.all(
            sources.map((source) => {
                const key = `${source.type}:${source.name}`;
                if (this.items[source.type][source.name]) return Promise.resolve();
                let pending = this.extraLoads.get(key);
                if (!pending) {
                    pending = new Promise<void>((resolve, reject) => {
                        this.loadSource(
                            source,
                            (file) => {
                                this.items[source.type][source.name] = file;
                                resolve();
                            },
                            (error) => {
                                this.extraLoads.delete(key);
                                reject(error);
                            }
                        );
                    });
                    this.extraLoads.set(key, pending);
                }
                return pending;
            })
        ).then(() => undefined);
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
        this.receivedBytes.set(source.name, this.expectedBytes.get(source.name) || 0);
        this.reportDownload();

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
        this.receivedBytes.set(source.name, this.expectedBytes.get(source.name) || 0);
        this.reportDownload();
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
