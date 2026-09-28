// driving feel metrics for race mode: straight line (0-100, 0-200, top speed,
// 100-0 braking), skidpad grip at a few speeds, step steer response, and a
// handbrake drift. it swaps the track collider for a flat test pad, drives
// with direct inputs at a fixed 60 hz step, and puts everything back after.
//
// open the site with ?raceDebug=1, paste this file into the devtools console
// (or add it with a script tag), then run e.g.:
//   await __drive(['bmw-e92-m3', 'amg-one'])
//   await __drive(['bmw-e92-m3'], { only: ['skidpad'] })
// accelerations are in g, times in seconds, distances in meters.

(function () {
    const G = 9.81;
    const DT = 1 / 60;

    const waitFor = (fn, ms = 40000) =>
        new Promise((resolve, reject) => {
            const t0 = Date.now();
            (function poll() {
                if (fn()) return resolve();
                if (Date.now() - t0 > ms) return reject(new Error('timeout'));
                setTimeout(poll, 200);
            })();
        });

    window.__drive = async function (ids, options = {}) {
        const A = window.Application;
        const rm = await A.world.ensureRaceManager();
        if (!rm.active) {
            document.dispatchEvent(
                new CustomEvent('raceMode:start', { detail: { fromUI: true } })
            );
            await waitFor(() => rm.active && rm.vehicle && rm.vehicle.active);
        }
        const v = rm.vehicle;
        const THREE_ = {
            V3: v.position.constructor,
            Mesh: v.colliderMesh.constructor,
            Geometry: v.colliderMesh.geometry.constructor,
        };
        const origUpdate = rm.update;
        rm.update = function () {};
        const controls = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
        const origGetState = v.input.getState;
        const origInputUpdate = v.input.update;
        v.input.getState = () => controls;
        v.input.update = () => {};
        const recoveries = [];
        const origRestore = v.restoreFromSafeCheckpoint;
        v.restoreFromSafeCheckpoint = function (reason) {
            recoveries.push(reason);
            return origRestore.call(this, reason);
        };

        // a flat pad far under the track, on the collider layer
        const origCollider = v.colliderMesh;
        const padY = -400;
        const size = 30000;
        const positions = new Float32Array([
            -size,
            padY,
            -size,
            size,
            padY,
            -size,
            size,
            padY,
            size,
            -size,
            padY,
            size,
        ]);
        const padGeometry = new THREE_.Geometry();
        padGeometry.setAttribute(
            'position',
            new origCollider.geometry.attributes.position.constructor(
                positions,
                3
            )
        );
        padGeometry.setIndex([0, 2, 1, 0, 3, 2]);
        padGeometry.computeVertexNormals();
        padGeometry.computeBoundingBox();
        padGeometry.computeBoundingSphere();
        const pad = new THREE_.Mesh(padGeometry, origCollider.material);
        pad.visible = false;
        pad.layers.mask = origCollider.layers.mask;
        pad.updateMatrixWorld(true);
        v.colliderMesh = pad;
        const origTrackBound = v.trackBound;
        v.trackBound = false;

        const zero = () =>
            Object.assign(controls, {
                throttle: 0,
                brake: 0,
                steer: 0,
                handbrake: 0,
            });

        const place = (yaw = 0) => {
            zero();
            if (typeof v.teleport === 'function') {
                v.teleport(new THREE_.V3(0, padY, 0), yaw, 0);
            } else {
                v.position.set(0, padY + 2, 0);
                v.yaw = yaw;
                v.forward.set(Math.sin(yaw), 0, Math.cos(yaw));
                v.surfaceNormal.set(0, 1, 0);
                v.surfaceForward.copy(v.forward);
                v.speedMps = 0;
                v.lateralSpeed = 0;
                v.driftAmount = 0;
                v.verticalVelocity = 0;
                v.steerAngle = 0;
                v.gear = 1;
                v.grounded = true;
                v.stepStartY = v.position.y;
                v.lastSafePosition?.copy(v.position);
                v.fallAnchorPosition?.copy(v.position);
                v.clearSafeStateHistory?.();
                v.groundToCollider(0);
                v.updateTransform(1);
            }
            for (let i = 0; i < 30; i++) v.update(DT);
        };

        const speed = () => Math.abs(v.speedMps);
        const planarSpeed = () => Math.hypot(v.velocity.x, v.velocity.z);
        const side = new THREE_.V3();
        const prevVel = new THREE_.V3();
        const acc = new THREE_.V3();
        const lateralAccel = () => {
            acc.subVectors(v.velocity, prevVel).divideScalar(DT);
            side.set(Math.cos(v.yaw), 0, -Math.sin(v.yaw));
            return acc.dot(side);
        };
        const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
        const slipDeg = () => {
            const s = planarSpeed();
            if (s < 1) return 0;
            const heading = Math.atan2(v.velocity.x, v.velocity.z);
            return (wrap(heading - v.yaw) * 180) / Math.PI;
        };

        const tests = {
            straight() {
                place();
                let t = 0;
                let t100 = null;
                let t200 = null;
                controls.throttle = 1;
                for (let i = 0; i < 60 * 70; i++) {
                    v.update(DT);
                    t += DT;
                    const kph = speed() * 3.6;
                    if (t100 === null && kph >= 100) t100 = t;
                    if (t200 === null && kph >= 200) t200 = t;
                }
                const top = Math.round(speed() * 3.6);
                // brake from 100
                place();
                controls.throttle = 1;
                for (let i = 0; i < 60 * 30 && speed() * 3.6 < 100; i++)
                    v.update(DT);
                controls.throttle = 0;
                controls.brake = 1;
                let dist = 0;
                let steps = 0;
                const start = v.position.clone();
                while (speed() > 0.3 && steps < 60 * 20) {
                    v.update(DT);
                    steps++;
                }
                dist = Math.hypot(
                    v.position.x - start.x,
                    v.position.z - start.z
                );
                return {
                    zeroTo100s: t100 === null ? null : +t100.toFixed(2),
                    zeroTo200s: t200 === null ? null : +t200.toFixed(2),
                    topSpeedKph: top,
                    brake100to0m: +dist.toFixed(1),
                    brake100to0s: +(steps * DT).toFixed(2),
                };
            },

            skidpad() {
                // ramp the steering at a held speed and keep the best steady
                // lateral acceleration (0.5 s windows)
                const out = {};
                for (const kph of options.skidpadKph || [60, 100, 150]) {
                    place();
                    const target = kph / 3.6;
                    controls.throttle = 1;
                    for (let i = 0; i < 60 * 40 && speed() < target; i++)
                        v.update(DT);
                    let best = 0;
                    let bestSteer = 0;
                    let window_ = [];
                    let spun = false;
                    let slipMax = 0;
                    const steps = 60 * 6;
                    for (let i = 0; i < steps; i++) {
                        const steer = Math.min(1, i / (60 * 4));
                        controls.steer = steer;
                        const err = target - speed();
                        controls.throttle = Math.max(
                            0,
                            Math.min(1, err * 0.6 + 0.35)
                        );
                        controls.brake =
                            err < -1.5 ? Math.min(1, -err * 0.2) : 0;
                        prevVel.copy(v.velocity);
                        v.update(DT);
                        const a = Math.abs(lateralAccel());
                        const inBand =
                            Math.abs(speed() - target) < target * 0.06;
                        window_.push(inBand ? a : NaN);
                        if (window_.length > 30) window_.shift();
                        const valid = window_.filter((x) => !Number.isNaN(x));
                        if (valid.length === 30) {
                            const mean = valid.reduce((p, q) => p + q, 0) / 30;
                            if (mean > best) {
                                best = mean;
                                bestSteer = steer;
                            }
                        }
                        slipMax = Math.max(slipMax, Math.abs(slipDeg()));
                        if (slipMax > 90) spun = true;
                    }
                    out[`${kph}kph`] = {
                        maxLatG: +(best / G).toFixed(2),
                        atSteer: +bestSteer.toFixed(2),
                        maxSlipDeg: Math.round(slipMax),
                        spun,
                    };
                }
                return out;
            },

            stepSteer() {
                // yaw rate rise after a half steer step at 100 km/h
                const out = {};
                for (const kph of options.stepKph || [60, 120]) {
                    place();
                    const target = kph / 3.6;
                    controls.throttle = 1;
                    for (let i = 0; i < 60 * 40 && speed() < target; i++)
                        v.update(DT);
                    const rates = [];
                    let prevYaw = v.yaw;
                    for (let i = 0; i < 60 * 2.5; i++) {
                        const err = target - speed();
                        controls.throttle = Math.max(
                            0,
                            Math.min(1, err * 0.6 + 0.35)
                        );
                        controls.steer = 0.5;
                        v.update(DT);
                        rates.push(wrap(v.yaw - prevYaw) / DT);
                        prevYaw = v.yaw;
                    }
                    const steady =
                        rates.slice(-30).reduce((p, q) => p + q, 0) / 30 ||
                        1e-6;
                    const cross = (f) => {
                        const i = rates.findIndex(
                            (r) => Math.abs(r) >= Math.abs(steady) * f
                        );
                        return i < 0 ? null : +((i + 1) * DT).toFixed(2);
                    };
                    const peak = Math.max(...rates.map(Math.abs));
                    out[`${kph}kph`] = {
                        t63s: cross(0.63),
                        t90s: cross(0.9),
                        overshootPct: Math.round(
                            (peak / Math.abs(steady) - 1) * 100
                        ),
                        steadyYawDegS: +(
                            (Math.abs(steady) * 180) /
                            Math.PI
                        ).toFixed(1),
                        latG: +((Math.abs(steady) * speed()) / G).toFixed(2),
                    };
                }
                return out;
            },

            drift() {
                // handbrake flick at 80 km/h, then hold a little steer into
                // the corner and ride the throttle to keep about 30 degrees,
                // the way you'd drift on a keyboard (the countersteer assist
                // does the catching). stability and traction control off
                const assists = v.physics ? { ...v.physics.assists } : null;
                if (v.physics && !options.driftWithAssists) {
                    v.physics.assists.stability = false;
                    v.physics.assists.tractionControl = false;
                }
                place();
                const target = (options.driftKph || 80) / 3.6;
                controls.throttle = 1;
                for (let i = 0; i < 60 * 30 && speed() < target; i++)
                    v.update(DT);
                let slipMax = 0;
                let yawTotal = 0;
                let prevYaw = v.yaw;
                let heldSlip = 0;
                let heldFrames = 0;
                let spun = false;
                const trace = [];
                for (let i = 0; i < 60 * 6; i++) {
                    const t = i * DT;
                    if (t < 0.6) {
                        controls.steer = 1;
                        controls.handbrake = 1;
                        controls.throttle = 0.4;
                    } else {
                        const signed = slipDeg();
                        controls.handbrake = 0;
                        controls.steer = options.driftSteer ?? 0.3;
                        controls.throttle = Math.max(
                            0.15,
                            Math.min(1, 0.55 + (30 - Math.abs(signed)) / 30)
                        );
                    }
                    v.update(DT);
                    const s = Math.abs(slipDeg());
                    slipMax = Math.max(slipMax, s);
                    yawTotal += wrap(v.yaw - prevYaw);
                    prevYaw = v.yaw;
                    if (t > 1.2 && s > 12 && s < 60) {
                        heldSlip += s;
                        heldFrames++;
                    }
                    if (s > 100) spun = true;
                    if (i % 30 === 0) {
                        trace.push([
                            +t.toFixed(1),
                            Math.round(speed() * 3.6),
                            Math.round(slipDeg()),
                        ]);
                    }
                }
                if (assists) Object.assign(v.physics.assists, assists);
                return {
                    maxSlipDeg: Math.round(slipMax),
                    heldSlideS: +(heldFrames * DT).toFixed(2),
                    avgHeldSlipDeg: heldFrames
                        ? Math.round(heldSlip / heldFrames)
                        : 0,
                    turnedDeg: Math.round((yawTotal * 180) / Math.PI),
                    spun,
                    endKph: Math.round(speed() * 3.6),
                    trace,
                };
            },
        };

        const only = options.only || Object.keys(tests);
        const results = {};
        try {
            for (const id of ids) {
                await v.ensurePreparedModel(id);
                v.currentCarId = id;
                v.setModel(id);
                results[id] = {};
                for (const name of only) {
                    recoveries.length = 0;
                    results[id][name] = tests[name]();
                    if (recoveries.length)
                        results[id][name].recoveries = recoveries.slice();
                }
            }
        } finally {
            v.colliderMesh = origCollider;
            v.trackBound = origTrackBound;
            v.input.getState = origGetState;
            v.input.update = origInputUpdate;
            v.restoreFromSafeCheckpoint = origRestore;
            rm.update = origUpdate;
            zero();
            v.resetToStart();
        }
        return JSON.stringify(results, null, 1);
    };
    return 'drive metrics ready';
})();
