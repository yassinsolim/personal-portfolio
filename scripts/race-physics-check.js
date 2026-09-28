// measures race physics in the browser: per-wheel tire-to-road gaps (floating
// or sinking), airborne time, body tilt jitter, yaw rates, and recoveries while
// an autopilot drives each car along the track. optional stress scenarios hit
// the handbrake or slalom at speed.
//
// open the site with ?raceDebug=1, paste this file into the devtools console,
// then run e.g.:
//   await __race(['bmw-e92-m3', 'amg-one'], 30)
//   await __race(['bmw-e92-m3'], 16, { scenario: 'drift', atKph: 200 })
// gaps are in cm, positive means the lowest wheel is above the road.
//
// the autopilot brakes for corners (options.latG, default 75% of the car's
// tire grip up to 0.95 g), since the
// cars have real grip limits now. options.throttle holds a fixed throttle.

(function () {
    const waitFor = (fn, ms = 40000) =>
        new Promise((resolve, reject) => {
            const t0 = Date.now();
            (function poll() {
                if (fn()) return resolve();
                if (Date.now() - t0 > ms) return reject(new Error('timeout'));
                setTimeout(poll, 200);
            })();
        });

    const THREE_clamp = (value, min, max) =>
        value < min ? min : value > max ? max : value;

    const percentile = (values, p) => {
        if (!values.length) return null;
        const sorted = values.slice().sort((a, b) => a - b);
        return sorted[
            Math.min(sorted.length - 1, Math.floor(sorted.length * p))
        ];
    };

    window.__race = async function (ids, seconds = 30, options = {}) {
        const A = window.Application;
        const rm = await A.world.ensureRaceManager();
        if (!rm.active) {
            document.dispatchEvent(
                new CustomEvent('raceMode:start', { detail: { fromUI: true } })
            );
            await waitFor(() => rm.active && rm.vehicle && rm.vehicle.active);
        }
        const v = rm.vehicle;
        const V3 = v.position.constructor;
        const origUpdate = rm.update;
        rm.update = function () {};
        const controls = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
        const origGetState = v.input.getState;
        const origInputUpdate = v.input.update;
        v.input.getState = () => controls;
        v.input.update = () => {};
        const reasons = [];
        let recoveredAtStep = Infinity;
        let currentStep = 0;
        const origRestore = v.restoreFromSafeCheckpoint;
        v.restoreFromSafeCheckpoint = function (reason) {
            reasons.push(reason);
            recoveredAtStep = Math.min(recoveredAtStep, currentStep);
            return origRestore.call(this, reason);
        };

        const curve = v.track.getCurve();
        const N = 8000;
        const pts = curve.getSpacedPoints(N);
        const sampleSpacing = curve.getLength() / N;
        // corner speed limit from the curvature over the next braking window
        const curvatureAt = (i) => {
            const a = pts[(i - 4 + N) % N];
            const b = pts[i % N];
            const c = pts[(i + 4) % N];
            const h1 = Math.atan2(b.x - a.x, b.z - a.z);
            const h2 = Math.atan2(c.x - b.x, c.z - b.z);
            let dh = h2 - h1;
            dh = Math.atan2(Math.sin(dh), Math.cos(dh));
            return Math.abs(dh) / (4 * sampleSpacing);
        };
        const signedCurvature = (i) => {
            const a = pts[(i - 4 + N) % N];
            const b = pts[i % N];
            const c = pts[(i + 4) % N];
            const h1 = Math.atan2(b.x - a.x, b.z - a.z);
            const h2 = Math.atan2(c.x - b.x, c.z - b.z);
            let dh = h2 - h1;
            dh = Math.atan2(Math.sin(dh), Math.cos(dh));
            return dh / (4 * sampleSpacing);
        };
        const targetSpeedAt = (index, speed) => {
            const grip = v.physics ? v.physics.spec.tireGrip : 1.15;
            const g = (options.latG ?? Math.min(0.95, grip * 0.75)) * 9.81;
            const brake = (options.brakeG ?? 0.95) * 9.81;
            const window = Math.round(
                Math.max(40, (speed * speed) / (2 * brake) + speed) /
                    sampleSpacing
            );
            let limit = Infinity;
            for (let k = 0; k < window; k += 3) {
                const corner = Math.sqrt(
                    g / Math.max(1e-5, curvatureAt(index + k))
                );
                // can still brake from here to that corner
                const reachable = Math.sqrt(
                    corner * corner + 2 * brake * k * sampleSpacing
                );
                limit = Math.min(limit, reachable);
            }
            return limit;
        };
        const nearestIndex = (pos, hint) => {
            let best = hint;
            let bestD = Infinity;
            const span = hint < 0 ? N : 80;
            for (let k = -span; k <= span; k++) {
                const i = hint < 0 ? k + span : (((hint + k) % N) + N) % N;
                if (i < 0 || i > N) continue;
                const p = pts[i];
                const d = (p.x - pos.x) ** 2 + (p.z - pos.z) ** 2;
                if (d < bestD) {
                    bestD = d;
                    best = i;
                }
            }
            return { index: best, dist: Math.sqrt(bestD) };
        };

        // positive steer input: which way does yaw move
        const steerSign = await (async () => {
            v.resetToStart();
            controls.throttle = 0.6;
            for (let i = 0; i < 90; i++) v.update(1 / 60);
            const yaw0 = v.yaw;
            controls.steer = 1;
            for (let i = 0; i < 20; i++) v.update(1 / 60);
            const dy = v.yaw - yaw0;
            controls.steer = 0;
            controls.throttle = 0;
            return Math.sign(dy) || 1;
        })();

        const contactPoints = () => {
            const m = v.carModel;
            const rh = v.rideHeight;
            const rig = m.userData.raceWheelRig || [];
            v.carPivot.updateMatrixWorld(true);
            const toPivot = v.carPivot.matrixWorld.clone().invert();
            const corners = rig.map((w) => {
                const c = new V3();
                c.copy(w.localCenter || new V3())
                    .applyQuaternion(m.quaternion)
                    .add(m.position);
                return {
                    c,
                    r: w.radius,
                    min: Infinity,
                    parts:
                        w.radius > 0.6
                            ? [
                                  w.object,
                                  ...(w.linkedVisuals || []).map(
                                      (l) => l.object
                                  ),
                              ]
                            : null,
                };
            });
            const p3 = new V3();
            corners
                .filter((cn) => cn.parts)
                .forEach((cn) => {
                    cn.parts.forEach((part) =>
                        part.traverse((o) => {
                            if (!o.isMesh || !o.visible) return;
                            const pos = o.geometry.attributes.position;
                            const mat = toPivot.clone().multiply(o.matrixWorld);
                            for (let k = 0; k < pos.count; k++) {
                                p3.fromBufferAttribute(pos, k).applyMatrix4(
                                    mat
                                );
                                if (p3.y < cn.min) cn.min = p3.y;
                            }
                        })
                    );
                });
            m.traverse((o) => {
                if (!o.isMesh || !o.visible) return;
                const pos = o.geometry.attributes.position;
                if (!pos) return;
                const mat = toPivot.clone().multiply(o.matrixWorld);
                const step = pos.count > 200000 ? 3 : 1;
                for (let k = 0; k < pos.count; k += step) {
                    p3.fromBufferAttribute(pos, k).applyMatrix4(mat);
                    for (const cn of corners) {
                        if (cn.parts) continue;
                        const r = cn.r;
                        if (
                            Math.abs(p3.z - cn.c.z) < r * 0.35 &&
                            Math.abs(p3.x - cn.c.x) < r * 1.2 &&
                            p3.y < cn.min
                        ) {
                            cn.min = p3.y;
                        }
                    }
                }
            });
            return {
                rh,
                points: corners
                    .filter((cn) => Number.isFinite(cn.min))
                    .map((cn) => new V3(cn.c.x, cn.min, cn.c.z)),
            };
        };

        const groundY = (x, z) => {
            const hit = v.raycastGroundAt(x, z);
            return hit ? hit.point.y : null;
        };

        const results = {};
        for (const id of ids) {
            await v.ensurePreparedModel(id);
            v.currentCarId = id;
            v.setModel(id);
            v.resetToStart();
            Object.assign(controls, {
                throttle: 0,
                brake: 0,
                steer: 0,
                handbrake: 0,
            });
            reasons.length = 0;
            for (let i = 0; i < 120; i++) v.update(1 / 60);
            const cp = contactPoints();
            const world = new V3();
            const cornerGaps = () =>
                cp.points.map((p) => {
                    world.copy(p);
                    v.carPivot.localToWorld(world);
                    const g = groundY(world.x, world.z);
                    return g === null ? null : world.y - g;
                });
            const restGaps = cornerGaps().map((g) =>
                g === null ? null : +(g * 100).toFixed(1)
            );

            const gapsAll = [];
            const worstFloat = [];
            const worstSink = [];
            const jitter = [];
            const yawRates = [];
            let airborne = 0;
            let offTrack = 0;
            let barrierSteps = 0;
            let barrierHits = 0;
            const barrierLog = [];
            let wasOnBarrier = false;
            let maxSpeed = 0;
            let hint = -1;
            const prevUp = new V3(0, 1, 0).applyQuaternion(
                v.carPivot.quaternion
            );
            let prevYaw = v.yaw;
            const up = new V3();
            const steps = Math.round(seconds * 60);
            const spikes = [];
            recoveredAtStep = Infinity;
            let stuntYawMax = 0;
            let stuntTurnDeg = 0;
            let stunt = -1;
            let maxLateral = 0;
            let maxSlipDeg = 0;
            let spun = false;
            let stuntYaw = 0;
            for (let s = 0; s < steps; s++) {
                const near = nearestIndex(v.position, hint);
                hint = near.index;
                const speed = Math.abs(v.speedMps);
                const ahead = Math.round(
                    Math.max(14, speed * (options.lookahead ?? 0.7)) /
                        sampleSpacing
                );
                const target = pts[(hint + ahead) % N];
                const targetYaw = Math.atan2(
                    target.x - v.position.x,
                    target.z - v.position.z
                );
                let delta = targetYaw - v.yaw;
                delta = Math.atan2(Math.sin(delta), Math.cos(delta));
                // heading error with yaw rate damping against the path's own
                // turn rate, so it holds a line instead of weaving
                const pathTurn =
                    speed *
                    signedCurvature(hint + ahead) *
                    (options.damping === false ? 0 : 1);
                const yawRateNow = v.physics ? v.physics.yawRate : 0;
                controls.steer = Math.max(
                    -1,
                    Math.min(
                        1,
                        (delta * 3 - (yawRateNow - pathTurn) * 0.8) * steerSign
                    )
                );
                if (options.throttle !== undefined) {
                    controls.throttle = options.throttle;
                    controls.brake = 0;
                } else {
                    const target = targetSpeedAt(hint, speed);
                    controls.throttle = speed < target ? 1 : 0;
                    controls.brake = THREE_clamp(
                        (speed - target - 1) / 6,
                        0,
                        1
                    );
                }
                controls.handbrake = 0;
                // stress scenarios once the car is fast
                if (
                    options.scenario &&
                    stunt < 0 &&
                    speed * 3.6 >= (options.atKph ?? 250)
                )
                    stunt = s;
                const since = stunt < 0 ? -1 : (s - stunt) / 60;
                if (since >= 0 && since < 1.5) {
                    if (options.scenario === 'drift') {
                        controls.steer = 1;
                        controls.handbrake = 1;
                    } else if (options.scenario === 'slalom') {
                        controls.steer =
                            Math.sin(since * Math.PI * 2.5) > 0 ? 1 : -1;
                    }
                    maxLateral = Math.max(maxLateral, Math.abs(v.lateralSpeed));
                    maxSlipDeg = Math.max(
                        maxSlipDeg,
                        (Math.atan2(
                            Math.abs(v.lateralSpeed),
                            Math.max(1, speed)
                        ) *
                            180) /
                            Math.PI
                    );
                    if (since < 1 / 60) stuntYaw = v.yaw;
                }
                const yawBefore = v.yaw;
                currentStep = s;
                v.update(1 / 60);
                if (since >= 0 && since < 1.5 && s < recoveredAtStep) {
                    let d = v.yaw - yawBefore;
                    d = Math.atan2(Math.sin(d), Math.cos(d));
                    stuntYawMax = Math.max(
                        stuntYawMax,
                        (Math.abs(d) * 60 * 180) / Math.PI
                    );
                    stuntTurnDeg += (d * 180) / Math.PI;
                    if (Math.abs(stuntTurnDeg) > 135) spun = true;
                }
                if (s < 60) {
                    prevYaw = v.yaw;
                    continue;
                }
                maxSpeed = Math.max(maxSpeed, speed * 3.6);
                if (!v.grounded) airborne++;
                if (near.dist > 18) offTrack++;
                const onBarrier = Boolean(v.barrierContact);
                if (onBarrier) barrierSteps++;
                if (onBarrier && !wasOnBarrier) {
                    barrierHits++;
                    if (barrierLog.length < 8) {
                        barrierLog.push({
                            t: +(s / 60).toFixed(2),
                            kph: Math.round(speed * 3.6),
                            at: Math.round(
                                v.trackFrame ? v.trackFrame.distance : 0
                            ),
                            lateral: +(
                                v.trackFrame ? v.trackFrame.lateral : 0
                            ).toFixed(1),
                            side: v.barrierContact,
                        });
                    }
                }
                wasOnBarrier = onBarrier;
                const gaps = cornerGaps().filter((g) => g !== null);
                if (gaps.length) {
                    gapsAll.push(Math.max(...gaps));
                    worstFloat.push(Math.min(...gaps));
                    worstSink.push(Math.min(...gaps));
                }
                up.set(0, 1, 0).applyQuaternion(v.carPivot.quaternion);
                jitter.push((up.angleTo(prevUp) * 180) / Math.PI);
                prevUp.copy(up);
                let dyaw = v.yaw - prevYaw;
                dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
                yawRates.push(Math.abs(dyaw) * 60);
                if (Math.abs(dyaw) * 60 > 2 && spikes.length < 6) {
                    spikes.push({
                        t: +(s / 60).toFixed(2),
                        kph: Math.round(speed * 3.6),
                        degPerS: Math.round(
                            (Math.abs(dyaw) * 60 * 180) / Math.PI
                        ),
                        steer: +controls.steer.toFixed(2),
                        lat: +v.lateralSpeed.toFixed(2),
                        grounded: v.grounded,
                        drift: +v.driftAmount.toFixed(2),
                        barrier: v.barrierContact || 0,
                    });
                }
                prevYaw = v.yaw;
            }
            // lowest wheel gap per step: > 0 means every wheel is off the road
            const allFloat = worstFloat;
            results[id] = {
                restGapCm: restGaps,
                maxKph: Math.round(maxSpeed),
                allWheelsUpCmP50: +(
                    (percentile(allFloat, 0.5) || 0) * 100
                ).toFixed(1),
                allWheelsUpCmP95: +(
                    (percentile(allFloat, 0.95) || 0) * 100
                ).toFixed(1),
                pctStepsAllWheelsUp5cm: +(
                    (100 * allFloat.filter((g) => g > 0.05).length) /
                    Math.max(1, allFloat.length)
                ).toFixed(1),
                highestWheelCmP95: +(
                    (percentile(gapsAll, 0.95) || 0) * 100
                ).toFixed(1),
                pctStepsWheelSunk5cm: +(
                    (100 * worstSink.filter((g) => g < -0.05).length) /
                    Math.max(1, worstSink.length)
                ).toFixed(1),
                worstSinkCm: +(
                    (percentile(worstSink, 0.01) || 0) * 100
                ).toFixed(1),
                airbornePct: +(
                    (100 * airborne) /
                    Math.max(1, steps - 60)
                ).toFixed(1),
                offTrackPct: +(
                    (100 * offTrack) /
                    Math.max(1, steps - 60)
                ).toFixed(1),
                barrierHits,
                barrierLog,
                barrierPct: +(
                    (100 * barrierSteps) /
                    Math.max(1, steps - 60)
                ).toFixed(1),
                tiltJitterDegP99: +(percentile(jitter, 0.99) || 0).toFixed(2),
                tiltJitterDegMax: +Math.max(0, ...jitter).toFixed(2),
                yawRateDegP99: +(
                    ((percentile(yawRates, 0.99) || 0) * 180) /
                    Math.PI
                ).toFixed(1),
                yawRateDegMax: +(
                    (Math.max(0, ...yawRates) * 180) /
                    Math.PI
                ).toFixed(1),
                stunt: options.scenario
                    ? {
                          triggered: stunt >= 0,
                          maxLateralMps: +maxLateral.toFixed(1),
                          maxSlipDeg: +maxSlipDeg.toFixed(1),
                          yawRateMaxDeg: Math.round(stuntYawMax),
                          turnedDeg: Math.round(stuntTurnDeg),
                          spun,
                          recoveredDuringStunt: recoveredAtStep < stunt + 90,
                      }
                    : undefined,
                yawSpikes: spikes,
                recoveries: reasons.slice(),
            };
        }

        v.input.getState = origGetState;
        v.input.update = origInputUpdate;
        v.restoreFromSafeCheckpoint = origRestore;
        rm.update = origUpdate;
        Object.assign(controls, {
            throttle: 0,
            brake: 0,
            steer: 0,
            handbrake: 0,
        });
        return JSON.stringify({ steerSign, results }, null, 1);
    };
    return 'harness ready';
})();
