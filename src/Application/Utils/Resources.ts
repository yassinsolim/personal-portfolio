import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
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
        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath('draco/gltf/');
        dracoLoader.setDecoderConfig({
            type: canCompileWasm() ? 'wasm' : 'js',
        });

        const gltfLoader = new GLTFLoader();
        gltfLoader.setDRACOLoader(dracoLoader);
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
            if (source.type === 'gltfModel') {
                this.loaders.gltfLoader.load(
                    source.path,
                    (file) => {
                        this.sourceLoaded(source, file);
                    },
                    undefined,
                    (error) => {
                        this.sourceFailed(source, error);
                    }
                );
            } else if (source.type === 'texture') {
                this.loaders.textureLoader.load(
                    source.path,
                    (file) => {
                        file.encoding = THREE.sRGBEncoding;
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
                    undefined,
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
                    undefined,
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
