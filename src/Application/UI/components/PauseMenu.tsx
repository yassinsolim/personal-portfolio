import React, { useEffect, useRef, useState } from 'react';
import eventBus from '../EventBus';
import { carOptions } from '../../carOptions';
import { carThumb } from './CarPicker';
import { formatTime } from './RaceHudGauges';
import GraphicsInfo from './GraphicsInfo';
import RaceHelp from './RaceHelp';
import TrackMap from './TrackMap';
import type { RaceHud } from './LobbyRaceHud';
import type { LapEntry } from './LapCard';
import type { MultiplayerState } from '../../Racing/Multiplayer/MultiplayerService';
import type { AssistPreset } from '../../Racing/Vehicle/assists';
import { GHOST_MODES, type GhostMode, type GhostPick } from '../../Racing/Ghost/ghostMode';
import { LINE_MODES, type LineMode } from '../../Racing/Track/lineMode';
import { STEERING_MAX, STEERING_MIN, clampSteering } from '../../Racing/Input/steering';
import { MAX_DRIVER_NAME } from '../../Racing/Multiplayer/driverName';
import {
    readGraphicsOff,
    writeGraphicsOff,
    type GraphicsOption,
} from '../../Racing/Visuals/graphicsOptions';

export type QualityMode = 'auto' | 'quality' | 'performance';
type Track = 'ring' | 'drift';

const RENDER_MODES: Array<[QualityMode, string]> = [
    ['auto', 'Auto'],
    ['quality', 'Quality'],
    ['performance', 'Performance'],
];
const ASSISTS: Array<[AssistPreset, string]> = [
    ['standard', 'Standard'],
    ['sport', 'Sport (drift)'],
    ['off', 'Off'],
];
const GHOST_LABEL: Record<GhostMode, string> = {
    off: 'Off',
    best: 'Your best',
    rival: 'Rival',
    record: 'Record',
    lap: 'Picked lap',
};
const LINE_LABEL: Record<LineMode, string> = {
    off: 'Off',
    braking: 'Braking',
    full: 'Full',
};
const TRACKS: Array<[Track, string, string]> = [
    ['ring', 'Nordschleife', 'Hot laps on the 20.8 km ring'],
    ['drift', 'Drift park', 'Chain drifts together for points'],
];
// what the advanced switches take away, grouped like a settings page
const GRAPHICS: Array<[string, Array<[GraphicsOption, string]>]> = [
    [
        'Image',
        [
            ['post', 'Post effects (all of the image ones)'],
            ['bloom', 'Bloom'],
            ['streaks', 'Speed streaks'],
            ['aberration', 'Lens fringe'],
            ['grain', 'Film grain'],
            ['antialias', 'Antialiasing'],
        ],
    ],
    [
        'World',
        [
            ['shadows', 'Sun shadows'],
            ['trees', 'Detailed trees'],
            ['sky', 'Sky and clouds'],
            ['trackside', 'Fences, landmarks and graffiti'],
            ['distance', 'Full view distance'],
        ],
    ],
    [
        'Effects and camera',
        [
            ['smoke', 'Tire smoke'],
            ['skids', 'Skid marks'],
            ['sparks', 'Sparks'],
            ['shake', 'Camera shake'],
            ['speedFov', 'Wider view at speed'],
        ],
    ],
];

type DriftEntry = { id: string; name: string; score: number; lapTimeMs: number; carId: string };

type Props = {
    track: Track;
    building: boolean;
    carId: string;
    bestLapMs: number;
    driftBoard: DriftEntry[];
    multiplayer: MultiplayerState;
    multiplayerBusy: boolean;
    lobbyCodeCopyState: string;
    race: RaceHud | null;
    inLobbyRace: boolean;
    volume: number;
    muted: boolean;
    qualityMode: QualityMode;
    renderScale: number | null;
    assists: { preset: AssistPreset; autoGears: boolean };
    ghostMode: GhostMode;
    // a board lap picked from its card to race
    ghostPick: GhostPick | null;
    // the ring's top laps on the board picked, each opens its card
    board: LapEntry[];
    boardKind: 'stock' | 'tuned';
    onBoard: (kind: 'stock' | 'tuned') => void;
    onLap: (entry: LapEntry) => void;
    // a lap's card is open over the menu
    dimmed: boolean;
    lineMode: LineMode;
    steering: number;
    onResume: () => void;
    onExit: () => void;
    onGarage: () => void;
    onPickCar: () => void;
    onDriveWithOthers: () => void;
    onCopyLobbyCode: () => void;
    onLeaveLobby: () => void;
    onVolume: (volume: number) => void;
    onMuteToggle: () => void;
    onQuality: (mode: QualityMode) => void;
    onGhost: (mode: GhostMode) => void;
    onLine: (mode: LineMode) => void;
    onSteering: (steering: number) => void;
    playerName: string;
    onPlayerName: (name: string) => void;
};

// a row of buttons where one is picked
function Choice<T extends string | number | boolean>({
    value,
    options,
    onPick,
    disabled = false,
}: {
    value: T;
    options: Array<[T, string]>;
    onPick: (value: T) => void;
    disabled?: boolean;
}) {
    return (
        <div className="pm-choice">
            {options.map(([option, label]) => (
                <button
                    type="button"
                    key={String(option)}
                    className={value === option ? 'on' : ''}
                    disabled={disabled}
                    onClick={() => onPick(option)}
                >
                    {label}
                </button>
            ))}
        </div>
    );
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="pm-row">
        <span>{label}</span>
        {children}
    </div>
);

// the pause menu: what to do next along the top, then the track, the driving
// and the settings side by side (stacked on a phone). the controls and tips
// live behind Help
const PauseMenu = (props: Props) => {
    const {
        track,
        multiplayer,
        race,
        inLobbyRace,
    } = props;
    const [help, setHelp] = useState<string | null>(null);
    const [advanced, setAdvanced] = useState(false);
    const [info, setInfo] = useState(false);
    const [graphicsOff, setGraphicsOff] = useState<GraphicsOption[]>(() => readGraphicsOff());
    const advancedRef = useRef<HTMLDivElement>(null);
    const car = carOptions.find((option) => option.id === props.carId);
    const inLobby = multiplayer.mode === 'lobby' && Boolean(multiplayer.lobbyCode);
    const raceOver = Boolean(race?.entered && race.phase === 'finished');

    // esc goes back to driving, unless something over the menu has it. the
    // esc that paused was taken (default prevented) before this listener,
    // which can be added while that same key is still going round
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.defaultPrevented) return;
            if (help || props.dimmed || document.querySelector('.car-picker')) return;
            event.preventDefault();
            props.onResume();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [help, props.dimmed, props.onResume]);

    // the switches open under the columns: bring them into view
    useEffect(() => {
        if (advanced) advancedRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, [advanced]);

    const toggleGraphics = (option: GraphicsOption) => {
        const next = graphicsOff.includes(option)
            ? graphicsOff.filter((item) => item !== option)
            : [...graphicsOff, option];
        setGraphicsOff(next);
        writeGraphicsOff(next);
        eventBus.dispatch('race:graphicsOff', { off: next });
    };

    // the race picks up again first: restarting and resetting only run then
    const resumeThen = (event: string) => {
        props.onResume();
        eventBus.dispatch(event, { source: 'menu' });
    };

    const pickTrack = (next: Track) => {
        if (next === track) return;
        eventBus.dispatch('race:setTrack', { track: next });
        props.onResume();
    };

    return (
        <div
            className={`race-menu-overlay${help || props.dimmed ? ' helping' : ''}`}
            data-prevent-click
        >
            <div className="race-menu-panel pm" data-prevent-click>
                <header className="pm-head">
                    <div>
                        <h3>Paused</h3>
                        <p>
                            {track === 'drift' ? 'Drift park' : 'Nordschleife'}
                            {car ? ` · ${car.label}` : ''}
                        </p>
                    </div>
                    <button type="button" className="pm-help" onClick={() => setHelp('controls')}>
                        Help
                    </button>
                </header>

                <div className="pm-actions">
                    <button type="button" className="race-menu-primary" onClick={props.onResume}>
                        Resume <kbd>Esc</kbd>
                    </button>
                    <button
                        type="button"
                        disabled={inLobbyRace}
                        onClick={() => resumeThen('race:restartLap')}
                    >
                        Restart {track === 'drift' ? 'run' : 'lap'} <kbd>T</kbd>
                    </button>
                    <button type="button" onClick={() => resumeThen('race:resetVehicle')}>
                        Back on track <kbd>R</kbd>
                    </button>
                    <button type="button" disabled={inLobbyRace} onClick={props.onGarage}>
                        Garage <kbd>G</kbd>
                    </button>
                    <button
                        type="button"
                        onClick={() => eventBus.dispatch('race:photoMode', { on: true })}
                    >
                        Photo mode
                    </button>
                    <button type="button" className="pm-exit" onClick={props.onExit}>
                        Exit race mode
                    </button>
                </div>

                <div className="pm-grid">
                    <section>
                        <h4>Track</h4>
                        <div className="pm-tracks">
                            {TRACKS.map(([id, label, hint]) => (
                                <button
                                    type="button"
                                    key={id}
                                    className={`pm-track ${track === id ? 'on' : ''}`}
                                    disabled={props.building || inLobbyRace}
                                    onClick={() => pickTrack(id)}
                                >
                                    <TrackMap track={id} />
                                    <strong>{label}</strong>
                                    <small>{hint}</small>
                                    <em>
                                        {id === 'ring'
                                            ? props.bestLapMs > 0 && track === 'ring'
                                                ? `Your best ${formatTime(props.bestLapMs)}`
                                                : 'Leaderboard, ghosts, lobbies'
                                            : props.driftBoard[0]
                                              ? `Top score ${Math.round(props.driftBoard[0].score).toLocaleString('en-US')}`
                                              : 'Solo, its own scoreboard'}
                                    </em>
                                </button>
                            ))}
                        </div>
                        {track === 'ring' && (
                            <>
                                <div className="pm-board-head">
                                    <span>Leaderboard</span>
                                    <Choice
                                        value={props.boardKind}
                                        options={[
                                            ['stock', 'Stock'],
                                            ['tuned', 'Tuned'],
                                        ]}
                                        onPick={props.onBoard}
                                    />
                                </div>
                                {props.board.length === 0 ? (
                                    <p className="pm-note">No laps yet.</p>
                                ) : (
                                    <ol className="pm-board pm-laps">
                                        {props.board.slice(0, 5).map((entry) => (
                                            <li key={entry.id}>
                                                <button
                                                    type="button"
                                                    title={`${entry.name}'s car, setup and replay`}
                                                    onClick={() => props.onLap(entry)}
                                                >
                                                    <span>{entry.name}</span>
                                                    <span>
                                                        {carOptions.find((option) => option.id === entry.carId)
                                                            ?.label || entry.carId}
                                                    </span>
                                                    <strong>{formatTime(entry.lapTimeMs)}</strong>
                                                </button>
                                            </li>
                                        ))}
                                    </ol>
                                )}
                            </>
                        )}
                        {track === 'drift' && props.driftBoard.length > 0 && (
                            <ol className="pm-board">
                                {props.driftBoard.slice(0, 5).map((entry) => (
                                    <li key={entry.id}>
                                        <span>{entry.name}</span>
                                        <span>
                                            {carOptions.find((option) => option.id === entry.carId)?.label ||
                                                entry.carId}
                                        </span>
                                        <strong>{Math.round(entry.score).toLocaleString('en-US')}</strong>
                                    </li>
                                ))}
                            </ol>
                        )}
                        <h4>Car</h4>
                        <button type="button" className="pm-car" onClick={props.onPickCar}>
                            <img src={carThumb(props.carId)} alt="" width={72} height={40} />
                            <span>{car?.label || props.carId}</span>
                            <em>Change</em>
                        </button>
                        <h4>Online</h4>
                        <Row label="Name">
                            <input
                                className="pm-input"
                                value={props.playerName}
                                maxLength={MAX_DRIVER_NAME}
                                placeholder="Your name"
                                aria-label="Driver name"
                                spellCheck={false}
                                onChange={(event) =>
                                    props.onPlayerName(event.target.value.slice(0, MAX_DRIVER_NAME))
                                }
                            />
                        </Row>
                        {inLobby ? (
                            <>
                                <Row label={`Lobby ${multiplayer.lobbyCode}`}>
                                    <div className="pm-inline">
                                        <button type="button" onClick={props.onCopyLobbyCode}>
                                            {props.lobbyCodeCopyState || 'Copy invite'}
                                        </button>
                                        <button
                                            type="button"
                                            disabled={props.multiplayerBusy}
                                            onClick={props.onLeaveLobby}
                                        >
                                            Leave
                                        </button>
                                    </div>
                                </Row>
                                {track === 'ring' && multiplayer.connected && (
                                    <Row label="Race">
                                        {multiplayer.isHost && inLobbyRace ? (
                                            <button
                                                type="button"
                                                onClick={() => eventBus.dispatch('race:lobbyRaceEnd', {})}
                                            >
                                                End race
                                            </button>
                                        ) : multiplayer.isHost ? (
                                            <Choice
                                                value={0}
                                                disabled={multiplayer.players.length < 2}
                                                options={[
                                                    [1, '1 lap'],
                                                    [2, '2 laps'],
                                                    [3, '3 laps'],
                                                ]}
                                                onPick={(laps) =>
                                                    eventBus.dispatch('race:lobbyRaceStart', { laps })
                                                }
                                            />
                                        ) : raceOver ? (
                                            <button
                                                type="button"
                                                onClick={() => eventBus.dispatch('race:lobbyRaceLeave', {})}
                                            >
                                                Back to free drive
                                            </button>
                                        ) : (
                                            <em className="pm-note">
                                                {inLobbyRace ? 'Racing' : 'The host starts races'}
                                            </em>
                                        )}
                                    </Row>
                                )}
                            </>
                        ) : (
                            <button type="button" className="pm-wide" onClick={props.onDriveWithOthers}>
                                Drive with others
                            </button>
                        )}
                    </section>

                    <section>
                        <h4>Driving</h4>
                        <Row label="Assists">
                            <Choice
                                value={props.assists.preset}
                                options={ASSISTS}
                                onPick={(preset) => eventBus.dispatch('race:assists', { preset })}
                            />
                        </Row>
                        <Row label="Gearbox">
                            <Choice
                                value={props.assists.autoGears}
                                options={[
                                    [true, 'Auto'],
                                    [false, 'Manual'],
                                ]}
                                onPick={(autoGears) => eventBus.dispatch('race:assists', { autoGears })}
                            />
                        </Row>
                        <Row label="Steering">
                            <div className="pm-slider">
                                <input
                                    type="range"
                                    aria-label="Steering"
                                    min={STEERING_MIN}
                                    max={STEERING_MAX}
                                    step="0.1"
                                    value={props.steering}
                                    onChange={(event) =>
                                        props.onSteering(clampSteering(Number(event.target.value)))
                                    }
                                />
                                <span>{Math.round(props.steering * 100)}%</span>
                            </div>
                        </Row>
                        {track === 'ring' && (
                            <>
                                <Row label="Ghost">
                                    <Choice
                                        value={props.ghostMode}
                                        options={[
                                            ...GHOST_MODES.map(
                                                (mode) => [mode, GHOST_LABEL[mode]] as [GhostMode, string]
                                            ),
                                            ...(props.ghostPick
                                                ? [['lap', props.ghostPick.name] as [GhostMode, string]]
                                                : []),
                                        ]}
                                        onPick={props.onGhost}
                                    />
                                </Row>
                                <Row label="Driving line">
                                    <Choice
                                        value={props.lineMode}
                                        options={LINE_MODES.map(
                                            (mode) => [mode, LINE_LABEL[mode]] as [LineMode, string]
                                        )}
                                        onPick={props.onLine}
                                    />
                                </Row>
                            </>
                        )}
                    </section>

                    <section>
                        <h4>Sound</h4>
                        <Row label="Volume">
                            <div className="pm-slider">
                                <input
                                    type="range"
                                    aria-label="Volume"
                                    min="0"
                                    max="1"
                                    step="0.01"
                                    value={props.volume}
                                    onChange={(event) => props.onVolume(Number(event.target.value))}
                                />
                                <span>{Math.round(props.volume * 100)}%</span>
                            </div>
                        </Row>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={props.muted}
                            className={`pm-switch ${props.muted ? 'on' : ''}`}
                            onClick={props.onMuteToggle}
                        >
                            <span>Mute</span>
                            <i aria-hidden="true" />
                        </button>
                        <h4>Graphics</h4>
                        <Row label="Render">
                            <Choice value={props.qualityMode} options={RENDER_MODES} onPick={props.onQuality} />
                        </Row>
                        {props.qualityMode === 'auto' && props.renderScale ? (
                            <p className="pm-note">Resolution now {props.renderScale.toFixed(2)}x</p>
                        ) : null}
                        <div className="pm-inline pm-graphics-links">
                            <button
                                type="button"
                                aria-expanded={advanced}
                                onClick={() => setAdvanced((open) => !open)}
                            >
                                {advanced ? 'Hide advanced' : 'Advanced'}
                            </button>
                            <button type="button" onClick={() => setInfo((open) => !open)}>
                                {info ? 'Hide info' : 'Graphics info'}
                            </button>
                        </div>
                        {info && <GraphicsInfo />}
                    </section>
                </div>

                {advanced && (
                    <div className="pm-advanced" ref={advancedRef}>
                        <h4>Advanced graphics</h4>
                        <p className="pm-note">
                            Switch off what you can do without. These only take things away from the
                            render mode, never add.
                        </p>
                        <div className="pm-advanced-groups">
                            {GRAPHICS.map(([group, options]) => (
                                <div key={group} className="pm-switches">
                                    <h5>{group}</h5>
                                    {options.map(([option, label]) => {
                                        const on = !graphicsOff.includes(option);
                                        return (
                                            <button
                                                type="button"
                                                key={option}
                                                role="switch"
                                                aria-checked={on}
                                                className={`pm-switch ${on ? 'on' : ''}`}
                                                onClick={() => toggleGraphics(option)}
                                            >
                                                <span>{label}</span>
                                                <i aria-hidden="true" />
                                            </button>
                                        );
                                    })}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <footer className="pm-foot">
                    <span>
                        Track © OpenStreetMap contributors (ODbL). Elevation © GeoBasis-DE / LVermGeoRP,
                        dl-de/by-2-0 [Daten bearbeitet]; Copernicus GLO-30 DEM.
                    </span>
                    <button type="button" onClick={() => setHelp('credits')}>
                        Credits
                    </button>
                </footer>
            </div>
            {help && <RaceHelp tab={help} onTab={setHelp} onClose={() => setHelp(null)} />}
        </div>
    );
};

export default PauseMenu;
