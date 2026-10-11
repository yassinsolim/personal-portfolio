import React, { useEffect, useMemo, useRef, useState } from 'react';
import eventBus from '../EventBus';
import { carOptions, carOptionsById } from '../../carOptions';
import { carThumb } from './CarPicker';
import { formatTime } from './RaceHudGauges';
import PlayerBadge, { NAMELESS_COLOR } from './PlayerBadge';
import { setupLines, type LapEntry } from './LapCard';
import { sameBoardQuery, type BoardQuery } from '../../Racing/Leaderboard/boardQuery';
import type { PlayerBadge as Badge } from '../../Racing/Profile/profile';

type DriftRow = {
    id: string;
    name: string;
    score: number;
    lapTimeMs: number;
    carId: string;
    createdAt: string;
    source: 'local' | 'remote';
    playerId?: string | null;
    player?: Badge | null;
};

type BoardList = BoardQuery & {
    entries: Array<LapEntry | DriftRow>;
    // your best lap when it's further down than the list
    mine: { entry: LapEntry; rank: number } | null;
};

type Props = {
    track: 'ring' | 'drift';
    board: 'stock' | 'tuned';
    myId: string | null;
    onBoard: (board: 'stock' | 'tuned') => void;
    onLap: (entry: LapEntry, rank: number) => void;
    onPlayer: (id: string) => void;
};

const CARS = [...carOptions].sort((a, b) => a.label.localeCompare(b.label));

const formatGap = (ms: number) => {
    const total = Math.max(0, Math.round(ms));
    const minutes = Math.floor(total / 60000);
    const seconds = ((total % 60000) / 1000).toFixed(3);
    return minutes ? `+${minutes}:${seconds.padStart(6, '0')}` : `+${seconds}`;
};

const carLabel = (carId: string) => carOptionsById[carId]?.label || carId;

// who set it: their badge and name, which opens their card. this device's
// own laps that aren't on the board yet are yours too
const Driver = ({
    entry,
    mine,
    myId,
    onPlayer,
}: {
    entry: LapEntry | DriftRow;
    mine: boolean;
    myId: string | null;
    onPlayer: (id: string) => void;
}) => {
    const badge = entry.player;
    const name = badge?.name || entry.name;
    const id = entry.playerId || (entry.source === 'local' ? myId : null);
    const inner = (
        <>
            <PlayerBadge
                avatar={badge?.avatar || 'initials'}
                color={badge?.color || NAMELESS_COLOR}
                name={name}
                number={badge?.number ?? null}
                size={24}
            />
            <span>{name}</span>
            {mine && <em>You</em>}
        </>
    );
    return id ? (
        <button type="button" className="pmb-driver" title={`${name}'s profile`} onClick={() => onPlayer(id)}>
            {inner}
        </button>
    ) : (
        <span className="pmb-driver" title="No profile behind this one">
            {inner}
        </span>
    );
};

// the pause menu's board: the top laps on the ring (stock or tuned, every
// car or one) or the drift park's runs, each driver's badge opening their
// card and each lap its own. your best is under the list when it's lower
const BoardTab = ({ track, board, myId, onBoard, onLap, onPlayer }: Props) => {
    const [query, setQuery] = useState<BoardQuery>(() => ({ track, board, carId: null }));
    const [list, setList] = useState<BoardList | null>(null);
    const current = useRef(query);
    current.current = query;

    useEffect(() => {
        const onList = (next: BoardList) => {
            if (next && sameBoardQuery(next, current.current)) setList(next);
        };
        eventBus.on('race:boardList', onList);
        return () => {
            eventBus.remove('race:boardList', onList);
            eventBus.dispatch('race:boardClose', {});
        };
    }, []);

    useEffect(() => {
        eventBus.dispatch('race:boardRequest', query);
    }, [query]);

    const shown = list && sameBoardQuery(list, query) ? list : null;
    const entries = shown?.entries || [];
    const leader = entries[0]?.lapTimeMs || 0;
    const isMine = (entry: LapEntry | DriftRow) =>
        entry.source === 'local' || Boolean(myId && entry.playerId === myId);
    const setups = useMemo(
        () => new Map(entries.map((entry) => [entry.id, setupLines((entry as LapEntry).tune).length])),
        [entries]
    );

    const pick = (next: Partial<BoardQuery>) => {
        const merged = { ...query, ...next };
        if (next.board && next.board !== query.board) onBoard(next.board);
        setQuery(merged);
    };

    const lapRow = (entry: LapEntry, rank: number) => {
        const changes = setups.get(entry.id) ?? setupLines(entry.tune).length;
        return (
            <li key={entry.id} className={isMine(entry) ? 'me' : ''}>
                <span className="pmb-rank">{rank || '-'}</span>
                <Driver entry={entry} mine={isMine(entry)} myId={myId} onPlayer={onPlayer} />
                <button
                    type="button"
                    className="pmb-lap"
                    title="The lap: car, setup and replay"
                    onClick={() => onLap(entry, rank)}
                >
                    <img src={carThumb(entry.carId)} alt="" width={40} height={22} loading="lazy" />
                    <span className="pmb-car">{carLabel(entry.carId)}</span>
                    <span className="pmb-setup">
                        {entry.tune ? `Tuned${changes ? `, ${changes} change${changes === 1 ? '' : 's'}` : ''}` : 'Stock'}
                    </span>
                    <strong>{formatTime(entry.lapTimeMs)}</strong>
                    <span className="pmb-gap">{rank === 1 || !leader ? '' : formatGap(entry.lapTimeMs - leader)}</span>
                </button>
            </li>
        );
    };

    return (
        <div className="pmb">
            <div className="pmb-filters">
                <div className="pm-choice">
                    {(
                        [
                            ['ring', 'Nordschleife'],
                            ['drift', 'Drift park'],
                        ] as const
                    ).map(([id, label]) => (
                        <button
                            type="button"
                            key={id}
                            className={query.track === id ? 'on' : ''}
                            onClick={() => pick({ track: id })}
                        >
                            {label}
                        </button>
                    ))}
                </div>
                {query.track === 'ring' && (
                    <>
                        <div className="pm-choice">
                            {(
                                [
                                    ['stock', 'Stock'],
                                    ['tuned', 'Tuned'],
                                ] as const
                            ).map(([id, label]) => (
                                <button
                                    type="button"
                                    key={id}
                                    className={query.board === id ? 'on' : ''}
                                    onClick={() => pick({ board: id })}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                        <select
                            className="pm-select"
                            aria-label="Car"
                            value={query.carId || ''}
                            onChange={(event) => pick({ carId: event.target.value || null })}
                        >
                            <option value="">Every car</option>
                            {CARS.map((car) => (
                                <option key={car.id} value={car.id}>
                                    {car.label}
                                </option>
                            ))}
                        </select>
                    </>
                )}
                <span className="pmb-hint">
                    {query.track === 'ring'
                        ? 'Verified laps. A name opens the driver, a lap its car and replay.'
                        : 'Best drift runs. A name opens the driver.'}
                </span>
            </div>

            {!shown ? (
                <p className="pm-note pmb-empty">Loading the board</p>
            ) : entries.length === 0 ? (
                <p className="pm-note pmb-empty">
                    {query.track === 'drift'
                        ? 'No drift runs yet. Drift a full lap of the park to score.'
                        : query.carId
                          ? `No ${query.board} laps with the ${carLabel(query.carId)} yet.`
                          : 'No laps on this board yet.'}
                </p>
            ) : query.track === 'drift' ? (
                <ol className="pmb-list pmb-drift">
                    {(entries as DriftRow[]).map((entry, index) => (
                        <li key={entry.id} className={isMine(entry) ? 'me' : ''}>
                            <span className="pmb-rank">{index + 1}</span>
                            <Driver entry={entry} mine={isMine(entry)} myId={myId} onPlayer={onPlayer} />
                            <span className="pmb-run">
                                <img src={carThumb(entry.carId)} alt="" width={40} height={22} loading="lazy" />
                                <span className="pmb-car">{carLabel(entry.carId)}</span>
                                <span className="pmb-setup">{formatTime(entry.lapTimeMs)}</span>
                                <strong>{Math.round(entry.score).toLocaleString('en-US')}</strong>
                            </span>
                        </li>
                    ))}
                </ol>
            ) : (
                <ol className="pmb-list">
                    {(entries as LapEntry[]).map((entry, index) => lapRow(entry, index + 1))}
                </ol>
            )}

            {shown?.mine && query.track === 'ring' && (
                <ol className="pmb-list pmb-mine" aria-label="Your best">
                    {lapRow(shown.mine.entry, shown.mine.rank)}
                </ol>
            )}
        </div>
    );
};

export default BoardTab;
