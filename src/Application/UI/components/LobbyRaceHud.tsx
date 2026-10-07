import React, { useEffect, useRef, useState } from 'react';
import eventBus from '../EventBus';
import { formatTime } from './RaceHudGauges';

// a lobby race as RaceManager.raceHud() sends it
export type RaceHud = {
    phase: 'countdown' | 'racing' | 'finished';
    // on the grid, not just watching
    entered: boolean;
    host: boolean;
    laps: number;
    lap: number;
    // seconds to the green light
    countdown: number;
    // the race clock, or your time once you're over the line
    clockMs: number;
    place: number;
    standings: Array<{
        place: number;
        name: string;
        you: boolean;
        finishMs: number | null;
        gone: boolean;
    }>;
};

const lapsLabel = (laps: number) => (laps === 1 ? '1 lap' : `${laps} laps`);

// the places, in the column with the leaderboards
export const RaceStandings = ({ race }: { race: RaceHud }) => (
    <div className="race-hud-board race-standings">
        <h4>
            {race.phase === 'countdown' ? 'On the grid' : 'Race'}
            <span>{lapsLabel(race.laps)}</span>
        </h4>
        <ol>
            {race.standings.map((entry) => (
                <li key={`${entry.place}-${entry.name}`} className={entry.you ? 'you' : ''}>
                    <span>
                        {entry.place}. {entry.name}
                    </span>
                    <span>
                        {entry.finishMs !== null
                            ? formatTime(entry.finishMs)
                            : entry.gone
                              ? 'left'
                              : race.phase === 'countdown'
                                ? ''
                                : 'racing'}
                    </span>
                </li>
            ))}
        </ol>
    </div>
);

// the countdown over the grid, GO, the lap and place while racing, and the
// result once you're over the line
const LobbyRaceHud = ({ race }: { race: RaceHud }) => {
    const [go, setGo] = useState(false);
    const previous = useRef(race.phase);
    useEffect(() => {
        const was = previous.current;
        previous.current = race.phase;
        if (was !== 'countdown' || race.phase !== 'racing') return undefined;
        setGo(true);
        const timer = window.setTimeout(() => setGo(false), 1100);
        return () => window.clearTimeout(timer);
    }, [race.phase]);

    if (!race.entered) return null;
    const seconds = Math.ceil(race.countdown);
    const count = race.standings.length;
    return (
        <>
            {race.phase === 'countdown' && (
                <div className="race-countdown" data-prevent-click>
                    {seconds > 3 ? (
                        <>
                            <small>
                                {lapsLabel(race.laps)}, {count} on the grid
                            </small>
                            <strong className="race-countdown-ready">Get ready</strong>
                        </>
                    ) : (
                        <strong key={seconds}>{seconds}</strong>
                    )}
                </div>
            )}
            {go && (
                <div className="race-countdown go" data-prevent-click>
                    <strong>GO</strong>
                </div>
            )}
            {race.phase === 'racing' && (
                <div className="race-pill" data-prevent-click>
                    <span>
                        Lap {race.lap}/{race.laps}
                    </span>
                    <strong>
                        P{race.place}
                        <small>/{count}</small>
                    </strong>
                    <span>{formatTime(race.clockMs)}</span>
                </div>
            )}
            {race.phase === 'finished' && (
                <div className="race-result" data-prevent-click>
                    <h3>
                        Finished P{race.place}
                        <small> of {count}</small>
                    </h3>
                    <p>{formatTime(race.clockMs)}</p>
                    <RaceStandings race={race} />
                    <button
                        type="button"
                        onClick={() => eventBus.dispatch('race:lobbyRaceLeave', {})}
                    >
                        Back to free drive
                    </button>
                </div>
            )}
        </>
    );
};

export default LobbyRaceHud;
