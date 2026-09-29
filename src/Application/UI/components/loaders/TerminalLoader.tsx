import React, { useEffect, useRef, useState } from 'react';
import eventBus from '../../EventBus';
import Application from '../../../Application';
import { warmUp } from '../../../Utils/warmup';
import { formatBytes, prettyGpu, readRenderer } from '../../../Utils/hardwareInfo';
import {
    isCachedTiming,
    type LoadItem,
    type SourceProgress,
    type StageProgress,
} from '../../../Utils/Loading';
import { fileLabel, sourceFacts, sourceLabel } from '../../loaders/facts';
import {
    isReturningVisitor,
    mark,
    markIntroSeen,
    prefersReducedMotion,
    skipIntro,
} from '../../loaders/variant';
import '../../loaders/loaders.css';

// ?loader=terminal: a log of what this page load is really doing, written
// as it happens. every line is an event: resource timing for each file,
// the loaders' progress, the room build, each shader program as the driver
// finishes it, each texture upload and the first frame. times are seconds
// since the navigation started

type Tone = 'dim' | 'ok' | 'file' | 'num' | 'warn' | 'err' | 'cmd' | '';
type Part = [string, Tone?];

const MAX_LINES = 200;
const COMMAND = './yassin --start';

const stamp = (ms: number) => `[${(ms / 1000).toFixed(3).padStart(7, ' ')}]`;
const msText = (ms: number) => `${Math.max(0, Math.round(ms))} ms`;

const TerminalLoader: React.FC = () => {
    const logRef = useRef<HTMLDivElement>(null);
    const [command, setCommand] = useState<string | null>(null);
    const [phase, setPhase] = useState<'log' | 'wipe' | 'gone'>('log');

    useEffect(() => {
        const log = logRef.current;
        if (!log) return;
        const application = new Application();
        const loading = application.loading;
        const returning = isReturningVisitor();
        const reduced = prefersReducedMotion();
        const sourceUrls = new Set<string>();
        const printed = new Set<string>();
        let warmed = false;
        let framed = false;
        let failed = false;
        let finishing = false;
        const timers: number[] = [];

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
            // keep the log in time order: events can be reported a little
            // after they happened (resource timing is queued)
            let before: Element | null = null;
            for (let node = log.lastElementChild; node; node = node.previousElementSibling) {
                if (Number((node as HTMLElement).dataset.t) <= t) break;
                before = node;
            }
            log.insertBefore(line, before);
            while (log.childElementCount > MAX_LINES) log.firstElementChild?.remove();
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

        // the command is typed while the shaders compile and the textures
        // upload, so the enter lands when the room is ready rather than
        // adding to the wait
        let typing = false;
        let typed = false;
        let wiped = false;
        const wipe = () => {
            if (wiped || failed) return;
            wiped = true;
            mark('done');
            setPhase('wipe');
            eventBus.dispatch('loadingScreenDone', { variant: 'terminal' });
            const ui = document.getElementById('ui');
            if (ui) ui.style.pointerEvents = 'none';
            markIntroSeen();
            timers.push(window.setTimeout(() => setPhase('gone'), reduced ? 220 : 420));
        };
        const startTyping = () => {
            if (typing) return;
            typing = true;
            if (returning || reduced) {
                setCommand(COMMAND);
                typed = true;
                return;
            }
            // by the clock, not per tick: a frame stuck on a texture upload
            // doesn't hold the keystrokes back
            const startedAt = performance.now();
            const type = () => {
                const count = Math.min(
                    COMMAND.length,
                    1 + Math.floor((performance.now() - startedAt) / 22)
                );
                setCommand(COMMAND.slice(0, count));
                if (count < COMMAND.length) {
                    timers.push(window.setTimeout(type, 22));
                    return;
                }
                typed = true;
                if (finishing) wipe();
            };
            type();
        };
        const finish = () => {
            if (finishing || failed) return;
            finishing = true;
            mark('ready');
            startTyping();
            if (typed) wipe();
        };

        const maybeFinish = () => {
            if (warmed && framed) finish();
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
        const onStage = (stage: StageProgress) => {
            printStage(stage);
            if (stage.name === 'compile' && !stage.doneAt) startTyping();
            if (stage.name === 'build' && stage.doneAt) {
                void warmUp(application.camera.instance).then(() => {
                    warmed = true;
                    maybeFinish();
                });
            }
            if (stage.name === 'frame' && stage.doneAt) {
                framed = true;
                maybeFinish();
            }
        };
        eventBus.on('loading:source', onSource);
        eventBus.on('loading:item', onItem);
        eventBus.on('loading:stage', onStage);

        if (skipIntro()) {
            warmed = true;
            framed = true;
            typing = true;
            typed = true;
            finish();
        }

        return () => {
            observer?.disconnect();
            eventBus.remove('loading:source', onSource);
            eventBus.remove('loading:item', onItem);
            eventBus.remove('loading:stage', onStage);
            timers.forEach((id) => window.clearTimeout(id));
        };
    }, []);

    if (phase === 'gone') return null;
    return (
        <div
            className={`term-loader ${phase === 'wipe' ? 'term-wipe' : ''} ${
                prefersReducedMotion() ? 'term-reduced' : ''
            }`}
        >
            <div className="term-screen">
                <div className="term-log" ref={logRef} />
                {command !== null && (
                    <div className="term-line term-prompt">
                        <span className="term-cmd">$ </span>
                        <span>{command}</span>
                        <span className="term-caret" />
                    </div>
                )}
            </div>
        </div>
    );
};

export default TerminalLoader;
