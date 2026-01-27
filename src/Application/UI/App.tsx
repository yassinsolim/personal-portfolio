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
