import './displays.css';
import { type DisplayContext, type OsState, type RoomDisplay } from './types';
import {
    appLabel,
    applyTheme,
    attempt,
    clockParts,
    el,
    formatLap,
    outlinePath,
    parseOutline,
    resolveTheme,
    subscribe,
    toOsState,
    type Themed,
} from './displayKit';
import { APPS, LINKS, NOW, TRACK, TRACK_OUTLINE } from './roomFacts';

// m2, the top screen: a clock, what yassin is doing now, the nordschleife
// and yassinOS on the main screen, with buttons that open apps there.
// updates only while visible: the clock once a minute, the rest on events

const SVG_NS = 'http://www.w3.org/2000/svg';
const TRACK_BOX = { w: 280, h: 206, pad: 10 };

let fallbackOutline: number[][] | null = null;

export function createWidgetsDisplay(ctx: DisplayContext): Themed<RoomDisplay> {
    let visible = true;
    let focused = false;
    let disposed = false;
    let clockTimer = 0;
    let outline: unknown[] | null = null;
    let drawnPath = '';

    // what the bridge last said, if osState() has nothing better
    const readOs = (known: OsState): OsState =>
        toOsState(attempt(() => ctx.osState(), null)) || known;
    const readLap = () => {
        const lap = attempt<number | null>(() => ctx.bestLapMs(), null);
        return typeof lap === 'number' && lap > 0 ? lap : null;
    };
    let os = readOs({ apps: [], focused: null });
    let lapMs = readLap();

    const root = el('div', 'room-display rd-widgets');
    root.dataset.screen = 'm2';
    // the room camera toggles its view on any mousedown outside these
    root.setAttribute('data-prevent-click', '');
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Widgets');
    root.tabIndex = -1;
    applyTheme(root, resolveTheme(ctx.theme), 'm2');

    const buttons: HTMLButtonElement[] = [];
    const button = (
        label: string,
        className: string,
        name: string,
        action: () => void
    ) => {
        const node = el(
            'button',
            `rd-btn${className ? ` ${className}` : ''}`,
            label
        );
        node.type = 'button';
        node.tabIndex = -1;
        node.setAttribute('aria-label', name);
        node.addEventListener('click', () => {
            if (focused && !disposed) attempt(action, undefined);
        });
        buttons.push(node);
        return node;
    };

    const card = (title: string, className: string) => {
        const section = el('section', `rd-card ${className}`);
        section.setAttribute('aria-label', title);
        const bar = el('header', 'rd-card-bar');
        bar.append(el('h2', 'rd-card-title', title));
        const body = el('div', 'rd-card-body');
        section.append(bar, body);
        return { section, body };
    };

    // the clock, straight on the wallpaper like the lock screen's
    const clock = el('section', 'rd-clock');
    clock.setAttribute('aria-label', 'Clock');
    const clockTime = el('time', 'rd-clock-time');
    const clockMain = el('span', 'rd-clock-main');
    const clockPeriod = el('span', 'rd-clock-period');
    const clockDate = el('div', 'rd-clock-date');
    clock.append(clockTime, clockDate);

    const now = card('Now', 'rd-now');
    const nowList = el('ul', 'rd-now-list');
    for (const item of NOW.items) nowList.append(el('li', '', item));
    now.body.append(
        el('div', 'rd-now-role', NOW.role),
        el('div', 'rd-now-since', NOW.since),
        nowList,
        el('div', 'rd-now-foot', NOW.school)
    );

    const race = card(TRACK.name, 'rd-race');
    race.body.classList.add('rd-race-body');
    const track = document.createElementNS(SVG_NS, 'svg');
    track.setAttribute('class', 'rd-track');
    track.setAttribute('viewBox', `0 0 ${TRACK_BOX.w} ${TRACK_BOX.h}`);
    track.setAttribute('aria-hidden', 'true');
    const trackGlow = document.createElementNS(SVG_NS, 'path');
    trackGlow.setAttribute('class', 'rd-track-glow');
    const trackLine = document.createElementNS(SVG_NS, 'path');
    trackLine.setAttribute('class', 'rd-track-line');
    const trackStart = document.createElementNS(SVG_NS, 'circle');
    trackStart.setAttribute('class', 'rd-track-start');
    trackStart.setAttribute('r', '7');
    track.append(trackGlow, trackLine, trackStart);
    const lapValue = el('div', 'rd-race-lap');
    const raceActions = el('div', 'rd-race-actions');
    raceActions.append(
        button('Race', 'rd-btn-primary', 'Race the Nordschleife', () =>
            ctx.startRace()
        ),
        el('span', 'rd-race-hint', 'or click the car')
    );
    const raceInfo = el('div', 'rd-race-info');
    raceInfo.append(
        el('div', 'rd-race-place', TRACK.place),
        el('div', 'rd-label', 'Your best lap'),
        lapValue,
        raceActions
    );
    race.body.append(track, raceInfo);

    const system = card('yassinOS', 'rd-os');
    const osApp = el('div', 'rd-os-app');
    const osDetail = el('div', 'rd-os-detail');
    const links = el('div', 'rd-os-links');
    for (const link of LINKS) {
        const target = APPS[link.key];
        links.append(
            button(
                link.label,
                '',
                `Open ${link.label} on the main screen`,
                () => ctx.openInOS(target.app, target.url)
            )
        );
    }
    system.body.append(
        el('div', 'rd-label', 'On the main screen'),
        osApp,
        osDetail,
        links
    );

    root.append(clock, now.section, race.section, system.section);

    const renderClock = () => {
        const parts = clockParts(new Date());
        clockMain.textContent = parts.time;
        clockPeriod.textContent = parts.period;
        // some locales put am/pm first
        const first = parts.periodFirst ? clockPeriod : clockMain;
        if (clockTime.firstChild !== first)
            clockTime.replaceChildren(
                first,
                first === clockMain ? clockPeriod : clockMain
            );
        clockTime.dateTime = parts.iso;
        clockDate.textContent = parts.date;
    };

    const renderRace = () => {
        if (!outline)
            fallbackOutline = fallbackOutline || parseOutline(TRACK_OUTLINE);
        const path = outlinePath(outline || fallbackOutline, TRACK_BOX);
        if (path && path.d !== drawnPath) {
            drawnPath = path.d;
            trackGlow.setAttribute('d', path.d);
            trackLine.setAttribute('d', path.d);
            trackStart.setAttribute('cx', String(path.start[0]));
            trackStart.setAttribute('cy', String(path.start[1]));
        }
        const lap = formatLap(lapMs);
        lapValue.textContent = lap || 'No lap yet';
        lapValue.classList.toggle('is-empty', !lap);
    };

    const renderOs = () => {
        const label = appLabel(os.focused);
        const others = os.apps.filter((pid) => pid !== os.focused).length;
        const windows = others === 1 ? 'window' : 'windows';
        osApp.textContent = label.title;
        osDetail.textContent = os.focused
            ? [label.detail, others ? `${others} more ${windows} open` : '']
                  .filter(Boolean)
                  .join(', ')
            : others
              ? `${others} ${windows} open`
              : 'Nothing open';
    };

    const render = () => {
        renderClock();
        renderRace();
        renderOs();
    };

    // events keep the state current while hidden, setVisible(true) draws it
    const update = (draw: () => void) => {
        if (visible && !disposed) draw();
    };

    const scheduleClock = () => {
        window.clearTimeout(clockTimer);
        clockTimer = 0;
        if (!visible || disposed) return;
        // just after the next minute turns
        clockTimer = window.setTimeout(
            () => {
                renderClock();
                scheduleClock();
            },
            60000 - (Date.now() % 60000) + 50
        );
    };

    const refreshLap = () => {
        lapMs = readLap();
        update(renderRace);
    };

    const offs = [
        subscribe<{ points?: unknown } | unknown[]>(
            ctx,
            'race:trackOutline',
            (payload) => {
                const points = Array.isArray(payload)
                    ? payload
                    : (payload as { points?: unknown } | null)?.points;
                if (!Array.isArray(points) || points.length < 3) return;
                outline = points;
                update(renderRace);
            }
        ),
        subscribe<unknown>(ctx, 'yassinos:state', (payload) => {
            os = toOsState(payload) || readOs(os);
            update(renderOs);
        }),
        subscribe(ctx, 'race:lapCompleted', refreshLap),
        subscribe(ctx, 'race:lapSubmitted', refreshLap),
        subscribe(ctx, 'raceMode:changed', refreshLap),
    ];

    render();
    scheduleClock();

    return {
        root,
        setVisible(next: boolean) {
            if (disposed || Boolean(next) === visible) return;
            visible = Boolean(next);
            if (visible) {
                // cheap reads, and whatever changed while it was frozen
                lapMs = readLap();
                os = readOs(os);
                render();
            }
            scheduleClock();
        },
        setFocused(next: boolean) {
            if (disposed) return;
            focused = Boolean(next);
            root.classList.toggle('is-focused', focused);
            for (const node of buttons) node.tabIndex = focused ? 0 : -1;
            const active = document.activeElement;
            if (focused) {
                if (!root.contains(active)) root.focus({ preventScroll: true });
            } else if (active instanceof HTMLElement && root.contains(active)) {
                active.blur();
            }
        },
        setTheme(theme) {
            if (disposed) return;
            applyTheme(root, resolveTheme(theme), 'm2');
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            window.clearTimeout(clockTimer);
            for (const off of offs) attempt(off, undefined);
            root.remove();
        },
    };
}
