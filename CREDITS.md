# CREDITS

## Existing Project Credits

- Outer portfolio baseline inspiration: Henry Heffernan
  - Repo: https://github.com/henryjeff/portfolio-website
  - License/attribution: per upstream repository

- Inner OS inspiration: Dustin Brett (daedalOS)
  - Repo: https://github.com/DustinBrett/daedalOS
  - License/attribution: per upstream repository

## Flipper Zero on the desk

- Firmware: the official Flipper Zero firmware 1.4.3 by Flipper Devices Inc. and contributors,
  compiled to WebAssembly by the `flipper-wasm` project (`static/handheld`)
  - Source: https://github.com/yassinsolim/flipper-wasm (release v0.1.0), upstream
    https://github.com/flipperdevices/flipperzero-firmware
  - License: GPL-3.0, modified; a separate program the site talks to only through a Web Worker
    (see `static/handheld/NOTICE.md` and `LICENSE`). Includes the firmware's icons and dolphin
    animations under the same license
  - Unofficial, not affiliated with Flipper Devices Inc.; "Flipper" and "Flipper Zero" are their
    trademarks
- 3D model (`models/Props/handheld.glb`): made from scratch in Blender by
  `scripts/blender/build-flipper.py` from the public dimensions; Flipper's official CAD
  (flipperdevices/flipperzero-3d-models, GPL-3.0) was a visual reference only, no geometry is
  taken from it. No logo
  - License: project-owned
  - Replaces Pavel Zhovner's "Flipper Zero" Sketchfab model (CC BY 4.0), which the desk used
    before and is no longer shipped

## Racing Mini-game Additions (This Branch)

- Nordschleife track data (`static/models/Tracks/Nordschleife/nordschleife.json`)
  - Centerline, corner names, overpasses and forest areas: © OpenStreetMap contributors,
    https://www.openstreetmap.org/copyright. The file is a derived database and is available
    under the Open Database License 1.0 (https://opendatacommons.org/licenses/odbl/1-0/)
  - Road profile, camber and terrain: DGM1, the 1 m lidar ground model of Rhineland-Palatinate,
    © GeoBasis-DE / LVermGeoRP, dl-de/by-2-0, www.lvermgeo.rlp.de [Daten bearbeitet].
    Licence: Datenlizenz Deutschland – Namensnennung – Version 2.0
    (https://www.govdata.de/dl-de/by-2-0). Changes: sampled along the lap, fitted across the
    road, smoothed, and averaged into 30 m terrain cells
  - Elevation fallback outside the DGM1: Copernicus GLO-30 DEM, © DLR e.V. 2010-2014 and © Airbus
    Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA;
    all rights reserved. Used under the Copernicus DEM licence
  - Built by `scripts/track/build_nordschleife.py`; the in-game race menu carries the credit

- Race engine audio (replaced September 2026, see "Race Audio" below)
  - The old oscillator engine sound is gone. Engine, tire and impact sounds now come from the
    recordings and synth listed below.

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

The race physics (`race` in `carOptions.ts`) uses each car's published gearing, tyres, redline,
speed limiter, power and torque. The full list of sources per figure (maker press kits and
technical data, Car and Driver and Auto Bild tests, factory build records, tyre maker revs per mile
from tiresize.com), and which figures are estimated, is in `docs/cars-drivetrain.md`. The main ones:

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

- Supabase (hosted Postgres and Realtime, Free Plan) for the lap leaderboard, ghost replays and lobbies
  - Project: Nordschleife (`qdepbyxxzbdknkfgpwyl`, AWS us-west-2)
  - URL: https://supabase.com

- Three.js (already used across project; racing features also depend on it)
  - Repo: https://github.com/mrdoob/three.js
  - License: MIT

## Race Audio (`static/sounds/race/`)

Each car's sprite (`<carId>.webm` / `.m4a` + `.json`) is built by `scripts/audio/build_audio.py`.
Only processed loops and one-shots ship; the raw recordings are fetched into `audio-src/`
(gitignored) by `scripts/audio/fetch_sources.py`.

### Recordings that ship (processed)

All from the free Sonniss #GameAudioGDC bundles. License: Sonniss GDC bundle license
(https://sonniss.com/gdc-bundle-license/): royalty-free, commercial use allowed, no attribution
required, may be distributed as part of a production; the sounds may not be sold as-is or used
for AI/ML training. Files were downloaded from the public mirror of the official bundles at
https://ftpmirror.your.org/pub/misc/ (exact URLs in `scripts/audio/sources.json`).

| Used for | Recording | Author | Bundle |
| --- | --- | --- | --- |
| BMW F82 M4: idle, light-load and full-throttle loops, start-up | BMW M4 2014, `BMW_M4_t7_Ext_Start_Idle_Blips_Steady_in_Netural_Off_XY_RSM191.wav` and `BMW_M4_t4_Onbrd_Drive_Gearshifts_Engine_Center_DPA4061.wav` | Pole Position Production | GDC 2020 |
| Mercedes-AMG C63 507: idle, full-throttle loops above 3,700 rpm, start-up | Mercedes AMG C63 2009 (W204, same M156 6.2 V8), `Mercedes_C63_t3_Ext_Start_Fast_Away_Up_Reverse_Stop_Away_By_Up_Stop_Off_Wide_AB_MKH8060.wav` | Pole Position Production | GDC 2020 |
| Mercedes-AMG C63 S Coupe and GT63 S Edition 1: idle, loops above 3,700 rpm, start-up | Mercedes AMG GT R 2018 (M178, sister engine of the M177), `mercedes_amg_gtr_t13_ext_start_fast_away_by_up_stop_off_wide_AB_MKH8060.wav` | Pole Position Production | GDC 2019 |
| BMW F90 M5 Competition and M8 Competition: idle, start-up, and the eq target for their synth | BMW X5 M (S63 family), `X50104 BMW X5 M EXHAUST 1 start idle stop.wav` | FLYSOUND | GDC 2018 |
| Tire squeal and scrub (all cars) | Skids & Screeches Tarmac, `Skids_Tarmac_t4_exterior_skidding_in_circles_MKH8060_stand.wav` | Pole Position Production | GDC 2018 |
| Impacts and bumps (all cars) | Car Debris, Impacts & Crashes, `mercedes_benz_dropped_1m_on_concrete_ls-5_2.wav`, `peugeot_106_dropped_5m_on_metal_plates_zaxcom_holophone_1.wav` | Pole Position Production | GDC 2017 |

### Synthesized in this repo (project-owned)

- `scripts/audio/enginesynth.py` renders loops from each engine's real layout (firing order,
  crank, which cylinders share an exhaust path or turbo scroll, runner and pipe lengths):
  - BMW E92 M3 (S65), Mercedes-AMG One (PU106B-derived V6), Toyota Crown Platinum (T24A-FTS):
    every engine loop.
  - BMW M5 / M8 Competition (S63B44T4 with the cross-bank manifold): driving loops, eq'd toward
    the X5 M exhaust recording.
  - C63 507, C63 S, GT63 S: only the loops below about 3,700 rpm that the recordings don't cover,
    eq'd to match the lowest recorded loop.
  - Overrun pops, crackles, upshift crackle and turbo release one-shots for every car.
- Runtime Web Audio (`src/Application/Racing/Audio/`): turbo whistle, hybrid motor whine, wind,
  road, kerb rumble, grass and barrier scrape are generated live.

### Reference recordings (analysis only, not shipped)

Used to check order structure and tone by spectrum analysis. Nothing from them is in the repo.

- "live formula 1 racing", Geoff-Bremner-Audio, Freesound 752264, CC BY 4.0
  (https://freesound.org/people/Geoff-Bremner-Audio/sounds/752264/): 90/150 degree odd-fire
  order pattern of the current F1 V6, used for the AMG One synth.
- "AUDIO M4 WAV.wav", Andreabarata, Freesound 335345, CC0
  (https://freesound.org/people/Andreabarata/sounds/335345/): S55 idle and rev check.
- "BMW M3 GT2 (2010).ogg" and "Mercedes-Benz SLS AMG.ogg", Edvvc, Wikimedia Commons, CC BY-SA 3.0:
  S65-family and M156-family spectra.
- BMW Z4 GT3 racecar onboard (P65, S65-derived), Pole Position Production, Sonniss GDC 2017.

### Engine data behind the profiles

- BMW S65B40 (E92 M3): BMW ST709 technical training, S65B40 engine
  (https://archive.org/details/BMWTechnicalTrainingDocuments): firing order 1-5-4-8-7-2-6-3,
  individual throttle bodies, 4-into-1 manifold per bank, dual-flow exhaust into a shared 35 l
  rear muffler. Redline 8,400 rpm, 420 PS at 8,300 rpm (https://en.wikipedia.org/wiki/BMW_S65).
- BMW S55B30 (F82 M4): BMW S55 technical training
  (https://bmwtuning.co/wp-content/uploads/2023/07/S55-Engine-Training-Docs.pdf): two mono-scroll
  turbos fed by cylinders 1-3 and 4-6, electric exhaust flaps, Active Sound Design, engine speeds
  up to 7,600 rpm. Firing order 1-5-3-6-2-4.
- BMW S63B44T4 (F90 M5 Competition, M8 Competition): BMW S63TU technical training
  (https://bimmerly.com/resources/s63tu-engine-technical-information.pdf): cross-bank manifold,
  cylinders 1/6 and 4/7 to one twin-scroll turbo and 2/8 and 3/5 to the other. Firing order
  1-5-4-8-6-3-7-2. 625 PS (https://en.wikipedia.org/wiki/BMW_N63).
- Mercedes M156 (C63 507): 6,208 cc na V8, firing order 1-5-4-2-6-3-7-8
  (https://torqfix.com/engine/156.985), 507 PS (https://en.wikipedia.org/wiki/Mercedes-Benz_M156_engine).
- Mercedes M177 (C63 S, GT63 S): 3,982 cc twin-turbo V8 with the turbos inside the V; C63 S
  510 PS, 7,000 rpm redline (https://media.mbusa.com/releases/release-ff2180eee6724e568fbf52263b1d37af-2019-mercedes-amg-c-63-coupe-and-c-63-s-coupe-specifications);
  GT63 S 639 PS with twin-scroll turbos (Mercedes-AMG GT 63 S 4-Door brochure).
- Mercedes-AMG One: 1.6 V6 turbo from the PU106B, 1,280 rpm idle and 11,000 rpm limit
  (https://en.wikipedia.org/wiki/Mercedes-AMG_One, https://www.mercedes-amg.com/en/technical-briefing-combustion-engine).
  The exact firing order isn't published. The F1 power-unit rules are generally read as
  banning split crank pins, which means a three-throw crank with odd 90/150 degree firing gaps,
  so the synth uses that; the 1.5 and 3 order lines in the F1 reference recording fit it.
- Toyota T24A-FTS (Crown Platinum): 2,393 cc turbo inline-4 with a twin-scroll turbo
  (https://toyota-club.net/files/faq/21-09-20_faq_t24-engine_en.htm), 264 hp at 6,000 rpm and a
  6-speed automatic (Toyota Canada 2025 Crown product information). Firing order 1-3-4-2 is
  assumed (the usual inline-4 order); Toyota doesn't publish it.
