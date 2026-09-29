# bakes room v2's lighting into its three atlases with cycles (metal gpu).
# per atlas: diffuse light (direct + indirect, no colour) and diffuse colour
# are baked separately; the light is denoised with oidn in the compositor and
# multiplied back by the colour, so card text and edges stay sharp. no glossy.
# screens and leds emit (their light lands on the desk and floor) but are not
# in any atlas; the glass is hidden. 16 px bake margin.
#
#   blender -b <out>/room_v2_<tier>.blend --python scripts/room/bake.py -- \
#       --repo . --out ~/Assets/portfolio-room/v2 --tier high [--atlas setup,pc,shell] \
#       [--samples 128] [--scale 1.0] [--calibrate]
#
# writes <out>/atlas/<tier>_<atlas>.png (8 bit srgb) and raw exrs in <out>/atlas/raw.
# --calibrate bakes the shell small and prints the floor and wall tones next to
# RaceReveal's greys, plus the key strength and shell albedos that hit them.
import argparse
import json
import os
import sys
import time

import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from parts.common import hex_rgb, srgb_to_linear  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--repo', default='.')
ap.add_argument('--out', required=True)
ap.add_argument('--tier', default='high')
ap.add_argument('--atlas', default='setup,pc,shell')
ap.add_argument('--samples', type=int, default=0)
ap.add_argument('--scale', type=float, default=1.0)
ap.add_argument('--calibrate', action='store_true')
args = ap.parse_args(argv)
OUT = os.path.abspath(os.path.expanduser(args.out))
ATLAS_DIR = os.path.join(OUT, 'atlas')
RAW = os.path.join(ATLAS_DIR, 'raw')
os.makedirs(RAW, exist_ok=True)
with open(os.path.join(HERE, 'setup.json')) as fh:
    SETUP = json.load(fh)
scene = bpy.context.scene


def lin(hex_value):
    return [srgb_to_linear(c) for c in hex_rgb(hex_value)]


def to_srgb(x):
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def setup_cycles(samples):
    scene.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type == 'METAL'
    scene.cycles.device = 'GPU'
    scene.cycles.samples = samples
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 6
    scene.cycles.diffuse_bounces = 4
    scene.cycles.glossy_bounces = 0
    scene.cycles.transmission_bounces = 0
    scene.cycles.transparent_max_bounces = 4
    scene.cycles.caustics_reflective = False
    scene.cycles.caustics_refractive = False
    scene.cycles.sample_clamp_indirect = 8.0
    scene.render.bake.margin = SETUP['bake']['margin']
    scene.render.bake.margin_type = 'EXTEND'
    scene.render.bake.use_clear = True
    scene.render.bake.target = 'IMAGE_TEXTURES'
    scene.world = scene.world or bpy.data.worlds.new('bake_world')
    scene.world.color = (0, 0, 0)
    if scene.world.node_tree:
        bg = scene.world.node_tree.nodes.get('Background')
        if bg:
            bg.inputs['Strength'].default_value = 0.0


def area_light(name, size, center, aim, strength, color=(1, 1, 1)):
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    light = bpy.data.lights.new(name, 'AREA')
    light.shape = 'RECTANGLE'
    light.size, light.size_y = size
    light.energy = strength
    light.color = color
    obj = bpy.data.objects.new(name, light)
    scene.collection.objects.link(obj)
    p = Vector((center[0], -center[2], center[1]))
    t = Vector((aim[0], -aim[2], aim[1]))
    d = (t - p).normalized()
    obj.matrix_world = Matrix.Translation(p) @ d.to_track_quat('-Z', 'Y').to_matrix().to_4x4()
    return obj


def lights(ambient=None, key=None):
    """studio lights: a ceiling sized soft ambient, the key over the setup, a low fill from the camera side"""
    li = SETUP['lighting']
    a = li['ambient']
    c = a['center']
    area_light('bake_ambient', a['size'], c, (c[0], 0.0, c[2]), a['strength'] if ambient is None else ambient, a['color'])
    k = li['key']
    c = k['center']
    area_light('bake_key', k['size'], c, (c[0], 0.0, c[2]), k['strength'] if key is None else key, k['color'])
    f = li['fill']
    ks = 1.0 if key is None else (key / max(k['strength'], 1e-9))
    area_light('bake_fill', f['size'], f['center'], f['aim'], f['strength'] * ks)


def shell_albedo(floor=None, wall=None):
    pal = SETUP['palette']
    for key, value in (('floor', floor), ('wall', wall)):
        mat = bpy.data.materials.get(key)
        rgb = value if value is not None else lin(pal[key]['color'])
        bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        bsdf.inputs['Base Color'].default_value = (*rgb, 1.0)


def emitters():
    """screen and led strengths and colour temperatures from setup.json (not from the .blend)"""
    for key in ('screen', 'led'):
        spec = SETUP['palette'][key]
        mat = bpy.data.materials.get(key)
        if not mat:
            continue
        for n in mat.node_tree.nodes:
            if n.type == 'EMISSION':
                n.inputs['Strength'].default_value = spec['strength']
            if n.type == 'BLACKBODY':
                n.inputs['Temperature'].default_value = spec['temp']


def atlas_objects(atlas):
    return [o for o in bpy.data.objects if o.type == 'MESH' and o.get('atlas') == atlas and o.name != 'bake_joined']


def target_image(atlas, size):
    name = f'bake_{atlas}'
    img = bpy.data.images.get(name)
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    return img


def point_materials(objs, img):
    for o in objs:
        for slot in o.material_slots:
            mat = slot.material
            nodes = mat.node_tree.nodes
            tex = nodes.get('bake_target') or nodes.new('ShaderNodeTexImage')
            tex.name = 'bake_target'
            tex.image = img
            tex.select = True
            nodes.active = tex


def select(objs):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def bake(objs, img, passes, samples):
    scene.cycles.samples = samples
    scene.render.bake.use_pass_direct = 'DIRECT' in passes
    scene.render.bake.use_pass_indirect = 'INDIRECT' in passes
    scene.render.bake.use_pass_color = 'COLOR' in passes
    select(objs)
    t = time.time()
    bpy.ops.object.bake(type='DIFFUSE', pass_filter=set(passes), margin=SETUP['bake']['margin'],
                        margin_type='EXTEND', use_clear=True, target='IMAGE_TEXTURES')
    print(f'baked {img.name} {sorted(passes)} {img.size[0]}px {samples} spp in {time.time() - t:.1f}s', flush=True)
    return np.array(img.pixels[:], dtype=np.float32).reshape(img.size[1], img.size[0], 4)[..., :3].copy()


def save_exr(arr, path):
    h, w, _ = arr.shape
    img = bpy.data.images.new('tmp_exr', w, h, alpha=False, float_buffer=True)
    px = np.concatenate([arr, np.ones((h, w, 1), np.float32)], -1)
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = path
    img.file_format = 'OPEN_EXR'
    img.save()
    bpy.data.images.remove(img)


def denoise(arr):
    """oidn through the compositor (image in, image out)"""
    h, w, _ = arr.shape
    src = bpy.data.images.new('dn_src', w, h, alpha=False, float_buffer=True)
    src.pixels.foreach_set(np.concatenate([arr, np.ones((h, w, 1), np.float32)], -1).ravel())
    ng = bpy.data.node_groups.new('dn', 'CompositorNodeTree')
    ng.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
    n_img = ng.nodes.new('CompositorNodeImage')
    n_img.image = src
    n_dn = ng.nodes.new('CompositorNodeDenoise')
    for name, value in (('HDR', True),):
        if name in n_dn.inputs:
            n_dn.inputs[name].default_value = value
    out = ng.nodes.new('NodeGroupOutput')
    ng.links.new(n_img.outputs['Image'], n_dn.inputs['Image'])
    ng.links.new(n_dn.outputs['Image'], out.inputs[0])
    keep = (scene.compositing_node_group, scene.render.engine, scene.render.resolution_x, scene.render.resolution_y,
            scene.render.resolution_percentage, scene.render.use_compositing, scene.render.filepath, scene.camera)
    scene.compositing_node_group = ng
    scene.render.use_compositing = True
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = w, h, 100
    cam = bpy.data.objects.get('dn_cam')
    if cam is None:
        cam = bpy.data.objects.new('dn_cam', bpy.data.cameras.new('dn_cam'))
        scene.collection.objects.link(cam)
    scene.camera = cam
    path = os.path.join(RAW, '_denoise.exr')
    scene.render.image_settings.file_format = 'OPEN_EXR'
    scene.render.filepath = path
    hidden = []
    for o in scene.objects:
        if not o.hide_render and o.type in ('MESH', 'LIGHT'):
            o.hide_render = True
            hidden.append(o)
    bpy.ops.render.render(write_still=True)
    for o in hidden:
        o.hide_render = False
    (scene.compositing_node_group, scene.render.engine, scene.render.resolution_x, scene.render.resolution_y,
     scene.render.resolution_percentage, scene.render.use_compositing, scene.render.filepath, scene.camera) = keep
    res = bpy.data.images.load(path, check_existing=False)
    out_arr = np.array(res.pixels[:], dtype=np.float32).reshape(h, w, 4)[..., :3].copy()
    bpy.data.images.remove(res)
    bpy.data.images.remove(src)
    bpy.data.node_groups.remove(ng)
    return out_arr


def save_png(srgb, path):
    h, w, _ = srgb.shape
    img = bpy.data.images.new('tmp_png', w, h, alpha=False)
    img.colorspace_settings.name = 'sRGB'
    px = np.concatenate([srgb, np.ones((h, w, 1), np.float32)], -1)
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)


def coverage_mask(objs, size):
    """texels covered by uv islands (for reporting and for filling the empty space)"""
    mask = np.zeros((size, size), bool)
    for o in objs:
        me = o.data
        uv = me.uv_layers.get('UVMap')
        me.calc_loop_triangles()
        for tri in me.loop_triangles:
            pts = np.array([uv.data[li].uv for li in tri.loops]) * size
            x0, y0 = np.floor(pts.min(0)).astype(int)
            x1, y1 = np.ceil(pts.max(0)).astype(int)
            x0, y0 = max(x0, 0), max(y0, 0)
            x1, y1 = min(x1, size - 1), min(y1, size - 1)
            if x1 < x0 or y1 < y0:
                continue
            ys, xs = np.mgrid[y0:y1 + 1, x0:x1 + 1]
            px, py = xs + 0.5, ys + 0.5
            (ax, ay), (bx, by), (cx, cy) = pts
            d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
            if abs(d) < 1e-12:
                continue
            l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d
            l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d
            inside = (l1 >= -0.02) & (l2 >= -0.02) & (l1 + l2 <= 1.02)
            mask[y0:y1 + 1, x0:x1 + 1] |= inside
    return mask


def joined_copy(objs):
    """one temporary object holding every part of an atlas. blender applies the bake margin
    per object, so separate parts would paint their margins over each other's islands"""
    copies = []
    for o in objs:
        c = o.copy()
        c.data = o.data.copy()
        scene.collection.objects.link(c)
        copies.append(c)
    select(copies)
    if len(copies) > 1:
        bpy.ops.object.join()
    tmp = bpy.context.view_layer.objects.active
    uv = tmp.data.uv_layers.get('UVMap')
    tmp.data.uv_layers.active = uv
    uv.active_render = True
    tmp.name = 'bake_joined'
    return tmp


def run_atlas(atlas, size, samples):
    objs = atlas_objects(atlas)
    img = target_image(atlas, size)
    tmp = joined_copy(objs)
    for o in objs:
        o.hide_render = True
    point_materials([tmp], img)
    light = bake([tmp], img, {'DIRECT', 'INDIRECT'}, samples)
    color = bake([tmp], img, {'COLOR'}, 4)
    for o in objs:
        o.hide_render = False
    bpy.data.objects.remove(tmp, do_unlink=True)
    save_exr(light, os.path.join(RAW, f'{args.tier}_{atlas}_light.exr'))
    save_exr(color, os.path.join(RAW, f'{args.tier}_{atlas}_color.exr'))
    t = time.time()
    light_dn = denoise(light)
    print(f'denoised {atlas} in {time.time() - t:.1f}s', flush=True)
    save_exr(light_dn, os.path.join(RAW, f'{args.tier}_{atlas}_light_dn.exr'))
    final = color * light_dn * SETUP['lighting']['exposure']
    srgb = to_srgb(final)
    path = os.path.join(ATLAS_DIR, f'{args.tier}_{atlas}.png')
    save_png(srgb, path)
    print('wrote', path, flush=True)
    return final


# ---------------------------------------------------------------- shell tones

def shell_samples(obj, final_lin, size):
    """mean linear colour of the baked shell on the floor ring around the car and on the walls"""
    from mathutils.bvhtree import BVHTree
    me = obj.data
    me.calc_loop_triangles()
    verts = [obj.matrix_world @ v.co for v in me.vertices]
    tris = [tuple(t.vertices) for t in me.loop_triangles]
    loops = [tuple(t.loops) for t in me.loop_triangles]
    bvh = BVHTree.FromPolygons(verts, tris)
    uv = me.uv_layers['UVMap'].data
    U = SETUP['units']['per_metre']
    FY = SETUP['units']['floor_y']
    from mathutils.geometry import barycentric_transform

    def sample(origin, direction):
        loc, n, idx, d = bvh.ray_cast(origin, direction)
        if loc is None:
            return None
        a, b, c = (verts[i] for i in tris[idx])
        ua, ub, uc = (uv[l].uv for l in loops[idx])
        p = barycentric_transform(loc, a, b, c, Vector((ua[0], ua[1], 0)), Vector((ub[0], ub[1], 0)), Vector((uc[0], uc[1], 0)))
        x = min(size - 1, max(0, int(p.x * size)))
        y = min(size - 1, max(0, int(p.y * size)))
        return final_lin[y, x]

    def room(p3):
        return Vector((p3[0] / U, -p3[2] / U, (p3[1] - FY) / U))
    car = SETUP['car_box_three']
    x0, x1 = car['min'][0], car['max'][0]
    z0, z1 = car['min'][2], car['max'][2]
    margin = 1.5 * U
    ring, inside = [], []
    for x in np.linspace(x0 - margin, x1 + margin, 24):
        for z in np.linspace(z0 - margin, z1 + margin, 16):
            v = sample(room((x, 2000, z)), Vector((0, 0, -1)))
            if v is None:
                continue
            if x0 <= x <= x1 and z0 <= z <= z1:
                inside.append(v)
            else:
                ring.append(v)
    walls = []
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    for d in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        for y in (1000, 4000, 8000, 12000):
            for off in (-6000, 0, 6000):
                o = room((cx + (off if d[0] == 0 else 0), y, cz + (off if d[1] == 0 else 0)))
                v = sample(o, Vector((d[0], -d[1], 0)))
                if v is not None:
                    walls.append(v)
    return np.mean(ring, 0), np.mean(inside, 0), np.mean(walls, 0)


def calibrate():
    """bake the shell with the ambient alone and the key alone, then solve both strengths so a
    0.62 albedo floor and wall land on RaceReveal's greys; per channel albedos take the tint"""
    obj = atlas_objects('shell')[0]
    size = 256
    shell_albedo([0.62] * 3, [0.62] * 3)
    img = target_image('shell', size)
    point_materials([obj], img)
    comps = {}
    for name, amb, key in (('ambient', 1000.0, 0.0), ('key', 0.0, 1000.0)):
        lights(ambient=amb, key=key)
        light = bake([obj], img, {'DIRECT', 'INDIRECT'}, 48)
        ring, inside, walls = shell_samples(obj, light, size)
        comps[name] = (ring, walls)
        print('CALIBRATE', name, 'light at ring', ring.round(4), 'walls', walls.round(4))
    tf = np.array([srgb_to_linear(c) for c in SETUP['lighting']['targets_srgb']['floor']])
    tw = np.array([srgb_to_linear(c) for c in SETUP['lighting']['targets_srgb']['wall']])
    fa, wa = comps['ambient'][0].mean(), comps['ambient'][1].mean()
    fk, wk = comps['key'][0].mean(), comps['key'][1].mean()
    m = np.array([[fa, fk], [wa, wk]]) * 0.62
    amb, key = np.linalg.solve(m, [tf.mean(), tw.mean()])
    print('CALIBRATE solved (per 1000 W) ambient', round(float(amb), 4), 'key', round(float(key), 4))
    amb, key = max(float(amb), 0.0), max(float(key), 0.0)
    lf = comps['ambient'][0] * amb + comps['key'][0] * key
    lw = comps['ambient'][1] * amb + comps['key'][1] * key
    print('CALIBRATE ambient W', round(amb * 1000, 1), 'key W', round(key * 1000, 1))
    print('CALIBRATE floor albedo', (tf / lf).round(4).tolist(), 'wall albedo', (tw / lw).round(4).tolist())


if __name__ == '__main__':
    SAMPLES = args.samples or SETUP['bake']['samples'][args.tier]
    setup_cycles(SAMPLES)
    for o in bpy.data.objects:
        if o.type == 'MESH' and o.get('atlas') == 'glass':
            o.hide_render = True
    if args.calibrate:
        calibrate()
        sys.exit(0)
    lights()
    emitters()
    cal = SETUP['lighting'].get('shell_albedo')
    if cal:
        shell_albedo(cal['floor'], cal['wall'])
    sizes = SETUP['bake']['atlas'][args.tier]
    report = {}
    for atlas in args.atlas.split(','):
        size = int(sizes[atlas] * args.scale)
        final = run_atlas(atlas, size, SAMPLES)
        objs = atlas_objects(atlas)
        report[atlas] = {'size': size, 'coverage': float(coverage_mask(objs, size).mean())}
        if atlas == 'shell':
            ring, inside, walls = shell_samples(objs[0], final, size)
            report['shell_tones_srgb'] = {
                'floor_ring': [round(float(v), 3) for v in to_srgb(ring)],
                'floor_under_car': [round(float(v), 3) for v in to_srgb(inside)],
                'walls': [round(float(v), 3) for v in to_srgb(walls)],
                'targets': SETUP['lighting']['targets_srgb'],
            }
    print('BAKEREPORT', json.dumps(report))
    with open(os.path.join(ATLAS_DIR, f'{args.tier}_report.json'), 'w') as fh:
        json.dump(report, fh, indent=1)
