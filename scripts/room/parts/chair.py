# low back task chair (no headrest), swivelled out of the way. chair frame:
# seat front toward -z (the desk when pushed in), backrest toward +z
import math

from mathutils import Matrix, Vector

from .common import Geo, Mesh, T, rot3, rbox, cylinder, lathe, sweep, loft


def build(b):
    c = b.setup['chair']
    place = T(c['x'], 0, c['z']) @ rot3(yaw=c['yaw'])
    mesh = Mesh()
    n = b.seg(28, 12)
    base = c['base']
    # five star base with casters
    hub_y = base['hub_y']
    mesh.add(cylinder(0.045, 0.06, n), place @ T(0, hub_y, 0), 'chair_plastic')
    for i in range(5):
        a = 2 * math.pi * i / 5
        d = Vector((math.cos(a), 0, math.sin(a)))
        r0, r1 = 0.03, base['r']
        leg = []
        for t in (0.0, 1.0):
            r = r0 + (r1 - r0) * t
            y = hub_y - 0.01 + (base['tip_y'] - hub_y + 0.01) * t
            leg.append((d.x * r, y, d.z * r))
        w0, w1 = 0.028, 0.02
        h0, h1 = 0.034, 0.022
        rings = []
        for (x, y, z), w, h in zip(leg, (w0, w1), (h0, h1)):
            side = Vector((-d.z, 0, d.x))
            ring = []
            for u, v in ((h / 2, w / 2), (-h / 2, w / 2), (-h / 2, -w / 2), (h / 2, -w / 2)):
                ring.append(tuple(Vector((x, y, z)) + Vector((0, u, 0)) + side * v))
            rings.append(ring)
        mesh.add(loft([list(reversed(r)) for r in rings], cap1=True, smooth=False), place, 'chair_plastic')
        # caster: fork plus a wheel on the floor
        tip = Vector((d.x * base['r'], 0, d.z * base['r']))
        mesh.add(rbox(0.018, 0.03, 0.03, 0.005, 1), place @ T(tip.x, base['tip_y'] - 0.02, tip.z), 'chair_plastic')
        wheel = cylinder(0.025, 0.02, b.seg(14, 8))
        mesh.add(wheel, place @ T(tip.x + d.x * 0.012, 0.025, tip.z + d.z * 0.012)
                 @ Matrix.Rotation(-a, 4, 'Y') @ Matrix.Rotation(math.radians(90), 4, 'X'), 'chair_plastic')
    # gas lift and its telescoping cover
    seat_y = c['seat_y']
    mesh.add(cylinder(0.022, seat_y - 0.07 - hub_y, n, caps=(False, False)),
             place @ T(0, (hub_y + seat_y - 0.07) / 2, 0), 'chair_metal')
    mesh.add(lathe([(0.036, hub_y + 0.02), (0.036, hub_y + 0.1), (0.031, hub_y + 0.1), (0.031, hub_y + 0.19),
                    (0.026, hub_y + 0.19), (0.026, hub_y + 0.22)], n), place, 'chair_plastic')
    # tilt mechanism under the seat, with its lever
    mesh.add(rbox(0.22, 0.05, 0.24, 0.01, b.seg(2, 1)), place @ T(0, seat_y - 0.045, 0.01), 'chair_plastic')
    mesh.add(cylinder(0.005, 0.12, b.seg(8, 5)), place @ T(0.13, seat_y - 0.05, -0.02) @ Matrix.Rotation(math.radians(90), 4, 'Z'), 'chair_metal')
    # seat cushion
    st = c['seat']
    mesh.add(rbox(st['w'], st['h'], st['d'], st['r'], b.seg(3, 2)), place @ T(0, seat_y + st['h'] / 2 - 0.02, 0), 'chair_fabric')
    # back spine from the mechanism up behind the seat
    bk = c['back']
    top_seat = seat_y + st['h'] - 0.02
    spine = [(0, seat_y - 0.03, 0.1), (0, seat_y - 0.03, st['d'] / 2 + 0.03),
             (0, top_seat + 0.05, st['d'] / 2 + 0.06), (0, bk['y0'] + 0.08, st['d'] / 2 + 0.06 + bk['lean'] * 0.5)]
    sw, sh = 0.05, 0.016
    prof = [(sw / 2, sh / 2), (-sw / 2, sh / 2), (-sw / 2, -sh / 2), (sw / 2, -sh / 2)]
    mesh.add(sweep(spine, prof, smooth=False, up=(1, 0, 0)), place, 'chair_plastic')
    # low backrest: a curved pad leaning back a little
    rows = b.seg(4, 2)
    cols = b.seg(8, 4)
    grid = []
    for r in range(rows + 1):
        v = r / rows
        y = bk['y0'] + v * bk['h']
        zc = st['d'] / 2 + 0.06 + bk['lean'] * v
        row = []
        for k in range(cols + 1):
            u = k / cols - 0.5
            x = u * bk['w']
            z = zc - bk['curve'] * (1 - (2 * u) ** 2)
            row.append((x, y, z))
        grid.append(row)
    mesh.add(slab(grid, bk['t']), place, 'chair_fabric')
    # armrests
    ar = c['arms']
    if ar['enabled']:
        for side in (-1, 1):
            x = side * (st['w'] / 2 + 0.01)
            mesh.add(rbox(0.02, ar['h'], 0.05, 0.006, 1), place @ T(x, top_seat + ar['h'] / 2 - 0.03, 0.05), 'chair_plastic')
            mesh.add(rbox(0.075, 0.025, 0.24, 0.012, b.seg(2, 1)), place @ T(x, top_seat + ar['h'] - 0.02, 0.02), 'chair_plastic')
    b.part('chair', 'room_chair', 'setup', mesh, uv_weight=c['uv_weight'])


def slab(grid, t):
    """a thick curved panel from a grid of front surface points (rows up, columns across)"""
    rows, cols = len(grid), len(grid[0])
    g = Geo()
    front = [[g.v(p) for p in row] for row in grid]
    back = [[g.v((p[0], p[1], p[2] + t)) for p in row] for row in grid]
    for r in range(rows - 1):
        for k in range(cols - 1):
            g.f((front[r][k], front[r + 1][k], front[r + 1][k + 1], front[r][k + 1]), True)
            g.f((back[r][k], back[r][k + 1], back[r + 1][k + 1], back[r + 1][k]), True)
    for r in range(rows - 1):
        g.f((front[r][0], back[r][0], back[r + 1][0], front[r + 1][0]))
        g.f((front[r][-1], front[r + 1][-1], back[r + 1][-1], back[r][-1]))
    for k in range(cols - 1):
        g.f((front[0][k], front[0][k + 1], back[0][k + 1], back[0][k]))
        g.f((front[-1][k], back[-1][k], back[-1][k + 1], front[-1][k + 1]))
    return g
