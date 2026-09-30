import BezierEasing from 'bezier-easing';
import Application from '../../Application';
import { CameraKey } from '../../Camera/Camera';
import UIEventBus from '../../UI/EventBus';
import { isReturningVisitor, mark, prefersReducedMotion } from '../../UI/loaders/variant';
import { HYBRID } from '../../UI/loaders/hybridConfig';

// the hybrid loading screen's camera: from the first frame it sits on the
// room's terminal screen (screens.dockPose(), m3 filling the view), so the
// log the loader writes there is what the visitor reads while the room
// assembles around it. when loading is done it pulls back to the idle view
// and the same screen carries on as the room's live terminal. the pipeline's
// last stages follow the pull-back's progress (intro:pullback), so the room
// is live the frame the camera settles

// the last stages ride the pull-back, so these also set when the room is
// fully drawn: about when the old catch-up finished (650 and 500 ms after
// the release), plus a frame or two
const PULLBACK_MS = 850;
const PULLBACK_FAST_MS = 650;
// a soft start off the screen, most of the distance early, a long settle
const PULLBACK_EASE = BezierEasing(0.45, 0, 0.2, 1);
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
            // the stages hold until the cut, which happens behind the black
            let cut = false;
            UIEventBus.dispatch('intro:pullback', { progress: () => (cut ? 1 : 0) });
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
                    cut = true;
                    fade.style.opacity = '0';
                    window.setTimeout(() => {
                        fade.remove();
                        arrive();
                    }, FADE_MS + 30);
                }, FADE_MS);
            });
            return;
        }
        // tween.js times the move with performance.now() too, from start()
        const ms = isReturningVisitor() ? PULLBACK_FAST_MS : PULLBACK_MS;
        const start = performance.now();
        UIEventBus.dispatch('intro:pullback', {
            progress: () => PULLBACK_EASE(Math.min(1, (performance.now() - start) / ms)),
        });
        camera.transition(CameraKey.IDLE, ms, PULLBACK_EASE, arrive);
    }
}
