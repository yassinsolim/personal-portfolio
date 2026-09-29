import React, { useEffect, useRef, useState } from 'react';
import eventBus from '../../EventBus';
import Application from '../../../Application';
import { warmUp } from '../../../Utils/warmup';
import type { StageProgress } from '../../../Utils/Loading';
import { createBootLog, createTyper } from '../../loaders/bootLog';
import {
    isReturningVisitor,
    mark,
    markIntroSeen,
    prefersReducedMotion,
    skipIntro,
} from '../../loaders/variant';
import '../../loaders/loaders.css';

// ?loader=terminal: the page load log (loaders/bootLog.ts) full screen, then
// ./yassin --start and a crt style collapse into the room

const TerminalLoader: React.FC = () => {
    const logRef = useRef<HTMLDivElement>(null);
    const promptRef = useRef<HTMLDivElement>(null);
    const commandRef = useRef<HTMLSpanElement>(null);
    const [phase, setPhase] = useState<'log' | 'wipe' | 'gone'>('log');

    useEffect(() => {
        if (!logRef.current || !promptRef.current || !commandRef.current) return;
        const application = new Application();
        const reduced = prefersReducedMotion();
        const log = createBootLog(logRef.current);
        const typer = createTyper(promptRef.current, commandRef.current, isReturningVisitor() || reduced);
        const timers: number[] = [];
        let warmed = false;
        let framed = false;
        let finishing = false;
        let wiped = false;

        const wipe = () => {
            if (wiped || log.failed()) return;
            wiped = true;
            mark('done');
            setPhase('wipe');
            eventBus.dispatch('loadingScreenDone', { variant: 'terminal' });
            const ui = document.getElementById('ui');
            if (ui) ui.style.pointerEvents = 'none';
            markIntroSeen();
            timers.push(window.setTimeout(() => setPhase('gone'), reduced ? 220 : 420));
        };
        // the command is typed while the shaders compile and the textures
        // upload, so the enter lands when the room is ready
        const maybeFinish = () => {
            if (!warmed || !framed || finishing || log.failed()) return;
            finishing = true;
            mark('ready');
            typer.start();
            typer.whenTyped(wipe);
        };
        const onStage = (stage: StageProgress) => {
            if (stage.name === 'compile' && !stage.doneAt) typer.start();
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
        eventBus.on('loading:stage', onStage);
        if (skipIntro()) {
            warmed = true;
            framed = true;
            wipe();
        }
        return () => {
            log.dispose();
            typer.dispose();
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
                <div className="term-line term-prompt" ref={promptRef} style={{ visibility: 'hidden' }}>
                    <span className="term-cmd">$ </span>
                    <span ref={commandRef} />
                    <span className="term-caret" />
                </div>
            </div>
        </div>
    );
};

export default TerminalLoader;
