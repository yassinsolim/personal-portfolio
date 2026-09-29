// the room's m2 (widgets) and m3 (terminal) displays: theme fallbacks, the
// wallpaper slice each screen shows, the formatting and lookups they share,
// their copy (no em or en dashes), that their css stays under .room-display,
// and the placeholder theme and wallpaper
//
//   npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './ts-hooks.mjs';

const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
);
const screens = path.join(root, 'src/Application/World/screens');
const kit = await import('../../src/Application/World/screens/displayKit.ts');
const facts = await import('../../src/Application/World/screens/roomFacts.ts');
const { SCREEN_CSS_SIZE } =
    await import('../../src/Application/World/screens/types.ts');

test('the theme falls back to yassinOS defaults token by token', () => {
    const fallback = kit.resolveTheme(undefined);
    assert.equal(fallback.accent, kit.DEFAULT_THEME.accent);
    assert.equal(fallback.radius, 0);
    assert.deepEqual(fallback.rects, kit.DEFAULT_RECTS);
    assert.deepEqual(kit.resolveTheme(null), fallback);

    const theme = kit.resolveTheme({
        accent: ' #3af ',
        text: '',
        fontMono: 42,
        radius: 400,
        rects: {
            m2: [0, 0, 0.5, 0.5],
            m3: [0.7, 0.1, 0.5, 0.8],
            m1: [10, 20, 600, 300],
        },
    });
    assert.equal(theme.accent, '#3af');
    assert.equal(theme.text, kit.DEFAULT_THEME.text);
    assert.equal(theme.fontMono, kit.DEFAULT_THEME.fontMono);
    assert.equal(theme.radius, 48);
    assert.deepEqual(theme.rects.m2, [0, 0, 0.5, 0.5]);
    // past the image's edge, and mm instead of fractions
    assert.deepEqual(theme.rects.m3, kit.DEFAULT_RECTS.m3);
    assert.deepEqual(theme.rects.m1, kit.DEFAULT_RECTS.m1);
});

test("the theme reads yassinOS's nested room-theme.json too", () => {
    // the shape yassinOS's scripts/roomSpan.js writes (public/embed there)
    const theme = kit.resolveTheme({
        name: 'yassinOS',
        version: 1,
        colors: {
            background: '#000',
            text: 'rgba(255, 255, 255, 90%)',
            textInactive: 'rgb(170, 170, 170)',
            accent: 'hsla(200, 100%, 70%, 90%)',
            accentDeep: 'hsla(200, 100%, 40%, 90%)',
        },
        fonts: {
            ui: "'Segoe UI', system-ui, sans-serif",
            mono: 'Consolas, Lucida Console, Courier New, monospace',
        },
        radius: { menu: 0, taskbar: 0, window: 4 },
        window: {
            outline: '1px solid hsla(0, 0%, 25%, 75%)',
            titleBar: { background: 'rgb(0, 0, 0)' },
        },
        terminal: { foreground: 'rgb(200, 200, 200)' },
        span: { path: '/embed/room-span.webp' },
        screens: {
            M1: { norm: { x: 0, y: 0.5241, width: 0.611122, height: 0.4759 } },
            M2: { norm: { x: 0, y: 0, width: 0.611122, height: 0.4759 } },
            M3: {
                norm: {
                    x: 0.656186,
                    y: 0.079884,
                    width: 0.343814,
                    height: 0.845903,
                },
            },
        },
    });
    assert.equal(theme.accent, 'hsla(200, 100%, 70%, 90%)');
    assert.equal(theme.accentStrong, 'hsla(200, 100%, 40%, 90%)');
    assert.equal(theme.textMuted, 'rgb(170, 170, 170)');
    assert.equal(
        theme.fontMono,
        'Consolas, Lucida Console, Courier New, monospace'
    );
    assert.equal(theme.outline, 'hsla(0, 0%, 25%, 75%)');
    assert.equal(theme.terminalText, 'rgb(200, 200, 200)');
    assert.equal(theme.radius, 4);
    assert.equal(
        kit.spanImageUrl(theme.spanImage),
        'textures/room/room-span.webp'
    );
    assert.deepEqual(theme.rects.m3, [0.656186, 0.079884, 0.343814, 0.845903]);
    assert.deepEqual(theme.rects.m2, [0, 0, 0.611122, 0.4759]);
    // the flat keys win when both are there
    assert.equal(
        kit.resolveTheme({ accent: '#fff', colors: { accent: '#000' } }).accent,
        '#fff'
    );
});

test("each screen's background is its rect of the one span image", () => {
    const image = { w: 2929, h: 2116 };
    for (const id of ['m1', 'm2', 'm3']) {
        const rect = kit.DEFAULT_RECTS[id];
        const size = SCREEN_CSS_SIZE[id];
        const bg = kit.spanBackground(rect, size);
        const [fullW, fullH] = bg.size.split(' ').map(parseFloat);
        const [left, top] = bg.position.split(' ').map(parseFloat);
        // the element covers exactly its rect
        assert.ok(Math.abs(-left / fullW - rect[0]) < 1e-4, `${id} x`);
        assert.ok(Math.abs(-top / fullH - rect[1]) < 1e-4, `${id} y`);
        assert.ok(Math.abs(size.w / fullW - rect[2]) < 1e-4, `${id} w`);
        assert.ok(Math.abs(size.h / fullH - rect[3]) < 1e-4, `${id} h`);
        // and the image isn't stretched: the same scale both ways
        assert.ok(
            Math.abs(fullW / fullH - image.w / image.h) < 0.002,
            `${id} aspect`
        );
    }
    assert.deepEqual(kit.spanBackground([0, 0, 1, 1], { w: 100, h: 50 }), {
        size: '100px 50px',
        position: '0px 0px',
    });
});

test('the span image resolves next to room-theme.json', () => {
    assert.equal(
        kit.spanImageUrl('room-span.webp'),
        'textures/room/room-span.webp'
    );
    assert.equal(
        kit.spanImageUrl('/embed/room-span.webp'),
        'textures/room/room-span.webp'
    );
    assert.equal(
        kit.spanImageUrl('https://os.yassin.app/embed/wall.webp?x=1'),
        'textures/room/wall.webp'
    );
    assert.equal(kit.spanImageUrl(''), 'textures/room/room-span.webp');
    assert.equal(
        kit.spanImageUrl('data:image/webp;base64,AAAA'),
        'data:image/webp;base64,AAAA'
    );
});

test('lap times and clocks', () => {
    assert.equal(kit.formatLap(478412), '7:58.412');
    assert.equal(kit.formatLap(60000), '1:00.000');
    assert.equal(kit.formatLap(61005.9), '1:01.005');
    for (const none of [null, undefined, 0, -5, NaN, Infinity])
        assert.equal(kit.formatLap(none), null);

    const date = new Date(2026, 8, 29, 10, 41, 3);
    assert.equal(kit.clockTime(date), '10:41:03');
    const us = kit.clockParts(date, 'en-US');
    assert.equal(us.time, '10:41');
    assert.equal(us.period, 'AM');
    assert.equal(us.periodFirst, false);
    assert.equal(us.date, 'Tuesday, September 29');
    assert.equal(us.iso, '2026-09-29T10:41');
    const uk = kit.clockParts(new Date(2026, 8, 29, 21, 5), 'en-GB');
    assert.equal(uk.time, '21:05');
    assert.equal(uk.period, '');
});

test('renderer strings shorten to the gpu', () => {
    const cases = [
        [
            'ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 Direct3D11 vs_5_0 ps_5_0, D3D11)',
            'NVIDIA GeForce RTX 5080',
        ],
        [
            'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)',
            'Apple M1',
        ],
        [
            'ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)',
            'Intel UHD Graphics 620',
        ],
        [
            'ANGLE (Intel(R) HD Graphics Direct3D11 vs_5_0 ps_5_0)',
            'Intel HD Graphics',
        ],
        [
            'ANGLE (Intel Inc., Intel(R) Iris(TM) Plus Graphics 655, OpenGL 4.1)',
            'Intel Iris Plus Graphics 655',
        ],
        [
            'ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)',
            'AMD Radeon Graphics',
        ],
        [
            'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
            'SwiftShader (software)',
        ],
        [
            'ANGLE (Intel, Mesa Intel(R) UHD Graphics 600 (GLK 2), OpenGL ES 3.2)',
            'Intel UHD Graphics 600 (GLK 2)',
        ],
        ['ANGLE (Qualcomm, Adreno (TM) 618, OpenGL ES 3.2)', 'Adreno 618'],
        ['ANGLE (ARM, Mali-G72, OpenGL ES 3.2)', 'Mali-G72'],
        [
            'AMD Radeon Graphics (renoir, LLVM 15.0.6, DRM 3.49, 6.1.0)',
            'AMD Radeon Graphics',
        ],
        ['Apple GPU', 'Apple GPU'],
        ['', ''],
    ];
    for (const [renderer, expected] of cases)
        assert.equal(kit.shortGpuName(renderer), expected, renderer);
});

test('track outlines fit their box, and the built in one is the real lap', () => {
    const square = kit.outlinePath(
        [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
        ],
        { w: 100, h: 50, pad: 5 }
    );
    // 40 x 40 (the tighter axis less the padding), centred in 100 x 50
    assert.equal(square.d, 'M30 5L70 5L70 45L30 45Z');
    assert.deepEqual(square.start, [30, 5]);
    assert.equal(kit.outlinePath(null, { w: 1, h: 1, pad: 0 }), null);
    assert.equal(
        kit.outlinePath(
            [
                [0, 0],
                [1, 1],
            ],
            { w: 1, h: 1, pad: 0 }
        ),
        null
    );
    assert.ok(
        kit.outlinePath(
            [
                [0, 0],
                ['x', 1],
                [1, 1],
                [2, 0],
            ],
            { w: 10, h: 10, pad: 0 }
        )
    );

    const builtIn = kit.parseOutline(facts.TRACK_OUTLINE);
    assert.equal(builtIn.length, 103);
    for (const [x, z] of builtIn)
        assert.ok(x >= 0 && x <= 999 && z >= 0 && z <= 999);

    // same orientation as the race's own outline (x, z of the track data)
    const track = JSON.parse(
        fs.readFileSync(
            path.join(
                root,
                'static/models/Tracks/Nordschleife/nordschleife.json'
            ),
            'utf8'
        )
    );
    const xs = track.points.map((p) => p[0]);
    const zs = track.points.map((p) => p[2]);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...zs) - Math.min(...zs);
    const builtW =
        Math.max(...builtIn.map((p) => p[0])) -
        Math.min(...builtIn.map((p) => p[0]));
    const builtH =
        Math.max(...builtIn.map((p) => p[1])) -
        Math.min(...builtIn.map((p) => p[1]));
    assert.ok(Math.abs(builtW / builtH - width / height) < 0.01);
    assert.ok(
        Math.abs(track.length / 1000 - 20.8) < 0.05,
        'the card says 20.8 km'
    );
});

test('yassinOS state and app names', () => {
    assert.deepEqual(
        kit.toOsState({ apps: ['Portfolio', 3], focused: 'Portfolio' }),
        {
            apps: ['Portfolio'],
            focused: 'Portfolio',
        }
    );
    assert.deepEqual(kit.toOsState({ focused: '' }), {
        apps: [],
        focused: null,
    });
    assert.equal(kit.toOsState('Portfolio'), null);
    assert.equal(kit.toOsState({}), null);

    assert.deepEqual(kit.appLabel(null), { title: 'Desktop', detail: '' });
    assert.deepEqual(kit.appLabel('Portfolio'), {
        title: 'Portfolio',
        detail: '',
    });
    assert.deepEqual(kit.appLabel('FileExplorer__/Users/Public'), {
        title: 'File Explorer',
        detail: 'Public',
    });
    assert.deepEqual(kit.appLabel('FileExplorer__/'), {
        title: 'File Explorer',
        detail: 'This PC',
    });
    assert.deepEqual(kit.appLabel('PDF__/Users/Public/Desktop/Resume.pdf'), {
        title: 'Resume.pdf',
        detail: 'PDF',
    });
    assert.deepEqual(kit.appLabel('Terminal__2'), {
        title: 'Terminal',
        detail: '',
    });
    assert.deepEqual(kit.appLabel('SomeNewApp'), {
        title: 'Some New App',
        detail: '',
    });
});

test('open takes app names, process ids and project folders', () => {
    assert.deepEqual(kit.resolveOpen('Portfolio'), {
        app: 'Portfolio',
        label: 'Portfolio',
    });
    assert.equal(kit.resolveOpen('projects').url, '/Users/Public');
    assert.equal(
        kit.resolveOpen('resume').url,
        '/Users/Public/Desktop/Resume.pdf'
    );
    assert.equal(kit.resolveOpen('SpaceCadet').app, 'SpaceCadet');
    assert.equal(kit.resolveOpen('file explorer').app, 'FileExplorer');
    assert.deepEqual(kit.resolveOpen('aethervsr'), {
        app: 'FileExplorer',
        url: '/Users/Public/AetherVSR',
        label: 'AetherVSR folder',
    });
    // no workspace folder in yassinOS
    assert.equal(kit.resolveOpen('yassinOS'), null);
    assert.equal(kit.resolveOpen('doom'), null);
    assert.equal(kit.resolveOpen(''), null);
    for (const name of kit.openNames()) assert.ok(kit.resolveOpen(name), name);
    for (const link of facts.LINKS) assert.ok(facts.APPS[link.key], link.key);
});

test('tab completes commands and what open takes', () => {
    assert.equal(kit.completeInput('he'), 'help');
    assert.equal(kit.completeInput('o'), 'open ');
    assert.equal(kit.completeInput('cl'), 'clear');
    assert.equal(kit.completeInput('c'), null);
    assert.equal(kit.completeInput('zz'), null);
    assert.equal(kit.completeInput(''), null);
    assert.equal(kit.completeInput('open aet'), 'open aethervsr');
    assert.equal(kit.completeInput('open pro'), 'open projects');
    assert.equal(kit.completeInput('open p'), null);
    assert.equal(kit.completeInput('neofetch now'), null);
});

test('graphics lines read like the graphics info panel', () => {
    const info = {
        renderer:
            'ANGLE (Apple, ANGLE Metal Renderer: Apple M5, Unspecified Version)',
        vendor: 'Google Inc. (Apple)',
        kind: 'apple',
        detectedTier: 'high',
        reason: 'apple gpu',
        homeP50: 8.3,
        race: null,
        mode: 'auto',
        renderScale: 1.5,
        buffer: '2268x1350',
        viewport: '1512x900',
        devicePixelRatio: 2,
        cores: 10,
        memoryGb: 8,
        frameP50: 8.3,
        frameP95: 11.9,
        frameP99: 16.6,
        cpuP50: 2.1,
        gpuP50: null,
        gpuTimer: false,
        bound: 'gpu',
        drawCalls: 43,
        userAgent: 'test',
    };
    assert.deepEqual(kit.graphicsLines(info), [
        'Renderer: ANGLE (Apple, ANGLE Metal Renderer: Apple M5, Unspecified Version)',
        'Vendor: Google Inc. (Apple)',
        'Detected: high (apple: apple gpu)',
        'Race: not started',
        'Mode: auto, render scale 1.5x, buffer 2268x1350, viewport 1512x900 at DPR 2',
        'Frame: p50 8.3 ms, p95 11.9 ms, p99 16.6 ms',
        'CPU 2.1 ms, GPU no timer, bound: gpu, 43 draws',
        'Homepage p50: 8.3 ms',
        'CPU cores: 10, memory: 8 GB',
        'Browser: test',
    ]);
    assert.equal(
        kit.graphicsLines({
            ...info,
            race: { tier: 'low', preset: 'light', autoStep: 2, forced: true },
        })[3],
        'Race: low tier, light preset, auto step 2 (forced)'
    );
    assert.deepEqual(kit.liveStats(info), [
        ['gpu', 'Apple M5'],
        ['tier', 'high, apple gpu'],
        ['scale', '1.5x, auto'],
        ['frame', 'p50 8.3 ms, p95 11.9 ms'],
        ['draws', '43'],
    ]);
    assert.deepEqual(kit.visitorSpecs(info), {
        gpu: 'Apple M5',
        cpu: '10 cores',
        memory: 'at least 8 GB',
        display: '1512x900 at 2x',
    });
    // a context that has nothing yet
    assert.equal(kit.graphicsLines({}).length, 10);
    assert.equal(kit.liveStats({})[0][1], '(hidden by the browser)');
});

test('a context that throws or returns nothing leaves the defaults', () => {
    assert.equal(
        kit.attempt(() => {
            throw new Error('not ready');
        }, 7),
        7
    );
    assert.equal(
        kit.attempt(() => undefined, 'fallback'),
        'fallback'
    );
    assert.equal(
        kit.attempt(() => null, 'fallback'),
        null
    );
    const off = kit.subscribe(
        {
            on() {
                throw new Error('no bus');
            },
        },
        'x',
        () => {}
    );
    assert.equal(typeof off, 'function');
    const off2 = kit.subscribe({ on: () => undefined }, 'x', () => {});
    assert.equal(typeof off2, 'function');
});

test('the displays write no em or en dashes', () => {
    const files = [
        'displayKit.ts',
        'roomFacts.ts',
        'WidgetsDisplay.ts',
        'TerminalDisplay.ts',
        'preview.ts',
        'displays.css',
    ];
    for (const file of files) {
        const text = fs.readFileSync(path.join(screens, file), 'utf8');
        assert.ok(!/[\u2013\u2014]/.test(text), `${file} has an em or en dash`);
    }
});

test('every css rule in displays.css is under .room-display', () => {
    const css = fs
        .readFileSync(path.join(screens, 'displays.css'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim());
    assert.ok(selectors.length > 40);
    for (const group of selectors) {
        for (const selector of group.split(',')) {
            assert.match(
                selector.trim(),
                /^\.room-display(?![\w-])/,
                selector.trim()
            );
        }
    }
});

// width and height of a webp from its first chunk (lossy, lossless or extended)
const webpSize = (buffer) => {
    assert.equal(buffer.toString('ascii', 0, 4), 'RIFF');
    assert.equal(buffer.toString('ascii', 8, 12), 'WEBP');
    const chunk = buffer.toString('ascii', 12, 16);
    if (chunk === 'VP8X')
        return [1 + buffer.readUIntLE(24, 3), 1 + buffer.readUIntLE(27, 3)];
    if (chunk === 'VP8L') {
        const bits = buffer.readUInt32LE(21);
        return [1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff)];
    }
    assert.equal(chunk, 'VP8 ');
    return [buffer.readUInt16LE(26) & 0x3fff, buffer.readUInt16LE(28) & 0x3fff];
};

test('the room theme and span image are in place and in budget', () => {
    const dir = path.join(root, 'static/textures/room');
    const theme = JSON.parse(
        fs.readFileSync(path.join(dir, 'room-theme.json'), 'utf8')
    );
    const resolved = kit.resolveTheme(theme);
    for (const id of ['m1', 'm2', 'm3'])
        assert.ok(kit.isRect(theme.rects?.[id]), `${id} rect`);
    const image = fs.readFileSync(
        path.join(dir, theme.spanImage.split('/').pop())
    );
    assert.ok(image.length < 300 * 1024, `${image.length} bytes`);
    const [w, h] = webpSize(image);
    // each rect keeps its screen's aspect in this image
    for (const id of ['m1', 'm2', 'm3']) {
        const [, , rw, rh] = resolved.rects[id];
        const size = SCREEN_CSS_SIZE[id];
        assert.ok(
            Math.abs((rw * w) / (rh * h) - size.w / size.h) < 0.01,
            `${id} aspect in ${w}x${h}`
        );
    }
});
