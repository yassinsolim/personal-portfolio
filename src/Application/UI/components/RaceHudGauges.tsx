import React from 'react';

export type SectorHud = {
    index: number;
    current: number[];
    last: number[];
    best: number[];
    names: string[];
};

export type GhostHud = {
    kind: 'off' | 'best' | 'rival' | 'record';
    name?: string;
    lapTimeMs: number;
    carId: string;
};

const GHOST_LABEL: Record<GhostHud['kind'], string> = {
    off: 'Ghost',
    best: 'Your ghost',
    rival: 'Rival',
    record: 'Record',
};

type Props = {
    speedKph: number;
    gear: string;
    rpm: number;
    redlineRpm: number;
    tachMaxRpm?: number;
    lapTimeMs: number;
    lapRunning: boolean;
    // at the start, the clock waits at 0 for the car to move
    lapArmed?: boolean;
    lastLapMs: number;
    bestLapMs: number;
    // ms behind (positive) or ahead of the best lap at this point
    delta: number | null;
    dirty: boolean;
    lastDirty: boolean;
    ghost: GhostHud | null;
    sectors: SectorHud | null;
};

const formatTime = (ms: number) => {
    if (!(ms > 0)) return '--:--.---';
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const millis = Math.floor(ms % 1000);
    return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
};

const formatSplit = (ms: number) => {
    if (!(ms > 0)) return '--.---';
    const seconds = ms / 1000;
    if (seconds < 60) return seconds.toFixed(3);
    return formatTime(ms);
};

// the dial sweeps 270 degrees, zero at the bottom left
const SWEEP = 270;
const START = 135;
const polar = (cx: number, cy: number, r: number, deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
};
const arc = (cx: number, cy: number, r: number, from: number, to: number) => {
    const [x0, y0] = polar(cx, cy, r, from);
    const [x1, y1] = polar(cx, cy, r, to);
    const large = to - from > 180 ? 1 : 0;
    return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
};

const Tach = ({
    rpm,
    redlineRpm,
    tachMaxRpm,
    gear,
    speedKph,
}: {
    rpm: number;
    redlineRpm: number;
    tachMaxRpm?: number;
    gear: string;
    speedKph: number;
}) => {
    // each car's own dial range, red from its redline. without one the dial
    // runs a little past the redline, rounded to a whole thousand
    const max =
        tachMaxRpm && tachMaxRpm > redlineRpm
            ? tachMaxRpm
            : Math.ceil((redlineRpm + 500) / 1000) * 1000;
    const angle = (value: number) =>
        START + (Math.min(max, Math.max(0, value)) / max) * SWEEP;
    const ticks = [];
    for (let k = 0; k <= max; k += 1000) {
        const a = angle(k);
        const [x0, y0] = polar(80, 80, 66, a);
        const [x1, y1] = polar(80, 80, 58, a);
        const [tx, ty] = polar(80, 80, 47, a);
        ticks.push(
            <g key={k}>
                <line
                    x1={x0}
                    y1={y0}
                    x2={x1}
                    y2={y1}
                    className={k >= redlineRpm ? 'tick red' : 'tick'}
                />
                <text x={tx} y={ty + 3.5} className="tick-label">
                    {k / 1000}
                </text>
            </g>
        );
    }
    const [nx, ny] = polar(80, 80, 62, angle(rpm));
    const near = rpm > redlineRpm * 0.94;
    return (
        <svg
            className="race-tach"
            viewBox="0 0 160 160"
            aria-label={`${Math.round(rpm)} rpm`}
        >
            <path d={arc(80, 80, 66, START, START + SWEEP)} className="dial" />
            <path
                d={arc(80, 80, 66, angle(redlineRpm), START + SWEEP)}
                className="dial red"
            />
            <path
                d={arc(80, 80, 70, START, angle(rpm))}
                className={near ? 'fill near' : 'fill'}
            />
            {ticks}
            <line x1={80} y1={80} x2={nx} y2={ny} className="needle" />
            <circle cx={80} cy={80} r={4} className="hub" />
            <text x={80} y={104} className="gear">
                {gear}
            </text>
            <text x={80} y={128} className="speed">
                {Math.max(0, Math.round(speedKph))}
            </text>
            <text x={80} y={140} className="unit">
                km/h
            </text>
            <text x={80} y={60} className="unit">
                x1000 rpm
            </text>
        </svg>
    );
};

// green matches or beats the best for that sector, yellow is slower
const SectorChips = ({ sectors }: { sectors: SectorHud }) => (
    <div className="race-sectors">
        {[0, 1, 2].map((i) => {
            const done = sectors.current[i];
            const shown = done ?? sectors.last[i];
            const best = sectors.best[i];
            const live = i === sectors.index && done === undefined;
            let tone = '';
            if (done !== undefined && best > 0)
                tone = done <= best ? 'good' : 'slow';
            return (
                <div
                    key={i}
                    className={`race-sector ${tone} ${live ? 'live' : ''}`}
                    title={sectors.names[i]}
                >
                    <span>S{i + 1}</span>
                    <strong>{formatSplit(shown)}</strong>
                    {done !== undefined && best > 0 && (
                        <em>
                            {done <= best ? '-' : '+'}
                            {(Math.abs(done - best) / 1000).toFixed(3)}
                        </em>
                    )}
                </div>
            );
        })}
    </div>
);

const RaceHudGauges = (props: Props) => (
    <div className="race-gauges" data-prevent-click>
        <Tach
            rpm={props.rpm}
            redlineRpm={props.redlineRpm}
            tachMaxRpm={props.tachMaxRpm}
            gear={props.gear}
            speedKph={props.speedKph}
        />
        <div className="race-laps">
            <div className="race-lap-now">
                {props.lapRunning
                    ? formatTime(props.lapTimeMs)
                    : props.lapArmed
                      ? '0:00.000'
                      : '--:--.---'}
                {props.lapRunning && props.delta !== null && (
                    <span
                        className={`race-lap-delta ${props.delta <= 0 ? 'ahead' : 'behind'}`}
                    >
                        {props.delta <= 0 ? '-' : '+'}
                        {(Math.abs(props.delta) / 1000).toFixed(3)}
                    </span>
                )}
            </div>
            {props.lapRunning && props.dirty && (
                <div className="race-lap-dirty">
                    Track limits: this lap won't count
                </div>
            )}
            <div className="race-lap-row">
                <span>Last</span>
                <strong>
                    {formatTime(props.lastLapMs)}
                    {props.lastDirty && <em>dirty</em>}
                </strong>
            </div>
            <div className="race-lap-row">
                <span>Best</span>
                <strong>{formatTime(props.bestLapMs)}</strong>
            </div>
            {props.ghost && (
                <div className="race-lap-row">
                    <span>
                        {GHOST_LABEL[props.ghost.kind]}
                        {props.ghost.name ? `: ${props.ghost.name}` : ''}
                    </span>
                    <strong>{formatTime(props.ghost.lapTimeMs)}</strong>
                </div>
            )}
            {props.sectors && <SectorChips sectors={props.sectors} />}
        </div>
    </div>
);

export default RaceHudGauges;
