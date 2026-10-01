import React, { useCallback, useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import LoadingScreen from './components/LoadingScreen';
import HybridLoader from './components/loaders/HybridLoader';
import { loaderVariant } from './loaders/variant';
import { isWebGLAvailable } from '../Utils/webgl';
import InterfaceUI from './components/InterfaceUI';
import LobbyChoice from './components/LobbyChoice';
import RaceHudGauges, { SectorHud } from './components/RaceHudGauges';
import DriftHud, { type DriftHudState } from './components/DriftHud';
import Minimap from './components/Minimap';
import Garage, { GarageState } from './components/Garage';
import GraphicsInfo from './components/GraphicsInfo';
import eventBus from './EventBus';
import { carOptions, getStoredCarId, storeCarId } from '../carOptions';
import type { MultiplayerState } from '../Racing/Multiplayer/MultiplayerService';
import {
    readAssistSettings,
    type AssistPreset,
} from '../Racing/Vehicle/assists';
import './style.css';
import ModelCredits from './components/ModelCredits';
import { buildInviteLink, getInviteLobbyCode } from '../Racing/Multiplayer/invite';

const QUALITY_MODE_KEY = 'yassinverse:qualityMode';
const RENDER_MODE_KEY = 'yassinverse:renderMode';
const VOLUME_KEY = 'yassinverse:masterVolume';
const MUTE_KEY = 'yassinverse:muted';
const MULTIPLAYER_NAME_KEY = 'yassinverse:nordschleife:multiplayer:name:v1';
const LAST_LOBBY_CODE_KEY = 'yassinverse:nordschleife:multiplayer:lastLobbyCode:v1';

type QualityMode = 'auto' | 'quality' | 'performance';

const RENDER_MODES: { mode: QualityMode; label: string }[] = [
    { mode: 'auto', label: 'Auto' },
    { mode: 'quality', label: 'Quality' },
    { mode: 'performance', label: 'Performance' },
];

const ASSIST_OPTIONS: { preset: AssistPreset; label: string }[] = [
    { preset: 'standard', label: 'Standard' },
    { preset: 'sport', label: 'Sport (drift)' },
    { preset: 'off', label: 'Off' },
];

const RenderModeButtons = ({
    mode,
    onChange,
}: {
    mode: QualityMode;
    onChange: (mode: QualityMode) => void;
}) => (
    <>
        {RENDER_MODES.map((option) => (
            <button
                key={option.mode}
                type="button"
                className={mode === option.mode ? 'active' : ''}
                onClick={() => onChange(option.mode)}
            >
                {option.label}
            </button>
        ))}
    </>
);

type HudState = {
    speedKph: number;
    gear: number;
    rpm: number;
    lapTimeMs: number;
    lapRunning: boolean;
    lapArmed?: boolean;
    lapProgress: number;
    ghostBestLapMs?: number;
    redlineRpm?: number;
    tachMaxRpm?: number;
    lastLapMs?: number;
    sectors?: SectorHud & { bounds: number[] };
    map?: { x: number; z: number; heading: number; remotes: Array<{ x: number; z: number }> };
    track?: 'ring' | 'drift';
    drift?: DriftHudState | null;
};

type DriftBoardEntry = {
    id: string;
    name: string;
    score: number;
    lapTimeMs: number;
    carId: string;
};

type DebugStats = {
    fps?: number;
    frameMs?: number;
    physicsMs?: number;
    speedKph?: number;
    grounded?: boolean;
    wheelContactCount?: number;
    suspensionCompression?: number[];
    roadNormal?: [number, number, number];
};

type TouchControlName = 'throttle' | 'brake' | 'steerLeft' | 'steerRight' | 'handbrake';

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
        const value = window.localStorage.getItem(RENDER_MODE_KEY);
        if (
            value === 'auto' ||
            value === 'quality' ||
            value === 'performance'
        ) {
            return value;
        }
        // the old setting saved 'quality' on every visit, so only an explicit
        // performance pick carries over
        return window.localStorage.getItem(QUALITY_MODE_KEY) === 'performance'
            ? 'performance'
            : 'auto';
    } catch {
        return 'auto';
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

const isTouchRaceDevice = () =>
    Boolean(
        window.matchMedia?.('(pointer: coarse)').matches ||
            window.matchMedia?.('(max-width: 820px)').matches ||
            window.matchMedia?.('(max-height: 520px)').matches
    );

// phones: the room panel folds to a menu button and the hint
const COMPACT_PANEL_QUERY = '(max-width: 768px), (max-height: 520px)';
const isCompactScreen = () =>
    Boolean(window.matchMedia?.(COMPACT_PANEL_QUERY).matches);

const setTouchControl = (control: TouchControlName, active: boolean) => {
    eventBus.dispatch('race:touchControl', { control, active });
};

const RaceTouchButton = ({
    control,
    label,
    className = '',
}: {
    control: TouchControlName;
    label: string;
    className?: string;
}) => {
    const activate = (event: React.PointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setTouchControl(control, true);
    };
    const deactivate = (event: React.PointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        setTouchControl(control, false);
    };

    return (
        <button
            type="button"
            className={`race-touch-button ${className}`}
            onPointerDown={activate}
            onPointerUp={deactivate}
            onPointerCancel={deactivate}
            onPointerLeave={deactivate}
        >
            {label}
        </button>
    );
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
    const invite = getInviteLobbyCode();
    if (invite) return invite;
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

// the hybrid by default; ?loader=bios, or no webgl, gets the bios screen
const Loader = () => {
    const [variant] = useState(() => (isWebGLAvailable() ? loaderVariant() : 'bios'));
    return variant === 'hybrid' ? <HybridLoader /> : <LoadingScreen />;
};

const App = () => {
    const [showHint, setShowHint] = useState(false);
    const [selectedCar, setSelectedCar] = useState(() => getStoredCarId());
    const [freeCamActive, setFreeCamActive] = useState(false);
    const [freeCamPending, setFreeCamPending] = useState(false);
    const [raceModeActive, setRaceModeActive] = useState(false);
    // a monitor (or the flipper, the pc) is the camera's focus: the room
    // panel steps aside so it doesn't sit over the screen
    const [roomFocus, setRoomFocus] = useState(false);
    // the desk view: the panel folds to a small tab so it clears the top screen
    const [deskView, setDeskView] = useState(false);
    const [compactPanel, setCompactPanel] = useState(() => isCompactScreen());
    const [panelOpen, setPanelOpen] = useState(false);
    const [tapToBegin] = useState(
        () => Boolean(window.matchMedia?.('(pointer: coarse)').matches)
    );
    const [racePaused, setRacePaused] = useState(false);
    const [pointerLocked, setPointerLocked] = useState(false);
    const [qualityMode, setQualityMode] = useState<QualityMode>(() =>
        getStoredQualityMode()
    );
    const [renderScale, setRenderScale] = useState<number | null>(null);
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
    const [graphicsInfoOpen, setGraphicsInfoOpen] = useState(false);
    const raceDebugView = new URLSearchParams(window.location.search).has(
        'raceDebug'
    );
    const [touchRaceDevice, setTouchRaceDevice] = useState(() =>
        isTouchRaceDevice()
    );
    const [rotateHint, setRotateHint] = useState(false);
    const [graphicsContextLost, setGraphicsContextLost] = useState(false);
    const [debugStats, setDebugStats] = useState<DebugStats | null>(null);
    const [assists, setAssists] = useState(() => readAssistSettings());
    const [lobbyChoiceOpen, setLobbyChoiceOpen] = useState(false);
    const [trackOutline, setTrackOutline] = useState<number[][]>([]);
    const [garageOpen, setGarageOpen] = useState(false);
    const [leaderboardBoard, setLeaderboardBoard] = useState<'stock' | 'tuned'>('stock');
    const [trackState, setTrackState] = useState<{ track: 'ring' | 'drift'; building: boolean }>({
        track: 'ring',
        building: false,
    });
    const [driftBoard, setDriftBoard] = useState<DriftBoardEntry[]>([]);
    const [garageState, setGarageState] = useState<GarageState | null>(null);
    // the lobby card comes back after the garage when it was opened from it
    const [garageFromCard, setGarageFromCard] = useState(false);
    const openGarage = useCallback((fromCard: boolean) => {
        setGarageFromCard(fromCard);
        setLobbyChoiceOpen(false);
        setGarageOpen(true);
        eventBus.dispatch('race:garageOpen', { open: true });
    }, []);
    const closeGarage = useCallback(() => {
        setGarageOpen(false);
        eventBus.dispatch('race:garageOpen', { open: false });
        setGarageFromCard((fromCard) => {
            if (fromCard) setLobbyChoiceOpen(true);
            return false;
        });
    }, []);
    const closeLobbyChoice = useCallback(() => setLobbyChoiceOpen(false), []);
    // the race panel's garage button and its G key. a locked mouse is let go
    // so the garage can be clicked, and the lobby card comes back after it
    const openGarageFromRace = useCallback(() => {
        if (document.pointerLockElement) document.exitPointerLock();
        openGarage(lobbyChoiceOpen);
    }, [openGarage, lobbyChoiceOpen]);
    // the black cut in and out of the garage from the homepage button
    const [garageFade, setGarageFade] = useState<'' | 'open' | 'home'>('');
    const openGarageFromHome = useCallback(() => {
        setGarageFade('open');
        eventBus.dispatch('garage:fromHome', {});
    }, []);
    const garageToHome = useCallback(() => {
        setGarageFade('home');
        setGarageOpen(false);
        setGarageFromCard(false);
        eventBus.dispatch('race:garageOpen', { open: false });
        // the cut is black before the room comes back
        window.setTimeout(() => eventBus.dispatch('garage:backHome', {}), 280);
    }, []);

    useEffect(() => {
        // holdHint: the loading screen says when (loader:showHint), after its
        // finish, so the panel doesn't crowd it. a timeout in case it never does
        eventBus.on('loadingScreenDone', (data?: { holdHint?: boolean }) => {
            if (!data?.holdHint) {
                setShowHint(true);
                return;
            }
            const show = () => setShowHint(true);
            eventBus.on('loader:showHint', show);
            window.setTimeout(show, 6000);
        });

        eventBus.on(
            'raceMode:changed',
            (state: { active?: boolean; paused?: boolean } | undefined) => {
                const active = Boolean(state?.active);
                setRaceModeActive(active);
                setRacePaused(Boolean(state?.paused));
                if (active) {
                    setFreeCamActive(false);
                    setFreeCamPending(false);
                }
                if (!active) {
                    setPointerLocked(false);
                    setLobbyChoiceOpen(false);
                    setGarageOpen(false);
                }
            }
        );

        eventBus.on('race:lobbyChoice', () => setLobbyChoiceOpen(true));
        eventBus.on('race:garageFromHome', (state?: { failed?: boolean }) => {
            if (!state?.failed) {
                setGarageFromCard(false);
                setLobbyChoiceOpen(false);
                setGarageOpen(true);
                eventBus.dispatch('race:garageOpen', { open: true });
            }
            window.setTimeout(() => setGarageFade(''), state?.failed ? 0 : 350);
        });
        eventBus.on('garage:home', () => window.setTimeout(() => setGarageFade(''), 300));
        eventBus.on('race:garageState', (state: GarageState) => setGarageState(state));
        eventBus.on('race:trackOutline', (state: { points?: number[][] } | undefined) => {
            if (state?.points?.length) setTrackOutline(state.points);
        });
        eventBus.on(
            'race:trackState',
            (state: { track?: 'ring' | 'drift'; building?: boolean } | undefined) => {
                setTrackState({
                    track: state?.track === 'drift' ? 'drift' : 'ring',
                    building: Boolean(state?.building),
                });
            }
        );
        eventBus.on('race:driftBoard', (state: { entries?: DriftBoardEntry[] } | undefined) => {
            setDriftBoard(state?.entries || []);
        });

        eventBus.on('race:pauseState', (state: { paused?: boolean }) => {
            setRacePaused(Boolean(state?.paused));
        });

        eventBus.on(
            'race:pointerLockChanged',
            (state: { locked?: boolean } | undefined) => {
                setPointerLocked(Boolean(state?.locked));
            }
        );

        eventBus.on('room:focus', (state: { target?: string | null } | undefined) => {
            const focused = Boolean(state?.target);
            setRoomFocus(focused);
            const active = document.activeElement;
            if (focused && active instanceof HTMLElement && active.closest('.look-hint')) active.blur();
        });
        eventBus.on('camera:view', (state: { key?: string } | undefined) => {
            setDeskView(state?.key === 'desk');
            setPanelOpen(false);
        });

        eventBus.on(
            'freeCam:state',
            (state: { active?: boolean; pending?: boolean } | undefined) => {
                setFreeCamActive(Boolean(state?.active));
                setFreeCamPending(Boolean(state?.pending));
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

        eventBus.on('graphics:contextLost', () => {
            setGraphicsContextLost(true);
        });

        eventBus.on(
            'render:resolution',
            (state: { ratio?: number } | undefined) => {
                if (state?.ratio) setRenderScale(state.ratio);
            }
        );

        eventBus.on('graphics:contextRestored', () => {
            setGraphicsContextLost(false);
        });

        eventBus.on('race:debugStats', (stats: DebugStats) => {
            setDebugStats(stats);
        });

        // the vehicle stores the choice, this just mirrors it
        eventBus.on('race:assists', () => {
            window.setTimeout(() => setAssists(readAssistSettings()), 0);
        });

        eventBus.dispatch('race:requestLeaderboard', {});
        eventBus.dispatch('race:multiplayerSetName', { playerName });
        eventBus.dispatch('race:multiplayerRequestState', {});
    }, []);

    useEffect(() => {
        const query = window.matchMedia?.(COMPACT_PANEL_QUERY);
        if (!query) return;
        const update = () => setCompactPanel(query.matches);
        query.addEventListener?.('change', update);
        return () => query.removeEventListener?.('change', update);
    }, []);

    useEffect(() => {
        const mediaQueries = [
            window.matchMedia?.('(pointer: coarse)'),
            window.matchMedia?.('(max-width: 820px)'),
            window.matchMedia?.('(max-height: 520px)'),
        ].filter(Boolean) as MediaQueryList[];
        const updateTouchDevice = () => setTouchRaceDevice(isTouchRaceDevice());
        mediaQueries.forEach((query) => {
            query.addEventListener?.('change', updateTouchDevice);
        });
        window.addEventListener('resize', updateTouchDevice);
        return () => {
            mediaQueries.forEach((query) => {
                query.removeEventListener?.('change', updateTouchDevice);
            });
            window.removeEventListener('resize', updateTouchDevice);
        };
    }, []);

    useEffect(() => {
        document.body.classList.toggle('race-mode-active', raceModeActive);
        document.body.classList.toggle(
            'race-mode-touch',
            raceModeActive && touchRaceDevice
        );
        return () => {
            document.body.classList.remove('race-mode-active');
            document.body.classList.remove('race-mode-touch');
        };
    }, [raceModeActive, touchRaceDevice]);

    useEffect(() => {
        if (!raceModeActive) {
            setRotateHint(false);
            eventBus.dispatch('race:inputReset', { source: 'raceModeInactive' });
        }
    }, [raceModeActive]);

    useEffect(() => {
        eventBus.dispatch('race:qualityChange', { mode: qualityMode });
        try {
            window.localStorage.setItem(RENDER_MODE_KEY, qualityMode);
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
        if (raceModeActive || freeCamPending) return;
        const nextState = !freeCamActive;
        if (nextState) {
            setFreeCamPending(true);
        } else {
            setFreeCamActive(false);
            setFreeCamPending(false);
        }
        eventBus.dispatch('freeCamToggle', nextState);
    };

    const requestMobileRacePresentation = async () => {
        if (!touchRaceDevice) return;
        setRotateHint(true);
        try {
            const root = document.documentElement as HTMLElement & {
                requestFullscreen?: () => Promise<void>;
            };
            if (root.requestFullscreen && !document.fullscreenElement) {
                await root.requestFullscreen();
            }
        } catch {
            // Fullscreen is best-effort on mobile browsers.
        }

        try {
            const orientation = (screen as Screen & {
                orientation?: {
                    lock?: (orientation: string) => Promise<void>;
                };
            }).orientation;
            await orientation?.lock?.('landscape');
        } catch {
            // iOS Safari and some embedded browsers do not expose orientation lock.
        }
    };

    const handleRaceToggle = () => {
        if (raceModeActive) {
            eventBus.dispatch('raceMode:exit', {
                fromUI: true,
            });
            return;
        }

        if (multiplayer.mode === 'lobby' && multiplayer.connected) {
            void requestMobileRacePresentation();
            eventBus.dispatch('raceMode:start', {
                fromUI: true,
            });
            return;
        }

        void requestMobileRacePresentation();
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

    const handleResetVehicle = () => {
        eventBus.dispatch('race:resetVehicle', {});
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
        void requestMobileRacePresentation();
        // opened from an invite link: the play button joins that lobby
        const invite = getInviteLobbyCode();
        if (invite && multiplayer.mode !== 'lobby') {
            eventBus.dispatch('race:multiplayerJoinLobby', {
                playerName,
                lobbyCode: invite,
                startRace: true,
            });
            return;
        }
        eventBus.dispatch('race:multiplayerPlaySolo', {
            playerName,
            startRace: true,
        });
    };

    const handleCreateLobby = () => {
        void requestMobileRacePresentation();
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
        void requestMobileRacePresentation();
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
        void requestMobileRacePresentation();
        eventBus.dispatch('race:multiplayerJoinLobby', {
            playerName,
            lobbyCode: code,
            startRace: true,
        });
    };

    // copies a link that joins this lobby, not just the code
    const handleCopyLobbyCode = async () => {
        const lobby = multiplayer.lobbyCode || '';
        if (!lobby) return;
        const code = buildInviteLink(lobby);

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
    const panelMenu = compactPanel && !raceModeActive && !deskView;
    const panelFolded = panelMenu && !panelOpen;

    useEffect(() => {
        if (!raceModeActive || garageOpen || racePaused) return undefined;
        const onKey = (event: KeyboardEvent) => {
            if (event.code !== 'KeyG' || event.repeat) return;
            if (event.metaKey || event.ctrlKey || event.altKey) return;
            const target = event.target as HTMLElement | null;
            if (target?.closest('input, textarea, select, [contenteditable]')) return;
            // not while the camera flies in from the room
            if (document.body.classList.contains('race-transition')) return;
            event.preventDefault();
            openGarageFromRace();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [raceModeActive, garageOpen, racePaused, openGarageFromRace]);

    return (
        <div id="ui-app" className={garageOpen ? 'garage-open' : ''}>
            <Loader />
            {showHint && (
                <div
                    className={[
                        'look-hint',
                        raceModeActive && 'racing',
                        roomFocus && 'room-focused',
                        deskView && !roomFocus && 'room-desk',
                        panelMenu && 'compact',
                        panelFolded && 'folded',
                    ]
                        .filter(Boolean)
                        .join(' ')}
                    data-label="Menu"
                    data-prevent-click
                    tabIndex={deskView ? 0 : -1}
                >
                    {panelMenu && (
                        <button
                            type="button"
                            className="look-hint-menu"
                            aria-expanded={panelOpen}
                            onClick={() => setPanelOpen((open) => !open)}
                        >
                            {panelOpen ? 'Close' : 'Menu'}
                        </button>
                    )}
                    <div className="look-hint-begin">
                        <span className="look-hint-pulse" aria-hidden="true" />
                        {raceModeActive
                            ? trackState.track === 'drift'
                                ? 'Drift park'
                                : 'Nordschleife'
                            : `${tapToBegin ? 'Tap' : 'Click'} anywhere to begin`}
                    </div>
                    {!raceModeActive && (
                        <a
                            className="look-hint-os"
                            href="https://os.yassin.app"
                            rel="noreferrer noopener"
                            target="_blank"
                        >
                            Visit the inner OS <strong>yassinOS</strong>
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M7 17 17 7M9 7h8v8" />
                            </svg>
                        </a>
                    )}
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
                        <div className="render-mode" data-prevent-click>
                            <span className="look-hint-label">Render</span>
                            <div className="look-hint-segment" role="group" aria-label="Render mode">
                                <RenderModeButtons
                                    mode={qualityMode}
                                    onChange={handleQualityChange}
                                />
                            </div>
                            {qualityMode === 'auto' && renderScale ? (
                                <span className="render-mode-scale">
                                    {renderScale.toFixed(2)}x
                                </span>
                            ) : null}
                            <button
                                type="button"
                                className={`look-hint-chip ${graphicsInfoOpen ? 'active' : ''}`}
                                onClick={() => setGraphicsInfoOpen((v) => !v)}
                            >
                                Info
                            </button>
                        </div>
                    )}
                    {!raceModeActive && graphicsInfoOpen && <GraphicsInfo />}
                    {!raceModeActive && (
                        <div className="view-toggle" data-prevent-click>
                            <button
                                type="button"
                                onClick={handleViewToggle}
                                disabled={freeCamPending}
                            >
                                {freeCamPending
                                    ? 'Entering look around'
                                    : freeCamActive
                                    ? 'Exit look around'
                                    : 'Look around'}
                            </button>
                        </div>
                    )}
                    {!raceModeActive && (
                        <div className="multiplayer-menu" data-prevent-click>
                            <span className="look-hint-label">Race the Nordschleife</span>
                            <div className="multiplayer-row">
                                <label htmlFor="multiplayer-name">Driver</label>
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
                                    className="look-hint-primary"
                                    onClick={handlePlaySolo}
                                    disabled={multiplayerBusy}
                                >
                                    <svg viewBox="0 0 24 24" aria-hidden="true">
                                        <path d="M7 4.5v15l12.5-7.5z" />
                                    </svg>
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
                                    className="look-hint-link"
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
                        <div className="race-actions" data-prevent-click>
                            <button
                                type="button"
                                className="race-garage"
                                onClick={openGarageFromRace}
                            >
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M21.7 7.1a6 6 0 0 1-7.9 6.7l-7.4 7.4a2.1 2.1 0 0 1-3-3l7.4-7.4a6 6 0 0 1 6.7-7.9l-3.6 3.6 1 2.9 2.9 1z" />
                                </svg>
                                <span>Garage</span>
                                <kbd>G</kbd>
                            </button>
                            {!racePaused && (
                                <button
                                    type="button"
                                    className="race-pause-toggle"
                                    onClick={handlePauseMenu}
                                >
                                    <svg viewBox="0 0 24 24" aria-hidden="true">
                                        <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />
                                    </svg>
                                    <span>Pause</span>
                                    <kbd>Esc</kbd>
                                </button>
                            )}
                            <button
                                type="button"
                                className="race-toggle"
                                onClick={handleRaceToggle}
                            >
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M10.5 5 4 12l6.5 7v-4.5H20v-5h-9.5z" />
                                </svg>
                                <span>Exit race mode</span>
                            </button>
                        </div>
                    )}
                    {raceModeActive && !racePaused && !pointerLocked && !touchRaceDevice && (
                        <div className="race-lock-hint">
                            Click the scene to lock the mouse. Esc pauses.
                        </div>
                    )}
                </div>
            )}
            {multiplayer.mode === 'lobby' && multiplayer.lobbyCode && (
                <div className="lobby-code-banner" data-prevent-click>
                    <span>Lobby Code: {multiplayer.lobbyCode}</span>
                    <button type="button" onClick={handleCopyLobbyCode}>
                        {lobbyCodeCopyState || 'Copy invite link'}
                    </button>
                </div>
            )}
            {raceModeActive && !garageOpen && (
                <RaceHudGauges
                    speedKph={hud.speedKph}
                    gear={displayedGear}
                    rpm={hud.rpm}
                    redlineRpm={hud.redlineRpm || 7000}
                    tachMaxRpm={hud.tachMaxRpm}
                    lapTimeMs={hud.lapTimeMs}
                    lapRunning={hud.lapRunning}
                    lapArmed={hud.lapArmed}
                    lastLapMs={hud.lastLapMs || 0}
                    bestLapMs={hud.ghostBestLapMs || 0}
                    sectors={hud.sectors || null}
                />
            )}
            {raceModeActive && hud.map && !garageOpen && (
                <Minimap
                    outline={trackOutline}
                    bounds={hud.sectors?.bounds || []}
                    x={hud.map.x}
                    z={hud.map.z}
                    heading={hud.map.heading}
                    remotes={hud.map.remotes}
                />
            )}
            {raceModeActive && !garageOpen && hud.track === 'drift' && hud.drift && (
                <DriftHud drift={hud.drift} best={driftBoard[0]?.score || 0} />
            )}
            {raceModeActive && trackState.building && (
                <div className="drift-building" data-prevent-click>
                    Building the drift park
                </div>
            )}
            {raceModeActive && trackState.track === 'drift' && (
                <div className="race-hud" data-prevent-click>
                    <div className="race-hud-board">
                        <h4 className="race-board-head">Drift park</h4>
                        {driftBoard.length === 0 ? (
                            <p>No runs yet. Drift a full lap to score.</p>
                        ) : (
                            <ol>
                                {driftBoard.slice(0, 5).map((entry) => (
                                    <li key={entry.id}>
                                        <span>{entry.name}</span>
                                        <span>{Math.round(entry.score).toLocaleString('en-US')}</span>
                                    </li>
                                ))}
                            </ol>
                        )}
                    </div>
                </div>
            )}
            {raceModeActive && trackState.track === 'ring' && (
                <div className="race-hud" data-prevent-click>

                    <div className="race-hud-board">
                        <h4 className="race-board-head">
                            Leaderboard
                            <span className="race-board-switch">
                                {(['stock', 'tuned'] as const).map((board) => (
                                    <button
                                        type="button"
                                        key={board}
                                        className={leaderboardBoard === board ? 'on' : ''}
                                        onClick={() => {
                                            setLeaderboardBoard(board);
                                            eventBus.dispatch('race:leaderboardBoard', { board });
                                        }}
                                    >
                                        {board === 'stock' ? 'Stock' : 'Tuned'}
                                    </button>
                                ))}
                            </span>
                        </h4>
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
            {raceModeActive && touchRaceDevice && rotateHint && (
                <div className="race-rotate-hint" data-prevent-click>
                    Rotate your phone for the best racing experience.
                </div>
            )}
            {raceModeActive && touchRaceDevice && !racePaused && (
                <div className="race-touch-controls" data-prevent-click>
                    <div className="race-touch-cluster race-touch-steer">
                        <RaceTouchButton
                            control="steerRight"
                            label="A"
                            className="race-touch-secondary"
                        />
                        <RaceTouchButton
                            control="steerLeft"
                            label="D"
                            className="race-touch-secondary"
                        />
                    </div>
                    <div className="race-touch-cluster race-touch-actions">
                        <button
                            type="button"
                            className="race-touch-button race-touch-reset"
                            onClick={handleResetVehicle}
                        >
                            Reset
                        </button>
                        <RaceTouchButton
                            control="brake"
                            label="Brake"
                            className="race-touch-secondary"
                        />
                        <RaceTouchButton control="throttle" label="Gas" />
                    </div>
                </div>
            )}
            {raceDebugView && raceModeActive && !racePaused && (
                <GraphicsInfo floating />
            )}
            {graphicsContextLost && (
                <div className="graphics-context-lost" data-prevent-click>
                    Graphics context lost. Reload game.
                </div>
            )}
            {debugStats && (
                <div className="race-debug-panel" data-prevent-click>
                    <div>FPS {debugStats.fps ?? '--'}</div>
                    <div>Frame {debugStats.frameMs ?? '--'}ms</div>
                    <div>Physics {debugStats.physicsMs ?? '--'}ms</div>
                    <div>Speed {debugStats.speedKph ?? 0} km/h</div>
                    <div>
                        Ground {debugStats.grounded ? 'yes' : 'no'} / wheels{' '}
                        {debugStats.wheelContactCount ?? 0}
                    </div>
                    <div>
                        Susp{' '}
                        {(debugStats.suspensionCompression || [])
                            .map((value) => value.toFixed(2))
                            .join(' ')}
                    </div>
                </div>
            )}
            {raceModeActive && lobbyChoiceOpen && !racePaused && !garageOpen && (
                <LobbyChoice
                    multiplayer={multiplayer}
                    playerName={playerName}
                    onClose={closeLobbyChoice}
                    onGarage={() => openGarage(true)}
                />
            )}
            {raceModeActive && garageOpen && (
                <Garage state={garageState} onClose={closeGarage} onHome={garageToHome} />
            )}
            {showHint && !raceModeActive && !roomFocus && !deskView && !freeCamActive && !garageFade && (
                <button
                    type="button"
                    className="garage-launch"
                    data-prevent-click
                    onClick={openGarageFromHome}
                >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M21.7 7.1a6 6 0 0 1-7.9 6.7l-7.4 7.4a2.1 2.1 0 0 1-3-3l7.4-7.4a6 6 0 0 1 6.7-7.9l-3.6 3.6 1 2.9 2.9 1z" />
                    </svg>
                    <span>
                        <strong>Garage</strong>
                        <small>Customize your car</small>
                    </span>
                </button>
            )}
            <div className={`garage-fade ${garageFade ? 'on' : ''}`} data-prevent-click={garageFade ? '' : undefined}>
                <span>{garageFade === 'home' ? 'Back to the room' : 'Opening the garage'}</span>
            </div>
            {raceModeActive && racePaused && (
                <div className="race-menu-overlay" data-prevent-click>
                    <div className="race-menu-panel" data-prevent-click>
                        <h3>{trackState.track === 'drift' ? 'Drift Park' : 'Nordschleife'} Pause</h3>
                        <p>Esc opens this menu at any time during race mode.</p>

                        <div className="race-menu-row race-track-pick">
                            <span>Track</span>
                            <div className="race-quality-buttons">
                                {(
                                    [
                                        ['ring', 'Nordschleife'],
                                        ['drift', 'Drift park'],
                                    ] as const
                                ).map(([track, label]) => (
                                    <button
                                        type="button"
                                        key={track}
                                        className={trackState.track === track ? 'active' : ''}
                                        disabled={trackState.building}
                                        onClick={() => {
                                            if (trackState.track === track) return;
                                            eventBus.dispatch('race:setTrack', { track });
                                            handleResumeRace();
                                        }}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        {trackState.track === 'drift' && (
                            <div className="race-menu-drift-board">
                                <h4>Drift park scores</h4>
                                {driftBoard.length === 0 ? (
                                    <p>No runs yet. Drift a full lap to score.</p>
                                ) : (
                                    <ol>
                                        {driftBoard.slice(0, 10).map((entry) => (
                                            <li key={entry.id}>
                                                <span>{entry.name}</span>
                                                <span>{carOptions.find((car) => car.id === entry.carId)?.label || entry.carId}</span>
                                                <span>{formatLapTime(entry.lapTimeMs)}</span>
                                                <strong>{Math.round(entry.score).toLocaleString('en-US')}</strong>
                                            </li>
                                        ))}
                                    </ol>
                                )}
                            </div>
                        )}

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
                            <span>
                                Render Mode
                                {qualityMode === 'auto' && renderScale ? (
                                    <span className="race-quality-scale">
                                        {renderScale.toFixed(2)}x
                                    </span>
                                ) : null}
                            </span>
                            <div className="race-quality-buttons">
                                <RenderModeButtons
                                    mode={qualityMode}
                                    onChange={handleQualityChange}
                                />
                            </div>
                        </div>

                        <div className="race-menu-row">
                            <button
                                type="button"
                                onClick={() => setGraphicsInfoOpen((v) => !v)}
                            >
                                {graphicsInfoOpen
                                    ? 'Hide graphics info'
                                    : 'Graphics info'}
                            </button>
                        </div>
                        {graphicsInfoOpen && <GraphicsInfo />}

                        <div className="race-menu-row">
                            <span>Assists</span>
                            <div className="race-quality-buttons">
                                {ASSIST_OPTIONS.map((option) => (
                                    <button
                                        key={option.preset}
                                        type="button"
                                        className={
                                            assists.preset === option.preset
                                                ? 'active'
                                                : ''
                                        }
                                        onClick={() =>
                                            eventBus.dispatch('race:assists', {
                                                preset: option.preset,
                                            })
                                        }
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="race-menu-row">
                            <span>Gearbox</span>
                            <div className="race-quality-buttons">
                                {[true, false].map((auto) => (
                                    <button
                                        key={auto ? 'auto' : 'manual'}
                                        type="button"
                                        className={
                                            assists.autoGears === auto
                                                ? 'active'
                                                : ''
                                        }
                                        onClick={() =>
                                            eventBus.dispatch('race:assists', {
                                                autoGears: auto,
                                            })
                                        }
                                    >
                                        {auto ? 'Auto' : 'Manual (Q / E)'}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <p className="race-menu-controls">
                            W / S or arrows: throttle, brake (hold S to reverse).
                            A / D: steer. Space: handbrake. R: back on track. T:
                            restart lap. G: garage. Gamepad: triggers, left
                            stick, A handbrake, Y reset.
                        </p>
                        <p className="race-menu-controls">
                            Drifting: turn in and tap Space, then feather W to
                            hold the slide. Steer into the corner for more angle
                            and a tighter line. Tap the other way to trim the
                            angle and widen the line, hold it there on the
                            throttle to swing into a drift the other way, lift
                            off to straighten up. Off assists leave it all to
                            you, the garage's drift build helps there.
                        </p>
                        <p className="race-menu-controls">
                            Drift park: every drift builds a chain of points,
                            more for angle and speed, and the longer you hold
                            it the bigger the multiplier. Straighten up to bank
                            it; a wall, the grass or a spin loses it. Each lap
                            is a run on the scoreboard.
                        </p>

                        <p className="race-menu-credits">
                            Track: © OpenStreetMap contributors (ODbL).
                            Elevation: © GeoBasis-DE / LVermGeoRP, dl-de/by-2-0,
                            www.lvermgeo.rlp.de [Daten bearbeitet]; Copernicus GLO-30 DEM.
                        </p>
                        <ModelCredits />

                        <div className="race-menu-actions">
                            <button
                                type="button"
                                className="race-menu-primary"
                                onClick={handleResumeRace}
                            >
                                Resume Race
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    eventBus.dispatch('race:setPaused', { paused: false });
                                    openGarage(false);
                                }}
                            >
                                Garage
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

