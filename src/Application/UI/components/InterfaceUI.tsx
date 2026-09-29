import React, { useEffect, useRef, useState } from 'react';
import UIEventBus from '../EventBus';

interface InterfaceUIProps {}

const InterfaceUI: React.FC<InterfaceUIProps> = ({}) => {
    const [initLoad, setInitLoad] = useState(true);
    const [visible, setVisible] = useState(false);
    const [loading, setLoading] = useState(true);
    const interfaceRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        UIEventBus.on('loadingScreenDone', () => {
            setLoading(false);
        });

        // find element by id and set ref
        const element = document.getElementById('ui-interactive');
        if (element) {
            // @ts-ignore
            interfaceRef.current = element;
        }
    }, []);

    const initMouseDownHandler = () => {
        setVisible(true);
        setInitLoad(false);
    };

    useEffect(() => {
        if (!loading && initLoad) {
            document.addEventListener('mousedown', initMouseDownHandler);
            return () => {
                document.removeEventListener('mousedown', initMouseDownHandler);
            };
        }
    }, [loading, initLoad]);

    useEffect(() => {
        UIEventBus.on('enterMonitor', () => {
            setVisible(false);
            setInitLoad(false);
            if (interfaceRef.current) {
                interfaceRef.current.style.pointerEvents = 'none';
            }
        });
        UIEventBus.on('leftMonitor', () => {
            setVisible(true);
            if (interfaceRef.current) {
                interfaceRef.current.style.pointerEvents = 'auto';
            }
        });
    }, []);

    return !loading ? (
        <div
            style={Object.assign(
                {},
                styles.wrapper,
                visible ? styles.visible : styles.hide
            )}
            className="interface-wrapper"
            id="prevent-click"
        />
    ) : (
        <></>
    );
};

interface StyleSheetCSS {
    [key: string]: React.CSSProperties;
}

const styles: StyleSheetCSS = {
    wrapper: {
        width: '100%',
        display: 'flex',
        position: 'absolute',
        boxSizing: 'border-box',
    },
    visible: {
        opacity: 1,
        transform: 'translateX(0)',
        transition: 'opacity 0.5s ease-out 0.3s, transform 0.5s ease-out 0.3s',
    },
    hide: {
        opacity: 0,
        transform: 'translateX(-32px)',
        transition: 'opacity 0.3s ease-out, transform 0.3s ease-out',
    },
};

export default InterfaceUI;
