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

- Race stabilization realism pass (February 8, 2026)
  - Added wind/road/tire layers, drift smoke, and edge markings using procedural/runtime-generated content
  - Third-party asset usage: none added in this pass
  - License: project-owned implementation code and generated runtime effects

- Ghost replay data
  - Source: user gameplay telemetry saved locally (`localStorage`)
  - License: user-generated local data

## Vehicle Performance Reference Sources (Tuning Inputs, Not Imported Assets)

- Mercedes-AMG ONE technical data
  - URL: https://www.mercedes-amg.com/en/home/vehicles/amg-one/hypercar.html
  - Usage: target top speed and acceleration envelope

- BMW Group press data for BMW M3 Coupe (E92)
  - URL: https://www.press.bmwgroup.com/middle-east/article/detail/T0048125EN/the-new-bmw-m3-coupe-turning-powerful-passion-into-supreme-performance?language=en
  - Usage: target top speed and acceleration envelope

- Car and Driver test: 2014 Mercedes-Benz C63 AMG Edition 507
  - URL: https://www.caranddriver.com/reviews/a15111205/2014-mercedes-benz-c63-amg-edition-507-test-review/
  - Usage: target top speed and acceleration envelope

- Car and Driver specs: 2019 Mercedes-AMG C63
  - URL: https://www.caranddriver.com/mercedes-amg/c63-2019
  - Usage: target top speed and acceleration envelope

- Car and Driver preview/spec reference: 2015 BMW M4 Coupe
  - URL: https://www.caranddriver.com/news/a15110475/2015-bmw-m4-coupe-photos-and-info-news/
  - Usage: target top speed and acceleration envelope

- Car and Driver tested: 2023 Toyota Crown Platinum
  - URL: https://www.caranddriver.com/reviews/a41711747/2023-toyota-crown-drive/
  - Usage: target top speed envelope

## Libraries Used by New Racing Modules

- Supabase JavaScript client (`@supabase/supabase-js`)
  - Repo: https://github.com/supabase/supabase-js
  - License: MIT

- Three.js (already used across project; racing features also depend on it)
  - Repo: https://github.com/mrdoob/three.js
  - License: MIT
