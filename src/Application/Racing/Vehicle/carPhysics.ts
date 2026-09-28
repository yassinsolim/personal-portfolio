import type { CarOption } from '../../carOptions';
import type { PhysicsSpec } from './VehiclePhysics';
import { rollingRadius } from './tyres';

const GRAVITY = 9.81;
// rpm between entries of the sampled torque curve
export const TORQUE_STEP = 50;

export type WheelGeometry = {
    wheelbase: number;
    trackFront: number;
    trackRear: number;
    // the model's wheel size, for looks. the drivetrain uses the tyres
    wheelRadius: number;
};

// the full load curve sampled every TORQUE_STEP rpm from 0 to past the
// limiter, straight lines between the points, flat beyond the ends
export const sampleTorqueCurve = (
    curve: [number, number][],
    maxRpm: number
) => {
    const points = curve.slice().sort((a, b) => a[0] - b[0]);
    const table: number[] = [];
    for (let rpm = 0; rpm <= maxRpm + TORQUE_STEP; rpm += TORQUE_STEP) {
        let torque = points[0][1];
        if (rpm >= points[points.length - 1][0]) {
            torque = points[points.length - 1][1];
        } else if (rpm > points[0][0]) {
            for (let i = 1; i < points.length; i++) {
                const [r1, t1] = points[i];
                if (rpm <= r1) {
                    const [r0, t0] = points[i - 1];
                    torque = t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0);
                    break;
                }
            }
        }
        table.push(torque);
    }
    return table;
};

export const carRollingRadius = (option: CarOption) =>
    rollingRadius(option.race.tyres.rear, option.race.tyres.revsPerMile);

// wheelbase and track come from the model's wheel rig when it has one, so
// the physics car is the same size as the one on screen. the wheel radius is
// the tyres' rolling radius, so revs follow road speed like the real car
export const buildPhysicsSpec = (
    option: CarOption,
    geometry: WheelGeometry
): PhysicsSpec => {
    const race = option.race;
    const tuning = race.physics;
    const box = race.transmission;
    const mass = race.massKg;
    const radius = carRollingRadius(option);
    const wheelbase = geometry.wheelbase;
    const a = wheelbase * (1 - tuning.weightFront);
    const b = wheelbase * tuning.weightFront;
    const drive = race.drivetrain;
    const sporty = drive === 'RWD' || option.id === 'amg-one';

    return {
        massKg: mass,
        wheelbase,
        trackFront: geometry.trackFront,
        trackRear: geometry.trackRear,
        weightFront: tuning.weightFront,
        cgHeight: tuning.cgHeight,
        yawInertia: mass * a * b * 1.05,
        wheelRadius: radius,
        wheelInertia: 1.2,
        engineInertia: option.id === 'amg-one' ? 0.12 : 0.2,
        tireGrip: tuning.tireGrip,
        // the rwd cars run wider rear tires
        tireGripRear: drive === 'RWD' ? 1.08 : 1.03,
        slipAnglePeak: option.id === 'amg-one' ? 0.115 : 0.13,
        slipRatioPeak: 0.11,
        tireShape: 1.4,
        loadSensitivity: 0.12,
        rollShareFront: option.id === 'amg-one' ? 0.5 : 0.56,
        loadFilterTime: 0.07,
        cdA: tuning.cdA,
        clA: tuning.clA ?? 0.1,
        aeroFront: 0.42,
        rollingResistance: 0.013,
        drive,
        frontTorqueShare: drive === 'AWD' ? tuning.frontTorqueShare ?? 0.4 : 0,
        lsdLock: sporty ? 420 : 260,
        powerW: tuning.powerKw * 1000,
        powerRpm: tuning.powerRpm,
        torqueNm: tuning.torqueNm,
        torqueRpm: tuning.torqueRpm,
        torqueTable: sampleTorqueCurve(tuning.torqueCurve, race.redlineRpm * 1.05),
        torqueStep: TORQUE_STEP,
        idleRpm: race.idleRpm,
        redlineRpm: race.redlineRpm,
        shiftUpRpm: race.shiftUpRpm,
        shiftDownRpm: race.shiftDownRpm,
        gearRatios: race.gearRatios.slice(),
        finalDrive: race.finalDrive,
        reverseRatio: race.reverseRatio,
        transmission: box.type,
        shiftTime: box.shiftTime,
        shiftTorque: box.shiftTorque,
        launchRpm: box.launchRpm,
        converterRatio: box.converterRatio ?? 1,
        drivelineEfficiency: 0.88,
        // more than the tires can use, so the limit is grip (or abs)
        brakeTorque: mass * GRAVITY * 1.6 * radius,
        brakeBias: 0.64,
        handbrakeTorque: mass * GRAVITY * 0.35 * radius,
        maxSteer: (race.maxSteerAngleDeg * Math.PI) / 180,
        speedLimit:
            race.speedLimitKph === null ? Infinity : race.speedLimitKph / 3.6,
    };
};

export const defaultWheelGeometry = (
    option: CarOption,
    wheelRadius: number
): WheelGeometry => ({
    wheelbase: option.lengthMeters * 0.59,
    trackFront: 1.6,
    trackRear: 1.6,
    wheelRadius,
});
