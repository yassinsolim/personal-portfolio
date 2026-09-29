// rolling frame, cpu and gpu times for auto's decisions and the graphics
// info panel. cpu is the time spent in the app's tick (update and the render
// calls it issues), gpu comes from timer queries where the browser has them
// (EXT_disjoint_timer_query_webgl2), read back a few frames late so it never
// stalls the pipeline

const SAMPLES = 240;

export type Bound = 'gpu' | 'cpu' | 'unknown';

export type FrameSummary = {
    frames: number;
    frameP50: number;
    frameP95: number;
    frameP99: number;
    cpuP50: number;
    gpuP50: number | null;
    bound: Bound;
};

type TimerExt = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };

class Ring {
    values = new Float32Array(SAMPLES);
    count = 0;
    next = 0;

    push(value: number) {
        this.values[this.next] = value;
        this.next = (this.next + 1) % SAMPLES;
        this.count = Math.min(SAMPLES, this.count + 1);
    }

    clear() {
        this.count = 0;
        this.next = 0;
    }

    // percentiles of the newest n samples
    percentile(p: number, newest = SAMPLES) {
        const n = Math.min(this.count, newest);
        if (!n) return 0;
        const sorted: number[] = [];
        for (let i = 0; i < n; i++)
            sorted.push(this.values[(this.next - 1 - i + SAMPLES) % SAMPLES]);
        sorted.sort((a, b) => a - b);
        return sorted[Math.min(n - 1, Math.floor(p * n))];
    }
}

export default class FrameStats {
    frames = new Ring();
    cpu = new Ring();
    gpu = new Ring();
    // the homepage's first seconds, before anything heavy is built
    home = new Ring();
    homeUntil = 0;
    private gl: WebGL2RenderingContext | null = null;
    private timer: TimerExt | null = null;
    private pending: WebGLQuery[] = [];
    private query: WebGLQuery | null = null;
    private tickStart = 0;
    private lastFrame = 0;

    constructor(gl: WebGLRenderingContext | WebGL2RenderingContext) {
        if (
            typeof WebGL2RenderingContext !== 'undefined' &&
            gl instanceof WebGL2RenderingContext
        ) {
            this.gl = gl;
            this.timer = gl.getExtension(
                'EXT_disjoint_timer_query_webgl2'
            ) as TimerExt | null;
        }
    }

    get hasGpuTimer() {
        return Boolean(this.timer);
    }

    // records the homepage for this long from now
    watchHome(ms: number) {
        this.homeUntil = performance.now() + ms;
    }

    beginTick() {
        const now = performance.now();
        if (this.lastFrame) {
            const interval = now - this.lastFrame;
            // a background tab or a debugger pause isn't a frame
            if (interval < 2000) {
                this.frames.push(interval);
                if (now < this.homeUntil) this.home.push(interval);
            }
        }
        this.lastFrame = now;
        this.tickStart = now;
    }

    endTick() {
        this.cpu.push(performance.now() - this.tickStart);
    }

    beginGpu() {
        const gl = this.gl;
        if (!gl || !this.timer || this.query || this.pending.length > 4) return;
        this.query = gl.createQuery();
        if (this.query) gl.beginQuery(this.timer.TIME_ELAPSED_EXT, this.query);
    }

    endGpu() {
        const gl = this.gl;
        if (!gl || !this.timer) return;
        if (this.query) {
            gl.endQuery(this.timer.TIME_ELAPSED_EXT);
            this.pending.push(this.query);
            this.query = null;
        }
        while (this.pending.length) {
            const query = this.pending[0];
            if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
            this.pending.shift();
            if (!gl.getParameter(this.timer.GPU_DISJOINT_EXT))
                this.gpu.push(
                    gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6
                );
            gl.deleteQuery(query);
        }
    }

    // drop what was measured, after a scene switch
    reset() {
        this.frames.clear();
        this.cpu.clear();
        this.gpu.clear();
        this.lastFrame = 0;
    }

    summary(newest = 120): FrameSummary {
        const frame = this.frames.percentile(0.5, newest);
        const cpu = this.cpu.percentile(0.5, newest);
        const gpu = this.gpu.count ? this.gpu.percentile(0.5, newest) : null;
        let bound: Bound = 'unknown';
        if (gpu !== null && frame > 0) {
            // whichever side comes close to the whole frame is what holds it
            if (gpu >= frame * 0.75 && gpu >= cpu) bound = 'gpu';
            else if (cpu >= frame * 0.75 && cpu > gpu) bound = 'cpu';
        } else if (frame > 0 && cpu >= frame * 0.85) {
            // no timer: a tick that fills the frame is cpu time
            bound = 'cpu';
        }
        return {
            frames: Math.min(this.frames.count, newest),
            frameP50: frame,
            frameP95: this.frames.percentile(0.95, newest),
            frameP99: this.frames.percentile(0.99, newest),
            cpuP50: cpu,
            gpuP50: gpu,
            bound,
        };
    }
}
