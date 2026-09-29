import * as THREE from 'three';
import eventBus from '../EventBus';
import Application from '../../Application';
import { formatBytes, prettyGpu } from '../../Utils/hardwareInfo';
import { readRenderer } from '../../Utils/gpuClass';
import { assetSize } from '../../Utils/assetUrl';
import { currentStage, type LoadStage } from '../../Utils/loadStages';
import { fileLabel, sourceFacts, sourceLabel } from './facts';

// the page load log of the hybrid loading screen. each line is an event,
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
    dispose: () => void;
};

const stamp = (ms: number) => `[${(ms / 1000).toFixed(3).padStart(7, ' ')}]`;
export const msText = (ms: number) => `${Math.max(0, Math.round(ms))} ms`;

// more than a tall screen shows; every line kept is laid out again as the
// log moves up
const MAX_LINES = 90;

const markTime = (name: string) => performance.getEntriesByName(name)[0]?.startTime ?? 0;

// a hit in the http cache moves no body; a 304 moves headers only
const isCached = (t: PerformanceResourceTiming) =>
    t.transferSize === 0
        ? t.encodedBodySize > 0 || t.decodedBodySize > 0
        : t.encodedBodySize <= 0
          ? t.transferSize < 2048
          : t.transferSize < t.encodedBodySize / 2;

export const createBootLog = (log: HTMLElement, maxLines = MAX_LINES): BootLog => {
    const application = new Application();
    const printed = new Set<string>();
    let failed = false;
    let uploads = 0;

    // lines go into the dom once a frame, so a burst of events costs one
    // layout, not one each (it adds up on a slow cpu)
    const queued: HTMLDivElement[] = [];
    let flushId = 0;
    const flush = () => {
        flushId = 0;
        queued.splice(0).forEach((line) => {
            // keep the log in time order: resource timing is reported a
            // little after the fact
            const t = Number(line.dataset.t);
            let before: Element | null = null;
            for (let node = log.lastElementChild; node; node = node.previousElementSibling) {
                if (Number((node as HTMLElement).dataset.t) <= t) break;
                before = node;
            }
            log.insertBefore(line, before);
        });
        while (log.childElementCount > maxLines) log.firstElementChild?.remove();
    };
    const print = (t: number, parts: Part[]) => {
        const line = document.createElement('div');
        line.className = 'term-line';
        line.dataset.t = String(t);
        const time = document.createElement('span');
        time.className = 'term-dim';
        time.textContent = `${stamp(t)} `;
        line.appendChild(time);
        parts.forEach(([text, tone]) => {
            if (!text) return;
            const span = document.createElement('span');
            if (tone) span.className = `term-${tone}`;
            span.textContent = text;
            line.appendChild(span);
        });
        queued.push(line);
        if (!flushId) flushId = requestAnimationFrame(flush);
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
        dispose: () => {
            observer?.disconnect();
            eventBus.remove('loadedSource', onLoaded);
            eventBus.remove('failedSource', onFailed);
            eventBus.remove('load:stage', onStage);
            if (flushId) cancelAnimationFrame(flushId);
        },
    };
};

export const COMMAND = './yassin --start';

// types the command into the prompt by the clock (a frame stuck on a texture
// upload doesn't hold the keystrokes back), straight into the dom rather
// than a render per keystroke. instant for returning visitors and reduced
// motion
export const createTyper = (prompt: HTMLElement, command: HTMLElement, instant: boolean) => {
    let started = false;
    let typed = false;
    let timer = 0;
    const listeners: (() => void)[] = [];
    const show = (text: string) => {
        prompt.style.visibility = 'visible';
        command.textContent = text;
    };
    const done = () => {
        typed = true;
        listeners.splice(0).forEach((fn) => fn());
    };
    return {
        start() {
            if (started) return;
            started = true;
            if (instant) {
                show(COMMAND);
                done();
                return;
            }
            const startedAt = performance.now();
            const type = () => {
                const count = Math.min(COMMAND.length, 1 + Math.floor((performance.now() - startedAt) / 22));
                show(COMMAND.slice(0, count));
                if (count < COMMAND.length) timer = window.setTimeout(type, 22);
                else done();
            };
            type();
        },
        typed: () => typed,
        // runs now if the command is already typed
        whenTyped(fn: () => void) {
            if (typed) fn();
            else listeners.push(fn);
        },
        dispose: () => window.clearTimeout(timer),
    };
};
