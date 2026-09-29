import React, { useEffect, useState } from 'react';
import eventBus from '../EventBus';

// what the renderer found and chose, live, with a copy button so a slow
// machine's details can be sent as they are
type Info = {
    renderer: string;
    vendor: string;
    kind: string;
    detectedTier: string;
    reason: string;
    homeP50: number | null;
    race: {
        tier: string;
        reason: string;
        forced: boolean;
        preset: string;
        autoStep: number;
    } | null;
    mode: string;
    renderScale: number;
    buffer: string;
    viewport: string;
    devicePixelRatio: number;
    cores: number | null;
    memoryGb: number | null;
    frameP50: number;
    frameP95: number;
    frameP99: number;
    cpuP50: number;
    gpuP50: number | null;
    gpuTimer: boolean;
    bound: string;
    drawCalls: number;
    userAgent: string;
};

const ms = (value: number | null) => (value === null ? '--' : `${value} ms`);

const lines = (info: Info) => [
    `Renderer: ${info.renderer || '(hidden)'}`,
    `Vendor: ${info.vendor || '(hidden)'}`,
    `Detected: ${info.detectedTier} (${info.kind}: ${info.reason})`,
    info.race
        ? `Race: ${info.race.tier} tier, ${info.race.preset} preset${
              info.race.autoStep ? `, auto step ${info.race.autoStep}` : ''
          }${info.race.forced ? ' (forced)' : ''}`
        : 'Race: not started',
    `Mode: ${info.mode}, render scale ${info.renderScale}x, buffer ${info.buffer}, viewport ${info.viewport} at DPR ${info.devicePixelRatio}`,
    `Frame: p50 ${ms(info.frameP50)}, p95 ${ms(info.frameP95)}, p99 ${ms(info.frameP99)}`,
    `CPU ${ms(info.cpuP50)}, GPU ${info.gpuTimer ? ms(info.gpuP50) : 'no timer'}, bound: ${info.bound}, ${info.drawCalls} draws`,
    `Homepage p50: ${ms(info.homeP50)}`,
    `CPU cores: ${info.cores ?? '?'}, memory: ${info.memoryGb ?? '?'} GB`,
    `Browser: ${info.userAgent}`,
];

const GraphicsInfo = ({ floating = false }: { floating?: boolean }) => {
    const [info, setInfo] = useState<Info | null>(null);
    const [copied, setCopied] = useState('');

    useEffect(() => {
        const onInfo = (next: Info) => setInfo(next);
        eventBus.on('graphics:info', onInfo);
        eventBus.dispatch('graphics:requestInfo', {});
        const timer = window.setInterval(
            () => eventBus.dispatch('graphics:requestInfo', {}),
            1000
        );
        return () => {
            window.clearInterval(timer);
            eventBus.remove('graphics:info', onInfo);
        };
    }, []);

    const copy = async () => {
        if (!info) return;
        const text = lines(info).join('\n');
        try {
            await navigator.clipboard.writeText(text);
            setCopied('Copied');
        } catch {
            // no clipboard permission: select it for a manual copy
            window.prompt('Copy the graphics info', text);
            setCopied('');
        }
        window.setTimeout(() => setCopied(''), 1500);
    };

    return (
        <div
            className={`graphics-info ${floating ? 'floating' : ''}`}
            data-prevent-click
        >
            <div className="graphics-info-head">
                <strong>Graphics info</strong>
                <button type="button" onClick={copy} disabled={!info}>
                    {copied || 'Copy'}
                </button>
            </div>
            {info ? (
                <ul>
                    {lines(info)
                        .slice(0, floating ? 7 : 9)
                        .map((line) => (
                            <li key={line.slice(0, 12)}>{line}</li>
                        ))}
                </ul>
            ) : (
                <p>Measuring...</p>
            )}
        </div>
    );
};

export default GraphicsInfo;
