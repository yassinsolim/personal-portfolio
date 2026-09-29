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

// extra: files the build emits itself ({ 'draco/x.js': Buffer }). sizes are
// the files' own sizes, for loading progress by bytes (Utils/Resources.ts)
module.exports = (staticDir, extra = {}) => {
    const versions = {};
    const sizes = {};
    const add = (key, content) => {
        versions[key] = crypto.createHash('sha256').update(content).digest('hex').slice(0, 8);
        sizes[key] = content.length;
    };
    for (const [key, content] of Object.entries(extra)) add(key, content);
    for (const dir of DIRS) {
        for (const file of walk(path.join(staticDir, dir))) {
            if (!EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
            add(path.relative(staticDir, file).split(path.sep).join('/'), fs.readFileSync(file));
        }
    }
    return { versions, sizes };
};
