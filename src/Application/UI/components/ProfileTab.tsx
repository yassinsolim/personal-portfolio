import React, { useEffect, useMemo, useState } from 'react';
import { carOptions, carOptionsById } from '../../carOptions';
import { carThumb } from './CarPicker';
import PlayerBadge from './PlayerBadge';
import { AccountBox } from './AccountBox';
import { ask } from '../ask';
import { MAX_DRIVER_NAME } from '../../Racing/Multiplayer/driverName';
import {
    AVATARS,
    COLORS,
    MAX_BIO,
    cleanText,
    deviceGarage,
    sanitizeColor,
    sanitizeNumber,
    type PlayerProfile,
    type ProfileDraft,
} from '../../Racing/Profile/profile';
import type { SaveStatus } from '../../Racing/Profile/ProfileService';

type Props = {
    name: string;
    onName: (name: string) => void;
    draft: ProfileDraft;
    onDraft: (draft: ProfileDraft) => void;
    status: SaveStatus | null;
    drivenCar: string;
    // this device's player, when it has one to show
    playerId: string | null;
    onView: () => void;
    onRemove: () => void;
    onSignedIn: (player: PlayerProfile) => void;
    onSignedOut: () => void;
};

const AVATAR_LABEL: Record<string, string> = {
    initials: 'Your initials',
    number: 'Your race number',
};

const STATUS: Record<SaveStatus, string> = {
    saving: 'Saving',
    saved: 'Saved. This is what everyone sees on the board.',
    local: 'Saved on this device. The board is offline right now.',
    limited: 'That was a lot of changes. Saving again in a minute.',
    error: "Couldn't save. Trying again shortly.",
    removed: 'Profile reset. Your old laps stay on the board under their names.',
    taken: 'Someone else races under that name. Pick another, or sign in if that profile is yours.',
};

const CARS = [...carOptions].sort((a, b) => a.label.localeCompare(b.label));

// the profile tab: how you show up on the board (the badge, name, number and
// bio, and the car you show off), saved as you change it, and racing as it
// on your other devices
const ProfileTab = ({
    name,
    onName,
    draft,
    onDraft,
    status,
    drivenCar,
    playerId,
    onView,
    onRemove,
    onSignedIn,
    onSignedOut,
}: Props) => {
    const [confirming, setConfirming] = useState(false);
    // a name someone else races under, worked out a moment after typing
    const [taken, setTaken] = useState<string | null>(null);
    const modded = useMemo(() => new Set(Object.keys(deviceGarage(null))), []);
    const car = draft.car || drivenCar;
    const shownName = cleanText(name, MAX_DRIVER_NAME) || 'Driver';
    const canView = Boolean(playerId);
    const set = (change: Partial<ProfileDraft>) => onDraft({ ...draft, ...change });

    useEffect(() => {
        const typed = name.trim();
        if (!typed) {
            setTaken(null);
            return undefined;
        }
        let live = true;
        const timer = window.setTimeout(() => {
            void ask<boolean>('race:nameFree', { name: typed }).then((free) => {
                if (live) setTaken(free ? null : typed);
            });
        }, 400);
        return () => {
            live = false;
            window.clearTimeout(timer);
        };
    }, [name, playerId]);

    return (
        <div className="pmp">
            <section className="pmp-preview">
                <h4>How others see you</h4>
                <div className="pmp-card">
                    <PlayerBadge
                        avatar={draft.avatar}
                        color={draft.color}
                        name={shownName}
                        number={draft.number}
                        size={64}
                    />
                    <div>
                        <strong>
                            {shownName}
                            {draft.number !== null && <em>#{draft.number}</em>}
                        </strong>
                        <p>{draft.bio || 'No bio yet.'}</p>
                    </div>
                </div>
                <div className="pmp-car">
                    <img src={carThumb(car)} alt="" width={72} height={40} />
                    <span>
                        <strong>{carOptionsById[car]?.label || car}</strong>
                        <small>{modded.has(car) ? 'With your garage setup' : 'Factory setup'}</small>
                    </span>
                </div>
                <p className="pm-note pmp-status" role="status">
                    {status ? STATUS[status] : 'Changes save as you make them.'}
                </p>
                <div className="pm-inline">
                    <button type="button" disabled={!canView} onClick={onView}>
                        View your card
                    </button>
                    {confirming ? (
                        <>
                            <button
                                type="button"
                                className="pmp-remove"
                                onClick={() => {
                                    setConfirming(false);
                                    onRemove();
                                }}
                            >
                                Reset it
                            </button>
                            <button type="button" onClick={() => setConfirming(false)}>
                                Keep it
                            </button>
                        </>
                    ) : (
                        <button type="button" disabled={!canView} onClick={() => setConfirming(true)}>
                            Reset profile
                        </button>
                    )}
                </div>
                {confirming && (
                    <p className="pm-note">
                        Your profile comes off the board, on every device signed in to it, and starts over. Your old
                        laps stay, under the names they were set with.
                    </p>
                )}
                <AccountBox
                    key={playerId || 'none'}
                    name={shownName}
                    saved={canView}
                    onSignedIn={onSignedIn}
                    onSignedOut={onSignedOut}
                />
            </section>

            <section className="pmp-form">
                <h4>Name</h4>
                <input
                    className="pm-input"
                    value={name}
                    maxLength={MAX_DRIVER_NAME}
                    placeholder="Your name"
                    aria-label="Driver name"
                    aria-invalid={Boolean(taken)}
                    spellCheck={false}
                    onChange={(event) => onName(event.target.value.slice(0, MAX_DRIVER_NAME))}
                />
                {taken && (
                    <p className="pm-note pmp-taken" role="alert">
                        Someone else races as {taken}. Names are one per driver.
                    </p>
                )}

                <h4>Badge</h4>
                <div className="pmp-avatars" role="radiogroup" aria-label="Badge">
                    {AVATARS.map((avatar) => (
                        <button
                            type="button"
                            key={avatar}
                            role="radio"
                            aria-checked={draft.avatar === avatar}
                            aria-label={AVATAR_LABEL[avatar] || avatar}
                            title={AVATAR_LABEL[avatar] || avatar}
                            className={draft.avatar === avatar ? 'on' : ''}
                            onClick={() => set({ avatar })}
                        >
                            <PlayerBadge
                                avatar={avatar}
                                color={draft.color}
                                name={shownName}
                                number={draft.number}
                                size={30}
                            />
                        </button>
                    ))}
                </div>

                <h4>Color</h4>
                <div className="pmp-colors" role="radiogroup" aria-label="Color">
                    {COLORS.map((color) => (
                        <button
                            type="button"
                            key={color}
                            role="radio"
                            aria-checked={draft.color === color}
                            aria-label={color}
                            className={draft.color === color ? 'on' : ''}
                            style={{ background: color }}
                            onClick={() => set({ color })}
                        />
                    ))}
                    <label
                        className={`pmp-custom ${COLORS.includes(draft.color) ? '' : 'on'}`}
                        title="Any color"
                    >
                        <input
                            type="color"
                            aria-label="Any color"
                            value={draft.color}
                            onChange={(event) => set({ color: sanitizeColor(event.target.value) })}
                        />
                    </label>
                </div>

                <div className="pmp-pair">
                    <div>
                        <h4>Race number</h4>
                        <div className="pm-inline">
                            <input
                                className="pm-input pmp-number"
                                type="number"
                                inputMode="numeric"
                                min={0}
                                max={99}
                                placeholder="None"
                                aria-label="Race number"
                                value={draft.number ?? ''}
                                onChange={(event) =>
                                    set({ number: sanitizeNumber(event.target.value.slice(0, 2)) })
                                }
                            />
                            {draft.number !== null && (
                                <button type="button" onClick={() => set({ number: null })}>
                                    None
                                </button>
                            )}
                        </div>
                    </div>
                    <div>
                        <h4>Car you show off</h4>
                        <select
                            className="pm-select"
                            aria-label="Car you show off"
                            value={draft.car || ''}
                            onChange={(event) => set({ car: event.target.value || null })}
                        >
                            <option value="">The one you drive ({carOptionsById[drivenCar]?.label || drivenCar})</option>
                            {CARS.map((option) => (
                                <option key={option.id} value={option.id}>
                                    {option.label}
                                    {modded.has(option.id) ? ' (your setup)' : ''}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                <h4>Bio</h4>
                <div className="pmp-bio">
                    <input
                        className="pm-input"
                        value={draft.bio}
                        maxLength={MAX_BIO}
                        placeholder="Late on the brakes, early on the gas"
                        aria-label="Bio"
                        onChange={(event) => set({ bio: event.target.value.slice(0, MAX_BIO) })}
                    />
                    <small>
                        {draft.bio.length}/{MAX_BIO}
                    </small>
                </div>
            </section>
        </div>
    );
};

export default ProfileTab;
