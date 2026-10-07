// how fast a setup is round the ring, Forza style: what the car can do
// (drive and braking at every speed, measured by driving the model on the
// flat, and grip from its tires and downforce) run over the racing line as a
// point mass. the lap time gives the performance index and its class, and
// the same speeds are the racing line's targets
import VehiclePhysics, {
    type PhysicsSpec,
    type PhysicsSurface,
} from './VehiclePhysics';

const GRAVITY = 9.81;
const AIR_DENSITY = 1.225;
const STEP = 1 / 60;
const FLAT: PhysicsSurface = {
    grounded: true,
    slopeForward: 0,
    slopeLeft: 0,
    normalScale: 1,
    grip: [1, 1, 1, 1],
    drag: [0, 0, 0, 0],
};
// the tires give a bit less sideways than the peak in a long corner, and a
// driver keeps a little in hand
const CORNER_GRIP = 0.93;
const MAX_SPEED = 140;

export type Envelope = {
    // m/s^2 at each whole m/s: flat out, and on the brakes with abs
    drive: Float32Array;
    brake: Float32Array;
    top: number;
    // lateral grip at a crawl (m/s^2), and the extra per (m/s)^2 downforce adds
    grip: number;
    aero: number;
    to100: number;
    to200: number;
};

// flat out from a standstill, then flat out on the brakes from the top
export const measureEnvelope = (spec: PhysicsSpec): Envelope => {
    const drive = new Float32Array(MAX_SPEED + 1);
    const brake = new Float32Array(MAX_SPEED + 1);
    const car = new VehiclePhysics(spec);
    car.reset(0, 0);
    const controls = { throttle: 1, brake: 0, handbrake: 0, steer: 0 };
    let t = 0;
    let bin = 0;
    let binAt = 0;
    let lastGain = 0;
    let to100 = 0;
    let to200 = 0;
    while (t < 120 && t - lastGain < 6) {
        car.step(STEP, controls, FLAT, 0);
        t += STEP;
        const v = car.vx;
        if (!to100 && v >= 100 / 3.6) to100 = t;
        if (!to200 && v >= 200 / 3.6) to200 = t;
        while (v >= bin + 1 && bin < MAX_SPEED) {
            drive[bin] = 1 / Math.max(1e-3, t - binAt);
            bin++;
            binAt = t;
            lastGain = t;
        }
    }
    const top = Math.max(1, bin);
    for (let v = bin; v <= MAX_SPEED; v++) drive[v] = 0;

    car.reset(0, Math.min(top, MAX_SPEED));
    controls.throttle = 0;
    controls.brake = 1;
    bin = Math.floor(car.vx);
    binAt = 0;
    t = 0;
    while (t < 30 && car.vx > 1 && bin > 0) {
        car.step(STEP, controls, FLAT, 0);
        t += STEP;
        while (car.vx <= bin - 1 && bin > 1) {
            brake[bin - 1] = 1 / Math.max(1e-3, t - binAt);
            bin--;
            binAt = t;
        }
    }
    const firstBrake = brake.findIndex((a) => a > 0);
    for (let v = 0; v <= MAX_SPEED; v++) {
        if (!(brake[v] > 0)) brake[v] = brake[Math.max(firstBrake, Math.min(v, top - 2))] || 9;
    }
    const mu = spec.tireGrip * Math.min(1, spec.tireGripRear) * CORNER_GRIP;
    return {
        drive,
        brake,
        top,
        grip: mu * GRAVITY,
        aero: (mu * 0.5 * AIR_DENSITY * spec.clA) / spec.massKg,
        to100,
        to200,
    };
};

const at = (table: Float32Array, v: number) => {
    const i = Math.min(table.length - 2, Math.max(0, Math.floor(v)));
    return table[i] + (table[i + 1] - table[i]) * Math.min(1, v - i);
};

export type LapPath = {
    count: number;
    // 1/m along the path, and the height for the slopes
    curvature: ArrayLike<number>;
    distance: ArrayLike<number>;
    y: ArrayLike<number>;
    length: number;
};

// the fastest the point mass gets round, and its speed at each point
export const simulateLap = (env: Envelope, path: LapPath) => {
    const n = path.count;
    const ds = new Float32Array(n);
    const slope = new Float32Array(n);
    const limit = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        let d = path.distance[j] - path.distance[i];
        if (d <= 0) d += path.length;
        ds[i] = Math.max(0.01, d);
        slope[i] = (path.y[j] - path.y[i]) / ds[i];
        const k = Math.abs(path.curvature[i]);
        // v^2 k = grip + aero v^2
        limit[i] =
            k > env.aero ? Math.min(env.top, Math.sqrt(env.grip / (k - env.aero))) : env.top;
    }
    // how much of the tires' grip a corner at this speed leaves for the pedals
    const spare = (i: number, v: number) => {
        const lateral = v * v * Math.abs(path.curvature[i]);
        const grip = env.grip + env.aero * v * v;
        const used = Math.min(1, lateral / grip);
        return Math.sqrt(1 - used * used);
    };
    const speed = Float32Array.from(limit);
    // twice round, so the start line joins up
    for (let lap = 0; lap < 2; lap++) {
        for (let k = 0; k < n; k++) {
            const i = k;
            const j = (k + 1) % n;
            const v = speed[i];
            const a = at(env.drive, v) * spare(i, v) - GRAVITY * slope[i];
            speed[j] = Math.min(speed[j], Math.sqrt(Math.max(0, v * v + 2 * a * ds[i])));
        }
        for (let k = n - 1; k >= 0; k--) {
            const i = k;
            const j = (k + 1) % n;
            const v = speed[j];
            const b = at(env.brake, v) * spare(j, v) + GRAVITY * slope[i];
            speed[i] = Math.min(speed[i], Math.sqrt(Math.max(0, v * v + 2 * b * ds[i])));
        }
    }
    let time = 0;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        time += (2 * ds[i]) / Math.max(0.5, speed[i] + speed[j]);
    }
    return { time, speed };
};

export type PerformanceClass = 'D' | 'C' | 'B' | 'A' | 'S1' | 'S2' | 'X';

// the index from the simulated lap: 999 at REFERENCE_LAP and quicker, a few
// points a second slower than that. puts the stock cars about where Forza
// has them, the Crown in C up to the Jesko at the top of S2
const REFERENCE_LAP = 346;
const POINTS_PER_SECOND = 2.6;

export const performanceIndex = (lapSeconds: number) =>
    Math.round(
        Math.min(999, Math.max(100, 999 - (lapSeconds - REFERENCE_LAP) * POINTS_PER_SECOND))
    );

export const performanceClass = (pi: number): PerformanceClass =>
    pi >= 999
        ? 'X'
        : pi > 900
          ? 'S2'
          : pi > 800
            ? 'S1'
            : pi > 700
              ? 'A'
              : pi > 600
                ? 'B'
                : pi > 500
                  ? 'C'
                  : 'D';

const bar = (value: number) => Math.round(Math.min(10, Math.max(0, value)) * 10) / 10;

// Forza's bars, 0 to 10: top speed, grip at 150 km/h, 0 to 200 and 0 to 100
// km/h, and braking from 200
export const performanceBars = (env: Envelope) => {
    const v = 150 / 3.6;
    const corner = (env.grip + env.aero * v * v) / GRAVITY;
    let stop = 0;
    for (let speed = 200 / 3.6; speed > 1; speed -= 0.5) {
        stop += (speed * 0.5) / Math.max(1, at(env.brake, speed));
    }
    return {
        speed: bar((env.top * 3.6 - 100) / 30),
        handling: bar((corner - 0.6) / 0.09),
        acceleration: env.to200 ? bar((20 - env.to200) / 1.4) : 0,
        launch: env.to100 ? bar((7 - env.to100) / 0.5) : 0,
        braking: bar((160 - stop) / 8),
    };
};
