// content hashes of the static files the game fetches at runtime, keyed by
// their path under static/. the production build bakes them in
// (__ASSET_VERSIONS__), Utils/assetUrl.ts adds ?v=<hash> to those urls and
// vercel.json caches versioned urls for a year, so a repeat visit doesn't
// revalidate them, and a changed file gets a new url. config/ is left out on
// purpose (it has to stay fresh), and so is anything not fetched by the game
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DIRS = ['models', 'textures', 'sounds', 'basis', 'draco'];
const EXTENSIONS = new Set([
    '.glb', '.json', '.jpg', '.jpeg', '.png', '.webp', '.avif', '.ktx2',
    '.webm', '.m4a', '.mp3', '.ogg', '.wasm', '.js',
]);

const walk = (dir) =>
    fs.existsSync(dir)
        ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
              const full = path.join(dir, entry.name);
              return entry.isDirectory() ? walk(full) : [full];
          })
        : [];

module.exports = (staticDir) => {
    const versions = {};
    for (const dir of DIRS) {
        for (const file of walk(path.join(staticDir, dir))) {
            if (!EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
            const key = path.relative(staticDir, file).split(path.sep).join('/');
            versions[key] = crypto
                .createHash('sha256')
                .update(fs.readFileSync(file))
                .digest('hex')
                .slice(0, 8);
        }
    }
    return versions;
};
