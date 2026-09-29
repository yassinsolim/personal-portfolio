# flipper-wasm build

These files are a WebAssembly build of the official Flipper Zero firmware (release 1.4.3,
commit `8622f1a`), modified to run in a browser.

- `flipper.wasm`, `flipper.mjs`: the firmware compiled with Emscripten 6.0.10.
- `flipper-worker.js`: runs the firmware in a Web Worker and exchanges messages with the page.
- `sd.img`: the emulated SD card (gzipped tar: dolphin animations, placeholder app entries).

License: GNU General Public License v3.0 or later (see `LICENSE`), no warranty. The firmware,
its artwork and animations are Copyright (C) Flipper Devices Inc. and contributors.

Source for this build (port layer, patch against 1.4.3, build scripts):
https://github.com/yassinsolim/flipper-wasm

Unofficial. Not affiliated with, endorsed or sponsored by Flipper Devices Inc. "Flipper" and
"Flipper Zero" are trademarks of Flipper Devices Inc.
