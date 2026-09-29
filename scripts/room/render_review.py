# review renders of room v2 with the amg one placed the way World/Car.ts does
# (same math as blockout.py). --look solid is a quick workbench pass with the
# palette colours; --look baked draws every baked part with its atlas as an
# emitter (what MeshBasicMaterial shows on the site), screens as flat colours.
#
#   blender -b <out>/room_v2_high.blend --python scripts/room/render_review.py -- \
#       --repo . --out ~/Assets/portfolio-room/v2/renders [--look solid|baked] \
#       [--atlas-dir <out>/atlas] [--tier high] [--views default,idle,desk,pc,props] [--width 1600]
import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--repo', default='.')
ap.add_argument('--out', required=True)
ap.add_argument('--look', default='solid', choices=('solid', 'baked'))
ap.add_argument('--atlas-dir', default='')
ap.add_argument('--tier', default='high')
ap.add_argument('--views', default='default,idle,desk,pc,props')
ap.add_argument('--width', type=int, default=1600)
ap.add_argument('--samples', type=int, default=32)
ap.add_argument('--no-car', action='store_true')
ap.add_argument('--tag', default='')
ap.add_argument('--glb', default='', help='render this exported room glb (site units) instead of the blend parts')
args = ap.parse_args(argv)
REPO = os.path.abspath(os.path.expanduser(args.repo))
OUT = os.path.abspath(os.path.expanduser(args.out))
os.makedirs(OUT, exist_ok=True)
with open(os.path.join(HERE, 'setup.json')) as fh:
    SETUP = json.load(fh)
U = SETUP['units']['per_metre']
FY = SETUP['units']['floor_y']
CAR_POSITION = (-2400.0, 0.0, -7600.0)
CAR_SCALE = 27.0
CAR_GROUND_Y = -2995.0
scene = bpy.context.scene


def bl(p):
    """room metres (three.js axes) to blender"""
    return Vector((p[0], -p[2], p[1]))


def from_three(p):
    return ((p[0]) / U, (p[1] - FY) / U, p[2] / U)


def world_bounds(objs):
    lo = Vector((1e9,) * 3)
    hi = Vector((-1e9,) * 3)
    for o in objs:
        if o.type != 'MESH':
            continue
        for c in o.bound_box:
            p = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, p))
            hi = Vector(map(max, hi, p))
    return lo, hi


def add_car():
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=f'{REPO}/static/models/Cars/mercedes_amg_project_one/source/mercedes_amg_project_one.glb')
    objs = [o for o in bpy.data.objects if o not in before]
    root = bpy.data.objects.new('CAR', None)
    scene.collection.objects.link(root)
    for o in objs:
        if o.parent is None:
            o.parent = root
    root.matrix_world = Matrix.Rotation(math.radians(-90), 4, 'Z') @ Matrix.Diagonal((CAR_SCALE / U,) * 3 + (1,))
    bpy.context.view_layer.update()
    lo, hi = world_bounds(objs)
    length_units = (hi.x - lo.x) * U
    car_x = CAR_POSITION[0] + length_units / 3
    car_y = CAR_GROUND_Y - lo.z * U
    root.matrix_world = Matrix.Translation(bl(from_three((car_x, car_y, CAR_POSITION[2])))) @ root.matrix_world
    bpy.context.view_layer.update()
    lo, hi = world_bounds(objs)
    print('car box three', [round(lo.x * U), round(lo.z * U + FY), round(-hi.y * U)], [round(hi.x * U), round(hi.z * U + FY), round(-lo.y * U)])
    return objs


def emit_material(name, image_path=None, color=None, strength=1.0):
    mat = bpy.data.materials.new(name)
    if mat.node_tree is None:
        mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    for n in list(nodes):
        nodes.remove(n)
    out = nodes.new('ShaderNodeOutputMaterial')
    em = nodes.new('ShaderNodeEmission')
    em.inputs['Strength'].default_value = strength
    if image_path:
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = bpy.data.images.load(image_path, check_existing=True)
        tex.interpolation = 'Linear'
        uvn = nodes.new('ShaderNodeUVMap')
        uvn.uv_map = 'UVMap'
        links.new(uvn.outputs['UV'], tex.inputs['Vector'])
        links.new(tex.outputs['Color'], em.inputs['Color'])
    else:
        em.inputs['Color'].default_value = (*color, 1.0)
    links.new(em.outputs['Emission'], out.inputs['Surface'])
    return mat


def glass_material():
    mat = bpy.data.materials.new('review_glass')
    if mat.node_tree is None:
        mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    for n in list(nodes):
        nodes.remove(n)
    out = nodes.new('ShaderNodeOutputMaterial')
    tr = nodes.new('ShaderNodeBsdfTransparent')
    gl = nodes.new('ShaderNodeBsdfGlossy')
    gl.inputs['Roughness'].default_value = 0.05
    gl.inputs['Color'].default_value = (1, 1, 1, 1)
    fr = nodes.new('ShaderNodeLayerWeight')
    fr.inputs['Blend'].default_value = 0.15
    mix = nodes.new('ShaderNodeMixShader')
    links.new(fr.outputs['Fresnel'], mix.inputs['Fac'])
    links.new(tr.outputs['BSDF'], mix.inputs[1])
    links.new(gl.outputs['BSDF'], mix.inputs[2])
    links.new(mix.outputs['Shader'], out.inputs['Surface'])
    try:
        mat.surface_render_method = 'BLENDED'
    except AttributeError:
        pass
    return mat


PLACEHOLDER = {'m1_screen': (0.10, 0.25, 0.75), 'm2_screen': (0.08, 0.42, 0.40), 'm3_screen': (0.05, 0.05, 0.06)}


def baked_look():
    atlas_dir = args.atlas_dir or os.path.join(os.path.dirname(bpy.data.filepath), 'atlas')
    mats = {a: emit_material(f'review_{a}', os.path.join(atlas_dir, f'{args.tier}_{a}.png')) for a in ('setup', 'pc', 'shell')}
    led = emit_material('review_led', color=(0.86, 0.92, 1.0), strength=3.0)
    glass = glass_material()
    for o in bpy.data.objects:
        if o.type != 'MESH' or 'atlas' not in o:
            continue
        a = o['atlas']
        if a in mats:
            mat = mats[a]
        elif a == 'led':
            mat = led
        elif a == 'glass':
            mat = glass
        elif a == 'screen':
            mat = emit_material(f'review_{o.name}', color=PLACEHOLDER.get(o.name, (0.1, 0.1, 0.1)))
        else:
            continue
        o.data.materials.clear()
        o.data.materials.append(mat)
    scene.render.engine = 'BLENDER_EEVEE'
    ee = scene.eevee
    for attr, value in (('taa_render_samples', args.samples), ('use_shadows', True), ('use_raytracing', False)):
        if hasattr(ee, attr):
            setattr(ee, attr, value)
    world = bpy.data.worlds.new('review_world')
    world.color = (0.35, 0.35, 0.37)
    if world.node_tree is None:
        world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    if bg:
        bg.inputs['Color'].default_value = (0.35, 0.35, 0.37, 1)
        bg.inputs['Strength'].default_value = 1.0
    scene.world = world
    sun = bpy.data.objects.new('review_sun', bpy.data.lights.new('review_sun', 'SUN'))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(50), 0, math.radians(-30))
    scene.collection.objects.link(sun)
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'


def solid_look():
    scene.render.engine = 'BLENDER_WORKBENCH'
    sh = scene.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'MATERIAL'
    sh.show_shadows = True
    sh.shadow_intensity = 0.4
    sh.show_cavity = True
    sh.cavity_type = 'WORLD'
    scene.display.render_aa = '8'
    scene.view_settings.view_transform = 'Standard'
    for o in bpy.data.objects:
        if o.type == 'MESH' and o.get('atlas') == 'glass':
            o.hide_render = True


cam = bpy.data.objects.new('review_cam', bpy.data.cameras.new('review_cam'))
scene.collection.objects.link(cam)
scene.camera = cam
cam.data.sensor_fit = 'VERTICAL'
cam.data.clip_start = 0.02
cam.data.clip_end = 200


def aim(pos, target, vfov=35.0):
    p, f = bl(pos), bl(target)
    fwd = (f - p).normalized()
    right = fwd.cross(Vector((0, 0, 1))).normalized()
    up = right.cross(fwd)
    cam.matrix_world = Matrix.Translation(p) @ Matrix((right, up, -fwd)).transposed().to_4x4()
    cam.data.angle_y = math.radians(vfov)


DEFAULT = (-19977, 9016, 20000)
FOCAL = (0, -1000, 0)
VIEWS = {
    'default': lambda: aim(from_three(DEFAULT), from_three(FOCAL)),
    'idle': lambda: aim(from_three(tuple(f + 0.72 * (c - t) for f, c, t in zip((300, -1400, -1200), DEFAULT, FOCAL))),
                        from_three((300, -1400, -1200))),
    'desk': lambda: aim((0.10, 1.52, 1.62), (0.14, 1.06, -0.20)),
    'pc': lambda: aim((-0.28, 0.60, 0.98), (0.60, 0.22, 0.06), 40.0),
    'props': lambda: aim((-0.10, 1.12, 0.82), (0.12, 0.74, 0.08), 40.0),
}

def glb_look(path):
    """the exported glb as the site gets it: unlit baked materials, screens tinted for the review"""
    for o in bpy.data.objects:
        if o.type == 'MESH' and 'atlas' in o:
            o.hide_render = True
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    root = bpy.data.objects.new('glb_root', None)
    scene.collection.objects.link(root)
    for o in new:
        if o.parent is None:
            o.parent = root
    root.matrix_world = Matrix.Translation((0, 0, -FY / U)) @ Matrix.Diagonal((1 / U, 1 / U, 1 / U, 1))
    glass = glass_material()
    for o in new:
        if o.type != 'MESH':
            continue
        base = o.name.split('.')[0]
        if base in PLACEHOLDER:
            o.data.materials.clear()
            o.data.materials.append(emit_material(f'review_{base}', color=PLACEHOLDER[base]))
        elif base == 'pc_glass':
            o.data.materials.clear()
            o.data.materials.append(glass)
        elif base == 'pc_leds':
            o.data.materials.clear()
            o.data.materials.append(emit_material('review_led_glb', color=(0.86, 0.92, 1.0), strength=3.0))


if args.look == 'baked':
    baked_look()
    if args.glb:
        glb_look(os.path.abspath(os.path.expanduser(args.glb)))
else:
    solid_look()
if not args.no_car:
    add_car()
scene.render.resolution_x = args.width
scene.render.resolution_y = round(args.width * 9 / 16)
scene.render.image_settings.file_format = 'PNG'
for name in args.views.split(','):
    VIEWS[name]()
    bpy.context.view_layer.update()
    path = os.path.join(OUT, f'{args.look}{args.tag}_{name}.png')
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('rendered', path)
