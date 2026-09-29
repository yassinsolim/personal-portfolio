import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { assetUrl } from './assetUrl';

// the decoder runs in a real same origin worker file that the build emits
// (scripts/draco-worker.js), never a blob, so the page's content security
// policy doesn't need worker-src blob: (the ktx2 decoder works the same way)
const WORKER_URL = 'draco/draco-worker.js';
// asm.js, for browsers whose csp support blocks wasm
const JS_WORKER_URL = 'draco/draco-worker-js.js';
const WASM_URL = 'draco/draco_decoder.wasm';

type LoaderInternals = {
    decoderPending: Promise<void> | null;
    decoderConfig: { wasmBinary?: ArrayBuffer };
    workerSourceURL: string;
    _loadLibrary: (url: string, responseType: string) => Promise<ArrayBuffer>;
};

export class SameOriginDRACOLoader extends DRACOLoader {
    useWasm: boolean;

    constructor(useWasm: boolean) {
        super();
        this.useWasm = useWasm;
    }

    // in place of DRACOLoader's, which downloads the wrapper script and wraps
    // it in a blob. the workers it starts get the wasm in their init message
    _initDecoder() {
        const self = this as unknown as LoaderInternals;
        if (!self.decoderPending) {
            self.workerSourceURL = assetUrl(this.useWasm ? WORKER_URL : JS_WORKER_URL);
            self.decoderPending = this.useWasm
                ? self._loadLibrary(WASM_URL, 'arraybuffer').then((binary) => {
                      self.decoderConfig.wasmBinary = binary;
                  })
                : Promise.resolve();
        }
        return self.decoderPending;
    }
}
