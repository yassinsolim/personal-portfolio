import * as THREE from 'three';
import Application from '../Application';
import EventEmitter from './EventEmitter';
import Resources from './Resources';
import UIEventBus from '../UI/EventBus';

// per source and per stage load progress, for the loading screens.
//
// a source reports when it starts, the bytes it has received while its
// loader gives progress events (gltf and json do, images don't), when its
// download is in and when it's parsed and ready. resource timing then fills
// in the file size, the bytes that crossed the wire and whether the http
// cache answered. after the downloads come the stages on the main thread:
// building the room, compiling its shaders, uploading textures and the
// first frame.
//
// ui side: 'loading:source', 'loading:stage' and 'loading:item' on the ui
// event bus, and snapshot() for a screen that mounts after things started.
// the old 'loadedSource' and 'failedSource' events are unchanged

export type SourceState = 'loading' | 'fetched' | 'ready' | 'failed';

export type SourceProgress = {
    name: string;
    type: Resource['type'];
    // what was actually requested (a car's ktx2 twin, all six cube faces)
    urls: string[];
    state: SourceState;
    // decoded bytes so far, from progress events where the loader has them
    received: number;
    // from resource timing once every file has an entry: file bytes, bytes
    // on the wire (headers included, a few hundred for a 304) and whether
    // the cache served it. -1 until known
    size: number;
    transfer: number;
    cached: boolean;
    startedAt: number;
    fetchedAt: number;
    readyAt: number;
};

export type StageName = 'download' | 'build' | 'compile' | 'upload' | 'frame';

export type StageProgress = {
    name: StageName;
    startedAt: number;
    // 0 while running
    doneAt: number;
    // programs, textures or objects, depending on the stage
    count: number;
};

export type LoadItem = {
    stage: 'transcode' | 'compile' | 'upload';
    label: string;
    at: number;
    ms: number;
    detail: string;
};

export type LoadingSnapshot = {
    sources: SourceProgress[];
    stages: StageProgress[];
    items: LoadItem[];
};

type TimingEntry = {
    transferSize: number;
    encodedBodySize: number;
    decodedBodySize: number;
    responseEnd: number;
};

const absolute = (path: string) => {
    try {
        return new URL(path, document.baseURI).href;
    } catch {
        return path;
    }
};

export default class Loading extends EventEmitter {
    progress: number;
    application: Application;
    resources: Resources;
    scene: THREE.Scene;

    sources = new Map<string, SourceProgress>();
    stages = new Map<StageName, StageProgress>();
    items: LoadItem[] = [];
    private timings = new Map<string, TimingEntry>();
    private frameStartedAt = 0;
    private watchFrame = false;
    private programsBefore = 0;

    constructor() {
        super();

        this.application = new Application();
        this.resources = this.application.resources;

        this.scene = this.application.scene;
        this.on(
            'loadedSource',
            (sourceName: string, loaded: number, toLoad: number) => {
                this.progress = loaded / toLoad;
                UIEventBus.dispatch('loadedSource', {
                    sourceName,
                    progress: loaded / toLoad,
                    toLoad,
                    loaded,
                });
            }
        );
        this.on(
            'failedSource',
            (sourceName: string, loaded: number, toLoad: number) => {
                this.progress = loaded / toLoad;
                UIEventBus.dispatch('failedSource', {
                    sourceName,
                    progress: loaded / toLoad,
                    toLoad,
                    loaded,
                });
            }
        );
        this.observeTimings();
    }

    snapshot(): LoadingSnapshot {
        return {
            sources: [...this.sources.values()].map((s) => ({ ...s })),
            stages: [...this.stages.values()].map((s) => ({ ...s })),
            items: [...this.items],
        };
    }

    // sources

    sourceStart(source: Resource, urls: string[]) {
        if (!this.stages.has('download')) this.stageStart('download');
        const entry: SourceProgress = {
            name: source.name,
            type: source.type,
            urls: urls.map(absolute),
            state: 'loading',
            received: 0,
            size: -1,
            transfer: -1,
            cached: false,
            startedAt: performance.now(),
            fetchedAt: 0,
            readyAt: 0,
        };
        this.sources.set(source.name, entry);
        this.applyTimings(entry);
        this.emitSource(entry);
    }

    // the file actually fetched: a car's ktx2 twin, or its webp file after a
    // ktx2 failure
    sourceUrls(source: Resource, urls: string[]) {
        const entry = this.sources.get(source.name);
        const next = urls.map(absolute);
        if (!entry || next.join() === entry.urls.join()) return;
        entry.urls = next;
        entry.received = 0;
        entry.size = -1;
        entry.transfer = -1;
        this.applyTimings(entry);
        this.emitSource(entry);
    }

    sourceProgress(source: Resource, event: ProgressEvent) {
        const entry = this.sources.get(source.name);
        if (!entry || entry.state !== 'loading') return;
        entry.received = event.loaded;
        if (event.lengthComputable && event.total > 0 && event.loaded >= event.total) {
            entry.state = 'fetched';
            entry.fetchedAt = performance.now();
        }
        this.emitSource(entry);
    }

    sourceDone(source: Resource, ok: boolean) {
        const entry = this.sources.get(source.name);
        if (!entry || entry.state === 'ready' || entry.state === 'failed') return;
        entry.state = ok ? 'ready' : 'failed';
        entry.readyAt = performance.now();
        this.applyTimings(entry);
        this.emitSource(entry);
        const all = [...this.sources.values()];
        if (all.every((s) => s.state === 'ready' || s.state === 'failed')) {
            this.stageDone('download', all.length);
        }
    }

    // stages

    stageStart(name: StageName) {
        const stage: StageProgress = {
            name,
            startedAt: performance.now(),
            doneAt: 0,
            count: 0,
        };
        this.stages.set(name, stage);
        UIEventBus.dispatch('loading:stage', { ...stage });
    }

    stageDone(name: StageName, count = 0): void {
        if (!this.stages.has(name)) this.stageStart(name);
        const stage = this.stages.get(name) as StageProgress;
        if (stage.doneAt) return;
        stage.doneAt = performance.now();
        stage.count = count;
        UIEventBus.dispatch('loading:stage', { ...stage });
        // the room's first frame compiles its shaders and uploads its
        // textures, unless a loading screen already warmed them up
        if (name === 'build') this.watchFrame = true;
    }

    item(stage: LoadItem['stage'], label: string, ms: number, detail = '') {
        const entry: LoadItem = { stage, label, at: performance.now(), ms, detail };
        this.items.push(entry);
        UIEventBus.dispatch('loading:item', entry);
    }

    // around the render call in the tick, so the first frame after the build
    // can report what it cost
    beforeRender() {
        if (!this.watchFrame) return;
        this.frameStartedAt = performance.now();
        this.programsBefore = this.programCount();
    }

    afterRender() {
        if (!this.watchFrame) return;
        this.watchFrame = false;
        const ms = performance.now() - this.frameStartedAt;
        const programs = (this.application.renderer?.instance?.info.programs ||
            []) as unknown as { type?: string; name?: string }[];
        const fresh = programs.slice(this.programsBefore);
        if (fresh.length && !this.stages.get('compile')?.doneAt) {
            this.stages.set('compile', {
                name: 'compile',
                startedAt: this.frameStartedAt,
                doneAt: 0,
                count: 0,
            });
            fresh.forEach((program) =>
                this.item('compile', program.type || 'program', 0, program.name || '')
            );
            this.stageDone('compile', programs.length);
        }
        this.stages.set('frame', {
            name: 'frame',
            startedAt: this.frameStartedAt,
            doneAt: 0,
            count: Math.round(ms),
        });
        this.stageDone('frame', Math.round(ms));
    }

    private programCount() {
        return this.application.renderer?.instance?.info.programs?.length || 0;
    }

    private emitSource(entry: SourceProgress) {
        UIEventBus.dispatch('loading:source', { ...entry });
    }

    // resource timing

    private observeTimings() {
        if (typeof PerformanceObserver === 'undefined') return;
        try {
            const observer = new PerformanceObserver((list) => {
                list.getEntries().forEach((e) => {
                    const entry = e as PerformanceResourceTiming;
                    this.timings.set(entry.name, {
                        transferSize: entry.transferSize ?? -1,
                        encodedBodySize: entry.encodedBodySize ?? -1,
                        decodedBodySize: entry.decodedBodySize ?? -1,
                        responseEnd: entry.responseEnd,
                    });
                    this.sources.forEach((source) => {
                        if (source.urls.includes(entry.name) && this.applyTimings(source)) {
                            this.emitSource(source);
                        }
                    });
                });
            });
            observer.observe({ type: 'resource', buffered: true });
        } catch {
            // no resource timing: sizes stay unknown
        }
    }

    // true when this filled in something new
    private applyTimings(source: SourceProgress) {
        if (source.size >= 0) return false;
        const found = source.urls.map((url) => this.timings.get(url));
        if (found.some((t) => !t)) return false;
        const entries = found as TimingEntry[];
        const size = entries.reduce((sum, t) => sum + Math.max(0, t.decodedBodySize), 0);
        const body = entries.reduce((sum, t) => sum + Math.max(0, t.encodedBodySize), 0);
        const transfer = entries.reduce((sum, t) => sum + Math.max(0, t.transferSize), 0);
        source.size = size;
        source.transfer = transfer;
        // a 304 or a cache hit moves headers only, never the body
        source.cached = body > 0 && transfer < body / 2;
        if (!source.fetchedAt) {
            source.fetchedAt = Math.max(...entries.map((t) => t.responseEnd));
        }
        return true;
    }
}
