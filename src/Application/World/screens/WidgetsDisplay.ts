import type { DisplayContext, RoomDisplay } from './types';
import { SCREEN_CSS_SIZE } from './types';

// placeholder until the widgets display lands (room/v2-displays)
export function createWidgetsDisplay(_ctx: DisplayContext): RoomDisplay {
    const root = document.createElement('div');
    root.className = 'room-display';
    Object.assign(root.style, {
        width: `${SCREEN_CSS_SIZE.m2.w}px`,
        height: `${SCREEN_CSS_SIZE.m2.h}px`,
        background: 'linear-gradient(135deg, #04121f, #000)',
    });
    return { root, setVisible() {}, setFocused() {}, dispose: () => root.remove() };
}
