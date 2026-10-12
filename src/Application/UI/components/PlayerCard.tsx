import React, { useEffect, useMemo, useState } from 'react';
import eventBus from '../EventBus';
import { carOptionsById } from '../../carOptions';
import { carThumb } from './CarPicker';
import { formatTime } from './RaceHudGauges';
import PlayerBadge from './PlayerBadge';
import { CarStats, PiBadge, setupLines, type LapEntry } from './LapCard';
import { FINISHES, type GarageState } from './Garage';
import { decodeLook } from '../../Racing/Garage/garage';
import type { PlayerProfile } from '../../Racing/Profile/profile';

type DriftBest = { score: number; lapTimeMs: number; carId: string } | null;

type PlayerState = {
    id: string;
    player: PlayerProfile | null;
    laps: LapEntry[];
    drift: DriftBest;
    offline: boolean;
};

// a car with a setup's numbers, as RaceManager works them out (the index
// comes a moment later)
type BuildState = {
    carId: string;
    tune: string;
    stats: GarageState['stats'];
    pending: boolean;
};

type Props = {
    playerId: string;
    mine: boolean;
    // this device's own profile, for its card when the database doesn't have
    // it (offline, or not saved yet)
    local: PlayerProfile | null;
    // a lap's card is open over this one
    covered: boolean;
    // a setup can go on your car (not in a lobby race)
    canUse: boolean;
    onUse: (carId: string, tune: string) => void;
    onLap: (entry: LapEntry) => void;
    onEdit: () => void;
    onClose: () => void;
};

const label = (carId: string) => carOptionsById[carId]?.label || carId;

const since = (iso: string) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};

// the paint, wheels and colored parts a look code holds, for the card
const lookParts = (code: string) => {
    if (!code) return null;
    const look = decodeLook(code);
    const finish = FINISHES.find(([id]) => id === look.finish)?.[1];
    return {
        paint: look.paint,
        finish: look.finish !== 'stock' ? finish : null,
        wheels: look.wheels !== 'stock' ? label(look.wheels) : null,
        rims: look.rims,
        calipers: look.calipers,
    };
};

const Swatch = ({ color }: { color: string }) => (
    <i className="player-swatch" style={{ background: color }} aria-hidden="true" />
);

// a driver's card: their badge, bio and number, the car they show off with
// how they set it up and what that makes it (and their other cars, the
// setup to put on yours), and their fastest laps, each opening its own card
const PlayerCard = ({ playerId, mine, local, covered, canUse, onUse, onLap, onEdit, onClose }: Props) => {
    const [state, setState] = useState<PlayerState | null>(null);
    const [shownCar, setShownCar] = useState<string | null>(null);
    const [build, setBuild] = useState<BuildState | null>(null);
    // the car whose setup went on yours
    const [used, setUsed] = useState<string | null>(null);

    useEffect(() => {
        setState(null);
        setShownCar(null);
        const onState = (next: PlayerState) => {
            if (next?.id === playerId) setState(next);
        };
        eventBus.on('race:playerState', onState);
        eventBus.dispatch('race:playerOpen', { id: playerId });
        return () => eventBus.remove('race:playerState', onState);
    }, [playerId]);

    useEffect(() => {
        if (covered) return undefined;
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            onClose();
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [covered, onClose]);

    const player = state?.player || (mine && state ? local : null);
    const laps = state?.laps || [];
    const garageCars = useMemo(() => {
        if (!player) return [];
        const cars = Object.keys(player.garage);
        if (player.car && !cars.includes(player.car)) cars.unshift(player.car);
        return cars.sort((a, b) => (a === player.car ? -1 : b === player.car ? 1 : label(a).localeCompare(label(b))));
    }, [player]);
    const car = shownCar || player?.car || garageCars[0] || null;
    const codes = car && player ? player.garage[car] || { look: '', tune: '' } : null;
    const tune = codes?.tune || '';
    const setup = useMemo(() => setupLines(tune), [tune]);
    const look = useMemo(() => lookParts(codes?.look || ''), [codes?.look]);
    const name = player?.name || laps[0]?.name || 'Driver';

    useEffect(() => {
        setBuild(null);
        if (!car) return undefined;
        const onBuild = (next: BuildState) => {
            if (next?.carId === car && next.tune === tune) setBuild(next);
        };
        eventBus.on('race:buildState', onBuild);
        eventBus.dispatch('race:buildOpen', { carId: car, tune });
        return () => eventBus.remove('race:buildState', onBuild);
    }, [car, tune]);

    return (
        <div
            className={`lap-card player-card${covered ? ' covered' : ''}`}
            role="dialog"
            aria-label={`${name}'s profile`}
            data-prevent-click
        >
            <header>
                <div className="player-card-who">
                    {player ? (
                        <PlayerBadge
                            avatar={player.avatar}
                            color={player.color}
                            name={player.name}
                            number={player.number}
                            size={56}
                        />
                    ) : (
                        <span className="player-badge player-badge-empty" style={{ width: 56, height: 56 }} />
                    )}
                    <div>
                        <p>
                            {player?.number !== null && player?.number !== undefined ? `#${player.number} · ` : ''}
                            {player && since(player.createdAt) ? `Driving since ${since(player.createdAt)}` : mine ? 'You' : 'Driver'}
                        </p>
                        <h3>{state ? name : 'Loading'}</h3>
                    </div>
                </div>
                {laps[0] ? <strong className="lap-card-time">{formatTime(laps[0].lapTimeMs)}</strong> : null}
            </header>
            {player?.bio ? <p className="player-card-bio">{player.bio}</p> : null}
            {state && !player && (
                <p className="lap-card-note">
                    {state.offline ? 'The board is offline, so their profile can’t be loaded.' : 'This driver has no profile yet.'}
                </p>
            )}

            <div className="lap-card-body">
                <section>
                    <h4>{mine ? 'The car you show off' : 'Their car'}</h4>
                    {car ? (
                        <>
                            <div className="lap-card-car">
                                <img src={carThumb(car)} alt="" width={96} height={54} />
                                <div>
                                    <strong>{label(car)}</strong>
                                    <span>
                                        {setup.length
                                            ? `Tuned, ${setup.length} change${setup.length === 1 ? '' : 's'}`
                                            : 'Factory setup'}
                                    </span>
                                </div>
                                <PiBadge stats={build?.stats} />
                            </div>
                            {build ? (
                                <CarStats stats={build.stats} />
                            ) : (
                                <p className="lap-card-note">Loading the car</p>
                            )}
                            {look && (look.paint || look.finish || look.wheels || look.rims || look.calipers) ? (
                                <dl className="lap-card-setup player-look">
                                    {(look.paint || look.finish) && (
                                        <>
                                            <dt>Paint</dt>
                                            <dd>
                                                {look.paint && <Swatch color={look.paint} />}
                                                {[look.paint?.toUpperCase(), look.finish].filter(Boolean).join(', ')}
                                            </dd>
                                        </>
                                    )}
                                    {look.wheels && (
                                        <>
                                            <dt>Wheels</dt>
                                            <dd>From the {look.wheels}</dd>
                                        </>
                                    )}
                                    {look.rims && (
                                        <>
                                            <dt>Rims</dt>
                                            <dd>
                                                <Swatch color={look.rims} />
                                                {look.rims.toUpperCase()}
                                            </dd>
                                        </>
                                    )}
                                    {look.calipers && (
                                        <>
                                            <dt>Calipers</dt>
                                            <dd>
                                                <Swatch color={look.calipers} />
                                                {look.calipers.toUpperCase()}
                                            </dd>
                                        </>
                                    )}
                                </dl>
                            ) : null}
                            <h4>Setup</h4>
                            {setup.length ? (
                                <dl className="lap-card-setup">
                                    {setup.map(([line, value]) => (
                                        <React.Fragment key={line}>
                                            <dt>{line}</dt>
                                            <dd>{value}</dd>
                                        </React.Fragment>
                                    ))}
                                </dl>
                            ) : (
                                <p className="lap-card-note">As it left the factory.</p>
                            )}
                            {used === car && (
                                <p className="lap-card-note">
                                    On your {label(car)} now. Your paint and wheels stay.
                                </p>
                            )}
                            {garageCars.length > 1 && (
                                <>
                                    <h4>Garage</h4>
                                    <div className="player-garage">
                                        {garageCars.map((id) => (
                                            <button
                                                type="button"
                                                key={id}
                                                className={id === car ? 'on' : ''}
                                                onClick={() => setShownCar(id)}
                                            >
                                                <img src={carThumb(id)} alt="" width={48} height={27} loading="lazy" />
                                                <span>{label(id)}</span>
                                            </button>
                                        ))}
                                    </div>
                                </>
                            )}
                        </>
                    ) : (
                        <p className="lap-card-note">{state ? 'No car picked yet.' : 'Loading'}</p>
                    )}
                </section>
                <section>
                    <h4>Fastest laps</h4>
                    {laps.length ? (
                        <ol className="player-laps">
                            {laps.map((lap) => (
                                <li key={lap.id}>
                                    <button type="button" onClick={() => onLap(lap)} title="The lap: car, setup and replay">
                                        <strong>{formatTime(lap.lapTimeMs)}</strong>
                                        <span>{label(lap.carId)}</span>
                                        <em>{lap.tune ? 'Tuned' : 'Stock'}</em>
                                    </button>
                                </li>
                            ))}
                        </ol>
                    ) : (
                        <p className="lap-card-note">{state ? 'No laps on the board yet.' : 'Loading'}</p>
                    )}
                    {state?.drift ? (
                        <>
                            <h4>Drift park</h4>
                            <dl className="lap-card-stats">
                                <dt>Best run</dt>
                                <dd>{Math.round(state.drift.score).toLocaleString('en-US')} points</dd>
                                <dt>Car</dt>
                                <dd>{label(state.drift.carId)}</dd>
                            </dl>
                        </>
                    ) : null}
                </section>
            </div>

            <footer>
                {mine && (
                    <button type="button" className="race-menu-primary" onClick={onEdit}>
                        Edit your profile
                    </button>
                )}
                {!mine && car && setup.length > 0 && (
                    <button
                        type="button"
                        className="race-menu-primary"
                        disabled={!canUse || used === car}
                        title="Its tune, aero and ride height on your car. Your paint and wheels stay"
                        onClick={() => {
                            onUse(car, tune);
                            setUsed(car);
                        }}
                    >
                        {used === car ? 'Setup loaded' : `Use their ${label(car)} setup`}
                    </button>
                )}
                <button type="button" onClick={onClose}>
                    Close <kbd>Esc</kbd>
                </button>
            </footer>
        </div>
    );
};

export default PlayerCard;
