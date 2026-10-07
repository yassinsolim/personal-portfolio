import React, { useEffect, useRef, useState } from 'react';
import eventBus from '../EventBus';

const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE']);

// photo mode: the race paused with nothing over it. drag (or the right stick)
// moves around the car, scroll (or the triggers) zooms, wasd (or the left
// stick) moves the view, and the saved png is just the frame, no hud
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

    // w a s d along the ground, q and e down and up, shift for faster
    useEffect(() => {
        const held = new Set<string>();
        let fast = false;
        const send = () => {
            const axis = (plus: string, minus: string) =>
                (held.has(plus) ? 1 : 0) - (held.has(minus) ? 1 : 0);
            eventBus.dispatch('race:photoMove', {
                x: axis('KeyD', 'KeyA'),
                y: axis('KeyE', 'KeyQ'),
                z: axis('KeyW', 'KeyS'),
                fast,
            });
        };
        const onDown = (event: KeyboardEvent) => {
            if (event.key === 'Shift') {
                fast = true;
                if (held.size) send();
                return;
            }
            if (!MOVE_KEYS.has(event.code)) return;
            event.preventDefault();
            if (event.repeat) return;
            fast = event.shiftKey;
            held.add(event.code);
            send();
        };
        const onUp = (event: KeyboardEvent) => {
            if (event.key === 'Shift') {
                fast = false;
                if (held.size) send();
                return;
            }
            if (held.delete(event.code)) send();
        };
        const stop = () => {
            held.clear();
            fast = false;
            send();
        };
        window.addEventListener('keydown', onDown, true);
        window.addEventListener('keyup', onUp, true);
        window.addEventListener('blur', stop);
        return () => {
            window.removeEventListener('keydown', onDown, true);
            window.removeEventListener('keyup', onUp, true);
            window.removeEventListener('blur', stop);
            stop();
        };
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
                    Drag to orbit, scroll to zoom
                    <span className="race-photo-keys">
                        , <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> to move,{' '}
                        <kbd>Q</kbd> <kbd>E</kbd> down and up, <kbd>Shift</kbd> faster
                    </span>
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
