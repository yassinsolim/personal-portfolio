import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import LoadingScreen from './components/LoadingScreen';
import InterfaceUI from './components/InterfaceUI';
import eventBus from './EventBus';
import { carOptions, getStoredCarId, storeCarId } from '../carOptions';
import './style.css';

const App = () => {
    const [loading, setLoading] = useState(true);
    const [showHint, setShowHint] = useState(false);
    const [selectedCar, setSelectedCar] = useState(() => getStoredCarId());
    const [freeCamActive, setFreeCamActive] = useState(false);
    const [driveActive, setDriveActive] = useState(false);
    const [driveView, setDriveView] = useState<'first' | 'third'>('third');
    const [driveStats, setDriveStats] = useState<{
        speedKph: number;
        gear: string | number;
        rpm: number;
    }>({
        speedKph: 0,
        gear: 1,
        rpm: 900,
    });
    const [trackName, setTrackName] = useState<string | null>(null);
    const [startLights, setStartLights] = useState<{
        active: boolean;
        lightsOn: number;
        go: boolean;
    }>({ active: false, lightsOn: 0, go: false });

    useEffect(() => {
        eventBus.on('loadingScreenDone', () => {
            setLoading(false);
            setShowHint(true);
        });
    }, []);

    useEffect(() => {
        eventBus.on('driveMode', (data) => {
            const active = Boolean(data?.active);
            setDriveActive(active);
            if (active) {
                setFreeCamActive(false);
            }
        });
        eventBus.on('driveView', (data) => {
            if (data?.mode) {
                setDriveView(data.mode);
            }
        });
        eventBus.on('driveStats', (data) => {
            if (!data) return;
            setDriveStats({
                speedKph: data.speedKph || 0,
                gear: data.gear ?? 1,
                rpm: data.rpm || 0,
            });
        });
        eventBus.on('driveStartLights', (data) => {
            setStartLights({
                active: Boolean(data?.active),
                lightsOn: data?.lightsOn ?? 0,
                go: Boolean(data?.go),
            });
        });
        eventBus.on('trackReady', (data) => {
            if (data?.name) {
                setTrackName(data.name);
            }
        });
    }, []);

    const handleCarChange = (
        event: React.ChangeEvent<HTMLSelectElement>
    ) => {
        const nextCar = event.target.value;
        setSelectedCar(nextCar);
        storeCarId(nextCar);
        eventBus.dispatch('carChange', nextCar);
    };

    const handleViewToggle = () => {
        const nextState = !freeCamActive;
        setFreeCamActive(nextState);
        eventBus.dispatch('freeCamToggle', nextState);
    };

    const handleDriveToggle = () => {
        eventBus.dispatch(driveActive ? 'driveExit' : 'driveEnter', {});
    };

    const handleDriveViewToggle = () => {
        const nextMode = driveView === 'third' ? 'first' : 'third';
        eventBus.dispatch('driveViewToggle', { mode: nextMode });
    };

    return (
        <div id="ui-app">
            <LoadingScreen />
            {(startLights.active || startLights.go) && (
                <div
                    className={`start-lights ${
                        startLights.go ? 'go' : ''
                    }`}
                    data-prevent-click
                >
                    <div className="lights-row">
                        {Array.from({ length: 5 }).map((_, index) => (
                            <span
                                key={`light-${index}`}
                                className={`light ${
                                    startLights.lightsOn > index ? 'on' : ''
                                }`}
                            />
                        ))}
                    </div>
                    <div className="lights-label">
                        {startLights.go ? 'GO' : 'READY'}
                    </div>
                </div>
            )}
            {showHint && (
                <div className="look-hint">
                    <div>
                        Click anywhere to begin.
                    </div>
                    <div>
                        Visit the inner OS{' '}
                        <a
                            href="https://os.yassin.app"
                            rel="noreferrer noopener"
                            target="_blank"
                        >
                            yassinOS!
                        </a>
                    </div>
                    <div className="drive-panel" data-prevent-click>
                        <div>
                            {trackName
                                ? `Track: ${trackName}`
                                : 'Track: loading...'}
                        </div>
                        {!driveActive ? (
                            <div>
                                Click the car to enter the race. WASD to drive.
                            </div>
                        ) : (
                            <div>
                                WASD to drive. Automatic gears.
                            </div>
                        )}
                        <div className="drive-controls" data-prevent-click>
                            <button type="button" onClick={handleDriveToggle}>
                                {driveActive ? 'Exit race' : 'Enter race'}
                            </button>
                            <button
                                type="button"
                                onClick={handleDriveViewToggle}
                                disabled={!driveActive}
                            >
                                {driveView === 'third'
                                    ? 'First person'
                                    : 'Third person'}
                            </button>
                        </div>
                        {driveActive && (
                            <div className="drive-hud" data-prevent-click>
                                <span className="hud-pill">
                                    {Math.round(driveStats.speedKph)} km/h
                                </span>
                                <span className="hud-pill">
                                    Gear {driveStats.gear}
                                </span>
                                <span className="hud-pill">
                                    {Math.round(driveStats.rpm)} rpm
                                </span>
                            </div>
                        )}
                    </div>
                    {!driveActive && (
                        <div className="car-switcher" data-prevent-click>
                            <label htmlFor="car-switcher">Car</label>
                            <select
                                id="car-switcher"
                                value={selectedCar}
                                onChange={handleCarChange}
                            >
                                {carOptions.map((car) => (
                                    <option key={car.id} value={car.id}>
                                        {car.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}
                    {!driveActive && (
                        <div className="view-toggle" data-prevent-click>
                            <button type="button" onClick={handleViewToggle}>
                                {freeCamActive
                                    ? 'Exit look around'
                                    : 'Look around'}
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

const createUI = () => {
    ReactDOM.render(<App />, document.getElementById('ui'));
};

const createVolumeUI = () => {
    ReactDOM.render(
        <InterfaceUI />,
        document.getElementById('ui-interactive')
    );
};

export { createUI, createVolumeUI };
