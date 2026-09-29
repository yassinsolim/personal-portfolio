import React, { useEffect, useMemo, useRef, useState } from 'react';
import eventBus from '../../EventBus';
import Application from '../../../Application';
import { STAGES, type PipelineState } from '../../../World/intro/PipelineIntro';
import { formatBytes } from '../../../Utils/hardwareInfo';
import type { LoadItem, SourceProgress, StageProgress } from '../../../Utils/Loading';
import { modelFacts, sourceLabel } from '../../loaders/facts';
import { prefersReducedMotion } from '../../loaders/variant';
import '../../loaders/loaders.css';

// ?loader=pipeline: the stage labels over the room as it assembles
// (World/intro/PipelineIntro.ts draws the stages). each line is filled from
// the loading step that gates it

const LABELS: Record<(typeof STAGES)[number], string> = {
    input: 'INPUT',
    vertex: 'VERTEX',
    primitive: 'PRIMITIVE',
    raster: 'RASTER',
    texture: 'TEXTURE',
    lighting: 'LIGHTING',
    output: 'OUTPUT',
};

const ROOM_MODELS = ['computerSetupModel', 'environmentModel', 'decorModel'];
const count = (n: number) => n.toLocaleString('en-US');

const PipelineLoader: React.FC = () => {
    const application = useMemo(() => new Application(), []);
    const [state, setState] = useState<PipelineState>({ stage: 0, front: 0, sweeping: false, done: false });
    const [sources, setSources] = useState<SourceProgress[]>(() => application.loading.snapshot().sources);
    const [stages, setStages] = useState<Record<string, StageProgress>>({});
    const [lastUpload, setLastUpload] = useState<LoadItem | null>(null);
    const [compiled, setCompiled] = useState(0);
    const [hidden, setHidden] = useState(false);
    const scanRef = useRef<HTMLDivElement>(null);
    const reduced = prefersReducedMotion();

    useEffect(() => {
        let last = '';
        const onState = (next: PipelineState) => {
            if (scanRef.current) {
                scanRef.current.style.transform = `translateY(${next.front * window.innerHeight}px)`;
                scanRef.current.style.opacity = next.sweeping && !reduced ? '1' : '0';
            }
            const key = `${next.stage}:${next.sweeping}:${next.done}`;
            if (key !== last) {
                last = key;
                setState(next);
            }
        };
        const onSource = (source: SourceProgress) =>
            setSources((list) => {
                const index = list.findIndex((s) => s.name === source.name);
                if (index < 0) return [...list, source];
                const next = [...list];
                next[index] = source;
                return next;
            });
        const onStage = (stage: StageProgress) => setStages((all) => ({ ...all, [stage.name]: stage }));
        const onItem = (item: LoadItem) => {
            if (item.stage === 'upload') setLastUpload(item);
            if (item.stage === 'compile') setCompiled((n) => n + 1);
        };
        eventBus.on('pipeline:state', onState);
        eventBus.on('loading:source', onSource);
        eventBus.on('loading:stage', onStage);
        eventBus.on('loading:item', onItem);
        return () => {
            eventBus.remove('pipeline:state', onState);
            eventBus.remove('loading:source', onSource);
            eventBus.remove('loading:stage', onStage);
            eventBus.remove('loading:item', onItem);
        };
    }, [application, reduced]);

    useEffect(() => {
        if (!state.done) return;
        const id = window.setTimeout(() => setHidden(true), 1400);
        return () => window.clearTimeout(id);
    }, [state.done]);

    if (hidden) return null;

    const items = application.resources.items;
    const room = sources.filter((s) => ROOM_MODELS.includes(s.name) && s.state === 'ready');
    const facts = room.reduce(
        (sum, s) => {
            const gltf = items.gltfModel[s.name];
            if (!gltf) return sum;
            const f = modelFacts(gltf.scene);
            return { vertices: sum.vertices + f.vertices, triangles: sum.triangles + f.triangles };
        },
        { vertices: 0, triangles: 0 }
    );
    const ready = sources.filter((s) => s.state === 'ready');
    const bytes = sources.reduce((sum, s) => sum + Math.max(0, s.size >= 0 ? s.size : s.received), 0);
    const envMap = sources.find((s) => s.type === 'cubeTexture');
    const compile = stages.compile;
    const upload = stages.upload;

    const detail = (name: (typeof STAGES)[number]): string => {
        switch (name) {
            case 'input':
                return `${ready.length} of ${sources.length} files, ${formatBytes(bytes)}`;
            case 'vertex':
                return room.length
                    ? `${room.map((s) => sourceLabel(s)).join(', ')}: ${count(facts.vertices)} vertices`
                    : '';
            case 'primitive':
                return room.length ? `${count(facts.triangles)} triangles, as wireframe` : '';
            case 'raster':
                return stages.build?.doneAt
                    ? `${stages.build.count} meshes flat shaded, ${
                          compile?.doneAt ? `${compile.count} shaders compiled` : `compiling shaders (${compiled} ready)`
                      }`
                    : '';
            case 'texture':
                return upload?.doneAt
                    ? `${upload.count} textures on the gpu, light and shadows baked in`
                    : lastUpload
                      ? `uploading ${lastUpload.label} ${lastUpload.detail}`
                      : '';
            case 'lighting':
                return envMap ? `environment map (${envMap.urls.length} faces) on the car, contact shadow, monitor on` : '';
            case 'output':
                return 'film grain, then the live scene';
            default:
                return '';
        }
    };

    return (
        <div className={`pipe-hud ${state.done ? 'pipe-done' : ''}`} aria-live="polite">
            {!reduced && <div className="pipe-scan" ref={scanRef} />}
            <div className="pipe-panel">
                <div className="pipe-title">GPU pipeline, this page load</div>
                {STAGES.map((name, index) => {
                    const done = index < state.stage || (index === state.stage && state.done);
                    const active = index === state.stage || (state.sweeping && index === state.stage + 1);
                    if (index > state.stage + 1) return null;
                    return (
                        <div
                            key={name}
                            className={`pipe-row ${done ? 'pipe-row-done' : ''} ${active ? 'pipe-row-active' : ''}`}
                        >
                            <span className="pipe-mark">{done ? 'ok' : active ? '>' : ' '}</span>
                            <span className="pipe-name">{LABELS[name]}</span>
                            <span className="pipe-detail">{detail(name)}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default PipelineLoader;
