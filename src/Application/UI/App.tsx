import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import LoadingScreen from './components/LoadingScreen';
import InterfaceUI from './components/InterfaceUI';
import eventBus from './EventBus';
import { carOptions, getStoredCarId, storeCarId } from '../carOptions';
import type { MultiplayerState } from '../Racing/Multiplayer/MultiplayerService';
import './style.css';

const QUALITY_MODE_KEY = 'yassinverse:qualityMode';
const VOLUME_KEY = 'yassinverse:masterVolume';
const MUTE_KEY = 'yassinverse:muted';
const MULTIPLAYER_NAME_KEY = 'yassinverse:nordschleife:multiplayer:name:v1';
const LAST_LOBBY_CODE_KEY = 'yassinverse:nordschleife:multiplayer:lastLobbyCode:v1';

type QualityMode = 'quality' | 'performance';

type HudState = {
    speedKph: number;
    gear: number;
    rpm: number;
    lapTimeMs: number;
    lapRunning: boolean;
    lapProgress: number;
    ghostBestLapMs?: number;
};

type LeaderboardEntry = {
    id: string;
    name: string;
    lapTimeMs: number;
    carId: string;
    createdAt: string;
    source: 'local' | 'remote';
};

const defaultMultiplayerState: MultiplayerState = {
    mode: 'solo',
    supported: false,
    connecting: false,
    connected: false,
    lobbyCode: null,
    localSessionId: '',
    localPlayerName: 'Driver',
    localCarId: getStoredCarId(),
    isHost: false,
    error: null,
    players: [],
    laps: [],
};

const getStoredQualityMode = (): QualityMode => {
    try {
        const value = window.localStorage.getItem(QUALITY_MODE_KEY);
        return value === 'performance' ? 'performance' : 'quality';
    } catch {
        return 'quality';
    }
};

const getStoredVolume = () => {
    try {
        const value = window.localStorage.getItem(VOLUME_KEY);
        const parsed = value ? Number(value) : 1;
        if (Number.isFinite(parsed)) {
            return Math.min(1, Math.max(0, parsed));
        }
    } catch (error) {
        return 1;
    }
    return 1;
};

const getStoredMuted = () => {
    try {
        return window.localStorage.getItem(MUTE_KEY) === '1';
    } catch {
        return false;
    }
};

const getStoredMultiplayerName = () => {
    try {
        const value = window.localStorage.getItem(MULTIPLAYER_NAME_KEY);
        const clean = String(value || '')
            .replace(/[^a-zA-Z0-9 _-]/g, '')
            .trim()
            .slice(0, 16);
        return clean || 'Driver';
    } catch {
        return 'Driver';
    }
};

const sanitizeLobbyCode = (value: string) =>
    String(value || '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 8);

const getStoredLobbyCode = () => {
    try {
        return sanitizeLobbyCode(
            window.localStorage.getItem(LAST_LOBBY_CODE_KEY) || ''
        );
    } catch {
        return '';
    }
};

const formatLapTime = (valueMs: number) => {
    const totalMs = Math.max(0, Math.floor(valueMs));
    const minutes = Math.floor(totalMs / 60000);
    const seconds = Math.floor((totalMs % 60000) / 1000);
    const milliseconds = totalMs % 1000;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(
        2,
        '0'
    )}.${String(milliseconds).padStart(3, '0')}`;
};

const App = () => {
    const [showHint, setShowHint] = useState(false);
    const [selectedCar, setSelectedCar] = useState(() => getStoredCarId());
    const [freeCamActive, setFreeCamActive] = useState(false);
    const [raceModeActive, setRaceModeActive] = useState(false);
    const [racePaused, setRacePaused] = useState(false);
    const [pointerLocked, setPointerLocked] = useState(false);
    const [qualityMode, setQualityMode] = useState<QualityMode>(() =>
        getStoredQualityMode()
    );
    const [volume, setVolume] = useState(() => getStoredVolume());
    const [muted, setMuted] = useState(() => getStoredMuted());
    const [hud, setHud] = useState<HudState>({
        speedKph: 0,
        gear: 1,
        rpm: 900,
        lapTimeMs: 0,
        lapRunning: false,
        lapProgress: 0,
        ghostBestLapMs: 0,
    });
    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
    const [playerName, setPlayerName] = useState(() => getStoredMultiplayerName());
    const [lobbyCodeInput, setLobbyCodeInput] = useState(() => getStoredLobbyCode());
    const [multiplayer, setMultiplayer] = useState<MultiplayerState>(
        defaultMultiplayerState
    );
    const [lobbyCodeCopyState, setLobbyCodeCopyState] = useState('');

    useEffect(() => {
        eventBus.on('loadingScreenDone', () => {
            setShowHint(true);
        });

        eventBus.on(
            'raceMode:changed',
            (state: { active?: boolean; paused?: boolean } | undefined) => {
                const active = Boolean(state?.active);
                setRaceModeActive(active);
                setRacePaused(Boolean(state?.paused));
                if (active) {
                    setFreeCamActive(false);
                }
                if (!active) {
                    setPointerLocked(false);
                }
            }
        );

        eventBus.on('race:pauseState', (state: { paused?: boolean }) => {
            setRacePaused(Boolean(state?.paused));
        });

        eventBus.on(
            'race:pointerLockChanged',
            (state: { locked?: boolean } | undefined) => {
                setPointerLocked(Boolean(state?.locked));
            }
        );

        eventBus.on('race:hudUpdate', (nextHud: HudState) => {
            setHud((current) => ({
                ...current,
                ...nextHud,
            }));
        });

        eventBus.on(
            'race:leaderboardUpdate',
            (payload: { entries?: LeaderboardEntry[] }) => {
                setLeaderboard(payload?.entries || []);
            }
        );

        eventBus.on(
            'race:multiplayerState',
            (state: MultiplayerState | undefined) => {
                if (!state) return;
                setMultiplayer(state);
            }
        );

        eventBus.dispatch('race:requestLeaderboard', {});
        eventBus.dispatch('race:multiplayerSetName', { playerName });
        eventBus.dispatch('race:multiplayerRequestState', {});
    }, []);

    useEffect(() => {
        eventBus.dispatch('race:qualityChange', { mode: qualityMode });
        try {
            window.localStorage.setItem(QUALITY_MODE_KEY, qualityMode);
        } catch (error) {
            return;
        }
    }, [qualityMode]);

    useEffect(() => {
        eventBus.dispatch('masterVolumeChange', { volume });
        try {
            window.localStorage.setItem(VOLUME_KEY, String(volume));
        } catch (error) {
            return;
        }
    }, [volume]);

    useEffect(() => {
        eventBus.dispatch('muteToggle', muted);
        try {
            window.localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
        } catch (error) {
            return;
        }
    }, [muted]);

    useEffect(() => {
        if (!multiplayer.lobbyCode) return;
        try {
            window.localStorage.setItem(
                LAST_LOBBY_CODE_KEY,
                sanitizeLobbyCode(multiplayer.lobbyCode)
            );
        } catch {
            // no-op
        }
    }, [multiplayer.lobbyCode]);

    const handleCarChange = (
        event: React.ChangeEvent<HTMLSelectElement>
    ) => {
        const nextCar = event.target.value;
        setSelectedCar(nextCar);
        storeCarId(nextCar);
        eventBus.dispatch('carChange', nextCar);
    };

    const handleViewToggle = () => {
        if (raceModeActive) return;
        const nextState = !freeCamActive;
        setFreeCamActive(nextState);
        eventBus.dispatch('freeCamToggle', nextState);
    };

    const handleRaceToggle = () => {
        if (raceModeActive) {
            eventBus.dispatch('raceMode:exit', {
                fromUI: true,
            });
            return;
        }

        if (multiplayer.mode === 'lobby' && multiplayer.connected) {
            eventBus.dispatch('raceMode:start', {
                fromUI: true,
            });
            return;
        }

        eventBus.dispatch('race:multiplayerPlaySolo', {
            playerName,
            startRace: true,
        });
    };

    const handlePauseMenu = () => {
        eventBus.dispatch('race:setPaused', { paused: true });
    };

    const handleResumeRace = () => {
        eventBus.dispatch('race:setPaused', { paused: false });
        eventBus.dispatch('race:requestPointerLock', { fromUI: true });
    };

    const handleVolumeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setVolume(Math.min(1, Math.max(0, Number(event.target.value))));
    };

    const handleMuteToggle = () => {
        setMuted((current) => !current);
    };

    const handleQualityChange = (mode: QualityMode) => {
        setQualityMode(mode);
    };

    const handlePlayerNameChange = (
        event: React.ChangeEvent<HTMLInputElement>
    ) => {
        const nextName = event.target.value.slice(0, 16);
        setPlayerName(nextName);
        eventBus.dispatch('race:multiplayerSetName', {
            playerName: nextName,
        });
        try {
            window.localStorage.setItem(MULTIPLAYER_NAME_KEY, nextName);
        } catch {
            // no-op
        }
    };

    const handlePlaySolo = () => {
        eventBus.dispatch('race:multiplayerPlaySolo', {
            playerName,
            startRace: true,
        });
    };

    const handleCreateLobby = () => {
        eventBus.dispatch('race:multiplayerCreateLobby', {
            playerName,
            startRace: true,
        });
    };

    const handleJoinLobby = () => {
        const lobbyCode = sanitizeLobbyCode(lobbyCodeInput);
        setLobbyCodeInput(lobbyCode);
        if (!lobbyCode) return;
        try {
            window.localStorage.setItem(LAST_LOBBY_CODE_KEY, lobbyCode);
        } catch {
            // no-op
        }
        eventBus.dispatch('race:multiplayerJoinLobby', {
            playerName,
            lobbyCode,
            startRace: true,
        });
    };

    const handleLeaveLobby = () => {
        const rememberedCode = sanitizeLobbyCode(multiplayer.lobbyCode || lobbyCodeInput);
        if (rememberedCode) {
            setLobbyCodeInput(rememberedCode);
            try {
                window.localStorage.setItem(LAST_LOBBY_CODE_KEY, rememberedCode);
            } catch {
                // no-op
            }
        }
        eventBus.dispatch('race:multiplayerLeaveLobby', {});
    };

    const handleRejoinLastLobby = () => {
        const code = sanitizeLobbyCode(multiplayer.lobbyCode || lobbyCodeInput);
        if (!code) return;
        setLobbyCodeInput(code);
        eventBus.dispatch('race:multiplayerJoinLobby', {
            playerName,
            lobbyCode: code,
            startRace: true,
        });
    };

    const handleCopyLobbyCode = async () => {
        const code = multiplayer.lobbyCode || '';
        if (!code) return;

        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(code);
            } else {
                const input = document.createElement('input');
                input.value = code;
                document.body.appendChild(input);
                input.select();
                document.execCommand('copy');
                document.body.removeChild(input);
            }
            setLobbyCodeCopyState('Copied');
        } catch {
            setLobbyCodeCopyState('Copy failed');
        }

        window.setTimeout(() => {
            setLobbyCodeCopyState('');
        }, 1200);
    };

    const displayedGear = hud.gear < 0 ? 'R' : String(hud.gear);
    const multiplayerBusy = multiplayer.connecting;
    const hasJoinCode = sanitizeLobbyCode(lobbyCodeInput).length >= 4;

    return (
        <div id="ui-app">
            <LoadingScreen />
            {showHint && (
                <div className="look-hint">
                    <div>
                        Click anywhere to begin.
                    </div>
                    <div>
                        Visit the inner OS{' '}
                        <a
                            href="https://os.yassin.app"
                            rel="noreferrer noopener"
                            target="_blank"
                        >
                            yassinOS!
                        </a>
                    </div>
                    <div className="car-switcher" data-prevent-click>
                        <label htmlFor="car-switcher">Car</label>
                        <select
                            id="car-switcher"
                            value={selectedCar}
                            onChange={handleCarChange}
                        >
                            {carOptions.map((car) => (
                                <option key={car.id} value={car.id}>
                                    {car.label}
                                </option>
                            ))}
                        </select>
                    </div>
                    {!raceModeActive && (
                        <div className="view-toggle" data-prevent-click>
                            <button type="button" onClick={handleViewToggle}>
                                {freeCamActive
                                    ? 'Exit look around'
                                    : 'Look around'}
                            </button>
                        </div>
                    )}
                    {!raceModeActive && (
                        <div className="multiplayer-menu" data-prevent-click>
                            <div className="multiplayer-row">
                                <label htmlFor="multiplayer-name">Driver Name</label>
                                <input
                                    id="multiplayer-name"
                                    value={playerName}
                                    onChange={handlePlayerNameChange}
                                    maxLength={16}
                                    placeholder="Driver Name"
                                />
                            </div>
                            <div className="multiplayer-actions">
                                <button
                                    type="button"
                                    onClick={handlePlaySolo}
                                    disabled={multiplayerBusy}
                                >
                                    Play Solo
                                </button>
                                <button
                                    type="button"
                                    onClick={handleCreateLobby}
                                    disabled={multiplayerBusy}
                                >
                                    Create Lobby
                                </button>
                            </div>
                            <div className="multiplayer-row">
                                <label htmlFor="multiplayer-code">Lobby</label>
                                <input
                                    id="multiplayer-code"
                                    value={lobbyCodeInput}
                                    onChange={(event) =>
                                        setLobbyCodeInput(
                                            sanitizeLobbyCode(event.target.value)
                                        )
                                    }
                                    placeholder="CODE"
                                />
                                <button
                                    type="button"
                                    onClick={handleJoinLobby}
                                    disabled={multiplayerBusy || !hasJoinCode}
                                >
                                    Join
                                </button>
                            </div>
                            <div className="multiplayer-secondary-actions">
                                <button
                                    type="button"
                                    onClick={handleRejoinLastLobby}
                                    disabled={multiplayerBusy || !hasJoinCode}
                                >
                                    Rejoin Last Lobby
                                </button>
                            </div>
                            {multiplayer.connecting && (
                                <div className="race-lock-hint">
                                    Connecting to lobby...
                                </div>
                            )}
                            {multiplayer.error && (
                                <div className="race-error">
                                    {multiplayer.error}
                                    <button
                                        type="button"
                                        onClick={handleRejoinLastLobby}
                                        disabled={multiplayerBusy || !hasJoinCode}
                                    >
                                        Retry
                                    </button>
                                </div>
                            )}
                            {multiplayer.connected && multiplayer.lobbyCode && (
                                <div className="multiplayer-status">
                                    <span>
                                        Lobby {multiplayer.lobbyCode} |{' '}
                                        {multiplayer.players.length} players
                                    </span>
                                    <button
                                        type="button"
                                        onClick={handleCopyLobbyCode}
                                        disabled={multiplayerBusy}
                                    >
                                        {lobbyCodeCopyState || 'Copy Code'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleLeaveLobby}
                                        disabled={multiplayerBusy}
                                    >
                                        Leave
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                    {raceModeActive && (
                        <div className="race-toggle" data-prevent-click>
                            <button type="button" onClick={handleRaceToggle}>
                                Exit race mode
                            </button>
                        </div>
                    )}
                    {raceModeActive && !racePaused && (
                        <div className="race-pause-toggle" data-prevent-click>
                            <button type="button" onClick={handlePauseMenu}>
                                Pause / Settings
                            </button>
                        </div>
                    )}
                    {raceModeActive && !racePaused && !pointerLocked && (
                        <div className="race-lock-hint">
                            Click the scene to lock mouse. Press Esc to pause.
                        </div>
                    )}
                </div>
            )}
            {multiplayer.mode === 'lobby' && multiplayer.lobbyCode && (
                <div className="lobby-code-banner" data-prevent-click>
                    <span>Lobby Code: {multiplayer.lobbyCode}</span>
                    <button type="button" onClick={handleCopyLobbyCode}>
                        {lobbyCodeCopyState || 'Copy'}
                    </button>
                </div>
            )}
            {raceModeActive && (
                <div className="race-hud" data-prevent-click>
                    <div className="race-hud-main">
                        <div className="race-hud-speed">
                            {Math.max(0, Math.round(hud.speedKph))}
                            <span> km/h</span>
                        </div>
                        <div className="race-hud-meta">
                            <span>Gear {displayedGear}</span>
                            <span>RPM {Math.round(hud.rpm)}</span>
                            <span>
                                Lap{' '}
                                {hud.lapRunning
                                    ? formatLapTime(hud.lapTimeMs)
                                    : '--:--.---'}
                            </span>
                            <span>
                                Progress {Math.round(hud.lapProgress * 100)}%
                            </span>
                            <span>
                                Ghost{' '}
                                {hud.ghostBestLapMs
                                    ? formatLapTime(hud.ghostBestLapMs)
                                    : '--:--.---'}
                            </span>
                        </div>
                    </div>

                    <div className="race-hud-board">
                        <h4>Leaderboard</h4>
                        {leaderboard.length === 0 ? (
                            <p>No laps yet.</p>
                        ) : (
                            <ol>
                                {leaderboard.slice(0, 5).map((entry) => (
                                    <li key={entry.id}>
                                        <span>{entry.name}</span>
                                        <span>{formatLapTime(entry.lapTimeMs)}</span>
                                    </li>
                                ))}
                            </ol>
                        )}
                    </div>
                    {multiplayer.connected && multiplayer.mode === 'lobby' && (
                        <div className="race-hud-board">
                            <h4>Lobby {multiplayer.lobbyCode}</h4>
                            {multiplayer.players.length === 0 ? (
                                <p>No players connected.</p>
                            ) : (
                                <ol>
                                    {multiplayer.players.slice(0, 5).map((player) => (
                                        <li key={player.sessionId}>
                                            <span>
                                                {player.name}
                                                {player.sessionId ===
                                                    multiplayer.localSessionId
                                                    ? ' (you)'
                                                    : ''}
                                            </span>
                                            <span>
                                                {Math.round(player.lapProgress * 100)}%
                                            </span>
                                        </li>
                                    ))}
                                </ol>
                            )}
                            <h4 className="race-hud-subtitle">Lobby Lap Times</h4>
                            {multiplayer.laps.length === 0 ? (
                                <p>No submitted laps yet.</p>
                            ) : (
                                <ol>
                                    {multiplayer.laps.slice(0, 5).map((lap) => (
                                        <li key={lap.id}>
                                            <span>{lap.name}</span>
                                            <span>{formatLapTime(lap.lapTimeMs)}</span>
                                        </li>
                                    ))}
                                </ol>
                            )}
                        </div>
                    )}
                </div>
            )}
            {raceModeActive && racePaused && (
                <div className="race-menu-overlay" data-prevent-click>
                    <div className="race-menu-panel" data-prevent-click>
                        <h3>Nordschleife Pause</h3>
                        <p>Esc opens this menu at any time during race mode.</p>

                        <div className="race-menu-row">
                            <label htmlFor="race-car-select">Car</label>
                            <select
                                id="race-car-select"
                                value={selectedCar}
                                onChange={handleCarChange}
                            >
                                {carOptions.map((car) => (
                                    <option key={car.id} value={car.id}>
                                        {car.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                        {multiplayer.mode === 'lobby' && multiplayer.lobbyCode && (
                            <div className="race-menu-row">
                                <span>Lobby Code {multiplayer.lobbyCode}</span>
                                <button type="button" onClick={handleCopyLobbyCode}>
                                    {lobbyCodeCopyState || 'Copy Code'}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleLeaveLobby}
                                    disabled={multiplayerBusy}
                                >
                                    Leave Lobby
                                </button>
                            </div>
                        )}

                        <div className="race-menu-row">
                            <label htmlFor="race-volume-range">
                                Master Volume
                            </label>
                            <input
                                id="race-volume-range"
                                type="range"
                                min="0"
                                max="1"
                                step="0.01"
                                value={volume}
                                onChange={handleVolumeChange}
                            />
                            <span>{Math.round(volume * 100)}%</span>
                        </div>

                        <div className="race-menu-row">
                            <button type="button" onClick={handleMuteToggle}>
                                {muted ? 'Unmute' : 'Mute'}
                            </button>
                        </div>

                        <div className="race-menu-row">
                            <span>Render Mode</span>
                            <div className="race-quality-buttons">
                                <button
                                    type="button"
                                    className={
                                        qualityMode === 'quality'
                                            ? 'active'
                                            : ''
                                    }
                                    onClick={() =>
                                        handleQualityChange('quality')
                                    }
                                >
                                    Quality
                                </button>
                                <button
                                    type="button"
                                    className={
                                        qualityMode === 'performance'
                                            ? 'active'
                                            : ''
                                    }
                                    onClick={() =>
                                        handleQualityChange('performance')
                                    }
                                >
                                    Performance
                                </button>
                            </div>
                        </div>

                        <div className="race-menu-actions">
                            <button type="button" onClick={handleResumeRace}>
                                Resume Race
                            </button>
                            <button type="button" onClick={handleRaceToggle}>
                                Exit Race Mode
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const createUI = () => {
    ReactDOM.render(<App />, document.getElementById('ui'));
};

const createVolumeUI = () => {
    ReactDOM.render(
        <InterfaceUI />,
        document.getElementById('ui-interactive')
    );
};

export { createUI, createVolumeUI };

