// the race world is built by generators that yield between pieces of work,
// so it can be built all at once (tests, a direct start) or a few ms a
// frame (the homepage hover) without the page stalling. a yielded string
// names the piece that just finished, for timing it
export type Steps = Generator<string | void, void, void>;

// window.__raceBuildSteps = {} collects the longest run of each piece
type StepTimes = Record<string, number>;

// runs every step now, and returns what the generator does
export function drain<T>(steps: Generator<string | void, T, void>): T {
    for (;;) {
        const step = steps.next();
        if (step.done) return step.value;
    }
}

// resolves in a task of its own right after the next frame. work there
// isn't added to the frame's task (the app's render), which on its own is
// what a long task is measured by
let channel: MessageChannel | null = null;
const waiting: (() => void)[] = [];

export function afterFrame() {
    if (!channel) {
        channel = new MessageChannel();
        channel.port1.onmessage = () => waiting.shift()?.();
    }
    const port = channel.port2;
    return new Promise<void>((resolve) => {
        const run = () => {
            waiting.push(resolve);
            port.postMessage(0);
        };
        // frames stop in a hidden tab, the build shouldn't
        if (document.hidden) run();
        else requestAnimationFrame(run);
    });
}

// runs the steps in slices of about budgetMs, one slice a frame. the first
// waits a frame too, so it isn't added to whatever task called this (like
// the one that just ran a freshly loaded chunk)
export async function slice(steps: Steps, budgetMs = 8) {
    const times = (window as unknown as { __raceBuildSteps?: StepTimes })
        .__raceBuildSteps;
    await afterFrame();
    let start = performance.now();
    let last = start;
    for (;;) {
        const { done, value } = steps.next();
        if (done) return;
        const now = performance.now();
        if (times) {
            const name = value || '(step)';
            times[name] = Math.max(times[name] || 0, now - last);
        }
        last = now;
        if (now - start > budgetMs) {
            await afterFrame();
            start = performance.now();
            last = start;
        }
    }
}
