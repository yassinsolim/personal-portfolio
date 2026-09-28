import { carOptionsById } from '../../carOptions';

// rpm, gear and a throttle guess for cars we only know the speed of (ghosts,
// other players). uses each car's real gear ratios, final drive and shift
// points from carOptions, the same way the player car's gearbox does.

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export default class DerivedDrivetrain {
    carId: string;
    gear: number;
    rpm: number;
    throttle: number;
    lastSpeed: number;
    accel: number;
    shifted: 0 | 1 | -1;

    constructor(carId: string) {
        this.carId = carId;
        this.gear = 1;
        this.rpm = this.config().idleRpm;
        this.throttle = 0;
        this.lastSpeed = 0;
        this.accel = 0;
        this.shifted = 0;
    }

    config() {
        return (carOptionsById[this.carId] || carOptionsById['amg-one']).race;
    }

    rpmFor(speedMps: number, gear: number) {
        const race = this.config();
        const ratio = race.gearRatios[gear - 1] || race.gearRatios[race.gearRatios.length - 1] || 1;
        const wheelRpm = (Math.abs(speedMps) / (Math.PI * 2 * Math.max(0.2, race.wheelRadiusMeters))) * 60;
        return race.idleRpm + wheelRpm * ratio * race.finalDrive;
    }

    update(speedMps: number, dt: number, gearHint?: number) {
        const race = this.config();
        const maxGear = Math.max(1, race.gearRatios.length);
        const step = Math.max(1e-3, dt);
        const accel = (Math.abs(speedMps) - this.lastSpeed) / step;
        this.lastSpeed = Math.abs(speedMps);
        this.accel += (accel - this.accel) * (1 - Math.exp(-step / 0.25));
        this.shifted = 0;
        if (typeof gearHint === 'number' && gearHint >= 1) {
            const g = clamp(Math.round(gearHint), 1, maxGear);
            if (g !== this.gear) this.shifted = g > this.gear ? 1 : -1;
            this.gear = g;
        } else {
            let rpm = this.rpmFor(speedMps, this.gear);
            if (rpm > race.shiftUpRpm && this.gear < maxGear) {
                this.gear++;
                this.shifted = 1;
            } else if (rpm < race.shiftDownRpm && this.gear > 1) {
                this.gear--;
                this.shifted = -1;
            }
            rpm = this.rpmFor(speedMps, this.gear);
        }
        const target = clamp(this.rpmFor(speedMps, this.gear), race.idleRpm, race.redlineRpm);
        this.rpm += (target - this.rpm) * (1 - Math.exp(-step / 0.06));
        // pulling hard reads as full throttle, slowing down as a lift
        const thr = this.accel > 0.8 ? 0.95 : this.accel < -1.5 ? 0.05 : 0.35;
        this.throttle += (thr - this.throttle) * (1 - Math.exp(-step / 0.15));
        return { rpm: this.rpm, gear: this.gear, throttle: this.throttle, shifted: this.shifted };
    }
}
