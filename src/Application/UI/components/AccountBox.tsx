import React, { useEffect, useState } from 'react';
import { ask } from '../ask';
import type { PlayerProfile } from '../../Racing/Profile/profile';
import type { PasswordStatus, SignInResult } from '../../Racing/Profile/ProfileService';

const SIGN_IN_ERROR: Record<Exclude<SignInResult['status'], 'in'>, string> = {
    wrong: 'No profile with that name and password.',
    limited: 'Too many tries. Wait a few minutes, then try again.',
    offline: 'The board is offline, so signing in has to wait.',
    storage: 'This browser won’t keep a sign in (private mode or blocked storage).',
    error: 'Couldn’t sign in. Try again.',
};

const PASSWORD_NOTE: Record<PasswordStatus, string> = {
    set: 'Password saved.',
    short: 'Use at least 8 characters, and at most 72 bytes (emoji take up to 4).',
    limited: 'That was a lot of changes. Try again in a minute.',
    error: 'Couldn’t save the password. Try again.',
};

// what the database checks: bcrypt reads 72 bytes
const passwordFits = (password: string) =>
    password.length >= 8 && new TextEncoder().encode(password).length <= 72;

// a driver's name and password, to race as them on this device. bring moves
// this device's own profile and its laps into theirs
export const SignInForm = ({
    className,
    canBring,
    onSignedIn,
    onCancel,
}: {
    className?: string;
    canBring: boolean;
    onSignedIn: (player: PlayerProfile) => void;
    onCancel: () => void;
}) => {
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [bring, setBring] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError(null);
        const result = await ask<SignInResult>('race:signIn', { name, password, bring: canBring && bring });
        setBusy(false);
        if (result.status === 'in') onSignedIn(result.player);
        else setError(SIGN_IN_ERROR[result.status]);
    };

    return (
        <form className={`acct-signin ${className || ''}`} onSubmit={submit} aria-label="Sign in">
            <input
                value={name}
                maxLength={16}
                placeholder="Driver name"
                aria-label="Driver name"
                autoComplete="username"
                spellCheck={false}
                onChange={(event) => setName(event.target.value)}
            />
            <input
                type="password"
                value={password}
                maxLength={72}
                placeholder="Password"
                aria-label="Password"
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
            />
            {canBring && (
                <label className="acct-check">
                    <input type="checkbox" checked={bring} onChange={(event) => setBring(event.target.checked)} />
                    Move this device&apos;s laps to that profile too
                </label>
            )}
            {error && (
                <p className="acct-error" role="alert">
                    {error}
                </p>
            )}
            <div className="acct-actions">
                <button type="submit" className="race-menu-primary" disabled={busy || !name.trim() || !password}>
                    {busy ? 'Signing in' : 'Sign in'}
                </button>
                <button type="button" onClick={onCancel}>
                    Back
                </button>
            </div>
        </form>
    );
};

// racing as this profile on other devices: a password for it, signing this
// device out, or signing it in to a profile from another device
export const AccountBox = ({
    name,
    saved,
    onSignedIn,
    onSignedOut,
}: {
    name: string;
    // this device's profile is on the board
    saved: boolean;
    onSignedIn: (player: PlayerProfile) => void;
    onSignedOut: () => void;
}) => {
    // undefined while it's asked, null with no saved profile or no board
    const [account, setAccount] = useState<{ password: boolean } | null | undefined>(undefined);
    const [mode, setMode] = useState<'idle' | 'password' | 'signin' | 'signout'>('idle');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<string | null>(null);

    useEffect(() => {
        let live = true;
        setAccount(undefined);
        void ask<{ password: boolean } | null>('race:account').then((next) => {
            if (live) setAccount(next);
        });
        return () => {
            live = false;
        };
    }, [saved]);

    const savePassword = async (event: React.FormEvent) => {
        event.preventDefault();
        if (busy) return;
        if (!passwordFits(password)) {
            setNote(PASSWORD_NOTE.short);
            return;
        }
        setBusy(true);
        const status = await ask<PasswordStatus>('race:setPassword', { password });
        setBusy(false);
        setNote(PASSWORD_NOTE[status]);
        if (status === 'set') {
            setPassword('');
            setMode('idle');
            setAccount({ password: true });
        }
    };

    const signOut = async () => {
        setBusy(true);
        const result = await ask<'out' | 'error'>('race:signOut');
        setBusy(false);
        if (result === 'out') {
            setMode('idle');
            setNote(null);
            onSignedOut();
        } else {
            setNote('Couldn’t sign out. Try again.');
        }
    };

    if (mode === 'signin') {
        return (
            <div className="pmp-account">
                <h4>Sign in</h4>
                <p className="pm-note">Race as a profile you made on another device, with its name and password.</p>
                <SignInForm
                    className="acct-menu"
                    canBring={saved}
                    onSignedIn={(player) => {
                        setMode('idle');
                        setNote(null);
                        onSignedIn(player);
                    }}
                    onCancel={() => setMode('idle')}
                />
            </div>
        );
    }

    return (
        <div className="pmp-account">
            <h4>Your other devices</h4>
            {account === undefined ? (
                <p className="pm-note">Checking</p>
            ) : !account ? (
                <p className="pm-note">
                    Once your profile is saved (it saves as you race), a password lets you race as it on your phone
                    or another computer.
                </p>
            ) : mode === 'password' || !account.password ? (
                <form className="acct-password" onSubmit={savePassword}>
                    <p className="pm-note">
                        {account.password
                            ? 'A new password for signing in elsewhere.'
                            : `Set a password, then sign in as ${name} on your phone or another computer. There's no email, so keep it somewhere safe.`}
                    </p>
                    <input type="text" value={name} autoComplete="username" readOnly hidden />
                    <div className="pm-inline">
                        <input
                            className="pm-input"
                            type="password"
                            value={password}
                            minLength={8}
                            placeholder="8 or more characters"
                            aria-label="New password"
                            autoComplete="new-password"
                            onChange={(event) => setPassword(event.target.value)}
                        />
                        <button type="submit" disabled={busy || password.length < 8}>
                            {account.password ? 'Change' : 'Set password'}
                        </button>
                        {account.password && (
                            <button type="button" onClick={() => setMode('idle')}>
                                Cancel
                            </button>
                        )}
                    </div>
                </form>
            ) : mode === 'signout' ? (
                <>
                    <p className="pm-note">
                        This device goes back to a new driver. Sign in again any time with {name} and your password.
                    </p>
                    <div className="pm-inline">
                        <button type="button" className="pmp-remove" disabled={busy} onClick={signOut}>
                            Sign out
                        </button>
                        <button type="button" onClick={() => setMode('idle')}>
                            Stay
                        </button>
                    </div>
                </>
            ) : (
                <>
                    <p className="pm-note">
                        On another device: Esc, Profile, Sign in, with <strong>{name}</strong> and your password.
                    </p>
                    <div className="pm-inline">
                        <button type="button" onClick={() => setMode('password')}>
                            Change password
                        </button>
                        <button type="button" onClick={() => setMode('signout')}>
                            Sign out of this device
                        </button>
                    </div>
                </>
            )}
            {note && (
                <p className="pm-note" role="status">
                    {note}
                </p>
            )}
            <button type="button" className="acct-link" onClick={() => setMode('signin')}>
                Made a profile on another device? Sign in
            </button>
        </div>
    );
};
