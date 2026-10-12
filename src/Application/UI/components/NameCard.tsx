import React, { useEffect, useRef, useState } from 'react';
import { MAX_DRIVER_NAME, randomDriverName } from '../../Racing/Multiplayer/driverName';
import type { PlayerProfile } from '../../Racing/Profile/profile';
import { ask } from '../ask';
import { SignInForm } from './AccountBox';

type Props = {
    // the name this device had, which turned out to be someone else's
    taken: string | null;
    // this device has a profile whose laps could come along on signing in
    canBring: boolean;
    onDone: (name: string) => void;
    onSignedIn: (player: PlayerProfile) => void;
};

// the first drive on a device: a name for the leaderboard and the lobbies,
// with a made-up one filled in so Enter (or A, or Esc) is enough. a name is
// one driver's, so a taken one asks again, and a driver from another device
// can sign in instead
const NameCard = ({ taken, canBring, onDone, onSignedIn }: Props) => {
    const [name, setName] = useState(() => randomDriverName());
    const [takenName, setTakenName] = useState(taken);
    const [checking, setChecking] = useState(false);
    const [signingIn, setSigningIn] = useState(false);
    const input = useRef<HTMLInputElement>(null);

    const finish = async () => {
        if (checking) return;
        const next = name.trim() || randomDriverName();
        setChecking(true);
        const free = await ask<boolean>('race:nameFree', { name: next });
        setChecking(false);
        if (free) onDone(next);
        else setTakenName(next);
    };

    useEffect(() => {
        // a phone's keyboard would cover the road, so there the field waits for a tap
        if (!signingIn && !window.matchMedia?.('(pointer: coarse)').matches) input.current?.select();
    }, [signingIn]);

    // esc (and B on a pad) keeps whatever is in the field, or leaves signing in
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            if (signingIn) setSigningIn(false);
            else void finish();
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    });

    if (signingIn) {
        return (
            <div className="race-name" data-prevent-click>
                <div className="race-name-card" role="dialog" aria-label="Sign in">
                    <h3>Sign in</h3>
                    <p>Race as the profile you made on another device. Give it a password there first: Esc, Profile.</p>
                    <SignInForm
                        className="acct-card"
                        canBring={canBring}
                        onSignedIn={onSignedIn}
                        onCancel={() => setSigningIn(false)}
                    />
                </div>
            </div>
        );
    }

    return (
        <div className="race-name" data-prevent-click>
            <form
                className="race-name-card"
                role="dialog"
                aria-label="Pick a driver name"
                onSubmit={(event) => {
                    event.preventDefault();
                    void finish();
                }}
            >
                <h3>{takenName ? `Someone already races as ${takenName}` : 'Pick a driver name'}</h3>
                <p>
                    {takenName
                        ? 'A name is one driver’s. Pick another, or sign in if that profile is yours.'
                        : 'It goes on the leaderboard and over your car in lobbies. Your badge and the rest of your profile are in the menu (Esc).'}
                </p>
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
                <button type="submit" className="race-menu-primary" disabled={checking}>
                    Drive
                </button>
                <button type="button" className="acct-link" onClick={() => setSigningIn(true)}>
                    Raced on another device? Sign in
                </button>
            </form>
        </div>
    );
};

export default NameCard;
