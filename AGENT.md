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
