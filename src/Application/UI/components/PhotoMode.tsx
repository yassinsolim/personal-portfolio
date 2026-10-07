import React, { useEffect, useRef, useState } from 'react';
import eventBus from '../EventBus';

// photo mode: the race paused with nothing over it. drag (or the right stick)
// moves around the car, scroll (or the triggers) zooms, and the saved png is
// just the frame, no hud
const PhotoMode = () => {
    const drag = useRef<{ x: number; y: number } | null>(null);
    const [fov, setFov] = useState(50);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.code !== 'Escape' && event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            eventBus.dispatch('race:photoMode', { on: false });
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, []);

    useEffect(() => {
        if (!saved) return undefined;
        const timer = window.setTimeout(() => setSaved(false), 1600);
        return () => window.clearTimeout(timer);
    }, [saved]);

    return (
        <div
            className="race-photo"
            data-prevent-click
            onPointerDown={(e) => {
                drag.current = { x: e.clientX, y: e.clientY };
                (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            }}
            onPointerMove={(e) => {
                if (!drag.current) return;
                eventBus.dispatch('race:photoOrbit', {
                    dx: e.clientX - drag.current.x,
                    dy: e.clientY - drag.current.y,
                });
                drag.current = { x: e.clientX, y: e.clientY };
            }}
            onPointerUp={() => {
                drag.current = null;
            }}
            onWheel={(e) => {
                eventBus.dispatch('race:photoZoom', { delta: e.deltaY });
            }}
        >
            <div
                className="race-photo-bar"
                onPointerDown={(e) => e.stopPropagation()}
                onWheel={(e) => e.stopPropagation()}
            >
                <span className="race-photo-hint">
                    Drag to move around the car, scroll to zoom
                </span>
                <label className="race-photo-fov">
                    <span>Field of view</span>
                    <input
                        type="range"
                        min={15}
                        max={90}
                        step={1}
                        value={fov}
                        onChange={(e) => {
                            const value = Number(e.target.value);
                            setFov(value);
                            eventBus.dispatch('race:photoFov', { fov: value });
                        }}
                    />
                    <span>{fov}°</span>
                </label>
                <button
                    type="button"
                    className="race-photo-save"
                    onClick={() => {
                        eventBus.dispatch('race:photoSave', {});
                        setSaved(true);
                    }}
                >
                    {saved ? 'Saved' : 'Save photo'}
                </button>
                <button
                    type="button"
                    onClick={() => eventBus.dispatch('race:photoMode', { on: false })}
                >
                    Back
                </button>
            </div>
        </div>
    );
};

export default PhotoMode;
