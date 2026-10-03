import React, { useEffect, useRef, useState } from 'react';
import eventBus from '../EventBus';
import { carOptions } from '../../carOptions';
import {
    DRIFT_BUILD,
    LIMITS,
    STOCK_BRAKE_BIAS,
    STOCK_LOOK,
    STOCK_TUNE,
    isStockSetup,
} from '../../Racing/Garage/garage';
import type {
    CarLook,
    CarTune,
    Exhaust,
    Induction,
    PaintFinish,
    Spoiler,
    TireCompound,
} from '../../Racing/Garage/garage';
import { ENGINE_IDS, ENGINES, STOCK_ENGINE } from '../../Racing/Garage/engines';

export type GarageState = {
    carId: string;
    look: CarLook;
    tune: CarTune;
    calipers: boolean;
    // the rear spoilers this car's boot takes
    spoilers: Spoiler[];
    // the factory speed limiter in km/h, null when the car has none
    speedLimiter: number | null;
    tuned: boolean;
    stats: {
        powerKw: number;
        torqueNm: number;
        grip: number;
        topKph: number;
        topLimitedBy: 'limiter' | 'drag' | 'revs';
        downforce: number;
        brakeFront: number;
        rpmAt100: number;
    };
};

const TOP_LIMIT: Record<GarageState['stats']['topLimitedBy'], string> = {
    limiter: 'limited',
    drag: 'drag',
    revs: 'redline',
};

type Props = {
    state: GarageState | null;
    onClose: () => void;
    // back out of race mode to the room, the car dressed as it is now
    onHome: () => void;
};

type Tab = 'paint' | 'wheels' | 'body' | 'engine' | 'tuning';

const PAINTS = [
    '#f4f4f2',
    '#a9adb3',
    '#4a4e55',
    '#111214',
    '#c8102e',
    '#ff5a1f',
    '#ffc20e',
    '#2e8b3d',
    '#0b7d8c',
    '#1f4fa8',
    '#23305f',
    '#6b2d8f',
];
const RIMS = [
    '#e6e8ea',
    '#8a8f96',
    '#2f3236',
    '#0e0f10',
    '#b08d57',
    '#c8102e',
    '#1f4fa8',
];
const CALIPERS = [
    '#c8102e',
    '#ffc20e',
    '#1f4fa8',
    '#2e8b3d',
    '#e6e8ea',
    '#111214',
    '#ff5a1f',
];
const FINISHES: Array<[PaintFinish, string]> = [
    ['stock', 'Factory'],
    ['gloss', 'Gloss'],
    ['metallic', 'Metallic'],
    ['pearl', 'Pearl'],
    ['matte', 'Matte'],
    ['chrome', 'Chrome'],
];
const SPOILERS: Array<[Spoiler, string, string]> = [
    ['none', 'None', 'Factory body'],
    ['ducktail', 'Ducktail', 'A lip on the boot, a little rear downforce'],
    ['wing', 'GT wing', 'Real rear downforce, costs some top speed'],
];
const TIRES: Array<[TireCompound, string]> = [
    ['street', 'Street'],
    ['sport', 'Sport (stock)'],
    ['semi', 'Semi slick'],
    ['slick', 'Race slick'],
    ['drift', 'Drift'],
];
// rims that come from the other cars
const WHEELS = [
    'amg-one',
    'bmw-f90-m5-competition',
    'bmw-m8-competition-coupe',
    'mercedes-gt63s-edition-one',
    'amg-c63s-coupe',
    'bmw-e92-m3',
    'toyota-crown-platinum',
    'lamborghini-huracan',
    'lamborghini-aventador-s',
    'ferrari-laferrari',
    'mclaren-p1',
    'porsche-918-spyder',
    'bugatti-chiron-super-sport',
    'koenigsegg-jesko',
    'pagani-huayra',
    'mclaren-senna',
    'ferrari-sf90-stradale',
    'aston-martin-valkyrie',
    'toyota-supra-mk4',
];
const carName = (id: string) =>
    carOptions.find((car) => car.id === id)?.label || id;

const INDUCTIONS: Array<[Induction, string, string]> = [
    ['stock', 'Factory', 'As the engine left the factory'],
    ['na', 'Naturally aspirated', 'Turbos off: sharp, linear, a lot less power'],
    ['twin', 'Twin turbo', 'Big midrange once they spool'],
    ['quad', 'Quad turbo', 'Huge power up top, real lag below it'],
    ['super', 'Supercharger', 'Boost from idle and the blower whine'],
];
const EXHAUSTS: Array<[Exhaust, string]> = [
    ['stock', 'Factory'],
    ['sport', 'Sport'],
    ['straight', 'Straight pipe'],
];

const Swatches = ({
    colors,
    value,
    onPick,
    factory = 'Factory',
    disabled = false,
}: {
    colors: string[];
    value: string | null;
    onPick: (hex: string | null) => void;
    factory?: string;
    disabled?: boolean;
}) => (
    <div className={`garage-swatches ${disabled ? 'disabled' : ''}`}>
        <button
            type="button"
            className={`garage-factory ${value === null ? 'on' : ''}`}
            onClick={() => onPick(null)}
            disabled={disabled}
        >
            {factory}
        </button>
        {colors.map((hex) => (
            <button
                type="button"
                key={hex}
                className={`garage-swatch ${value === hex ? 'on' : ''}`}
                style={{ background: hex }}
                aria-label={hex}
                onClick={() => onPick(hex)}
                disabled={disabled}
            />
        ))}
        <label className="garage-custom" title="Any color">
            <input
                type="color"
                value={value || '#888888'}
                onChange={(e) => onPick(e.target.value)}
                disabled={disabled}
            />
            <span>Custom</span>
        </label>
    </div>
);

const Slider = ({
    label,
    value,
    min,
    max,
    step,
    left,
    right,
    format,
    onChange,
    stock,
}: {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    left?: string;
    right?: string;
    format: (value: number) => string;
    onChange: (value: number) => void;
    stock: number;
}) => (
    <div className="garage-slider">
        <div className="garage-slider-head">
            <span>{label}</span>
            <strong className={Math.abs(value - stock) > 1e-6 ? 'changed' : ''}>
                {format(value)}
            </strong>
        </div>
        <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
        />
        {(left || right) && (
            <div className="garage-slider-ends">
                <span>{left}</span>
                <span>{right}</span>
            </div>
        )}
    </div>
);

const signed = (value: number) =>
    `${value > 0 ? '+' : ''}${Math.round(value * 100)}`;

const Garage = ({ state, onClose, onHome }: Props) => {
    const [tab, setTab] = useState<Tab>('paint');
    const [look, setLook] = useState<CarLook>(state?.look || STOCK_LOOK);
    const [tune, setTune] = useState<CarTune>(state?.tune || STOCK_TUNE);
    const carId = state?.carId || '';
    const drag = useRef<{ x: number; y: number } | null>(null);

    // a car switch loads that car's own setup
    useEffect(() => {
        if (!state) return;
        setLook(state.look);
        setTune(state.tune);
    }, [state?.carId]);

    const apply = (nextLook: CarLook, nextTune: CarTune) => {
        setLook(nextLook);
        setTune(nextTune);
        eventBus.dispatch('race:garageApply', {
            look: nextLook,
            tune: nextTune,
            save: true,
        });
    };
    const setL = (patch: Partial<CarLook>) =>
        apply({ ...look, ...patch }, tune);
    const setT = (patch: Partial<CarTune>) =>
        apply(look, { ...tune, ...patch });

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.code !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            onClose();
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [onClose]);

    // hold W (or up) or the rev button to rev the engine on the stand
    const [revving, setRevving] = useState(false);
    const rev = (on: boolean) => {
        setRevving(on);
        eventBus.dispatch('race:garageRev', { on });
    };
    useEffect(() => {
        const keys = ['KeyW', 'ArrowUp'];
        const typing = () => {
            const el = document.activeElement as HTMLElement | null;
            return Boolean(el && (el.tagName === 'INPUT' || el.tagName === 'SELECT'));
        };
        const down = (event: KeyboardEvent) => {
            if (!keys.includes(event.code) || event.repeat || typing()) return;
            rev(true);
        };
        const up = (event: KeyboardEvent) => {
            if (keys.includes(event.code)) rev(false);
        };
        const off = () => rev(false);
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        window.addEventListener('blur', off);
        return () => {
            window.removeEventListener('keydown', down);
            window.removeEventListener('keyup', up);
            window.removeEventListener('blur', off);
            eventBus.dispatch('race:garageRev', { on: false });
        };
    }, []);

    const stockEngine = STOCK_ENGINE[carId] || '';
    const engineId = tune.engine === 'stock' ? stockEngine : tune.engine;
    const turbocharged = Boolean(ENGINES[engineId]?.turbo);

    const tuned = !isStockSetup(tune, look);
    const stats = state?.stats;

    return (
        <div className="garage" data-prevent-click>
            <div
                className="garage-stage"
                onPointerDown={(e) => {
                    drag.current = { x: e.clientX, y: e.clientY };
                    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                }}
                onPointerMove={(e) => {
                    if (!drag.current) return;
                    eventBus.dispatch('race:garageOrbit', {
                        dx: e.clientX - drag.current.x,
                        dy: e.clientY - drag.current.y,
                    });
                    drag.current = { x: e.clientX, y: e.clientY };
                }}
                onPointerUp={() => {
                    drag.current = null;
                }}
            >
                <div className="garage-title">
                    <h2>Garage</h2>
                    <p>{carName(carId)}</p>
                    <small>Drag to turn the car</small>
                </div>
            </div>
            <div className="garage-panel">
                <div className="garage-tabs">
                    {(['paint', 'wheels', 'body', 'engine', 'tuning'] as Tab[]).map(
                        (name) => (
                            <button
                                type="button"
                                key={name}
                                className={tab === name ? 'on' : ''}
                                onClick={() => setTab(name)}
                            >
                                {name[0].toUpperCase() + name.slice(1)}
                            </button>
                        )
                    )}
                </div>
                <div className="garage-body">
                    {tab === 'paint' && (
                        <>
                            <h4>Paint</h4>
                            <Swatches
                                colors={PAINTS}
                                value={look.paint}
                                onPick={(paint) => setL({ paint })}
                                factory="Factory color"
                            />
                            <h4>Finish</h4>
                            <div className="garage-options">
                                {FINISHES.map(([finish, label]) => (
                                    <button
                                        type="button"
                                        key={finish}
                                        className={
                                            look.finish === finish ? 'on' : ''
                                        }
                                        onClick={() => setL({ finish })}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                    {tab === 'wheels' && (
                        <>
                            <h4>Rims</h4>
                            <div className="garage-options wrap">
                                <button
                                    type="button"
                                    className={
                                        look.wheels === 'stock' ||
                                        look.wheels === carId
                                            ? 'on'
                                            : ''
                                    }
                                    onClick={() => setL({ wheels: 'stock' })}
                                >
                                    Factory
                                </button>
                                {WHEELS.filter((id) => id !== carId).map(
                                    (id) => (
                                        <button
                                            type="button"
                                            key={id}
                                            className={
                                                look.wheels === id ? 'on' : ''
                                            }
                                            onClick={() => setL({ wheels: id })}
                                        >
                                            {carName(id)}
                                        </button>
                                    )
                                )}
                            </div>
                            <h4>Rim color</h4>
                            <Swatches
                                colors={RIMS}
                                value={look.rims}
                                onPick={(rims) => setL({ rims })}
                            />
                            <h4>Calipers</h4>
                            <Swatches
                                colors={CALIPERS}
                                value={look.calipers}
                                onPick={(calipers) => setL({ calipers })}
                                disabled={!state?.calipers}
                            />
                            {!state?.calipers && (
                                <p className="garage-note">
                                    This car's calipers are part of the wheel
                                    texture, so they keep their color.
                                </p>
                            )}
                        </>
                    )}
                    {tab === 'body' && (
                        <>
                            <h4>Rear spoiler</h4>
                            <div className="garage-options column">
                                {SPOILERS.map(([spoiler, label, hint]) => {
                                    const fits =
                                        spoiler === 'none' ||
                                        !state ||
                                        state.spoilers.includes(spoiler);
                                    return (
                                        <button
                                            type="button"
                                            key={spoiler}
                                            className={
                                                look.spoiler === spoiler
                                                    ? 'on'
                                                    : ''
                                            }
                                            disabled={!fits}
                                            onClick={() => setL({ spoiler })}
                                        >
                                            <strong>{label}</strong>
                                            <small>
                                                {fits
                                                    ? hint
                                                    : "This car's tail has no lid to fit one"}
                                            </small>
                                        </button>
                                    );
                                })}
                            </div>
                            <Slider
                                label="Ride height"
                                value={look.ride}
                                min={LIMITS.ride[0]}
                                max={LIMITS.ride[1]}
                                step={0.1}
                                left="Slammed"
                                right="Raised"
                                stock={0}
                                format={(v) =>
                                    `${v > 0 ? '+' : ''}${(v * 3).toFixed(1)} cm`
                                }
                                onChange={(ride) => setL({ ride })}
                            />
                        </>
                    )}
                    {tab === 'engine' && (
                        <>
                            <h4>Engine</h4>
                            <div className="garage-options column">
                                {[stockEngine, ...ENGINE_IDS.filter((id) => id !== stockEngine)]
                                    .filter((id) => ENGINES[id])
                                    .map((id) => {
                                        const factory = id === stockEngine;
                                        const on = factory
                                            ? tune.engine === 'stock' || tune.engine === id
                                            : tune.engine === id;
                                        return (
                                            <button
                                                type="button"
                                                key={id}
                                                className={on ? 'on' : ''}
                                                onClick={() => setT({ engine: factory ? 'stock' : id })}
                                            >
                                                <strong>
                                                    {factory ? 'Factory: ' : ''}
                                                    {ENGINES[id].label}
                                                </strong>
                                                <small>{ENGINES[id].detail}</small>
                                            </button>
                                        );
                                    })}
                            </div>
                            <h4>Induction</h4>
                            <div className="garage-options column">
                                {INDUCTIONS.map(([induction, label, hint]) => {
                                    // what it already has is just the factory setup
                                    const same =
                                        (induction === 'na' && !turbocharged) ||
                                        (induction === 'twin' && turbocharged);
                                    return (
                                        <button
                                            type="button"
                                            key={induction}
                                            className={tune.induction === induction ? 'on' : ''}
                                            disabled={same}
                                            onClick={() => setT({ induction })}
                                        >
                                            <strong>{label}</strong>
                                            <small>{same ? 'That is how this engine comes' : hint}</small>
                                        </button>
                                    );
                                })}
                            </div>
                            <h4>Exhaust</h4>
                            <div className="garage-options">
                                {EXHAUSTS.map(([exhaust, label]) => (
                                    <button
                                        type="button"
                                        key={exhaust}
                                        className={tune.exhaust === exhaust ? 'on' : ''}
                                        onClick={() => setT({ exhaust })}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                    {(tab === 'engine' || tab === 'tuning') && (
                        <button
                            type="button"
                            className={`garage-rev ${revving ? 'on' : ''}`}
                            onPointerDown={(e) => {
                                (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                                rev(true);
                            }}
                            onPointerUp={() => rev(false)}
                            onPointerCancel={() => rev(false)}
                            onContextMenu={(e) => e.preventDefault()}
                        >
                            Hold to rev (or hold W)
                        </button>
                    )}
                    {tab === 'tuning' && (
                        <>
                            <div className="garage-options column">
                                <button
                                    type="button"
                                    className={
                                        tune.tires === 'drift' && tune.angleKit
                                            ? 'on'
                                            : ''
                                    }
                                    onClick={() => setT(DRIFT_BUILD)}
                                >
                                    <strong>Drift build</strong>
                                    <small>
                                        Drift tires, angle kit, locked diff,
                                        stiffer rear and shorter gears
                                    </small>
                                </button>
                            </div>
                            <Slider
                                label="Engine map"
                                value={tune.power}
                                min={LIMITS.power[0]}
                                max={LIMITS.power[1]}
                                step={0.01}
                                stock={1}
                                format={(v) => `${Math.round(v * 100)}%`}
                                onChange={(power) => setT({ power })}
                            />
                            <h4>Tires</h4>
                            <div className="garage-options wrap">
                                {TIRES.map(([tires, label]) => (
                                    <button
                                        type="button"
                                        key={tires}
                                        className={
                                            tune.tires === tires ? 'on' : ''
                                        }
                                        onClick={() => setT({ tires })}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                            <Slider
                                label="Front springs"
                                value={tune.springsFront}
                                min={-1}
                                max={1}
                                step={0.1}
                                left="Soft"
                                right="Stiff"
                                stock={0}
                                format={signed}
                                onChange={(springsFront) =>
                                    setT({ springsFront })
                                }
                            />
                            <Slider
                                label="Rear springs"
                                value={tune.springsRear}
                                min={-1}
                                max={1}
                                step={0.1}
                                left="Soft"
                                right="Stiff"
                                stock={0}
                                format={signed}
                                onChange={(springsRear) =>
                                    setT({ springsRear })
                                }
                            />
                            <Slider
                                label="Dampers"
                                value={tune.damping}
                                min={-1}
                                max={1}
                                step={0.1}
                                left="Soft"
                                right="Firm"
                                stock={0}
                                format={signed}
                                onChange={(damping) => setT({ damping })}
                            />
                            <Slider
                                label="Differential"
                                value={tune.diff}
                                min={-1}
                                max={1}
                                step={0.1}
                                left="Open"
                                right="Locked"
                                stock={0}
                                format={signed}
                                onChange={(diff) => setT({ diff })}
                            />
                            <Slider
                                label="Final drive"
                                value={tune.gearing}
                                min={-1}
                                max={1}
                                step={0.1}
                                left="Long"
                                right="Short"
                                stock={0}
                                format={signed}
                                onChange={(gearing) => setT({ gearing })}
                            />
                            <Slider
                                label="Brake bias"
                                value={tune.brakeBias}
                                min={LIMITS.brakeBias[0]}
                                max={LIMITS.brakeBias[1]}
                                step={0.01}
                                left="Rear"
                                right="Front"
                                stock={STOCK_BRAKE_BIAS}
                                format={(v) => `${Math.round(v * 100)}% front`}
                                onChange={(brakeBias) => setT({ brakeBias })}
                            />
                            <h4>Steering lock</h4>
                            <div className="garage-options">
                                <button
                                    type="button"
                                    className={tune.angleKit ? '' : 'on'}
                                    onClick={() => setT({ angleKit: false })}
                                >
                                    Stock
                                </button>
                                <button
                                    type="button"
                                    className={tune.angleKit ? 'on' : ''}
                                    onClick={() => setT({ angleKit: true })}
                                >
                                    Angle kit
                                </button>
                            </div>
                            {state?.speedLimiter ? (
                                <>
                                    <h4>Speed limiter</h4>
                                    <div className="garage-options">
                                        <button
                                            type="button"
                                            className={
                                                tune.speedLimiter ? 'on' : ''
                                            }
                                            onClick={() =>
                                                setT({ speedLimiter: true })
                                            }
                                        >
                                            {state.speedLimiter} km/h (stock)
                                        </button>
                                        <button
                                            type="button"
                                            className={
                                                tune.speedLimiter ? '' : 'on'
                                            }
                                            onClick={() =>
                                                setT({ speedLimiter: false })
                                            }
                                        >
                                            Removed
                                        </button>
                                    </div>
                                </>
                            ) : null}
                        </>
                    )}
                </div>
                {stats && (
                    <div className="garage-stats">
                        <div>
                            <span>Power</span>
                            <strong>{stats.powerKw} kW</strong>
                        </div>
                        <div>
                            <span>Torque</span>
                            <strong>{stats.torqueNm} Nm</strong>
                        </div>
                        <div>
                            <span>Grip</span>
                            <strong>{stats.grip.toFixed(2)} g</strong>
                        </div>
                        <div>
                            <span>Top speed ({TOP_LIMIT[stats.topLimitedBy]})</span>
                            <strong>{stats.topKph} km/h</strong>
                        </div>
                        <div>
                            <span>Downforce</span>
                            <strong>{stats.downforce.toFixed(2)}</strong>
                        </div>
                        <div>
                            <span>100 km/h in top</span>
                            <strong>{stats.rpmAt100.toLocaleString('en-US')} rpm</strong>
                        </div>
                    </div>
                )}
                <p className={`garage-board ${tuned ? 'tuned' : ''}`}>
                    {tuned
                        ? 'Tuned: your laps go on the tuned leaderboard.'
                        : 'Stock setup: your laps count on the stock leaderboard. Paint and wheels are only looks.'}
                </p>
                <div className="garage-actions">
                    <button
                        type="button"
                        onClick={() => apply(STOCK_LOOK, STOCK_TUNE)}
                    >
                        Reset to factory
                    </button>
                    <button type="button" onClick={onHome}>
                        Main screen
                    </button>
                    <button type="button" className="primary" onClick={onClose}>
                        Drive
                    </button>
                </div>
            </div>
        </div>
    );
};

export default Garage;
