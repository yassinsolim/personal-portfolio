# three identical 27 inch 16:9 oleds: slim panel, rear bulge, thin bezels.
# the active areas (m1_screen, m2_screen, m3_screen) are single quads placed
# exactly where the site expects them
from mathutils import Vector

from .common import Geo, Mesh, T, rot3, box, rbox, bevel


def screen_frame(entry):
    """rotation of the screen as the viewer reads it (no portrait roll)"""
    return rot3(yaw=entry.get('yaw', 0.0), tilt=entry.get('tilt', 0.0))


def active_size(setup, entry):
    aw, ah = setup['screens']['active']
    return (ah, aw) if entry.get('portrait') else (aw, ah)


def panel(b):
    """one monitor body in its landscape frame, origin at the active area centre"""
    m = b.setup['monitor']
    aw, ah = b.setup['screens']['active']
    bz = m['bezel']
    pt = m['panel_t']
    x0, x1 = -aw / 2 - bz['side'], aw / 2 + bz['side']
    y0, y1 = -ah / 2 - bz['chin'], ah / 2 + bz['top']
    mesh = Mesh()
    # slim panel slab: sharp front edge, rounded back edge
    slab = box(x1 - x0, y1 - y0, pt, skip=('+z',))
    zb = -pt / 2 + 1e-7

    def back_edge(e):
        return e.verts[0].co.z < zb and e.verts[1].co.z < zb
    slab = bevel(slab, m['edge_bevel'], b.seg(2, 1), select=back_edge)
    mesh.add(slab, T((x0 + x1) / 2, (y0 + y1) / 2, -pt / 2), 'monitor')
    # front: the bezel ring around the active area, flush with the screen quad
    g = Geo()
    outer = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    inner = [(-aw / 2, -ah / 2), (aw / 2, -ah / 2), (aw / 2, ah / 2), (-aw / 2, ah / 2)]
    for x, y in outer + inner:
        g.v((x, y, 0.0))
    for k in range(4):
        j = (k + 1) % 4
        g.f((k, j, 4 + j, 4 + k))
    mesh.add(g, None, 'monitor')
    # black backing a hair behind the screen quad, in case the quad is hidden
    g = Geo()
    for x, y in inner:
        g.v((x, y, -0.0005))
    g.f((0, 1, 2, 3))
    mesh.add(g, None, 'screen_back')
    # rear housing (electronics and the vesa mount)
    bu = m['bulge']
    housing = rbox(bu['w'], bu['h'], bu['d'], bu['bevel'], b.seg(3, 1), skip=('+z',))
    mesh.add(housing, T(0, bu['y'], -pt - bu['d'] / 2), 'monitor')
    # small cable cover at the bottom of the housing
    mesh.add(rbox(bu['w'] * 0.45, 0.012, bu['d'] * 0.7, 0.004, 1, skip=('+z',)),
             T(0, bu['y'] - bu['h'] / 2 + 0.004, -pt - bu['d'] * 0.35), 'monitor')
    return mesh


def build(b):
    setup = b.setup
    m = setup['monitor']
    body = panel(b)
    b.vesa = {}
    desk_mesh = Mesh()
    for name in ('m1', 'm2', 'm3'):
        entry = setup['screens'][name]
        c = Vector(entry['center'])
        rs = screen_frame(entry)
        rb = rot3(yaw=entry.get('yaw', 0.0), tilt=entry.get('tilt', 0.0),
                  roll=-90.0 if entry.get('portrait') else 0.0)
        desk_mesh.merge(body, T(c) @ rb)
        # vesa centre on the housing's back and the plate's facing (away from the screen)
        pt = m['panel_t']
        bu = m['bulge']
        local = Vector((0.0, bu['y'], -pt - bu['d']))
        b.vesa[name] = {
            'point': c + (rb.to_3x3() @ local),
            'back': rb.to_3x3() @ Vector((0, 0, -1)),
            'up': rs.to_3x3() @ Vector((0, 1, 0)),
            'right': rs.to_3x3() @ Vector((1, 0, 0)),
            'rot': rb,
        }
        # the screen quad: exactly the active area, u right and v up as read
        sw, sh = active_size(setup, entry)
        q = Geo()
        for x, y in ((-sw / 2, -sh / 2), (sw / 2, -sh / 2), (sw / 2, sh / 2), (-sw / 2, sh / 2)):
            q.v((x, y, 0.0))
        q.f((0, 1, 2, 3))
        quad = Mesh().add(q, T(c) @ rs, 'screen')
        obj = b.part(f'{name}_screen', 'room_desk', 'screen', quad, uv='screen')
        set_screen_uv(obj)
    b.part('monitors', 'room_desk', 'setup', desk_mesh, uv_weight=0.8)


def set_screen_uv(obj):
    """u right, v up in the exported gltf. blender's exporter flips v, so v is stored upside down"""
    me = obj.data
    uv = me.uv_layers.new(name='UVMap')
    corners = [(0.0, 1.0), (1.0, 1.0), (1.0, 0.0), (0.0, 0.0)]  # bottom left, bottom right, top right, top left
    poly = me.polygons[0]
    for li, vi in zip(poly.loop_indices, poly.vertices):
        uv.data[li].uv = corners[vi]
