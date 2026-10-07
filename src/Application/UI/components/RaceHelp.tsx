import React, { useEffect } from 'react';
import ShellCredits from './ShellCredits';

type Line = [string, string];

const KEYBOARD: Line[] = [
    ['W  ↑', 'Throttle'],
    ['S  ↓', 'Brake, hold at a stop to back up'],
    ['A D  ← →', 'Steer'],
    ['Space', 'Handbrake'],
    ['Q  E', 'Shift down, up (manual: Q in first at a stop is reverse)'],
    ['Mouse', 'Look around, click the road to lock it'],
    ['C', 'Camera: chase, far, bumper, hood'],
    ['H', 'Horn'],
    ['Z (hold)', 'Rewind'],
    ['R', 'Back on track'],
    ['T', 'Restart the lap'],
    ['G', 'Garage'],
    ['Esc', 'Pause, and back'],
];

const CONTROLLER: Line[] = [
    ['RT', 'Throttle'],
    ['LT', 'Brake, hold at a stop to back up'],
    ['Left stick', 'Steer'],
    ['A', 'Handbrake'],
    ['LB  RB', 'Shift down, up'],
    ['Right stick', 'Look around'],
    ['B', 'Look back'],
    ['X', 'Camera'],
    ['Left stick click', 'Horn'],
    ['D-pad down (hold)', 'Rewind'],
    ['Y', 'Back on track'],
    ['View', 'Restart the lap'],
    ['Menu', 'Pause'],
    ['In menus', 'D-pad or left stick moves, A picks, B goes back, the bumpers switch tabs'],
];

const TABS: Array<[string, string]> = [
    ['controls', 'Controls'],
    ['laps', 'Hot laps'],
    ['drifting', 'Drifting'],
    ['online', 'Online'],
    ['photo', 'Photo mode'],
    ['credits', 'Credits'],
];

const Keys = ({ title, lines }: { title: string; lines: Line[] }) => (
    <div className="race-help-keys">
        <h5>{title}</h5>
        <dl>
            {lines.map(([key, what]) => (
                <React.Fragment key={key}>
                    <dt>{key}</dt>
                    <dd>{what}</dd>
                </React.Fragment>
            ))}
        </dl>
    </div>
);

const Points = ({ items }: { items: Array<[string, string]> }) => (
    <ul className="race-help-points">
        {items.map(([title, text]) => (
            <li key={title}>
                <strong>{title}</strong>
                <span>{text}</span>
            </li>
        ))}
    </ul>
);

// everything the pause menu used to spell out, one tab at a time
const RaceHelp = ({
    tab,
    onTab,
    onClose,
}: {
    tab: string;
    onTab: (tab: string) => void;
    onClose: () => void;
}) => {
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopImmediatePropagation();
            onClose();
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [onClose]);

    return (
        <div className="race-help" role="dialog" aria-label="Help" data-prevent-click>
            <header>
                <h3>Help</h3>
                <button type="button" className="race-help-close" onClick={onClose}>
                    Back
                </button>
            </header>
            <nav className="race-help-tabs">
                {TABS.map(([id, label]) => (
                    <button
                        type="button"
                        key={id}
                        className={tab === id ? 'on' : ''}
                        onClick={() => onTab(id)}
                    >
                        {label}
                    </button>
                ))}
            </nav>
            <div className="race-help-body">
                {tab === 'controls' && (
                    <div className="race-help-columns">
                        <Keys title="Keyboard" lines={KEYBOARD} />
                        <Keys title="Controller" lines={CONTROLLER} />
                    </div>
                )}
                {tab === 'laps' && (
                    <Points
                        items={[
                            [
                                'The gap',
                                'The number next to the clock is how far ahead or behind your best lap with this car and setup you are, at the same spot.',
                            ],
                            [
                                'Off the road',
                                "All four wheels off the asphalt for more than a moment and the lap won't count: it still shows, but not on the leaderboard, as your best or as a ghost. Finish it or restart with T.",
                            ],
                            [
                                'Rewind',
                                "Hold Z (down on the d-pad) to take the car back up to 10 s. It's for practice, so a lap that uses it won't count either. Only when you drive the ring alone.",
                            ],
                            [
                                'Ghost',
                                'Race your best lap, a rival (the lap on the board just above yours) or the record. Pick it in the pause menu.',
                            ],
                            [
                                'Driving line',
                                'Green is on pace, yellow says ease off, red says brake. Braking shows it only where you need to slow down.',
                            ],
                            [
                                'Boards',
                                'Stock cars and tuned ones have their own leaderboard. Tunes from the board can be loaded in the garage.',
                            ],
                        ]}
                    />
                )}
                {tab === 'drifting' && (
                    <Points
                        items={[
                            [
                                'Starting one',
                                'Turn in and tap Space, then feather the throttle to hold the slide.',
                            ],
                            [
                                'Holding it',
                                'Steer into the corner for more angle and a tighter line. Tap the other way to trim it and widen the line, lift off to straighten up.',
                            ],
                            [
                                'Switching sides',
                                'Hold the countersteer on the throttle and the car swings into a drift the other way.',
                            ],
                            [
                                'Assists',
                                "Sport helps hold a slide, Off leaves it all to you. The garage's drift build sets the car up for it.",
                            ],
                            [
                                'Drift park',
                                'Its own small track (pick it under Track). Every drift builds a chain, more for angle and speed, and the longer you hold it the bigger the multiplier. Straighten up to bank it; a wall, the grass or a spin loses it. Each lap is a run on its scoreboard.',
                            ],
                        ]}
                    />
                )}
                {tab === 'online' && (
                    <Points
                        items={[
                            [
                                'Lobbies',
                                'Create a lobby from the room or the pause menu and share the invite link or its code. Everyone drives the ring together and can bump into each other.',
                            ],
                            [
                                'Races',
                                'The host picks 1 to 3 laps under Online. Everyone lines up on the grid in the order they joined, counts down to the same green light and races. Places go by who is furthest round, and the result shows at the flag.',
                            ],
                            ['Horn', 'H, or click the left stick. The others hear it from where your car is.'],
                        ]}
                    />
                )}
                {tab === 'photo' && (
                    <Points
                        items={[
                            ['Opening it', 'Photo mode in the pause menu. The race stays paused and the hud hides.'],
                            [
                                'Framing',
                                'Drag (or the right stick) to go around the car, scroll (or the triggers) to zoom, W A S D (or the left stick) to move, Q and E (or the bumpers) to go down and up, Shift to move faster.',
                            ],
                            ['Saving', 'Save photo downloads the frame as a png, without the hud.'],
                        ]}
                    />
                )}
                {tab === 'credits' && (
                    <div className="race-help-credits">
                        <p>
                            Track: © OpenStreetMap contributors (ODbL). Elevation: © GeoBasis-DE /
                            LVermGeoRP, dl-de/by-2-0, www.lvermgeo.rlp.de [Daten bearbeitet];
                            Copernicus GLO-30 DEM.
                        </p>
                        <ShellCredits />
                    </div>
                )}
            </div>
        </div>
    );
};

export default RaceHelp;
