const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = 'c:/Users/solim/personal-portfolio';
const OUT_DIR = path.join(ROOT, '.tmp-validation');
const URL =
    process.env.RACE_VALIDATION_URL || 'http://127.0.0.1:8137/?raceDebug=1';
const LOCAL_LEADERBOARD_KEY = 'yassinverse:nordschleife:leaderboard:v1';

function ensureOutDir() {
    fs.mkdirSync(OUT_DIR, { recursive: true });
}

function normalizeAngleDelta(from, to) {
    let delta = to - from;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return delta;
}

async function ensureRaceStarted(page) {
    await page.goto(URL, {
        waitUntil: 'domcontentloaded',
        timeout: 180000,
    });

    await page.waitForFunction(
        () => Boolean(window.Application?.world?.raceManager),
        null,
        {
            timeout: 180000,
        }
    );

    await page.waitForSelector('text=Start Nordschleife race', {
        timeout: 180000,
    });
    await page.waitForTimeout(1200);
    await page.click('text=Start Nordschleife race');
    await page.waitForTimeout(1200);
    await page.mouse.click(960, 540);
}

async function ensureCar(page, carId, timeoutMs = 180000) {
    await page.selectOption('#car-switcher', carId);
    await page.waitForFunction(
        (id) => {
            const vehicle = window.Application?.world?.raceManager?.vehicle;
            if (!vehicle) return false;
            if (vehicle.currentCarId !== id) return false;
            if (vehicle.loadingPromises?.has && vehicle.loadingPromises.has(id)) {
                return false;
            }
            return true;
        },
        carId,
        { timeout: timeoutMs }
    );
    await page.waitForTimeout(1000);
}

async function setupRaceEventCapture(page) {
    await page.evaluate(() => {
        if (window.__raceValidationCaptureInstalled) {
            return;
        }

        window.__raceValidationCaptureInstalled = true;
        window.__raceValidationCapture = {
            lapCompleted: [],
            leaderboardUpdates: [],
            lapSubmitted: [],
        };

        document.addEventListener('race:lapCompleted', (event) => {
            const detail = event?.detail || {};
            window.__raceValidationCapture.lapCompleted.push({
                lapTimeMs: Number(detail.lapTimeMs || 0),
                carId: String(detail.carId || 'unknown'),
                timestamp: Date.now(),
            });
        });

        document.addEventListener('race:leaderboardUpdate', (event) => {
            const detail = event?.detail || {};
            const entries = Array.isArray(detail.entries) ? detail.entries : [];
            window.__raceValidationCapture.leaderboardUpdates.push({
                count: entries.length,
                topName: entries[0]?.name || null,
                topLapMs: Number(entries[0]?.lapTimeMs || 0),
                timestamp: Date.now(),
            });
        });

        document.addEventListener('race:lapSubmitted', (event) => {
            const detail = event?.detail || {};
            const entry = detail.entry || {};
            window.__raceValidationCapture.lapSubmitted.push({
                name: String(entry.name || ''),
                lapTimeMs: Number(entry.lapTimeMs || 0),
                carId: String(entry.carId || ''),
                timestamp: Date.now(),
            });
        });
    });
}

async function collectSteeringMetrics(page) {
    await ensureCar(page, 'amg-one');
    const steerA = await page.evaluate(() => {
        const rm = window.Application.world.raceManager;
        const vehicle = rm.vehicle;
        rm.setPaused(false);
        vehicle.resetToStart();
        vehicle.input.reset();
        vehicle.input.keyState.KeyW = true;
        vehicle.input.keyState.KeyA = true;

        const yawStart = vehicle.yaw;
        for (let i = 0; i < 110; i++) {
            vehicle.update(1 / 60);
        }
        const yawAfter = vehicle.yaw;
        vehicle.input.reset();
        return {
            yawStart,
            yawAfter,
        };
    });
    await page.screenshot({
        path: path.join(OUT_DIR, 'steering_A_regression.png'),
    });

    const steerD = await page.evaluate(() => {
        const rm = window.Application.world.raceManager;
        const vehicle = rm.vehicle;
        rm.setPaused(false);
        vehicle.resetToStart();
        vehicle.input.reset();
        vehicle.input.keyState.KeyW = true;
        vehicle.input.keyState.KeyD = true;

        const yawStart = vehicle.yaw;
        for (let i = 0; i < 110; i++) {
            vehicle.update(1 / 60);
        }
        const yawAfter = vehicle.yaw;
        vehicle.input.reset();
        return {
            yawStart,
            yawAfter,
        };
    });
    await page.screenshot({
        path: path.join(OUT_DIR, 'steering_D_regression.png'),
    });

    return {
        yawDeltaA: normalizeAngleDelta(steerA.yawStart, steerA.yawAfter),
        yawDeltaD: normalizeAngleDelta(steerD.yawStart, steerD.yawAfter),
    };
}

async function collectWheelMetrics(page, carId, screenshotName) {
    await ensureCar(page, carId);

    const wheelMetrics = await page.evaluate(() => {
        const rm = window.Application.world.raceManager;
        const vehicle = rm.vehicle;
        const wheels = vehicle.wheelRig || [];
        const brakeRegex = /(brake|disc|disk|rotor|caliper|hub)/i;

        const getMaterialNames = (object) => {
            if (!object?.isMesh || !object.material) return [];
            if (Array.isArray(object.material)) {
                return object.material.map((material) =>
                    String(material?.name || '')
                );
            }
            return [String(object.material?.name || '')];
        };

        const signedAngleAroundAxis = (qFrom, qTo, axis) => {
            const inv = {
                x: -qFrom.x,
                y: -qFrom.y,
                z: -qFrom.z,
                w: qFrom.w,
            };
            const dq = {
                x:
                    inv.w * qTo.x +
                    inv.x * qTo.w +
                    inv.y * qTo.z -
                    inv.z * qTo.y,
                y:
                    inv.w * qTo.y -
                    inv.x * qTo.z +
                    inv.y * qTo.w +
                    inv.z * qTo.x,
                z:
                    inv.w * qTo.z +
                    inv.x * qTo.y -
                    inv.y * qTo.x +
                    inv.z * qTo.w,
                w:
                    inv.w * qTo.w -
                    inv.x * qTo.x -
                    inv.y * qTo.y -
                    inv.z * qTo.z,
            };
            const norm = Math.hypot(dq.x, dq.y, dq.z, dq.w) || 1;
            dq.x /= norm;
            dq.y /= norm;
            dq.z /= norm;
            dq.w /= norm;

            const sinHalf = Math.sqrt(Math.max(0, 1 - dq.w * dq.w));
            if (sinHalf < 1e-6) return 0;
            const axisDelta = {
                x: dq.x / sinHalf,
                y: dq.y / sinHalf,
                z: dq.z / sinHalf,
            };

            let angle = 2 * Math.acos(Math.min(1, Math.max(-1, dq.w)));
            if (angle > Math.PI) angle -= Math.PI * 2;

            const dot =
                axisDelta.x * axis.x +
                axisDelta.y * axis.y +
                axisDelta.z * axis.z;
            const sign = Math.sign(dot) || 1;
            return angle * sign;
        };

        const wheelEntries = wheels.map((wheel) => {
            const name = String(wheel.object?.name || '');
            const parent = String(wheel.object?.parent?.name || '');
            const materialNames = getMaterialNames(wheel.object);
            const combined = [name, parent, ...materialNames].join(' ');
            return {
                name,
                parent,
                materialNames,
                front: Boolean(wheel.front),
                left: Boolean(wheel.left),
                radius: Number(wheel.radius || 0),
                brakeLike: brakeRegex.test(combined),
            };
        });

        vehicle.resetWheelVisuals();
        vehicle.wheelSpinAngle = 0;
        vehicle.steerAngle = 0;
        vehicle.steerVisualAngle = 0;

        const qStart = wheels.map((wheel) => wheel.object.quaternion.clone());
        vehicle.speedMps = 14;
        vehicle.updateWheelVisuals(0.2);
        const qForward = wheels.map((wheel) => wheel.object.quaternion.clone());
        vehicle.speedMps = -14;
        vehicle.updateWheelVisuals(0.2);
        const qReverse = wheels.map((wheel) => wheel.object.quaternion.clone());

        const spinChecks = wheels.map((wheel, index) => {
            const axis = wheel.spinAxis.clone().normalize();
            const forwardAngle = signedAngleAroundAxis(
                qStart[index],
                qForward[index],
                axis
            );
            const reverseAngle = signedAngleAroundAxis(
                qForward[index],
                qReverse[index],
                axis
            );
            return {
                name: String(wheel.object?.name || ''),
                axis: {
                    x: Number(axis.x.toFixed(6)),
                    y: Number(axis.y.toFixed(6)),
                    z: Number(axis.z.toFixed(6)),
                },
                forwardAngle,
                reverseAngle,
                oppositeDirection: forwardAngle * reverseAngle < 0,
            };
        });

        vehicle.resetWheelVisuals();
        vehicle.wheelSpinAngle = 0;
        vehicle.steerAngle = 0;
        vehicle.steerVisualAngle = 0;
        vehicle.updateWheelVisuals(0.016);

        const frontWheels = wheels.filter((wheel) => wheel.front);
        const frontBefore = frontWheels.map((wheel) =>
            wheel.object.quaternion.clone()
        );
        vehicle.steerAngle = 0.5;
        vehicle.updateWheelVisuals(0.18);
        const frontAfter = frontWheels.map((wheel) =>
            wheel.object.quaternion.clone()
        );
        const frontSteerDelta = frontWheels.map((wheel, index) => ({
            name: String(wheel.object?.name || ''),
            deltaRad: frontBefore[index].angleTo(frontAfter[index]),
        }));

        return {
            wheelRigCount: wheels.length,
            wheelNodeNames: wheelEntries.map((entry) => entry.name),
            wheelEntries,
            nonBrakeNodes: wheelEntries.every((entry) => !entry.brakeLike),
            spinChecks,
            frontSteerDelta,
            frontSteerAllChanged: frontSteerDelta.every(
                (entry) => entry.deltaRad > 0.01
            ),
        };
    });

    await page.evaluate(() => {
        const rm = window.Application.world.raceManager;
        rm.vehicle.resetToStart();
        rm.setPaused(false);
        rm.vehicle.steerAngle = 0.45;
        rm.vehicle.speedMps = 12;
        rm.vehicle.updateWheelVisuals(0.2);
    });
    await page.waitForTimeout(220);
    await page.screenshot({
        path: path.join(OUT_DIR, screenshotName),
    });

    return wheelMetrics;
}

async function collectToyotaOrientation(page) {
    await ensureCar(page, 'toyota-crown-platinum');

    const orientation = await page.evaluate(() => {
        const rm = window.Application.world.raceManager;
        const vehicle = rm.vehicle;
        vehicle.resetToStart();

        const bodyForward = vehicle.forward
            .clone()
            .set(0, 0, 1)
            .applyQuaternion(vehicle.carPivot.quaternion)
            .setY(0)
            .normalize();
        const vehicleForward = vehicle.forward.clone().setY(0).normalize();

        const closestIndex = rm.lapTimer.getClosestSampleIndex(vehicle.position.clone());
        const curveCount = Math.max(1, rm.lapTimer.samplePoints.length - 1);
        const t = closestIndex / curveCount;
        const trackForward = rm.track
            .getCurve()
            .getTangentAt(t)
            .setY(0)
            .normalize();

        return {
            bodyVsTrackDot: bodyForward.dot(trackForward),
            bodyVsVehicleDot: bodyForward.dot(vehicleForward),
            vehicleVsTrackDot: vehicleForward.dot(trackForward),
        };
    });

    await page.screenshot({
        path: path.join(OUT_DIR, 'toyota_orientation_regression.png'),
    });

    return orientation;
}

async function collectLapAndLeaderboardEvidence(page) {
    await page.evaluate(() => {
        const rm = window.Application.world.raceManager;
        if (window.__raceValidationCapture) {
            window.__raceValidationCapture.lapCompleted = [];
            window.__raceValidationCapture.leaderboardUpdates = [];
            window.__raceValidationCapture.lapSubmitted = [];
        }

        window.localStorage.removeItem('yassinverse:nordschleife:ghost:v1');
        window.localStorage.removeItem('yassinverse:nordschleife:leaderboard:v1');
        rm.localLeaderboard.entries = [];
        rm.localLeaderboard.write();
        rm.pendingLapTimeMs = 0;
        rm.setPaused(false);
    });

    await page.waitForTimeout(150);

    const lapCompletion = await page.evaluate(() => {
        const application = window.Application;
        const rm = application.world.raceManager;
        const vehicle = rm.vehicle;
        const timer = rm.lapTimer;

        vehicle.active = false;
        const now = application.time.elapsed;
        timer.lapRunning = true;
        timer.lapStartMs = now - 36000;
        timer.maxProgress = 0.985;
        timer.previousDistance = -8;
        timer.lastCrossTimestampMs = now - 5000;

        const forward = timer.startNormal.clone().setY(0).normalize();
        vehicle.position.copy(timer.startPoint).addScaledVector(forward, 10);
        vehicle.forward.copy(forward);
        vehicle.yaw = Math.atan2(vehicle.forward.x, vehicle.forward.z);
        vehicle.speedMps = 24;
        vehicle.velocity.copy(vehicle.forward).multiplyScalar(vehicle.speedMps);

        application.time.delta = 16;
        application.time.elapsed = now + 16;
        rm.update();
        vehicle.active = true;

        return {
            pendingLapTimeMs: rm.pendingLapTimeMs,
            pausedAfterLap: rm.paused,
        };
    });

    await page.waitForSelector('.lap-name-overlay', { timeout: 15000 });
    await page.fill('.lap-name-panel input', 'RegressionBot');
    await page.click('.lap-name-panel button:has-text("Save Lap")');
    await page.waitForSelector('.lap-name-overlay', {
        state: 'hidden',
        timeout: 15000,
    });

    await page.waitForFunction(
        () => {
            const capture = window.__raceValidationCapture;
            return (
                capture &&
                capture.leaderboardUpdates &&
                capture.leaderboardUpdates.length > 0 &&
                document.querySelectorAll('.race-hud-board ol li').length > 0
            );
        },
        null,
        { timeout: 15000 }
    );

    await page.screenshot({
        path: path.join(OUT_DIR, 'lap_leaderboard_regression.png'),
    });

    const flowState = await page.evaluate(() => {
        const rm = window.Application.world.raceManager;
        const capture = window.__raceValidationCapture || {
            lapCompleted: [],
            leaderboardUpdates: [],
            lapSubmitted: [],
        };

        let localEntries = [];
        try {
            localEntries = JSON.parse(
                window.localStorage.getItem('yassinverse:nordschleife:leaderboard:v1') ||
                    '[]'
            );
        } catch {
            localEntries = [];
        }

        const leaderboardRows = Array.from(
            document.querySelectorAll('.race-hud-board ol li')
        ).map((row) =>
            Array.from(row.querySelectorAll('span'))
                .map((span) => span.textContent?.trim() || '')
                .filter(Boolean)
        );

        return {
            lapCompletionState: {
                pendingLapTimeMs: rm.pendingLapTimeMs,
                paused: rm.paused,
            },
            lapCompletedEvents: capture.lapCompleted,
            lapSubmittedEvents: capture.lapSubmitted,
            leaderboardUpdateEvents: capture.leaderboardUpdates,
            leaderboardRows,
            localLeaderboardCount: localEntries.length,
            localLeaderboardTop: localEntries[0] || null,
        };
    });

    return {
        forcedLapCompletion: lapCompletion,
        ...flowState,
    };
}

async function collectDriftMetrics(page) {
    await ensureCar(page, 'bmw-e92-m3');
    const drift = await page.evaluate(() => {
        const rm = window.Application.world.raceManager;
        const vehicle = rm.vehicle;

        rm.setPaused(false);
        vehicle.resetToStart();
        vehicle.speedMps = 20;
        vehicle.lateralSpeed = 0;
        vehicle.driftAmount = 0;
        vehicle.smoke.clear();
        vehicle.smokeSpawnCooldown = 0;

        const dt = 1 / 60;
        let maxSlipDeg = 0;
        let maxVisualDeg = 0;
        let maxDriftIntensity = 0;
        let wrongFacingFrames = 0;

        for (let i = 0; i < 280; i++) {
            vehicle.updateSteering(dt, 1, 1, 1);
            vehicle.updatePosition(dt);
            vehicle.groundToCollider(dt);
            vehicle.updateTransform(dt);
            vehicle.updateDriftSmoke(dt);

            const velocityPlanar = vehicle.velocity
                .clone()
                .projectOnPlane(vehicle.surfaceNormal);
            const speedPlanar = velocityPlanar.length();
            if (speedPlanar > 0.4) {
                velocityPlanar.normalize();
                const headingForward = vehicle.forward
                    .clone()
                    .projectOnPlane(vehicle.surfaceNormal)
                    .normalize();
                const bodyForward = vehicle.forward
                    .clone()
                    .set(0, 0, 1)
                    .applyQuaternion(vehicle.carPivot.quaternion)
                    .projectOnPlane(vehicle.surfaceNormal)
                    .normalize();

                const slipDeg =
                    Math.acos(
                        Math.min(1, Math.max(-1, headingForward.dot(velocityPlanar)))
                    ) *
                    (180 / Math.PI);
                const visualDeg =
                    Math.acos(
                        Math.min(1, Math.max(-1, bodyForward.dot(velocityPlanar)))
                    ) *
                    (180 / Math.PI);

                maxSlipDeg = Math.max(maxSlipDeg, slipDeg);
                maxVisualDeg = Math.max(maxVisualDeg, visualDeg);
                if (bodyForward.dot(velocityPlanar) < -0.1) {
                    wrongFacingFrames += 1;
                }
            }

            const telemetry = vehicle.getTelemetry();
            maxDriftIntensity = Math.max(
                maxDriftIntensity,
                telemetry.driftIntensity
            );
        }

        return {
            maxSlipDeg,
            maxVisualDeg,
            maxDriftIntensity,
            wrongFacingFrames,
            smokeParticleCount: vehicle.smoke.root.children.length,
        };
    });

    await page.screenshot({
        path: path.join(OUT_DIR, 'drift_state_regression.png'),
    });
    return drift;
}

(async () => {
    ensureOutDir();

    const browser = await chromium.launch({
        headless: true,
        args: ['--use-angle=swiftshader', '--disable-gpu'],
    });
    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
    });
    const page = await context.newPage();

    const logs = {
        pageErrors: [],
        consoleErrors: [],
        consoleWarnings: [],
    };

    page.on('pageerror', (error) => logs.pageErrors.push(String(error)));
    page.on('console', (msg) => {
        const text = msg.text();
        if (msg.type() === 'error') logs.consoleErrors.push(text);
        if (msg.type() === 'warning') logs.consoleWarnings.push(text);
    });

    try {
        await ensureRaceStarted(page);
        await setupRaceEventCapture(page);

        const steering = await collectSteeringMetrics(page);
        const wheelC63s = await collectWheelMetrics(
            page,
            'amg-c63s-coupe',
            'c63s_wheels_regression.png'
        );
        const wheelToyota = await collectWheelMetrics(
            page,
            'toyota-crown-platinum',
            'toyota_wheels_regression.png'
        );
        const toyotaOrientation = await collectToyotaOrientation(page);
        const lapFlow = await collectLapAndLeaderboardEvidence(page);
        const drift = await collectDriftMetrics(page);

        const results = {
            url: URL,
            metrics: {
                steering,
                wheelChecks: {
                    'amg-c63s-coupe': wheelC63s,
                    'toyota-crown-platinum': wheelToyota,
                },
                toyotaOrientation,
                lapFlow,
                drift,
            },
            logs: {
                pageErrorCount: logs.pageErrors.length,
                consoleErrorCount: logs.consoleErrors.length,
                consoleWarningCount: logs.consoleWarnings.length,
                pageErrors: logs.pageErrors,
                consoleErrors: logs.consoleErrors,
                consoleWarnings: logs.consoleWarnings,
            },
            screenshots: [
                'steering_A_regression.png',
                'steering_D_regression.png',
                'c63s_wheels_regression.png',
                'toyota_wheels_regression.png',
                'toyota_orientation_regression.png',
                'lap_leaderboard_regression.png',
                'drift_state_regression.png',
            ],
        };

        fs.writeFileSync(
            path.join(OUT_DIR, 'regression-validation-results.json'),
            JSON.stringify(results, null, 2)
        );
    } finally {
        await browser.close();
    }
})();
