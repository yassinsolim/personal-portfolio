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
  - The racing game has its own free project (Nordschleife, `qdepbyxxzbdknkfgpwyl`, us-west-2) so its
    Realtime traffic has its own quota. Schema and RLS: `supabase/racing.sql`, tested by
    `scripts/test-racing-sql.sh`. Don't run multi-client Realtime tests against it; use the netsim hook.
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
- Motion along the ground comes from `Vehicle/VehiclePhysics.ts` (September 2026): four tires with
  combined slip (a normalized friction ellipse over a magic formula curve) and load sensitivity,
  weight transfer, an engine torque curve with gears, clutch slip at launch and shift cuts, a
  viscous limited slip diff per axle, brakes with bias, aero drag and downforce, and optional ABS,
  traction control, stability control and a countersteer assist (presets in
  `Vehicle/assists.ts`). It runs at 600 Hz inside each 60 Hz vehicle step and has no three.js in
  it. `RaceVehicle` keeps grounding, orientation and wheel visuals, and syncs `speedMps`,
  `lateralSpeed`, `yaw`, `gear` and `rpm` from it so audio, HUD, ghosts and multiplayer read the
  same fields as before.
- Per-car numbers live in `carOptions.ts` under `race.physics` (published power and torque, the
  rest tuning) and are turned into a spec by `Vehicle/carPhysics.ts`, using the model's real
  wheelbase and track from the wheel rig. Tune against `scripts/race-drive-metrics.js`: each car
  should stay near its `zeroToHundredSec` and `topSpeedKph`.
- Full keyboard steer is the angle for the tightest turn the tires can hold at the current
  speed (geometric angle plus a small margin), not that plus a slip angle: both axles slip at the
  limit, and the extra angle made half a press already saturate the fronts. Countersteering can
  go further, as far as the front axle's travel, and the handbrake widens the range at low speed.
- The handbrake declutches and fades out above ~80 km/h (to 30% by ~190), so a stray press at
  speed unsettles the car instead of spinning it. Wall hits use 3x the yaw inertia for the
  rotational part of the impulse so a clipped barrier is a scrape, not a pinball.
- The road is 16 m with 3.5 m grass verges to the barriers (`NordschleifeTrack.ts`); the barrier
  collision is in `RaceVehicle.applyBarriers` using `track.queryFrame`, which also gives each
  wheel's surface (asphalt, kerb, grass). Test benches set `vehicle.trackBound = false`.
- New laps carry an `@v3` tag on `car_id` (v2 was the tire model on the old track, v3 is the real
  ring) and the leaderboard only reads tagged rows, because older laps aren't comparable. Bump the tag (and `PHYSICS_SEASON` in
  `MultiplayerService.ts`, and the local storage keys) whenever lap times stop being comparable.
- Measure changes with `scripts/race-physics-check.js` (paste into the console on
  `?raceDebug=1`). Expect rest gaps within ~0.5 cm and no wheel sunk over 5 cm at 300 km/h.
- `node scripts/race-harness-run.mjs --url http://<lan-ip>:<port>/` runs that harness plus
  `scripts/race-drive-metrics.js` (0-100, braking, skidpad, step steer, drift on a flat pad) in
  Chromium and writes JSON. `node scripts/race-playtest.mjs --url ...` plays the game headed with
  real key presses and reports load time, fps and screenshots. Headless Chromium on macOS can't
  load 127.0.0.1, so serve on the LAN IP, and only trust fps from headed runs on the real GPU.
- `docs/racing-audit.md` has the September 2026 audit, the reference site notes and the redo plan.

## Multiplayer Notes (2026-09-28)
- Telemetry now carries ground velocity, yaw rate and a ghost flag. Remote cars are predicted
  along their velocity (not the nose) and are boxes for contact (`Multiplayer/CarCollisions.ts`).
- Contact: both clients push their own car out by its mass share of the overlap. Only the lower
  session id of the pair applies the impulse; it sends the equal and opposite half as a `bump`
  broadcast, which the other client applies to its car. There's a 180 ms cooldown per pair
  because the other car's velocity is stale until its next telemetry. Freshly reset cars are
  ghosts for 3 s, and until they're clear of everyone.
- Lobby players get grid slots at the start (two abreast, 9 m rows). `?lobby=CODE` invite links
  join that lobby from Play or the car click, and the lobby banner copies the link.
- `.tmp-validation/mptest.mjs`-style testing: two browsers in one lobby, one parked on Döttinger
  Höhe, the other rolled into it. Expect shared momentum, not one car stopping dead.

## Transition Notes (2026-09-28)
- `World/RaceTransition.ts` (main bundle): click the room car (hover shows a pointer and starts
  building the race world, which blocks the main thread for most of a second). The car rocks,
  the camera flies behind it, the room's last frame is kept as an overlay while the race starts
  and compiles its shaders, then a circle opens from the car with a glowing rim.
- The race world reveal is `Visuals/reveal.ts`: every track, terrain, trackside and forest
  material gets a distance cut and an edge glow (`uRevealRadius`, huge when idle), and trees grow
  up out of the ground as the wave passes. Events: `race:transitionReveal`, `race:transitionSkip`.
- Any key or click skips. Focus is taken back from the monitor's iframe on start, or keys would
  never reach the page. Only drawn objects count for the car click; the hidden race world is in
  the scene too.

## Drift Notes (2026-09-28)
- Sport assists include the drift assist (`VehiclePhysics.updateDrift`): once the rear is out
  past ~7 degrees it holds a slide at the angle the steering picks (straight ~17, full into the
  corner ~30), countersteers with a PD on the slip angle, eases the throttle on overshoot, holds
  a gear by road speed, and drops rear grip up to 16% with throttle so lower torque cars keep
  sliding. Tuning is `DRIFT_TUNING`, per instance as `physics.driftTuning`.
- `__drive(cars, { only: ['driftAssist'] })` measures it; `--drive-options` passes that through
  `race-harness-run.mjs`. Standard and Off don't use it, so their numbers don't move.

## Track Notes (2026-09-28)
- The lap is the real Nordschleife, full length (20.77 km) and full elevation (333 to 627 m),
  from `static/models/Tracks/Nordschleife/nordschleife.json`. Rebuild it with
  `scripts/track/build_nordschleife.py` (OpenStreetMap ways, the Copernicus GLO-30 DEM, OSM
  forests). The file also carries section names, per-section widths and banking (Karussell
  14 degrees, concrete), the overpasses, and a 30 m terrain grid with the canopy taken off.
  Keep the ODbL and Copernicus credits (CREDITS.md and the race menu) with it.
- The collider is 160 chunk meshes in a group; raycast it recursively. Vertical motion uses
  real gravity now. A car leaves the road only at a real crest: `v^2 * curvature > 1.25 *
  (g + downforce)` on the track's smoothed profile (`frameCrest`), and lands on its first wheel.
  Flugplatz and Pflanzgarten throw fast cars, the rest of the lap doesn't.
- Harness extras: `startAt`/`startKph` options, stress runs from Döttinger Höhe, and crest runs
  at Flugplatz and Pflanzgarten. `sinkLog` lists where wheels went under.

## Race Visuals Notes (2026-09-27)
- `Racing/Visuals/RaceVisuals.ts` owns race mode's look: sky, sun and fog (`RaceAtmosphere`), the
  land (`RaceTerrain`), the forest (`RaceForest`), armco, posts and the start gantry
  (`RaceTrackside`), sparks and skid marks, and the post chain (`RacePostProcessing`). On enter it
  swaps in AgX tone mapping, the sky environment and the fog, and restores them on exit. The room
  lights are hidden while racing (`RaceManager.setLobbyObjectsVisible`).
- The renderer draws through `Renderer.setSceneRenderer(render, resize, maxPixelRatio)` while
  racing. The grain overlay and the monitor's CSS layer are skipped then.
- Presets live in `Visuals/qualityPresets.ts` with their budgets. Auto means balanced on a
  capable GPU and performance on weak or software ones (`detectGpuTier`), and it also drops to
  performance once the adaptive resolution goes under 1x. Performance has no post chain and no
  sun shadows. Change a preset there, not in the systems.
- Everything is procedural (canvas textures, generated trees), no image or model files. Trees:
  near ones are real geometry (`treeGeometry.ts`, cards on `foliageTextures.ts`'s atlas), refilled
  per tree from a 60 m grid when the camera moves 6 m. Far ones are billboards baked from the same
  geometry. Both fade by tree distance with the same dither, so there's no pop. Shadow casters are
  a separate set on `TREE_SHADOW_LAYER`, which only the sun's shadow camera renders.
- The sky shader is clamped (`SKY_MAX`) so the sun disc doesn't flood the bloom. Race car models
  get their own material copies, so race paint tweaks don't leak into the room car.
- Measure with `scripts/race-playtest.mjs --mode auto|quality|performance`. Worst case proxies:
  `--swgl` (SwiftShader) and `--cpu-throttle 4`. `--profile` times the main per frame calls and
  `hitchLog` in the result lists slow frames with their context.

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

## Weak Hardware Notes (2026-09-28)
- `?raceTier=low|high` forces the gpu tier, so the weak path can be checked on a fast machine.
- Weak tier (software GL, old integrated/mobile parts): 1 km draw distance with fog closing in,
  flat fog color instead of the sky shader, Lambert track/trackside/terrain, 8000 trees, 0.65 max
  pixel ratio, armco rings every 8 m, 56 m terrain cells, solid HUD panels (`race-lite` class, the
  backdrop blur alone costs ~25 ms a frame in SwiftShader) and the lite cars.
- Lite cars: `node scripts/optimize-models.mjs --lite` writes `<model>.lite.glb` next to each
  web glb (1 cm simplify error, 512 px textures). Only weak gpus load them, with Phong materials and
  a tiny generated sky cube for reflections. Rebuild them whenever a car glb changes.
- Every car is merged per material at prepare time (`mergeStaticMeshes`): linked wheel parts are
  attached to their wheel and merged inside it, materials match by look (exports repeat them per
  primitive), transparent parts stay separate for sorting. The M8 went from 1141 draws to 33.
- Balanced and Quality now have a far plane (6 and 9 km) just past where the haze is opaque, and
  the lap long ribbons and terrain skirt are cut into cells so off screen parts are culled.
- The original site's SwiftShader numbers are misleading: in most runs the car never appeared
  (5 to 30 draws, 18k to 40k triangles), so its fps is for a nearly empty road.

## Race Audio (2026-09-27)
- Runtime lives in `src/Application/Racing/Audio/`. `CarAudio.ts` is the entry point with a small
  surface: `setCar`, `update({ rpm, throttle, speedKph, gear, slip, boost })`, `impact`,
  `setListener`, `updateRemotes`, `setActive/setPaused/setMuted/setVolume`. `RaceEngineAudio.ts`
  adapts RaceManager's telemetry to it; RaceManager passes the whole telemetry object, so new
  fields from the driving model (`limiter`, `shifting`, `impact`, `barrierContact`, `onKerb`,
  `onGrass`, `boost`) are picked up without touching the audio call.
- Each car is one sprite in `static/sounds/race/<carId>.webm` (opus) with an `.m4a` (aac)
  fallback and a `.json` manifest of loop and one-shot offsets. Not `static/audio/`: the webpack
  copy step ignores `**/audio/**`. Only the car being driven is fetched, and only once race mode
  starts; `common` holds tires and impacts.
- Loops are stored with 50 ms of wrap-around margin on each side, so codec delay can't break the
  loop points. Chromium decodes both formats sample-aligned.
- `EngineVoice.ts` crossfades on-load and off-load loops by rpm (equal power, log rpm) and load,
  pitches them to the exact rpm, and adds the shift cut, limiter, overrun pops, turbo whistle and
  hybrid whine. Recorded idles keep their recorded pitch at the game's idle (`audioRpm` remap up
  to about 2,600 rpm). Per-car mixing is in `carAudioProfiles.ts`.
- Rebuild assets: `python3 scripts/audio/fetch_sources.py` once (about 600 MB into `audio-src/`),
  then `python3 scripts/audio/build_audio.py [carId ...]` (numpy, scipy, soundfile, ffmpeg with
  libopus). Recipes per car are in `build_audio.py`, engine layouts for the synth in `specs.py`.
  `python3 scripts/audio/analyze_orders.py` checks the firing-order content of every loop.
- Demo clips: `node scripts/render-audio-samples.mjs` renders `docs/audio-samples/<carId>.mp3` with
  the real runtime on an OfflineAudioContext (idle, full throttle through the gears to the
  limiter, lift). `node scripts/verify-race-audio.mjs` runs a production build in headed
  Chromium, drives, switches car and reports levels, fps and console errors.
- Sources and licenses are in `CREDITS.md` ("Race Audio"). Keep to CC0, CC BY or royalty-free
  bundle licenses that allow public web use, and never ship audio ripped from video sites.

## Lobby Notes (2026-09-28)
- After the homepage car-click transition a card asks: 1 Solo (just closes it, the race is already
  solo), 2 Quick join, 3 Invite a friend (creates a lobby, copies `?lobby=CODE`). Invite links skip
  the card. `race:lobbyChoice` opens it, `LobbyChoice.tsx` is the card.
- Quick join has no server: it walks `RING1`..`RING6` and stays in the first with 8 or fewer
  drivers after the first presence sync.
- Remote cars are predicted from when the pose was taken, not when it arrived:
  `sampleAtMs` is arrival minus transit (sender's `sent_at`, with a per peer clock skew guess
  when the lowest delay is negative or over 400 ms). The drawn car moves with its velocity before
  smoothing. At 150 km/h with 20% loss and 120 +/- 80 ms that took the drawn error from 9.4 m to
  0.5 m (p50), 12.5 m to about 3 m (p95).
- `?raceDebug=1&netsim=loss,lag,jitter` (e.g. `0.2,120,80`) drops and delays outgoing broadcasts
  for testing. `.tmp-validation/mp4.mjs <url> <netsim>` runs four clients through the real flow.

## Realtime Traffic (2026-09-28)
- The Supabase org shares a 2M/month Realtime message quota with WebStrafe. Never run
  multiplayer tests against the live project (axrljzcrlmliscstmctb) or a preview. Use
  `?raceDebug=1&mpmock=1` (in browser mock, windows of one browser share lobbies, laps stay local)
  or a local `supabase start`. `scripts/race-mp-traffic.mjs` uses the mock and also aborts any
  request or websocket to supabase.co.
- Budget: nothing is broadcast while you're alone in a lobby; telemetry is ~11 Hz moving and a
  2 s keep alive when the pose hasn't changed (the lap clock isn't part of that check); presence
  is tracked on join and dropped on leave, name and car changes ride on telemetry; a hidden tab
  or leaving race mode leaves the lobby and it's rejoined on return (`suspend`/`resume`).
- Supabase URL, key, tables and lobby prefix come from env at build time
  (`scripts/write-racing-config.js`), so moving projects is a config change.

## Garage Notes (2026-09-28)
- Opened from the lobby card (key 4) or the pause menu. The car parks and the camera orbits it
  (drag to turn). Choices apply live and persist per car (`yassinverse:garageLook:<car>`,
  `yassinverse:garageTune:<car>`).
- Look (`Garage/carLook.ts`): paint and finish on the body material names in `PAINT`, rim and
  caliper colors (calipers only on cars with their own caliper material), rims from another car
  (its wheel meshes scaled into this car's wheels), a ducktail or GT wing sized from
  `raceBodySize` and rays on the boot, ride height (moves the body, not the wheels). It works by
  names, so remote clones get it too, and it copies materials before changing them.
- Tune (`Garage/garage.ts` `applyTune`): engine map, tire compound, spring balance and damping
  (roll share and load transfer time), diff lock, final drive, brake bias, plus the aero of the
  body kit and the ride height's effect on cg height. Mass never changes, so collisions don't
  depend on the tune. A stock tune returns the spec unchanged (harness identical).
- Leaderboard: any tune, body kit or ride height change makes the car tuned. Tuned laps are
  tagged `<car>@v3~t<code>` and live on the tuned board; the stock board still reads `%@v3`.
- Multiplayer: the look rides on telemetry as a short code (`encodeLook`), no extra messages.
