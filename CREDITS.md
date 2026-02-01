# CREDITS

## Existing Project Credits

- Outer portfolio baseline inspiration: Henry Heffernan
  - Repo: https://github.com/henryjeff/portfolio-website
  - License/attribution: per upstream repository

- Inner OS inspiration: Dustin Brett (daedalOS)
  - Repo: https://github.com/DustinBrett/daedalOS
  - License/attribution: per upstream repository

## Racing Mini-game Additions (This Branch)

- Nordschleife race track geometry (`static/models/Tracks/Nordschleife/*.json`)
  - Source: procedurally generated in-project for this implementation
  - License: project-owned data in this repository

- Race engine audio profiles and shift transients
  - Source: procedural Web Audio synthesis at runtime (no third-party audio samples)
  - License: project-owned synthesis logic

- Ghost replay data
  - Source: user gameplay telemetry saved locally (`localStorage`)
  - License: user-generated local data

## Libraries Used by New Racing Modules

- Supabase JavaScript client (`@supabase/supabase-js`)
  - Repo: https://github.com/supabase/supabase-js
  - License: MIT

- Three.js (already used across project; racing features also depend on it)
  - Repo: https://github.com/mrdoob/three.js
  - License: MIT
