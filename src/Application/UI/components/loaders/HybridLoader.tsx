import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import eventBus from '../../EventBus';
import Application from '../../../Application';
import TerminalDock, { type Rect } from '../../../World/intro/TerminalDock';
import type { PipelineState } from '../../../World/intro/PipelineIntro';
import type { LoadStage } from '../../../Utils/loadStages';
import { createBootLog, createTyper } from '../../loaders/bootLog';
import { modelFacts } from '../../loaders/facts';
import { HYBRID, dockTargetName } from '../../loaders/hybridConfig';
import {
    isReturningVisitor,
    mark,
    markIntroSeen,
    prefersReducedMotion,
    skipIntro,
} from '../../loaders/variant';
import '../../loaders/loaders.css';

// ?loader=hybrid: the terminal narrates the pipeline. the room assembles
// behind the log (World/intro/PipelineIntro.ts), each loading step prints
// its line and moves the render stage, the stage lines say what the frame
// just became, and when the room reaches HYBRID.dockAtStage the terminal
// docks onto the room's screen (World/intro/TerminalDock.ts). then
// ./yassin --start and the live scene; no key, the first click is the
// gesture audio gets

const ROOM_MODELS = ['computerSetupModel', 'environmentModel', 'decorModel'];
const DOCK_MS = 750;
const DOCK_FAST_MS = 380;
// the log reads about this big while flat, in css pixels
const FONT_PX = 12.5;
const FONT_PX_SMALL = 10.5;
const count = (n: number) => n.toLocaleString('en-US');

// the flat panel: right of the room on a wide page (the idle view keeps the
// car and desk left of center), over the top of a tall one
const layout = (width: number, height: number, aspect: number): Rect => {
    if (width / height >= 1.1) {
        const w = Math.min(width * 0.4, height * 0.84 * aspect);
        const h = w / aspect;
        return { x: width - w - Math.max(12, width * 0.025), y: (height - h) / 2, w, h };
    }
    let w = width * 0.94;
    let h = w / aspect;
    if (h > height * 0.5) {
        h = height * 0.5;
        w = h * aspect;
    }
    return { x: (width - w) / 2, y: Math.max(10, height * 0.025), w, h };
};

const HybridLoader: React.FC = () => {
    const panelRef = useRef<HTMLDivElement>(null);
    const logRef = useRef<HTMLDivElement>(null);
    const promptRef = useRef<HTMLDivElement>(null);
    const commandRef = useRef<HTMLSpanElement>(null);
    const scanRef = useRef<HTMLDivElement>(null);
    const [gone, setGone] = useState(false);

    useEffect(() => {
        const panel = panelRef.current;
        if (!panel || !logRef.current || !promptRef.current || !commandRef.current) return;
        const application = new Application();
        const returning = isReturningVisitor();
        const reduced = prefersReducedMotion();
        const dock = new TerminalDock(panel, HYBRID.panelWidth, HYBRID.panelHeight);
        const log = createBootLog(logRef.current);
        const typer = createTyper(promptRef.current, commandRef.current, returning || reduced);
        const timers: number[] = [];
        let workDoneAt = 0;
        let done = false;
        let released = false;
        let live = false;
        let docked = false;
        // the room is live, the command ran and the terminal is on its screen
        // (in any order): the screen gets its own content back after a moment
        const maybeRelease = () => {
            if (!live || !done || !docked || released) return;
            released = true;
            setGone(true);
            timers.push(
                window.setTimeout(() => {
                    void dock.release().then(() => {
                        mark('os');
                        eventBus.dispatch('loader:showHint', {});
                    });
                }, returning ? 500 : 1100)
            );
        };

        const fit = () => {
            if (dock.state !== 'flat') return;
            const { width, height } = application.sizes;
            dock.place(layout(width, height, dock.width / dock.height));
            const small = dock.scale() * dock.width < 520;
            panel.style.fontSize = `${(small ? FONT_PX_SMALL : FONT_PX) / dock.scale()}px`;
        };
        fit();
        application.sizes.on('resize.hybrid', fit);

        const stageLine = (name: string): string => {
            const items = application.resources.items;
            const room = ROOM_MODELS.filter((n) => items.gltfModel[n]);
            const facts = room.reduce(
                (sum, n) => {
                    const f = modelFacts(items.gltfModel[n].scene);
                    return { v: sum.v + f.vertices, t: sum.t + f.triangles };
                },
                { v: 0, t: 0 }
            );
            let meshes = 0;
            application.scene.traverse((o) => {
                if ((o as THREE.Mesh).isMesh && !o.userData.pipelineIntroPart) meshes++;
            });
            switch (name) {
                case 'vertex':
                    return `${count(facts.v)} vertices of ${room.length} room model${room.length === 1 ? '' : 's'}, as points`;
                case 'primitive':
                    return `${count(facts.t)} triangles, as wireframe`;
                case 'raster':
                    return `${meshes} meshes flat shaded while the textures upload and the real shaders compile`;
                case 'texture':
                    return 'baked textures on, light and shadows baked in';
                case 'lighting':
                    return 'environment map on the car, contact shadow';
                case 'output':
                    return 'film grain; this is the live scene now';
                default:
                    return '';
            }
        };

        const finish = () => {
            if (done || log.failed()) return;
            done = true;
            mark('done');
            timers.push(window.setTimeout(maybeRelease, 0));
            // the site's own ui waits for the sweeps and the dock to finish
            // the site's control panel waits for yassinOS to be on the monitor
            // (loader:showHint), so the finish isn't crowded
            eventBus.dispatch('loadingScreenDone', {
                variant: 'hybrid',
                camera: 'intro',
                keepClock: true,
                holdHint: true,
            });
            const ui = document.getElementById('ui');
            if (ui) ui.style.pointerEvents = 'none';
            markIntroSeen();
        };
        // enter lands when the work is done and the command is typed; the
        // last sweeps and the dock finish over the live room (their time is
        // capped by the pipeline's catch up), so they never hold input back
        const maybeFinish = () => {
            if (!workDoneAt || done || !typer.typed()) return;
            finish();
        };

        // the command is typed while the shaders compile, so enter can land
        // as soon as the room is ready
        const onStage = (progress: LoadStage) => {
            if (progress.scope === 'homepage' && progress.stage === 'compile') typer.start();
        };
        // the room is built: find the screen to dock on, and keep what it
        // shows hidden (and out of the keyboard's way) under the terminal
        const onBuilt = () => {
            const target = dock.resolve(dockTargetName());
            target?.content?.setOpacity(0);
            target?.content?.setInert(true);
            fit();
        };
        application.resources.on('ready.hybrid', onBuilt);
        const onPipelineStage = ({ name }: { name: string }) => {
            log.print(performance.now(), [
                ['stage ', 'stage'],
                [name.toUpperCase().padEnd(10, ' '), 'stage'],
                [stageLine(name), ''],
            ]);
        };
        const onReached = ({ name }: { name: string }) => {
            if (name === HYBRID.dockAtStage && dock.target) {
                log.print(performance.now(), [
                    ['dock ', 'ok'],
                    [`terminal onto ${dock.target.name}`, 'file'],
                ]);
                const ms = reduced ? 0 : returning ? DOCK_FAST_MS : DOCK_MS;
                void dock.dock(ms, reduced).then(() => {
                    docked = true;
                    maybeRelease();
                });
            }
        };
        const onWorkDone = () => {
            workDoneAt = performance.now();
            typer.start();
            typer.whenTyped(maybeFinish);
        };
        const onState = (state: PipelineState) => {
            if (scanRef.current) {
                scanRef.current.style.transform = `translateY(${state.front * window.innerHeight}px)`;
                scanRef.current.style.opacity = state.sweeping && !reduced ? '1' : '0';
            }
            if (state.done) {
                live = true;
                maybeRelease();
            }
        };
        eventBus.on('load:stage', onStage);
        eventBus.on('pipeline:stage', onPipelineStage);
        eventBus.on('pipeline:reached', onReached);
        eventBus.on('hybrid:workDone', onWorkDone);
        eventBus.on('pipeline:state', onState);
        if (skipIntro()) finish();

        return () => {
            log.dispose();
            typer.dispose();
            application.sizes.off('resize.hybrid');
            eventBus.remove('load:stage', onStage);
            application.resources.off('ready.hybrid');
            eventBus.remove('pipeline:stage', onPipelineStage);
            eventBus.remove('pipeline:reached', onReached);
            eventBus.remove('hybrid:workDone', onWorkDone);
            eventBus.remove('pipeline:state', onState);
            timers.forEach((id) => window.clearTimeout(id));
        };
    }, []);

    // the panel itself lives on in the room after docking; only the overlay
    // around it (the scan line) goes
    return (
        <div className="hyb-overlay">
            {!gone && <div className="pipe-scan" ref={scanRef} />}
            <div className={`hyb-panel ${prefersReducedMotion() ? 'hyb-reduced' : ''}`} ref={panelRef}>
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

export default HybridLoader;
