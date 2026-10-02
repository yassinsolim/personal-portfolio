import React, { useEffect, useRef, useState } from 'react';
import { carOptions } from '../../carOptions';
import type { CarOption } from '../../carOptions';

type Props = {
    selected: string;
    // capable devices swap the room's car on every pick and stay open, so the
    // cars can be browsed in 3D; weak ones pick from the pictures and close
    live: boolean;
    onSelect: (carId: string) => void;
    onClose: () => void;
};

// classes by power to weight (kW per tonne)
const CLASSES = [
    { id: 'hyper', label: 'Hypercars', one: 'Hypercar', min: 380 },
    { id: 'super', label: 'Supercars', one: 'Supercar', min: 260 },
    { id: 'performance', label: 'Performance', one: 'Performance', min: 170 },
    { id: 'road', label: 'Road', one: 'Road', min: 0 },
];
const classOf = (car: CarOption) =>
    CLASSES.find((entry) => (car.race.physics.powerKw * 1000) / car.race.massKg >= entry.min) ||
    CLASSES[CLASSES.length - 1];
// quickest first
const BY_PACE = [...carOptions].sort(
    (a, b) =>
        a.race.zeroToHundredSec - b.race.zeroToHundredSec ||
        b.race.physics.powerKw - a.race.physics.powerKw
);
const FILTERS = [
    { id: 'all', label: 'All' },
    ...CLASSES.filter((entry) => BY_PACE.some((car) => classOf(car).id === entry.id)),
];
export const carThumb = (carId: string) => `images/cars/${carId}.webp`;

const CarPicker = ({ selected, live, onSelect, onClose }: Props) => {
    const [filter, setFilter] = useState('all');
    const grid = useRef<HTMLDivElement>(null);
    const cars = BY_PACE.filter((car) => filter === 'all' || classOf(car).id === filter);

    useEffect(() => {
        grid.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
    }, []);

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

    return (
        <div
            className={`car-picker${live ? ' live' : ''}`}
            role="dialog"
            aria-modal={!live}
            aria-label="Choose your car"
            data-prevent-click
        >
            <div className="car-picker-head">
                <strong>Choose your car</strong>
                <button type="button" className="car-picker-close" onClick={onClose}>
                    {live ? 'Done' : 'Close'}
                </button>
            </div>
            <div className="car-picker-filters" role="group" aria-label="Class">
                {FILTERS.map((entry) => (
                    <button
                        key={entry.id}
                        type="button"
                        className={filter === entry.id ? 'active' : ''}
                        aria-pressed={filter === entry.id}
                        onClick={() => setFilter(entry.id)}
                    >
                        {entry.label}
                    </button>
                ))}
            </div>
            <div className="car-picker-grid" ref={grid}>
                {cars.map((car) => (
                    <button
                        key={car.id}
                        type="button"
                        className={`car-card${car.id === selected ? ' selected' : ''}`}
                        aria-pressed={car.id === selected}
                        onClick={() => {
                            onSelect(car.id);
                            if (!live) onClose();
                        }}
                    >
                        <img src={carThumb(car.id)} alt="" loading="lazy" width={480} height={270} />
                        <span className="car-card-name">{car.label}</span>
                        <span className="car-card-class">{classOf(car).one}</span>
                        <span className="car-card-stats">
                            <span>
                                <b>{Math.round(car.race.physics.powerKw * 1.341)}</b> hp
                            </span>
                            <span>
                                <b>{car.race.zeroToHundredSec.toFixed(1)}</b> s 0-100
                            </span>
                            <span>
                                <b>{car.race.topSpeedKph}</b> km/h
                            </span>
                            <span>{car.race.drivetrain}</span>
                        </span>
                    </button>
                ))}
            </div>
        </div>
    );
};

export default CarPicker;
