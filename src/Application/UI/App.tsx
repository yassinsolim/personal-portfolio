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
    const [raceModeActive, setRaceModeActive] = useState(false);

    useEffect(() => {
        eventBus.on('loadingScreenDone', () => {
            setLoading(false);
            setShowHint(true);
        });

        eventBus.on(
            'raceMode:changed',
            (state: { active?: boolean } | undefined) => {
                setRaceModeActive(Boolean(state?.active));
            }
        );
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

    const handleRaceToggle = () => {
        eventBus.dispatch(raceModeActive ? 'raceMode:exit' : 'raceMode:start', {
            fromUI: true,
        });
    };

    return (
        <div id="ui-app">
            <LoadingScreen />
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
                    <div className="view-toggle" data-prevent-click>
                        <button type="button" onClick={handleViewToggle}>
                            {freeCamActive ? 'Exit look around' : 'Look around'}
                        </button>
                    </div>
                    <div className="race-toggle" data-prevent-click>
                        <button type="button" onClick={handleRaceToggle}>
                            {raceModeActive
                                ? 'Exit race mode'
                                : 'Start Nordschleife race'}
                        </button>
                    </div>
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
