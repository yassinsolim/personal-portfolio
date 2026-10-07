import './displays.css';
import { carOptionsById } from '../../carOptions';
import { type DisplayContext, type TerminalDisplay } from './types';
import {
    appLabel,
    applyTheme,
    attempt,
    clockTime,
    completeInput,
    el,
    findFile,
    formatLap,
    graphicsLines,
    liveStats,
    openNames,
    projectDir,
    projectFiles,
    projectPath,
    resolveOpen,
    resolveProject,
    resolveTheme,
    subscribe,
    suggestCommand,
    toOsState,
    visitorSpecs,
    type Themed,
} from './displayKit';
import {
    COMMANDS,
    CONTACT,
    CREDITS,
    HOME,
    NOW,
    OLDER_PROJECTS,
    PROJECTS,
    RIG,
    type Project,
} from './roomFacts';

// m3, the portrait screen: a terminal. while the site loads, the loader
// writes its build log here (boot). then it's a yassin@room shell (shell):
// live frame stats, a tail of what the site is doing, and a few commands
// once the camera is on it. nothing runs while it's hidden

type LogKind = 'info' | 'ok' | 'warn' | 'dim';

// entries kept in the scrollback (a log line, or a command's whole output)
const MAX_LINES = 400;
const MAX_EVENTS = 6;
const STATS_MS = 500;
const MAX_HISTORY = 50;
const KINDS: Record<string, true> = {
    info: true,
    ok: true,
    warn: true,
    dim: true,
};

export function createTerminalDisplay(
    ctx: DisplayContext
): Themed<TerminalDisplay> {
    let visible = true;
    let focused = false;
    let disposed = false;
    let mode: 'boot' | 'shell' = 'boot';
    let motdShown = false;
    // follow the end of the output unless the visitor scrolled up
    let pinned = true;
    let raf = 0;
    let statsTimer = 0;
    let pending: Node[] = [];
    const history: string[] = [];
    let historyAt = 0;
    let draft = '';
    // the project folder the shell is in, null at ~
    let cwd: Project | null = null;
    const touch =
        typeof matchMedia === 'function' &&
        matchMedia('(pointer: coarse)').matches;
    const mac = /Mac|iPhone|iPad/.test(
        navigator.platform || navigator.userAgent
    );

    const root = el('div', 'room-display rd-term is-boot');
    root.dataset.screen = 'm3';
    // the room camera toggles its view on any mousedown outside these
    root.setAttribute('data-prevent-click', '');
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Terminal');
    root.tabIndex = -1;
    applyTheme(root, resolveTheme(ctx.theme), 'm3');

    const bar = el('div', 'rd-term-bar');
    const icon = el('span', 'rd-term-icon', '>_');
    icon.setAttribute('aria-hidden', 'true');
    const title = el('span', 'rd-term-title', 'yassin@room: ~');
    bar.append(icon, title);

    const live = el('section', 'rd-term-live');
    live.setAttribute('aria-label', 'Live stats');
    const stats = el('div', 'rd-kv');
    const events = el('div', 'rd-events');
    live.append(
        el('div', 'rd-term-head', 'live'),
        stats,
        el('div', 'rd-term-head', 'events'),
        events
    );

    const scroll = el('div', 'rd-term-scroll');
    const out = el('div', 'rd-term-out');
    out.setAttribute('role', 'log');
    out.setAttribute('aria-live', 'polite');
    out.setAttribute('aria-label', 'Terminal output');
    // the boot log is too fast to read out line by line
    out.setAttribute('aria-busy', 'true');

    const ps1 = () => {
        const node = el('span', 'rd-ps1', 'yassin@room');
        node.append(el('span', 'rd-ps1-path', `:${projectPath(cwd)}$`));
        return node;
    };
    const prompt = el('label', 'rd-term-prompt');
    const input = el('input', 'rd-term-input');
    input.type = 'text';
    input.tabIndex = -1;
    input.maxLength = 200;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('enterkeyhint', 'go');
    input.setAttribute('aria-label', 'Command');
    const typed = el('span', 'rd-term-typed');
    const cursor = el('span', 'rd-term-cursor');
    cursor.setAttribute('aria-hidden', 'true');
    let promptPs1 = ps1();
    prompt.append(
        promptPs1,
        input,
        typed,
        cursor,
        el('span', 'rd-term-hint', touch ? 'tap to type' : 'click to type')
    );
    scroll.append(out, prompt);

    const body = el('div', 'rd-term-body');
    body.append(live, scroll);
    root.append(bar, body);

    const readInfo = (): Record<string, unknown> => {
        const info = attempt<Record<string, unknown> | null>(
            () => ctx.graphicsInfo(),
            null
        );
        return info && typeof info === 'object' ? info : {};
    };

    const line = (text: string, kind: LogKind = 'info') =>
        el('div', kind === 'info' ? 'rd-line' : `rd-line is-${kind}`, text);

    const block = (...children: Node[]) => {
        const node = el('div', 'rd-block');
        node.append(...children);
        return node;
    };

    // rows of cells in a css grid: aligned columns without ascii art
    const grid = (
        rows: string[][],
        options: { layout?: 'wide' | 'list'; head?: boolean } = {}
    ) => {
        const node = el(
            'div',
            options.layout ? `rd-grid is-${options.layout}` : 'rd-grid'
        );
        rows.forEach((row, r) =>
            row.forEach((cell, c) =>
                node.append(
                    el(
                        'div',
                        r === 0 && options.head
                            ? 'rd-grid-head'
                            : c === 0
                              ? 'rd-grid-key'
                              : 'rd-grid-value',
                        cell
                    )
                )
            )
        );
        return node;
    };

    const flush = () => {
        if (raf) window.cancelAnimationFrame(raf);
        raf = 0;
        if (!visible || disposed || !pending.length) return;
        const fragment = document.createDocumentFragment();
        for (const node of pending) fragment.appendChild(node);
        pending = [];
        out.appendChild(fragment);
        let extra = out.childElementCount - MAX_LINES;
        while (extra-- > 0 && out.firstChild) out.removeChild(out.firstChild);
        if (pinned) scroll.scrollTop = scroll.scrollHeight;
    };

    // a burst of appends lands as one dom write on the next frame
    const write = (nodes: Node[], now = false) => {
        if (disposed) return;
        for (const node of nodes) pending.push(node);
        if (pending.length > MAX_LINES)
            pending.splice(0, pending.length - MAX_LINES);
        if (!visible) return;
        if (now) flush();
        else if (!raf) raf = window.requestAnimationFrame(flush);
    };

    const clear = () => {
        pending = [];
        out.textContent = '';
        pinned = true;
    };

    scroll.addEventListener(
        'scroll',
        () => {
            pinned =
                scroll.scrollTop + scroll.clientHeight >=
                scroll.scrollHeight - 24;
        },
        { passive: true }
    );

    const statCells = new Map<string, HTMLElement>();
    const renderStats = () => {
        for (const [key, value] of liveStats(readInfo())) {
            let cell = statCells.get(key);
            if (!cell) {
                cell = el('span', 'rd-kv-value');
                stats.append(el('span', 'rd-kv-key', key), cell);
                statCells.set(key, cell);
            }
            if (cell.textContent !== value) cell.textContent = value;
        }
    };

    const scheduleStats = () => {
        window.clearInterval(statsTimer);
        statsTimer = 0;
        if (!visible || disposed || mode !== 'shell') return;
        statsTimer = window.setInterval(() => {
            if (!document.hidden) renderStats();
        }, STATS_MS);
    };

    const recent: { at: Date; text: string; kind: LogKind }[] = [];
    const renderEvents = () => {
        const fragment = document.createDocumentFragment();
        for (const event of recent) {
            const row = el(
                'div',
                event.kind === 'info' ? 'rd-event' : `rd-event is-${event.kind}`
            );
            row.append(
                el('span', 'rd-event-time', clockTime(event.at)),
                el('span', '', event.text)
            );
            fragment.appendChild(row);
        }
        if (!recent.length) fragment.appendChild(line('nothing yet', 'dim'));
        events.replaceChildren(fragment);
    };
    const pushEvent = (text: string, kind: LogKind = 'info') => {
        recent.push({ at: new Date(), text, kind });
        if (recent.length > MAX_EVENTS) recent.shift();
        if (visible && mode === 'shell' && !disposed) renderEvents();
    };

    const motd = () => {
        const node = block(
            line("Hi, I'm Yassin! Here's a terminal I made."),
            line('Type help, or ls and then cd into a project.', 'dim')
        );
        node.classList.add('rd-motd');
        return node;
    };

    const setCwd = (project: Project | null) => {
        cwd = project;
        title.textContent = `yassin@room: ${projectPath(cwd)}`;
        const next = ps1();
        promptPs1.replaceWith(next);
        promptPs1 = next;
    };

    const shortUrl = (url: string) =>
        url.replace(/^(https?:\/\/(www\.)?|mailto:)/, '').replace(/\/$/, '');

    const link = (url: string, text = shortUrl(url)) => {
        const node = el('a', 'rd-link', text);
        node.href = url;
        if (/^https?:/.test(url)) {
            node.target = '_blank';
            node.rel = 'noopener noreferrer';
        }
        node.tabIndex = focused ? 0 : -1;
        return node;
    };

    // a key column and a value column that may hold a link
    const pairs = (rows: [string, string | Node][]) => {
        const node = el('div', 'rd-grid');
        for (const [key, value] of rows) {
            const cell = el('div', 'rd-grid-value');
            cell.append(value);
            node.append(el('div', 'rd-grid-key', key), cell);
        }
        return node;
    };

    const readme = (project: Project) => {
        const card = block();
        card.classList.add('rd-readme');
        const head = el('div', 'rd-readme-head');
        head.append(
            el('span', '', `# ${project.name}`),
            el('span', 'rd-readme-when', project.timeline)
        );
        const list = el('ul', 'rd-readme-list');
        for (const item of project.highlights) list.append(el('li', '', item));
        const chips = el('div', 'rd-chips');
        for (const tech of project.tech)
            chips.append(el('span', 'rd-chip', tech));
        card.append(head, el('div', 'rd-readme-about', project.about), list, chips);
        for (const file of projectFiles(project)) {
            if (!file.url) continue;
            const row = el('div', 'rd-line');
            row.append(link(file.url));
            card.append(row);
        }
        return card;
    };

    // cd and cat open the project's folder on the main screen as well, and
    // leave the camera here
    const mirror = (project: Project): Node[] => {
        if (!project.folder) return [];
        const shown = attempt(
            () =>
                Boolean(
                    ctx.showInOS?.('FileExplorer', `${HOME}/${project.folder}`)
                ),
            false
        );
        return shown
            ? [line(`${projectPath(project)} is open on the main screen too`, 'dim')]
            : [];
    };

    const about = () => [
        block(
            el('div', 'rd-readme-head', CONTACT.name),
            line(NOW.role),
            line(NOW.school),
            line(CONTACT.place, 'dim'),
            line('contact for where to find me, ls for what I build', 'dim')
        ),
    ];

    const openFolder = (project: Project) => {
        attempt(
            () => ctx.openInOS('FileExplorer', `${HOME}/${project.folder}`),
            undefined
        );
        return [line(`opening ${projectPath(project)} on the main screen`, 'ok')];
    };

    const copyButton = (text: string, source: HTMLElement) => {
        const node = el('button', 'rd-btn', 'Copy');
        node.type = 'button';
        node.tabIndex = focused ? 0 : -1;
        node.addEventListener('click', () => {
            if (!focused || disposed) return;
            const done = (label: string) => {
                node.textContent = label;
                window.setTimeout(() => {
                    node.textContent = 'Copy';
                }, 1600);
            };
            // no clipboard (http, or no permission): select it for a manual copy
            const select = () => {
                const range = document.createRange();
                range.selectNodeContents(source);
                const selection = window.getSelection();
                selection?.removeAllRanges();
                selection?.addRange(range);
                done(`Selected, press ${mac ? 'Cmd' : 'Ctrl'}+C`);
            };
            const clipboard = navigator.clipboard;
            if (!clipboard || typeof clipboard.writeText !== 'function')
                select();
            else clipboard.writeText(text).then(() => done('Copied'), select);
        });
        return node;
    };

    const commands: Record<string, (arg: string) => Node[]> = {
        help: () => [block(grid(COMMANDS))],
        ls: (arg) => {
            const project = arg ? resolveProject(arg) : cwd;
            if (arg && !project)
                return [line(`ls: ${arg}: no such project, try ls`, 'warn')];
            if (project)
                return [
                    block(
                        pairs(
                            projectFiles(project).map(
                                (file): [string, string | Node] => [
                                    file.name,
                                    file.url ? link(file.url) : project.summary,
                                ]
                            )
                        )
                    ),
                ];
            return [
                block(
                    grid(
                        PROJECTS.map((item) => [item.name, item.summary]),
                        { layout: 'list' }
                    ),
                    line('cd <name> to step in, cat <name> to read about it', 'dim'),
                    line(
                        `${OLDER_PROJECTS.length} older ones are in the Portfolio app`,
                        'dim'
                    )
                ),
            ];
        },
        cd: (arg) => {
            const target = arg.trim();
            if (target === '.') return [];
            if (!target || /^(~|\.\.|\/)\/?$/.test(target)) {
                setCwd(null);
                return [];
            }
            const project = resolveProject(target);
            if (!project)
                return [line(`cd: ${target}: no such project, try ls`, 'warn')];
            setCwd(project);
            return [
                block(
                    line(project.about),
                    line('ls to look around, cat README.md to read it', 'dim'),
                    ...mirror(project)
                ),
            ];
        },
        cat: (arg) => {
            const target = arg.trim();
            if (!target)
                return [line('usage: cat <project>, or cat README.md in one')];
            const file = findFile(cwd, target);
            if (file && cwd) {
                if (!file.url) return [readme(cwd), ...mirror(cwd)];
                // a windows internet shortcut, like the ones in yassinOS
                const url = el('div', 'rd-line', 'URL=');
                url.append(link(file.url, file.url));
                return [block(line('[InternetShortcut]'), url)];
            }
            if (!cwd && /^readme(\.md)?$/i.test(target)) return about();
            const project = resolveProject(target);
            if (!project)
                return [
                    line(`cat: ${target}: no such file or project, try ls`, 'warn'),
                ];
            return [readme(project), ...mirror(project)];
        },
        pwd: () => [line(`/home/yassin${cwd ? `/${projectDir(cwd)}` : ''}`)],
        open: (arg) => {
            if (!arg)
                return [
                    line('usage: open <name>'),
                    line(`names: ${openNames().join(', ')}`, 'dim'),
                ];
            if (arg === '.' && cwd?.folder) return openFolder(cwd);
            const file = findFile(cwd, arg);
            if (file?.url) {
                window.open(file.url, '_blank', 'noopener,noreferrer');
                return [line(`opening ${shortUrl(file.url)} in a new tab`, 'ok')];
            }
            if (file && cwd?.folder) return openFolder(cwd);
            const target = resolveOpen(arg);
            if (!target)
                return [
                    line(`nothing called ${arg} to open`, 'warn'),
                    line(`try one of: ${openNames().join(', ')}`, 'dim'),
                ];
            attempt(() => ctx.openInOS(target.app, target.url), undefined);
            return [line(`opening ${target.label} on the main screen`, 'ok')];
        },
        whoami: about,
        contact: () => [
            block(
                pairs([
                    ['email', link(`mailto:${CONTACT.email}`, CONTACT.email)],
                    ['github', link(CONTACT.github)],
                    ['linkedin', link(CONTACT.linkedin)],
                ])
            ),
        ],
        history: () => [
            block(
                ...history.map((entry, i) =>
                    line(`${String(i + 1).padStart(4)}  ${entry}`)
                )
            ),
        ],
        echo: (arg) => [line(arg)],
        date: () => [line(new Date().toString())],
        sudo: () => [
            line(
                'yassin is not in the sudoers file. This incident will be reported.',
                'warn'
            ),
        ],
        neofetch: () => {
            const you = visitorSpecs(readInfo());
            return [
                block(
                    grid(
                        [
                            ['', 'you', 'yassin'],
                            ['gpu', you.gpu, RIG.gpu],
                            ['cpu', you.cpu, RIG.cpu],
                            ['memory', you.memory, RIG.memory],
                            ['display', you.display, RIG.displays],
                            ['case', '', RIG.case],
                        ],
                        { layout: 'wide', head: true }
                    )
                ),
            ];
        },
        graphics: () => {
            const lines = graphicsLines(readInfo());
            const text = el('div', 'rd-graphics');
            for (const value of lines) text.append(line(value));
            return [block(text, copyButton(lines.join('\n'), text))];
        },
        race: () => {
            attempt(() => ctx.startRace(), undefined);
            return [line('starting a lap of the Nordschleife', 'ok')];
        },
        credits: () => [block(grid(CREDITS))],
    };

    const echo = (text: string) => {
        const node = el('div', 'rd-line');
        node.append(ps1(), document.createTextNode(` ${text}`));
        return node;
    };

    const run = (value: string) => {
        const text = value.trim();
        const space = text.search(/\s/);
        const name = (space < 0 ? text : text.slice(0, space)).toLowerCase();
        const arg = space < 0 ? '' : text.slice(space + 1).trim();
        if (name === 'clear') {
            clear();
            return;
        }
        const nodes: Node[] = [echo(value)];
        if (name === 'exit') {
            write([...nodes, line('logout', 'dim')], true);
            attempt(() => ctx.focus(null), undefined);
            return;
        }
        const command = Object.prototype.hasOwnProperty.call(commands, name)
            ? commands[name]
            : null;
        if (command) nodes.push(...command(arg));
        else if (name) {
            const hint = suggestCommand(name);
            nodes.push(
                line(
                    hint
                        ? `${name}: command not found, did you mean ${hint}?`
                        : `${name}: command not found, try help`,
                    'warn'
                )
            );
        }
        write(nodes, true);
    };

    const caretToEnd = () => {
        const end = input.value.length;
        input.setSelectionRange(end, end);
    };

    input.addEventListener('keydown', (event) => {
        if (!focused || mode !== 'shell' || event.isComposing) return;
        if (event.key === 'Enter') {
            event.preventDefault();
            const value = input.value;
            input.value = '';
            draft = '';
            const text = value.trim();
            if (text && history[history.length - 1] !== text) {
                history.push(text);
                if (history.length > MAX_HISTORY) history.shift();
            }
            historyAt = history.length;
            run(value);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (historyAt === 0) return;
            if (historyAt === history.length) draft = input.value;
            historyAt--;
            input.value = history[historyAt];
            caretToEnd();
        } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (historyAt >= history.length) return;
            historyAt++;
            input.value =
                historyAt === history.length ? draft : history[historyAt];
            caretToEnd();
        } else if (event.key === 'Tab') {
            const completed = completeInput(input.value, cwd);
            if (completed === null || completed === input.value) return;
            event.preventDefault();
            input.value = completed;
            caretToEnd();
        } else if (event.key === 'Escape') {
            // the room's own handler takes it from here
            input.blur();
        } else if (event.ctrlKey && (event.key === 'l' || event.key === 'L')) {
            event.preventDefault();
            clear();
        } else if (
            event.ctrlKey &&
            (event.key === 'c' || event.key === 'C') &&
            input.selectionStart === input.selectionEnd &&
            !window.getSelection()?.toString()
        ) {
            // with nothing selected to copy, it drops the line like a shell
            event.preventDefault();
            write([echo(`${input.value}^C`)], true);
            input.value = '';
            draft = '';
            historyAt = history.length;
        }
    });

    const focusInput = () => {
        if (!focused || mode !== 'shell' || disposed) return;
        input.focus({ preventScroll: true });
        pinned = true;
        flush();
        scroll.scrollTop = scroll.scrollHeight;
    };

    // a click anywhere on the focused terminal types, unless it's picking
    // text to copy or pressing a button
    root.addEventListener('click', (event) => {
        if (!focused || mode !== 'shell') return;
        const target = event.target as Element | null;
        if (target?.closest?.('button, input, a')) return;
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed) return;
        focusInput();
    });

    let racing = false;
    const stages = new Map<string, string>();
    let osFocused: string | null | undefined;
    const offs = [
        subscribe<unknown>(ctx, 'carChange', (id) => {
            if (typeof id !== 'string' || !id) return;
            pushEvent(`car: ${carOptionsById[id]?.label || id}`);
        }),
        subscribe<{ active?: boolean; paused?: boolean } | undefined>(
            ctx,
            'raceMode:changed',
            (state) => {
                const active = Boolean(state?.active);
                if (active) pushEvent(state?.paused ? 'race paused' : 'racing');
                else if (racing) pushEvent('back in the room');
                racing = active;
            }
        ),
        subscribe<
            { scope?: unknown; stage?: unknown; done?: unknown } | undefined
        >(ctx, 'load:stage', (state) => {
            if (
                typeof state?.scope !== 'string' ||
                typeof state.stage !== 'string'
            )
                return;
            const { scope, stage } = state;
            if (stages.get(scope) !== stage) {
                stages.set(scope, stage);
                pushEvent(`${scope}: ${stage}`, 'dim');
            }
            if (
                state.done &&
                (stage === 'ready' || stage === 'done') &&
                stages.get(`${scope}:done`) !== stage
            ) {
                stages.set(`${scope}:done`, stage);
                pushEvent(`${scope} loaded`, 'ok');
            }
        }),
        subscribe<unknown>(ctx, 'yassinos:state', (payload) => {
            const state =
                toOsState(payload) ||
                toOsState(attempt(() => ctx.osState(), null));
            if (!state || state.focused === osFocused) return;
            osFocused = state.focused;
            pushEvent(`main screen: ${appLabel(state.focused).title}`);
        }),
        subscribe<{ lapTimeMs?: number } | undefined>(
            ctx,
            'race:lapCompleted',
            (lap) => {
                const time = formatLap(lap?.lapTimeMs);
                if (time) pushEvent(`lap ${time}`, 'ok');
            }
        ),
        subscribe<{ mode?: unknown } | undefined>(
            ctx,
            'race:qualityChange',
            (state) => {
                if (typeof state?.mode === 'string')
                    pushEvent(`graphics mode: ${state.mode}`);
            }
        ),
        subscribe<{ low?: boolean } | undefined>(
            ctx,
            'render:effects',
            (state) =>
                pushEvent(state?.low ? 'effects: low' : 'effects: full', 'dim')
        ),
        subscribe(ctx, 'graphics:contextLost', () =>
            pushEvent('webgl context lost', 'warn')
        ),
        subscribe(ctx, 'graphics:contextRestored', () =>
            pushEvent('webgl context restored', 'ok')
        ),
        subscribe(ctx, 'loadingScreenDone', () =>
            pushEvent('loader done', 'ok')
        ),
    ];

    return {
        root,
        appendLog(text: string, kind: LogKind = 'info') {
            write([line(String(text ?? ''), KINDS[kind] ? kind : 'info')]);
        },
        setMode(next: 'boot' | 'shell') {
            const value = next === 'shell' ? 'shell' : 'boot';
            if (disposed || value === mode) return;
            mode = value;
            root.classList.toggle('is-shell', mode === 'shell');
            root.classList.toggle('is-boot', mode === 'boot');
            out.setAttribute('aria-busy', mode === 'boot' ? 'true' : 'false');
            pinned = true;
            if (mode === 'shell') {
                if (!motdShown) {
                    motdShown = true;
                    write([motd()]);
                }
                if (visible) {
                    renderStats();
                    renderEvents();
                    flush();
                }
                focusInput();
            } else if (document.activeElement === input) {
                input.blur();
            }
            scheduleStats();
        },
        setVisible(next: boolean) {
            if (disposed || Boolean(next) === visible) return;
            visible = Boolean(next);
            if (visible) {
                flush();
                if (mode === 'shell') {
                    renderStats();
                    renderEvents();
                }
            } else if (raf) {
                window.cancelAnimationFrame(raf);
                raf = 0;
            }
            scheduleStats();
        },
        setFocused(next: boolean) {
            if (disposed) return;
            focused = Boolean(next);
            root.classList.toggle('is-focused', focused);
            input.tabIndex = focused ? 0 : -1;
            root.querySelectorAll<HTMLElement>('.rd-btn, .rd-link').forEach((node) => {
                node.tabIndex = focused ? 0 : -1;
            });
            typed.textContent = input.value;
            const active = document.activeElement;
            if (focused) {
                if (mode === 'shell') focusInput();
                else if (!root.contains(active))
                    root.focus({ preventScroll: true });
            } else if (active instanceof HTMLElement && root.contains(active)) {
                active.blur();
            }
        },
        setTheme(theme) {
            if (disposed) return;
            applyTheme(root, resolveTheme(theme), 'm3');
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            if (raf) window.cancelAnimationFrame(raf);
            window.clearInterval(statsTimer);
            pending = [];
            for (const off of offs) attempt(off, undefined);
            root.remove();
        },
    };
}
