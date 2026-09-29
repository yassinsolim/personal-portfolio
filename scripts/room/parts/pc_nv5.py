# the pc: a white phanteks nv5 with the panoramic glass front and left side,
# built from the reference photos. case frame: origin on the floor under the
# case centre, x across (glass side at -x), y up, z front (+z) to rear (-z)
import math

from mathutils import Matrix, Vector

from .common import Geo, Mesh, T, rot3, box, rbox, cylinder, prism, tube, sweep, circle, transform


def fan(b, body, led, m, s):
    """120 mm fan, axis +z (front face at +z). frame, hub and blades go in body, the ring in led"""
    size, t = s['size'], s['t']
    ro = size * 0.4833
    n = b.seg(40, 16)
    g = Geo()
    h = t / 2
    sq = []
    for i in range(n):
        a = 2 * math.pi * i / n
        c, sn = math.cos(a), math.sin(a)
        k = (size / 2) / max(abs(c), abs(sn))
        sq.append((c * k, sn * k))
    ci = circle(ro, n)
    for z in (h, -h):
        for x, y in sq:
            g.v((x, y, z))
        for x, y in ci:
            g.v((x, y, z))
    sf, cf, sb, cb = 0, n, 2 * n, 3 * n
    for i in range(n):
        j = (i + 1) % n
        g.f((sf + i, sf + j, cf + j, cf + i))
        g.f((sb + i, cb + i, cb + j, sb + j))
        g.f((cf + i, cf + j, cb + j, cb + i), True)
        g.f((sf + i, sb + i, sb + j, sf + j))
    body.add(g, m, 'fan_white')
    body.add(cylinder(size * 0.175, t * 0.9, b.seg(20, 10), caps=(False, True)),
             m @ Matrix.Rotation(math.radians(90), 4, 'X'), 'fan_white')
    if b.low:
        body.add(cylinder(ro * 0.96, 0.003, n, caps=(True, True)),
                 m @ T(0, 0, 0.002) @ Matrix.Rotation(math.radians(90), 4, 'X'), 'fan_blade')
    else:
        blades = s['blades']
        for i in range(blades):
            body.add(blade(size * 0.18, ro * 0.97, 2 * math.pi * i / blades, t * 0.55), m, 'fan_blade')
    # light ring on the frame's inner rim, a hair in front of the frame
    rg = Geo()
    r0, r1 = ro - 0.0005, ro + s['ring_w']
    for x, y in circle(r1, n):
        rg.v((x, y, h + 0.0006))
    for x, y in circle(r0, n):
        rg.v((x, y, h + 0.0006))
    for i in range(n):
        j = (i + 1) % n
        rg.f((i, j, n + j, n + i))
    led.add(rg, m, 'led')


def blade(r1, r2, a0, depth):
    """one swept, pitched fan blade, single sided: only its front is ever in view"""
    g = Geo()
    rs = (r1, (r1 + r2) / 2, r2)
    lead = (0.0, 0.18, 0.40)
    span = (0.42, 0.50, 0.58)
    for r, l, sp in zip(rs, lead, span):
        for a, z in ((a0 + l, depth / 2), (a0 + l + sp, -depth / 2)):
            g.v((r * math.cos(a), r * math.sin(a), z))
    for rad in range(2):
        a, b = rad * 2, rad * 2 + 2
        g.f((a, b, b + 1, a + 1))
    return g


def catmull(points, n=6):
    pts = [Vector(p) for p in points]
    pts = [pts[0] * 2 - pts[1]] + pts + [pts[-1] * 2 - pts[-2]]
    out = []
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        for k in range(n):
            t = k / n
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t))
    out.append(pts[-2])
    return [tuple(p) for p in out]


def build(b):
    s = b.setup['pc']
    W, H, D = s['case']['w'], s['case']['h'], s['case']['d']
    base_h, top_t, wall = s['base_h'], s['top_t'], s['wall_t']
    gl = s['glass']['t']
    place = T(s['x'], 0, s['z']) @ rot3(yaw=s.get('yaw', 0.0))
    body = Mesh()
    led = Mesh()
    glass = Mesh()
    low = b.low
    xg = -W / 2 + gl          # inside face of the side glass
    zf = D / 2 - gl           # inside face of the front glass
    x_tray = s['tray_x']
    floor_y = base_h + 0.004

    # ---- case shell
    body.add(rbox(W, base_h - s['foot_h'], D, 0.004, b.seg(2, 1), skip=('-y',)),
             T(0, s['foot_h'] + (base_h - s['foot_h']) / 2, 0), 'pc_white')
    for fx in (-1, 1):
        for fz in (-1, 1):
            body.add(cylinder(0.014, s['foot_h'], b.seg(12, 6), caps=(False, False)),
                     T(fx * (W / 2 - 0.03), s['foot_h'] / 2, fz * (D / 2 - 0.05)), 'pc_dark')
    body.add(rbox(W, top_t, D, 0.004, b.seg(2, 1)), T(0, H - top_t / 2, 0), 'pc_white')
    wall_h = H - top_t - base_h
    body.add(box(wall, wall_h, D - 0.002, skip=('-x',)), T(W / 2 - wall / 2, base_h + wall_h / 2, -0.001), 'pc_white')
    body.add(box(W - wall, wall_h, wall), T(-wall / 2, base_h + wall_h / 2, -D / 2 + wall / 2), 'pc_white')
    # motherboard tray and the case floor
    body.add(box(0.002, wall_h, D - wall - gl, skip=('+x',)), T(x_tray + 0.001, base_h + wall_h / 2, (wall - gl) / 2), 'pc_tray')
    body.add(box(x_tray - xg, 0.004, D - wall - gl, skip=('-y',)), T((x_tray + xg) / 2, base_h + 0.002, (wall - gl) / 2), 'pc_tray')
    # cable grommets along the tray's front edge (dark slots)
    for gy in (0.16, 0.26, 0.36):
        body.add(rbox(0.001, 0.05, 0.016, 0.0004, 1), T(x_tray - 0.0005, gy, -0.004), 'pc_dark')

    # ---- stepped psu shroud: a (z, y) profile extruded along x, from behind the side glass to the tray
    sh = s['shroud']
    zr = -D / 2 + wall
    z0, z1 = sh['step_z']
    prof = [(zr, floor_y), (zr, sh['top']), (z0, sh['top']), (z1, floor_y)]
    # prism local (lx, ly, lz) -> case (x, y, z) = (ly, lz, lx), so the outline is (z, y)
    to_case = Matrix(((0, 1, 0, 0), (0, 0, 1, 0), (1, 0, 0, 0), (0, 0, 0, 1)))
    g = transform(prism(list(reversed(prof)), xg + 0.004, x_tray, top=False), to_case)
    body.add(keep_faces(g, lambda ps: not (all(abs(p[1] - floor_y) < 1e-6 for p in ps)
                                           or all(abs(p[2] - zr) < 1e-6 for p in ps))), None, 'pc_white')

    # ---- motherboard and parts
    mb = s['board']
    bx = mb['x']
    by0, by1 = mb['top'] - mb['h'], mb['top']
    bz0, bz1 = mb['rear'], mb['rear'] + mb['w']
    body.add(box(0.0016, mb['h'], mb['w'], skip=('+x',)), T(bx + 0.0008, (by0 + by1) / 2, (bz0 + bz1) / 2), 'board')
    # rear i/o shroud, vrm heatsinks, chipset and m.2 covers
    body.add(rbox(0.034, 0.16, 0.05, 0.004, 1, skip=('+x',)), T(bx - 0.017, by1 - 0.095, bz0 + 0.028), 'board')
    body.add(rbox(0.026, 0.028, 0.13, 0.003, 1, skip=('+x',)), T(bx - 0.013, by1 - 0.022, -0.13), 'heatsink')
    body.add(rbox(0.026, 0.11, 0.024, 0.003, 1, skip=('+x',)), T(bx - 0.013, by1 - 0.09, -0.195), 'heatsink')
    body.add(rbox(0.012, 0.05, 0.05, 0.003, 1, skip=('+x',)), T(bx - 0.006, by0 + 0.045, -0.04), 'board')
    body.add(rbox(0.006, 0.026, 0.09, 0.002, 1, skip=('+x',)), T(bx - 0.003, 0.285, -0.16), 'board')
    # dimm slots and the two sticks (light bars go in the led mesh)
    ram = s['ram']
    ry0, ry1 = ram['top'] - ram['l'], ram['top']
    for zs in ram['slots']:
        body.add(box(0.006, ram['l'] + 0.01, 0.006, skip=('+x',)), T(bx - 0.003, (ry0 + ry1) / 2, zs), 'board')
    for zs in ram['z']:
        body.add(rbox(ram['h'], ram['l'], ram['t'], 0.0015, 1, skip=('+x',)),
                 T(bx - ram['h'] / 2, (ry0 + ry1) / 2, zs), 'ram')
        led.add(box(0.004, ram['l'] - 0.012, ram['t'] * 0.7, skip=('+x',)),
                T(bx - ram['h'] - 0.002, (ry0 + ry1) / 2, zs), 'led')
    # atx power cable bundle at the board's front edge
    for k in range(3 if not low else 1):
        yk = 0.33 - 0.022 * k
        pts = [(bx - 0.018, yk, bz1 + 0.004), (bx - 0.012, yk - 0.004, bz1 + 0.018), (x_tray - 0.002, yk - 0.01, bz1 + 0.026)]
        body.add(tube(pts, 0.0055, b.seg(8, 5), caps=False), None, 'cable')

    # ---- cpu pump
    pu = s['pump']
    pz, py = pu['z'], pu['y']
    body.add(rbox(pu['d'], pu['s'], pu['s'], 0.008, b.seg(3, 1), skip=('+x',)), T(bx - pu['d'] / 2, py, pz), 'pump')
    body.add(box(0.001, pu['s'] * 0.8, pu['s'] * 0.8, skip=('+x',)), T(bx - pu['d'] - 0.0005, py, pz), 'pump_face')
    ring = pu['s'] * 0.66
    rw = 0.003
    for dy, dz, sy, sz in ((ring / 2, 0, rw, ring + rw), (-ring / 2, 0, rw, ring + rw),
                           (0, ring / 2, ring - rw, rw), (0, -ring / 2, ring - rw, rw)):
        led.add(box(0.0008, sy, sz, skip=('+x',)), T(bx - pu['d'] - 0.0012, py + dy, pz + dz), 'led')

    # ---- gpu, horizontal: length along z, height along x (toward the glass), fans down
    gp = s['gpu']
    gx0 = bx - gp['gap']
    gx1 = gx0 - gp['h']
    gy1 = gp['top_y']
    gy0 = gy1 - gp['t']
    gz0 = gp['rear']
    gz1 = gz0 + gp['l']
    gcx, gcy, gcz = (gx0 + gx1) / 2, (gy0 + gy1) / 2, (gz0 + gz1) / 2
    body.add(rbox(gp['h'], gp['t'] - 0.003, gp['l'], 0.006, b.seg(2, 1)), T(gcx, gcy - 0.0015, gcz), 'gpu_shroud')
    # backplate on top with the flow through cutout at the front end
    cut = gp['cutout']
    solid_l = gp['l'] - cut - 0.012
    body.add(box(gp['h'] - 0.004, 0.003, solid_l, skip=('-y',)), T(gcx, gy1 - 0.0015, gz0 + 0.006 + solid_l / 2), 'gpu_plate')
    for dx in (-1, 1):
        body.add(box(0.012, 0.003, cut, skip=('-y',)), T(gcx + dx * (gp['h'] / 2 - 0.008), gy1 - 0.0015, gz1 - 0.006 - cut / 2), 'gpu_plate')
    body.add(box(gp['h'] - 0.004, 0.003, 0.012, skip=('-y',)), T(gcx, gy1 - 0.0015, gz1 - 0.006), 'gpu_plate')
    fins = 0 if low else gp['fins']
    body.add(box(gp['h'] - 0.028, 0.002, cut - 0.004, skip=('-y',)), T(gcx, gy1 - 0.011, gz1 - 0.006 - cut / 2), 'gpu_dark')
    for i in range(fins):
        fz = gz1 - 0.008 - (i + 0.5) * (cut - 0.004) / fins
        fin = Geo()
        hx = (gp['h'] - 0.03) / 2
        for x, y in ((-hx, -0.004), (hx, -0.004), (hx, 0.004), (-hx, 0.004)):
            fin.v((x, y, 0.0))
        fin.f((0, 1, 2, 3))
        body.add(fin, T(gcx, gy1 - 0.006, fz), 'gpu_fins')
    # the glass facing edge: dark band plus the lighter brand plate at the front end (no lettering)
    body.add(box(0.001, gp['t'] * 0.5, gp['l'] * 0.62, skip=('+x',)), T(gx1 - 0.0005, gcy, gz0 + gp['l'] * 0.36), 'gpu_dark')
    body.add(box(0.001, gp['t'] * 0.42, 0.085, skip=('+x',)), T(gx1 - 0.0005, gcy, gz1 - 0.06), 'gpu_plate')
    # three fans underneath (seen only from low angles)
    for i in range(3):
        fzc = gz0 + gp['l'] * (0.2 + 0.3 * i) + 0.01
        body.add(cylinder(0.046, 0.002, b.seg(24, 10), caps=(True, False)), T(gcx, gy0 - 0.001, fzc), 'gpu_dark')
    # pcie bracket on the rear wall
    body.add(box(0.12, 0.062, 0.002), T(gcx + 0.01, gcy, gz0 - 0.001), 'heatsink')
    # power cable from the glass facing edge down to the shroud
    pts = catmull([(gx1 - 0.002, gcy + 0.012, gz0 + 0.19), (gx1 - 0.012, gcy - 0.01, gz0 + 0.195),
                   (gx1 - 0.008, sh['top'] + 0.03, gz0 + 0.2), (gx1 + 0.02, sh['top'] + 0.002, gz0 + 0.205)], b.seg(5, 3))
    body.add(tube(pts, 0.0065, b.seg(8, 5), caps=False), None, 'cable')

    # ---- radiator and fans at the top, rear exhaust, side intakes
    ra = s['radiator']
    ry = H - top_t - ra['t'] / 2
    tank = 0.028
    body.add(rbox(ra['w'], ra['t'], ra['l'] - 2 * tank, 0.003, 1), T(ra['x'], ry, ra['z']), 'rad')
    for dz in (-1, 1):
        body.add(rbox(ra['w'] + 0.006, ra['t'] + 0.004, tank, 0.004, 1), T(ra['x'], ry - 0.002, ra['z'] + dz * (ra['l'] - tank) / 2), 'rad')
    fs = s['fan']
    fy = H - top_t - ra['t'] - fs['t'] / 2
    for i in range(3):
        fz = ra['z'] + (i - 1) * fs['size']
        fan(b, body, led, T(ra['x'], fy, fz) @ Matrix.Rotation(math.radians(90), 4, 'X'), fs)
    rf = s['rear_fan']
    fan(b, body, led, T(rf['x'], rf['y'], zr + fs['t'] / 2), fs)
    sf = s['side_fans']
    for fy2 in sf['y']:
        fan(b, body, led, T(sf['x'], fy2, sf['z']) @ Matrix.Rotation(math.radians(-90), 4, 'Y'), fs)

    # ---- aio tubes from the pump to the radiator's front tank
    tb = s['tubes']
    start = Vector((bx - pu['d'] + 0.006, py + 0.022, pz + 0.03))
    path = [start, start + Vector((-0.03, -0.012, 0.02)), Vector((gx1 + 0.03, gy1 + 0.045, -0.02)),
            Vector((gx1 + 0.008, gy1 + 0.06, 0.09)), Vector((ra['x'] - 0.03, H - top_t - 0.09, ra['z'] + ra['l'] / 2 - 0.02)),
            Vector((ra['x'] - 0.03, H - top_t - ra['t'] - 0.006, ra['z'] + ra['l'] / 2 + 0.005))]
    pts = catmull(path, b.seg(6, 3))
    off = Vector(tb['offset'])
    for k in range(2):
        body.add(tube([Vector(p) + off * k for p in pts], tb['r'], b.seg(12, 6), caps=False), None, 'tube')
    # tie that holds the two tubes together
    mid = Vector(pts[len(pts) // 2])
    body.add(rbox(0.012, 0.034, 0.024, 0.004, 1), T(mid + off * 0.5), 'fan_white')

    # ---- led strips: pillarless corner, bottom front edge, the shroud's stepped edge
    lw = s['led']['w']
    ly0, ly1 = base_h + 0.002, H - top_t - 0.002
    led.add(box(lw, ly1 - ly0, lw), T(xg + lw / 2 + 0.001, (ly0 + ly1) / 2, zf - lw / 2 - 0.001), 'led')
    lx0, lx1 = xg + 0.001, W / 2 - wall - 0.002
    led.add(box(lx1 - lx0, lw, lw), T((lx0 + lx1) / 2, base_h + lw / 2 + 0.001, zf - lw / 2 - 0.001), 'led')
    edge = [(xg + 0.006, sh['top'] + lw * 0.3, zr + 0.004), (xg + 0.006, sh['top'] + lw * 0.3, z0),
            (xg + 0.006, floor_y + lw * 0.6, z1)]
    sq = [(lw / 2, lw / 2), (-lw / 2, lw / 2), (-lw / 2, -lw / 2), (lw / 2, -lw / 2)]
    led.add(sweep(edge, sq, smooth=False, up=(1, 0, 0)), None, 'led')

    # ---- glass: two single sided quads on the outside faces, meeting at the corner
    gy0g, gy1g = base_h, H - top_t
    g = Geo()
    for p in ((-W / 2, gy0g, D / 2), (W / 2 - wall, gy0g, D / 2), (W / 2 - wall, gy1g, D / 2), (-W / 2, gy1g, D / 2)):
        g.v(p)
    g.f((0, 1, 2, 3))
    glass.add(g, None, 'glass')
    g = Geo()
    for p in ((-W / 2, gy0g, -D / 2 + wall), (-W / 2, gy0g, D / 2), (-W / 2, gy1g, D / 2), (-W / 2, gy1g, -D / 2 + wall)):
        g.v(p)
    g.f((0, 1, 2, 3))
    glass.add(g, None, 'glass')

    b.part('pc_case', 'room_pc', 'pc', Mesh().merge(body, place), uv_weight=1.0)
    b.part('pc_leds', 'room_pc', 'led', Mesh().merge(led, place), uv='none')
    b.part('pc_glass', 'room_pc', 'glass', Mesh().merge(glass, place), uv='none')
    b.empty('anchor_pc', 'room_pc', tuple(place @ Vector((0, H / 2, 0))), rot3(yaw=s.get('yaw', 0.0)))


def keep_faces(g, test):
    """faces whose vertex positions pass test(list of points)"""
    out = Geo()
    out.verts = g.verts
    for idx, sm in zip(g.faces, g.smooth):
        if test([g.verts[i] for i in idx]):
            out.f(idx, sm)
    return out
