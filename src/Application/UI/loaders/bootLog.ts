import eventBus from '../EventBus';
import Application from '../../Application';
import { formatBytes, prettyGpu, readRenderer } from '../../Utils/hardwareInfo';
import {
    isCachedTiming,
    type LoadItem,
    type SourceProgress,
    type StageProgress,
} from '../../Utils/Loading';
import { fileLabel, sourceFacts, sourceLabel } from './facts';

// the page load log shared by the terminal and hybrid loading screens. each
// line is an event: resource timing for each file, the loaders' progress,
// the room build, each shader program as the driver finishes it, each
// texture upload and the first frame, timed from navigation start. the
// progress comes from Utils/Loading.ts ('loading:*' on the ui bus); this is
// the one place that reads it for the log, so pointing it at another
// progress api is a change here only

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

export const createBootLog = (log: HTMLElement, maxLines = MAX_LINES): BootLog => {
    const application = new Application();
    const loading = application.loading;
    const sourceUrls = new Set<string>();
    const printed = new Set<string>();
    let failed = false;

    // lines go into the dom once a frame, so a burst of events costs one
    // layout, not one each (it adds up on a slow cpu)
    const queued: HTMLDivElement[] = [];
    let flushId = 0;
    const flush = () => {
        flushId = 0;
        queued.splice(0).forEach((line) => {
            // keep the log in time order: events can be reported a little
            // after they happened (resource timing is queued)
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

    // resource timing for everything that isn't one of the room's sources
    const printEntry = (entry: PerformanceResourceTiming) => {
        if (sourceUrls.has(entry.name) || entry.name.startsWith('blob:')) return;
        once(`res:${entry.name}:${entry.startTime}`, () => {
            const name = fileLabel(entry.name);
            const cached = isCachedTiming(entry);
            const wire =
                entry.transferSize > 0 && entry.transferSize < entry.decodedBodySize * 0.95
                    ? [` wire ${formatBytes(entry.transferSize)}`, 'dim'] as Part
                    : ['', ''] as Part;
            print(entry.responseEnd, [
                ['<- ', 'dim'],
                [name, 'file'],
                [`  ${entry.decodedBodySize > 0 ? formatBytes(entry.decodedBodySize) : entry.initiatorType}`, 'num'],
                cached ? ['  cached', 'warn'] : wire,
                [`  ${msText(entry.responseEnd - entry.startTime)}`, 'dim'],
            ]);
        });
    };

    const printSource = (source: SourceProgress) => {
        source.urls.forEach((url) => sourceUrls.add(url));
        const label = sourceLabel(source);
        once(`start:${source.name}:${source.urls.join()}`, () =>
            print(source.startedAt, [['-> GET ', 'dim'], [label, 'file']])
        );
        if (source.size >= 0) {
            once(`got:${source.name}:${source.urls.join()}`, () =>
                print(source.fetchedAt || performance.now(), [
                    ['<- ', 'dim'],
                    [label, 'file'],
                    [source.size > 0 ? `  ${formatBytes(source.size)}` : '', 'num'],
                    source.cached
                        ? ['  cached', 'warn']
                        : source.transfer > 0 && source.transfer < source.size * 0.95
                          ? [`  wire ${formatBytes(source.transfer)}`, 'dim']
                          : ['', ''],
                    [`  ${msText((source.fetchedAt || performance.now()) - source.startedAt)}`, 'dim'],
                ])
            );
        }
        if (source.state === 'ready') {
            once(`ready:${source.name}`, () => {
                const verb =
                    source.type === 'gltfModel'
                        ? 'decode'
                        : source.type === 'json'
                          ? 'parse'
                          : 'decode';
                const facts = sourceFacts(source);
                const took = source.fetchedAt ? source.readyAt - source.fetchedAt : 0;
                print(source.readyAt, [
                    [`${verb} `, 'ok'],
                    [label, 'file'],
                    [facts ? `  ${facts}` : '', ''],
                    [took > 1 ? `  ${msText(took)}` : '', 'dim'],
                ]);
            });
        }
        if (source.state === 'failed') {
            once(`failed:${source.name}`, () => {
                failed = true;
                print(source.readyAt || performance.now(), [
                    ['failed ', 'err'],
                    [label, 'file'],
                    ['  reload the page to try again', 'err'],
                ]);
            });
        }
    };

    const printStage = (stage: StageProgress) => {
        if (!stage.doneAt) {
            if (stage.name === 'build') {
                once('build:start', () =>
                    print(stage.startedAt, [
                        ['build ', 'ok'],
                        [`room scene from ${loading.sources.size} sources`, ''],
                    ])
                );
            }
            return;
        }
        once(`stage:${stage.name}`, () => {
            const took = stage.doneAt - stage.startedAt;
            const snapshot = loading.snapshot();
            if (stage.name === 'download') {
                const size = snapshot.sources.reduce((sum, s) => sum + Math.max(0, s.size), 0);
                const wire = snapshot.sources.reduce((sum, s) => sum + Math.max(0, s.transfer), 0);
                const cached = snapshot.sources.filter((s) => s.cached).length;
                print(stage.doneAt, [
                    ['downloads done  ', 'ok'],
                    [`${stage.count} sources, ${formatBytes(size)}`, 'num'],
                    [size > 0 ? `, ${formatBytes(wire)} over the wire` : '', 'dim'],
                    [cached ? `, ${cached} from cache` : '', 'warn'],
                    [`  ${(took / 1000).toFixed(2)} s`, 'dim'],
                ]);
            } else if (stage.name === 'build') {
                print(stage.doneAt, [['built ', 'ok'], [`${stage.count} meshes`, 'num'], [`  ${msText(took)}`, 'dim']]);
            } else if (stage.name === 'compile') {
                print(stage.doneAt, [['shaders ready ', 'ok'], [`${stage.count} programs`, 'num'], [`  ${msText(took)}`, 'dim']]);
            } else if (stage.name === 'upload') {
                print(stage.doneAt, [['textures on the gpu ', 'ok'], [`${stage.count}`, 'num'], [`  ${msText(took)}`, 'dim']]);
            } else if (stage.name === 'frame') {
                print(stage.doneAt, [['first frame ', 'ok'], [`${stage.count} ms`, 'num']]);
            }
        });
    };

    const printItem = (item: LoadItem) => {
        if (item.stage === 'transcode') {
            print(item.at, [
                ['ktx2 transcode ', 'ok'],
                [item.label, 'file'],
                [`  ${item.detail}`, 'num'],
                [`  ${msText(item.ms)}`, 'dim'],
            ]);
        } else if (item.stage === 'compile') {
            print(item.at, [
                ['link program ', 'ok'],
                [item.label, 'file'],
                [item.detail ? `  ${item.detail}` : '', 'dim'],
                [item.ms ? `  ready after ${msText(item.ms)}` : '', 'dim'],
            ]);
        } else if (item.stage === 'upload') {
            print(item.at, [
                ['upload ', 'ok'],
                [item.label, 'file'],
                [item.detail ? `  ${item.detail}` : '', 'num'],
                [`  ${msText(item.ms)}`, 'dim'],
            ]);
        }
    };

    // header and what happened before this mounted
    print(0, [['yassin.app page load, times since navigation start', 'dim']]);
    const navigation = performance.getEntriesByType('navigation')[0] as
        | PerformanceNavigationTiming
        | undefined;
    if (navigation) {
        print(navigation.responseEnd, [
            ['<- ', 'dim'],
            ['index.html', 'file'],
            [`  ${formatBytes(navigation.decodedBodySize || 0)}`, 'num'],
            [`  ${msText(navigation.responseEnd - navigation.startTime)}`, 'dim'],
        ]);
    }
    const snapshot = loading.snapshot();
    snapshot.sources.forEach((s) => s.urls.forEach((url) => sourceUrls.add(url)));
    (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).forEach(printEntry);
    try {
        const gl = application.renderer.instance.getContext();
        const gpu = prettyGpu(readRenderer(gl).renderer);
        print(performance.now(), [
            ['webgl ', 'ok'],
            [
                `${typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext ? '2' : '1'} context on ${gpu.name}${gpu.api ? ` via ${gpu.api}` : ''}`,
                '',
            ],
        ]);
    } catch {
        // no context details
    }
    snapshot.sources.forEach(printSource);
    snapshot.stages.forEach(printStage);
    snapshot.items.forEach(printItem);

    let observer: PerformanceObserver | null = null;
    try {
        observer = new PerformanceObserver((list) =>
            (list.getEntries() as PerformanceResourceTiming[]).forEach(printEntry)
        );
        observer.observe({ type: 'resource', buffered: false });
    } catch {
        observer = null;
    }

    const onSource = (source: SourceProgress) => printSource(source);
    const onItem = (item: LoadItem) => printItem(item);
    const onStage = (stage: StageProgress) => printStage(stage);
    eventBus.on('loading:source', onSource);
    eventBus.on('loading:item', onItem);
    eventBus.on('loading:stage', onStage);

    return {
        print,
        failed: () => failed,
        dispose: () => {
            observer?.disconnect();
            eventBus.remove('loading:source', onSource);
            eventBus.remove('loading:item', onItem);
            eventBus.remove('loading:stage', onStage);
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
