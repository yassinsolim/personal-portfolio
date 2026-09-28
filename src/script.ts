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
