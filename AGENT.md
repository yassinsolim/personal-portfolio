# AGENT.md

## Mission
Implement Nürburgring Nordschleife racing mini-game inside existing portfolio while preserving default experience.

## Hard Constraints
- Keep current portfolio behavior intact by default.
- Race mode must be opt-in from UI.
- One track only (`Nordschleife`) and only one track root in scene.
- Separate visual mesh and collider mesh.
- Collider mesh must never render.
- Grounding raycasts must target collider mesh only.
- Controls: `WASD`, `Space` handbrake/drift.
- Race camera: stable spring-arm chase cam + pointer lock in race mode.
- `Esc` opens pause/settings menu in race mode.
- HUD: speed, gear, RPM, lap time.
- Lap timing + name entry + persistent leaderboard.
- Supabase leaderboard with graceful local fallback.
- Per-car RPM audio profile + shift transient.
- Add duplicate track root detector + collider hit debug ray.
- Update `CREDITS.md` for all new assets/licensing.

## Repository Anchors
- Boot loop: `src/script.ts`, `src/Application/Application.ts`, `src/Application/Utils/Time.ts`
- World assembly: `src/Application/World/World.ts`
- Camera: `src/Application/Camera/Camera.ts`
- UI: `src/Application/UI/App.tsx`, `src/Application/UI/style.css`, `src/Application/UI/EventBus.ts`
- Resources: `src/Application/sources.ts`, `src/Application/Utils/Resources.ts`
- Car options: `src/Application/carOptions.ts`

## Runtime Notes
- Local portable Node installed at `.tools/node-v18.20.4-win-x64`.
- Use PATH prefix when running npm scripts:
  - `$env:PATH = "$(Resolve-Path .\\.tools\\node-v18.20.4-win-x64);$env:PATH"`
- Supabase runtime config (optional):
  - `static/config/racing.config.json` (template: `static/config/racing.config.example.json`)

## Baseline (Phase 0)
- Branch: `feature/nordschleife-racing` (created from latest `main` at start).
- `npm run build` passes (with existing large asset warnings).
- Existing experience to preserve:
  - BIOS-style loading overlay.
  - Click toggles camera idle/desk.
  - Monitor iframe interaction events.
  - Existing desk scene and decorative models.

## Phase Tracking
- [x] Phase 0: baseline + branch
- [x] Phase 1: race mode scaffolding
- [x] Phase 2: track pipeline + collider separation + debug
- [x] Phase 3: vehicle controller + grounding
- [x] Phase 4: race camera + pointer lock + pause/settings
- [x] Phase 5: HUD + lap timing + name entry + local leaderboard
- [x] Phase 6: Supabase leaderboard integration + fallback
- [x] Phase 7: RPM engine audio profiles + shift transient
- [x] Phase 8: polish + performance + ghost replay + credits

## Stabilization Notes (2026-02-08)
- Added per-car race tuning metadata in `src/Application/carOptions.ts`:
  - drivetrain, top speed, accel envelope, gear ratios, RPM targets, references.
- Hardened free-cam/race-mode control handoff in `src/Application/Camera/Camera.ts`
  to avoid stale OrbitControls transitions.
- Reworked `src/Application/Racing/Vehicle/RaceVehicle.ts`:
  - dynamic per-car longitudinal model
  - drift state (`RWD`-gated), slip telemetry
  - wheel detection + visual spin/steer animation
  - dynamic ride-height from wheel radius and improved collider grounding
  - smoke emission hooks via new `src/Application/Racing/Effects/DriftSmoke.ts`
- Updated chase camera in `src/Application/Racing/Camera/RaceChaseCamera.ts`:
  - anti-clipping distance clamps around car body
  - lower race near-plane, speed FOV ramp, subtle speed/drift shake
- Extended race audio in `src/Application/Racing/Audio/RaceEngineAudio.ts`:
  - smoother engine retune, softer shift transient
  - procedural wind/road/tire noise layers tied to speed/slip.
- Added edge strip markings to `src/Application/Racing/Track/NordschleifeTrack.ts`.

## Known Validation Gap
- Full interactive manual driving validation (pointer lock, control feel, drift tuning,
  audio taste) still requires browser-in-the-loop checks.

## Focused Bugfix Pass (Verified 2026-02-08)
- Scope: steering sign/sensitivity, wheel rig/spin safety, Toyota camera/grounding/orientation,
  drift orientation while preserving smoke+squeal, start area width, lap length scaling, and
  pointer/click runtime stability.
- Code status:
  - Steering source-of-truth preserved (`A=-1`, `D=+1`) with sensitivity scale `0.132`
    (about 40% down from `0.22`).
  - Wheel rig now uses explicit car mappings where needed (Toyota + AMG C63s), per-wheel spin
    axis/sign resolution, and hard fail-safe disable when 4 valid wheels are not resolved.
  - Toyota-specific tuning: `cameraFollowDistanceOffsetMeters: 3.8`, `groundOffsetMeters: 0.4`,
    and explicit FL/FR/RL/RR wheel node mapping.
  - Drift system remains active; smoke/audio retained; visual orientation gets a small
    velocity-alignment blend during high drift.
  - Start area widened (`START_PAD_EXTRA_WIDTH_SCALE=2.4`, `START_PAD_BLEND=0.18`) and effective
    lap length reduced by scaling curve X/Z around center (`TRACK_LENGTH_SCALE=0.475`).
  - Runtime debug hook exposes `window.Application` only under `?raceDebug=1`.
- Verified validation:
  - Build: `npm run build` passed (webpack size warnings only).
  - Automated runtime check (`Playwright` on `http://127.0.0.1:8120/?raceDebug=1`) reported:
    - Steering yaw delta: `A=-0.1346`, `D=+0.1377`
    - Wheel checks: E92/C63 507/C63s/F82/Toyota each resolve 4 wheels, forward/reverse spin
      directions are opposite
    - Fail-safe warning only for AMG One (expected): wheel animation disabled due missing
      4-wheel rig
    - Toyota camera distance delta vs AMG One: `+3.636m`
    - Wheel grounding avg delta to track: Toyota `+0.00317m`, E92 `+0.00199m`
    - Drift telemetry: `maxDriftIntensity=1`, `smokeParticleCount=62`, `tireGain=0.2728`
    - Track ratio: `effective/raw=0.501675`
    - Lap flow check: `pausedAfterLap=true`, `pendingLapTimeMs=36000`
    - Runtime stability: `pageErrors=0`, pointer-lock abort count `0`,
      `setPointerCapture` error count `0`
- Evidence artifacts:
  - `.tmp-validation/steering_A.png`
  - `.tmp-validation/steering_D.png`
  - `.tmp-validation/toyota_camera_grounding.png`
  - `.tmp-validation/start_pad_wide.png`
  - `.tmp-validation/drift_state.png`
- Residual non-blocking log noise:
  - One generic `404` resource load error remains outside race pointer-lock/click flow.

## Regression Fixes (Verified 2026-02-09)
- Steering input source-of-truth is corrected in `src/Application/Racing/Input/DrivingInput.ts`:
  `A -> -1` (left), `D -> +1` (right).
- Wheel rig coordinate handling in `src/Application/Racing/Vehicle/RaceVehicle.ts` now keeps
  wheel centers in model-local scaled space (no extra quaternion re-rotation), preventing
  left/right and front/rear axis confusion on cars with non-standard wheel-node frames.
- Wheel spin-axis solving in `src/Application/Racing/Vehicle/RaceVehicle.ts` now infers
  lateral/longitudinal axes from wheel-rig geometry deltas and then resolves axis/sign in world
  space; verified for:
  - `amg-c63-507` (`3DWheel_Front/Rear_L/R`) forward rolling + reverse inversion
  - `toyota-crown-platinum` (`316/356/340/348_black_0`) forward rolling + reverse inversion
- Drift visual orientation stays active but is constrained to avoid wrong-way visual yaw:
  - `DRIFT_VISUAL_MAX_ANGLE_RAD = 42deg`
  - visual blend cap reduced to `0.45`
  - smoke + tire squeal remain active during drift.
- Validation artifacts:
  - `.tmp-validation/runtime-results.json`
  - `.tmp-validation/wheel-direction-check.json`
  - `.tmp-validation/drift-orientation-check.json`
  - `.tmp-validation/steering_A.png`
  - `.tmp-validation/steering_D.png`
  - `.tmp-validation/toyota_camera_grounding.png`
  - `.tmp-validation/start_pad_wide.png`
  - `.tmp-validation/drift_state.png`

## Regression Fixes (Verified 2026-02-10)
- Build/runtime:
  - `npm.cmd run build` passed (webpack size warnings only).
  - Fresh dev server validation run: `http://127.0.0.1:8137/?raceDebug=1`.
  - Validation server teardown confirmed: no listener remained on port `8137`.
- Input mapping verification:
  - Source-of-truth mapping in `src/Application/Racing/Input/DrivingInput.ts` is explicitly
    `KeyD -> steer left (-1)`, `KeyA -> steer right (+1)`.
  - Steering yaw deltas from runtime simulation:
    - `A: +0.3175103094596037`
    - `D: -0.31751030945960335`
- Wheel rig verification:
  - `amg-c63s-coupe` wheel rig count: `4`
    - Nodes:
      - `polySurface1_wheeMercedesAMG_S63CoupeRewardRecycled_2020_Wheel1A_3D_3DWh_c96cb19_0`
      - `polySurface237_wheeMercedesAMG_S63CoupeRewardRecycled_2020_Wheel1A_3D_3DWh_c96cb19_0`
      - `polySurface473_wheeMercedesAMG_S63CoupeRewardRecycled_2020_Wheel1A_3D_3DWh_c96cb19_0`
      - `polySurface671_wheeMercedesAMG_S63CoupeRewardRecycled_2020_Wheel1A_3D_3DWh_c96cb19_0`
    - Non-brake confirmation: `true`
    - Front steer delta (rad): `[1.0319129864371845, 1.0319129864371845]`
  - `toyota-crown-platinum` wheel rig count: `4`
    - Nodes: `340_black_0`, `316_black_0`, `348_black_0`, `356_black_0`
    - Non-brake confirmation: `true`
    - Front steer delta (rad): `[1.0357205913665124, 1.0357205913665124]`
  - `amg-one` mapped wheel rig no longer falls back/disable (no unresolved 4-wheel warning in runtime logs).
  - Forward/reverse opposite spin check per wheel: `true` for all checked wheels on both cars.
- Toyota orientation verification:
  - `body vs track tangent dot = 0.9997231594407809`
  - `body vs vehicle forward dot = 1`
  - `vehicle forward vs track tangent dot = 0.9997231594407809`
- Lap/leaderboard flow verification:
  - Forced valid lap completion produced pause + pending lap:
    - `pendingLapTimeMs = 36016`
    - `pausedAfterLap = true`
  - Lap completed event captured:
    - `race:lapCompleted lapTimeMs=36016, carId=toyota-crown-platinum`
  - Lap submission event captured:
    - `race:lapSubmitted name=RegressionBot, lapTimeMs=36016`
  - Leaderboard update event captured:
    - `race:leaderboardUpdate count=1, topName=RegressionBot, topLapMs=36016`
  - UI/local persistence:
    - HUD leaderboard row: `RegressionBot 00:36.016`
    - Local leaderboard top entry persisted with matching values.
- Drift visual verification:
  - `maxSlipDeg = 48.36212289877388`
  - `maxVisualDeg = 44.017335737014335`
  - `maxDriftIntensity = 1`
  - `wrongFacingFrames = 0`
  - `smokeParticleCount = 62`
- Evidence artifacts:
  - `.tmp-validation/regression-validation-results.json`
  - `.tmp-validation/steering_A_regression.png`
  - `.tmp-validation/steering_D_regression.png`
  - `.tmp-validation/c63s_wheels_regression.png`
  - `.tmp-validation/toyota_wheels_regression.png`
  - `.tmp-validation/toyota_orientation_regression.png`
  - `.tmp-validation/lap_leaderboard_regression.png`
  - `.tmp-validation/drift_state_regression.png`

## Re-Validation (Verified 2026-02-10, Port 8138)
- Build/runtime:
  - `npm.cmd run build` passed.
  - Fresh dev server run: `http://127.0.0.1:8138/?raceDebug=1`.
  - Validation process teardown verified no listeners on `8137`, `8138`, or `8140`.
- Input mapping verification:
  - `KeyD -> steer left (-1)`, `KeyA -> steer right (+1)`.
  - Runtime yaw deltas:
    - `A: +0.3175103094596037`
    - `D: -0.31751030945960335`
- Wheel/steer/spin verification:
  - `amg-c63s-coupe`: 4 wheels, non-brake wheel nodes, front steer changed, forward/reverse spin opposite on all 4 wheels.
  - `toyota-crown-platinum`: 4 wheels (`340_black_0`, `316_black_0`, `348_black_0`, `356_black_0`), non-brake wheel nodes, front steer changed, forward/reverse spin opposite on all 4 wheels.
  - `amg-one`: 4 wheels (`rim_wheel_0`, `rim_wheel_d_0`, `rim1_wheel_0`, `rim1_wheel_d_0`), non-brake wheel nodes, forward/reverse spin opposite on all 4 wheels.
- Toyota orientation verification:
  - `body vs track tangent dot = 0.9997231594407809`
  - `body vs vehicle forward dot = 1`
  - `vehicle forward vs track tangent dot = 0.9997231594407809`
- Lap/leaderboard verification:
  - `race:lapCompleted`, `race:lapSubmitted`, and `race:leaderboardUpdate` events all captured in sequence.
  - Local leaderboard top row updated with `RegressionBot` at `00:36.016`.
- Drift verification:
  - `maxSlipDeg = 48.36212289877388`
  - `maxVisualDeg = 44.01733573701431`
  - `wrongFacingFrames = 0`
- Additional evidence artifacts:
  - `.tmp-validation/runtime-results.json`
  - `.tmp-validation/wheel-direction-check.json`
  - `.tmp-validation/amg_wheels.png`
