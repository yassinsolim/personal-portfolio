# Flipper Zero on the desk

The desk's Flipper Zero runs its real firmware (official 1.4.3, compiled to WebAssembly by
[flipper-wasm](https://github.com/yassinsolim/flipper-wasm), release v0.1.1). Hover it and it
boots; click it and the camera zooms in; arrows, Enter or Space and Backspace are its d-pad, OK
and Back; Esc or a click outside goes back to the desk. On phones a tap zooms in, the keys are
tapped, and a Done button leaves.

## Pieces

- `World/Flipper.ts`: the desk object. Placement, materials per tier, hit areas, hover, focus,
  keys, the legal chip, pausing. Adds a click interceptor to `Camera.ts` and uses the new
  `FLIPPER` keyframe, whose pose it recomputes every frame from the device's real size and the
  viewport's aspect (device at about 55% of the height).
- `World/flipper/FlipperDevice.ts`: the page side of the firmware. It only talks to the worker
  through `postMessage`: raw button presses (the firmware does short, long and repeat itself),
  frames, LED and backlight, vibro, the speaker through Web Audio after a gesture, awake while
  focused, pause and resume.
- `World/flipper/FlipperLcd.ts`: the 128x64 framebuffer drawn as the orange backlit LCD. Left
  handed mode draws the frame upside down on a real device; here the screen stays upright and
  the d-pad turns with it.
- `static/handheld/`: the firmware build, byte for byte the v0.1.1 release (`firmware.wasm`,
  `firmware.mjs` and `worker.js` are the release's `flipper.wasm`, `flipper.mjs` and
  `flipper-worker.js`, renamed so the trademark stays out of public URLs; `FILES.md` has the
  mapping and checksums), plus `sd.img`, its GPL-3.0 `LICENSE` and `NOTICE.md`.
- `scripts/blender/build-flipper.py`: the model, built and baked from scratch. Output goes
  through `npm run optimize:models flipper` like the other models.
- `scripts/flipper-room-check.mjs`: drives it in a production build and prints frame times.

## Serving: same origin, vendored under static/

The release artifacts are copied into `static/handheld/`, hashed by `scripts/asset-versions.js`
and cached for a year with the other versioned files. Why this and not a CDN:

- No CSP change for the page: `worker-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'` and
  `connect-src 'self'` already cover a same-origin module worker, its wasm and its SD image. A
  CDN would need new `worker-src`, `script-src` and `connect-src` entries, and module workers
  can't be cross-origin anyway without a blob shim.
- The worker gets its own tighter CSP in `vercel.json` (`/handheld/(.*)`: no network except
  same origin), like the draco decoder.
- Cost is zero: the files ride the existing static hosting and compression. They are lazy: the
  worker, wasm and SD image (about 460 KB over the wire) load on the first hover or tap, never
  with the homepage.
- GPL compliance is simple: the exact files next to their license, notice and source link,
  plus the visible chip by the device and the notice screen at the top of the firmware's About.
- Separate program: webpack never bundles or imports the firmware; the page constructs the
  worker from a static URL and only exchanges messages with it.

## Numbers

Production build served with `scripts/perf/serve-build.mjs`, Chrome for Testing on the real GPU,
`scripts/flipper-room-check.mjs`. Frame times are the renderer's own stats (p50 / p95 ms,
headless vsync is 120 Hz, so 8.3 ms is the cap); "firmware" is the share of the worker's time
spent running the firmware.

| M5, 1280x720 at 2x | frame p50 / p95 | main thread p50 | gpu p50 | firmware |
|---|---|---|---|---|
| Desk, device not loaded | 8.3 / 9.9 | 0.6 ms | 1.5 ms | 0 |
| Desk, device running | 8.3 / 10.2 | 0.7 ms | 1.1 ms | 0.3% |
| Focused, desktop animation | 8.3 / 10.1 | 0.3 ms | 1.3 ms | 0.45% |
| Focused, Snake | 8.3 / 10.0 | 0.3 ms | 1.3 ms | 0.36% |

| Weak (412x823 at 1.75x, 4x cpu throttle, touch) | frame p50 / p95 | main thread p50 | gpu p50 | firmware |
|---|---|---|---|---|
| Desk, device not loaded | 8.4 / 10.1 | 2.3 ms | 0.5 ms | 0 |
| Focused, desktop animation | 8.3 / 10.2 | 0.7 ms | 0.3 ms | 0.24% |
| Focused, Snake | 8.4 / 10.2 | 0.9 ms | 0.3 ms | 0.21% |

Chrome's cpu throttle doesn't reach dedicated workers, so on a genuinely slow phone expect the
firmware at roughly 1% of a core. Hover to running: about 0.1 s on a local server (the download
dominates on a real connection).

Model: 1,266 triangles, 33.6 KB (Draco, 512 px WebP atlas), down from 38k triangles and 161 KB.
Draw calls: 9 on high tiers (body, six keys that press, LED, screen), 2 on weak tiers (keys and
LED merged into the body at load, hit areas kept). Screen texture: 512x256 with a pixel grid on
high tiers, 128x64 nearest on weak ones, uploaded only when a frame changes.

## Room v2

Room v2 (`docs/room-v2-plan.md` on `room/v2`, step B4) takes the same pieces. What moves:

- `PAPER_ANCHOR`, `FLIPPER_OFFSET`, `FLIPPER_LENGTH_UNITS` and `FLIPPER_YAW` in `Flipper.ts`
  become the v2 spot: (-995, -925, 580), turned 20 degrees, 2764 units per metre (276 units
  long).
- The body's baked atlas moves into the v2 setup atlas: re-run the Blender script with the v2
  lighting, or UV the body into that atlas. The screen stays its own draw.
- The focus pose, hit areas, `screenCanvas` and `press(button)` are already what 5.3 asks for;
  v2's focus state machine can call `focus()` and `leave()` or drive the keyframe itself.

## Later: Momentum

A switchable Momentum build is planned in flipper-wasm (`docs/momentum.md`): first a license
table of the bundled community apps and asset packs, then the port, then a small toggle by the
device that restarts the worker with the other build (saved settings are kept per firmware).
