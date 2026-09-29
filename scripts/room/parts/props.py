# desk props: finalmouse ulx (tiger / large), artisan ninja fx hien (l),
# sennheiser hd 599 se lying flat, the coffee mug, the credits card and the
# empty flipper zero spot
import math

from mathutils import Matrix, Vector

from .common import Geo, Mesh, T, rot3, box, rbox, rrect, prism, loft, lathe, sweep, cylinder, circle, ellipse


def interp(ts, vs, t):
    for i in range(len(ts) - 1):
        if ts[i] <= t <= ts[i + 1]:
            f = (t - ts[i]) / (ts[i + 1] - ts[i])
            f = f * f * (3 - 2 * f)
            return vs[i] + (vs[i + 1] - vs[i]) * f
    return vs[-1]


def mouse(b, s, desk_y):
    """symmetric shell lofted front (-z) to back (+z), open at the bottom"""
    m = s['mouse']
    L = m['l']
    ts, ws, hs = m['profile_t'], m['profile_w'], m['profile_h']
    stations = b.seg(22, 9)
    k = b.seg(20, 9)
    p = m['squareness']
    rings = []
    heights = []
    for i in range(stations + 1):
        t = i / stations
        w = interp(ts, ws, t) * (m['w'] / max(ws))
        h = interp(ts, hs, t) * (m['h'] / max(hs))
        z = -L / 2 + t * L
        ring = []
        for j in range(k + 1):
            th = math.pi - math.pi * j / k       # left bottom, over the top, right bottom
            c, sn = math.cos(th), math.sin(th)
            x = (w / 2) * math.copysign(abs(c) ** (2 / p), c)
            y = h * abs(sn) ** (2 / p)
            ring.append((x, y, z))
        rings.append(ring)
        heights.append(h)
    g = loft(rings, closed=False, cap0=True, cap1=True, smooth=True)
    pad_t = s['pad']['t']
    place = T(m['x'], desk_y + pad_t, m['z']) @ rot3(yaw=m.get('yaw', 0.0))
    mesh = Mesh()
    white, blue = Geo(), Geo()
    white.verts = blue.verts = g.verts
    split = m['blue_split']
    for idx, sm in zip(g.faces, g.smooth):
        ys = [g.verts[i][1] for i in idx]
        zs = [g.verts[i][2] for i in idx]
        tt = (sum(zs) / len(zs) + L / 2) / L
        hh = interp(ts, hs, min(max(tt, 0), 1)) * (m['h'] / max(hs))
        (blue if sum(ys) / len(ys) < split * hh else white).f(idx, sm)
    mesh.add(white, place, 'mouse_white')
    mesh.add(blue, place, 'mouse_blue')
    # scroll wheel, rising out of the shell between the buttons
    tw = m['wheel_t']
    zw = -L / 2 + tw * L
    hw = interp(ts, hs, tw) * (m['h'] / max(hs))
    wheel = cylinder(m['wheel_r'], m['wheel_w'], b.seg(16, 8))
    mesh.add(wheel, place @ T(0, hw - m['wheel_r'] * 0.55, zw) @ Matrix.Rotation(math.radians(90), 4, 'Z'), 'mouse_blue')
    # two side buttons on the left
    for tb in m['side_buttons_t']:
        wb = interp(ts, ws, tb) * (m['w'] / max(ws))
        mesh.add(rbox(0.004, 0.009, 0.019, 0.0018, 1), place @ T(-wb / 2 - 0.0005, m['side_buttons_y'], -L / 2 + tb * L), 'mouse_blue')
    return mesh, place


def pad(b, s, desk_y):
    p = s['pad']
    g = prism(rrect(p['w'], p['d'], p['r'], b.seg(4, 2)), 0.0, p['t'], bottom=False)
    return Mesh().add(g, T(p['x'], desk_y, p['z']) @ rot3(yaw=p.get('yaw', 0.0)), 'pad')


def oval_shell(rx, rz, profile, n):
    """oval surface of revolution: profile of (radius factor, y) from bottom to top, top closed"""
    g = Geo()
    rings = []
    for f, y in profile:
        rings.append([g.v((x * f, y, z * f)) for x, z in ellipse(rx, rz, n)])
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            g.f((a[i], b[i], b[j], a[j]), True)
    return g, rings[-1]


def headphones(b, s, desk_y):
    """hd 599 se lying flat: ear pads down, the headband arcing flat behind the cups"""
    hp = s['headphones']
    place = T(hp['x'], desk_y, hp['z']) @ rot3(yaw=hp.get('yaw', 0.0))
    mesh = Mesh()
    n = b.seg(40, 16)
    crx, crz = hp['cup'][1] / 2, hp['cup'][0] / 2
    pad_t, cup_d = hp['pad_t'], hp['cup_d']
    half = hp['span'] / 2
    top = pad_t + cup_d
    for side in (-1, 1):
        at = T(side * half, 0, 0)
        # velour pad: soft rounded ring sitting on the desk
        pad, _ = oval_shell(crx, crz, [(0.93, 0.0), (0.99, pad_t * 0.35), (0.99, pad_t * 0.75), (0.95, pad_t)], n)
        mesh.add(pad, place @ at, 'hp_pad')
        # shell: rounded over the top into the trim ring
        shell, rim = oval_shell(crx, crz, [(0.96, pad_t), (1.0, pad_t + 0.004), (1.0, top - 0.008),
                                           (0.975, top - 0.003), (0.93, top)], n)
        mesh.add(shell, place @ at, 'hp_black')
        trim, rim2 = oval_shell(crx, crz, [(0.93, top), (0.89, top + 0.0012), (0.84, top + 0.0012)], n)
        mesh.add(trim, place @ at, 'hp_trim')
        grille = Geo()
        for x, z in ellipse(crx * 0.84, crz * 0.84, n):
            grille.v((x, top - 0.0008, z))
        grille.f(list(reversed(range(n))))
        mesh.add(grille, place @ at, 'hp_grille')
        # yoke from the cup's back end up into the band
        mesh.add(rbox(0.012, 0.018, 0.03, 0.004, 1), place @ at @ T(0, pad_t + cup_d * 0.55, -crz - 0.008), 'hp_black')
    # headband: a flat U standing on edge, from yoke to yoke around the back
    band_y = pad_t + cup_d * 0.55
    steps = b.seg(24, 10)
    depth = hp['band_depth']
    pts = []
    for i in range(steps + 1):
        a = math.pi * i / steps
        pts.append((-half * math.cos(a), band_y, -crz - 0.012 - depth * math.sin(a)))
    bw, bt = hp['band_w'], hp['band_t']
    prof = [(bw / 2, bt / 2), (-bw / 2, bt / 2), (-bw / 2, -bt / 2), (bw / 2, -bt / 2)]
    mesh.add(sweep(pts, prof, up=(0, 1, 0)), place, 'hp_black')
    # padded cushion on the inside of the band's middle
    inner = []
    for i in range(steps // 4, steps - steps // 4 + 1):
        a = math.pi * i / steps
        r = 1.0 - (bt / 2 + 0.006) / max(half, depth)
        inner.append((-half * r * math.cos(a), band_y, -crz - 0.012 - depth * r * math.sin(a)))
    cw, ct = bw * 0.9, 0.012
    prof = [(cw / 2, ct / 2), (-cw / 2, ct / 2), (-cw / 2, -ct / 2), (cw / 2, -ct / 2)]
    mesh.add(sweep(inner, prof, up=(0, 1, 0)), place, 'hp_pad')
    return mesh


def mug(b, s, desk_y):
    mg = s['mug']
    r, h, wall = mg['r'], mg['h'], mg['wall']
    n = b.seg(32, 14)
    lvl = h - mg['coffee_gap']
    prof = [(r * 0.86, 0.0), (r * 0.97, 0.004), (r, 0.012), (r, h - 0.002), (r - wall * 0.5, h),
            (r - wall, h - 0.002), (r - wall, lvl)]
    place = T(mg['x'], desk_y, mg['z'])
    mesh = Mesh()
    mesh.add(lathe(prof, n), place, 'mug')
    coffee = Geo()
    for x, z in circle(r - wall, n):
        coffee.v((x, lvl, z))
    coffee.f(list(reversed(range(n))))
    mesh.add(coffee, place, 'coffee')
    # handle: a flattened loop on the side
    a = math.radians(mg['handle_yaw'])
    pts = []
    steps = b.seg(12, 6)
    for i in range(steps + 1):
        t = math.pi * i / steps
        pts.append((r - 0.002 + 0.028 * math.sin(t), h * 0.5 + 0.03 * math.cos(t), 0.0))
    handle = sweep(pts, ellipse(0.0055, 0.0035, b.seg(10, 6)), up=(0, 0, 1))
    mesh.add(handle, place @ Matrix.Rotation(a, 4, 'Y'), 'mug')
    return mesh, place


def card(b, s, desk_y):
    """a standing tent card: the printed front leans back by tilt, a plain leg holds it up behind"""
    c = s['card']
    w, h, t = c['w'], c['h'], c['t']
    place = T(c['x'], desk_y, c['z']) @ rot3(yaw=c.get('yaw', 0.0))
    mesh = Mesh()
    front = place @ rot3(tilt=c['tilt'])
    mesh.add(box(w, h, t, skip=('+z', '-y')), front @ T(0, h / 2, -t / 2), 'card_back')
    face = Geo()
    for x, y in ((-w / 2, 0.0), (w / 2, 0.0), (w / 2, h), (-w / 2, h)):
        face.v((x, y, 0.0))
    face.f((0, 1, 2, 3))
    mesh.add(face, front, 'card')
    # the leg hinges at the front panel's top edge and reaches back down to the desk
    top = rot3(tilt=c['tilt']) @ Vector((0, h, -t))
    leg_h = top.y / math.cos(math.radians(c['leg']))
    leg = place @ T(tuple(top)) @ rot3(tilt=180.0 + c['leg'])
    mesh.add(box(w * 0.96, leg_h, t, skip=('-y',)), leg @ T(0, leg_h / 2, -t / 2), 'card_back')
    return mesh


def build(b):
    s = b.setup
    desk_y = s['desk']['h']
    ms, mplace = mouse(b, s, desk_y)
    b.part('mouse', 'room_props', 'setup', ms, uv_weight=s['mouse']['uv_weight'])
    b.part('mousepad', 'room_props', 'setup', pad(b, s, desk_y), uv_weight=s['pad']['uv_weight'])
    b.part('headphones', 'room_props', 'setup', headphones(b, s, desk_y), uv_weight=s['headphones']['uv_weight'])
    mm, gplace = mug(b, s, desk_y)
    b.part('mug', 'room_props', 'setup', mm, uv_weight=s['mug']['uv_weight'])
    card_obj = b.part('credits_card', 'room_props', 'setup', card(b, s, desk_y), uv_weight=s['card']['uv_weight'], uv='card')
    b.card_obj = card_obj
    b.empty('anchor_mouse', 'room_props', tuple(mplace @ Vector((0, s['mouse']['h'], 0))), rot3(yaw=s['mouse'].get('yaw', 0.0)))
    b.empty('anchor_mug', 'room_props', tuple(gplace @ Vector((0, s['mug']['h'], 0))))
    fl = s['flipper_spot']
    b.empty('flipper_spot', 'room_props', (fl['x'], desk_y, fl['z']), rot3(yaw=fl['yaw']))
