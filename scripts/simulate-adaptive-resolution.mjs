// runs src/Application/Utils/AdaptiveResolution.ts against simulated devices
// (cpu cost + gpu cost per megapixel, frames snapped to vsync) so its tuning
// can be checked without hardware. usage: node scripts/simulate-adaptive-resolution.mjs
import ts from 'typescript';
import { readFileSync } from 'node:fs';

const source = readFileSync(
    new URL('../src/Application/Utils/AdaptiveResolution.ts', import.meta.url),
    'utf8'
);
const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
    },
});
const { default: AdaptiveResolution } = await import(
    `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);

const simulate = ({
    name,
    hz = 60,
    css,
    dpr,
    start,
    cpuMs,
    gpuMsPerMp,
    capFps = 0,
    seconds = 180,
    events = [],
}) => {
    const max = Math.min(dpr, 2);
    const controller = new AdaptiveResolution(0.5, max, Math.min(start, max));
    const vsync = 1000 / hz;
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let t = 0;
    let frames = 0;
    let slow = 0;
    let current = null;
    const changes = [];
    while (t < seconds * 1000) {
        const event = events.filter((e) => t >= e.at * 1000).pop() ?? null;
        if (event !== current) {
            // the renderer resets on scene switches (race mode, car change)
            controller.reset();
            current = event;
        }
        const megapixels =
            (css[0] * controller.ratio * css[1] * controller.ratio) / 1e6;
        let work = Math.max(
            cpuMs,
            gpuMsPerMp * (event?.gpuScale ?? 1) * megapixels
        );
        work += (random() - 0.5) * 2;
        // loading hitches for the first few seconds
        if (t < 4000 && random() < 0.08) work = 300 + random() * 500;
        let interval = Math.max(vsync, Math.ceil(work / vsync - 1e-9) * vsync);
        if (capFps)
            interval = Math.max(
                interval,
                Math.ceil(1000 / capFps / vsync - 1e-9) * vsync
            );
        t += interval;
        frames++;
        if (interval < 250 && 1000 / interval < 55) slow++;
        const next = controller.frame(interval, t);
        if (next !== null)
            changes.push(`${(t / 1000).toFixed(0)}s ${next.toFixed(2)}`);
    }
    console.log(`\n${name}`);
    console.log(
        `  settled at ${controller.ratio.toFixed(2)}x (max ${max}x), ${controller.fps.toFixed(0)} fps, ` +
            `${changes.length} changes, ${((100 * slow) / frames).toFixed(1)}% of frames under 55 fps`
    );
    console.log(
        `  ${changes.slice(0, 12).join(', ')}${changes.length > 12 ? ', ...' : ''}`
    );
};

simulate({
    name: 'strong laptop, 120 Hz retina',
    hz: 120,
    css: [1512, 982],
    dpr: 2,
    start: 1.5,
    cpuMs: 4,
    gpuMsPerMp: 2.6,
});
simulate({
    name: 'integrated gpu, 60 Hz 1080p',
    css: [1920, 1080],
    dpr: 1,
    start: 1.5,
    cpuMs: 5,
    gpuMsPerMp: 12,
});
simulate({
    name: 'weak phone, 60 Hz',
    css: [390, 844],
    dpr: 3,
    start: 1,
    cpuMs: 8,
    gpuMsPerMp: 38,
});
simulate({
    name: 'gaming pc, 144 Hz 1440p',
    hz: 144,
    css: [2560, 1440],
    dpr: 1,
    start: 1.5,
    cpuMs: 3,
    gpuMsPerMp: 1.2,
});
simulate({
    name: 'cpu bound (25 ms of js per frame)',
    css: [1920, 1080],
    dpr: 1,
    start: 1.5,
    cpuMs: 25,
    gpuMsPerMp: 2,
});
simulate({
    name: 'browser capped at 30 fps (safari low power)',
    css: [1512, 982],
    dpr: 2,
    start: 1.5,
    cpuMs: 4,
    gpuMsPerMp: 1.5,
    capFps: 30,
});
simulate({
    name: 'race mode from 60s to 120s (gpu cost x1.7)',
    css: [1512, 982],
    dpr: 2,
    start: 1.5,
    cpuMs: 4,
    gpuMsPerMp: 2.4,
    seconds: 240,
    events: [
        { at: 60, gpuScale: 1.7 },
        { at: 120, gpuScale: 1 },
    ],
});
simulate({
    name: 'gpu right at the edge, 60 Hz retina',
    css: [1512, 982],
    dpr: 2,
    start: 1.5,
    cpuMs: 4,
    gpuMsPerMp: 4.1,
    seconds: 600,
});
