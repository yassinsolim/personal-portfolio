# Room v2 build: setup.json and the pipeline

Everything the baked room is made of comes from `setup.json` through the bpy builders in this
folder. Change a number there and rerun the pipeline; nothing is edited by hand in Blender.

## Coordinates

- Room metres in three.js axes: x right, y up, z toward the chair. The origin is on the floor under
  the main screen's centre line.
- `units.per_metre` (2763.957, the car's scale) and `units.floor_y` (-2984.2) turn room metres into
  site units: `(x * U, floor_y + y * U, z * U)`. The exported glbs are already in site units, every
  node transform is identity except the empties'.
- `car_box_three` is the AMG One's box in site units. Nothing but the shell may overlap it
  (`check-room.mjs` fails otherwise).
- Rotations are three.js style: roll about z, then tilt about x, then yaw about y, in degrees.

## Keys

| Key | What it sets |
|---|---|
| `desk` | Top: `w`, `d`, `h` (top surface height), `top_t`, centre `x`, `z`, `corner_r`, `edge_bevel`. `frame`: two leg standing desk frame; `leg_inset` from each end, `column` stages bottom to top as (width, depth), `foot`, `motor`, `rail` (side brackets), `beam` (crossbeam, `z` offset), `control_box`, `keypad` (height buttons at the front edge) |
| `screens` | `active` area (0.5967 x 0.3357 m, a 27 inch 16:9 panel). `m1`, `m2`, `m3`: `center` of each active area (exactly the blockout's), `tilt`, `yaw`, `portrait`. These are what the site reads; don't move them |
| `monitor` | The shared body: `bezel` (top, side, chin), slim `panel_t`, `edge_bevel`, rear `bulge` (housing size, `y` offset from the active centre, its bevel). The vesa plate sits on the bulge's back |
| `arms` | `clamp` (desk clamp plate, spine, jaw, knob), `seg` (link width and height, joint radius, collar, head depth, vesa `plate`). `single` (m1) and `dual` (m2 and m3): `pole` position (x, z) on the back edge, `pole_r`, `pole_h`, and per arm the `screen`, `collar_y`, link lengths `l1`, `l2` and which way the elbow `bend`s. The elbow is solved in plan so each head lands on its monitor's vesa plate |
| `pc` | Phanteks NV5 `case` (239 x 477 x 528 mm) at `x`, `z`, `yaw`; front toward +z, side glass toward -x. `base_h`, `foot_h`, `top_t`, `wall_t`, `tray_x` (motherboard tray), `glass.t`, `board`, `gpu` (340 x 140 x 70 mm, `top_y`, `rear`, backplate `cutout`, `fins`), `pump`, `ram`, `radiator`, `fan` (120 mm, blades, light ring width), `rear_fan`, `side_fans` (3 stacked at the front of the right wall), `shroud` (top height and the stepped edge's z range), `tubes`, `led.w` |
| `keyboard` | Wooting 60HE at `x`, `z`, `yaw`: `case` (302 x 116 mm), `front_h`, typing `angle`, `bezel` (side, front, back), `rim_depth`, key pitch `u`, `cap_gap`, `cap_lift`, per row `row_h` and `row_tilt`, `strap` (clipped at the left side near the back), `cable` (path in room x, z to the desk's back edge), `uv_weight` |
| `mouse` | Finalmouse ULX Tiger at `x`, `z`, `yaw`; `l`, `w`, `h`, the shape `profile_*` (width and height along the length, front to back), `squareness`, `blue_split` (height share of the blue lower shell), wheel and side buttons |
| `pad`, `headphones`, `mug`, `card` | Position, yaw and size of the Artisan L pad, the HD 599 SE (lying flat), the coffee mug (its handle yaw) and the A6 credits card. `uv_weight` gives a part more texels (the card gets 14x the area so its text reads) |
| `flipper_spot` | Where the empty goes (bottom centre on the desk), its `yaw`, the device size and the `clear` zone the builder checks is empty |
| `chair` | Low back chair at `x`, `z`, `yaw` (seat front is local -z). `seat_y`, `base`, `seat`, `back`, `arms` |
| `shell` | Extra coplanar cuts in today's flat floor (`floor_cuts_x`, `floor_cuts_z`), the floor uv `warp` (gain times more texels within `sigma` metres of `center`), and the wall and ceiling uv weights |
| `uv` | Smart project `angle`, island `gap_px` (at the atlas size), and weights for islands that face down, toward the back (away from every camera), and the pc's right side |
| `palette` | Bake colours (srgb hex, diffuse only). `screen` and `led` are emitters (blackbody `temp`, `strength`), `glass` is the export glass |
| `lighting` | `ambient` (a ceiling sized soft light), `key` (over the setup), `fill` (low, from the camera side), `shell_albedo` (linear floor and wall colours solved by `bake.py --calibrate`), `exposure`, and the RaceReveal greys the shell is calibrated against |
| `bake` | Samples per tier, margin (16 px), atlas sizes per tier |
| `export` | Colours of the `screen`, `led` and `glass` materials in the glb |

## Pipeline

```sh
# 1. geometry, uvs and a .blend per tier (plus the greybox glb for the high tier)
blender -b --factory-startup --python scripts/room/build_room.py -- --repo . --out ~/Assets/portfolio-room/v2 --tier high --greybox --check
blender -b --factory-startup --python scripts/room/build_room.py -- --repo . --out ~/Assets/portfolio-room/v2 --tier low --check
# 2. bake (cycles, metal): light and colour per atlas, oidn, composed into 8 bit srgb atlases
blender -b ~/Assets/portfolio-room/v2/room_v2_high.blend --python scripts/room/bake.py -- --repo . --out ~/Assets/portfolio-room/v2 --tier high
blender -b ~/Assets/portfolio-room/v2/room_v2_low.blend --python scripts/room/bake.py -- --repo . --out ~/Assets/portfolio-room/v2 --tier low
# 3. raw glbs, then the site files (draco + webp, draco + ktx2)
blender -b ~/Assets/portfolio-room/v2/room_v2_high.blend --python scripts/room/export.py -- --out ~/Assets/portfolio-room/v2 --tier high
blender -b ~/Assets/portfolio-room/v2/room_v2_low.blend --python scripts/room/export.py -- --out ~/Assets/portfolio-room/v2 --tier low
node scripts/room/pack-room.mjs
# 4. budgets, node names, screen corners, car box
node scripts/room/check-room.mjs
# review renders (baked look, the amg one placed like World/Car.ts)
blender -b ~/Assets/portfolio-room/v2/room_v2_high.blend --python scripts/room/render_review.py -- --repo . --out ~/Assets/portfolio-room/v2/renders --look baked
```

The machine is shared: run Blender with `nice -n 10` and wait while the load average is above
about 8. A full high bake takes about a minute and a half on the M5's GPU.

- `build_room.py --check` prints the sight lines (share of sample points each homepage camera sees
  on the pc glass, the screens, the keyboard and the mouse) and whether the flipper spot's clear
  zone is empty. `--chair x,z,yaw` tries another chair spot.
- `bake.py --calibrate` bakes the shell small with the ambient alone and the key alone and solves
  both strengths so a 0.62 albedo floor and wall land on RaceReveal's `ROOM_FLOOR` and `ROOM_WALL`;
  put the printed values in `lighting`. Every bake reports the floor ring around the car and the
  walls in srgb.
- Parts of one atlas are baked as one joined copy: Blender applies the bake margin per object, so
  separate parts would paint their margins over each other's islands.
- `card_texture.py` draws the card from the credits in `scripts/build-room-textures.py`.

## Output

- `static/models/Room/room_v2.glb` and `room_v2.ktx2.glb` (high), `room_v2.low.glb` and
  `room_v2.low.ktx2.glb` (low). Top level nodes: `room_shell`, `room_desk` (desk, frame, arms,
  monitor bodies; children `m1_screen`, `m2_screen`, `m3_screen`), `room_pc` (children `pc_glass`,
  `pc_leds`, `anchor_pc`), `room_chair`, `room_props` (keyboard, mouse, pad, headphones, mug, card;
  children `anchor_keyboard`, `anchor_mouse`, `anchor_mug`, `flipper_spot`).
- Materials: `bake_setup`, `bake_pc`, `bake_shell` (atlas as base colour, KHR_materials_unlit),
  `screen` (black), `led` (cool white, unlit), `glass` (blended, alpha 0.12, the only mesh with
  normals).
- Screens: one quad each, exactly the active area, uv 0..1 with u to the right and v up as the
  screen is read.
- Outside the repo, in `~/Assets/portfolio-room/v2/`: the .blend files, `atlas/` (pngs, raw exrs,
  bake reports), `export/` (raw glbs), `renders/`, `room_v2_greybox.glb`, `check.txt`.
