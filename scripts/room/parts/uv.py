# atlas uvs: smart project per part, equal texel density, then per part and
# per island weights (the credits card and keyboard get more texels, faces
# that only point at the floor get fewer), then one pack per atlas. the
# shell's floor gets a warped planar map that spends more texels near the
# setup and the car
import math

import bmesh
import bpy
from mathutils import Vector


def _select_only(objs):
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def _uv_layer(me, name='UVMap'):
    layer = me.uv_layers.get(name) or me.uv_layers.new(name=name)
    me.uv_layers.active = layer
    layer.active_render = True
    return layer


def islands(bm, uv, faces):
    """uv islands (lists of faces) among faces"""
    fs = set(faces)
    parent = {f: f for f in fs}

    def find(a):
        while parent[a] is not a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for f in fs:
        for l in f.loops:
            a0, a1 = l[uv].uv, l.link_loop_next[uv].uv
            for l2 in l.edge.link_loops:
                if l2.face is f or l2.face not in fs:
                    continue
                if l2.vert is l.vert:
                    b0, b1 = l2[uv].uv, l2.link_loop_next[uv].uv
                else:
                    b0, b1 = l2.link_loop_next[uv].uv, l2[uv].uv
                if (a0 - b0).length < 1e-6 and (a1 - b1).length < 1e-6:
                    ra, rb = find(f), find(l2.face)
                    if ra is not rb:
                        parent[ra] = rb
    groups = {}
    for f in fs:
        groups.setdefault(find(f), []).append(f)
    return list(groups.values())


def warp(lo, hi, center, sigma, gain):
    """monotonic map [lo, hi] -> [0, 1] with gain times more texels around center"""
    k = gain * sigma * math.sqrt(math.pi) / 2

    def raw(x):
        return (x - lo) + k * (math.erf((x - center) / sigma) - math.erf((lo - center) / sigma))
    total = raw(hi)
    return lambda x: raw(x) / total


def shell_floor_uv(obj, setup):
    """planar, warped map for the flat floor (material 0). room metres: x, z = -blender y"""
    sh = setup['shell']['warp']
    me = obj.data
    _uv_layer(me)
    bm = bmesh.new()
    bm.from_mesh(me)
    layer = bm.loops.layers.uv.verify()
    floor = [f for f in bm.faces if f.material_index == 0]
    xs = [v.co.x for f in floor for v in f.verts]
    zs = [-v.co.y for f in floor for v in f.verts]
    fx = warp(min(xs), max(xs), sh['center'][0], sh['sigma'][0], sh['gain'])
    fz = warp(min(zs), max(zs), sh['center'][1], sh['sigma'][1], sh['gain'])
    for f in floor:
        for l in f.loops:
            # u along +x, v along -z (away from the chair) so the island reads like a plan view
            l[layer].uv = (fx(l.vert.co.x), 1.0 - fz(-l.vert.co.y))
    bm.to_mesh(me)
    bm.free()


def card_uv(obj):
    """CardUV: the card's top face to 0..1, text upright for someone at the chair (+z)"""
    me = obj.data
    layer = me.uv_layers.get('CardUV') or me.uv_layers.new(name='CardUV')
    main = me.uv_layers.get('UVMap')
    if main:
        me.uv_layers.active = main
        main.active_render = True
    mw = obj.matrix_world
    top = max(me.polygons, key=lambda p: (mw.to_3x3() @ p.normal).z)
    xs = [(mw @ me.vertices[i].co) for i in top.vertices]
    c = sum(xs, Vector()) / len(xs)
    # pick the longest top edge direction as the card's depth (reading) axis
    edges = [(xs[(i + 1) % len(xs)] - xs[i]) for i in range(len(xs))]
    depth = max(edges, key=lambda e: e.length).normalized()
    if depth.y < 0:
        depth = -depth
    across = depth.cross(Vector((0, 0, 1))).normalized()
    w = max(abs((p - c).dot(across)) for p in xs) * 2
    d = max(abs((p - c).dot(depth)) for p in xs) * 2
    for li, vi in zip(top.loop_indices, top.vertices):
        p = mw @ me.vertices[vi].co - c
        layer.data[li].uv = (0.5 + p.dot(across) / w, 0.5 + p.dot(depth) / d)
    for poly in me.polygons:
        if poly.index != top.index:
            for li in poly.loop_indices:
                layer.data[li].uv = (0.0, 0.0)


def keys_uv(obj):
    """keycaps (material 'key'): a top down projection, so each cap is one island"""
    me = obj.data
    key = next((i for i, m in enumerate(me.materials) if m and m.get('key') == 'key'), None)
    if key is None:
        return
    bm = bmesh.new()
    bm.from_mesh(me)
    layer = bm.loops.layers.uv['UVMap']
    mw = obj.matrix_world
    for f in bm.faces:
        if f.material_index == key:
            for l in f.loops:
                p = mw @ l.vert.co
                l[layer].uv = (p.x, p.y)
    bm.to_mesh(me)
    bm.free()


def unwrap(objs, setup, atlas, size):
    """unwrap and pack every object of one atlas into UVMap"""
    uvs = setup['uv']
    for o in objs:
        _uv_layer(o.data)
    _select_only(objs)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_mode(type='FACE')
    for o in objs:
        bm = bmesh.from_edit_mesh(o.data)
        mode = o.get('uv_mode', 'smart')
        for f in bm.faces:
            f.select = not (mode == 'shell' and f.material_index == 0)
            if mode == 'shell' and f.material_index == 1 and f.normal.z < -0.5:
                f.select = False  # ceiling: its own pass below
        bmesh.update_edit_mesh(o.data)
    bpy.ops.uv.smart_project(angle_limit=math.radians(uvs['angle']), island_margin=0.0, area_weight=0.0,
                             correct_aspect=False, scale_to_bounds=False)
    shells = [o for o in objs if o.get('uv_mode') == 'shell']
    if shells:
        for o in objs:
            bm = bmesh.from_edit_mesh(o.data)
            for f in bm.faces:
                f.select = o.get('uv_mode') == 'shell' and f.material_index == 1 and f.normal.z < -0.5
            bmesh.update_edit_mesh(o.data)
        bpy.ops.uv.smart_project(angle_limit=math.radians(uvs['angle']), island_margin=0.0, area_weight=0.0,
                                 correct_aspect=False, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    for o in shells:
        shell_floor_uv(o, setup)
    for o in objs:
        if o.get('uv_mode') == 'keys':
            keys_uv(o)
    for o in objs:
        if o.get('uv_mode') == 'card':
            card_uv(o)
    # equal texel density everywhere, then the weights
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode='OBJECT')
    down_w = uvs['down_weight']
    for o in objs:
        me = o.data
        bm = bmesh.new()
        bm.from_mesh(me)
        layer = bm.loops.layers.uv['UVMap']
        mw3 = o.matrix_world.to_3x3()
        for isl in islands(bm, layer, bm.faces):
            w = float(o.get('uv_weight', 1.0))
            area = sum(f.calc_area() for f in isl)
            n = sum(((mw3 @ f.normal) * f.calc_area() for f in isl), Vector()) / max(area, 1e-12)
            if o.get('uv_mode') == 'shell':
                mat = isl[0].material_index
                if mat == 1:
                    w *= setup['shell']['uv_wall'] if n.z > -0.5 else setup['shell']['uv_ceiling']
            elif n.z < -0.7:
                w *= down_w
            elif n.y > 0.7:
                w *= uvs['back_weight']
            elif atlas == 'pc' and n.x > 0.7:
                w *= uvs['pc_right_weight']
            k = math.sqrt(max(w, 1e-6))
            c = Vector((0.0, 0.0))
            cnt = 0
            for f in isl:
                for l in f.loops:
                    c += l[layer].uv
                    cnt += 1
            c /= max(cnt, 1)
            for f in isl:
                for l in f.loops:
                    l[layer].uv = c + (l[layer].uv - c) * k
        bm.to_mesh(me)
        bm.free()
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(udim_source='CLOSEST_UDIM', rotate=True, rotate_method='ANY', scale=True,
                            merge_overlap=False, margin_method='FRACTION', margin=uvs['gap_px'] / 2 / size,
                            pin=False, shape_method='CONCAVE')
    bpy.ops.object.mode_set(mode='OBJECT')
    return stats(objs, size)


def stats(objs, size):
    """packed uv coverage and texel density (px per metre) per object"""
    out = {}
    total_uv = 0.0
    for o in objs:
        me = o.data
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.transform(o.matrix_world)
        layer = bm.loops.layers.uv['UVMap']
        a3 = a2 = 0.0
        for f in bm.faces:
            a3 += f.calc_area()
            uvs = [l[layer].uv for l in f.loops]
            s = 0.0
            for i in range(1, len(uvs) - 1):
                s += abs((uvs[i] - uvs[0]).cross(uvs[i + 1] - uvs[0])) / 2
            a2 += s
        bm.free()
        total_uv += a2
        out[o.name] = {'px_per_m': round(math.sqrt(a2 / max(a3, 1e-12)) * size, 1), 'uv_area': round(a2, 4)}
    out['_coverage'] = round(total_uv, 3)
    return out
