import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import LoadingScreen from './components/LoadingScreen';
import InterfaceUI from './components/InterfaceUI';
import eventBus from './EventBus';
import { carOptions, getStoredCarId, storeCarId } from '../carOptions';
import './style.css';

const QUALITY_MODE_KEY = 'yassinverse:qualityMode';
const VOLUME_KEY = 'yassinverse:masterVolume';
const MUTE_KEY = 'yassinverse:muted';

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
    const [lapPromptOpen, setLapPromptOpen] = useState(false);
    const [pendingLapTimeMs, setPendingLapTimeMs] = useState(0);
    const [lapName, setLapName] = useState('Driver');

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
                    setLapPromptOpen(false);
                    setPendingLapTimeMs(0);
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

        eventBus.on('race:lapCompleted', (payload: { lapTimeMs?: number }) => {
            setPendingLapTimeMs(payload?.lapTimeMs || 0);
            setLapPromptOpen(true);
            setLapName('Driver');
        });

        eventBus.dispatch('race:requestLeaderboard', {});
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
        eventBus.dispatch(raceModeActive ? 'raceMode:exit' : 'raceMode:start', {
            fromUI: true,
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

    const handleLapSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const name = lapName.trim() || 'Driver';
        eventBus.dispatch('race:submitLapName', { name });
        setLapPromptOpen(false);
        setPendingLapTimeMs(0);
    };

    const handleLapSkip = () => {
        setLapPromptOpen(false);
        setPendingLapTimeMs(0);
        eventBus.dispatch('race:setPaused', { paused: false });
        eventBus.dispatch('race:requestPointerLock', { fromUI: true });
    };

    const displayedGear = hud.gear < 0 ? 'R' : String(hud.gear);

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
                    <div className="race-toggle" data-prevent-click>
                        <button type="button" onClick={handleRaceToggle}>
                            {raceModeActive
                                ? 'Exit race mode'
                                : 'Start Nordschleife race'}
                        </button>
                    </div>
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
            {raceModeActive && lapPromptOpen && (
                <div className="lap-name-overlay" data-prevent-click>
                    <form
                        className="lap-name-panel"
                        onSubmit={handleLapSubmit}
                        data-prevent-click
                    >
                        <h3>Valid Lap Completed</h3>
                        <p>{formatLapTime(pendingLapTimeMs)}</p>
                        <input
                            value={lapName}
                            onChange={(event) => setLapName(event.target.value)}
                            maxLength={16}
                            placeholder="Driver name"
                            autoFocus
                        />
                        <div className="lap-name-actions">
                            <button type="submit">Save Lap</button>
                            <button type="button" onClick={handleLapSkip}>
                                Skip
                            </button>
                        </div>
                    </form>
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
