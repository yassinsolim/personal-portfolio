import React, { useEffect, useMemo, useState } from 'react';
import eventBus from '../EventBus';
import { carOptions } from '../../carOptions';
import { carThumb } from './CarPicker';
import { formatTime } from './RaceHudGauges';
import { decodeTune, STOCK_BRAKE_BIAS } from '../../Racing/Garage/garage';
import { ENGINES } from '../../Racing/Garage/engines';
import type { ReplaySummary } from '../../Racing/Ghost/replayStats';
import {
    BRAKES,
    EXHAUSTS,
    INDUCTIONS,
    SPOILERS,
    SWAPS,
    TIRES,
    TOP_LIMIT,
    WEIGHTS,
    signed,
    type GarageState,
} from './Garage';

export type LapEntry = {
    id: string;
    name: string;
    lapTimeMs: number;
    carId: string;
    createdAt: string;
    source: 'local' | 'remote';
    tune?: string;
};

// what RaceManager works out for the card: the setup's numbers (the index
// comes a moment later), the replay's, and the ring's length to measure it by
type LapState = {
    id: string;
    stats: GarageState['stats'];
    pending: boolean;
    replay: ReplaySummary | null;
    ringM: number;
};

type Props = {
    entry: LapEntry;
    // its place on the board, 0 when it isn't in the list
    rank: number;
    board: 'stock' | 'tuned';
    outline: number[][];
    canWatch: boolean;
    // it's the ghost you race now
    racing: boolean;
    onWatch: () => void;
    onRace: () => void;
    onClose: () => void;
};

const nameOf = <T extends string>(list: Array<[T, string, ...string[]]>, value: T) =>
    list.find(([key]) => key === value)?.[1] || value;

// a board code in the garage's words: what it changes from the factory
export const setupLines = (code: string | undefined): Array<[string, string]> => {
    const shared = code ? decodeTune(code) : null;
    if (!shared) return [];
    const { tune } = shared;
    const lines: Array<[string, string]> = [];
    if (tune.engine !== 'stock') lines.push(['Engine', ENGINES[tune.engine]?.label || tune.engine]);
    if (tune.induction !== 'stock') lines.push(['Induction', nameOf(INDUCTIONS, tune.induction)]);
    if (tune.exhaust !== 'stock') lines.push(['Exhaust', nameOf(EXHAUSTS, tune.exhaust)]);
    if (tune.power !== 1) lines.push(['Engine map', `${Math.round(tune.power * 100)}%`]);
    if (tune.tires !== 'sport') lines.push(['Tires', nameOf(TIRES, tune.tires)]);
    if (tune.weight !== 'stock') lines.push(['Weight reduction', nameOf(WEIGHTS, tune.weight)]);
    if (tune.drivetrain !== 'stock') lines.push(['Drivetrain', nameOf(SWAPS, tune.drivetrain)]);
    if (tune.brakes !== 'stock') {
        const pressure = tune.brakePressure !== 1 ? `, ${Math.round(tune.brakePressure * 100)}% pressure` : '';
        lines.push(['Brakes', `${nameOf(BRAKES, tune.brakes)}${pressure}`]);
    }
    if (Math.abs(tune.brakeBias - STOCK_BRAKE_BIAS) > 1e-6) {
        lines.push(['Brake bias', `${Math.round(tune.brakeBias * 100)}% front`]);
    }
    const sliders: Array<[string, number]> = [
        ['Front springs', tune.springsFront],
        ['Rear springs', tune.springsRear],
        ['Dampers', tune.damping],
        ['Differential', tune.diff],
        ['Final drive', tune.gearing],
    ];
    sliders.forEach(([name, value]) => {
        if (value) lines.push([name, signed(value)]);
    });
    if (shared.spoiler === 'wing') {
        lines.push(['Rear spoiler', `${nameOf(SPOILERS, 'wing')}, ${Math.round(8 + 6 * shared.wingAngle)}°`]);
    } else if (shared.spoiler !== 'none') {
        lines.push(['Rear spoiler', nameOf(SPOILERS, shared.spoiler)]);
    }
    if (shared.ride) lines.push(['Ride height', `${shared.ride > 0 ? '+' : ''}${(shared.ride * 3).toFixed(1)} cm`]);
    if (!tune.speedLimiter) lines.push(['Speed limiter', 'Removed']);
    if (tune.angleKit) lines.push(['Angle kit', 'Fitted']);
    return lines;
};

const SIZE = 200;
const PAD = 8;

// the ring, and the line the lap's replay took over it
const LapMap = ({ outline, path }: { outline: number[][]; path: Array<[number, number]> | null }) => {
    const view = useMemo(() => {
        if (outline.length < 3) return null;
        let minX = Infinity;
        let maxX = -Infinity;
        let minZ = Infinity;
        let maxZ = -Infinity;
        outline.forEach(([x, z]) => {
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minZ = Math.min(minZ, z);
            maxZ = Math.max(maxZ, z);
        });
        const scale = (SIZE - PAD * 2) / Math.max(maxX - minX, maxZ - minZ);
        const offsetX = (SIZE - (maxX - minX) * scale) / 2;
        const offsetZ = (SIZE - (maxZ - minZ) * scale) / 2;
        const line = (points: number[][]) =>
            points
                .map(([x, z], i) =>
                    `${i ? 'L' : 'M'}${(offsetX + (x - minX) * scale).toFixed(1)} ${(offsetZ + (z - minZ) * scale).toFixed(1)}`
                )
                .join(' ');
        return { track: `${line(outline)} Z`, lap: path && path.length > 1 ? line(path) : null };
    }, [outline, path]);
    if (!view) return null;
    return (
        <svg className="lap-map" viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden>
            <path d={view.track} className="track" />
            {view.lap && <path d={view.lap} className="lap" />}
        </svg>
    );
};

const dateOf = (iso: string) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
        ? ''
        : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

// a lap on the board: who set it, the car and setup with the garage's
// numbers for it, its line on the map, and its replay to watch or to race
const LapCard = ({ entry, rank, board, outline, canWatch, racing, onWatch, onRace, onClose }: Props) => {
    const [state, setState] = useState<LapState | null>(null);
    const car = carOptions.find((option) => option.id === entry.carId);
    const lines = useMemo(() => setupLines(entry.tune), [entry.tune]);

    useEffect(() => {
        setState(null);
        const onState = (next: LapState) => {
            if (next?.id === entry.id) setState(next);
        };
        eventBus.on('race:lapState', onState);
        eventBus.dispatch('race:lapOpen', {
            id: entry.id,
            name: entry.name,
            lapTimeMs: entry.lapTimeMs,
            carId: entry.carId,
            tune: entry.tune,
        });
        return () => eventBus.remove('race:lapState', onState);
    }, [entry.id]);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            onClose();
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [onClose]);

    const stats = state?.stats;
    const replay = state?.replay;
    // a lap that's shorter than the ring didn't go all the way round
    const length = state?.ringM || 0;
    const partial = replay && length > 0 && replay.distanceM < length * 0.9;

    return (
        <div className="lap-card" role="dialog" aria-label={`${entry.name}'s lap`} data-prevent-click>
            <header>
                <div>
                    <p>
                        {rank > 0 ? `#${rank} ${board === 'tuned' ? 'tuned' : 'stock'}` : board === 'tuned' ? 'Tuned' : 'Stock'}
                        {dateOf(entry.createdAt) ? ` · ${dateOf(entry.createdAt)}` : ''}
                    </p>
                    <h3>{entry.name}</h3>
                </div>
                <strong className="lap-card-time">{formatTime(entry.lapTimeMs)}</strong>
            </header>

            <div className="lap-card-car">
                <img src={carThumb(entry.carId)} alt="" width={96} height={54} />
                <div>
                    <strong>{car?.label || entry.carId}</strong>
                    <span>{lines.length ? `Tuned, ${lines.length} change${lines.length === 1 ? '' : 's'}` : 'Factory setup'}</span>
                </div>
                {stats?.rating ? (
                    <div className={`garage-pi pi-${stats.rating.class.toLowerCase()}`} title="Performance index">
                        <strong>{stats.rating.class}</strong>
                        <span>{stats.rating.pi}</span>
                    </div>
                ) : null}
            </div>

            <div className="lap-card-body">
                <section>
                    <h4>The car</h4>
                    {stats ? (
                        <dl className="lap-card-stats">
                            <dt>Power</dt>
                            <dd>{stats.powerKw.toLocaleString('en-US')} kW</dd>
                            <dt>Torque</dt>
                            <dd>{stats.torqueNm.toLocaleString('en-US')} Nm</dd>
                            <dt>Weight</dt>
                            <dd>{stats.massKg.toLocaleString('en-US')} kg</dd>
                            <dt>Grip</dt>
                            <dd>{stats.grip.toFixed(2)} g</dd>
                            <dt>Top speed</dt>
                            <dd>
                                {stats.topKph} km/h <small>({TOP_LIMIT[stats.topLimitedBy]})</small>
                            </dd>
                            <dt>100-0 km/h</dt>
                            <dd>{stats.stop100} m</dd>
                        </dl>
                    ) : (
                        <p className="lap-card-note">Loading the car</p>
                    )}
                    {state?.pending && <p className="lap-card-note">Working out the performance index</p>}
                    <h4>Setup</h4>
                    {lines.length ? (
                        <dl className="lap-card-setup">
                            {lines.map(([name, value]) => (
                                <React.Fragment key={name}>
                                    <dt>{name}</dt>
                                    <dd>{value}</dd>
                                </React.Fragment>
                            ))}
                        </dl>
                    ) : (
                        <p className="lap-card-note">As it left the factory.</p>
                    )}
                </section>
                <section>
                    <h4>The lap</h4>
                    <LapMap outline={outline} path={replay?.path || null} />
                    {state && !replay && <p className="lap-card-note">No replay was saved with this lap.</p>}
                    {replay && (
                        <dl className="lap-card-stats">
                            <dt>Top speed</dt>
                            <dd>{replay.topKph} km/h</dd>
                            <dt>Driven</dt>
                            <dd>{(replay.distanceM / 1000).toFixed(1)} km</dd>
                        </dl>
                    )}
                    {partial && (
                        <p className="lap-card-warn">
                            Its replay only covers {(replay!.distanceM / 1000).toFixed(1)} of the ring&apos;s{' '}
                            {(length / 1000).toFixed(1)} km.
                        </p>
                    )}
                </section>
            </div>

            <footer>
                <button
                    type="button"
                    className="race-menu-primary"
                    disabled={!canWatch || !replay}
                    onClick={onWatch}
                >
                    Watch the lap
                </button>
                <button type="button" disabled={!replay || racing} onClick={onRace}>
                    {racing ? 'Racing this ghost' : 'Race this ghost'}
                </button>
                <button type="button" onClick={onClose}>
                    Close <kbd>Esc</kbd>
                </button>
            </footer>
        </div>
    );
};

export default LapCard;
