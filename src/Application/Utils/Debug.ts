import type GUI from 'lil-gui';

export default class Debug {
    active: boolean;
    ui: GUI | undefined;
    // lil-gui is only downloaded with #debug
    ready: Promise<GUI | undefined>;

    constructor() {
        this.active = window.location.hash === '#debug';
        this.ready = this.active
            ? import('lil-gui').then(({ GUI: Panel }) => (this.ui = new Panel()))
            : Promise.resolve(undefined);
    }
}
