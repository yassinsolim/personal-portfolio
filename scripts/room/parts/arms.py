# monitor arms clamped to the desk's back edge: m1 on its own single arm,
# m2 and m3 on one dual arm. each arm is a two link swing arm (a flat upper
# link at the collar height, a sloped forearm up or down to the tilt head)
# solved in plan so the head lands on the monitor's vesa plate
import math

from mathutils import Matrix, Vector

from .common import Mesh, T, rbox, cylinder, prism


def stadium(length, width, n):
    """bar outline in (x, z) from joint x = 0 to joint x = length, round ends"""
    r = width / 2
    pts = []
    for i in range(n + 1):
        a = -math.pi / 2 + math.pi * i / n
        pts.append((length + r * math.cos(a), r * math.sin(a)))
    for i in range(n + 1):
        a = math.pi / 2 + math.pi * i / n
        pts.append((r * math.cos(a), r * math.sin(a)))
    return pts


def link(mesh, a, b, width, height, n, key):
    """a flat bar from point a to point b (three.js space), bar faces horizontal before pitch"""
    a, b = Vector(a), Vector(b)
    d = b - a
    flat = math.hypot(d.x, d.z)
    yaw = math.atan2(-d.z, d.x)
    pitch = math.atan2(d.y, flat)
    length = d.length
    bar = prism(stadium(length, width, n), -height / 2, height / 2)
    m = T(a) @ Matrix.Rotation(yaw, 4, 'Y') @ Matrix.Rotation(pitch, 4, 'Z')
    mesh.add(bar, m, key)


def solve_elbow(s, h, l1, l2, bend):
    """elbow position in plan for shoulder s and head h (x, z). bend picks the side"""
    dx, dz = h[0] - s[0], h[1] - s[1]
    d = math.hypot(dx, dz)
    d = min(max(d, abs(l1 - l2) + 1e-4), l1 + l2 - 1e-4)
    phi = math.atan2(dz, dx)
    alpha = math.acos((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))
    cands = [(s[0] + l1 * math.cos(phi + sgn * alpha), s[1] + l1 * math.sin(phi + sgn * alpha)) for sgn in (1, -1)]
    if bend == 'back':
        return min(cands, key=lambda p: p[1])
    if bend == 'front':
        return max(cands, key=lambda p: p[1])
    if bend == 'left':
        return min(cands, key=lambda p: p[0])
    return max(cands, key=lambda p: p[0])


def clamp(b, mesh, px, pz):
    desk = b.setup['desk']
    cl = b.setup['arms']['clamp']
    h, t = desk['h'], desk['top_t']
    back = desk['z'] - desk['d'] / 2
    pw, pth, pd = cl['plate']
    mesh.add(rbox(pw, pth, pd, 0.004, b.seg(2, 1), skip=('-y',)), T(px, h + pth / 2, back + pd / 2), 'arm')
    drop = t + pth + cl['under']
    mesh.add(rbox(pw * 0.85, drop, cl['spine_t'], 0.003, 1),
             T(px, h + pth - drop / 2, back - cl['spine_t'] / 2), 'arm')
    jaw_y = h - t - cl['under'] + 0.006
    mesh.add(rbox(pw * 0.85, 0.010, pd * 0.75, 0.003, 1),
             T(px, jaw_y, back - cl['spine_t'] + pd * 0.375), 'arm')
    sz = back + pd * 0.45
    mesh.add(cylinder(0.006, 0.03, b.seg(10, 6)), T(px, jaw_y - 0.018, sz), 'arm_accent')
    mesh.add(cylinder(cl['knob_r'], cl['knob_h'], b.seg(20, 10)), T(px, jaw_y - 0.034 - cl['knob_h'] / 2, sz), 'arm')
    # pressure pad against the desk's underside
    mesh.add(cylinder(0.016, 0.004, b.seg(16, 8)), T(px, h - t - 0.002, sz), 'arm_accent')
    return h + pth


def pole(b, mesh, px, pz, r, base_y, height):
    mesh.add(cylinder(r, height, b.seg(20, 10), caps=(False, False)), T(px, base_y + height / 2, pz), 'arm')
    mesh.add(cylinder(r + 0.002, 0.012, b.seg(20, 10), caps=(False, True)), T(px, base_y + height + 0.006, pz), 'arm_accent')
    mesh.add(cylinder(r + 0.006, 0.014, b.seg(20, 10), caps=(False, True)), T(px, base_y + 0.007, pz), 'arm')


def arm(b, mesh, px, pz, pole_r, spec):
    sg = b.setup['arms']['seg']
    v = b.vesa[spec['screen']]
    back_h = Vector((v['back'].x, 0.0, v['back'].z)).normalized()
    head = v['point'] + back_h * sg['head_depth']
    cy = spec['collar_y']
    n = b.seg(10, 4)
    # collar around the pole
    mesh.add(cylinder(pole_r + 0.008, sg['collar_h'], b.seg(20, 10)), T(px, cy, pz), 'arm')
    ex, ez = solve_elbow((px, pz), (head.x, head.z), spec['l1'], spec['l2'], spec.get('bend', 'back'))
    link(mesh, (px, cy, pz), (ex, cy, ez), sg['w'], sg['h'], n, 'arm')
    # forearm stacked on the upper link at the elbow, sloping to the head
    fy = cy + sg['h']
    link(mesh, (ex, fy, ez), (head.x, v['point'].y, head.z), sg['w'] * 0.9, sg['h'], n, 'arm')
    mesh.add(cylinder(sg['joint_r'], sg['h'] * 2.4, b.seg(20, 10)), T(ex, cy + sg['h'] / 2, ez), 'arm_accent')
    # tilt head: swivel, knuckle, then the vesa plate on the monitor's back
    mesh.add(cylinder(sg['joint_r'] * 0.8, sg['h'] * 1.6, b.seg(16, 8)), T(head.x, v['point'].y, head.z), 'arm_accent')
    rot = v['rot'].to_3x3().to_4x4()
    vp = v['point']
    mid = (vp + head) / 2
    knuckle = rbox(0.030, 0.034, (vp - head).length, 0.006, 1)
    yaw = math.atan2(back_h.x, back_h.z)
    mesh.add(knuckle, T(mid) @ Matrix.Rotation(yaw, 4, 'Y'), 'arm')
    pl = sg['plate']
    mesh.add(rbox(pl, pl, sg['plate_t'], 0.004, 1), T(vp + v['back'] * (sg['plate_t'] / 2)) @ rot, 'arm')


def build(b):
    s = b.setup['arms']
    mesh = Mesh()
    for key in ('single', 'dual'):
        a = s[key]
        px, pz = a['pole']
        base = clamp(b, mesh, px, pz)
        pole(b, mesh, px, pz, a['pole_r'], base, a['pole_h'])
        for spec in a['arms']:
            arm(b, mesh, px, pz, a['pole_r'], spec)
    b.part('arms', 'room_desk', 'setup', mesh, uv_weight=0.8)
