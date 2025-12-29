import './style.css';

import Application from './Application/Application';
import { createUI } from './Application/UI/App';
import { isWebGLAvailable } from './Application/Utils/webgl';

if (!isWebGLAvailable()) {
    createUI();
} else {
    new Application();
}
