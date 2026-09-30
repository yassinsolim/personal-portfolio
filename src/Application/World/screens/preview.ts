// ?roomDisplays=preview: m2 and m3 side by side at their true css size, in a
// fixed overlay over the site, run by a stand-in context. script.ts loads
// this only under that flag, so the site's own path doesn't change.
//   &mode=boot|shell  start m3 there (default: boot, shell once the site loads)
//   &focus=m2|m3      focus one of them
//   &lap=<ms>|none    the best lap m2 shows (default: this browser's local one)
// window.__roomDisplays has the displays and the context, for scripts
// (scripts/room/display-shots.mjs)
import UIEventBus from '../../UI/EventBus';
import { assetUrl } from '../../Utils/assetUrl';
import { currentStage, type LoadStage } from '../../Utils/loadStages';
import { createTerminalDisplay } from './TerminalDisplay';
import { createWidgetsDisplay } from './WidgetsDisplay';
import {
    SCREEN_CSS_SIZE,
    type DisplayContext,
    type OsState,
    type RoomTheme,
    type ScreenId,
} from './types';

type Site = {
    renderer?: { graphicsInfo?: () => Record<string, unknown> };
} | null;

// where the race keeps this browser's best lap (Racing/Ghost/GhostReplay.ts).
// local storage only, never the online leaderboard
const GHOST_KEY = 'yassinverse:nordschleife:ghost:v6';
const GAP = 40;

const localBestLap = () => {
    try {
        const saved = JSON.parse(localStorage.getItem(GHOST_KEY) || 'null');
        return saved && saved.bestLapTimeMs > 0
            ? Number(saved.bestLapTimeMs)
            : null;
    } catch {
        return null;
    }
};

const loadTheme = async (): Promise<RoomTheme> => {
    try {
        const response = await fetch(assetUrl('textures/room/room-theme.json'));
        return response.ok ? ((await response.json()) as RoomTheme) : {};
    } catch {
        return {};
    }
};

const styled = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    css: string,
    text?: string
) => {
    const node = document.createElement(tag);
    node.style.cssText = css;
    if (text !== undefined) node.textContent = text;
    return node;
};

export async function mountDisplaysPreview(site: Site) {
    const params = new URLSearchParams(window.location.search);
    const theme = await loadTheme();
    const lapParam = params.get('lap');
    let lap: number | null =
        lapParam === 'none'
            ? null
            : Number(lapParam) > 0
              ? Number(lapParam)
              : localBestLap();
    let os: OsState = { apps: [], focused: null };
    let focus: ScreenId | null = null;

    const overlay = styled(
        'div',
        'position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;background:#000;color:#ccc;font:13px/18px system-ui,sans-serif;'
    );
    overlay.className = 'room-display-preview';
    // the room camera toggles its view on any mousedown outside these
    overlay.setAttribute('data-prevent-click', '');
    const toolbar = styled(
        'div',
        'flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:8px 12px;background:#111;border-bottom:1px solid #333;'
    );
    const status = styled('span', 'margin-left:auto;color:#888;');
    const toast = styled('span', 'color:#8cc8ff;min-width:260px;');
    const stage = styled(
        'div',
        'position:relative;flex:1;min-height:0;overflow:hidden;'
    );
    const row = styled(
        'div',
        `position:absolute;left:0;top:0;display:flex;align-items:flex-start;gap:${GAP}px;padding:20px;transform-origin:0 0;`
    );
    stage.append(row);
    overlay.append(toolbar, stage);

    const say = (text: string) => {
        toast.textContent = text;
        console.info('[room displays]', text);
    };

    // what the yassinOS bridge would report back
    const setOs = (state: OsState) => {
        os = state;
        UIEventBus.dispatch('yassinos:state', os);
    };

    const ctx: DisplayContext = {
        theme,
        openInOS(app, url) {
            const pid = url ? `${app}__${url}` : app;
            say(
                `openInOS(${JSON.stringify(app)}${url ? `, ${JSON.stringify(url)}` : ''})`
            );
            setOs({
                apps: os.apps.indexOf(pid) < 0 ? [...os.apps, pid] : os.apps,
                focused: pid,
            });
            // the room would move the camera to m1
            setFocus(null);
        },
        showInOS(app, url) {
            const pid = url ? `${app}__${url}` : app;
            say(
                `showInOS(${JSON.stringify(app)}${url ? `, ${JSON.stringify(url)}` : ''})`
            );
            setOs({
                apps: os.apps.indexOf(pid) < 0 ? [...os.apps, pid] : os.apps,
                focused: pid,
            });
            return true;
        },
        graphicsInfo() {
            try {
                return site?.renderer?.graphicsInfo?.() || {};
            } catch {
                return {};
            }
        },
        on<T>(event: string, callback: (payload: T) => void) {
            UIEventBus.on<T>(event, callback);
            return () => UIEventBus.remove<T>(event, callback);
        },
        osState: () => os,
        startRace() {
            say('startRace()');
        },
        bestLapMs: () => lap,
        focus(target) {
            say(`focus(${JSON.stringify(target)})`);
            setFocus(target);
        },
    };

    const m2 = createWidgetsDisplay(ctx);
    const m3 = createTerminalDisplay(ctx);
    const displays: Record<'m2' | 'm3', typeof m2> = { m2, m3 };
    const shown: Record<'m2' | 'm3', boolean> = { m2: true, m3: true };
    let m3Mode: 'boot' | 'shell' = 'boot';

    for (const id of ['m2', 'm3'] as const) {
        const frame = styled(
            'div',
            'flex:none;display:flex;flex-direction:column;gap:8px;'
        );
        const size = SCREEN_CSS_SIZE[id];
        const label = styled(
            'div',
            // a whole pixel tall, so the display below sits on the pixel grid
            'height:18px;line-height:18px;color:#777;',
            `${id} ${size.w} x ${size.h}`
        );
        frame.append(label, displays[id].root);
        row.append(frame);
    }

    const setFocus = (target: ScreenId | null) => {
        focus = target === 'm2' || target === 'm3' ? target : null;
        m2.setFocused(focus === 'm2');
        m3.setFocused(focus === 'm3');
        refresh();
    };
    const setMode = (next: 'boot' | 'shell') => {
        m3Mode = next;
        m3.setMode(next);
        refresh();
    };
    const setShown = (id: 'm2' | 'm3', value: boolean) => {
        shown[id] = value;
        displays[id].setVisible(value);
        refresh();
    };

    const refresh = () => {
        status.textContent = `m3 ${m3Mode}, focus ${focus || 'none'}, visible m2 ${shown.m2} m3 ${shown.m3}`;
    };

    const fit = () => {
        const width = 1600 + 900 + GAP + 40;
        const height = 1600 + 26 + 40;
        const scale = Math.min(
            1,
            stage.clientWidth / width,
            stage.clientHeight / height
        );
        row.style.transform = `scale(${scale})`;
    };

    const tool = (text: string, action: () => void) => {
        const node = styled(
            'button',
            'padding:4px 10px;background:#222;color:#ddd;border:1px solid #444;border-radius:4px;font:inherit;cursor:pointer;',
            text
        );
        node.type = 'button';
        node.addEventListener('click', action);
        toolbar.append(node);
        return node;
    };
    tool('Focus m2', () => setFocus('m2'));
    tool('Focus m3', () => setFocus('m3'));
    tool('Unfocus', () => setFocus(null));
    tool('m3 boot', () => setMode('boot'));
    tool('m3 shell', () => setMode('shell'));
    tool('Hide or show m2', () => setShown('m2', !shown.m2));
    tool('Hide or show m3', () => setShown('m3', !shown.m3));
    tool('Log burst', () => {
        const kinds = ['info', 'ok', 'warn', 'dim'] as const;
        for (let i = 1; i <= 1000; i++)
            m3.appendLog(`burst line ${i} of 1000`, kinds[i % 4]);
        say('appendLog x 1000 (the terminal keeps 400)');
    });
    tool('Test lap', () => {
        lap = 492345;
        UIEventBus.dispatch('race:lapCompleted', {
            lapTimeMs: lap,
            carId: 'amg-one',
        });
        say('race:lapCompleted 8:12.345 (test value)');
    });
    tool('Show the site', () => {
        overlay.style.visibility = 'hidden';
        window.setTimeout(() => (overlay.style.visibility = ''), 2500);
    });
    toolbar.append(toast, status);

    // until the room has a loader of its own, the boot log is the site's
    // real loading, as it happens under the overlay
    let lastStage = '';
    const onStage = (event: LoadStage) => {
        const key = `${event.scope}:${event.stage}:${event.done}`;
        if (key === lastStage || m3Mode !== 'boot') return;
        lastStage = key;
        m3.appendLog(
            `${event.scope} ${event.stage}${event.done ? ' done' : ''}`,
            event.done ? 'ok' : 'dim'
        );
        if (
            event.scope === 'homepage' &&
            event.stage === 'ready' &&
            event.done &&
            params.get('mode') !== 'boot'
        )
            window.setTimeout(() => setMode('shell'), 1500);
    };
    UIEventBus.on('load:stage', onStage);
    UIEventBus.on(
        'loadedSource',
        (data: { sourceName?: string; loaded?: number; toLoad?: number }) => {
            if (m3Mode === 'boot')
                m3.appendLog(
                    `loaded ${data.sourceName} (${data.loaded}/${data.toLoad})`
                );
        }
    );
    UIEventBus.on('failedSource', (data: { sourceName?: string }) => {
        if (m3Mode === 'boot')
            m3.appendLog(`failed ${data.sourceName}`, 'warn');
    });
    m3.appendLog(
        'yassin.app boot log (preview: the site loading under this overlay)',
        'dim'
    );
    const stageNow = currentStage('homepage');
    if (stageNow) onStage(stageNow);

    document.body.appendChild(overlay);
    window.addEventListener('resize', fit);
    fit();
    if (params.get('mode') === 'shell') setMode('shell');
    const focusParam = params.get('focus');
    if (focusParam === 'm2' || focusParam === 'm3') setFocus(focusParam);
    refresh();

    (window as Window & { __roomDisplays?: unknown }).__roomDisplays = {
        m2,
        m3,
        ctx,
        setFocus,
        setMode,
        setShown,
        setOs,
        setLap(ms: number | null) {
            lap = ms;
        },
    };
}
