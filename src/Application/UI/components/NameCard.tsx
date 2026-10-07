import React, { useEffect, useRef, useState } from 'react';
import { MAX_DRIVER_NAME, randomDriverName } from '../../Racing/Multiplayer/driverName';

// the first drive on a device: a name for the leaderboard and the lobbies,
// with a made-up one filled in so Enter (or A, or Esc) is enough
const NameCard = ({ onDone }: { onDone: (name: string) => void }) => {
    const [name, setName] = useState(() => randomDriverName());
    const input = useRef<HTMLInputElement>(null);
    const finish = () => onDone(name.trim() || randomDriverName());

    useEffect(() => {
        // a phone's keyboard would cover the road, so there the field waits for a tap
        if (!window.matchMedia?.('(pointer: coarse)').matches) input.current?.select();
    }, []);

    // esc (and B on a pad) keeps whatever is in the field
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            finish();
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    });

    return (
        <div className="race-name" data-prevent-click>
            <form
                className="race-name-card"
                role="dialog"
                aria-label="Pick a driver name"
                onSubmit={(event) => {
                    event.preventDefault();
                    finish();
                }}
            >
                <h3>Pick a driver name</h3>
                <p>It goes on the leaderboard and over your car in lobbies. Change it any time in the menu.</p>
                <div className="race-name-row">
                    <input
                        ref={input}
                        value={name}
                        maxLength={MAX_DRIVER_NAME}
                        aria-label="Driver name"
                        autoComplete="nickname"
                        spellCheck={false}
                        enterKeyHint="go"
                        onChange={(event) => setName(event.target.value.slice(0, MAX_DRIVER_NAME))}
                    />
                    <button type="button" onClick={() => setName(randomDriverName())}>
                        Random
                    </button>
                </div>
                <button type="submit" className="race-menu-primary">
                    Drive
                </button>
            </form>
        </div>
    );
};

export default NameCard;
