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

## Baseline (Phase 0)
- Branch: `feature/nordschleife-racing` (matches latest `main` at start).
- `npm run build` passes (with existing large asset warnings).
- Existing experience to preserve:
  - BIOS-style loading overlay.
  - Click toggles camera idle/desk.
  - Monitor iframe interaction events.
  - Existing desk scene and decorative models.

## Phase Tracking
- [x] Phase 0: baseline + branch
- [ ] Phase 1: race mode scaffolding
- [ ] Phase 2: track pipeline + collider separation + debug
- [ ] Phase 3: vehicle controller + grounding
- [ ] Phase 4: race camera + pointer lock + pause/settings
- [ ] Phase 5: HUD + lap timing + name entry + local leaderboard
- [ ] Phase 6: Supabase leaderboard integration + fallback
- [ ] Phase 7: RPM engine audio profiles + shift transient
- [ ] Phase 8: polish + performance + ghost replay + credits
