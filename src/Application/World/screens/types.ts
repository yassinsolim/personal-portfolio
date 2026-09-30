// shared contract between the room's screens (World/screens/Screens.ts) and
// what they show. m1 is the live yassinOS iframe, m2 the widgets display,
// m3 the terminal (the loader docks there)

export type ScreenId = 'm1' | 'm2' | 'm3';

// css size of each screen's element. the css3d plane scales it to the panel
export const SCREEN_CSS_SIZE: Record<ScreenId, { w: number; h: number }> = {
    m1: { w: 1600, h: 900 },
    m2: { w: 1600, h: 900 },
    m3: { w: 900, h: 1600 },
};

// yassinOS's theme tokens (public/embed/room-theme.json in the yassinOS
// repo, copied into static/textures/room/). loose on purpose, the displays
// read what they need and fall back to their own defaults
export type RoomTheme = {
    accent?: string;
    background?: string;
    text?: string;
    textMuted?: string;
    fontUi?: string;
    fontMono?: string;
    radius?: number;
    // the wallpaper spanned across the three screens, and each screen's
    // rect in it (normalised 0..1: x, y, w, h)
    spanImage?: string;
    rects?: Partial<Record<ScreenId, [number, number, number, number]>>;
    [key: string]: unknown;
};

export type OsState = { apps: string[]; focused: string | null };

// what a display may use from the site. everything is optional to act on:
// a display must work (static) if a call does nothing
export interface DisplayContext {
    theme: RoomTheme;
    // open an app in yassinOS on m1 (a yassinOS process id), and focus m1
    openInOS(app: string, url?: string): void;
    // the same without moving the camera. false where m1 has no yassinOS
    showInOS?(app: string, url?: string): boolean;
    // the graphics info panel's data (Renderer.graphicsInfo())
    graphicsInfo(): Record<string, unknown>;
    // subscribe to a UIEventBus event, returns the unsubscribe
    on<T>(event: string, callback: (payload: T) => void): () => void;
    osState(): OsState;
    // the car click's transition into the race
    startRace(): void;
    // the visitor's best local nordschleife lap, or null
    bestLapMs(): number | null;
    // focus another screen (or null for the desk view)
    focus(target: ScreenId | null): void;
}

export interface RoomDisplay {
    // fixed css size (SCREEN_CSS_SIZE), placed and scaled by Screens
    readonly root: HTMLElement;
    // on screen and big enough to see: it may update. false: freeze
    setVisible(visible: boolean): void;
    // the camera is on this screen: it takes the pointer and keys
    setFocused(focused: boolean): void;
    dispose(): void;
}

export interface TerminalDisplay extends RoomDisplay {
    // the loader writes its build log here while the site loads
    appendLog(line: string, kind?: 'info' | 'ok' | 'warn' | 'dim'): void;
    // boot: the loader owns the text. shell: the live prompt and stats
    setMode(mode: 'boot' | 'shell'): void;
}
