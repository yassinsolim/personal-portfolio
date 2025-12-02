import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import LoadingScreen from './components/LoadingScreen';
import InterfaceUI from './components/InterfaceUI';
import eventBus from './EventBus';
import './style.css';

const App = () => {
    const [loading, setLoading] = useState(true);
    const [showHint, setShowHint] = useState(false);

    useEffect(() => {
        eventBus.on('loadingScreenDone', () => {
            setLoading(false);
            setShowHint(true);
        });
    }, []);

    return (
        <div id="ui-app">
            <LoadingScreen />
            {showHint && (
                <div className="look-hint">
                    Click anywhere to begin. Right click to switch view.
                </div>
            )}
        </div>
    );
};

const createUI = () => {
    ReactDOM.render(<App />, document.getElementById('ui'));
};

const createVolumeUI = () => {
    ReactDOM.render(<InterfaceUI />, document.getElementById('ui-interactive'));
};

export { createUI, createVolumeUI };
