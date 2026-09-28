import * as THREE from 'three';
import type RaceVehicle from '../Vehicle/RaceVehicle';

// contact between the local car and the other players' cars. both clients push
// their own car out by its share of the overlap (the lighter car gives more),
// but only one of the pair resolves the impulse: the lower session id. it
// applies its half and sends the other car the equal and opposite half, so
// momentum is shared even though each side sees the other ~50-100 ms late.
// boxes are the cars' footprints in the ground plane
const RESTITUTION = 0.15;
const FRICTION = 0.3;
// share of the overlap corrected per physics step, the rest next step
const PUSH_RATE = 0.5;
// one bump can't change the speed by more than this, m/s
const MAX_DELTA_V = 14;
// poses older than this are too far off to hit
const STALE_MS = 600;
// after a bump the other car's velocity here is stale until its next
// telemetry, so no second impulse for the pair until then
const PAIR_COOLDOWN_MS = 180;

export type RemoteCar = {
    sessionId: string;
    x: number;
    z: number;
    y: number;
    yaw: number;
    vx: number;
    vz: number;
    yawRate: number;
    halfLength: number;
    halfWidth: number;
    massKg: number;
    ghost: boolean;
    ageMs: number;
};

type Box = {
    x: number;
    z: number;
    fx: number;
    fz: number;
    hl: number;
    hw: number;
};

const corners = (box: Box) => {
    const rx = box.fz;
    const rz = -box.fx;
    const out: [number, number][] = [];
    for (const a of [box.hl, -box.hl]) {
        for (const b of [box.hw, -box.hw]) {
            out.push([
                box.x + box.fx * a + rx * b,
                box.z + box.fz * a + rz * b,
            ]);
        }
    }
    return out;
};

const inside = (box: Box, px: number, pz: number, margin = 0) => {
    const dx = px - box.x;
    const dz = pz - box.z;
    const along = dx * box.fx + dz * box.fz;
    const across = dx * box.fz - dz * box.fx;
    return (
        Math.abs(along) <= box.hl + margin &&
        Math.abs(across) <= box.hw + margin
    );
};

export default class CarCollisions {
    vehicle: RaceVehicle;
    // true while the local car can't touch anyone (just reset, or still
    // overlapping someone when that ran out)
    ghost: boolean;
    ghostUntil: number;
    lastResets: number;
    contacts: number;
    lastImpact: number;
    localSessionId: string;
    sendBump:
        | ((bump: {
              target: string;
              ix: number;
              iz: number;
              px: number;
              pz: number;
          }) => void)
        | null;
    private cooldown: Map<string, number>;
    private local: Box;
    private other: Box;

    constructor(vehicle: RaceVehicle) {
        this.vehicle = vehicle;
        this.ghost = true;
        this.ghostUntil = 0;
        this.lastResets = -1;
        this.contacts = 0;
        this.lastImpact = 0;
        this.localSessionId = '';
        this.sendBump = null;
        this.cooldown = new Map();
        this.local = { x: 0, z: 0, fx: 0, fz: 1, hl: 2.3, hw: 1 };
        this.other = { x: 0, z: 0, fx: 0, fz: 1, hl: 2.3, hw: 1 };
    }

    // after a reset or teleport the car is a ghost for a few seconds, so a
    // grid of cars spawning on the same line doesn't explode
    ghostFor(seconds: number) {
        this.ghostUntil = Math.max(
            this.ghostUntil,
            performance.now() + seconds * 1000
        );
        this.ghost = true;
    }

    overlap(a: Box, b: Box) {
        const axes: [number, number][] = [
            [a.fx, a.fz],
            [a.fz, -a.fx],
            [b.fx, b.fz],
            [b.fz, -b.fx],
        ];
        const dx = a.x - b.x;
        const dz = a.z - b.z;
        let best = Infinity;
        let nx = 0;
        let nz = 0;
        for (const [ax, az] of axes) {
            const ra =
                a.hl * Math.abs(a.fx * ax + a.fz * az) +
                a.hw * Math.abs(a.fz * ax - a.fx * az);
            const rb =
                b.hl * Math.abs(b.fx * ax + b.fz * az) +
                b.hw * Math.abs(b.fz * ax - b.fx * az);
            const d = dx * ax + dz * az;
            const depth = ra + rb - Math.abs(d);
            if (depth <= 0) return null;
            if (depth < best) {
                best = depth;
                // pointing from the other car to this one
                const sign = d >= 0 ? 1 : -1;
                nx = ax * sign;
                nz = az * sign;
            }
        }
        return { depth: best, nx, nz };
    }

    // the other client's half of a contact it resolved
    applyBump(bump: { ix: number; iz: number; px: number; pz: number }) {
        const vehicle = this.vehicle;
        const physics = vehicle.physics;
        const sin = Math.sin(vehicle.yaw);
        const cos = Math.cos(vehicle.yaw);
        const relX = bump.px - vehicle.position.x;
        const relZ = bump.pz - vehicle.position.z;
        // too far from here to be about this car any more (a reset)
        if (relX * relX + relZ * relZ > 64) return;
        const massA = physics.spec.massKg;
        let ix = bump.ix;
        let iz = bump.iz;
        const size = Math.hypot(ix, iz);
        if (size > MAX_DELTA_V * massA) {
            ix *= (MAX_DELTA_V * massA) / size;
            iz *= (MAX_DELTA_V * massA) / size;
        }
        physics.applyImpulse(
            relX * sin + relZ * cos,
            relX * cos - relZ * sin,
            ix * sin + iz * cos,
            ix * cos - iz * sin
        );
        vehicle.impact = Math.max(vehicle.impact, Math.hypot(ix, iz) / massA);
        vehicle.barrierPoint.set(bump.px, vehicle.position.y + 0.4, bump.pz);
        vehicle.syncFromPhysics();
    }

    resolve(remotes: RemoteCar[]) {
        const vehicle = this.vehicle;
        const physics = vehicle.physics;
        if (vehicle.startResets !== this.lastResets) {
            this.lastResets = vehicle.startResets;
            this.ghostFor(3);
        }
        const now = performance.now();
        const sin = Math.sin(vehicle.yaw);
        const cos = Math.cos(vehicle.yaw);
        Object.assign(this.local, {
            x: vehicle.position.x,
            z: vehicle.position.z,
            fx: sin,
            fz: cos,
            hl: vehicle.bodySize.z * 0.48,
            hw: vehicle.bodySize.x * 0.46,
        });
        let touching = false;
        let impact = 0;
        this.contacts = 0;
        for (const remote of remotes) {
            if (remote.ageMs > STALE_MS) continue;
            if (Math.abs(remote.y - vehicle.position.y) > 3) continue;
            Object.assign(this.other, {
                x: remote.x,
                z: remote.z,
                fx: Math.sin(remote.yaw),
                fz: Math.cos(remote.yaw),
                hl: remote.halfLength,
                hw: remote.halfWidth,
            });
            const hit = this.overlap(this.local, this.other);
            if (!hit) continue;
            touching = true;
            if (this.ghost || remote.ghost) continue;
            this.contacts++;
            const authority = this.localSessionId < remote.sessionId;

            // contact point: corners of either box inside the other, averaged
            let px = 0;
            let pz = 0;
            let count = 0;
            for (const [cx, cz] of corners(this.other)) {
                if (inside(this.local, cx, cz, 0.05)) {
                    px += cx;
                    pz += cz;
                    count++;
                }
            }
            for (const [cx, cz] of corners(this.local)) {
                if (inside(this.other, cx, cz, 0.05)) {
                    px += cx;
                    pz += cz;
                    count++;
                }
            }
            if (count) {
                px /= count;
                pz /= count;
            } else {
                px = (this.local.x + this.other.x) / 2;
                pz = (this.local.z + this.other.z) / 2;
            }

            const massA = physics.spec.massKg;
            const massB = Math.max(500, remote.massKg);
            const share = massB / (massA + massB);
            vehicle.position.x += hit.nx * hit.depth * share * PUSH_RATE;
            vehicle.position.z += hit.nz * hit.depth * share * PUSH_RATE;

            // into the body frame: x forward, y left
            const relX = px - vehicle.position.x;
            const relZ = pz - vehicle.position.z;
            const pointX = relX * sin + relZ * cos;
            const pointY = relX * cos - relZ * sin;
            const nx = hit.nx * sin + hit.nz * cos;
            const ny = hit.nx * cos - hit.nz * sin;
            const own = physics.pointVelocity(pointX, pointY);
            // the other car's velocity at the contact, in this body frame
            const ox = remote.vx - remote.yawRate * (pz - remote.z);
            const oz = remote.vz + remote.yawRate * (px - remote.x);
            const otherX = ox * sin + oz * cos;
            const otherY = ox * cos - oz * sin;
            const relVX = own.x - otherX;
            const relVY = own.y - otherY;
            const into = relVX * nx + relVY * ny;
            if (into >= 0) continue;
            // the other client resolves this pair, its half arrives as a bump
            if (!authority) continue;
            if ((this.cooldown.get(remote.sessionId) ?? 0) > now) continue;
            this.cooldown.set(remote.sessionId, now + PAIR_COOLDOWN_MS);
            // this car's share of the exchange, with its own rotation
            const massHere = physics.effectiveMass(pointX, pointY, nx, ny);
            const reduced = 1 / (1 / massHere + 1 / massB);
            let normalImpulse = -(1 + RESTITUTION) * into * reduced;
            normalImpulse = Math.min(normalImpulse, MAX_DELTA_V * massA);
            const tx = -ny;
            const ty = nx;
            const along = relVX * tx + relVY * ty;
            const tangentMass = physics.effectiveMass(pointX, pointY, tx, ty);
            const frictionImpulse = THREE.MathUtils.clamp(
                -along * (1 / (1 / tangentMass + 1 / massB)),
                -FRICTION * normalImpulse,
                FRICTION * normalImpulse
            );
            const impulseX = nx * normalImpulse + tx * frictionImpulse;
            const impulseY = ny * normalImpulse + ty * frictionImpulse;
            physics.applyImpulse(pointX, pointY, impulseX, impulseY);
            impact = Math.max(impact, normalImpulse / massA);
            // the equal and opposite half, back to world for the other car
            const worldX = impulseX * sin + impulseY * cos;
            const worldZ = impulseX * cos - impulseY * sin;
            this.sendBump?.({
                target: remote.sessionId,
                ix: -worldX,
                iz: -worldZ,
                px,
                pz,
            });
            vehicle.barrierPoint.set(px, vehicle.position.y + 0.4, pz);
        }
        // the ghost wears off only once clear of everyone
        if (this.ghost && now > this.ghostUntil && !touching)
            this.ghost = false;
        if (impact > 0) {
            vehicle.impact = Math.max(vehicle.impact, impact);
            vehicle.syncFromPhysics();
        }
        this.lastImpact = impact;
    }
}
