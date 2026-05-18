import UIEventBus from '../UI/EventBus';
import EventEmitter from './EventEmitter';

export default class Time extends EventEmitter {
    start: number;
    current: number;
    elapsed: number;
    delta: number;

    constructor() {
        super();

        // Setup
        this.start = performance.now();
        this.current = this.start;
        this.elapsed = 0;
        this.delta = 16;

        window.requestAnimationFrame(() => {
            this.tick();
        });

        UIEventBus.on('loadingScreenDone', () => {
            this.start = performance.now();
            this.current = this.start;
            this.delta = 16;
        });

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                this.current = performance.now();
                this.delta = 16;
            }
        });
    }

    tick() {
        const currentTime = performance.now();
        this.delta = Math.min(50, Math.max(0, currentTime - this.current));
        this.current = currentTime;
        this.elapsed = this.current - this.start;

        this.trigger('tick');

        window.requestAnimationFrame(() => {
            this.tick();
        });
    }
}
