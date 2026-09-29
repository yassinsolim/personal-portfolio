# the desk: matte black top on a black two leg standing desk frame
import math

from mathutils import Matrix

from .common import Mesh, T, rbox, rrect, prism, bevel, box, cylinder


def build(b):
    s = b.setup['desk']
    fr = s['frame']
    w, d, h, t = s['w'], s['d'], s['h'], s['top_t']
    cx, cz = s['x'], s['z']
    low = b.low

    # top: rounded corners in plan and a soft edge
    top = Mesh()
    outline = rrect(w, d, s['corner_r'], b.seg(4, 2))
    slab = prism(outline, h - t, h)
    if s['edge_bevel'] > 0 and not low:
        slab = bevel(slab, s['edge_bevel'], 1,
                     select=lambda e: abs(e.verts[0].co.y - e.verts[1].co.y) < 1e-7)
    top.add(slab, T(cx, 0, cz), 'desk_top')
    b.part('desk_top', 'room_desk', 'setup', top, uv_weight=1.0)

    frame = Mesh()
    under = h - t
    rail_h = fr['rail']['h']
    foot = fr['foot']
    stages = fr['column']
    for side in (-1, 1):
        lx = cx + side * (w / 2 - fr['leg_inset'])
        # foot: a flat bar front to back with tapered ends and small levellers
        fl, fw, fh = foot['l'], foot['w'], foot['h']
        bar = rbox(fw, fh, fl, min(0.008, fh / 3), b.seg(2, 1), skip=('-y',), edges='top_vertical')
        frame.add(bar, T(lx, foot['lift'] + fh / 2, cz), 'frame')
        for fz in (-1, 1):
            frame.add(cylinder(0.012, foot['lift'], b.seg(12, 6), caps=(False, True)),
                      T(lx, foot['lift'] / 2, cz + fz * (fl / 2 - 0.04)), 'frame_dark')
        # three stage column from the foot to the top frame, widest at the bottom
        y0 = foot['lift'] + fh
        y1 = under - rail_h - fr['motor']['h']
        span = (y1 - y0) / len(stages)
        for i, (sw, sd) in enumerate(stages):
            sy0 = y0 + i * span
            sy1 = y0 + (i + 1) * span + (0.02 if i < len(stages) - 1 else 0)
            col = rbox(sw, sy1 - sy0, sd, 0.006, b.seg(2, 1), skip=('-y',), edges='vertical')
            frame.add(col, T(lx, (sy0 + sy1) / 2, cz), 'frame')
        # motor housing on top of the column, under the rail
        mo = fr['motor']
        frame.add(rbox(mo['w'], mo['h'], mo['d'], 0.008, b.seg(2, 1), edges='vertical'),
                  T(lx, under - rail_h - mo['h'] / 2, cz), 'frame')
        # side bracket under the top
        ra = fr['rail']
        frame.add(rbox(ra['w'], ra['h'], ra['l'], 0.004, 1, skip=('+y',)),
                  T(lx, under - ra['h'] / 2, cz), 'frame')
    # crossbeam between the legs, under the top
    be = fr['beam']
    span_x = w - 2 * fr['leg_inset'] - fr['rail']['w']
    frame.add(rbox(span_x, be['h'], be['w'], 0.004, 1, skip=('+y',)),
              T(cx, under - be['h'] / 2, cz + be['z']), 'frame')
    # control box and the height keypad at the front edge
    cb = fr['control_box']
    frame.add(rbox(cb['w'], cb['h'], cb['d'], 0.006, 1, skip=('+y',)),
              T(cb['x'], under - cb['h'] / 2, cb['z']), 'frame')
    kp = fr['keypad']
    kz = cz + d / 2 - kp['inset'] - kp['d'] / 2
    frame.add(rbox(kp['w'], kp['h'], kp['d'], 0.006, b.seg(2, 1), skip=('+y',)),
              T(kp['x'], under - kp['h'] / 2, kz), 'frame')
    # a dark display window on the keypad's front face
    frame.add(box(kp['w'] * 0.32, kp['h'] * 0.45, 0.001, skip=('-z',)),
              T(kp['x'] - kp['w'] * 0.22, under - kp['h'] / 2, kz + kp['d'] / 2 + 0.0005), 'display')
    for i in range(3):
        frame.add(cylinder(0.0045, 0.002, b.seg(10, 6), caps=(False, True)),
                  T(kp['x'] + kp['w'] * (0.02 + 0.13 * i), under - kp['h'] / 2, kz + kp['d'] / 2 + 0.001)
                  @ Matrix.Rotation(math.radians(90), 4, 'X'), 'frame_dark')
    b.part('desk_frame', 'room_desk', 'setup', frame, uv_weight=0.7)

