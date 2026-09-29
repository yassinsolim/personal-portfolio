import type { DisplayContext, TerminalDisplay } from './types';
import { SCREEN_CSS_SIZE } from './types';

// placeholder until the terminal display lands (room/v2-displays)
export function createTerminalDisplay(_ctx: DisplayContext): TerminalDisplay {
    const root = document.createElement('div');
    root.className = 'room-display';
    Object.assign(root.style, {
        width: `${SCREEN_CSS_SIZE.m3.w}px`,
        height: `${SCREEN_CSS_SIZE.m3.h}px`,
        background: '#000',
        color: '#7ee787',
        font: '28px monospace',
        padding: '40px',
        boxSizing: 'border-box',
    });
    root.textContent = 'yassin@room:~$';
    return {
        root,
        setVisible() {},
        setFocused() {},
        dispose: () => root.remove(),
        appendLog: (line) => root.append(document.createElement('br'), line),
        setMode() {},
    };
}
