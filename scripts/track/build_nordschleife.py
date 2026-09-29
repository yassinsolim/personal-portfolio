# builds static/models/Tracks/Nordschleife/nordschleife.json from open data:
#   centerline, sections, bridges and forests: openstreetmap (odbl 1.0)
#   elevation: rhineland-palatinate dgm1, the 1 m lidar ground model
#     (© GeoBasis-DE / LVermGeoRP, dl-de/by-2-0), for the road profile, its
#     camber and the terrain. copernicus glo-30 (copernicus dem licence) is
#     the fallback outside it and with --no-dgm1
#
#   python3 -m venv /tmp/trackenv && /tmp/trackenv/bin/pip install numpy tifffile imagecodecs pyproj
#   /tmp/trackenv/bin/python scripts/track/build_nordschleife.py --cache /tmp/nords
#
# the cache dir keeps the overpass answers and dem tiles so reruns are offline.
# everything is in local meters: x east, y up (real elevation), z south, with
# the origin at the middle of the track's bounding box

import argparse
import base64
import json
import math
import os
import time
import urllib.parse
import urllib.request

import numpy as np
import tifffile

OVERPASS = 'https://overpass-api.de/api/interpreter'
BBOX = (50.30, 6.88, 50.41, 7.05)
DEM_URL = (
    'https://copernicus-dem-30m.s3.amazonaws.com/'
    'Copernicus_DSM_COG_10_N50_00_{e}_00_DEM/Copernicus_DSM_COG_10_N50_00_{e}_00_DEM.tif'
)
DGM1_URL = 'https://geobasis-rlp.de/data/dgm1/current/tif/'
SPACING = 4.0
# not part of the nordschleife lap
EXCLUDE = (
    'Sprintstrecke', 'Boxengasse', 'Müllenbach', 'Variante', 'Anbindung',
    'Rallycross', 'GP', 'Goodyear', 'Ford-Kurve', 'NGK', 'Michael-Schumacher',
)
# real grade limits of the lap
MAX_CLIMB = 0.17
MAX_DROP = 0.11
# the dem is a surface model: over woods it's the canopy, not the ground
CANOPY_M = 18.0
# crests the 30 m dem can't resolve, as bumps on the local high point of the
# section: height m, half width m
CRESTS = {'Flugplatz': (1.4, 20.0), 'Pflanzgarten': (1.7, 16.0), 'Sprunghügel': (1.4, 16.0)}
# road width keyframes by section, meters. the ring is ~8 to 12 m wide
DEFAULT_WIDTH = 9.5
WIDTHS = {
    'T13': 13.0, 'Sabine-Schmitz-Kurve': 11.0, 'Döttinger Höhe': 11.5,
    'Antoniusbuche': 11.0, 'Tiergarten': 11.0, 'Hohenrain': 11.5,
    'Karussell': 9.0, 'Mini-Karussell': 9.0,
}
# banking into the corner, degrees. the karussell is the banked concrete bowl
BANKS = {'Karussell': 14.0, 'Mini-Karussell': 5.0, 'Hohe Acht': 2.0, 'Schwalbenschwanz': 3.0}
CONCRETE = {'Karussell'}
TERRAIN_CELL = 30.0
TERRAIN_MARGIN = 900.0


def overpass(cache, name, query):
    path = os.path.join(cache, name)
    if os.path.exists(path):
        return json.load(open(path))
    url = OVERPASS + '?data=' + urllib.parse.quote(query)
    for attempt in range(5):
        request = urllib.request.Request(url, headers={'User-Agent': 'nordschleife-track-build', 'Accept': 'application/json'})
        body = urllib.request.urlopen(request, timeout=240).read()
        if body.startswith(b'{'):
            open(path, 'wb').write(body)
            return json.loads(body)
        time.sleep(10 * (attempt + 1))
    raise RuntimeError('overpass kept failing for ' + name)


def dem_tiles(cache):
    arrays = []
    for e in ('E006', 'E007'):
        path = os.path.join(cache, f'dem_{e}.tif')
        if not os.path.exists(path):
            urllib.request.urlretrieve(DEM_URL.format(e=e), path)
        arrays.append(tifffile.imread(path).astype(np.float64))
    # both tiles are 2400 wide at this latitude, 6 to 8 degrees east
    return np.hstack(arrays)


class Dgm1:
    # the 1 km tiles of the rlp lidar ground model (etrs89 utm 32n, 1 m, top
    # left corner as the tie point, -9999 for no data), fetched as needed
    def __init__(self, cache):
        from pyproj import Transformer
        self.dir = os.path.join(cache, 'dgm1')
        os.makedirs(self.dir, exist_ok=True)
        index = os.path.join(self.dir, 'index.txt')
        if not os.path.exists(index):
            html = urllib.request.urlopen(DGM1_URL, timeout=120).read().decode()
            import re
            names = sorted(set(re.findall(r'dgm1_32_\d+_\d+_1_rp_\d+\.tif', html)))
            open(index, 'w').write('\n'.join(names))
        self.names = {}
        for name in open(index).read().split():
            parts = name.split('_')
            self.names[(int(parts[2]), int(parts[3]))] = name
        self.tiles = {}
        self.to_utm = Transformer.from_crs(4326, 25832, always_xy=True)

    def tile(self, ek, nk):
        key = (ek, nk)
        if key not in self.tiles:
            name = self.names.get(key)
            if name is None:
                self.tiles[key] = None
            else:
                path = os.path.join(self.dir, name)
                if not os.path.exists(path):
                    urllib.request.urlretrieve(DGM1_URL + name, path)
                data = tifffile.imread(path).astype(np.float64)
                data[data < -1000] = np.nan
                self.tiles[key] = data
        return self.tiles[key]

    def pixel(self, px, py):
        # pixel column px (east) and row py counted from the north edge of
        # the tile row, in whole meters of utm
        ek, nk = px // 1000, (py - 1) // 1000
        data = self.tile(int(ek), int(nk))
        if data is None:
            return np.nan
        return data[int((nk + 1) * 1000 - py), int(px - ek * 1000)]

    def at_many(self, lat, lon):
        e, n = self.to_utm.transform(np.asarray(lon), np.asarray(lat))
        fx, fy = np.asarray(e) - 0.5, np.asarray(n) + 0.5
        x0, y0 = np.floor(fx).astype(np.int64), np.ceil(fy).astype(np.int64)
        dx, dy = fx - x0, y0 - fy
        def grab(px, py):
            out = np.full(px.shape, np.nan)
            ek, nk = px // 1000, (py - 1) // 1000
            for key in set(zip(ek.tolist(), nk.tolist())):
                data = self.tile(*key)
                if data is None:
                    continue
                m = (ek == key[0]) & (nk == key[1])
                out[m] = data[(key[1] + 1) * 1000 - py[m], px[m] - key[0] * 1000]
            return out
        a, b = grab(x0, y0), grab(x0 + 1, y0)
        c, d = grab(x0, y0 - 1), grab(x0 + 1, y0 - 1)
        return a * (1 - dx) * (1 - dy) + b * dx * (1 - dy) + c * (1 - dx) * dy + d * dx * dy

    def at(self, lat, lon):
        e, n = self.to_utm.transform(lon, lat)
        # pixel centers sit half a meter in from the corners
        fx, fy = e - 0.5, n + 0.5
        x0, y0 = math.floor(fx), math.ceil(fy)
        dx, dy = fx - x0, y0 - fy
        a = self.pixel(x0, y0)
        b = self.pixel(x0 + 1, y0)
        c = self.pixel(x0, y0 - 1)
        d = self.pixel(x0 + 1, y0 - 1)
        return a * (1 - dx) * (1 - dy) + b * dx * (1 - dy) + c * (1 - dx) * dy + d * dx * dy


def gauss_loop(v, spacing, sigma):
    r = max(1, int(3 * sigma / spacing))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) * spacing / sigma) ** 2)
    k /= k.sum()
    ext = np.concatenate([v[-r:], v, v[:r]])
    return np.convolve(ext, k, mode='same')[r:-r]


def gauss_grid(a, cells):
    r = max(1, int(3 * cells))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / cells) ** 2)
    k /= k.sum()
    pad = np.pad(a, r, mode='edge')
    pad = np.apply_along_axis(lambda row: np.convolve(row, k, mode='same'), 1, pad)
    pad = np.apply_along_axis(lambda col: np.convolve(col, k, mode='same'), 0, pad)
    return pad[r:-r, r:-r]


def stitch(data):
    nodes = {e['id']: (e['lat'], e['lon']) for e in data['elements'] if e['type'] == 'node'}
    ways = {e['id']: e for e in data['elements'] if e['type'] == 'way'}

    def keep(w):
        name = w.get('tags', {}).get('name') or ''
        return not any(x in name for x in EXCLUDE)

    cand = {wid: w for wid, w in ways.items() if keep(w)}
    starts = {}
    for wid, w in cand.items():
        starts.setdefault(w['nodes'][0], []).append(wid)
    first = next(wid for wid, w in cand.items() if w.get('tags', {}).get('name') == 'T13')
    order, seen, cur = [first], {first}, first
    while True:
        end = ways[cur]['nodes'][-1]
        nxt = [w for w in starts.get(end, []) if w not in seen]
        if not nxt:
            if first in starts.get(end, []):
                break
            raise RuntimeError('the lap does not close after way %d' % cur)
        nxt.sort(key=lambda w: ways[w].get('tags', {}).get('name') is None)
        cur = nxt[0]
        order.append(cur)
        seen.add(cur)
    points, sections = [], []
    for wid in order:
        ids = ways[wid]['nodes']
        name = ways[wid].get('tags', {}).get('name')
        if name and name != 'Nürburgring Nordschleife' and (not sections or sections[-1][0] != name):
            sections.append((name, len(points)))
        points.extend(nodes[n] for n in (ids if not points else ids[1:]))
    return points[:-1] if points[0] == points[-1] else points, sections


def rings_of(data):
    nodes = {e['id']: (e['lat'], e['lon']) for e in data['elements'] if e['type'] == 'node'}
    ways = {e['id']: e for e in data['elements'] if e['type'] == 'way'}
    outer, inner, used = [], [], set()

    def assemble(parts):
        parts = [list(p) for p in parts if len(p) > 1]
        rings = []
        while parts:
            ring = parts.pop(0)
            changed = True
            while ring[0] != ring[-1] and changed:
                changed = False
                for i, p in enumerate(parts):
                    if p[0] == ring[-1]:
                        ring += p[1:]
                    elif p[-1] == ring[-1]:
                        ring += p[::-1][1:]
                    else:
                        continue
                    parts.pop(i)
                    changed = True
                    break
            if ring[0] == ring[-1] and len(ring) > 3:
                rings.append(ring)
        return rings

    for e in data['elements']:
        if e['type'] != 'relation':
            continue
        for role, target in (('outer', outer), ('inner', inner)):
            parts = [ways[m['ref']]['nodes'] for m in e['members'] if m['type'] == 'way' and m.get('role') == role and m['ref'] in ways]
            for m in e['members']:
                if m['type'] == 'way':
                    used.add(m['ref'])
            target.extend(assemble(parts))
    for wid, w in ways.items():
        tags = w.get('tags', {})
        if wid in used or not (tags.get('landuse') == 'forest' or tags.get('natural') == 'wood'):
            continue
        if w['nodes'][0] == w['nodes'][-1]:
            outer.append(w['nodes'])
    to_ll = lambda ring: [nodes[n] for n in ring if n in nodes]
    return [to_ll(r) for r in outer], [to_ll(r) for r in inner]


def rasterize(rings, gx, gz, project):
    mask = np.zeros(gx.shape, dtype=bool)
    for ring in rings:
        pts = np.array([project(p) for p in ring])
        x0, z0 = pts.min(axis=0)
        x1, z1 = pts.max(axis=0)
        sel = (gx >= x0) & (gx <= x1) & (gz >= z0) & (gz <= z1)
        if not sel.any():
            continue
        px, pz = gx[sel], gz[sel]
        inside = np.zeros(px.shape, dtype=bool)
        xa, za = pts[:-1, 0], pts[:-1, 1]
        xb, zb = pts[1:, 0], pts[1:, 1]
        for ax, az, bx, bz in zip(xa, za, xb, zb):
            cross = ((az > pz) != (bz > pz)) & (px < (bx - ax) * (pz - az) / ((bz - az) or 1e-9) + ax)
            inside ^= cross
        mask[sel] ^= inside
    return mask


def copernicus_profile(X, Z, lx, lz, names, count, spacing, dem_at, unproject):
    # road height: the lowest of the middle and 8 m either side, so a canopy
    # over the road cell doesn't lift it, then smoothed and held to real grades
    center = np.array([dem_at(*unproject(x, z)) for x, z in zip(X, Z)])
    near = center.copy()
    for o in (-8.0, 8.0):
        near = np.minimum(near, [dem_at(*unproject(x + ax * o, z + az * o)) for x, z, ax, az in zip(X, Z, lx, lz)])
    y = gauss_loop(near, spacing, 22.0)
    for name, (height, half) in CRESTS.items():
        idx = [i for i, nm in enumerate(names) if nm == name]
        if not idx:
            continue
        top = idx[int(np.argmax(center[idx]))]
        offsets = (np.arange(count) - top + count // 2) % count - count // 2
        y += height * np.exp(-((offsets * spacing) / half) ** 2)
    for _ in range(6):
        for i in range(1, count):
            y[i] = np.clip(y[i], y[i - 1] - MAX_DROP * spacing, y[i - 1] + MAX_CLIMB * spacing)
        for i in range(count - 2, -1, -1):
            y[i] = np.clip(y[i], y[i + 1] - MAX_CLIMB * spacing, y[i + 1] + MAX_DROP * spacing)
    y = gauss_loop(y, spacing, 6.0)
    # the loop has to close on itself
    y += np.linspace(0, y[0] - y[-1], count)
    return y


# the dgm1 is bare ground at 1 m, so the road comes straight from it: at every
# point a line is fitted across the road (8 samples edge to edge), its middle
# is the height and its slope the camber. light smoothing keeps it smooth at
# car scale (noise, kerbs) without taking the crests off. over the lap's own
# bridges the model has the ground below, so those stretches are bridged
ROAD_SIGMA_M = 3.0
ROLL_SIGMA_M = 8.0
MAX_ROLL_DEG = 25.0
SAFETY_GRADE = 0.22


def dgm1_profile(dgm, X, Z, lx, lz, names, spans, count, spacing, to_latlon):
    half = np.array([WIDTHS.get(nm, DEFAULT_WIDTH) / 2 - 0.8 for nm in names])
    rel = np.linspace(-1, 1, 8)
    offs = half[:, None] * rel[None, :]
    px = X[:, None] + lx[:, None] * offs
    pz = Z[:, None] + lz[:, None] * offs
    lat, lon = to_latlon(px, pz)
    h = dgm.at_many(lat.ravel(), lon.ravel()).reshape(px.shape)
    ok = np.isfinite(h)
    center = np.full(count, np.nan)
    slope = np.zeros(count)
    for i in range(count):
        s, v = offs[i][ok[i]], h[i][ok[i]]
        if len(v) >= 4:
            b, a = np.polyfit(s, v, 1)
            center[i], slope[i] = a, b
    # bridged stretches and any gaps: straight across from the ends
    bridged = np.zeros(count, bool)
    for sp in spans:
        a, b = sp['start'] - 5, sp['end'] + 5
        d = np.arange(count) * spacing
        bridged |= ((d >= a) & (d <= b)) | ((d + count * spacing >= a) & (d + count * spacing <= b))
    center[bridged] = np.nan
    slope[bridged] = 0.0
    idx = np.arange(count)
    good = np.isfinite(center)
    center = np.interp(idx, idx[good], center[good], period=count)
    y = gauss_loop(center, spacing, ROAD_SIGMA_M)
    for _ in range(3):
        for i in range(1, count):
            y[i] = np.clip(y[i], y[i - 1] - SAFETY_GRADE * spacing, y[i - 1] + SAFETY_GRADE * spacing)
    y += np.linspace(0, y[0] - y[-1], count)
    # left edge higher is a positive roll (the runtime's convention)
    roll = np.degrees(np.arctan(gauss_loop(slope, spacing, ROLL_SIGMA_M)))
    roll = np.clip(roll, -MAX_ROLL_DEG, MAX_ROLL_DEG)
    return y, roll, center


def report_profile(y, y_cop, roll, names, dist, spacing):
    diff = y - y_cop
    order = np.argsort(-np.abs(diff))
    seen = set()
    print('biggest height changes vs copernicus:')
    for i in order:
        if names[i] in seen:
            continue
        seen.add(names[i])
        print('  %-22s %7.0f m  %+.1f m' % (names[i], dist[i], diff[i]))
        if len(seen) >= 8:
            break
    print('  rms %.2f m, max %.1f m' % (np.sqrt(np.mean(diff ** 2)), np.abs(diff).max()))
    print('biggest camber:')
    seen = set()
    for i in np.argsort(-np.abs(roll)):
        if names[i] in seen:
            continue
        seen.add(names[i])
        print('  %-22s %7.0f m  %+.1f deg' % (names[i], dist[i], roll[i]))
        if len(seen) >= 8:
            break
    # crest height: how far the road rises over the straight line between
    # 40 m before and after, the bigger jumps
    n = int(round(40 / spacing))
    rise = y - (np.roll(y, n) + np.roll(y, -n)) / 2
    rise_cop = y_cop - (np.roll(y_cop, n) + np.roll(y_cop, -n)) / 2
    print('crests (rise over the 80 m chord), dgm1 vs copernicus:')
    for name in ('Flugplatz', 'Schwedenkreuz', 'Pflanzgarten', 'Sprunghügel', 'Brünnchen', 'Quiddelbacher Höhe', 'Hohe Acht'):
        idx = [i for i, nm in enumerate(names) if nm == name]
        if idx:
            i = idx[int(np.argmax(rise[idx]))]
            j = idx[int(np.argmax(rise_cop[idx]))]
            print('  %-22s %+.2f m at %.0f m   (copernicus %+.2f m)' % (name, rise[i], dist[i], rise_cop[j]))


# catch fences near the lap (spectator areas at brünnchen, pflanzgarten and
# the like) and the landmarks on the skyline, from osm
FENCE_REACH = 18.0
LANDMARKS = {
    'Nürburg (Ruine)': 'castle',
    'Kaiser-Wilhelm-Turm': 'tower',
}


# where the armco actually is: the nearest osm guard rail on each side of
# every lap point (within ALONG of it along the lap), as meters from the
# centerline. short gaps in the mapping are bridged, longer ones stay null so
# the game falls back to its own rule there, then it's smoothed and kept as
# keyframes every BARRIER_KEY_EVERY points
BARRIER_ALONG = 2.5
BARRIER_REACH = 25.0
BARRIER_GAP = 15
BARRIER_KEY_EVERY = 4


def barrier_offsets(cache, X, Z, dist, project, bbox):
    s, w, n, e = bbox
    data = overpass(cache, 'ts-barriers.json', f'[out:json][timeout:120];way["barrier"~"guard_rail|fence|wall|retaining_wall|jersey_barrier"]({s},{w},{n},{e});out body;>;out skel qt;')
    nodes = {el['id']: project((el['lat'], el['lon'])) for el in data['elements'] if el['type'] == 'node'}
    rail = []
    for el in data['elements']:
        if el['type'] != 'way' or el.get('tags', {}).get('barrier') != 'guard_rail':
            continue
        pts = np.array([nodes[nid] for nid in el['nodes'] if nid in nodes])
        for a, b in zip(pts[:-1], pts[1:]):
            m = max(1, int(np.linalg.norm(b - a) / 1.5))
            for t in np.linspace(0, 1, m + 1):
                rail.append(a + (b - a) * t)
    rail = np.array(rail)
    P = np.stack([X, Z], 1)
    T = np.roll(P, -1, 0) - np.roll(P, 1, 0)
    T /= np.linalg.norm(T, axis=1)[:, None]
    L = np.stack([T[:, 1], -T[:, 0]], 1)
    count = len(P)
    sides = np.full((2, count), np.nan)
    for i in range(count):
        d = rail - P[i]
        near = (np.abs(d @ T[i]) < BARRIER_ALONG) & (np.abs(d @ L[i]) < BARRIER_REACH)
        lat = d[near] @ L[i]
        if (lat > 1.5).any():
            sides[0, i] = lat[lat > 1.5].min()
        if (lat < -1.5).any():
            sides[1, i] = -lat[lat < -1.5].max()
    keys = []
    for side in sides:
        # bridge short gaps
        ok = np.isfinite(side)
        filled = side.copy()
        i = 0
        while i < count:
            if ok[i]:
                i += 1
                continue
            j = i
            while j < count and not ok[j]:
                j += 1
            if j - i <= BARRIER_GAP and i > 0 and j < count:
                filled[i:j] = np.interp(np.arange(i, j), [i - 1, j], [side[i - 1], side[j]])
            i = j
        # median then mean over the neighbors that have a value
        def rolling(values, half, fn):
            out = np.full(count, np.nan)
            for k in range(count):
                win = values[[(k + o) % count for o in range(-half, half + 1)]]
                win = win[np.isfinite(win)]
                if np.isfinite(values[k]) and len(win):
                    out[k] = fn(win)
            return out
        keys.append(rolling(rolling(filled, 3, np.median), 2, np.mean))
    out = []
    for i in range(0, count, BARRIER_KEY_EVERY):
        out.append([round(float(dist[i]), 1)] + [None if not np.isfinite(k[i]) else round(float(k[i]), 2) for k in keys])
    found = np.isfinite(keys[0]).mean(), np.isfinite(keys[1]).mean()
    print('armco from osm: left %.0f%%, right %.0f%% of the lap' % (found[0] * 100, found[1] * 100))
    return out


def trackside_osm(cache, X, Z, project, bbox):
    s, w, n, e = bbox
    barriers = overpass(cache, 'ts-barriers.json', f'[out:json][timeout:120];way["barrier"~"guard_rail|fence|wall|retaining_wall|jersey_barrier"]({s},{w},{n},{e});out body;>;out skel qt;')
    marks = overpass(cache, 'ts-landmarks.json', f'[out:json][timeout:60];(node["man_made"="tower"]({s},{w},{n},{e});way["man_made"="tower"]({s},{w},{n},{e});way["historic"="castle"]({s},{w},{n},{e});node["historic"="castle"]({s},{w},{n},{e});node["natural"="peak"]({s},{w},{n},{e});way["leisure"="grandstand"]({s},{w},{n},{e}););out body;>;out skel qt;')
    lap = np.stack([X, Z], 1)
    fences = []
    for data in (barriers,):
        nodes = {el['id']: project((el['lat'], el['lon'])) for el in data['elements'] if el['type'] == 'node'}
        for el in data['elements']:
            tags = el.get('tags', {})
            if el['type'] != 'way' or tags.get('barrier') != 'fence':
                continue
            pts = np.array([nodes[nid] for nid in el['nodes'] if nid in nodes])
            if len(pts) < 2:
                continue
            # keep the runs within reach of the lap, resampled every 6 m
            seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
            cum = np.concatenate([[0], np.cumsum(seg)])
            d = np.arange(0, cum[-1] + 0.01, 6.0)
            px = np.interp(d, cum, pts[:, 0])
            pz = np.interp(d, cum, pts[:, 1])
            near = np.array([np.min((lap[:, 0] - x) ** 2 + (lap[:, 1] - z) ** 2) for x, z in zip(px, pz)]) < FENCE_REACH ** 2
            run = []
            for keep, x, z in zip(near, px, pz):
                if keep:
                    run.append([round(float(x), 2), round(float(z), 2)])
                elif len(run) >= 3:
                    fences.append(run)
                    run = []
                else:
                    run = []
            if len(run) >= 3:
                fences.append(run)
    landmarks = []
    nodes = {el['id']: project((el['lat'], el['lon'])) for el in marks['elements'] if el['type'] == 'node'}
    for el in marks['elements']:
        tags = el.get('tags', {})
        kind = LANDMARKS.get(tags.get('name'))
        if not kind or el['type'] != 'way':
            continue
        pts = np.array([nodes[nid] for nid in el['nodes'] if nid in nodes])
        cx, cz = pts.mean(axis=0)
        landmarks.append({
            'name': tags['name'],
            'kind': kind,
            'x': round(float(cx), 1),
            'z': round(float(cz), 1),
            'height': float(tags.get('height', 0) or 0),
            'outline': [[round(float(x - cx), 1), round(float(z - cz), 1)] for x, z in pts],
        })
    return fences, landmarks


# the roads that pass under the lap's own bridges (b257 at quiddelbacher hoehe
# and breidscheid, l92, l93 and k73 around t13): the osm way crossing each span,
# ±70 m of it every 4 m, on the lidar ground (which under a bridge is that road)
UNDERPASS_REACH = 70.0
UNDERPASS_WIDTH = {'primary': 7.0, 'secondary': 6.5, 'tertiary': 6.0}


def underpass_roads(cache, spans, X, Z, dist, spacing, project, unproject, dgm):
    if not spans:
        return []
    count = len(X)
    boxes = []
    for sp in spans:
        i = int(round(((sp['start'] + sp['end']) / 2) / spacing)) % count
        lat, lon = unproject(X[i], Z[i])
        boxes.append((lat - 0.0012, lon - 0.0019, lat + 0.0012, lon + 0.0019))
    query = '[out:json][timeout:90];(' + ''.join(
        f'way["highway"]({s},{w},{n},{e});way["waterway"]({s},{w},{n},{e});' for s, w, n, e in boxes) + ');out body;>;out skel qt;'
    data = overpass(cache, 'underpass.json', query)
    nodes = {el['id']: project((el['lat'], el['lon'])) for el in data['elements'] if el['type'] == 'node'}
    found = []
    for si, sp in enumerate(spans):
        best = None
        for el in data['elements']:
            tags = el.get('tags', {})
            if el['type'] != 'way' or tags.get('highway') not in UNDERPASS_WIDTH:
                continue
            pts = np.array([nodes[n] for n in el['nodes'] if n in nodes])
            for a in range(len(pts) - 1):
                for i in range(int(sp['start'] / spacing) - 3, int(sp['end'] / spacing) + 4):
                    i0, i1 = i % count, (i + 1) % count
                    p, q = np.array([X[i0], Z[i0]]), np.array([X[i1], Z[i1]])
                    r, s2 = pts[a + 1] - pts[a], q - p
                    den = r[0] * s2[1] - r[1] * s2[0]
                    if abs(den) < 1e-9:
                        continue
                    t = ((p - pts[a])[0] * s2[1] - (p - pts[a])[1] * s2[0]) / den
                    u = ((p - pts[a])[0] * r[1] - (p - pts[a])[1] * r[0]) / den
                    if 0 <= t <= 1 and 0 <= u <= 1:
                        best = (el, pts, a, t)
        if best is None:
            continue
        el, pts, a, t = best
        # along the way, arc length from the crossing
        seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
        cum = np.concatenate([[0], np.cumsum(seg)])
        at = cum[a] + t * seg[a]
        s_pts = np.arange(max(0, at - UNDERPASS_REACH), min(cum[-1], at + UNDERPASS_REACH) + 0.01, 4.0)
        ux = np.interp(s_pts, cum, pts[:, 0])
        uz = np.interp(s_pts, cum, pts[:, 1])
        lat, lon = np.vectorize(unproject)(ux, uz)
        uy = dgm.at_many(lat, lon)
        good = np.isfinite(uy)
        uy = np.interp(np.arange(len(uy)), np.arange(len(uy))[good], uy[good])
        uy = np.convolve(np.pad(uy, 2, mode='edge'), np.ones(5) / 5, mode='valid')
        tags = el.get('tags', {})
        found.append({
            'span': si,
            'ref': tags.get('ref'),
            'name': tags.get('name'),
            'highway': tags.get('highway'),
            'width': UNDERPASS_WIDTH[tags.get('highway')],
            'points': [[round(float(x), 2), round(float(y), 2), round(float(z), 2)] for x, y, z in zip(ux, uy, uz)],
        })
    return found


def lap_spans(bridges, X, Z, dist, length, project):
    # where the lap itself is a bridge: raceway ways tagged bridge that lie on
    # the centerline (not the pit lane beside it)
    bnodes = {el['id']: (el['lat'], el['lon']) for el in bridges['elements'] if el['type'] == 'node'}
    spans = []
    for el in bridges['elements']:
        tags = el.get('tags', {})
        if el['type'] != 'way' or tags.get('highway') != 'raceway' or tags.get('bridge') in (None, 'no'):
            continue
        pts = [project(bnodes[nid]) for nid in el['nodes'] if nid in bnodes]
        ends = []
        for px, pz in (pts[0], pts[-1]):
            i = int(np.argmin((X - px) ** 2 + (Z - pz) ** 2))
            ends.append((math.hypot(X[i] - px, Z[i] - pz), float(dist[i])))
        if max(off for off, _ in ends) > 3:
            continue
        a, b = sorted(d for _, d in ends)
        if b - a > length / 2:
            a, b = b, a + length
        spans.append({'start': round(a, 1), 'end': round(b, 1)})
    spans.sort(key=lambda s: s['start'])
    merged = []
    for sp in spans:
        if merged and sp['start'] <= merged[-1]['end'] + 5:
            merged[-1]['end'] = max(merged[-1]['end'], sp['end'])
        else:
            merged.append(sp)
    return merged


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--cache', default='/tmp/nords')
    parser.add_argument('--out', default='static/models/Tracks/Nordschleife/nordschleife.json')
    parser.add_argument('--no-dgm1', action='store_true', help='copernicus only, the old build')
    args = parser.parse_args()
    os.makedirs(args.cache, exist_ok=True)
    s, w, n, e = BBOX
    raceway = overpass(args.cache, 'raceway.json', f'[out:json][timeout:90];way["highway"="raceway"]({s},{w},{n},{e});out body;>;out skel qt;')
    forest = overpass(args.cache, 'forest.json', f'[out:json][timeout:120];(way["landuse"="forest"]({s},{w},{n},{e});relation["landuse"="forest"]({s},{w},{n},{e});way["natural"="wood"]({s},{w},{n},{e});relation["natural"="wood"]({s},{w},{n},{e}););out body;>;out skel qt;')
    bridges = overpass(args.cache, 'bridges.json', f'[out:json][timeout:90];(way["bridge"]["highway"]({s},{w},{n},{e});way["bridge"]["railway"]({s},{w},{n},{e}););out body;>;out skel qt;')
    dem = dem_tiles(args.cache)

    def dem_at(lat, lon):
        fx = (lon - 6.0) * 2400 - 0.5
        fy = (51.0 - lat) * 3600 - 0.5
        x0, y0 = int(math.floor(fx)), int(math.floor(fy))
        dx, dy = fx - x0, fy - y0
        return (dem[y0, x0] * (1 - dx) * (1 - dy) + dem[y0, x0 + 1] * dx * (1 - dy)
                + dem[y0 + 1, x0] * (1 - dx) * dy + dem[y0 + 1, x0 + 1] * dx * dy)

    lap, sections = stitch(raceway)
    lats = [p[0] for p in lap]
    lons = [p[1] for p in lap]
    lat0 = (min(lats) + max(lats)) / 2
    lon0 = (min(lons) + max(lons)) / 2
    R = 6378137.0
    k = math.cos(math.radians(lat0))
    project = lambda p: ((p[1] - lon0) * math.pi / 180 * R * k, -(p[0] - lat0) * math.pi / 180 * R)
    unproject = lambda x, z: (lat0 - z / R * 180 / math.pi, lon0 + x / (R * k) * 180 / math.pi)

    raw = np.array([project(p) for p in lap])
    closed = np.vstack([raw, raw[:1]])
    cum = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(closed, axis=0), axis=1))])
    length = cum[-1]
    count = int(round(length / SPACING))
    spacing = length / count
    dist = np.arange(count) * spacing
    X = np.interp(dist, cum, closed[:, 0])
    Z = np.interp(dist, cum, closed[:, 1])
    # osm corners are polyline kinks, a light blur rounds them into the arcs
    X = gauss_loop(X, spacing, 5.0)
    Z = gauss_loop(Z, spacing, 5.0)
    section_starts = [(name, float(cum[i])) for name, i in sections]

    def section_at(d):
        current = section_starts[-1][0]
        for name, start in section_starts:
            if start <= d:
                current = name
        return current

    names = [section_at(d) for d in dist]

    tx = np.roll(X, -1) - np.roll(X, 1)
    tz = np.roll(Z, -1) - np.roll(Z, 1)
    tn = np.hypot(tx, tz)
    lx, lz = tz / tn, -tx / tn
    to_latlon = np.vectorize(unproject)
    spans = lap_spans(bridges, X, Z, dist, length, project)
    roll = None
    if args.no_dgm1:
        y = copernicus_profile(X, Z, lx, lz, names, count, spacing, dem_at, unproject)
    else:
        y, roll, copernicus = dgm1_profile(Dgm1(args.cache), X, Z, lx, lz, names, spans, count, spacing, to_latlon)
        y_cop = copernicus_profile(X, Z, lx, lz, names, count, spacing, dem_at, unproject)
        report_profile(y, y_cop, roll, names, dist, spacing)

    widths = [[round(float(start), 1), WIDTHS.get(name, DEFAULT_WIDTH)] for name, start in section_starts]
    banks = [[round(float(start), 1), BANKS.get(name, 0.0)] for name, start in section_starts]
    concrete = [[round(float(start), 1), name in CONCRETE] for name, start in section_starts]

    # terrain: the dem around the lap with the canopy taken off over the woods
    x_min, z_min = X.min() - TERRAIN_MARGIN, Z.min() - TERRAIN_MARGIN
    x_max, z_max = X.max() + TERRAIN_MARGIN, Z.max() + TERRAIN_MARGIN
    cols = int(math.ceil((x_max - x_min) / TERRAIN_CELL)) + 1
    rows = int(math.ceil((z_max - z_min) / TERRAIN_CELL)) + 1
    gx, gz = np.meshgrid(x_min + np.arange(cols) * TERRAIN_CELL, z_min + np.arange(rows) * TERRAIN_CELL)
    outer, inner = rings_of(forest)
    woods = rasterize(outer, gx, gz, project) & ~rasterize(inner, gx, gz, project)
    woods_soft = gauss_grid(woods.astype(np.float64), 1.2)
    surface = np.array([[dem_at(*unproject(x, z)) for x, z in zip(rx, rz)] for rx, rz in zip(gx, gz)])
    ground = gauss_grid(surface - CANOPY_M * woods_soft, 1.0)
    if not args.no_dgm1:
        # the lidar ground averaged over each cell (25 samples, 6 m apart),
        # copernicus only where the dgm1 has nothing
        sub = (np.arange(5) - 2) * (TERRAIN_CELL / 5)
        acc = np.zeros(ground.shape)
        hits = np.zeros(ground.shape)
        dgm = Dgm1(args.cache)
        for ox in sub:
            for oz in sub:
                lat, lon = to_latlon(gx + ox, gz + oz)
                v = dgm.at_many(lat.ravel(), lon.ravel()).reshape(gx.shape)
                good = np.isfinite(v)
                acc[good] += v[good]
                hits[good] += 1
        lidar = np.where(hits > 12, acc / np.maximum(hits, 1), np.nan)
        ground = np.where(np.isfinite(lidar), lidar, ground)
    heights_dm = np.clip(np.round(ground * 10), 0, 65535).astype('<u2')
    forest_u8 = np.clip(np.round(woods_soft * 255), 0, 255).astype(np.uint8)

    # roads and paths crossing over the lap
    bnodes = {el['id']: (el['lat'], el['lon']) for el in bridges['elements'] if el['type'] == 'node'}
    crossings = []
    for el in bridges['elements']:
        if el['type'] != 'way' or el.get('tags', {}).get('highway') == 'raceway':
            continue
        pts = [project(bnodes[nid]) for nid in el['nodes'] if nid in bnodes]
        for (ax, az), (bx, bz) in zip(pts[:-1], pts[1:]):
            # every centerline segment near this bridge segment's box
            near = np.nonzero((X >= min(ax, bx) - 10) & (X <= max(ax, bx) + 10)
                              & (Z >= min(az, bz) - 10) & (Z <= max(az, bz) + 10))[0]
            for i in near:
                j = (i + 1) % count
                px, pz, qx, qz = X[i], Z[i], X[j], Z[j]
                d1 = (bx - ax) * (pz - az) - (bz - az) * (px - ax)
                d2 = (bx - ax) * (qz - az) - (bz - az) * (qx - ax)
                d3 = (qx - px) * (az - pz) - (qz - pz) * (ax - px)
                d4 = (qx - px) * (bz - pz) - (qz - pz) * (bx - px)
                if d1 * d2 < 0 and d3 * d4 < 0:
                    tags = el.get('tags', {})
                    crossings.append({
                        'distance': round(float(dist[i]), 1),
                        'angle': round(math.atan2(bx - ax, bz - az), 4),
                        'kind': tags.get('highway') or tags.get('railway'),
                        'name': tags.get('name'),
                    })
    crossings.sort(key=lambda c: c['distance'])
    merged = []
    for c in crossings:
        if merged and abs(merged[-1]['distance'] - c['distance']) < 25:
            continue
        merged.append(c)

    out = {
        'name': 'Nürburgring Nordschleife',
        'attribution': [
            'Track centerline, corner names, bridges and forests: © OpenStreetMap contributors, ODbL 1.0 (openstreetmap.org/copyright)',
            'Elevation: Copernicus GLO-30 DEM, © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved',
        ] + ([] if args.no_dgm1 else [
            'Road profile, camber and terrain: © GeoBasis-DE / LVermGeoRP, dl-de/by-2-0, www.lvermgeo.rlp.de [Daten bearbeitet] (DGM1)',
        ]),
        'license': 'This derived database is available under the ODbL 1.0',
        'closed': True,
        'length': round(float(length), 1),
        'origin': {'lat': lat0, 'lon': lon0},
        'spacing': round(float(spacing), 4),
        'points': [[round(float(a), 2), round(float(b), 2), round(float(c), 2)] for a, b, c in zip(X, y, Z)],
        'sections': [{'name': name, 'distance': round(float(start), 1)} for name, start in section_starts],
        'widths': widths,
        'banksDeg': banks,
        **({} if roll is None else {'rollDeg': [round(float(r), 1) for r in roll]}),
        'concrete': concrete,
        'bridges': merged,
        **dict(zip(('fences', 'landmarks'), trackside_osm(args.cache, X, Z, project, BBOX))),
        'spans': spans,
        **({} if args.no_dgm1 else {'underpasses': underpass_roads(args.cache, spans, X, Z, dist, spacing, project, unproject, Dgm1(args.cache))}),
        'barriers': barrier_offsets(args.cache, X, Z, dist, project, BBOX),
        'terrain': {
            'x': round(float(x_min), 2), 'z': round(float(z_min), 2), 'cell': TERRAIN_CELL,
            'cols': cols, 'rows': rows,
            'heightsDm': base64.b64encode(heights_dm.tobytes()).decode(),
            'forest': base64.b64encode(forest_u8.tobytes()).decode(),
        },
    }
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    json.dump(out, open(args.out, 'w'), separators=(',', ':'), ensure_ascii=False)
    grade = np.diff(np.concatenate([y, y[:1]])) / spacing
    print('length %.0f m, %d points, elevation %.1f to %.1f m, grade %+.1f%% to %+.1f%%' % (length, count, y.min(), y.max(), grade.min() * 100, grade.max() * 100))
    print('terrain %dx%d, woods %.0f%%, bridges over the lap %d, size %.0f KB' % (cols, rows, woods.mean() * 100, len(merged), os.path.getsize(args.out) / 1024))


if __name__ == '__main__':
    main()
