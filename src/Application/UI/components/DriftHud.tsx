import React, { useEffect, useState } from 'react';

export type DriftHudState = {
    total: number;
    chain: number;
    multiplier: number;
    angle: number;
    drifting: boolean;
    event:
        | { kind: 'banked'; points: number; at: number }
        | { kind: 'lost'; points: number; reason: 'wall' | 'grass' | 'spin'; at: number }
        | null;
    lastRun: { score: number; lapTimeMs: number } | null;
};

const LOST: Record<string, string> = {
    wall: 'Hit the wall',
    grass: 'Off the track',
    spin: 'Spun out',
};

// how long a banked or lost chain stays up, ms
const FLASH_MS = 1600;

const points = (value: number) => Math.round(value).toLocaleString('en-US');

const lapTime = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = (ms % 60000) / 1000;
    return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
};

// the drift park's score: the run's total, the chain building under it with
// its multiplier and the angle, and a flash when a chain banks or is lost
const DriftHud = ({ drift, best }: { drift: DriftHudState; best: number }) => {
    const [flash, setFlash] = useState<DriftHudState['event']>(null);
    const key = drift.event ? `${drift.event.kind}:${drift.event.at}` : '';

    useEffect(() => {
        if (!drift.event) return;
        setFlash(drift.event);
        const timer = window.setTimeout(() => setFlash(null), FLASH_MS);
        return () => window.clearTimeout(timer);
    }, [key]);

    const chaining = drift.chain > 0;
    return (
        <div className="drift-hud" data-prevent-click>
            <div className="drift-hud-label">Drift score</div>
            <div className="drift-hud-total">{points(drift.total)}</div>
            <div className={`drift-hud-chain ${chaining ? 'on' : ''} ${drift.drifting ? 'live' : ''}`}>
                <span className="drift-hud-points">+{points(drift.chain)}</span>
                <span className="drift-hud-multiplier">x{drift.multiplier.toFixed(1)}</span>
                <span className="drift-hud-angle">{drift.angle}°</span>
            </div>
            {flash && (
                <div className={`drift-hud-flash ${flash.kind}`} key={key}>
                    {flash.kind === 'banked'
                        ? `Banked +${points(flash.points)}`
                        : `${LOST[flash.reason]}${flash.points ? `, lost ${points(flash.points)}` : ''}`}
                </div>
            )}
            <div className="drift-hud-runs">
                {drift.lastRun && (
                    <span>
                        Last run {points(drift.lastRun.score)} in {lapTime(drift.lastRun.lapTimeMs)}
                    </span>
                )}
                {best > 0 && <span>Best {points(best)}</span>}
            </div>
        </div>
    );
};

export default DriftHud;
