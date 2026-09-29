import TWEEN from '@tweenjs/tween.js';
import Application from '../../Application';
import { CameraKey } from '../../Camera/Camera';
import UIEventBus from '../../UI/EventBus';
import { isReturningVisitor, mark, prefersReducedMotion } from '../../UI/loaders/variant';
import { HYBRID } from '../../UI/loaders/hybridConfig';

// the hybrid loading screen's camera: from the first frame it sits on the
// room's terminal screen (screens.dockPose(), m3 filling the view), so the
// log the loader writes there is what the visitor reads while the room
// assembles around it. when loading is done it pulls back to the idle view
// and the same screen carries on as the room's live terminal

const PULLBACK_MS = 2400;
const PULLBACK_FAST_MS = 1400;
const FADE_MS = 220;

export default class M3Dock {
    application: Application;
    state: 'boot' | 'pullback' | 'done' = 'boot';

    constructor() {
        this.application = new Application();
        const camera = this.application.camera;
        camera.introLock = true;
        camera.externalControl = () => this.hold();
        UIEventBus.on('loadingScreenDone', (data?: { variant?: string }) => {
            if (data?.variant === 'hybrid') this.pullBack();
        });
    }

    private hold() {
        const camera = this.application.camera;
        const screens = this.application.world?.screens;
        if (!screens || !screens.get(HYBRID.dockTarget)) return;
        const pose = screens.dockPose(camera.getAspect());
        camera.instance.position.copy(pose.position);
        camera.instance.lookAt(pose.focal);
        camera.position.copy(pose.position);
        camera.focalPoint.copy(pose.focal);
    }

    private pullBack() {
        if (this.state !== 'boot') return;
        this.state = 'pullback';
        const camera = this.application.camera;
        camera.externalControl = null;
        camera.introLock = false;
        camera.currentKeyframe = undefined;
        const arrive = () => {
            this.state = 'done';
            mark('os');
            UIEventBus.dispatch('loader:showHint', {});
        };
        if (prefersReducedMotion()) {
            const fade = document.createElement('div');
            Object.assign(fade.style, {
                position: 'fixed',
                inset: '0',
                background: '#000',
                opacity: '0',
                zIndex: '50',
                pointerEvents: 'none',
                transition: `opacity ${FADE_MS}ms linear`,
            });
            document.body.appendChild(fade);
            requestAnimationFrame(() => {
                fade.style.opacity = '1';
                window.setTimeout(() => {
                    camera.transition(CameraKey.IDLE, 0);
                    fade.style.opacity = '0';
                    window.setTimeout(() => {
                        fade.remove();
                        arrive();
                    }, FADE_MS + 30);
                }, FADE_MS);
            });
            return;
        }
        camera.transition(
            CameraKey.IDLE,
            isReturningVisitor() ? PULLBACK_FAST_MS : PULLBACK_MS,
            TWEEN.Easing.Cubic.InOut,
            arrive
        );
    }
}
