import React, { useEffect, useRef, useState } from 'react';
import eventBus from '../EventBus';
import { carOptions } from '../../carOptions';
import { formatTime } from './RaceHudGauges';
import { WATCH_RATES, type WatchControl } from '../../Racing/Ghost/watchClock';
import type { LapEntry } from './LapCard';

type WatchHud = { timeMs: number; speedKph: number; playing: boolean; rate: number };

type Props = {
    entry: LapEntry;
    durationMs: number;
    onBack: () => void;
};

const control = (state: WatchControl) => eventBus.dispatch('race:watchControl', state);

// watching a lap from the board: the race paused under it with nothing over
// the view but this bar. drag looks around the car, scroll zooms, space
// pauses, the arrows skip 10 s and esc goes back to the lap's card
const WatchMode = ({ entry, durationMs, onBack }: Props) => {
    const drag = useRef<{ x: number; y: number } | null>(null);
    const [hud, setHud] = useState<WatchHud>({ timeMs: 0, speedKph: 0, playing: true, rate: 1 });
    const playing = useRef(true);
    playing.current = hud.playing;
    const car = carOptions.find((option) => option.id === entry.carId);

    useEffect(() => {
        const onHud = (next: WatchHud) => setHud(next);
        eventBus.on('race:watchHud', onHud);
        return () => eventBus.remove('race:watchHud', onHud);
    }, []);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            const skip = event.code === 'ArrowLeft' ? -10000 : event.code === 'ArrowRight' ? 10000 : 0;
            if (event.key === 'Escape') onBack();
            else if (event.code === 'Space') control({ playing: !playing.current });
            else if (skip) control({ skipMs: skip });
            else return;
            event.preventDefault();
            event.stopPropagation();
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [onBack]);

    return (
        <div
            className="race-photo race-watch"
            data-prevent-click
            onPointerDown={(e) => {
                drag.current = { x: e.clientX, y: e.clientY };
                (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            }}
            onPointerMove={(e) => {
                if (!drag.current) return;
                eventBus.dispatch('race:watchOrbit', {
                    dx: e.clientX - drag.current.x,
                    dy: e.clientY - drag.current.y,
                });
                drag.current = { x: e.clientX, y: e.clientY };
            }}
            onPointerUp={() => {
                drag.current = null;
            }}
            onWheel={(e) => eventBus.dispatch('race:watchZoom', { delta: e.deltaY })}
        >
            <div className="race-watch-tag" onPointerDown={(e) => e.stopPropagation()}>
                <span>Replay</span>
                <strong>{entry.name}</strong>
                <small>
                    {car?.label || entry.carId} · {formatTime(entry.lapTimeMs)}
                </small>
            </div>
            <div
                className="race-photo-bar race-watch-bar"
                onPointerDown={(e) => e.stopPropagation()}
                onWheel={(e) => e.stopPropagation()}
            >
                <button
                    type="button"
                    className="race-watch-play"
                    aria-label={hud.playing ? 'Pause' : 'Play'}
                    onClick={() => control({ playing: !hud.playing })}
                >
                    {hud.playing ? 'Pause' : 'Play'}
                </button>
                <span className="race-watch-time">
                    {formatTime(hud.timeMs || 1).replace(/\.\d+$/, '')} / {formatTime(durationMs).replace(/\.\d+$/, '')}
                </span>
                <input
                    type="range"
                    className="race-watch-scrub"
                    aria-label="Lap time"
                    min={0}
                    max={Math.max(1, Math.round(durationMs))}
                    step={100}
                    value={Math.round(hud.timeMs)}
                    onChange={(e) => {
                        const seekMs = Number(e.target.value);
                        setHud((current) => ({ ...current, timeMs: seekMs }));
                        control({ seekMs });
                    }}
                />
                <div className="race-watch-rates" role="group" aria-label="Speed">
                    {WATCH_RATES.map((rate) => (
                        <button
                            type="button"
                            key={rate}
                            className={hud.rate === rate ? 'on' : ''}
                            onClick={() => control({ rate })}
                        >
                            {rate}x
                        </button>
                    ))}
                </div>
                <span className="race-watch-speed">
                    <strong>{hud.speedKph}</strong> km/h
                </span>
                <button type="button" onClick={onBack}>
                    Back <kbd>Esc</kbd>
                </button>
                <span className="race-photo-hint race-photo-keys">
                    Drag to look around, scroll to zoom, <kbd>Space</kbd> pause, <kbd>←</kbd> <kbd>→</kbd> 10 s
                </span>
            </div>
        </div>
    );
};

export default WatchMode;
