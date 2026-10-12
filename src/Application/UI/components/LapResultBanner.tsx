import React, { useEffect, useState } from 'react';
import eventBus from '../EventBus';
import { formatTime } from './RaceHudGauges';
import { lapVerdict, type LapResult } from '../../Racing/Leaderboard/lapResult';

// how long a lap's result stays up, ms (the fade is in style.css)
const SHOW_MS = 7000;

// a lap's result once it's in, top middle: its time, a new best or how far
// off yours, and where your best is on the board it went on
const LapResultBanner = () => {
    const [result, setResult] = useState<LapResult | null>(null);

    useEffect(() => {
        const onResult = (next: LapResult) => {
            if (next && Number.isFinite(next.lapTimeMs)) setResult(next);
        };
        eventBus.on('race:lapResult', onResult);
        return () => eventBus.remove('race:lapResult', onResult);
    }, []);

    useEffect(() => {
        if (!result) return undefined;
        const timer = window.setTimeout(() => setResult(null), SHOW_MS);
        return () => window.clearTimeout(timer);
    }, [result]);

    if (!result) return null;
    const verdict = lapVerdict(result, formatTime);
    return (
        <div className={`lap-result ${verdict.tone}`} role="status" key={result.id} data-prevent-click>
            <span className="lap-result-time">{formatTime(result.lapTimeMs)}</span>
            <strong>{verdict.title}</strong>
            <small>{verdict.detail}</small>
        </div>
    );
};

export default LapResultBanner;
