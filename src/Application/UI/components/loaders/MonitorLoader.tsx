import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import eventBus from '../../EventBus';
import Application from '../../../Application';
import MonitorIntro, { SafeArea } from '../../../World/intro/MonitorIntro';
import { warmUp } from '../../../Utils/warmup';
import {
    formatBytes,
    measureRefreshRate,
    readHardware,
    type HardwareInfo,
} from '../../../Utils/hardwareInfo';
import type { SourceProgress, StageProgress, StageName } from '../../../Utils/Loading';
import { sourceLabel } from '../../loaders/facts';
import {
    isReturningVisitor,
    isTouchDevice,
    mark,
    markIntroSeen,
    prefersReducedMotion,
    skipIntro,
} from '../../loaders/variant';
import '../../loaders/loaders.css';

// ?loader=monitor: a power on self test of the visitor's own machine, drawn
// on the room's monitor (World/intro/MonitorIntro.ts puts it there). the
// hardware lines are what the browser reports, the loading lines are the
// real files with their real sizes, then "press any key" (audio needs a
// gesture) and the camera pulls back to the desk

const TARGET_FONT_PX = 15;
const TARGET_FONT_PX_SMALL = 12;

const pad2 = (n: number) => String(n).padStart(2, '0');
const clock = (date: Date) =>
    `${date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}  ${pad2(
        date.getHours()
    )}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;

const memoryText = (gb: number | null) => {
    if (gb === null) return 'not shared by this browser';
    if (gb >= 8) return 'at least 8 GB (browsers report 8 at most)';
    return `${gb} GB, as the browser reports it`;
};

const qualityText = (hw: HardwareInfo) => {
    const q = hw.quality;
    if (q.mode === 'quality') return 'Quality (your setting): full resolution';
    if (q.mode === 'performance') return 'Performance (your setting): 1x resolution, no extras';
    return `Auto: ${q.textures} room textures, antialiasing ${q.antialias ? 'on' : 'off'}, starts at ${q.startScale}x`;
};

type Row = { label: string; value: string; state: 'wait' | 'ok' | 'fail' | 'run'; note?: string };

const Leader: React.FC<{ row: Row }> = ({ row }) => (
    <div className={`boot-row boot-${row.state}`}>
        <span className="boot-row-label">{row.label}</span>
        <span className="boot-row-dots" />
        <span className="boot-row-value">{row.value}</span>
        {row.note ? <span className="boot-row-note">{row.note}</span> : null}
        <span className="boot-row-state">
            {row.state === 'ok' ? 'OK' : row.state === 'fail' ? 'FAIL' : row.state === 'run' ? '..' : ''}
        </span>
    </div>
);

const MonitorLoader: React.FC = () => {
    const application = useMemo(() => new Application(), []);
    const intro = application.world.intro as MonitorIntro;
    const [safe, setSafe] = useState<SafeArea>(() => intro.safeArea());
    const [hardware] = useState<HardwareInfo>(() =>
        readHardware(application.renderer.instance.getContext())
    );
    const [refresh, setRefresh] = useState<number | null>(null);
    const [now, setNow] = useState(() => new Date());
    const [sources, setSources] = useState<SourceProgress[]>(() => application.loading.snapshot().sources);
    const [stages, setStages] = useState<Partial<Record<StageName, StageProgress>>>(() => {
        const out: Partial<Record<StageName, StageProgress>> = {};
        application.loading.snapshot().stages.forEach((s) => (out[s.name] = s));
        return out;
    });
    const [warmed, setWarmed] = useState(false);
    const [booting, setBooting] = useState(false);
    const [gone, setGone] = useState(false);
    const returning = isReturningVisitor();
    const reduced = prefersReducedMotion();
    const touch = isTouchDevice();

    useEffect(() => intro.onResize(() => setSafe(intro.safeArea())), [intro]);

    useEffect(() => {
        let alive = true;
        void measureRefreshRate().then((hz) => alive && setRefresh(hz));
        const tick = window.setInterval(() => setNow(new Date()), 1000);
        const onSource = (source: SourceProgress) =>
            setSources((list) => {
                const next = list.filter((s) => s.name !== source.name);
                const index = list.findIndex((s) => s.name === source.name);
                next.splice(index < 0 ? next.length : index, 0, source);
                return next;
            });
        const onStage = (stage: StageProgress) => {
            setStages((all) => ({ ...all, [stage.name]: stage }));
            if (stage.name === 'build' && stage.doneAt) {
                void warmUp(application.camera.instance, { primeView: intro.primeView() }).then(
                    () => alive && setWarmed(true)
                );
            }
        };
        eventBus.on('loading:source', onSource);
        eventBus.on('loading:stage', onStage);
        return () => {
            alive = false;
            window.clearInterval(tick);
            eventBus.remove('loading:source', onSource);
            eventBus.remove('loading:stage', onStage);
        };
    }, [application]);

    const failed = sources.find((s) => s.state === 'failed');
    const ready = warmed && Boolean(stages.frame?.doneAt) && !failed;

    useEffect(() => {
        if (ready) mark('ready');
    }, [ready]);

    // press any key (or tap): the gesture audio needs, then the pull back
    useEffect(() => {
        if (!ready || booting) return;
        const boot = (event?: Event) => {
            if (event instanceof KeyboardEvent && (event.repeat || ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key))) {
                return;
            }
            setBooting(true);
            mark('done');
            const flightMs = intro.start({ fast: returning, reduced });
            eventBus.dispatch('loadingScreenDone', {
                variant: 'monitor',
                camera: 'intro',
                hintAfter: flightMs,
            });
            const ui = document.getElementById('ui');
            if (ui) ui.style.pointerEvents = 'none';
            markIntroSeen();
        };
        if (skipIntro()) {
            boot();
            return;
        }
        window.addEventListener('keydown', boot);
        window.addEventListener('pointerdown', boot);
        return () => {
            window.removeEventListener('keydown', boot);
            window.removeEventListener('pointerdown', boot);
        };
    }, [ready, booting, intro, returning, reduced]);

    // the boot screen leaves the dom with its css3d object
    useEffect(() => {
        if (!booting) return;
        const check = window.setInterval(() => {
            if (intro.state === 'done') {
                setGone(true);
                window.clearInterval(check);
            }
        }, 250);
        return () => window.clearInterval(check);
    }, [booting, intro]);

    if (gone) return null;

    const small = safe.width * safe.scale < 700;
    const fontSize = (small ? TARGET_FONT_PX_SMALL : TARGET_FONT_PX) / safe.scale;
    const twoColumns = safe.width / safe.height > 1.45;

    const hwRows: Row[] = [
        {
            label: 'GPU',
            value: hardware.gpu,
            state: 'ok',
            note: `WebGL ${hardware.webgl}${hardware.api ? ` via ${hardware.api}` : ''}, ${hardware.maxTexture} px textures, ${hardware.compression}`,
        },
        { label: 'CPU', value: hardware.cores ? `${hardware.cores} logical cores` : 'not shared', state: 'ok' },
        { label: 'Memory', value: memoryText(hardware.memoryGb), state: 'ok' },
        {
            label: 'Display',
            value: `${hardware.screen.width} x ${hardware.screen.height} at ${hardware.screen.dpr}x`,
            state: refresh === null ? 'run' : 'ok',
            note: refresh === null ? 'measuring refresh' : `${refresh} Hz measured`,
        },
        {
            label: 'Quality',
            value: qualityText(hardware),
            state: 'ok',
            note: `race preset ${hardware.quality.racePreset}, gpu tier ${hardware.quality.tier}`,
        },
    ];

    const done = sources.filter((s) => s.state === 'ready');
    const bytes = sources.reduce((sum, s) => sum + Math.max(0, s.size), 0);
    const wire = sources.reduce((sum, s) => sum + Math.max(0, s.transfer), 0);
    const cachedCount = sources.filter((s) => s.cached).length;
    const download = stages.download;
    const sourceRows: Row[] = sources.map((s) => ({
        label: sourceLabel(s),
        value:
            s.size > 0
                ? formatBytes(s.size)
                : s.received > 0
                  ? formatBytes(s.received)
                  : '',
        state: s.state === 'ready' ? 'ok' : s.state === 'failed' ? 'fail' : 'run',
        note: s.cached ? 'cached' : undefined,
    }));

    const stageRow = (name: StageName, label: string, value: (s: StageProgress) => string): Row => {
        const stage = stages[name];
        return {
            label,
            value: stage?.doneAt ? value(stage) : '',
            state: stage?.doneAt ? 'ok' : stage ? 'run' : 'wait',
        };
    };
    const pipelineRows: Row[] = [
        stageRow('build', 'Building the room', (s) => `${s.count} meshes`),
        stageRow('compile', 'Compiling shaders', (s) => `${s.count} programs`),
        stageRow('upload', 'Uploading textures', (s) => `${s.count} textures`),
        stageRow('frame', 'First frame', (s) => `${s.count} ms`),
    ];

    const stageBlock = (
        <div className="boot-stages">
            {pipelineRows.map((row) => (
                <Leader key={row.label} row={row} />
            ))}
        </div>
    );

    // two columns: the stages sit under the hardware, so the file list gets
    // the whole right column (a phone on its side is short)
    const hardwareBlock = (
        <section className="boot-block">
            <h3>Hardware check</h3>
            {hwRows.map((row) => (
                <div key={row.label} className="boot-hw">
                    <span className="boot-hw-label">{row.label}</span>
                    <span className="boot-hw-value">
                        {row.value}
                        {row.note ? <span className="boot-hw-note">{row.note}</span> : null}
                    </span>
                </div>
            ))}
            {twoColumns ? stageBlock : null}
        </section>
    );

    const loadingBlock = (
        <section className="boot-block">
            <h3>Loading the room</h3>
            {returning && download?.doneAt && !failed ? (
                <Leader
                    row={{
                        label: `${done.length} files`,
                        value: formatBytes(bytes),
                        note: cachedCount ? `${cachedCount} cached` : undefined,
                        state: 'ok',
                    }}
                />
            ) : (
                sourceRows.map((row) => <Leader key={row.label} row={row} />)
            )}
            {download?.doneAt ? (
                <div className="boot-sum">
                    {sources.length} files, {formatBytes(bytes)}
                    {wire > 0 && wire < bytes * 0.95 ? `, ${formatBytes(wire)} over the wire` : ''}
                    {cachedCount ? `, ${cachedCount} from cache` : ''} in{' '}
                    {((download.doneAt - download.startedAt) / 1000).toFixed(2)} s
                </div>
            ) : null}
            {twoColumns ? null : stageBlock}
        </section>
    );

    return ReactDOM.createPortal(
        <div
            className={`boot-safe ${twoColumns ? 'boot-two' : ''}`}
            style={{
                left: safe.x,
                top: safe.y,
                width: safe.width,
                height: safe.height,
                fontSize,
                padding: `${fontSize * 1.6}px ${fontSize * 2}px`,
            }}
        >
            <header className="boot-head">
                <div>
                    <b>yassin.app</b>
                    <span className="boot-dim"> power-on self test, run on your machine</span>
                </div>
                <div className="boot-dim">{clock(now)}</div>
            </header>
            <div className="boot-columns">
                {hardwareBlock}
                {loadingBlock}
            </div>
            <footer className="boot-foot">
                {failed ? (
                    <span className="boot-fail-text">
                        {sourceLabel(failed)} failed to load. Reload the page to try again.
                    </span>
                ) : ready ? (
                    <span className={booting ? 'boot-dim' : 'boot-prompt'}>
                        {booting ? 'Booting' : touch ? 'Tap to boot' : 'Press any key to boot'}
                        {booting ? null : <span className="boot-caret" />}
                    </span>
                ) : (
                    <span className="boot-dim">
                        Loading{sources.length ? `, ${done.length} of ${sources.length} files` : ''}
                        <span className="boot-caret" />
                    </span>
                )}
            </footer>
        </div>,
        intro.element
    );
};

export default MonitorLoader;
