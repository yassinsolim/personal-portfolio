// copies yassinOS's room kit (the spanned wallpaper, the theme and m1's
// poster, from its public/embed/) into static/textures/room/. the site ships
// its own copy, so the room never waits on another origin
//
//   node scripts/room/sync-os-kit.mjs [path to the yassinOS checkout]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const source = path.resolve(process.argv[2] || path.join(os.homedir(), 'Projects/yassinOS'), 'public/embed');
const target = path.resolve('static/textures/room');
fs.mkdirSync(target, { recursive: true });
for (const file of ['room-span.webp', 'room-theme.json', 'poster-main.webp']) {
    fs.copyFileSync(path.join(source, file), path.join(target, file));
    console.log(file, fs.statSync(path.join(target, file)).size);
}
