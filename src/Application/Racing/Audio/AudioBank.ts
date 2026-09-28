// loads one car's audio sprite (loops + one-shots in a single file) and its
// manifest. only the car that is being driven gets fetched. opus/webm is
// tried first, aac/m4a covers browsers that can't decode it.

export type LoopKind = 'idle' | 'on' | 'off' | 'squeal';

export type LoopMeta = {
    id: string;
    kind: LoopKind;
    rpm: number;
    start: number;
    dur: number;
    db: number;
};

export type ShotMeta = {
    id: string;
    kind: string;
    start: number;
    dur: number;
};

export type BankManifest = {
    version: number;
    carId: string;
    sampleRate: number;
    source: string;
    notes: string;
    files: { opus: string; aac: string };
    bytes: { opus: number; aac: number };
    duration: number;
    loops: LoopMeta[];
    shots: ShotMeta[];
};

export type AudioBankData = {
    id: string;
    manifest: BankManifest;
    buffer: AudioBuffer;
    format: 'opus' | 'aac';
    bytes: number;
    shotsByKind: Record<string, ShotMeta[]>;
};

export const RACE_AUDIO_BASE = 'sounds/race/';

let formatOrder: Array<'opus' | 'aac'> | null = null;

const getFormatOrder = (): Array<'opus' | 'aac'> => {
    if (formatOrder) return formatOrder;
    let opus = '';
    try {
        opus = document
            .createElement('audio')
            .canPlayType('audio/webm; codecs="opus"');
    } catch {
        opus = '';
    }
    formatOrder = opus ? ['opus', 'aac'] : ['aac', 'opus'];
    return formatOrder;
};

// webkit's old callback-only decodeAudioData still ships on some ios versions
const decode = (context: BaseAudioContext, data: ArrayBuffer) =>
    new Promise<AudioBuffer>((resolve, reject) => {
        let settled = false;
        const done = (buffer: AudioBuffer) => {
            if (settled) return;
            settled = true;
            resolve(buffer);
        };
        const fail = (error: unknown) => {
            if (settled) return;
            settled = true;
            reject(error);
        };
        // old webkit returns nothing and only calls back
        let result: Promise<AudioBuffer> | undefined;
        try {
            result = context.decodeAudioData(data, done, fail);
        } catch (error) {
            fail(error);
            return;
        }
        result?.then(done, fail);
    });

export default class AudioBank {
    base: string;
    cache: Map<string, Promise<AudioBankData | null>>;
    loadedBytes: number;

    constructor(base = RACE_AUDIO_BASE) {
        this.base = base;
        this.cache = new Map();
        this.loadedBytes = 0;
    }

    load(context: BaseAudioContext, id: string): Promise<AudioBankData | null> {
        const cached = this.cache.get(id);
        if (cached) return cached;
        const promise = this.fetchBank(context, id).catch((error) => {
            console.warn(`[race audio] could not load ${id}`, error);
            this.cache.delete(id);
            return null;
        });
        this.cache.set(id, promise);
        return promise;
    }

    async fetchBank(context: BaseAudioContext, id: string): Promise<AudioBankData | null> {
        const response = await fetch(`${this.base}${id}.json`);
        if (!response.ok) return null;
        const manifest = (await response.json()) as BankManifest;
        let lastError: unknown = null;
        for (const format of getFormatOrder()) {
            try {
                const file = manifest.files[format];
                const audio = await fetch(`${this.base}${file}`);
                if (!audio.ok) throw new Error(`${file}: ${audio.status}`);
                const data = await audio.arrayBuffer();
                // decodeAudioData detaches the array buffer, so count first
                const bytes = data.byteLength;
                const buffer = await decode(context, data);
                this.loadedBytes += bytes;
                if (format !== getFormatOrder()[0]) {
                    // stick with what worked for the other cars too
                    formatOrder = [format, getFormatOrder()[0]];
                }
                const shotsByKind: Record<string, ShotMeta[]> = {};
                manifest.shots.forEach((shot) => {
                    (shotsByKind[shot.kind] = shotsByKind[shot.kind] || []).push(shot);
                });
                return { id, manifest, buffer, format, bytes, shotsByKind };
            } catch (error) {
                lastError = error;
            }
        }
        throw lastError || new Error(`no playable format for ${id}`);
    }
}
