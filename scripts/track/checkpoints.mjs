// writes the ring's lap checkpoints into supabase/racing.sql: a point on the
// road about every 100 m, the last one the start line. the database checks a
// lap's replay passes them all in order before the lap shows on the board.
// rerun when the ring changes, then run racing.sql on the project:
//
//   node scripts/track/checkpoints.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SQL = path.join(root, 'supabase/racing.sql');
export const CHECKPOINTS = 200;
const BEGIN = '-- checkpoints:begin';
const END = '-- checkpoints:end';

// x, z pairs in whole meters, from a lap fraction of 1/200 round to the line
export const ringCheckpoints = () => {
    const ring = JSON.parse(
        fs.readFileSync(path.join(root, 'static/models/Tracks/Nordschleife/nordschleife.json'), 'utf8')
    );
    const n = ring.points.length;
    const values = [];
    for (let k = 1; k <= CHECKPOINTS; k++) {
        const [x, , z] = ring.points[Math.round((k * n) / CHECKPOINTS) % n];
        values.push(Math.round(x), Math.round(z));
    }
    return values;
};

export const checkpointBlock = (values = ringCheckpoints()) => {
    const lines = [];
    for (let i = 0; i < values.length; i += 20) {
        const end = i + 20 >= values.length ? '' : ',';
        lines.push(`    ${values.slice(i, i + 20).join(', ')}${end}`);
    }
    return lines.join('\n');
};

// the block between the markers in racing.sql, as written there
export const writtenBlock = (sql = fs.readFileSync(SQL, 'utf8')) => {
    const start = sql.indexOf(BEGIN);
    const end = sql.indexOf(END);
    if (start < 0 || end < start) return null;
    return sql.slice(sql.indexOf('\n', start) + 1, end).replace(/\s+$/, '');
};

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    const sql = fs.readFileSync(SQL, 'utf8');
    const start = sql.indexOf(BEGIN);
    const end = sql.indexOf(END);
    if (start < 0 || end < start) throw new Error(`no ${BEGIN} ... ${END} in racing.sql`);
    const head = sql.slice(0, sql.indexOf('\n', start) + 1);
    fs.writeFileSync(SQL, `${head}${checkpointBlock()}\n${sql.slice(sql.lastIndexOf('\n', end) + 1)}`);
    console.log(`wrote ${CHECKPOINTS} checkpoints into supabase/racing.sql`);
}
