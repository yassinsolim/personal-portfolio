import './style.css';

import Application from './Application/Application';
import { createUI } from './Application/UI/App';
import { isWebGLAvailable } from './Application/Utils/webgl';

const webgl = isWebGLAvailable();
if (!webgl) {
    createUI();
}

// builds and runs itself from its constructor (a singleton)
export const application = webgl ? new Application() : null;

// ?roomDisplays=preview: the room's m2 and m3 displays at true size over the
// site, with a stand-in context. its own chunk, fetched only under the flag
if (
    new URLSearchParams(window.location.search).get('roomDisplays') ===
    'preview'
) {
    void import('./Application/World/screens/preview').then(
        ({ mountDisplaysPreview }) => mountDisplaysPreview(application)
    );
}
