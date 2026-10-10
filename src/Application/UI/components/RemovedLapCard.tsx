import React, { useEffect } from 'react';
import { carOptions } from '../../carOptions';
import { formatTime } from './RaceHudGauges';
import type { RemovedLap } from '../../Racing/Leaderboard/removedLaps';

// one of this device's laps was taken off the board: which one and why, once
const RemovedLapCard = ({ lap, onDone }: { lap: RemovedLap; onDone: () => void }) => {
    const car = carOptions.find((option) => option.id === lap.carId)?.label || lap.carId;

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' && event.key !== 'Enter') return;
            event.preventDefault();
            event.stopPropagation();
            onDone();
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [onDone]);

    return (
        <div className="race-name" data-prevent-click>
            <div className="race-name-card" role="alertdialog" aria-label="One of your laps was removed">
                <h3>We removed one of your laps</h3>
                <div className="race-removed-lap">
                    <strong>{formatTime(lap.lapTimeMs)}</strong>
                    <span>
                        {car}
                        {lap.tuned ? ', tuned' : ''}
                        {lap.name ? ` · ${lap.name}` : ''}
                    </span>
                </div>
                <p>{lap.reason}</p>
                <p>Laps you drive all the way round still count, so go set a real one.</p>
                <button type="button" className="race-menu-primary" onClick={onDone}>
                    Got it
                </button>
            </div>
        </div>
    );
};

export default RemovedLapCard;
