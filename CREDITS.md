# CREDITS

## Existing Project Credits

- Outer portfolio baseline and room assets: Henry Heffernan
  - Repo: https://github.com/henryjeff/portfolio-website
  - License: MIT, Copyright 2024 Henry Heffernan (notice below)
  - Files from that repo, byte for byte: the environment map (`static/textures/environmentMap/`).
    The old room models and their bakes are gone since room v2; its studio backdrop mesh comes
    from upstream's `environment.glb` (re-baked, inside `static/models/Room/room_v2*.glb`)
  - Upstream doesn't say where the environment map came from. Its room sounds and radio tracks
    (`static/audio/`) were never loaded or deployed here and were removed

- Inner OS inspiration: Dustin Brett (daedalOS)
  - Repo: https://github.com/DustinBrett/daedalOS
  - License/attribution: per upstream repository

## Room v2 (September 2026)

- The desk setup (desk, arms, the three monitors, the PC and its parts, keyboard, mouse, pad,
  headphones, chair, mug, credits card) is modelled from scratch by `scripts/room/` (bpy) after
  the real products' published dimensions (`docs/room-v2-peripherals.md`), with no downloaded
  models and no brand logos. Lighting baked in Blender Cycles.
- The studio backdrop mesh is carried over from Henry Heffernan's original room (MIT, below).
- The old room's desk, computer, chair, plant and paper models (and their bakes) are no longer
  used and were removed.

### MIT License (henryjeff/portfolio-website)

Copyright 2024 Henry Heffernan

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## 3D Models

Checked against each model's Sketchfab listing through its public API (September 29, 2026).
The same list is in the race menu under "3D models" (`src/Application/modelCredits.ts`). The
original downloads, unmodified, are in `models-src/`.

- Mercedes-AMG One (`static/models/Cars/mercedes_amg_project_one/`)
  - Title: "Mercedes AMG Project ONE"
  - Author: hashikemu (https://sketchfab.com/hashikemu)
  - Source: https://sketchfab.com/3d-models/mercedes-amg-project-one-287716b5aeb24b0b934452526827eb52
  - License: CC BY-NC 4.0 (https://creativecommons.org/licenses/by-nc/4.0/)
  - Changes: Textures deduplicated, resized to at most 1024 px and converted to WebP; geometry welded and
    Draco compressed (`scripts/optimize-models.mjs`). A low detail `.lite.glb` (whole model
    simplified to 1 cm, 512 px textures) for weak GPUs, and `.ktx2.glb` twins of both with
    KTX2 (BasisU) textures (`scripts/build-ktx2-cars.mjs`). The
    garage recolours the paint and can fit another car's wheels at runtime
- BMW E92 M3 (`static/models/Cars/bmw_m3_e92_stance/`)
  - Title: "BMW M3 e92 [stance]"
  - Author: Black Snow (https://sketchfab.com/BlackSnow02)
  - Source: https://sketchfab.com/3d-models/bmw-m3-e92-stance-c35a14d811b042d792a6da69381f7f80
  - License: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)
  - Changes: Textures deduplicated, resized to at most 1024 px and converted to WebP; geometry welded and
    Draco compressed (`scripts/optimize-models.mjs`). A low detail `.lite.glb` (whole model
    simplified to 1 cm, 512 px textures) for weak GPUs, and `.ktx2.glb` twins of both with
    KTX2 (BasisU) textures and meshes merged by gltfpack (`scripts/build-ktx2-cars.mjs`). The
    garage recolours the paint and can fit another car's wheels at runtime
- Mercedes-AMG C63 507 (`static/models/Cars/2014_mercedes-benz_c63_amg_edition_507/`)
  - Title: "2014 Mercedes-Benz C63 AMG Edition 507"
  - Author: Ddiaz Design (https://sketchfab.com/ddiaz-design)
  - Source: https://sketchfab.com/3d-models/2014-mercedes-benz-c63-amg-edition-507-f3b3da1832294845be7b05a21b5ad8fd
  - License: CC BY-NC-SA 4.0 (https://creativecommons.org/licenses/by-nc-sa/4.0/)
  - Changes: Textures deduplicated, resized to at most 1024 px and converted to WebP; geometry welded and
    Draco compressed (`scripts/optimize-models.mjs`). A low detail `.lite.glb` (whole model
    simplified to 1 cm, 512 px textures) for weak GPUs, and `.ktx2.glb` twins of both with
    KTX2 (BasisU) textures and meshes merged by gltfpack (`scripts/build-ktx2-cars.mjs`). The
    garage recolours the paint and can fit another car's wheels at runtime
  - ShareAlike: our adapted versions of this model are distributed under the same license, CC BY-NC-SA 4.0
- Mercedes-AMG C63s Coupe (`static/models/Cars/2019_mercedes-benz_c63_s_amg_coupe/`)
  - Title: "2019 Mercedes-Benz C63 S AMG Coupe"
  - Author: Ddiaz Design (https://sketchfab.com/ddiaz-design)
  - Source: https://sketchfab.com/3d-models/2019-mercedes-benz-c63-s-amg-coupe-07f1e84892384aa08891b1f4cf266dd0
  - License: CC BY-NC-SA 4.0 (https://creativecommons.org/licenses/by-nc-sa/4.0/)
  - Changes: Textures deduplicated, resized to at most 1024 px and converted to WebP; geometry welded and
    Draco compressed (`scripts/optimize-models.mjs`). A low detail `.lite.glb` (whole model
    simplified to 1 cm, 512 px textures) for weak GPUs, and `.ktx2.glb` twins of both with
    KTX2 (BasisU) textures and meshes merged by gltfpack (`scripts/build-ktx2-cars.mjs`). The
    garage recolours the paint and can fit another car's wheels at runtime
  - ShareAlike: our adapted versions of this model are distributed under the same license, CC BY-NC-SA 4.0
- BMW F82 M4 (`static/models/Cars/bmw_m4_f82/`)
  - Title: "BMW M4 f82"
  - Author: Black Snow (https://sketchfab.com/BlackSnow02)
  - Source: https://sketchfab.com/3d-models/bmw-m4-f82-8e87379f40fd40dcac0a751e22c1a188
  - License: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)
  - Changes: Textures deduplicated, resized to at most 1024 px and converted to WebP; geometry welded and
    Draco compressed (`scripts/optimize-models.mjs`). A low detail `.lite.glb` (whole model
    simplified to 1 cm, 512 px textures) for weak GPUs, and `.ktx2.glb` twins of both with
    KTX2 (BasisU) textures and meshes merged by gltfpack (`scripts/build-ktx2-cars.mjs`). The
    garage recolours the paint and can fit another car's wheels at runtime
- BMW F90 M5 Competition (`static/models/Cars/bmw_f90_m5_competition/`)
  - Title: "2021 BMW M5 Competition"
  - Author: Ddiaz Design (https://sketchfab.com/ddiaz-design)
  - Source: https://sketchfab.com/3d-models/2021-bmw-m5-competition-29a4c13761cb40e6a050871bd40a0963
  - License: CC BY-NC-SA 4.0 (https://creativecommons.org/licenses/by-nc-sa/4.0/)
  - Changes: Textures deduplicated, resized to at most 1024 px and converted to WebP; geometry welded and
    Draco compressed (`scripts/optimize-models.mjs`). A low detail `.lite.glb` (whole model
    simplified to 1 cm, 512 px textures) for weak GPUs, and `.ktx2.glb` twins of both with
    KTX2 (BasisU) textures and meshes merged by gltfpack (`scripts/build-ktx2-cars.mjs`). The
    garage recolours the paint and can fit another car's wheels at runtime
  - ShareAlike: our adapted versions of this model are distributed under the same license, CC BY-NC-SA 4.0
- BMW M8 Competition Coupe (`static/models/Cars/bmw_m8_competition_coupe/`)
  - Title: "2020 BMW M8 Competition Coupé"
  - Author: Ddiaz Design (https://sketchfab.com/ddiaz-design)
  - Source: https://sketchfab.com/3d-models/2020-bmw-m8-competition-coupe-f68a25584899494391c8f2ae28c03b2f
  - License: CC BY-NC-SA 4.0 (https://creativecommons.org/licenses/by-nc-sa/4.0/)
  - Changes: Textures deduplicated, resized to at most 1024 px and converted to WebP; geometry welded and
    Draco compressed (`scripts/optimize-models.mjs`). A low detail `.lite.glb` (whole model
    simplified to 1 cm, 512 px textures) for weak GPUs, and `.ktx2.glb` twins of both with
    KTX2 (BasisU) textures and meshes merged by gltfpack (`scripts/build-ktx2-cars.mjs`). The
    garage recolours the paint and can fit another car's wheels at runtime
  - ShareAlike: our adapted versions of this model are distributed under the same license, CC BY-NC-SA 4.0
- Toyota Crown Platinum (`static/models/Cars/toyota_crown_2025/`)
  - Title: "toyota crown 2025"
  - Author: sultan (https://sketchfab.com/s122)
  - Source: https://sketchfab.com/3d-models/toyota-crown-2025-9f48fc0a66e44a69a09fda2f864e5944
  - License: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)
  - Changes: The model has no textures. Geometry welded and Draco compressed; a low detail `.lite.glb`
    with simplified geometry. The garage recolours the paint and can fit another car's wheels
- Mercedes-AMG GT63s Edition One (`static/models/Cars/mercedes_benz_gt63s_edition_one/`)
  - Title in the file: "Mercedes-Benz AMG GT63 S" (a Blender re-export with no author, source or
    license metadata, added in `00b5fe1`)
  - Author: friends of Yassin, who made it and shared it with him directly (not named here). It
    has no public source or license
  - Changes: brake discs simplified, plus the same web, lite and KTX2 steps as the other cars
- Lamborghini Huracán LP 610-4 (`static/models/Cars/lamborghini_huracan/`)
  - Title: "2015 Lamborghini Huracan LP610-4"
  - Author: Ddiaz Design (https://sketchfab.com/ddiaz-design)
  - Source: https://sketchfab.com/3d-models/2015-lamborghini-huracan-lp610-4-6857c07260714cbbbb3b4b1d7087604f
  - License: CC BY-NC-SA 4.0 (https://creativecommons.org/licenses/by-nc-sa/4.0/)
  - Changes: the wheel and caliper parts regrouped into one node per corner and merged by
    material (`scripts/lib/wheel-groups.mjs`), then the same web, lite and KTX2 steps as the
    other cars. The garage recolours the paint and can fit another car's wheels at runtime
  - ShareAlike: our adapted versions of this model are distributed under the same license, CC BY-NC-SA 4.0
- Lamborghini Aventador S (`static/models/Cars/lamborghini_aventador_s/`)
  - Title: "2017 Lamborghini Aventador S LP 740-4"
  - Author: Ddiaz Design (https://sketchfab.com/ddiaz-design)
  - Source: https://sketchfab.com/3d-models/2017-lamborghini-aventador-s-lp-740-4-c2ca558099b040ff970012300e100b75
  - License: CC BY-NC-SA 4.0 (https://creativecommons.org/licenses/by-nc-sa/4.0/)
  - Changes: as the Huracán
  - ShareAlike: our adapted versions of this model are distributed under the same license, CC BY-NC-SA 4.0
- Ferrari LaFerrari (`static/models/Cars/ferrari_laferrari/`)
  - Title: "2014 Ferrari LaFerrari"
  - Author: Ddiaz Design (https://sketchfab.com/ddiaz-design)
  - Source: https://sketchfab.com/3d-models/2014-ferrari-laferrari-8b46fa49718647de846387ef4c1e95b3
  - License: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)
  - Changes: as the Huracán
- McLaren P1 (`static/models/Cars/mclaren_p1/`)
  - Title: "Mclaren P1 | www.vecarz.com"
  - Author: vecarz (https://sketchfab.com/heynic)
  - Source: https://sketchfab.com/3d-models/mclaren-p1-wwwvecarzcom-adae2edc721e4ce7b31c1d06a581e30a
  - License: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)
  - Changes: as the Huracán
- Porsche 918 Spyder (`static/models/Cars/porsche_918_spyder/`)
  - Title: "2015 Porsche 918 Spyder"
  - Author: Ddiaz Design (https://sketchfab.com/ddiaz-design)
  - Source: https://sketchfab.com/3d-models/2015-porsche-918-spyder-f6d03ef13bf243c8b632ca7bacd8c0f3
  - License: CC BY-NC-SA 4.0 (https://creativecommons.org/licenses/by-nc-sa/4.0/)
  - Changes: as the Huracán
  - ShareAlike: our adapted versions of this model are distributed under the same license, CC BY-NC-SA 4.0
- Bugatti Chiron Super Sport (`static/models/Cars/bugatti_chiron_super_sport/`)
  - Title: "2022 Bugatti Chiron Super Sport"
  - Author: Ddiaz Design (https://sketchfab.com/ddiaz-design)
  - Source: https://sketchfab.com/3d-models/2022-bugatti-chiron-super-sport-6a7520f6853f433eb200ed10fef96f94
  - License: CC BY-NC-SA 4.0 (https://creativecommons.org/licenses/by-nc-sa/4.0/)
  - Changes: as the Huracán
  - ShareAlike: our adapted versions of this model are distributed under the same license, CC BY-NC-SA 4.0
- Koenigsegg Jesko Attack (`static/models/Cars/koenigsegg_jesko/`)
  - Title: "2020 Koenigsegg Jesko"
  - Author: Ddiaz Design (https://sketchfab.com/ddiaz-design)
  - Source: https://sketchfab.com/3d-models/2020-koenigsegg-jesko-c657f51fb0db43e38fea172dfa385287
  - License: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)
  - Changes: as the Huracán
- Pagani Huayra (`static/models/Cars/pagani_huayra/`)
  - Title: "Pagani Huayra [Free]"
  - Author: Black Snow (https://sketchfab.com/BlackSnow02)
  - Source: https://sketchfab.com/3d-models/pagani-huayra-free-c2d61a9f53a54a229547bb76e4b71e25
  - License: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)
  - Changes: as the Huracán; the rims and brakes came as one mesh for all four wheels and are
    cut apart per corner
- McLaren Senna (`static/models/Cars/mclaren_senna/`)
  - Title: "2019 McLaren Senna"
  - Author: Ddiaz Design (https://sketchfab.com/ddiaz-design)
  - Source: https://sketchfab.com/3d-models/2019-mclaren-senna-6924eb7b4dde44b19d87c8c31edc74b4
  - License: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)
  - Changes: as the Huracán
- Ferrari SF90 Stradale (`static/models/Cars/ferrari_sf90_stradale/`)
  - Title: "2020 Ferrari SF90 Stradale"
  - Author: Ddiaz Design (https://sketchfab.com/ddiaz-design)
  - Source: https://sketchfab.com/3d-models/2020-ferrari-sf90-stradale-b98147fea0da42d29a2e41a4aba0fc20
  - License: CC BY-NC-SA 4.0 (https://creativecommons.org/licenses/by-nc-sa/4.0/)
  - Changes: as the Huracán
  - ShareAlike: our adapted versions of this model are distributed under the same license, CC BY-NC-SA 4.0
- Aston Martin Valkyrie (`static/models/Cars/aston_martin_valkyrie/`)
  - Title: "2021 | Aston Martin Valkyrie"
  - Author: kevin (ケビン) (https://sketchfab.com/sohyalebret)
  - Source: https://sketchfab.com/3d-models/2021-aston-martin-valkyrie-0ad5999a62be459c8f883ea0b58cf876
  - License: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)
  - Changes: as the Pagani Huayra

The non-commercial models (CC BY-NC and CC BY-NC-SA) are used on a personal portfolio that has
no ads, sales or sponsorship.
## Flipper Zero on the desk

- Firmware: the official Flipper Zero firmware 1.4.3 by Flipper Devices Inc. and contributors,
  compiled to WebAssembly by the `flipper-wasm` project (`static/handheld`)
  - Source: https://github.com/yassinsolim/flipper-wasm (release v0.1.1), upstream
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

- Lamborghini Huracán LP 610-4: Car and Driver test and the Huracán owner's handbook (gearing)
  - URL: https://www.caranddriver.com/reviews/a15108747/2015-lamborghini-huracan-lp610-4-tested-review/
  - Usage: gearing, top speed and acceleration envelope

- Lamborghini Aventador S technical data
  - URL: https://autointernational.com.my/WebNews/News/Year%202017/Lamborghini%20Avantador%20S%20-%202%20Mar%2017/Aventador%20S%20technical%20specs.pdf
  - Usage: gearing, top speed and acceleration envelope

- Ferrari LaFerrari technical specifications, Motor Trend test, F12berlinetta owner's manual
  - URL: https://web.archive.org/web/20150110075807/http://www.laferrari.com/en/techicalspecifications/
  - Usage: gearing, top speed and acceleration envelope

- McLaren P1 owner's handbook
  - URL: https://www.manualslib.com/manual/1643049/Mclaren-P1.html?page=224
  - Usage: gearing, tyres, mass, top speed and acceleration envelope

- Porsche 918 Spyder press kit (2013)
  - URL: https://web.archive.org/web/20190721105445/https://presse.porsche.de/presskits_until_2015/products/2013/spyder/text/presskit/918_Spyder_Fahrvorstellung_EN6_hp.pdf
  - Usage: gearing, tyres, mass, top speed and acceleration envelope

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
| Lamborghini V10 (garage engine, Huracan): idle, free-rev and pass-by loops from 2,000 to 7,200 rpm, start-up | Lamborghini Huracan 2014, `lamborghini_huracan_t12_ext_start_idle_blips_off_XY_RSM191.wav` and `lamborghini_huracan_t10_ext_bys_gearshifts_left_turn_point_XY_MKH8040.wav` | Pole Position Production | GDC 2019 |
| Lamborghini V12 (garage engine, Aventador): idle and loops to 3,600 rpm, start-up | Lamborghini Aventador 2014, `lamborghini_aventador_t14_onbrd_start_drive_ramps_stop_off_exhaust_right_DPA4062.wav` | Pole Position Production | GDC 2020 |
| Ferrari V12 hybrid (garage engine, LaFerrari): idle and loops to 3,100 rpm, start-up | Ferrari 812 Superfast 2018 and F12 2016 (F140 V12, the LaFerrari's family), `Ferrari, 812, t7, Onbrd, Start, Idle, Steady, Blips, Off, Engine, Mix.wav` and `Ferrari_F12_t2_Onbrd_Start_Medium_Drive_Stop_Reverse_Stop_Drive_Stop_Off_Engine_Left_DPA4061.wav` | Pole Position Production | GDC 2020 |
| McLaren V8 hybrid (garage engine, P1) and the McLaren Senna's M840TR: idle and loops to 7,400 rpm, start-up | McLaren 570S 2016 (M838TE, the P1's M838T family), `McLaren_570S_t7_Onbrd_Start_Idle_Steady_in_Neutral_Blips_Off_Interior_Mix.wav` and `McLaren_570S_t10_Onbrd_Fast_Various_Exhaust_Right_DPA4062.wav` | Pole Position Production | GDC 2020 |
| Porsche 918 V8 hybrid (garage engine), and the Ferrari SF90 Stradale with turbos and motors added live: idle and loops to 9,000 rpm | Ferrari 458 2013 (4.5 flat-plane V8, the closest licensed match to the 918's 4.6 flat-plane V8), `ferrari_458_t8_onbrd_drive_ramps_stop_off_intake_left_DPA4062.wav` | Pole Position Production | GDC 2020 |
| Tire squeal and scrub (all cars) | Skids & Screeches Tarmac, `Skids_Tarmac_t4_exterior_skidding_in_circles_MKH8060_stand.wav` | Pole Position Production | GDC 2018 |
| Impacts and bumps (all cars) | Car Debris, Impacts & Crashes, `mercedes_benz_dropped_1m_on_concrete_ls-5_2.wav`, `peugeot_106_dropped_5m_on_metal_plates_zaxcom_holophone_1.wav` | Pole Position Production | GDC 2017 |

### Synthesized in this repo (project-owned)

- `scripts/audio/enginesynth.py` renders loops from each engine's real layout (firing order,
  crank, which cylinders share an exhaust path or turbo scroll, runner and pipe lengths):
  - BMW E92 M3 (S65), Mercedes-AMG One (PU106B-derived V6), Toyota Crown Platinum (T24A-FTS),
    Bugatti Chiron Super Sport (W16), Koenigsegg Jesko (V8), Pagani Huayra (M158 V12), Aston
    Martin Valkyrie (Cosworth V12): every engine loop.
  - BMW M5 / M8 Competition (S63B44T4 with the cross-bank manifold): driving loops, eq'd toward
    the X5 M exhaust recording.
  - C63 507, C63 S, GT63 S: only the loops below about 3,700 rpm that the recordings don't cover,
    eq'd to match the lowest recorded loop.
  - Lamborghini V12 (L539) above 4,000 rpm and Ferrari V12 (F140FE) above 3,500 rpm, eq'd to
    match the highest recorded loop; the V10's ends and the McLaren V8's top the same way.
  - Overrun pops, crackles, upshift crackle and turbo release one-shots for every car.
- Runtime Web Audio (`src/Application/Racing/Audio/`): turbo whistle, supercharger whine, hybrid motor whine, wind,
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
- Bugatti W16 (Chiron Super Sport): 7,993 cc W16 with four turbos, two of them only above
  3,800 rpm, 1,600 PS at 7,050 rpm, limit about 7,100 rpm (Bugatti Chiron Super Sport technical
  data and press release, see carOptions.ts). It fires evenly every 45 degrees; the firing order
  used, 1-14-9-4-7-12-15-6-13-8-3-16-11-2-5-10, and which cylinders feed which turbo are
  assumptions, Bugatti doesn't publish them.
- Koenigsegg V8 (Jesko): 5.0 twin-turbo flat-plane V8, 8,500 rpm (Koenigsegg Jesko Attack
  technical specifications). Firing order assumed to be the usual flat-plane 1-5-3-7-4-8-2-6.
- Mercedes-AMG M158 (Pagani Huayra): 5,980 cc twin-turbo 60 degree V12, a turbo per bank
  (pagani.com, archived). The firing order is taken from Mercedes' other V12s
  (1-12-5-8-3-10-6-7-2-11-4-9) and the 6,500 rpm limit is an estimate.
- Cosworth V12 (Aston Martin Valkyrie): 6.5 na 65 degree V12, 1,200 rpm idle, 11,100 rpm limit
  (astonmartin.com Valkyrie specifications). Even 60 degree firing; the firing order isn't
  published, the synth uses 1-7-5-11-3-9-6-12-2-8-4-10.
