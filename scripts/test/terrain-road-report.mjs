// prints the terrain vs road clearance for every terrain level, worst spots
// first, with what the track is doing there (bank, crest or dip, how far the
// real ground sits above the road, other parts of the lap nearby)
//
//   node scripts/test/terrain-road-report.mjs [--margin 0.3] [--json out.json]
import fs from 'node:fs';
import { loadTrack, buildTerrain, terrainQualities } from './race-world.mjs';
import {
    checkClearance,
    roadSurface,
    terrainLevels,
} from './terrain-clearance.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i < 0 ? fallback : args[i + 1];
};
const margin = Number(opt('margin', 0.3));
const jsonOut = opt('json', '');

const track = await loadTrack();
const road = roadSurface(track);
const levels = [];
const terrains = {};
for (const quality of await terrainQualities()) {
    terrains[quality] = await buildTerrain(quality);
    levels.push(...terrainLevels(terrains[quality], quality));
}
const report = checkClearance(track, road, levels, { margin });

// what the lap does around a spot
const describe = (spot) => {
    const count = track.getSampleCount();
    const i = Math.round((spot.distance / track.length) * count) % count;
    const bankDeg = (track.frameBank[i] * 180) / Math.PI;
    // 1/m, positive is a dip (compression), negative a crest
    const crest = track.frameCrest[i];
    const field = terrains.high.field;
    const demAbove =
        field.baseHeight(spot.x, spot.z) - track.framePoints[i * 3 + 1];
    // nearest other part of the lap, at least 150 m away along it
    let other = Infinity;
    const px = track.framePoints[i * 3];
    const pz = track.framePoints[i * 3 + 2];
    const skip = Math.round((150 / track.length) * count);
    for (let j = 0; j < count; j++) {
        const along = Math.min(Math.abs(j - i), count - Math.abs(j - i));
        if (along < skip) continue;
        const d = Math.hypot(
            track.framePoints[j * 3] - px,
            track.framePoints[j * 3 + 2] - pz
        );
        if (d < other) other = d;
    }
    return {
        bankDeg: +bankDeg.toFixed(1),
        vertRadius: Math.abs(crest) > 1e-5 ? Math.round(1 / crest) : 'flat',
        demAbove: +demAbove.toFixed(1),
        otherBranch: Math.round(other),
    };
};

for (const level of report.levels) {
    console.log(
        `\n${level.name}: ${level.samples} samples, ${level.violations} under ${margin} m ` +
            `(${level.spotsUnderMargin} spots), min gap ${level.minGap} m`
    );
    console.table(level.worst.map((spot) => ({ ...spot, ...describe(spot) })));
}
if (report.missingRoad)
    console.log(
        `road surface missing at ${report.missingRoad} samples (used the analytic road)`
    );
if (jsonOut) {
    fs.writeFileSync(
        jsonOut,
        JSON.stringify(
            {
                ...report,
                levels: report.levels.map((level) => ({
                    ...level,
                    worst: level.worst.map((spot) => ({
                        ...spot,
                        ...describe(spot),
                    })),
                })),
            },
            null,
            2
        )
    );
    console.log(`wrote ${jsonOut}`);
}
