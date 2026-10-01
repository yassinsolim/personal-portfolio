// drift scoring on the drift park. a chain of points builds while the car is
// sideways, faster with more angle and speed, and its multiplier climbs the
// longer it's held. a moment straight banks the chain into the run's total;
// a wall, the grass or a spin loses it. a run is a lap

export const DRIFT_SCORE = {
    // degrees of body slip and km/h a drift needs
    minAngle: 12,
    minSpeed: 25,
    // points a second at full angle and the reference speed
    rate: 120,
    fullAngle: 40,
    refSpeed: 80,
    // the multiplier goes up a step every so many seconds held, to the cap
    stepSeconds: 2,
    step: 0.5,
    maxMultiplier: 5,
    // seconds under the drift before the chain banks
    bankAfter: 0.8,
    // seconds on the grass that lose it, and a barrier hit (m/s) that does
    grassGrace: 0.35,
    wallImpact: 1.2,
    spinAngle: 100,
};

export type DriftInput = {
    // body slip, degrees either way
    angle: number;
    speedKph: number;
    onRoad: boolean;
    // the barrier impact this frame, m/s
    impact: number;
};

export type DriftEvent =
    | { kind: 'banked'; points: number }
    | { kind: 'lost'; points: number; reason: 'wall' | 'grass' | 'spin' };

export default class DriftScore {
    total = 0;
    // points in the chain before its multiplier
    chain = 0;
    multiplier = 1;
    // seconds held sideways, and under the drift since
    held = 0;
    out = 0;
    grass = 0;
    best = 0;
    angle = 0;

    reset() {
        this.total = 0;
        this.best = 0;
        this.angle = 0;
        this.clearChain();
    }

    clearChain() {
        this.chain = 0;
        this.multiplier = 1;
        this.held = 0;
        this.out = 0;
        this.grass = 0;
    }

    get chainPoints() {
        return Math.round(this.chain * this.multiplier);
    }

    get drifting() {
        return this.chain > 0 && this.out === 0;
    }

    update(dt: number, input: DriftInput): DriftEvent | null {
        const rules = DRIFT_SCORE;
        this.angle = input.angle;
        if (this.chain > 0) {
            if (input.impact > rules.wallImpact) return this.lose('wall');
            if (input.angle > rules.spinAngle) return this.lose('spin');
            this.grass = input.onRoad ? 0 : this.grass + dt;
            if (this.grass > rules.grassGrace) return this.lose('grass');
        }
        const sideways =
            input.angle >= rules.minAngle &&
            input.angle <= rules.spinAngle &&
            input.speedKph >= rules.minSpeed &&
            input.onRoad;
        if (sideways) {
            const angle = Math.min(
                1.4,
                (input.angle - rules.minAngle) / (rules.fullAngle - rules.minAngle)
            );
            const speed = Math.min(1.6, Math.max(0.4, input.speedKph / rules.refSpeed));
            this.chain += rules.rate * (0.3 + 0.7 * angle) * speed * dt;
            this.held += dt;
            this.out = 0;
            this.multiplier = Math.min(
                rules.maxMultiplier,
                1 + rules.step * Math.floor(this.held / rules.stepSeconds)
            );
            return null;
        }
        if (this.chain <= 0) return null;
        this.out += dt;
        return this.out > rules.bankAfter ? this.bank() : null;
    }

    bank(): DriftEvent | null {
        const points = this.chainPoints;
        this.clearChain();
        if (points <= 0) return null;
        this.total += points;
        this.best = Math.max(this.best, points);
        return { kind: 'banked', points };
    }

    lose(reason: 'wall' | 'grass' | 'spin'): DriftEvent {
        const points = this.chainPoints;
        this.clearChain();
        return { kind: 'lost', points, reason };
    }

    // the end of the lap: what's still building counts
    finish() {
        this.bank();
        return this.total;
    }
}
