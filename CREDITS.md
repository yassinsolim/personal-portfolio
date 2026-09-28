# CREDITS

## Existing Project Credits

- Outer portfolio baseline inspiration: Henry Heffernan
  - Repo: https://github.com/henryjeff/portfolio-website
  - License/attribution: per upstream repository

- Inner OS inspiration: Dustin Brett (daedalOS)
  - Repo: https://github.com/DustinBrett/daedalOS
  - License/attribution: per upstream repository

## Racing Mini-game Additions (This Branch)

- Nordschleife track data (`static/models/Tracks/Nordschleife/nordschleife.json`)
  - Centerline, corner names, overpasses and forest areas: © OpenStreetMap contributors,
    https://www.openstreetmap.org/copyright. The file is a derived database and is available
    under the Open Database License 1.0 (https://opendatacommons.org/licenses/odbl/1-0/)
  - Elevation and terrain: Copernicus GLO-30 DEM, © DLR e.V. 2010-2014 and © Airbus Defence and
    Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights
    reserved. Used under the Copernicus DEM licence
  - Built by `scripts/track/build_nordschleife.py`; the in-game race menu carries the credit

- Race engine audio profiles and shift transients
  - Source: procedural Web Audio synthesis at runtime (no third-party audio samples)
  - License: project-owned synthesis logic

- Race visuals (September 2026): sky, forest, terrain, armco, gantry, smoke, sparks, skid marks
  - Source: generated at runtime in project code (canvas textures, procedural tree geometry).
    The sky uses three.js's `Sky` object (MIT, part of three.js)
  - Third-party asset usage: none
  - License: project-owned implementation code and generated runtime content

- Race stabilization realism pass (February 8, 2026)
  - Added wind/road/tire layers, drift smoke, and edge markings using procedural/runtime-generated content
  - Third-party asset usage: none added in this pass
  - License: project-owned implementation code and generated runtime effects

- Ghost replay data
  - Source: user gameplay telemetry saved locally (`localStorage`)
  - License: user-generated local data

## Vehicle Performance Reference Sources (Tuning Inputs, Not Imported Assets)

The race physics (`race.physics` in `carOptions.ts`) uses each car's published power and torque
from these sources, plus tuning values chosen to land near the listed 0-100 and top speeds.

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
