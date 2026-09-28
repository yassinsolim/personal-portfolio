import React, { useEffect, useState } from 'react';
import eventBus from '../EventBus';
import type { MultiplayerState } from '../../Racing/Multiplayer/MultiplayerService';
import { buildInviteLink } from '../../Racing/Multiplayer/invite';

type Props = {
    multiplayer: MultiplayerState;
    playerName: string;
    onClose: () => void;
};

type Pending = 'quick' | 'invite' | null;

const copyText = async (text: string) => {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        // falls through to the input trick
    }
    try {
        const input = document.createElement('input');
        input.value = text;
        document.body.appendChild(input);
        input.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(input);
        return ok;
    } catch {
        return false;
    }
};

// shown once the homepage transition has built the ring: keep driving solo,
// drop into a public lobby, or open a private one and copy its link
const LobbyChoice = ({ multiplayer, playerName, onClose }: Props) => {
    const [pending, setPending] = useState<Pending>(null);
    const [link, setLink] = useState('');
    const [copied, setCopied] = useState<boolean | null>(null);

    const solo = () => onClose();
    const quick = () => {
        setPending('quick');
        eventBus.dispatch('race:multiplayerQuickJoin', { playerName });
    };
    const invite = () => {
        setPending('invite');
        eventBus.dispatch('race:multiplayerCreateLobby', { playerName });
    };

    // quick join is done once the lobby is connected
    useEffect(() => {
        if (pending !== 'quick') return;
        if (multiplayer.mode === 'lobby' && multiplayer.connected) onClose();
    }, [pending, multiplayer.mode, multiplayer.connected, onClose]);

    // a new private lobby: copy its link and show it
    useEffect(() => {
        if (pending !== 'invite' || link) return;
        if (!multiplayer.connected || !multiplayer.lobbyCode) return;
        const next = buildInviteLink(multiplayer.lobbyCode);
        setLink(next);
        void copyText(next).then(setCopied);
    }, [pending, link, multiplayer.connected, multiplayer.lobbyCode]);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (pending === 'quick') return;
            if (link) {
                if (event.code === 'Enter' || event.code === 'Escape')
                    onClose();
                return;
            }
            if (pending) return;
            if (
                event.code === 'Digit1' ||
                event.code === 'Escape' ||
                event.code === 'Enter'
            )
                solo();
            else if (event.code === 'Digit2') quick();
            else if (event.code === 'Digit3') invite();
            else return;
            event.preventDefault();
            event.stopPropagation();
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    });

    const failed = pending && !multiplayer.connecting && multiplayer.error;

    return (
        <div className="race-lobby-choice" data-prevent-click>
            <div className="race-lobby-card" data-prevent-click>
                {!link && (
                    <>
                        <h3>How do you want to drive?</h3>
                        <div className="race-lobby-options">
                            <button
                                type="button"
                                onClick={solo}
                                disabled={Boolean(pending)}
                            >
                                <span className="race-lobby-key">1</span>
                                <strong>Solo</strong>
                                <small>Just you, the ring and your ghost</small>
                            </button>
                            <button
                                type="button"
                                onClick={quick}
                                disabled={Boolean(pending)}
                            >
                                <span className="race-lobby-key">2</span>
                                <strong>
                                    {pending === 'quick'
                                        ? 'Finding a lobby'
                                        : 'Quick join'}
                                </strong>
                                <small>
                                    Drop into a public lobby with other drivers
                                </small>
                            </button>
                            <button
                                type="button"
                                onClick={invite}
                                disabled={Boolean(pending)}
                            >
                                <span className="race-lobby-key">3</span>
                                <strong>
                                    {pending === 'invite'
                                        ? 'Opening a lobby'
                                        : 'Invite a friend'}
                                </strong>
                                <small>
                                    A private lobby and a link to share
                                </small>
                            </button>
                        </div>
                        {failed && (
                            <p className="race-lobby-error">
                                {multiplayer.error} You're driving solo for now.{' '}
                                <button type="button" onClick={onClose}>
                                    OK
                                </button>
                            </p>
                        )}
                    </>
                )}
                {link && (
                    <>
                        <h3>Lobby {multiplayer.lobbyCode} is open</h3>
                        <p>
                            {copied
                                ? 'The invite link is copied. Send it to a friend, they land right next to you.'
                                : 'Send this link to a friend, they land right next to you.'}
                        </p>
                        <input
                            className="race-lobby-link"
                            readOnly
                            value={link}
                            onFocus={(e) => e.currentTarget.select()}
                        />
                        <div className="race-lobby-actions">
                            <button
                                type="button"
                                onClick={() =>
                                    void copyText(link).then(setCopied)
                                }
                            >
                                {copied ? 'Copied' : 'Copy link'}
                            </button>
                            <button type="button" onClick={onClose}>
                                Drive
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default LobbyChoice;
