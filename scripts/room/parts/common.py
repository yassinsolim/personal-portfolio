# shared helpers for the room v2 builders.
#
# every builder writes geometry in room metres with three.js axes (x right,
# y up, z toward the chair, origin on the floor under the main screen's centre
# line). a Part turns into a blender object at the end, which is where the
# axes become blender's (x, -z, y). export scales by units.per_metre and moves
# y down to units.floor_y, so the glb lands in site units.
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

C3 = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))  # three.js axes to blender axes
C4 = C3.to_4x4()


def rot3(yaw=0.0, tilt=0.0, roll=0.0):
    """4x4 rotation in three.js space: roll (z), then tilt (x), then yaw (y), degrees"""
    return (Matrix.Rotation(math.radians(yaw), 4, 'Y')
            @ Matrix.Rotation(math.radians(tilt), 4, 'X')
            @ Matrix.Rotation(math.radians(roll), 4, 'Z'))


def T(x=0.0, y=0.0, z=0.0):
    if isinstance(x, (tuple, list, Vector)):
        x, y, z = x
    return Matrix.Translation(Vector((x, y, z)))


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(value):
    value = value.lstrip('#')
    return tuple(int(value[i:i + 2], 16) / 255 for i in (0, 2, 4))


# ---------------------------------------------------------------- geometry

class Geo:
    """a loose list of verts and faces (index tuples) with per face smooth flags"""

    def __init__(self):
        self.verts = []
        self.faces = []
        self.smooth = []

    def v(self, p):
        self.verts.append(tuple(p))
        return len(self.verts) - 1

    def f(self, idx, smooth=False):
        self.faces.append(tuple(idx))
        self.smooth.append(smooth)


BOX_FACES = {
    '-y': (0, 1, 2, 3), '+y': (4, 7, 6, 5),
    '-z': (0, 4, 5, 1), '+z': (3, 2, 6, 7),
    '-x': (0, 3, 7, 4), '+x': (1, 5, 6, 2),
}


def box(sx, sy, sz, skip=()):
    """box centred on the origin. skip names faces to leave out, e.g. '-y' (bottom)"""
    x, y, z = sx / 2, sy / 2, sz / 2
    g = Geo()
    # 0..3 bottom (y = -y), 4..7 top
    for p in ((-x, -y, -z), (x, -y, -z), (x, -y, z), (-x, -y, z),
              (-x, y, -z), (x, y, -z), (x, y, z), (-x, y, z)):
        g.v(p)
    for name, idx in BOX_FACES.items():
        if name not in skip:
            g.f(idx)
    return g


def rrect(w, d, r, n=4):
    """rounded rectangle outline in (x, z), ordered so a face through it points down (-y)"""
    r = max(0.0, min(r, w / 2 - 1e-6, d / 2 - 1e-6))
    if r <= 1e-6 or n < 1:
        return [(w / 2, d / 2), (-w / 2, d / 2), (-w / 2, -d / 2), (w / 2, -d / 2)]
    pts = []
    for cx, cz, a0 in ((w / 2 - r, d / 2 - r, 0), (-(w / 2 - r), d / 2 - r, 90),
                       (-(w / 2 - r), -(d / 2 - r), 180), (w / 2 - r, -(d / 2 - r), 270)):
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n)
            pts.append((cx + r * math.cos(a), cz + r * math.sin(a)))
    return pts


def circle(r, n, a0=0.0):
    """circle outline in (x, z) with the same winding as rrect"""
    return [(r * math.cos(a0 + 2 * math.pi * i / n), r * math.sin(a0 + 2 * math.pi * i / n)) for i in range(n)]


def ellipse(rx, rz, n):
    return [(rx * math.cos(2 * math.pi * i / n), rz * math.sin(2 * math.pi * i / n)) for i in range(n)]


def prism(outline, y0, y1, bottom=True, top=True, smooth_sides=False, top_y=None):
    """extrude an (x, z) outline from y0 to y1 along y. top_y(x, z) can slant the top"""
    n = len(outline)
    g = Geo()
    for x, z in outline:
        g.v((x, y0, z))
    for x, z in outline:
        g.v((x, top_y(x, z) if top_y else y1, z))
    if bottom:
        g.f(range(n))
    if top:
        g.f([n + i for i in reversed(range(n))])
    for i in range(n):
        j = (i + 1) % n
        g.f((i, n + i, n + j, j), smooth_sides)
    return g


def cylinder(r, h, n=24, caps=(True, True), smooth=True):
    """cylinder along y, centred on the origin"""
    return prism(circle(r, n), -h / 2, h / 2, bottom=caps[0], top=caps[1], smooth_sides=smooth)


def loft(rings, closed=True, cap0=False, cap1=False, smooth=True):
    """quads between consecutive rings of equal length (lists of 3d points).
    ring winding like circle() in a plane facing along the loft gives outward faces"""
    g = Geo()
    n = len(rings[0])
    base = []
    for ring in rings:
        base.append(len(g.verts))
        for p in ring:
            g.v(p)
    for k in range(len(rings) - 1):
        a, b = base[k], base[k + 1]
        for i in range(n if closed else n - 1):
            j = (i + 1) % n
            g.f((a + i, b + i, b + j, a + j), smooth)
    if cap0:
        g.f([base[0] + i for i in range(n)])
    if cap1:
        g.f([base[-1] + i for i in reversed(range(n))])
    return g


def lathe(profile, n=24, smooth=True):
    """surface of revolution around y from (r, y) points. r = 0 ends close with a fan"""
    g = Geo()
    rings = []
    for r, y in profile:
        if r <= 1e-9:
            rings.append([g.v((0.0, y, 0.0))])
        else:
            rings.append([g.v((x, y, z)) for x, z in circle(r, n)])
    for k in range(len(rings) - 1):
        a, b = rings[k], rings[k + 1]
        if len(a) == 1 and len(b) == 1:
            continue
        for i in range(n):
            j = (i + 1) % n
            if len(a) == 1:
                g.f((a[0], b[i], b[j]), smooth)
            elif len(b) == 1:
                g.f((a[i], b[0], a[j]), smooth)
            else:
                g.f((a[i], b[i], b[j], a[j]), smooth)
    return g


def frames(points, up=None):
    """rotation minimising frames (tangent, normal, binormal) along a polyline"""
    pts = [Vector(p) for p in points]
    tans = []
    for i in range(len(pts)):
        if i == 0:
            t = pts[1] - pts[0]
        elif i == len(pts) - 1:
            t = pts[-1] - pts[-2]
        else:
            t = (pts[i + 1] - pts[i]).normalized() + (pts[i] - pts[i - 1]).normalized()
        tans.append(t.normalized())
    ref = Vector(up) if up is not None else Vector((0, 1, 0))
    if abs(ref.dot(tans[0])) > 0.95:
        ref = Vector((1, 0, 0))
    n = (ref - tans[0] * ref.dot(tans[0])).normalized()
    out = []
    for i, t in enumerate(tans):
        if i > 0:
            q = tans[i - 1].rotation_difference(t)
            n = (q @ n)
            n = (n - t * n.dot(t)).normalized()
        out.append((t, n, n.cross(t)))
    return pts, out


def sweep(points, profile, closed=True, caps=True, smooth=True, up=None, scales=None):
    """sweep a 2d profile (u along the frame normal, v along the binormal) along a path.
    a profile wound like circle() gives outward faces"""
    pts, fr = frames(points, up)
    rings = []
    for i, (p, (t, n, b)) in enumerate(zip(pts, fr)):
        s = scales[i] if scales else 1.0
        rings.append([p + n * (u * s) + b * (v * s) for u, v in profile])
    return loft(rings, closed=closed, cap0=caps, cap1=caps, smooth=smooth)


def tube(points, r, n=12, caps=True, up=None):
    return sweep(points, circle(r, n), caps=caps, up=up)


def to_bm(geo):
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in geo.verts]
    for idx, sm in zip(geo.faces, geo.smooth):
        try:
            f = bm.faces.new([vs[i] for i in idx])
        except ValueError:
            continue
        f.smooth = sm
    bm.normal_update()
    return bm


def from_bm(bm):
    g = Geo()
    index = {}
    for i, v in enumerate(bm.verts):
        index[v] = i
        g.v(v.co)
    for f in bm.faces:
        g.f([index[v] for v in f.verts], f.smooth)
    bm.free()
    return g


def bevel(geo, width, segments=2, select=None, profile=0.5):
    """round the edges of a geo. select(edge) picks edges (default all)"""
    if width <= 0:
        return geo
    bm = to_bm(geo)
    edges = [e for e in bm.edges if select is None or select(e)]
    if edges:
        res = bmesh.ops.bevel(bm, geom=edges, offset=width, offset_type='OFFSET', segments=segments,
                              profile=profile, affect='EDGES', clamp_overlap=True)
        for f in res.get('faces', []):
            f.smooth = True
    return from_bm(bm)


def rbox(sx, sy, sz, r, segments=2, skip=(), edges='all', sharp=None):
    """box with rounded edges. edges: 'all', 'vertical' (along y), 'top' (the y = +h/2 ring),
    'top_vertical'. edges on the faces named in sharp (default: the skipped ones) stay square"""
    g = box(sx, sy, sz)
    hy = sy / 2 - 1e-7
    sharp = skip if sharp is None else sharp
    half = {'-x': (0, -sx / 2), '+x': (0, sx / 2), '-y': (1, -sy / 2), '+y': (1, sy / 2),
            '-z': (2, -sz / 2), '+z': (2, sz / 2)}

    def on(face, co):
        axis, value = half[face]
        return abs(co[axis] - value) < 1e-7

    def pick(e):
        a, b = e.verts[0].co, e.verts[1].co
        for face in sharp:
            if on(face, a) and on(face, b):
                return False
        vertical = abs(a.x - b.x) < 1e-7 and abs(a.z - b.z) < 1e-7
        if edges == 'vertical':
            return vertical
        if edges == 'top':
            return a.y > hy and b.y > hy
        if edges == 'top_vertical':
            return vertical or (a.y > hy and b.y > hy)
        return True

    g = bevel(g, r, segments, pick)
    if skip:
        g = drop_faces(g, skip, (sx, sy, sz))
    return g


def drop_faces(geo, skip, size):
    """remove faces lying flat on the named box sides (after bevels)"""
    sx, sy, sz = size
    keep = Geo()
    keep.verts = list(geo.verts)
    lim = {'-y': (1, -sy / 2), '+y': (1, sy / 2), '-x': (0, -sx / 2), '+x': (0, sx / 2),
           '-z': (2, -sz / 2), '+z': (2, sz / 2)}
    for idx, sm in zip(geo.faces, geo.smooth):
        drop = False
        for name in skip:
            axis, value = lim[name]
            if all(abs(geo.verts[i][axis] - value) < 1e-6 for i in idx):
                drop = True
        if not drop:
            keep.f(idx, sm)
    return keep


def transform(geo, m):
    g = Geo()
    g.verts = [tuple(m @ Vector(p)) for p in geo.verts]
    g.faces = list(geo.faces)
    g.smooth = list(geo.smooth)
    if m.to_3x3().determinant() < 0:
        g.faces = [tuple(reversed(f)) for f in g.faces]
    return g


# ---------------------------------------------------------------- parts

class Mesh:
    """geometry of one part, in three.js space, with per face material keys"""

    def __init__(self):
        self.verts = []
        self.faces = []
        self.smooth = []
        self.mat_index = []
        self.mats = []

    def add(self, geo, m=None, key='default'):
        if not geo.faces:
            return self
        if key not in self.mats:
            self.mats.append(key)
        mi = self.mats.index(key)
        g = transform(geo, m) if m is not None else geo
        remap = {}
        for idx, sm in zip(g.faces, g.smooth):
            out = []
            for i in idx:
                if i not in remap:
                    remap[i] = len(self.verts)
                    self.verts.append(g.verts[i])
                out.append(remap[i])
            self.faces.append(tuple(out))
            self.smooth.append(sm)
            self.mat_index.append(mi)
        return self

    def merge(self, other, m=None):
        """append another Mesh (all its materials), transformed by m"""
        for ki, key in enumerate(other.mats):
            g = Geo()
            g.verts = other.verts
            for idx, sm, mi in zip(other.faces, other.smooth, other.mat_index):
                if mi == ki:
                    g.f(idx, sm)
            self.add(g, m, key)
        return self

    def empty(self):
        return not self.faces


class Builder:
    """collects parts into blender objects, grouped in one collection per top level node"""

    def __init__(self, setup, tier, palette_materials):
        self.setup = setup
        self.tier = tier
        self.low = tier == 'low'
        self.materials = palette_materials
        self.objects = []
        self.empties = {}
        self.collections = {}

    def collection(self, group):
        if group not in self.collections:
            col = bpy.data.collections.new(group)
            bpy.context.scene.collection.children.link(col)
            self.collections[group] = col
        return self.collections[group]

    def seg(self, high, low=None):
        """segment count for the tier"""
        if not self.low:
            return high
        return low if low is not None else max(3, int(round(high * 0.5)))

    def part(self, name, group, atlas, mesh, uv_weight=1.0, uv='smart', sharp_deg=35.0):
        if mesh.empty():
            return None
        me = bpy.data.meshes.new(name)
        verts = [tuple(C3 @ Vector(p)) for p in mesh.verts]
        me.from_pydata(verts, [], mesh.faces)
        for key in mesh.mats:
            me.materials.append(self.materials[key])
        mi = [mesh.mat_index[i] for i in range(len(mesh.faces))]
        me.polygons.foreach_set('material_index', mi)
        me.polygons.foreach_set('use_smooth', [bool(s) for s in mesh.smooth])
        me.update()
        mark_sharp(me, sharp_deg)
        obj = bpy.data.objects.new(name, me)
        self.collection(group).objects.link(obj)
        obj['atlas'] = atlas
        obj['group'] = group
        obj['uv_weight'] = float(uv_weight)
        obj['uv_mode'] = uv
        self.objects.append(obj)
        return obj

    def empty(self, name, group, position, rot=None):
        m = C4 @ T(position) @ (rot if rot is not None else Matrix.Identity(4)) @ C4.inverted()
        obj = bpy.data.objects.new(name, None)
        obj.empty_display_type = 'ARROWS'
        obj.empty_display_size = 0.05
        self.collection(group).objects.link(obj)
        obj.matrix_world = m
        obj['group'] = group
        self.empties[name] = obj
        return obj


def mark_sharp(me, deg, clean=True):
    """mark edges sharper than deg as sharp so smooth shading keeps hard corners.
    clean merges coincident verts and drops the zero area faces bevels can leave"""
    bm = bmesh.new()
    bm.from_mesh(me)
    if clean:
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
        bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-7)
        bad = [f for f in bm.faces if f.calc_area() < 1e-12]
        if bad:
            bmesh.ops.delete(bm, geom=bad, context='FACES')
    lim = math.radians(deg)
    for e in bm.edges:
        if len(e.link_faces) == 2:
            a, b = e.link_faces
            if a.normal.angle(b.normal, 0.0) > lim:
                e.smooth = False
        else:
            e.smooth = False
    bm.to_mesh(me)
    bm.free()
