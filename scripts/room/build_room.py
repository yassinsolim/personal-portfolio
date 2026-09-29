# room v2: builds the baked room's geometry from scripts/room/setup.json.
# parametric parts (parts/*.py), today's studio backdrop, atlas uvs, and a
# .blend per tier (outside the repo). --greybox also writes the greybox glb
# with the final node names, flat materials and site units.
#
#   blender -b --factory-startup --python scripts/room/build_room.py -- \
#       --repo . --out ~/Assets/portfolio-room/v2 [--tier high|low] [--greybox] \
#       [--no-uv] [--check] [--chair x,z,yaw]
import argparse
import json
import math
import os
import subprocess
import sys

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from parts import arms, chair, common, desk, keyboard, materials, monitors, pc_nv5, props, shell, uv  # noqa: E402
import exporter  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--repo', default='.')
ap.add_argument('--out', required=True)
ap.add_argument('--tier', default='high', choices=('high', 'low'))
ap.add_argument('--greybox', action='store_true')
ap.add_argument('--no-uv', action='store_true')
ap.add_argument('--check', action='store_true')
ap.add_argument('--chair', default='')
args = ap.parse_args(argv)
REPO = os.path.abspath(os.path.expanduser(args.repo))
OUT = os.path.abspath(os.path.expanduser(args.out))
os.makedirs(OUT, exist_ok=True)

with open(os.path.join(HERE, 'setup.json')) as fh:
    SETUP = json.load(fh)
if args.chair:
    x, z, yaw = (float(v) for v in args.chair.split(','))
    SETUP['chair'].update({'x': x, 'z': z, 'yaw': yaw})


def card_texture():
    path = os.path.join(OUT, 'textures', 'card.png')
    script = os.path.join(HERE, 'card_texture.py')
    if not os.path.exists(path) or os.path.getmtime(path) < os.path.getmtime(script):
        subprocess.run(['python3', script, '--repo', REPO, '--out', path], check=True)
    return path


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'
    card = materials.load_card(card_texture())
    mats = materials.make(SETUP, card)
    b = common.Builder(SETUP, args.tier, mats)
    desk.build(b)
    monitors.build(b)
    arms.build(b)
    pc_nv5.build(b)
    keyboard.build(b)
    props.build(b)
    chair.build(b)
    shell.build(b, REPO)
    for o in b.objects:
        if o.get('atlas') == 'shell':
            for p in o.data.polygons:
                p.use_smooth = p.material_index == 1
            common.mark_sharp(o.data, 50.0)
    return b


def room_point(p):
    return common.C3 @ Vector(p)


def sightlines(b):
    """fraction of sample points each camera sees on the pc glass, screens, keyboard and mouse"""
    U = SETUP['units']['per_metre']
    fy = SETUP['units']['floor_y']

    def from_three(p):
        return (p[0] / U, (p[1] - fy) / U, p[2] / U)
    cams = {
        'default': from_three((-19977, 9016, 20000)),
        'idle_proposed': from_three(tuple(f + 0.72 * (c - t) for f, c, t in zip((300, -1400, -1200), (-19977, 9016, 20000), (0, -1000, 0)))),
        'front': from_three((0, 10200, 24000)),
        'idle_right': from_three((19990, 9650, 20000)),
        'desk': (0.10, 1.52, 1.62),
    }
    trees = []
    for o in b.objects:
        if o.name in ('pc_glass', 'pc_leds') or o.get('atlas') == 'shell':
            continue
        deps = bpy.context.evaluated_depsgraph_get()
        trees.append((o.name, BVHTree.FromObject(o, deps)))
    pc = SETUP['pc']
    W, H, D = pc['case']['w'], pc['case']['h'], pc['case']['d']
    targets = {}
    pts = []
    for i in range(8):
        for j in range(6):
            zz = pc['z'] - D / 2 + D * (i + 0.5) / 8
            yy = pc['base_h'] + (H - pc['base_h'] - pc['top_t']) * (j + 0.5) / 6
            pts.append((pc['x'] - W / 2 - 0.001, yy, zz))
    targets['pc_side_glass'] = (pts, set())
    pts = []
    for i in range(5):
        for j in range(6):
            xx = pc['x'] - W / 2 + W * (i + 0.5) / 5
            yy = pc['base_h'] + (H - pc['base_h'] - pc['top_t']) * (j + 0.5) / 6
            pts.append((xx, yy, pc['z'] + D / 2 + 0.001))
    targets['pc_front_glass'] = (pts, set())
    for name in ('m1', 'm2', 'm3'):
        e = SETUP['screens'][name]
        sw, sh = monitors.active_size(SETUP, e)
        r = monitors.screen_frame(e).to_3x3()
        c = Vector(e['center'])
        pts = [tuple(c + r @ Vector((sw * (i / 5 - 0.5), sh * (j / 3 - 0.5), 0.002))) for i in range(6) for j in range(4)]
        targets[name] = (pts, {f'{name}_screen', 'monitors'})
    k = SETUP['keyboard']
    targets['keyboard'] = ([(k['x'] + dx, SETUP['desk']['h'] + 0.035, k['z'] + dz) for dx in (-0.12, -0.04, 0.04, 0.12) for dz in (-0.03, 0.03)], {'keyboard'})
    m = SETUP['mouse']
    targets['mouse'] = ([(m['x'] + dx, SETUP['desk']['h'] + 0.04, m['z'] + dz) for dx in (-0.015, 0.015) for dz in (-0.03, 0.0, 0.03)], {'mouse'})
    report = {}
    for cam, cp in cams.items():
        origin = room_point(cp)
        row = {}
        for tname, (pts, own) in targets.items():
            seen = 0
            for p in pts:
                tp = room_point(p)
                d = tp - origin
                dist = d.length
                d.normalize()
                blocked = None
                for name, tree in trees:
                    if name in own:
                        continue
                    hit = tree.ray_cast(origin, d, dist - 1e-3)
                    if hit[0] is not None:
                        blocked = name
                        break
                seen += blocked is None
            row[tname] = round(seen / len(pts), 2)
        report[cam] = row
    print('SIGHTLINES', json.dumps(report))
    return report


def flipper_clearance(b):
    """rays down over the flipper spot's clear zone: anything above the desk top is in the way"""
    fl = SETUP['flipper_spot']
    top = SETUP['desk']['h']
    cw, cd = fl['clear']
    a = math.radians(fl['yaw'])
    deps = bpy.context.evaluated_depsgraph_get()
    trees = [(o.name, BVHTree.FromObject(o, deps)) for o in b.objects if o.name != 'desk_top' and o.get('atlas') != 'shell']
    hits = {}
    n = 0
    for i in range(15):
        for j in range(9):
            lx, lz = cw * (i / 14 - 0.5), cd * (j / 8 - 0.5)
            x = fl['x'] + lx * math.cos(a) + lz * math.sin(a)
            z = fl['z'] - lx * math.sin(a) + lz * math.cos(a)
            origin = room_point((x, top + 0.5, z))
            n += 1
            for name, tree in trees:
                loc, _, _, d = tree.ray_cast(origin, room_point((0, -1, 0)), 0.5 - 0.0005)
                if loc is not None:
                    hits[name] = hits.get(name, 0) + 1
    print('FLIPPER_CLEAR', json.dumps({'samples': n, 'blocked': hits}))
    return hits


if __name__ == '__main__':
    b = build()
    if args.check:
        sightlines(b)
        flipper_clearance(b)
    if not args.no_uv:
        sizes = SETUP['bake']['atlas'][args.tier]
        allstats = {}
        for atlas in ('setup', 'pc', 'shell'):
            objs = [o for o in b.objects if o.get('atlas') == atlas]
            allstats[atlas] = uv.unwrap(objs, SETUP, atlas, sizes[atlas])
        print('UVSTATS', json.dumps(allstats))
        with open(os.path.join(OUT, f'uvstats_{args.tier}.json'), 'w') as fh:
            json.dump(allstats, fh, indent=1)
    path = os.path.join(OUT, f'room_v2_{args.tier}.blend')
    bpy.ops.wm.save_as_mainfile(filepath=path)
    print('saved', path)
    if args.greybox:
        glb = os.path.join(OUT, 'room_v2_greybox.glb' if args.tier == 'high' else 'room_v2_greybox.low.glb')
        exporter.export(SETUP, glb, textures=None)
        print('greybox', glb)
