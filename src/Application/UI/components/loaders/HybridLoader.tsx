import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import eventBus from '../../EventBus';
import Application from '../../../Application';
import { STAGES, type PipelineState } from '../../../World/intro/PipelineIntro';
import { COMMAND, createBootLog, type LogSink } from '../../loaders/bootLog';
import { modelFacts } from '../../loaders/facts';
import { markIntroSeen, mark, prefersReducedMotion, skipIntro } from '../../loaders/variant';
import '../../loaders/loaders.css';

// the hybrid loading screen: the terminal narrates the gpu pipeline. the
// camera boots on the room's terminal screen (World/intro/M3Dock.ts) and the
// log is written there, through the screen registry's terminal
// (claimTerminal, appendLog); around it the room assembles
// (World/intro/PipelineIntro.ts), each loading step printing its line and
// moving the render stage. then ./yassin --start, the camera pulls back and
// the same screen becomes the room's live terminal (setMode('shell')). no
// key press: the first click is the gesture audio gets

const count = (n: number) => n.toLocaleString('en-US');

const HybridLoader: React.FC = () => {
    const scanRef = useRef<HTMLDivElement>(null);
    const [gone, setGone] = useState(false);

    useEffect(() => {
        const application = new Application();
        const reduced = prefersReducedMotion();
        const screens = application.world.screens;
        // lines wait here until the terminal display has loaded
        const pending: [string, Parameters<LogSink>[1]][] = [];
        let terminal: Awaited<ReturnType<typeof screens.claimTerminal>> = null;
        const sink: LogSink = (line, kind) => {
            if (terminal) terminal.appendLog(line, kind);
            else pending.push([line, kind]);
        };
        void screens.claimTerminal().then((display) => {
            terminal = display;
            pending.splice(0).forEach(([line, kind]) => display?.appendLog(line, kind));
        });
        const log = createBootLog(sink);
        let done = false;

        const stageLine = (name: string): string => {
            // Room moves the model's groups into the scene, so count its meshes
            // once it's built, the model before that
            const built = application.world.room?.meshes();
            const model = application.resources.items.gltfModel.roomModel;
            const facts = built
                ? built.reduce(
                      (sum, mesh) => {
                          const f = modelFacts(mesh);
                          return { vertices: sum.vertices + f.vertices, triangles: sum.triangles + f.triangles };
                      },
                      { vertices: 0, triangles: 0 }
                  )
                : model
                  ? modelFacts(model.scene)
                  : { vertices: 0, triangles: 0 };
            let meshes = 0;
            application.scene.traverse((o) => {
                if ((o as THREE.Mesh).isMesh && !o.userData.pipelineIntroPart) meshes++;
            });
            switch (name) {
                case 'vertex':
                    return `${count(facts.vertices)} vertices of the room, as points`;
                case 'primitive':
                    return `${count(facts.triangles)} triangles, as wireframe`;
                case 'raster':
                    return `${meshes} meshes flat shaded while the textures upload and the shaders compile`;
                case 'texture':
                    return 'baked atlases on, light and shadows baked in';
                case 'lighting':
                    return 'environment map on the car, contact shadow, the screens on';
                case 'output':
                    return 'film grain; this is the live room';
                default:
                    return '';
            }
        };

        // the work is done: enter, the camera pulls back, the screen becomes
        // the shell. the last sweeps finish over the live room
        const finish = () => {
            if (done || log.failed()) return;
            done = true;
            // the last sweeps play over the live room, so their lines go in now
            const now = performance.now();
            log.sync();
            STAGES.forEach((name) => {
                if (name !== 'input' && !narrated.has(name)) onPipelineStage({ name }, now);
            });
            log.close(now, [['$ ', 'cmd'], [COMMAND, 'cmd']]);
            mark('done');
            eventBus.dispatch('loadingScreenDone', { variant: 'hybrid', camera: 'intro', holdHint: true });
            const ui = document.getElementById('ui');
            if (ui) ui.style.pointerEvents = 'none';
            markIntroSeen();
            void screens.terminal().then((display) => display?.setMode('shell'));
        };

        const narrated = new Set<string>();
        const onPipelineStage = ({ name }: { name: string }, t = performance.now()) => {
            if (narrated.has(name)) return;
            narrated.add(name);
            log.print(t, [
                ['stage ', 'stage'],
                [name.toUpperCase().padEnd(10, ' '), 'stage'],
                [stageLine(name), ''],
            ]);
        };
        const onState = (state: PipelineState) => {
            if (scanRef.current) {
                scanRef.current.style.transform = `translateY(${state.front * window.innerHeight}px)`;
                scanRef.current.style.opacity = state.sweeping && !reduced ? '1' : '0';
            }
            if (state.done) setGone(true);
        };
        eventBus.on('pipeline:stage', onPipelineStage);
        eventBus.on('hybrid:workDone', finish);
        eventBus.on('pipeline:state', onState);
        if (skipIntro()) finish();

        return () => {
            log.dispose();
            eventBus.remove('pipeline:stage', onPipelineStage);
            eventBus.remove('hybrid:workDone', finish);
            eventBus.remove('pipeline:state', onState);
        };
    }, []);

    if (gone) return null;
    return (
        <div className="hyb-overlay">
            <div className="pipe-scan" ref={scanRef} />
        </div>
    );
};

export default HybridLoader;
