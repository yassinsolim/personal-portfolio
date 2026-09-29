# Room v2: plan and blockout

Status: plan only, waiting for approval. Nothing in the site changes yet. This branch adds this
doc and the blockout scripts (`scripts/room/blockout.py`, `scripts/room/label_renders.py`). The
reference photos and the renders stay outside the repo.

## Summary

- The three reference photos all show the PC and nothing else: a white Phanteks NV5 (CyberPowerPC
  build) with a Gigabyte RTX 5080 GAMING OC, a white 360 mm AIO, Corsair Dominator RAM and cool
  white LEDs, sitting on the floor. The desk, the three OLED monitors, the keyboard, mouse and
  speakers are not in any photo, so their sizes below are placeholders until Yassin confirms them.
- The blockout keeps the car exactly where it is (same model, same code path) and builds the new
  setup around it at the car's true scale: three identical 27 inch 16:9 OLEDs (two stacked, one
  portrait on the right), a 160 x 80 cm desk, the PC on the floor at the desk's left end, and the
  Flipper Zero spot left of the keyboard.
- Screens: M1 (bottom) is the only live yassinOS iframe. M2 (top) is a widgets display and M3
  (portrait) is a terminal, both plain DOM drawn by the portfolio in yassinOS's theme, not
  iframes. All three are CSS3D planes like today's monitor, so they look the same. Click to focus
  any of them; the camera frames each one from its real size.
- The race handoff is safe: at the chase camera's first pose the screens face away from it, so
  the plate never has a CSS hole in it. The car doesn't move, so #52 needs checks, not re-tuning.
- yassinOS needs a small embed bridge (it ignores `?embed=1` today and sends no messages), a
  1600 x 900 layout, a static spanned wallpaper for the room, and a poster image.
- Budget: the room stays no heavier to download than today and uses at most a sixth of today's
  texture memory (today's three 4k JPEGs are about 255 MB on the GPU).

## 1. Reference breakdown

### What the photos show

`IMG_4462` and `IMG_4463` are the case from its front left corner at floor height; `IMG_4464` is
the side glass straight on. The white balance is cool, so the white LEDs read slightly blue. The
case stands on the floor with a cable coming down from above, so it lives under or beside the
desk, not on it. Other things in frame (furniture, another machine, the floor and wall) are
personal and stay out of the room.

| Part | What's visible | Identification | Confidence |
|---|---|---|---|
| Case | White mid tower, pillarless glass front and left side, stepped PSU shroud with a CYBERPOWERPC logo | Phanteks NV5 in white, sold by CyberPowerPC as "PHANTEKS NV5s" with this exact CPU, GPU and cooler. 239 W x 477 H x 528 D mm | High (logo, layout, a matching CyberPowerPC listing); the dimension order is from Phanteks' spec |
| GPU | Horizontal triple fan card, dark grey shroud, metal backplate with a large cutout, "GAMING", "GIGABYTE", "GEFORCE RTX" | Gigabyte RTX 5080 GAMING OC 16G (the non OC GAMING has the same shroud). 340 x 140 x 70 mm | High for the family, OC or not unknown |
| GPU lighting | Nothing colored on the card | The card has RGB on the logo and behind the fans; here it's off or white | Medium |
| CPU cooler | White square pump head, backlit CyberPowerPC logo with a warm white ring, white braided tubes to the top | CyberPowerPC branded 360 mm AIO, radiator top mounted with three fans under it | High for layout, OEM unknown |
| Fans | White frames, white LED rings, PHANTEKS hub stickers | 3 side intakes stacked at the front of the right wall, 1 rear exhaust, 3 on the radiator | High for the Phanteks ones, radiator fans unknown |
| RAM | Two black sticks with white light bars reading DOMINATOR | Corsair Dominator DDR5, 2 x 24 GB (48 GB DDR5-6800) | High for Dominator, Platinum RGB vs Titanium unknown |
| Motherboard | Black LGA1700 board, grey VRM heatsink with three diagonal stripes | Z790 (per the CyberPowerPC listing), model not identified | Low |
| SSD | WD_BLACK label on the M.2 slot | WD_BLACK NVMe, model not identified | Medium |
| Case lighting | Cool white strips up the pillarless front corner, along the bottom front edge and along the shroud's stepped edge | NV5 D-RGB strips set to white | High |

### Not in the photos (placeholders in the blockout)

| Item | Blockout default | Source |
|---|---|---|
| Monitors | Three identical 27 inch 16:9 OLEDs (active area 597 x 336 mm, 5 mm bezels, 9 mm chin): M1 bottom, M2 stacked on top and tilted down 10 degrees, M3 portrait on the right, centred on the stack's seam and angled in 25 degrees | Arrangement from Yassin's description; sizes and angles are guesses |
| Mounts | One pole with two arms for the stack, a desk stand for the portrait one | Guess |
| Desk | 160 x 80 cm, 74 cm high, matte black top on a black standing desk frame | Guess |
| Keyboard, mouse, mat | TKL keyboard, mouse, 90 x 40 cm dark desk mat | Guess |
| Speakers, lamps, light bars | None | Nothing in the photos suggests them |
| Chair | Low back chair, no headrest, swivelled out to the front right | Kept from today's scene; a headrest blocks the desk view |
| Props kept from today | Coffee mug (it has the steam effect), a credits card on the desk | Today's desk credits page moves to a card |
| Props dropped | Plant, binders, paper tray | Office clutter that isn't his setup |

## 2. Blockout

`scripts/room/blockout.py` builds the setup from flat colored boxes in Blender 5.2 (every size is
in the `SETUP` table at the top), imports today's studio backdrop and the AMG One, places the car
with the same math as `World/Car.ts`, and renders with Workbench (about a second per view). It
also writes a greybox GLB of the setup in site units, with the screens named `m1_screen`,
`m2_screen` and `m3_screen`, so the screens and camera work can start before the baked room exists.
`scripts/room/label_renders.py` adds the callouts.

```sh
blender -b --factory-startup --python scripts/room/blockout.py -- --repo . --out ~/Assets/portfolio-room/blockout --tag a
blender -b --factory-startup --python scripts/room/blockout.py -- --repo . --out ~/Assets/portfolio-room/blockout --tag b --scale 3420 --views default,desk,plan
blender -b --factory-startup --python scripts/room/blockout.py -- --repo . --out ~/Assets/portfolio-room/blockout --tag now --current --views default,idle_right
python3 scripts/room/label_renders.py ~/Assets/portfolio-room/blockout
```

Renders (in `~/Assets/portfolio-room/blockout/`, labelled copies end in `_labeled.png`):

| File | View |
|---|---|
| `a_default` | The homepage's default camera: the idle keyframe at t = 0, (-19977, 9016, 20000) looking at (0, -1000, 0), 35 degree vertical FOV |
| `a_idle_right`, `a_idle_front` | The same keyframe at the other end of its 78 s swing, and mid swing |
| `a_idle_proposed` | Proposed idle framing: same angle, aimed between the desk and the car, 28% closer |
| `a_desk` | Proposed desk view, replacing the DESK keyframe |
| `a_plan` | Top down, orthographic |
| `a_focus_m1`, `a_focus_m2`, `a_focus_m3`, `a_focus_flipper`, `focus_sheet.png` | The focus framings |
| `a_pc` | The PC's panoramic corner |
| `now_default`, `b_default`, `compare_default.png` | Today's room, the new one at today's proportions, side by side with the new one at true scale |

### Scale

The car sets the scale: the AMG One is 4.75 m and scaled 27x, which makes 2764 scene units per
metre. Henry's room is bigger than that (its desk top at 0.74 m works out to about 3420 units per
metre, its keyboard to about 3600), so today the car is about 20% small next to the desk. The
blockout's main set (`a_`) builds the new room at 2764, so the car and the setup are both true
size. The `b_` renders use 3420, which keeps today's proportions. Recommendation: true scale, with
the idle camera moved in (`a_idle_proposed`), since the room is his real setup now.

At true scale (site units, y up):

| Thing | Position | Size |
|---|---|---|
| Floor | y = -2984 (the Background mesh's top, unchanged) | |
| Desk top surface | y = -939, centre x = 276, z = 0 | 4422 x 2211 |
| M1 screen centre | (0, -174, -549), facing +z | 1649 x 928 |
| M2 screen centre | (0, 838, -464), tilted 10 degrees down | 1649 x 928 |
| M3 screen centre | (1358, 332, -343), turned 25 degrees in | 928 x 1649 |
| Flipper Zero spot | (-995, -925, 580) on the mat, turned 20 degrees | 276 x 69 x 111 |
| PC centre | (-2569, -2325, 138), front toward the chair, side glass toward -x | 661 x 1318 x 1459 |
| Car bounds | x -4683 to 8446, y -2995 to 377, z -10493 to -4707 | unchanged |

What the renders show:
- From the default camera the setup is small and the car dominates, because the new desk is
  smaller in scene units than Henry's. The proposed idle framing fixes that without changing the
  angle or the swing.
- The PC's panoramic corner faces the default camera, the way the photos were taken.
- The screens face +z, like today's monitor. From the default camera they're seen at about 45
  degrees; mid swing, square on.
- The portrait M3 sits within the stack's height, so the cluster stays one clean block.
- The car stays clickable over most of its body from every idle angle; the stack covers part of
  its rear half from the default view.

## 3. Screens plan

### What each monitor does

| Screen | Role | Content | Tech |
|---|---|---|---|
| M1, bottom, 16:9 | The interactive desktop | Live yassinOS (`display=main`), with a poster image until it's ready | CSS3D iframe, like today, 1600 x 900 CSS px |
| M2, top, 16:9 | Companion display | yassinOS style widgets on the shared wallpaper: clock and date, a "Now" card (what Yassin is working on, from the portfolio data), a Nordschleife card (track outline, your local best lap, "click the car to race"), links that open apps on M1 | CSS3D plain DOM (no iframe), 1600 x 900 CSS px |
| M3, right, 9:16 | Terminal | During loading, the loader's build log (docked, see 5.2). Afterwards a `yassin@room` shell: live frame stats and GPU tier from the graphics info panel (#57), a tail of site events, and a few commands when focused: `help`, `ls`, `open <app>` (opens on M1), `neofetch` (the visitor's GPU next to Yassin's rig), `graphics`, `race`, `credits`, `clear` | CSS3D plain DOM (no iframe), 900 x 1600 CSS px |

What makes it uniform: identical monitor models and bezels; one wallpaper spanned across the three
screens by their real positions (like a multi monitor span), which also replaces the animated
wallpaper inside the embed; yassinOS's accent, fonts and window chrome on M2 and M3; the same
brightness and true black on all three. What makes it one system: M2's links and M3's `open`
command open apps in yassinOS on M1, and M1 reports which app is open for M2's "Now" card.

### Focus and zoom

Today the single monitor zooms in when the pointer enters it. With three screens that would jump
the camera around, so every target works the same way: hover shows it's clickable, click focuses.

- IDLE (the swing) and DESK work as now: a click on empty space toggles between them.
- Hover a screen, the Flipper or the PC: pointer cursor, a small label chip, the screen lifts a
  few percent in brightness (the PC's LED strips brighten, the Flipper's backlight comes on).
- Click one: the camera glides to its focus pose (about 1 s, the current monitor easing). Only
  then does that screen take the pointer: the iframe and the DOM screens have `pointer-events:
  none` until they're focused, so a stray click on a small screen never lands inside yassinOS.
- While focused, clicking another screen glides straight to it. Clicking empty room or pressing
  Esc goes back one level (focus, then desk, then idle). Inside yassinOS, Esc is forwarded by the
  bridge unless an app uses it; a small Back chip in the corner does the same.
- The car click stays allowed only from IDLE and DESK (`RaceTransition.canStart`), never from a
  focus pose.

### Camera framing

Every focus pose is computed from the screen's real corners and the viewport's aspect: the camera
sits on the screen's normal, far enough that the screen fills 92% of the tighter axis (90% of the
height for M3). M2's pose looks up along its 10 degree tilt, M3's comes in along its 25 degree
angle. The near plane (200 units) is fine for all of them.

| Pose | 16:9 viewport | Phone, 390 x 844 portrait |
|---|---|---|
| Focus M1 | 0.58 m (1599 units) | 2.23 m (6150 units), width limited |
| Focus M2 | 0.58 m (1599 units) | 2.23 m, width limited |
| Focus M3 | 1.05 m (2906 units), height limited | 1.25 m (3460 units), fills the phone |
| Focus Flipper | about 0.35 m above and in front, device at about 55% of the height | same, with larger tap zones |
| Desk | camera (276, 1217, 4478) looking at (387, -54, -553), plus today's mouse parallax | pulled back to fit the cluster's width |
| Idle | same swing, aimed at (300, -1400, -1200), 28% closer | fit the desk and car across |

### Tech: CSS3D for all three, one iframe

- M1 has to be CSS3D: it's a live cross-origin page, and a browser can't draw another origin into
  WebGL.
- M2 and M3 are CSS3D too, but plain DOM owned by the portfolio. That keeps all three screens on
  the same path (same edges, colors and black level), keeps text crisp at any zoom, gives real
  text for screen readers and copy, and lets the loader's terminal be the same element M3 shows
  afterwards. They cost two composited layers and a few DOM updates a second, far less than an
  iframe.
- Each screen gets today's trick: a GL plane with `NoBlending` punches its hole in the canvas, so
  GL objects in front still hide it. An optional glass reflection plane (premultiplied, low alpha)
  sits over each screen on the high tier.
- Render to texture (a canvas texture per secondary) is the fallback plan if three CSS3D planes
  misbehave in a browser. It's not the default because it needs its own hit testing, can't be
  selected or read aloud, and costs texture uploads per update.

### Performance

- One live iframe at most. M1's iframe is created after the room's first frame on the high tier;
  on the low tier and phones it isn't created until M1 is focused. Until yassinOS reports ready,
  M1 shows a poster (`<img>` in the same CSS3D container) and the iframe fades in over it.
- Pausing: the portfolio tells yassinOS `visible: false` when M1 is off screen, smaller than
  about 8% of the viewport, in race mode, or when the tab is hidden, and yassinOS stops the
  wallpaper and its own animations. The embed shows the static spanned wallpaper, so the animated
  VANTA wallpaper (a WebGL context of its own, running all the time today) no longer runs on the
  homepage. Apps a visitor opened keep running while M1 is in view.
- M2 and M3 only update while on screen and bigger than a few percent of the viewport: M2 once a
  minute (clock), M3 at most twice a second. On the low tier they're static until focused.
- Nothing loads for M2 and M3 beyond the spanned wallpaper slice and a font.
- The homepage calibrates the race tier from its first 6 seconds (`HOME_SLOW_MS`), so the new room
  must not make weak machines look slower than today. Check the homepage p50 on the weak profile
  (`--cpu-throttle 4`, `?raceTier=low`, SwiftShader) before and after.

### What the yassinOS repo needs

yassinOS ignores `?embed=1&quality=high` today and never posts to the parent, so the room's
key and click sounds (`ComputerAudio`, which waits for `inComputer` events) never fire.

1. An embed bridge (`utils/embed.ts` plus a hook): active when `embed=1` and framed. It accepts
   messages only from `https://yassin.app`, `https://www.yassin.app` and localhost in dev, and only
   these types (protocol 1):
   - parent to OS: `yassin:hello` (protocol, `display`, size, tier, wallpaper rect),
     `yassin:visibility` (`visible`, `focused`), `yassin:open` (a known app id, optional url).
   - OS to parent: `yassin:ready` (the desktop has painted), `yassin:escape` (Esc not used by the
     focused app), `yassin:input` (`keydown`, `pointerdown`, `pointerup`, no key values, for the
     click sounds), `yassin:state` (open app ids and the focused one, for M2).
2. `display=main` at a fixed 1600 x 900 CSS px: check the icon grid, the taskbar and window
   placement at that size. (`display=top` and `display=side` are only needed if we later decide
   yassinOS should render M2 and M3 itself.)
3. Pause and resume on `yassin:visibility`: the wallpaper worker, the clock's animation and any
   loops yassinOS owns.
4. `wallpaper=span`: the room's spanned wallpaper (one image covering the three screens' real
   layout, about 976 x 705 mm of desk space) cropped to M1's rect, used instead of VANTA inside
   the embed. Standalone os.yassin.app keeps its animated default.
5. Theme tokens and assets in `public/embed/`: `room-theme.json` (accent, background, text colors,
   font stacks, radius, taskbar color, the span image and each screen's rect in mm) and
   `room-span.webp`. The portfolio copies them at build time (no runtime CORS dependency).
6. A poster script (Playwright) that renders `/?embed=1&display=main` at 1600 x 900 with no
   windows open and writes `public/embed/poster-main.webp`, for M1's placeholder.
7. An e2e test with a local parent page: handshake, Esc forwarding, pause stops the wallpaper
   loop, `open` opens the app.

The portfolio side changes the iframe src to
`https://os.yassin.app/?embed=1&display=main&protocol=1&wallpaper=span`.

## 4. Build approach and budget

### Assets

- Everything is generated by bpy scripts in `scripts/room/` from one `setup.json` (the blockout's
  `SETUP` table grows into it): `parts/desk.py`, `monitors.py`, `pc_nv5.py`, `keyboard.py`,
  `chair.py`, `props.py`. The generated `.blend` is a build product, not committed. Small source
  textures (decals such as the GPU's lettering, fan blade alpha) go in `models-src/room-v2/`.
- One node per furniture group (desk, monitors, PC, chair, props) even where they share an atlas,
  because the race transition's fly path uses each top level object's box as an obstacle.
- Lighting is baked like today: Cycles bakes lighting and color together into atlases, drawn with
  `MeshBasicMaterial`, so the room costs no runtime lights. Three atlases: setup (desk, props,
  monitor bodies, chair, Flipper body), PC, and floor plus backdrop. 512 samples at 4096, denoised
  (OIDN through the compositor), downsampled to each tier's size, 16 px padding.
- Export: GLB with Draco (the cars' decoder, in the worker from #61), textures as KTX2 through
  the existing probe and fallback in `Utils/ktx2.ts`, with WebP twins. The format per atlas is
  picked by measurement against the budget: UASTC where smooth gradients show up close (the desk
  top), ETC1S where detail hides blocks (the PC), WebP where it's smaller and the GPU cost is small
  (the floor).
- The credits page moves to a small card on the desk, drawn by the successor of
  `scripts/build-room-textures.py`.

### Lighting that matches his room

His room is dark and the only light in the photos is the case's cool white LEDs. The site's
identity (and #52's haze colors) is the light grey studio, so the default is a "studio evening"
look: the same studio key and backdrop around the car, a slightly darker, cooler pool around the
desk, and baked practicals: the case's strips, fan rings and pump logo in cool white (6500 to
7500 K) with a soft glow on the floor around the PC, and the three screens as emissive planes that
light the desk, keyboard and mat. A dark room with walls is possible but is a bigger change
(question 7).

### The OLED look

True black when a screen shows black, no backlight glow, the same brightness on all three, 5 mm
matte bezels with a hairline highlight on the panel edge (baked), slim panels with the rear bulge,
and an optional faint glossy reflection over the screens on the high tier. In the bake the screens
are black; only their light on the desk is baked.

### Budgets (room only; the car is unchanged)

| | Today | v2 high | v2 low (weak GPU, low power, phones) |
|---|---|---|---|
| Triangles | 11k, plus 38k for the Flipper | 60k or less, Flipper included | 30k or less (simpler PC internals and keyboard) |
| Draw calls | about 43 | 30 or less | 18 or less |
| Texture download | 2.2 MB (three 4k JPEGs) | 2.0 MB or less | 0.6 MB or less |
| Texture GPU memory | about 255 MB (about 64 MB on low power) | 40 MB or less | 8 MB or less |
| Geometry download | 450 KB | 400 KB or less | 250 KB or less |
| Atlas sizes | 3 x 4096 | 2048 setup, 2048 PC, 1024 floor | 1024, 1024, 512 |
| Live iframes | 1, always | 1, after the first frame, paused when not in view | 0 until M1 is focused |
| DOM screens | 0 | 2, updating only on screen | 2, static until focused |
| Extras | | glass reflection planes, LED hover glow | none |

The adaptive resolution and Performance mode caps from #56 apply unchanged; the room adds no
post effects.

## 5. Integration

### 5.1 The car and the #52 transition

The recommendation is that the car doesn't move: same model, same `CAR_POSITION` and shift, same
scale. The transition maps the race camera into the room through the car's own matrix, so the fly
and the handoff need no re-tuning. What still needs a look:

- `Car.getGroundYFromScene()` takes the lowest mesh in the scene (today the old chair base, 4 mm
  under the floor). Replace it with the room's floor constant, or a new mesh can drop the car.
- `Car.getDeskCenter()` places the Toyota Crown from the old `computerSetupModel`'s bounds.
  Replace it with a constant so the Toyota stays where it is.
- `RaceTransition.obstacles()` uses each top level object's box; keep the room split per group.
- `RaceTransition.canStart()`: allow IDLE and DESK only, never the new focus poses.
- `race:transitionLock` and `raceMode:changed` must cover all three screens (today they only
  cover `MonitorScreen`), and `returnFocus` must also leave M3's command input.
- `RaceManager.setLobbyObjectsVisible` hides every top level scene child, so the room must stay
  top level (it is today).
- The plate: at the chase camera's first pose (about 6.4 m behind the car, 1.85 m up, 62 degree
  FOV) the desk and PC are 17 to 27 degrees left of the view axis, in frame, but every screen faces
  away, so the plate shows monitor backs, never a CSS hole.
- `RaceReveal`'s `ROOM_FLOOR`, `ROOM_WALL` and `ROOM_CEILING` greys are today's floor and
  backdrop. Re-measure them from the new bake if the backdrop changes tone.
- Re-record with `scripts/race-transition-record.mjs` and run `scripts/race-transition-check.mjs`:
  the fly path now passes a taller monitor stack and may pick the other side of the car.
- Audio and effects positions: the key and click sounds ((-300, -400, 1200) and
  (800, -300, 1200)) and the coffee steam (1670, 200, 900) move to the new keyboard, mouse and mug.
- `OrbitControlsStart` (focal (-100, 350, 0), distances 4000 to 29000) and the mobile car shift
  need a look with the new framing.

If the car ever moves, these must be re-tuned: `CAR_POSITION` and its 1/3 shift, the Toyota
offsets (`TOYOTA_CROWN_*`, all relative to the desk centre), `MOBILE_CAR_BACK_SHIFT`, the idle and
orbit framing, the hover hit area against the desk, the fly path (re-record), and the reveal greys
if the floor around the new spot is a different tone.

### 5.2 The loader's terminal docks on M3

The combined terminal and GPU pipeline loader docks its terminal on M3:

- The room exposes a screen registry, `screens.get('side')`, with the CSS3D container (900 x 1600
  CSS px), the world corners and `focusPose()`. The loader renders its log into that container
  from the first frame (the #58 monitor loader already does this for today's monitor).
- The boot pose is M3's focus pose. On a landscape viewport the terminal is a 9:16 panel with the
  pipeline stages building the room around it; on a phone in portrait it fills the screen.
- When loading ends the camera pulls back to the idle view and the same element carries on as
  M3's shell, so nothing swaps. M1 turns on at the lighting stage (poster, then yassinOS).
- The loader's text is laid out for 900 x 1600 CSS px in the shared theme's monospace font.
- The #58 hooks (`Camera.introLock`, the `loadingScreenDone` detail fields, `screenOpacity` and
  `deferLoad`) move from `MonitorScreen` to the registry.

### 5.3 Flipper Zero

- Spot: on the mat, left of the keyboard, turned 20 degrees toward the chair (marked in the
  renders). Real size 100 x 40 x 25 mm.
- Hover: pointer, backlight on. Click: the camera goes to the Flipper's focus pose, above and in
  front, with the device at about 55% of the viewport height so the buttons are big enough.
- In focus, the D pad, OK and Back take clicks (invisible hit boxes over each button) and the
  keyboard maps to them: arrows, Enter, Backspace for Back. Esc or a click outside leaves.
- The screen is a 128 x 64 canvas texture with nearest filtering and the orange backlight, drawn
  only while focused or animating. It plugs into whatever the Flipper agent builds through a small
  interface: `screen` canvas, `press(button)`, hit areas.
- Budget: 3k triangles or less and 2 draws (the body in the setup atlas, the screen). Today's model
  is 38k triangles and 19 draws, more than the rest of the room together.

### 5.4 Hover, click, keyboard, phones

- Targets: M1, M2, M3, the Flipper, the PC (focus shows its panoramic corner and a spec card:
  i9-14900KF, RTX 5080, 48 GB DDR5-6800, 360 mm AIO, Phanteks NV5) and the car (as today).
- Keyboard: a visually hidden list of the targets for Tab order, Enter to focus or race, Esc to go
  back. Reduced motion: cuts and fades instead of glides.
- Phones: tap to focus, a Back chip instead of hover and Esc. A 3D iframe on a phone is unreadable
  and awkward to use, so M1 in focus shows the poster with an "Open yassinOS" button that opens it
  in a full screen 2D overlay. M3's shell fits a portrait phone and uses a real input so the soft
  keyboard works. Low tier assets and no iframe until the overlay opens.

## 6. Phased implementation

| PR | What | Needs | Parallel with |
|---|---|---|---|
| A1 Room geometry | Parametric bpy parts from `setup.json`, greybox export, a budget check (triangles, nodes, draws) | Answers to the open questions | B1, C1 |
| A2 Room bake | UV atlases, Cycles bake and denoise, KTX2 and WebP per tier, credits card, floor and backdrop re-bake, reveal greys re-measured | A1 | B2, C2 |
| B1 Screens | Screen registry, three CSS3D screens with occlusion planes, pointer gating, the focus state machine, framing from corners, locks for the race transition. Runs on the blockout greybox behind `?room=v2` | Blockout greybox | A1, C1, D1 |
| B2 Companion displays | M2 widgets and M3 shell in the shared theme, pause off screen, the dock API | B1 (and C1 for `open`, stubbed until then) | A2, C2 |
| B3 Room swap | Baked room replaces Environment, Computer and Decor; floor and desk constants; audio and steam; idle, desk and orbit framing; per tier assets; weak profile homepage check; transition re-record; `?room=v2` becomes the default | A2, B1, B2, and #59 to #62 merged | |
| B4 Flipper, PC, phones | Flipper spot, focus and buttons with the Flipper agent's device, PC focus and spec card, the phone overlay, keyboard order | B1 | A2 |
| C1 yassinOS bridge | Protocol 1, origin allowlist, pause and resume, Esc, `open`, input sounds, e2e test | nothing | everything |
| C2 yassinOS theme and poster | 1600 x 900 layout check, `wallpaper=span`, `room-theme.json` and span image, poster script | C1 | A2, B2 |
| D1 Loader dock | The combined loader renders into M3 through the registry | B1 | A2, B2 |

A1, B1 and C1 can start as soon as this is approved. Every merge to main is a production deploy,
so the new room stays behind `?room=v2` until B3.

## 7. Open questions (recommended defaults in brackets)

1. What are the three monitors (model or size and resolution)? [Three identical 27 inch 16:9
   OLEDs at 2560 x 1440]
2. How are they mounted, and how is the portrait one lined up with the stack? [A pole with two
   arms for the stack, the portrait one on a stand, centred on the stack's seam, angled in 25
   degrees, top monitor tilted down 10]
3. Desk size, color and material? [160 x 80 cm, matte black, black standing desk frame]
4. Where does the PC sit? [On the floor at the desk's left end, glass toward the room, as in the
   photos]
5. Keyboard, mouse, desk mat, speakers or headphones, any lamps or light bars? [TKL keyboard,
   mouse, large dark mat, no speakers or lamps]
6. True scale car or today's proportions? [True scale, idle camera moved in]
7. Lighting: studio evening or a dark room with walls? [Studio evening, which keeps #52's haze
   colors]
8. Click to focus for all screens, replacing today's hover to zoom? [Yes]
9. Should M2 and M3 be drawn by the portfolio (light) or be yassinOS pages (heavier, more work)?
   [Portfolio drawn, in yassinOS's theme]
10. Keep a chair, drop the plant and office clutter, keep the credits card? [Yes to all three]
11. Case lighting: static cool white like the photos, or a slow breathe? [Static white, brighter
    on hover]
12. A photo of the desk from the chair and one from the side would replace most of the guesses in
    1 to 5. Can he take them?
