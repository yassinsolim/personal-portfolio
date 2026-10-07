import UIEventBus from '../../UI/EventBus';
import CarAudio, { type RemoteCarAudioState, type Vec3 } from './CarAudio';
import type { EngineSound } from '../Garage/engines';

// glue between RaceManager and the race audio. keeps the old update() shape
// so the driving code only has to hand over its telemetry each frame.

type EngineTelemetry = {
    rpm: number;
    throttle: number;
    speedMps: number;
    carId: string;
    gear: number;
    slipRatio: number;
    driftIntensity: number;
    drivetrain: 'RWD' | 'AWD' | 'FWD';
    grounded?: boolean;
    suspensionCompression?: number[];
    boost?: number;
    limiter?: boolean;
    shifting?: boolean;
    impact?: number;
    barrierContact?: number;
    onKerb?: boolean;
    onGrass?: boolean;
    engine?: EngineSound;
};

export default class RaceEngineAudio {
    carAudio: CarAudio;
    raceActive: boolean;

    constructor() {
        this.carAudio = new CarAudio();
        this.raceActive = false;

        UIEventBus.on('muteToggle', (muted: boolean) => {
            this.carAudio.setMuted(Boolean(muted));
        });
        UIEventBus.on('masterVolumeChange', (payload: { volume?: number } | undefined) => {
            if (typeof payload?.volume === 'number') {
                this.carAudio.setVolume(payload.volume);
            }
        });
        UIEventBus.on('race:resetVehicle', () => {
            this.carAudio.resetMotion();
        });
        UIEventBus.on('race:restartLap', () => {
            this.carAudio.resetMotion();
        });
    }

    setRaceActive(active: boolean) {
        this.raceActive = active;
        if (active) this.carAudio.resetMotion();
        this.carAudio.setActive(active);
        if (!active) this.carAudio.clearRemotes();
    }

    setPaused(paused: boolean) {
        this.carAudio.setPaused(paused);
    }

    update(telemetry: EngineTelemetry, deltaSeconds: number) {
        this.carAudio.update(
            {
                carId: telemetry.carId,
                rpm: telemetry.rpm,
                throttle: telemetry.throttle,
                speedKph: Math.abs(telemetry.speedMps || 0) * 3.6,
                gear: telemetry.gear,
                slip: telemetry.slipRatio,
                drift: telemetry.driftIntensity,
                grounded: telemetry.grounded,
                suspension: telemetry.suspensionCompression,
                boost: telemetry.boost,
                limiter: telemetry.limiter,
                shifting: telemetry.shifting,
                impact: telemetry.impact,
                scrape: telemetry.barrierContact ? 1 : 0,
                kerb: telemetry.onKerb,
                grass: telemetry.onGrass,
                engine: telemetry.engine,
            },
            deltaSeconds
        );
    }

    // camera for the listener, plus ghost and multiplayer cars to place in 3d
    updateWorld(
        listener: { position: Vec3; forward: Vec3; up: Vec3 } | null,
        remotes: RemoteCarAudioState[],
        deltaSeconds: number
    ) {
        if (listener) {
            this.carAudio.setListener(listener.position, listener.forward, listener.up);
        }
        this.carAudio.updateRemotes(this.raceActive ? remotes : [], deltaSeconds);
    }

    setHorn(on: boolean) {
        this.carAudio.setHorn(on);
    }

    setRemoteHorn(id: string, on: boolean) {
        this.carAudio.setRemoteHorn(id, on);
    }
}
