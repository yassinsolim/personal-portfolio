import * as THREE from 'three';

// content hashes of the static files, from the production build
// (scripts/asset-versions.js). empty in dev and in node tests
const versions: Record<string, string> =
    typeof __ASSET_VERSIONS__ !== 'undefined' ? __ASSET_VERSIONS__ : {};

// 'models/x.glb' -> 'models/x.glb?v=1a2b3c4d' for a file of this site that
// the build hashed. those urls are cached for a year (vercel.json), a new
// file gets a new url. anything else (blobs, data, other origins, config)
// comes back unchanged
export const assetUrl = (url: string) => {
    if (!url || /^(blob|data):/.test(url)) return url;
    let key = url;
    if (/^[a-z]+:\/\//i.test(url)) {
        const parsed = new URL(url);
        if (parsed.origin !== window.location.origin) return url;
        key = parsed.pathname;
    }
    if (key.includes('?')) return url;
    const version = versions[decodeURI(key.replace(/^\.?\//, ''))];
    return version ? `${url}?v=${version}` : url;
};

const sizes: Record<string, number> =
    typeof __ASSET_SIZES__ !== 'undefined' ? __ASSET_SIZES__ : {};

// the size of a static file the build knows, 0 when it doesn't (dev)
export const assetSize = (path: string) => sizes[path.replace(/^\.?\//, '')] || 0;

// every three.js loader on the default manager (models, textures, the ktx2
// transcoder, json) asks it for the url it fetches
export const versionLoaderUrls = () => {
    THREE.DefaultLoadingManager.setURLModifier(assetUrl);
};
