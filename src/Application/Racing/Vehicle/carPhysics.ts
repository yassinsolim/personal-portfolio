import type { CarOption } from '../../carOptions';
import type { PhysicsSpec } from './VehiclePhysics';

const GRAVITY = 9.81;

export type WheelGeometry = {
    wheelbase: number;
    trackFront: number;
    trackRear: number;
    wheelRadius: number;
};

// wheelbase and track come from the model's wheel rig when it has one, so
// the physics car is the same size as the one on screen
export const buildPhysicsSpec = (
    option: CarOption,
    geometry: WheelGeometry
): PhysicsSpec => {
    const race = option.race;
    const tuning = race.physics;
    const mass = race.massKg;
    const radius = geometry.wheelRadius;
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
        idleRpm: race.idleRpm,
        redlineRpm: race.redlineRpm,
        shiftUpRpm: race.shiftUpRpm,
        shiftDownRpm: race.shiftDownRpm,
        gearRatios: race.gearRatios.slice(),
        finalDrive: race.finalDrive,
        reverseRatio: race.reverseRatio,
        shiftTime: tuning.shiftTime,
        launchRpm: tuning.launchRpm,
        drivelineEfficiency: 0.88,
        // more than the tires can use, so the limit is grip (or abs)
        brakeTorque: mass * GRAVITY * 1.6 * radius,
        brakeBias: 0.64,
        handbrakeTorque: mass * GRAVITY * 0.35 * radius,
        maxSteer: (race.maxSteerAngleDeg * Math.PI) / 180,
        vmax: race.topSpeedKph / 3.6 + 0.8,
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
