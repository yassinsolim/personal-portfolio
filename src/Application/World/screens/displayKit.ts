// shared by the widgets display (m2) and the terminal (m3): the theme, the
// wallpaper slice, formatting and lookups. no dom at import time, so node
// tests can load it (scripts/test/room-displays.test.mjs)
import { assetUrl } from '../../Utils/assetUrl';
import {
    SCREEN_CSS_SIZE,
    type DisplayContext,
    type OsState,
    type RoomTheme,
    type ScreenId,
} from './types';
import {
    APP_TITLES,
    APPS,
    COMMANDS,
    HOME,
    PROJECTS,
    type OpenTarget,
} from './roomFacts';

export type Rect = [number, number, number, number];

// both displays' one extra: a theme that arrives after they were made
export type Themed<T> = T & {
    setTheme(theme: RoomTheme | null | undefined): void;
};

// the context may be a stub or not ready yet: whatever a call does, the
// display stays up
export const attempt = <T>(call: () => T, fallback: T): T => {
    try {
        const value = call();
        return value === undefined ? fallback : value;
    } catch {
        return fallback;
    }
};

export const subscribe = <T>(
    ctx: DisplayContext,
    event: string,
    callback: (payload: T) => void
): (() => void) => {
    try {
        const off = ctx.on<T>(event, callback);
        return typeof off === 'function' ? off : () => undefined;
    } catch {
        return () => undefined;
    }
};

// yassinOS's dark theme (styles/defaultTheme in the yassinOS repo), for
// whatever room-theme.json leaves out
export const DEFAULT_THEME = {
    accent: 'hsla(207, 100%, 72%, 90%)',
    accentStrong: 'hsla(207, 100%, 45%, 90%)',
    background: '#000',
    text: 'rgba(255, 255, 255, 90%)',
    textMuted: 'rgb(170, 170, 170)',
    fontUi: "'Segoe UI', system-ui, Roboto, 'Helvetica Neue', sans-serif",
    fontMono: "Consolas, 'Lucida Console', 'Courier New', monospace",
    // yassinOS's windows are square
    radius: 0,
    titleBar: 'rgb(0, 0, 0)',
    outline: 'hsla(0, 0%, 25%, 75%)',
    terminalText: 'rgb(204, 204, 204)',
    spanImage: 'room-span.webp',
};

// each screen's part of the spanned wallpaper, normalised x, y, w, h
export const DEFAULT_RECTS: Record<ScreenId, Rect> = {
    m1: [0, 0.5241, 0.6111, 0.4759],
    m2: [0, 0, 0.6111, 0.4759],
    m3: [0.6562, 0.0799, 0.3438, 0.8459],
};

export type ResolvedTheme = typeof DEFAULT_THEME & {
    rects: Record<ScreenId, Rect>;
};

type StringToken = Exclude<keyof typeof DEFAULT_THEME, 'radius'>;

// where each token is: types.ts's flat RoomTheme first, then the nested
// shape yassinOS's scripts/roomSpan.js writes (colors.accent, fonts.mono,
// screens.M2.norm and so on)
const TOKEN_PATHS: Record<StringToken, string[]> = {
    accent: ['accent', 'colors.accent'],
    accentStrong: ['accentStrong', 'colors.accentDeep'],
    background: ['background', 'colors.background'],
    text: ['text', 'colors.text'],
    textMuted: ['textMuted', 'colors.textInactive'],
    fontUi: ['fontUi', 'fonts.ui'],
    fontMono: ['fontMono', 'fonts.mono'],
    titleBar: ['titleBar', 'window.titleBar.background'],
    outline: ['outline', 'window.outline'],
    terminalText: ['terminalText', 'terminal.foreground'],
    spanImage: ['spanImage', 'span.path'],
};

const SCREENS: ScreenId[] = ['m1', 'm2', 'm3'];

const isNumber = (value: unknown): value is number =>
    typeof value === 'number' && isFinite(value);

const isText = (value: unknown): value is string =>
    typeof value === 'string' && value.trim() !== '';

// the first of the dotted paths whose value passes the test
const pick = <T>(
    source: unknown,
    paths: string[],
    test: (value: unknown) => value is T
): T | undefined => {
    for (const path of paths) {
        let value = source;
        for (const key of path.split('.')) {
            value =
                value && typeof value === 'object'
                    ? (value as Record<string, unknown>)[key]
                    : undefined;
        }
        if (test(value)) return value;
    }
    return undefined;
};

// { x, y, width, height } -> [x, y, w, h]
const normRect = (value: unknown) => {
    if (!value || typeof value !== 'object') return undefined;
    const { x, y, width, height } = value as Record<string, unknown>;
    return [x, y, width, height];
};

export const isRect = (rect: unknown): rect is Rect =>
    Array.isArray(rect) &&
    rect.length === 4 &&
    rect.every(isNumber) &&
    rect[0] >= 0 &&
    rect[1] >= 0 &&
    rect[2] > 0 &&
    rect[3] > 0 &&
    rect[0] + rect[2] <= 1.001 &&
    rect[1] + rect[3] <= 1.001;

// the theme with every token filled in: strings only where the json has a
// non empty string, rects only where they're normalised
export const resolveTheme = (theme?: RoomTheme | null): ResolvedTheme => {
    const out: ResolvedTheme = {
        ...DEFAULT_THEME,
        rects: { ...DEFAULT_RECTS },
    };
    if (!theme || typeof theme !== 'object') return out;
    for (const key of Object.keys(TOKEN_PATHS) as StringToken[]) {
        const value = pick(theme, TOKEN_PATHS[key], isText);
        if (value) out[key] = value.trim();
    }
    // a window outline may come as the whole border, "1px solid <color>"
    out.outline = out.outline.replace(/^\d+(?:\.\d+)?px\s+solid\s+/, '');
    const radius = pick(theme, ['radius', 'radius.window'], isNumber);
    if (radius !== undefined) out.radius = Math.min(48, Math.max(0, radius));
    const screens = (theme as { screens?: Record<string, unknown> }).screens;
    for (const id of SCREENS) {
        const flat = theme.rects?.[id];
        const nested = screens && (screens[id.toUpperCase()] || screens[id]);
        const rect = isRect(flat)
            ? flat
            : normRect(nested && (nested as Record<string, unknown>).norm);
        if (isRect(rect)) out.rects[id] = [rect[0], rect[1], rect[2], rect[3]];
    }
    return out;
};

// css background size and position that show `rect` of the image across an
// element of `size` css px
export const spanBackground = (rect: Rect, size: { w: number; h: number }) => {
    const [x, y, w, h] = rect;
    const fullW = size.w / w;
    const fullH = size.h / h;
    const px = (value: number) => `${Math.round(value * 100) / 100 || 0}px`;
    return {
        size: `${px(fullW)} ${px(fullH)}`,
        position: `${px(-x * fullW)} ${px(-y * fullH)}`,
    };
};

// the span image sits next to room-theme.json in static/textures/room/,
// whatever path the json gives for it
export const spanImageUrl = (image: string) => {
    if (/^(data|blob):/.test(image)) return image;
    const name = image.split(/[?#]/)[0].split('/').pop();
    return assetUrl(`textures/room/${name || DEFAULT_THEME.spanImage}`);
};

export const applyTheme = (
    root: HTMLElement,
    theme: ResolvedTheme,
    screen: ScreenId
) => {
    const vars: Record<string, string> = {
        '--rd-accent': theme.accent,
        '--rd-accent-strong': theme.accentStrong,
        '--rd-bg': theme.background,
        '--rd-text': theme.text,
        '--rd-muted': theme.textMuted,
        '--rd-font-ui': theme.fontUi,
        '--rd-font-mono': theme.fontMono,
        '--rd-radius': `${theme.radius}px`,
        '--rd-titlebar': theme.titleBar,
        '--rd-outline': theme.outline,
        '--rd-term-text': theme.terminalText,
    };
    for (const key of Object.keys(vars)) root.style.setProperty(key, vars[key]);
    const size = SCREEN_CSS_SIZE[screen];
    const background = spanBackground(theme.rects[screen], size);
    root.style.width = `${size.w}px`;
    root.style.height = `${size.h}px`;
    root.style.backgroundImage = `url(${JSON.stringify(spanImageUrl(theme.spanImage))})`;
    root.style.backgroundSize = background.size;
    root.style.backgroundPosition = background.position;
};

export const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string
): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

export const pad2 = (value: number) =>
    value < 10 ? `0${value}` : String(value);

// 7:58.412, or null when there's no lap
export const formatLap = (ms: number | null | undefined) => {
    if (!isNumber(ms) || ms <= 0) return null;
    const total = Math.floor(ms);
    const millis = total % 1000;
    return `${Math.floor(total / 60000)}:${pad2(Math.floor((total % 60000) / 1000))}.${
        millis < 10 ? '00' : millis < 100 ? '0' : ''
    }${millis}`;
};

// 10:41:03, for the terminal's event tail
export const clockTime = (date: Date) =>
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;

type DatePart = { type: string; value: string };

// the visitor's local time in their locale's format, with the am/pm part
// split out so it can be drawn smaller
export const clockParts = (date: Date, locale?: string) => {
    const format = new Intl.DateTimeFormat(locale, {
        hour: 'numeric',
        minute: '2-digit',
    });
    const parts = (
        format as { formatToParts?: (date: Date) => DatePart[] }
    ).formatToParts?.(date);
    let time = '';
    let period = '';
    let periodFirst = false;
    if (parts) {
        for (const part of parts) {
            if (part.type === 'dayPeriod') {
                period += part.value;
                periodFirst = !time.trim();
            } else time += part.value;
        }
    } else time = format.format(date);
    return {
        time: time.trim(),
        period: period.trim(),
        periodFirst,
        date: new Intl.DateTimeFormat(locale, {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
        }).format(date),
        iso: `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(
            date.getHours()
        )}:${pad2(date.getMinutes())}`,
    };
};

// "ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 Direct3D11 vs_5_0 ps_5_0, D3D11)"
// -> "NVIDIA GeForce RTX 5080"
export const shortGpuName = (renderer: string) => {
    const raw = (renderer || '').trim();
    if (!raw) return '';
    if (/swiftshader/i.test(raw)) return 'SwiftShader (software)';
    let name = raw;
    const angle = /^ANGLE \((.*)\)$/i.exec(name);
    if (angle) {
        const parts = angle[1].split(', ');
        name = parts.length > 1 ? parts[1] : parts[0];
    }
    name = name
        .replace(/^ANGLE Metal Renderer:\s*/i, '')
        .replace(/\s*\((?:R|TM)\)/gi, '')
        .replace(/\s*\(0x[0-9a-f]+\)/gi, '')
        .replace(/\s*Direct3D\d*\S*(?:\s+vs_\S+\s+ps_\S+)?/i, '')
        .replace(/^Mesa\s+/i, '')
        .replace(/\s*\([^()]*\b(?:LLVM|DRM)\b[^()]*\)\s*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    return name || raw;
};

export const parseOutline = (flat: string) => {
    const values = flat.split(',').map(Number);
    const points: number[][] = [];
    for (let i = 0; i + 1 < values.length; i += 2)
        points.push([values[i], values[i + 1]]);
    return points;
};

// an svg path of [x, z] points fitted into the box, north up with world z
// running down (the race minimap's orientation)
export const outlinePath = (
    points: unknown,
    box: { w: number; h: number; pad: number }
) => {
    if (!Array.isArray(points)) return null;
    const valid = points.filter(
        (point): point is number[] =>
            Array.isArray(point) && isNumber(point[0]) && isNumber(point[1])
    );
    if (valid.length < 3) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const [x, z] of valid) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
    }
    const scale = Math.min(
        (box.w - box.pad * 2) / Math.max(1e-6, maxX - minX),
        (box.h - box.pad * 2) / Math.max(1e-6, maxZ - minZ)
    );
    const offsetX = (box.w - (maxX - minX) * scale) / 2;
    const offsetZ = (box.h - (maxZ - minZ) * scale) / 2;
    const map = (x: number, z: number) => [
        Math.round((offsetX + (x - minX) * scale) * 10) / 10,
        Math.round((offsetZ + (z - minZ) * scale) * 10) / 10,
    ];
    let d = '';
    valid.forEach(([x, z], i) => {
        const [mx, mz] = map(x, z);
        d += `${i ? 'L' : 'M'}${mx} ${mz}`;
    });
    return { d: `${d}Z`, start: map(valid[0][0], valid[0][1]) };
};

// the yassin:state bridge's payload, or null if it isn't one
export const toOsState = (value: unknown): OsState | null => {
    if (!value || typeof value !== 'object') return null;
    const state = value as { apps?: unknown; focused?: unknown };
    if (!Array.isArray(state.apps) && !('focused' in state)) return null;
    return {
        apps: Array.isArray(state.apps)
            ? state.apps.filter((app): app is string => typeof app === 'string')
            : [],
        focused:
            typeof state.focused === 'string' && state.focused
                ? state.focused
                : null,
    };
};

// a yassinOS pid is the process id, then optionally __url and __instance
export const appLabel = (pid: string | null | undefined) => {
    if (!pid) return { title: 'Desktop', detail: '' };
    const [id, ...rest] = String(pid).split('__');
    const url = rest.filter((part) => part.charAt(0) === '/')[0] || '';
    const app = APP_TITLES[id] || id.replace(/([a-z])([A-Z])/g, '$1 $2');
    if (!url) return { title: app, detail: '' };
    const base = url.split('/').filter(Boolean).pop() || '';
    if (id === 'FileExplorer') return { title: app, detail: base || 'This PC' };
    return { title: base || app, detail: base ? app : '' };
};

const squash = (value: string) => value.toLowerCase().replace(/[\s_-]+/g, '');

const folderProjects = () => PROJECTS.filter((project) => project.folder);

// every name `open` takes, for help and tab completion
export const openNames = () => [
    ...Object.keys(APPS),
    ...folderProjects().map((project) => project.name.toLowerCase()),
];

export const resolveOpen = (name: string): OpenTarget | null => {
    const key = squash(name);
    if (!key) return null;
    if (APPS[key]) return APPS[key];
    for (const alias of Object.keys(APPS)) {
        if (squash(APPS[alias].app) === key) return APPS[alias];
    }
    const project = folderProjects().filter(
        (item) => squash(item.name) === key
    )[0];
    if (!project) return null;
    return {
        app: 'FileExplorer',
        url: `${HOME}/${project.folder}`,
        label: `${project.name} folder`,
    };
};

export const COMMAND_NAMES = COMMANDS.map(([usage]) => usage.split(' ')[0]);

const commonPrefix = (words: string[]) =>
    words.reduce((prefix, word) => {
        let i = 0;
        while (i < prefix.length && i < word.length && prefix[i] === word[i])
            i++;
        return prefix.slice(0, i);
    });

const completeWord = (word: string, candidates: string[]) => {
    const hits = candidates.filter(
        (candidate) => candidate.indexOf(word) === 0
    );
    if (!hits.length) return null;
    if (hits.length === 1) return hits[0];
    const prefix = commonPrefix(hits);
    return prefix.length > word.length ? prefix : null;
};

// tab completion: the command, then open's argument. null when there's
// nothing to add
export const completeInput = (value: string) => {
    const first = /^\s*(\S+)$/.exec(value);
    if (first) {
        const hit = completeWord(first[1].toLowerCase(), COMMAND_NAMES);
        if (!hit) return null;
        return hit === 'open' ? 'open ' : hit;
    }
    const open = /^\s*open\s+(\S*)$/i.exec(value);
    if (open) {
        const hit = completeWord(open[1].toLowerCase(), openNames());
        return hit ? `open ${hit}` : null;
    }
    return null;
};

const num = (value: unknown) => (isNumber(value) ? value : null);
const str = (value: unknown) => (typeof value === 'string' ? value : '');
const ms = (value: unknown) => {
    const n = num(value);
    return n === null ? '--' : `${n} ms`;
};

// the same lines as the graphics info panel (UI/components/GraphicsInfo.tsx),
// so a copy from either reads the same
export const graphicsLines = (info: Record<string, unknown>) => {
    const race =
        info.race && typeof info.race === 'object'
            ? (info.race as Record<string, unknown>)
            : null;
    const autoStep = race ? num(race.autoStep) : null;
    return [
        `Renderer: ${str(info.renderer) || '(hidden)'}`,
        `Vendor: ${str(info.vendor) || '(hidden)'}`,
        `Detected: ${str(info.detectedTier)} (${str(info.kind)}: ${str(info.reason)})`,
        race
            ? `Race: ${str(race.tier)} tier, ${str(race.preset)} preset${
                  autoStep ? `, auto step ${autoStep}` : ''
              }${race.forced ? ' (forced)' : ''}`
            : 'Race: not started',
        `Mode: ${str(info.mode)}, render scale ${num(info.renderScale) ?? '?'}x, buffer ${str(
            info.buffer
        )}, viewport ${str(info.viewport)} at DPR ${num(info.devicePixelRatio) ?? '?'}`,
        `Frame: p50 ${ms(info.frameP50)}, p95 ${ms(info.frameP95)}, p99 ${ms(info.frameP99)}`,
        `CPU ${ms(info.cpuP50)}, GPU ${info.gpuTimer ? ms(info.gpuP50) : 'no timer'}, bound: ${str(
            info.bound
        )}, ${num(info.drawCalls) ?? '?'} draws`,
        `Homepage p50: ${ms(info.homeP50)}`,
        `CPU cores: ${num(info.cores) ?? '?'}, memory: ${num(info.memoryGb) ?? '?'} GB`,
        `Browser: ${str(info.userAgent)}`,
    ];
};

// the terminal's live block: gpu, detected tier and why, render scale, frame
// times, draw calls
export const liveStats = (
    info: Record<string, unknown>
): [string, string][] => {
    const scale = num(info.renderScale);
    return [
        ['gpu', shortGpuName(str(info.renderer)) || '(hidden by the browser)'],
        [
            'tier',
            [str(info.detectedTier) || '?', str(info.reason) || str(info.kind)]
                .filter(Boolean)
                .join(', '),
        ],
        [
            'scale',
            `${scale === null ? '?' : `${scale}x`}${str(info.mode) ? `, ${str(info.mode)}` : ''}`,
        ],
        ['frame', `p50 ${ms(info.frameP50)}, p95 ${ms(info.frameP95)}`],
        ['draws', String(num(info.drawCalls) ?? '?')],
    ];
};

// the visitor's side of neofetch, from graphicsInfo
export const visitorSpecs = (info: Record<string, unknown>) => {
    const cores = num(info.cores);
    const memory = num(info.memoryGb);
    const dpr = num(info.devicePixelRatio);
    return {
        gpu: shortGpuName(str(info.renderer)) || 'hidden by the browser',
        cpu: cores ? `${cores} cores` : 'not shared',
        // navigator.deviceMemory rounds down to a power of two, and some
        // browsers stop at 8
        memory: memory === null ? 'not shared' : `at least ${memory} GB`,
        display: `${str(info.viewport) || '?'}${dpr ? ` at ${Math.round(dpr * 100) / 100}x` : ''}`,
    };
};
