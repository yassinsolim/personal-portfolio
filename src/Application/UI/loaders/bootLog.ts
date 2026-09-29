import * as THREE from 'three';
import eventBus from '../EventBus';
import Application from '../../Application';
import { formatBytes, prettyGpu } from '../../Utils/hardwareInfo';
import { readRenderer } from '../../Utils/gpuClass';
import { assetSize } from '../../Utils/assetUrl';
import { currentStage, type LoadStage } from '../../Utils/loadStages';
import { fileLabel, sourceFacts, sourceLabel } from './facts';

// the page load log of the hybrid loading screen, written on the room's
// terminal screen. each line is an event,
// timed from navigation start: resource timing for each file (the build's
// sizes when the cache hides them), each source decoded (from the legacy
// loadedSource event), and the homepage stages from Utils/loadStages.ts
// ('load:stage' and its performance marks): downloads, the room built and
// its textures uploaded, its shaders compiled (one line), the first frame

export type Tone = 'dim' | 'ok' | 'file' | 'num' | 'warn' | 'err' | 'cmd' | 'stage' | '';
export type Part = [string, Tone?];

export type BootLog = {
    print: (t: number, parts: Part[]) => void;
    failed: () => boolean;
    // everything still held back, in order (the loader is finishing)
    flush: () => void;
    // print the latest load stage now if its event hasn't reached the log yet
    sync: () => void;
    // write the command, flush, and stop: the screen is the shell after this
    close: (t: number, parts: Part[]) => void;
    dispose: () => void;
};

// where finished lines go: the room's terminal screen (appendLog)
export type LogSink = (line: string, kind: 'info' | 'ok' | 'warn' | 'dim') => void;

const stamp = (ms: number) => `[${(ms / 1000).toFixed(3).padStart(7, ' ')}]`;
export const msText = (ms: number) => `${Math.max(0, Math.round(ms))} ms`;

// resource timing reports a file a little after it's done, so lines wait
// this long to be put in time order before they're written
const HOLD_MS = 150;

const kindOf = (parts: Part[]): 'info' | 'ok' | 'warn' | 'dim' => {
    const tone = parts.find(([text]) => text)?.[1];
    if (tone === 'stage' || tone === 'cmd') return 'ok';
    if (tone === 'err') return 'warn';
    if (tone === 'dim') return 'dim';
    return 'info';
};

const markTime = (name: string) => performance.getEntriesByName(name)[0]?.startTime ?? 0;

// a hit in the http cache moves no body; a 304 moves headers only
const isCached = (t: PerformanceResourceTiming) =>
    t.transferSize === 0
        ? t.encodedBodySize > 0 || t.decodedBodySize > 0
        : t.encodedBodySize <= 0
          ? t.transferSize < 2048
          : t.transferSize < t.encodedBodySize / 2;

export const createBootLog = (sink: LogSink): BootLog => {
    const application = new Application();
    const printed = new Set<string>();
    let failed = false;
    let uploads = 0;

    const held: { t: number; parts: Part[] }[] = [];
    let timer = 0;
    let closed = false;
    const write = (until: number) => {
        held.sort((p, q) => p.t - q.t);
        while (held.length && held[0].t <= until) {
            const { t, parts } = held.shift() as { t: number; parts: Part[] };
            sink(`${stamp(t)} ${parts.map(([text]) => text).join('')}`, kindOf(parts));
        }
    };
    const tick = () => {
        timer = 0;
        write(performance.now() - HOLD_MS);
        if (held.length) timer = window.setTimeout(tick, HOLD_MS / 2);
    };
    const print = (t: number, parts: Part[]) => {
        if (closed) return;
        held.push({ t, parts });
        if (!timer) timer = window.setTimeout(tick, HOLD_MS / 2);
    };
    const once = (key: string, fn: () => void) => {
        if (printed.has(key)) return;
        printed.add(key);
        fn();
    };

    const printEntry = (entry: PerformanceResourceTiming) => {
        if (entry.name.startsWith('blob:') || entry.name.startsWith('data:')) return;
        once(`res:${entry.name}:${entry.startTime}`, () => {
            const cached = isCached(entry);
            let path = '';
            try {
                path = decodeURIComponent(new URL(entry.name).pathname.replace(/^\//, ''));
            } catch {
                path = '';
            }
            const size = entry.decodedBodySize > 0 ? entry.decodedBodySize : assetSize(path);
            const wire =
                !cached && entry.transferSize > 0 && entry.transferSize < size * 0.95
                    ? `  wire ${formatBytes(entry.transferSize)}`
                    : '';
            print(entry.responseEnd, [
                ['<- ', 'dim'],
                [fileLabel(entry.name), 'file'],
                [size > 0 ? `  ${formatBytes(size)}` : `  ${entry.initiatorType}`, 'num'],
                [cached ? '  cached' : '', 'warn'],
                [wire, 'dim'],
                [`  ${msText(entry.responseEnd - entry.startTime)}`, 'dim'],
            ]);
        });
    };

    const sourceNamed = (name: string) => application.resources.sources.find((s) => s.name === name);
    const onLoaded = ({ sourceName }: { sourceName: string }) => {
        const source = sourceNamed(sourceName);
        if (!source) return;
        once(`ready:${sourceName}`, () => {
            const facts = sourceFacts(source);
            print(performance.now(), [
                [source.type === 'json' ? 'parse ' : 'decode ', 'ok'],
                [sourceLabel(source), 'file'],
                [facts ? `  ${facts}` : '', ''],
            ]);
        });
    };
    const onFailed = ({ sourceName }: { sourceName: string }) => {
        failed = true;
        const source = sourceNamed(sourceName);
        print(performance.now(), [
            ['failed ', 'err'],
            [source ? sourceLabel(source) : sourceName, 'file'],
            ['  reload the page to try again', 'err'],
        ]);
    };

    const onStage = (stage: LoadStage) => {
        if (stage.scope !== 'homepage') return;
        const now = performance.now();
        if (stage.stage === 'download' && stage.done) {
            once('download', () =>
                print(now, [
                    ['downloads done  ', 'ok'],
                    [`${stage.total ?? 0} sources`, 'num'],
                    [stage.bytesTotal ? `, ${formatBytes(stage.bytesTotal)}` : '', 'num'],
                    [`  ${((now - markTime('load:homepage:download')) / 1000).toFixed(2)} s`, 'dim'],
                ])
            );
        } else if (stage.stage === 'upload') {
            uploads++;
            once('build', () => {
                let meshes = 0;
                application.scene.traverse((o) => {
                    if ((o as THREE.Mesh).isMesh && !o.userData.pipelineIntroPart) meshes++;
                });
                print(now, [['built ', 'ok'], [`${meshes} meshes`, 'num'], ['  textures to the gpu, one a frame', 'dim']]);
            });
        } else if (stage.stage === 'compile') {
            once('compile', () => {
                const took = now - markTime('load:homepage:upload');
                print(now, [['textures on the gpu ', 'ok'], [`${uploads}`, 'num'], [`  ${msText(took)}`, 'dim']]);
                print(now, [['compile ', 'ok'], ['shader programs, in parallel', '']]);
            });
        } else if (stage.stage === 'ready') {
            once('ready', () => {
                const programs = application.renderer.instance.info.programs?.length ?? 0;
                const took = now - markTime('load:homepage:compile');
                print(now, [['shaders ready ', 'ok'], [`${programs} programs`, 'num'], [`  ${msText(took)}`, 'dim']]);
                print(now, [['first frame ', 'ok'], ['drawn', '']]);
            });
        }
    };

    // the header and what happened before this mounted
    print(0, [['yassin.app page load, times since navigation start', 'dim']]);
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (navigation) {
        print(navigation.responseEnd, [
            ['<- ', 'dim'],
            ['index.html', 'file'],
            [`  ${formatBytes(navigation.decodedBodySize || 0)}`, 'num'],
            [`  ${msText(navigation.responseEnd - navigation.startTime)}`, 'dim'],
        ]);
    }
    (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).forEach(printEntry);
    try {
        const gl = application.renderer.instance.getContext();
        const gpu = prettyGpu(readRenderer(gl).renderer);
        print(performance.now(), [
            ['webgl ', 'ok'],
            [`2 context on ${gpu.name}${gpu.api ? ` via ${gpu.api}` : ''}`, ''],
        ]);
    } catch {
        // no context details
    }
    const latest = currentStage('homepage');
    if (latest) onStage(latest);

    let observer: PerformanceObserver | null = null;
    try {
        observer = new PerformanceObserver((list) =>
            (list.getEntries() as PerformanceResourceTiming[]).forEach(printEntry)
        );
        observer.observe({ type: 'resource', buffered: false });
    } catch {
        observer = null;
    }
    eventBus.on('loadedSource', onLoaded);
    eventBus.on('failedSource', onFailed);
    eventBus.on('load:stage', onStage);

    return {
        print,
        failed: () => failed,
        flush: () => write(Infinity),
        sync: () => {
            const latest = currentStage('homepage');
            if (latest) onStage(latest);
        },
        close: (t, parts) => {
            if (closed) return;
            // nothing held back may land after the command
            print(Math.max(t, ...held.map((line) => line.t)), parts);
            write(Infinity);
            closed = true;
        },
        dispose: () => {
            observer?.disconnect();
            eventBus.remove('loadedSource', onLoaded);
            eventBus.remove('failedSource', onFailed);
            eventBus.remove('load:stage', onStage);
            window.clearTimeout(timer);
        },
    };
};

export const COMMAND = './yassin --start';
