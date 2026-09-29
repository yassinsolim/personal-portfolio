# wooting 60he: 60% ansi, 302 x 116 x 38 mm, 6 degree typing angle, black abs
# tray case, black pbt caps over a light switch plate, the strap clipped to
# the case's top left side, usb-c cable off the back
import math

from mathutils import Matrix, Vector

from .common import Geo, Mesh, T, rot3, rbox, rrect, tube, sweep

ROWS = [
    [1] * 13 + [2],
    [1.5] + [1] * 12 + [1.5],
    [1.75] + [1] * 11 + [2.25],
    [2.25] + [1] * 10 + [2.75],
    [1.25, 1.25, 1.25, 6.25, 1.25, 1.25, 1.25, 1.25],
]


def keycap(units, u, height, tilt_deg, rings, gap):
    """sculpted cap in its own frame: bottom centre at the origin, x across, z toward the user"""
    wb = units * u - gap
    db = u - gap
    taper = 0.0026
    wt, dt = wb - 2 * taper, db - 2 * taper - 0.0008
    back = 0.0006  # top sits a little toward the back
    tilt = math.tan(math.radians(tilt_deg))
    g = Geo()
    levels = [(wb, db, 0.0, 0.0)]
    if rings > 2:
        levels.append((wt + 0.0016, dt + 0.0016, height - 0.0012, -back * 0.8))
    levels.append((wt, dt, height, -back))
    ring_idx = []
    for w, d, y, oz in levels:
        idx = []
        for x, z in ((w / 2, d / 2), (-w / 2, d / 2), (-w / 2, -d / 2), (w / 2, -d / 2)):
            yy = y + (-(z) * tilt if y > 0 else 0.0)
            idx.append(g.v((x, yy, z + oz)))
        ring_idx.append(idx)
    for a, b in zip(ring_idx, ring_idx[1:]):
        for i in range(4):
            j = (i + 1) % 4
            g.f((a[i], b[i], b[j], a[j]))
    top = ring_idx[-1]
    g.f(list(reversed(top)))
    return g


def build(b):
    s = b.setup['keyboard']
    low = b.low
    W, D = s['case']
    fh = s['front_h']
    ang = math.radians(s['angle'])
    u = s['u']
    place = T(s['x'], b.setup['desk']['h'], s['z']) @ rot3(yaw=s.get('yaw', 0.0))
    mesh = Mesh()

    def rim_y(z):
        return fh + (D / 2 - z) * math.tan(ang)

    # tray case: outer wall, rim, inner wall down to the plate, plate
    n = b.seg(3, 1)
    outer = rrect(W, D, s['corner_r'], n)
    bz = s['bezel']  # side, front, back
    iw, idp = W - 2 * bz[0], D - bz[1] - bz[2]
    icz = (bz[2] - bz[1]) / 2
    inner = [(x, z + icz) for x, z in rrect(iw, idp, 0.002, n)]
    depth = s['rim_depth']
    g = Geo()
    k = len(outer)
    for x, z in outer:
        g.v((x, 0.0, z))
    for x, z in outer:
        g.v((x, rim_y(z), z))
    for x, z in inner:
        g.v((x, rim_y(z), z))
    for x, z in inner:
        g.v((x, rim_y(z) - depth, z))
    for i in range(k):
        j = (i + 1) % k
        g.f((i, k + i, k + j, j))                     # outer wall
        g.f((k + i, 2 * k + i, 2 * k + j, k + j))     # rim
        g.f((2 * k + i, 3 * k + i, 3 * k + j, 2 * k + j))  # inner wall, facing in
    mesh.add(g, place, 'kb_case')
    plate = Geo()
    for x, z in inner:
        plate.v((x, rim_y(z) - depth, z))
    plate.f(list(reversed(range(k))))
    mesh.add(plate, place, 'kb_plate')

    # caps on the plate plane: frame origin at the key area centre, tilted by the typing angle
    pz = icz
    plate_frame = place @ T(0, rim_y(pz) - depth + s['cap_lift'], pz) @ Matrix.Rotation(ang, 4, 'X')
    rings = 2 if low else 3
    heights = s['row_h']
    tilts = s['row_tilt']
    for r, row in enumerate(ROWS):
        x = -sum(row) * u / 2
        zc = (r - 2) * u
        for units in row:
            cx = x + units * u / 2
            cap = keycap(units, u, heights[r], tilts[r], rings, s['cap_gap'])
            mesh.add(cap, plate_frame @ T(cx, 0, zc), 'key')
            x += units * u

    # strap clip on the left side near the back, and the folded strap lying on the desk
    st = s['strap']
    cz = -D / 2 + st['clip_z']
    cy = rim_y(cz) * 0.6
    mesh.add(rbox(0.007, 0.011, 0.014, 0.002, 1), place @ T(-W / 2 - 0.0025, cy, cz), 'kb_case')
    # folded strap drooping off the clip, then lying on the desk and curling back, away from the
    # flipper spot in front of it
    path = [(-W / 2 - 0.005, cy, cz), (-W / 2 - 0.014, cy * 0.72, cz - 0.001),
            (-W / 2 - 0.028, 0.0035, cz - 0.005), (-W / 2 - 0.028 - st['l'] * 0.5, 0.0022, cz - 0.013),
            (-W / 2 - 0.028 - st['l'] * 0.85, 0.0022, cz - 0.026), (-W / 2 - 0.024 - st['l'], 0.0022, cz - 0.04)]
    hw, ht = st['w'] / 2, st['t'] / 2
    prof = [(ht, hw), (-ht, hw), (-ht, -hw), (ht, -hw)]
    mesh.add(sweep(path, prof, smooth=False, up=(0, 1, 0)), place, 'strap')

    # usb-c cable from the back edge to the desk's back edge
    ca = s['cable']
    if ca.get('enabled', True):
        start = Vector((ca['x'], rim_y(-D / 2) * 0.45, -D / 2 - 0.004))
        pts = [tuple(start), (ca['x'], 0.004, -D / 2 - 0.03)]
        world = place.inverted()
        for p in ca['path']:
            wp = Vector((p[0], b.setup['desk']['h'] + 0.004, p[1]))
            pts.append(tuple(world @ wp))
        dz = b.setup['desk']['z'] - b.setup['desk']['d'] / 2
        tail = Vector((ca['path'][-1][0], b.setup['desk']['h'] - 0.03, dz - 0.012))
        pts.append(tuple(world @ Vector((ca['path'][-1][0], b.setup['desk']['h'] + 0.002, dz - 0.004))))
        pts.append(tuple(world @ tail))
        from .pc_nv5 import catmull
        mesh.add(tube(catmull(pts, b.seg(4, 2)), ca['r'], b.seg(8, 5), caps=False), place, 'cable')

    b.part('keyboard', 'room_props', 'setup', mesh, uv_weight=s['uv_weight'], uv='keys')
    top = place @ T(0, rim_y(0.0) + 0.012, 0)
    b.empty('anchor_keyboard', 'room_props', tuple(top.to_translation()), rot3(yaw=s.get('yaw', 0.0)))
