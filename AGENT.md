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

## Model Pipeline
- Original Sketchfab exports live in `models-src/` (not deployed). Web-ready copies are
  written to the same relative path under `static/` by `npm run optimize:models [carId ...]`
  (Draco geometry, WebP textures capped at 1024px). `GLTFLoader` has a Draco decoder and needs
  `'wasm-unsafe-eval'` in the CSP for the wasm path; it falls back to the JS decoder otherwise.
  The decoder files come from `three/examples/jsm/libs/draco` (webpack emits them from
  `DRACOLoader`'s `import.meta.url` references), so there's no vendored copy to keep in sync.
- three is r186 with color management on. Colors tuned on r137 go through `Utils/LegacyColor.ts`
  (`legacyColor`, `setLegacyHex`) so they keep their look, and the room scene's lights are scaled
  by `LEGACY_LIGHT_SCALE` (pi) for the same reason. New work should use plain sRGB hex colors
  and physical light units.
- Only simplify materials listed in `simplifyMaterialsByModel`. Stripes and decals sit <1mm
  above the paint, so simplifying either layer makes the paint poke through.
- Camera near plane is 200 on purpose: at 10 those layers z-fight from the default views.
- A shared `GLTFLoader` plugin sets `transmission = 0` on every material. Any transmissive
  material makes three re-render the whole scene into an offscreen target each frame.
- Window tint and repaints are data in `carOptions.ts` (`windowTint`, `paint`), applied by
  `Utils/CarFinish.ts` in both the site view and race mode. Opacity reads like film darkness
  (0.8 is about a 20% tint). Lamp lenses that share a glass material are skipped by height/size.
- The floor is baked and unlit, so the car's floor shadow comes from `World/CarContactShadow.ts`:
  rendered once per car from underneath, blurred, and kept as a child of the car model.
- The room textures are baked lighting, so don't edit them in an image editor: it leaves the
  old color around every UV island. Colors, the desk credits page, and the Yassin Co. labels
  all live in `scripts/build-room-textures.py`; edit and rerun it. It starts from Henry's
  original bakes (git history), masks by the meshes' UV islands, and writes 4k plus `_2k` copies.
- `sources.ts` loads the `_2k` room textures on mobile and low power devices (`Utils/Device.ts`).
  Unknown `deviceMemory` (Safari, Firefox) must not count as low memory.

## Runtime Notes
- Requires Node 20.10 or newer (`engines` in `package.json`), Node 22 LTS recommended: webpack-cli 7
  and copy-webpack-plugin 14 declare `>=20.9.0`, and sharp's ESM build uses import attributes, which
  Node 20.9 can't parse. The old portable `.tools/node-v18.20.4-win-x64` is too old.
- On Windows with a portable Node, prefix the PATH when running npm scripts:
  - `$env:PATH = "$(Resolve-Path .\\.tools\\<node-folder>);$env:PATH"`
- Supabase runtime config (optional):
  - `static/config/racing.config.json` (template: `static/config/racing.config.example.json`)
- Render Mode defaults to Auto: `Utils/AdaptiveResolution.ts` retunes the pixel ratio every second
  to hold 60 fps (0.5x up to the screen's native ratio, capped at 2x). Below 1x it also turns off
  the film grain overlay and heavy drift smoke. Anything that swaps the scene should call
  `renderer.adaptive.reset()` (car change and race enter/exit already do) so load spikes don't
  read as a slow device. Check tuning changes with `node scripts/simulate-adaptive-resolution.mjs`.

## Race Physics Notes (2026-09-26)
- Ride height comes from real geometry (`getGeometricContactBottom`): the lowest vertex under
  each wheel, or an axle's own rim/tire meshes for merged axles (AMG One). Detected wheel radii
  often come from the rim or a merged axle; that floated the AMG One ~35 cm and sank the E92/M4
  5-6 cm. Don't paper over placement with per-car `groundOffsetMeters`.
- `followGround` tracks the road exactly while grounded and goes ballistic when the road drops
  away faster than gravity (crests at speed). The old per-frame step cap (~5.4 m/s vertical)
  made cars float downhill and sink uphill at speed.
- Track heights are scaled by `TRACK_ELEVATION_SCALE` in `NordschleifeTrack.ts`. The source data
  plus the 0.475 horizontal squeeze had made 30-120% grades. When track geometry changes, bump
  `DEFAULT_LOBBY_PREFIX` in `MultiplayerService.ts`; ghost replays snap to the current road.
- Drift authority fades above ~110 km/h and total yaw rate is capped by speed. At 190 km/h a
  handbrake flick used to slide cars sideways at ~50 m/s and spin them at ~480 deg/s.
- Measure changes with `scripts/race-physics-check.js` (paste into the console on
  `?raceDebug=1`). Expect rest gaps within ~0.5 cm and no wheel sunk over 5 cm at 300 km/h.
- `node scripts/race-harness-run.mjs --url http://<lan-ip>:<port>/` runs that harness plus
  `scripts/race-drive-metrics.js` (0-100, braking, skidpad, step steer, drift on a flat pad) in
  Chromium and writes JSON. `node scripts/race-playtest.mjs --url ...` plays the game headed with
  real key presses and reports load time, fps and screenshots. Headless Chromium on macOS can't
  load 127.0.0.1, so serve on the LAN IP, and only trust fps from headed runs on the real GPU.
- `docs/racing-audit.md` has the September 2026 audit, the reference site notes and the redo plan.

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

## Targeted Wheel/Orientation Fixes (Verified 2026-02-10, Port 8160)
- Build/runtime:
  - `npm.cmd run build` passed (webpack size warnings only).
  - Fresh dev server runtime validated at `http://127.0.0.1:8160/?raceDebug=1`.
  - Teardown recheck: no listeners on validation ports `8137`, `8138`, `8140`,
    `8150`, `8151`, `8152`, `8153`, `8160`.
- `amg-c63s-coupe`:
  - Wheel rig count: `4`.
  - Wheel nodes are non-brake wheel meshes:
    - `polySurface1_wheeMercedesAMG_S63CoupeRewardRecycled_2020_Wheel1A_3D_3DWh_c96cb19_0`
    - `polySurface237_wheeMercedesAMG_S63CoupeRewardRecycled_2020_Wheel1A_3D_3DWh_c96cb19_0`
    - `polySurface473_wheeMercedesAMG_S63CoupeRewardRecycled_2020_Wheel1A_3D_3DWh_c96cb19_0`
    - `polySurface671_wheeMercedesAMG_S63CoupeRewardRecycled_2020_Wheel1A_3D_3DWh_c96cb19_0`
  - Primary wheel spin delta: `2.019812` (all 4).
  - Linked wheel-layer counts per corner: `1,1,1,1` with linked spin delta
    `2.019812` (all linked nodes).
  - Front steer delta: `0.14`, `0.14`.
  - Precise forward/reverse spin check (small-step): opposite direction `true` on all 4 wheels.
- `bmw-f82-m4`:
  - Wheel rig count: `4`.
  - Wheel nodes are non-brake wheel meshes:
    - `ARm4_vt_wheel002_michelin_diff_0`
    - `ARm4_vt_wheel_michelin_diff_0`
    - `ARm4_vt_wheel003_michelin_diff_0`
    - `ARm4_vt_wheel001_michelin_diff_0`
  - Primary wheel spin delta: `0.277459` (all 4).
  - Linked wheel-layer counts per corner: `2,2,2,2` with linked spin delta
    `0.277459` for both linked layers each corner.
  - Front steer delta: `0.14`, `0.14`.
  - Precise forward/reverse spin check: opposite direction `true` on all 4 wheels.
- `toyota-crown-platinum`:
  - Wheel rig count: `4`.
  - Wheel nodes (non-brake): `547_refl_black_0`, `539_refl_black_0`,
    `531_refl_black_0`, `523_refl_black_0`.
  - Primary wheel spin delta: `2.475172` (all 4).
  - Front steer delta: `0.14`, `0.14`.
  - Toyota orientation:
    - `bodyVsVehicleDot = 1`
    - `bodyVsTrackDot = 0.999692087`
    - `vehicleVsTrackDot = 0.999692087`
  - Precise forward/reverse spin check: opposite direction `true` on all 4 wheels.
  - Prior tiny disc nodes explicitly static and excluded:
    - `340_black_0`, `316_black_0`, `348_black_0`, `356_black_0`
    - each `inWheelRig=false`, `angleDelta=0`.
- Do-not-touch car sanity checks remained good in same run:
  - `amg-one` primary wheel spin delta: `0.31241` (all 4).
  - `bmw-e92-m3` primary wheel spin delta: `0.592643` (all 4).
  - `amg-c63-507` primary wheel spin delta: `0.752452` (all 4).
- Evidence artifacts:
  - `.tmp-validation/targeted-fix-validation.json`
  - `.tmp-validation/targeted-fix-direction-precise.json`
  - `.tmp-validation/amg-c63s-coupe-targeted-fix.png`
  - `.tmp-validation/bmw-f82-m4-targeted-fix.png`
  - `.tmp-validation/toyota-crown-platinum-targeted-fix.png`
  - `.tmp-validation/amg-one-targeted-fix.png`
  - `.tmp-validation/bmw-e92-m3-targeted-fix.png`
  - `.tmp-validation/amg-c63-507-targeted-fix.png`

## Latest Canonical Validation (Verified 2026-02-10, Port 8164)
- Build/runtime:
  - `npm.cmd run build` passed (webpack size warnings only).
  - Fresh dev server validation: `http://127.0.0.1:8164/?raceDebug=1`.
  - Teardown confirmed no lingering listeners on validation ports (including `8164`).
- Input mapping:
  - Source-of-truth remains `KeyD -> steer left (-1)`, `KeyA -> steer right (+1)`.
  - Runtime steering yaw deltas:
    - `A: +0.3175103094596037`
    - `D: -0.31751030945960335`
- Wheel rig and spin:
  - `amg-c63s-coupe`
    - Wheel rig count: `4`
    - Nodes:
      - `polySurface1_wheeMercedesAMG_S63CoupeRewardRecycled_2020_Wheel1A_3D_3DWh_c96cb19_0`
      - `polySurface237_wheeMercedesAMG_S63CoupeRewardRecycled_2020_Wheel1A_3D_3DWh_c96cb19_0`
      - `polySurface473_wheeMercedesAMG_S63CoupeRewardRecycled_2020_Wheel1A_3D_3DWh_c96cb19_0`
      - `polySurface671_wheeMercedesAMG_S63CoupeRewardRecycled_2020_Wheel1A_3D_3DWh_c96cb19_0`
    - Non-brake wheel-node check: `true`
    - Forward/reverse opposite-direction spin on all wheels: `true`
    - Front steer delta: `0.159642`, `0.159642`
  - `toyota-crown-platinum`
    - Wheel rig count: `4`
    - Nodes: `547_refl_black_0`, `539_refl_black_0`, `531_refl_black_0`, `523_refl_black_0`
    - Non-brake wheel-node check: `true`
    - Forward/reverse opposite-direction spin on all wheels: `true`
    - Front steer delta: `0.156938`, `0.156938`
- Toyota orientation:
  - `body vs track tangent dot = 1`
  - `body vs vehicle forward dot = 1`
  - `vehicle forward vs track tangent dot = 1`
- Lap/leaderboard flow:
  - Forced valid lap completion produced:
    - `pendingLapTimeMs = 36016`
    - `pausedAfterLap = true`
  - Captured events:
    - `race:lapCompleted` with `lapTimeMs=36016`, `carId=amg-one`
    - `race:lapSubmitted` with `name=RegressionBot`, `lapTimeMs=36016`, `carId=amg-one`
    - `race:leaderboardUpdate` with `count=1`, `topName=RegressionBot`, `topLapMs=36016`
  - UI/local persistence:
    - HUD leaderboard row: `RegressionBot 00:36.016`
    - Local leaderboard top entry matches submitted values.
- Drift metrics:
  - `maxSlipDeg = 48.241434`
  - `maxVisualDeg = 21.235505`
  - `maxDriftIntensity = 1`
  - `wrongFacingFrames = 0`
  - `rearKickLeftRatio = 0.79402`
- Additional measured geometry checks:
  - Center dashed line offset to collider:
    - `sampleCount = 91`
    - `meanOffset = 0.003671`
    - `maxOffset = 0.09314`
    - `minOffset = -0.100986`
  - AMG One wheel-to-track gap estimate:
    - `meanGapMeters = -0.371476` (negative indicates wheels are not floating above collider in this measurement).
- Evidence artifacts:
  - `.tmp-validation/final-request-validation.json`
  - `.tmp-validation/steering_A_final.png`
  - `.tmp-validation/steering_D_final.png`
  - `.tmp-validation/c63s_wheels_final.png`
  - `.tmp-validation/toyota_wheels_final.png`
  - `.tmp-validation/toyota_orientation_final.png`
  - `.tmp-validation/centerline_final.png`
  - `.tmp-validation/amg_one_height_final.png`
  - `.tmp-validation/lap_leaderboard_final.png`
  - `.tmp-validation/drift_state_final.png`

## Toyota + Ghost Follow-up (Verified 2026-02-10, Port 8174)
- Scope constrained to user request:
  - Keep all non-Toyota race cars untouched.
  - Keep `amg-c63s-coupe` behavior untouched.
  - Fix Toyota Crown Platinum forward orientation consistency.
  - Prevent Toyota detached wheel/brake artifact behavior caused by invalid wheel rig nodes.
  - Replace ghost wireframe box with translucent car model ghost.
- Toyota runtime results:
  - Orientation alignment:
    - `bodyVsVehicleDot = 1.0000000000000002`
    - `bodyVsTrackDot = 0.9999999999634729`
    - `vehicleVsTrackDot = 0.9999999999634729`
  - Wheel rig handling:
    - Toyota wheel rig is explicitly suppressed at runtime (`wheelRigCount = 0`)
      to avoid detached/orbiting wheel artifacts from this model's invalid corner nodes.
  - Visual screenshots:
    - `.tmp-validation/toyota-only-main.png`
    - `.tmp-validation/toyota-only-side.png`
    - `.tmp-validation/toyota-only-top.png`
- Ghost runtime results:
  - Ghost now renders as translucent cloned car mesh, not wireframe box.
  - Metrics from validation:
    - `meshCount = 93`
    - `transparentMeshCount = 93`
  - Evidence screenshot:
    - `.tmp-validation/toyota-only-ghost.png`
- Build/runtime lifecycle:
  - `npm.cmd run build` passed after changes.
  - Fresh isolated dev server used for validation: `http://127.0.0.1:8174/?raceDebug=1`.
  - Validation run writes `.tmp-validation/toyota-only-validation.json`.
  - Dev server process terminated at end of run.
