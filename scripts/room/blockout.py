# room v2 blockout: flat colour boxes at real proportions around the current
# car, rendered with workbench from the homepage cameras. no lighting, no bake,
# a few seconds per view. every size is a guess until the user confirms it, so
# they all live in SETUP at the top.
#
#   blender -b --factory-startup --python scripts/room/blockout.py -- \
#       --repo . --out ~/Assets/portfolio-room/blockout [--scale 2764] [--tag a] \
#       [--views default,desk,...] [--current]
#
# writes <out>/<tag>_<view>.png and <out>/<tag>_<view>.json (label anchors in
# pixels, for scripts/room/label_renders.py), plus <out>/<tag>.blend
import argparse
import json
import math
import os
import sys

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--repo', default='.')
ap.add_argument('--out', required=True)
# scene units per metre for the room. 0 means the car's own scale (true size)
ap.add_argument('--scale', type=float, default=0)
ap.add_argument('--tag', default='a')
ap.add_argument('--views', default='all')
# render today's room instead of the new one (same cameras, same look)
ap.add_argument('--current', action='store_true')
ap.add_argument('--width', type=int, default=1600)
args = ap.parse_args(argv)
REPO = os.path.abspath(os.path.expanduser(args.repo))
OUT = os.path.abspath(os.path.expanduser(args.out))
os.makedirs(OUT, exist_ok=True)

# the site's numbers (three.js units, y up)
FLOOR_Y = -2984.2  # top of the Background mesh, what the car stands on
CAR_POSITION = (-2400.0, 0.0, -7600.0)
CAR_SCALE = 27.0
CAR_LENGTH_M = 4.75
CAR_GROUND_Y = -2995.0  # getGroundYFromScene today (the old chair base dips lower)
CAMERA_VFOV = 35.0
IDLE_FOCAL = (0.0, -1000.0, 0.0)

# the setup, in metres, three.js axes: x right, y up, z toward the chair.
# origin is the floor under the main screen's centre line, desk centre depth
SETUP = {
    'desk': {'w': 1.60, 'd': 0.80, 'h': 0.74, 'top': 0.025, 'x': 0.10},
    # 27 inch 16:9 oled, active area and bezels (top, sides, bottom)
    'panel': {'active': (0.5967, 0.3357), 'bezel': (0.005, 0.005, 0.009), 'depth': 0.008},
    'main_bottom_above_desk': 0.10,
    'stack_gap': 0.02,
    'top_tilt_deg': 10.0,  # top monitor leans down toward the eyes
    'side_gap': 0.03,
    'side_toe_deg': 25.0,  # right monitor angled in toward the chair
    'screen_z': -0.20,  # front face of the main screen
    'pc': {'w': 0.239, 'h': 0.477, 'd': 0.528, 'gap': 0.11},  # phanteks nv5
    'flipper': {'l': 0.100, 'w': 0.040, 't': 0.025, 'x': -0.36, 'z': 0.21, 'yaw': 20.0},
}


def srgb(hex_value):
    """hex srgb to linear rgba for material viewport colours"""
    rgb = [((hex_value >> s) & 255) / 255 for s in (16, 8, 0)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]
    return (*lin, 1.0)


PALETTE = {
    'floor': 0xB9B8BA,
    'desk': 0x2B2B2E,
    'frame': 0x1C1C1E,
    'mat': 0x141416,
    'keyboard': 0x3A3A3E,
    'monitor': 0x0E0E10,
    'screen_main': 0x3A7BFF,
    'screen_top': 0x2EC4B6,
    'screen_side': 0x3DDC84,
    'stand': 0x202022,
    'pc_shell': 0xEDEDED,
    'pc_board': 0x1A1A1A,
    'pc_gpu': 0x3A3D42,
    'pc_fan': 0xF7F7F7,
    'pc_led': 0xCFE8FF,
    'pc_pump': 0xFFFFFF,
    'chair': 0x26262A,
    'flipper': 0xFF8200,
    'marker': 0xFF3DA5,
    'mug': 0xD8D2C8,
    'card': 0xF2F0EA,
    'car': 0x0B1A4A,
    'car_dark': 0x111114,
    'car_glass': 0x1B2233,
    'old': 0x9A9A9E,
}

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
materials = {}


def material(key):
    if key not in materials:
        mat = bpy.data.materials.new(key)
        mat.diffuse_color = srgb(PALETTE[key])
        materials[key] = mat
    return materials[key]


# three.js (x, y, z) to blender (x, -z, y), in thousands of units so blender's
# clip and grid defaults stay sane
C = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))


def tb(v):
    return Vector((v[0], -v[2], v[1])) / 1000.0


def rot3(yaw=0.0, tilt=0.0, roll=0.0):
    """three.js space rotation: roll (z), then tilt (x), then yaw (y), degrees"""
    ry = Matrix.Rotation(math.radians(yaw), 3, 'Y')
    rx = Matrix.Rotation(math.radians(tilt), 3, 'X')
    rz = Matrix.Rotation(math.radians(roll), 3, 'Z')
    return ry @ rx @ rz


def to_blender_basis(center, rot=None, size=(1, 1, 1)):
    r = rot if rot is not None else Matrix.Identity(3)
    rb = (C @ r @ C.transposed()).to_4x4()
    loc = Matrix.Translation(C @ Vector(center))
    sc = Matrix.Diagonal((size[0], size[2], size[1], 1.0))
    return loc @ rb @ sc


def link(obj, parent):
    scene.collection.objects.link(obj)
    if parent is not None:
        obj.parent = parent
        obj.matrix_parent_inverse = Matrix.Identity(4)


def box(name, size, center, color, rot=None, parent=None):
    mesh = bpy.data.meshes.new(name)
    s = 0.5
    verts = [(x, y, z) for x in (-s, s) for y in (-s, s) for z in (-s, s)]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    mesh.from_pydata(verts, [], faces)
    mesh.materials.append(material(color))
    obj = bpy.data.objects.new(name, mesh)
    link(obj, parent)
    obj.matrix_basis = to_blender_basis(center, rot, size)
    return obj


def cylinder(name, radius, height, center, color, rot=None, parent=None, axis='y', segments=32):
    """a cylinder along three.js y (default), or x or z, before rot"""
    mesh = bpy.data.meshes.new(name)
    verts, faces = [], []
    for i in range(segments):
        a = 2 * math.pi * i / segments
        c, s = math.cos(a), math.sin(a)
        # unit cylinder in three.js axes (y is its axis), stored in blender axes
        for y in (-0.5, 0.5):
            verts.append((c, -s, y))
    for i in range(segments):
        j = (i + 1) % segments
        faces.append((2 * i, 2 * j, 2 * j + 1, 2 * i + 1))
    faces.append(tuple(2 * i for i in range(segments))[::-1])
    faces.append(tuple(2 * i + 1 for i in range(segments)))
    mesh.from_pydata(verts, [], faces)
    mesh.materials.append(material(color))
    obj = bpy.data.objects.new(name, mesh)
    link(obj, parent)
    base = rot if rot is not None else Matrix.Identity(3)
    if axis == 'x':
        base = base @ Matrix.Rotation(math.radians(-90), 3, 'Z')
    elif axis == 'z':
        base = base @ Matrix.Rotation(math.radians(90), 3, 'X')
    obj.matrix_basis = to_blender_basis(center, base, (radius, height, radius))
    return obj


def empty(name, matrix):
    obj = bpy.data.objects.new(name, None)
    scene.collection.objects.link(obj)
    obj.matrix_world = matrix
    return obj


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


# --- the studio backdrop, exactly today's (environment.glb Background) ---
env_objects = import_glb(f'{REPO}/static/models/World/environment.glb')
for obj in env_objects:
    if obj.type != 'MESH':
        continue
    obj.scale = (0.9, 0.9, 0.9)  # BakedModel scales every room mesh by 900
    obj.data.materials.clear()
    if obj.name.startswith('Background'):
        obj.data.materials.append(material('floor'))
    elif args.current:
        obj.data.materials.append(material('old'))
    else:
        obj.hide_render = True
        obj.hide_viewport = True

if args.current:
    for rel in ('static/models/Computer/computer_setup.glb', 'static/models/Decor/decor.glb'):
        for obj in import_glb(f'{REPO}/{rel}'):
            if obj.type == 'MESH':
                obj.scale = (0.9, 0.9, 0.9)
                obj.data.materials.clear()
                obj.data.materials.append(material('old'))

# --- the car, placed the way World/Car.ts places the default car ---
car_objects = import_glb(
    f'{REPO}/static/models/Cars/mercedes_amg_project_one/source/mercedes_amg_project_one.glb'
)
car_root = empty('CAR', Matrix.Identity(4))
for obj in car_objects:
    if obj.parent is None:
        obj.parent = car_root
    if obj.type == 'MESH':
        for slot in obj.material_slots:
            name = (slot.material.name if slot.material else '').lower()
            if any(k in name for k in ('tire', 'tread', 'rubber', 'black', 'carbon', 'rim')):
                slot.material = material('car_dark')
            elif any(k in name for k in ('window', 'glass')):
                slot.material = material('car_glass')
            else:
                slot.material = material('car')
bpy.context.view_layer.update()


def world_bounds(objects):
    lo = Vector((1e9,) * 3)
    hi = Vector((-1e9,) * 3)
    for obj in objects:
        if obj.type != 'MESH':
            continue
        for corner in obj.bound_box:
            p = obj.matrix_world @ Vector(corner)
            lo = Vector(map(min, lo, p))
            hi = Vector(map(max, hi, p))
    return lo, hi


# raw bounds give the length the site scales by (Car.getSceneUnitsPerMeter)
lo, hi = world_bounds(car_objects)
raw_length = max(hi - lo) * 1.0  # blender units of the raw glb (metres of the export)
units_per_metre = raw_length * CAR_SCALE / CAR_LENGTH_M
U = args.scale or units_per_metre
# scale 27 and yaw -90 degrees, then the 1/3 length shift backward (+x)
car_root.matrix_world = Matrix.Rotation(math.radians(-90), 4, 'Z') @ Matrix.Diagonal(
    (CAR_SCALE / 1000,) * 3 + (1,)
)
bpy.context.view_layer.update()
lo, hi = world_bounds(car_objects)
length_units = (hi.x - lo.x) * 1000
car_x = CAR_POSITION[0] + length_units / 3
car_y = CAR_GROUND_Y - lo.z * 1000
car_root.matrix_world = Matrix.Translation(tb((car_x, car_y, CAR_POSITION[2]))) @ car_root.matrix_world
bpy.context.view_layer.update()
car_lo, car_hi = world_bounds(car_objects)

labels = {}


def label(key, text, point_three):
    labels[key] = {'text': text, 'at': list(point_three)}


def room_to_three(p):
    return (p[0] * U, FLOOR_Y + p[1] * U, p[2] * U)


label('car', 'Car (same model, same spot)', ((car_lo.x + car_hi.x) * 500, car_hi.z * 1000, -(car_lo.y + car_hi.y) * 500))

# --- the new setup ---
screens = {}
if not args.current:
    room = empty('ROOM', Matrix.Translation(tb((0, FLOOR_Y, 0))) @ Matrix.Diagonal((U / 1000,) * 3 + (1,)))
    desk = SETUP['desk']
    top_y = desk['h']
    box('desk_top', (desk['w'], desk['top'], desk['d']), (desk['x'], top_y - desk['top'] / 2, 0), 'desk', parent=room)
    for side in (-1, 1):
        lx = desk['x'] + side * (desk['w'] / 2 - 0.10)
        box(f'desk_leg_{side}', (0.07, top_y - desk['top'] - 0.03, 0.10), (lx, (top_y - desk['top']) / 2 + 0.015, 0), 'frame', parent=room)
        box(f'desk_foot_{side}', (0.07, 0.03, desk['d'] - 0.08), (lx, 0.015, 0), 'frame', parent=room)
    box('desk_rail', (desk['w'] - 0.30, 0.05, 0.06), (desk['x'], top_y - desk['top'] - 0.025, -0.12), 'frame', parent=room)
    box('desk_mat', (0.90, 0.004, 0.40), (0.0, top_y + 0.002, 0.17), 'mat', parent=room)
    box('keyboard', (0.36, 0.03, 0.135), (-0.03, top_y + 0.019, 0.20), 'keyboard', rot=rot3(tilt=-4), parent=room)
    box('mouse', (0.065, 0.04, 0.12), (0.30, top_y + 0.024, 0.21), 'keyboard', parent=room)
    cylinder('mug', 0.042, 0.095, (0.66, top_y + 0.0475, 0.16), 'mug', parent=room)
    box('credits_card', (0.10, 0.002, 0.15), (-0.56, top_y + 0.001, 0.06), 'card', rot=rot3(yaw=12), parent=room)
    label('desk', 'Desk 160 x 80 cm (guess)', room_to_three((desk['x'] + desk['w'] / 2 - 0.1, top_y, desk['d'] / 2)))
    label('credits', 'Credits card', room_to_three((-0.56, top_y, 0.06)))

    # flipper zero spot: the device plus a marker ring under it
    fl = SETUP['flipper']
    fl_center = (fl['x'], top_y + 0.004 + fl['t'] / 2, fl['z'])
    box('flipper_zero', (fl['l'], fl['t'], fl['w']), fl_center, 'flipper', rot=rot3(yaw=fl['yaw']), parent=room)
    cylinder('flipper_marker', 0.085, 0.002, (fl['x'], top_y + 0.005, fl['z']), 'marker', parent=room)
    label('flipper', 'Flipper Zero spot', room_to_three((fl['x'], top_y + 0.03, fl['z'])))

    panel = SETUP['panel']
    aw, ah = panel['active']
    bt, bs, bb = panel['bezel']
    ow, oh = aw + 2 * bs, ah + bt + bb

    def monitor(name, center, rot, portrait, screen_color, text):
        w, h = (oh, ow) if portrait else (ow, oh)
        sw, sh = (ah, aw) if portrait else (aw, ah)
        box(f'{name}_panel', (w, h, panel['depth']), center, 'monitor', rot=rot, parent=room)
        back = Vector(center) + rot @ Vector((0, 0, -(panel['depth'] / 2 + 0.02)))
        bw, bh = (0.24, 0.40) if portrait else (0.40, 0.24)
        box(f'{name}_back', (bw, bh, 0.04), tuple(back), 'monitor', rot=rot, parent=room)
        # active area, pushed up by the thicker bottom bezel (or sideways in portrait)
        shift = (bb - bt) / 2
        local = Vector((shift, 0, 0)) if portrait else Vector((0, shift, 0))
        front = Vector(center) + rot @ (local + Vector((0, 0, panel['depth'] / 2 + 0.0015)))
        box(f'{name}_screen', (sw, sh, 0.002), tuple(front), screen_color, rot=rot, parent=room)
        normal = rot @ Vector((0, 0, 1))
        screens[name] = {
            'center': list(front),
            'normal': list(normal),
            'up': list(rot @ Vector((0, 1, 0))),
            'size': [sw, sh],
        }
        top = Vector(center) + rot @ Vector((0, h / 2, 0))
        label(name, text, room_to_three(tuple(top)))

    mb = top_y + SETUP['main_bottom_above_desk']
    main_center = (0.0, mb + oh / 2, SETUP['screen_z'] - panel['depth'] / 2)
    monitor('m1', main_center, rot3(), False, 'screen_main', 'M1 main (bottom): live yassinOS')

    tilt = SETUP['top_tilt_deg']
    top_bottom = mb + oh + SETUP['stack_gap']
    t = math.radians(tilt)
    top_center = (0.0, top_bottom + oh / 2 * math.cos(t), main_center[2] + oh / 2 * math.sin(t))
    monitor('m2', top_center, rot3(tilt=tilt), False, 'screen_top', 'M2 top: companion display')

    toe = SETUP['side_toe_deg']
    seam = mb + oh + SETUP['stack_gap'] / 2
    hinge_x = ow / 2 + SETUP['side_gap']
    r = rot3(yaw=-toe)
    side_center = Vector((hinge_x, seam, main_center[2])) + r @ Vector((oh / 2, 0, 0))
    monitor('m3', tuple(side_center), r, True, 'screen_side', 'M3 side (portrait): terminal, loader dock')

    # one pole with two arms for the stack, a desk stand for the portrait one
    pole_z = -0.36
    cylinder('pole', 0.02, 0.86, (0.0, top_y + 0.43, pole_z), 'stand', parent=room)
    box('arm_m1', (0.04, 0.03, abs(pole_z - main_center[2]) - 0.02), (0.0, main_center[1], (pole_z + main_center[2]) / 2 - 0.02), 'stand', parent=room)
    box('arm_m2', (0.04, 0.03, abs(pole_z - top_center[2]) - 0.02), (0.0, top_center[1], (pole_z + top_center[2]) / 2 - 0.02), 'stand', parent=room)
    box('m3_base', (0.24, 0.012, 0.20), (side_center.x, top_y + 0.006, side_center.z - 0.07), 'stand', rot=r, parent=room)
    box('m3_neck', (0.05, side_center.y - top_y, 0.03), (side_center.x, top_y + (side_center.y - top_y) / 2, side_center.z - 0.07), 'stand', rot=r, parent=room)

    # the pc on the floor, left of the desk: front toward the chair side (+z),
    # the side glass toward -x, so the panoramic corner faces the default camera
    pc = SETUP['pc']
    px = desk['x'] - desk['w'] / 2 - pc['gap'] - pc['w'] / 2
    pz = 0.05
    # case axes: width along x (glass at -x), depth along z (front at +z)

    def pcb(name, size, local, color):
        return box(name, size, (px + local[0], local[1], pz + local[2]), color, parent=room)

    W, H, D = pc['w'], pc['h'], pc['d']
    t_ = 0.006
    pcb('pc_right', (t_, H, D), (W / 2 - t_ / 2, H / 2, 0), 'pc_shell')
    pcb('pc_rear', (W, H, t_), (0, H / 2, -D / 2 + t_ / 2), 'pc_shell')
    pcb('pc_top', (W, t_, D), (0, H - t_ / 2, 0), 'pc_shell')
    pcb('pc_bottom', (W, 0.02, D), (0, 0.01, 0), 'pc_shell')
    pcb('pc_frame_top_edge', (0.012, 0.012, D), (-W / 2 + 0.006, H - 0.006, 0), 'pc_shell')
    pcb('pc_shroud', (W - 0.01, 0.11, D - 0.01), (0, 0.075, 0), 'pc_shell')
    pcb('pc_board', (0.005, 0.305, 0.244), (W / 2 - 0.02, 0.29, -0.12), 'pc_board')
    pcb('pc_gpu', (0.140, 0.070, 0.340), (W / 2 - 0.02 - 0.075, 0.20, -0.07), 'pc_gpu')
    pcb('pc_radiator', (0.12, 0.027, 0.397), (0.0, H - 0.03, -0.02), 'pc_fan')
    pcb('pc_pump', (0.03, 0.065, 0.065), (W / 2 - 0.045, 0.37, -0.14), 'pc_pump')
    for i, fz in enumerate((-0.14, -0.02, 0.10)):
        cylinder(f'pc_top_fan_{i}', 0.058, 0.025, (px, H - 0.06, pz + fz), 'pc_fan', parent=room)
    for i, fy in enumerate((0.16, 0.285, 0.41)):
        cylinder(f'pc_side_fan_{i}', 0.058, 0.025, (px + W / 2 - 0.03, fy, pz + 0.19), 'pc_fan', parent=room, axis='x')
    cylinder('pc_rear_fan', 0.058, 0.025, (px + 0.02, 0.38, pz - D / 2 + 0.03), 'pc_fan', parent=room, axis='z')
    # the white edge light: up the pillarless corner, along the bottom, the shroud line
    pcb('pc_led_corner', (0.008, H - 0.03, 0.008), (-W / 2 + 0.004, H / 2, D / 2 - 0.004), 'pc_led')
    pcb('pc_led_bottom', (0.008, 0.008, D - 0.02), (-W / 2 + 0.004, 0.024, 0), 'pc_led')
    pcb('pc_led_shroud', (0.006, 0.006, D * 0.62), (-W / 2 + 0.01, 0.133, -D * 0.15), 'pc_led')
    label('pc', 'PC: Phanteks NV5 (white), RTX 5080', room_to_three((px, H, pz)))

    # a low back chair (no headrest) swivelled out to the front right, so it
    # stays under the sight line from the desk view to every screen
    cx, cz, cyaw = 0.62, 0.74, 70.0
    rc = rot3(yaw=cyaw)

    def chair(name, size, local, color='chair'):
        p = Vector((cx, 0, cz)) + rc @ Vector(local)
        return box(name, size, tuple(p), color, rot=rc, parent=room)

    cylinder('chair_base', 0.33, 0.05, (cx, 0.07, cz), 'chair', parent=room)
    cylinder('chair_lift', 0.025, 0.36, (cx, 0.27, cz), 'chair', parent=room)
    chair('chair_seat', (0.50, 0.08, 0.48), (0, 0.48, 0))
    chair('chair_back', (0.46, 0.56, 0.06), (0, 0.82, 0.25))
    label('chair', 'Chair (low back, swivelled out)', room_to_three((cx, 1.1, cz)))

# --- cameras ---
scene.render.engine = 'BLENDER_WORKBENCH'
shading = scene.display.shading
shading.light = 'STUDIO'
shading.studio_light = 'paint.sl'
shading.color_type = 'MATERIAL'
shading.show_shadows = True
shading.shadow_intensity = 0.35
shading.show_cavity = True
shading.cavity_type = 'WORLD'
shading.show_object_outline = True
shading.object_outline_color = (0.05, 0.05, 0.06)
scene.display.light_direction = (-0.45, 0.35, 0.82)
scene.display.render_aa = '8'
scene.view_settings.view_transform = 'Standard'
world = bpy.data.worlds.new('studio')
world.color = srgb(0xA2A1A6)[:3]
scene.world = world
scene.render.resolution_x = args.width
scene.render.resolution_y = round(args.width * 9 / 16)
scene.render.film_transparent = False

cam_data = bpy.data.cameras.new('cam')
cam = bpy.data.objects.new('cam', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam_data.sensor_fit = 'VERTICAL'
cam_data.clip_start = 0.05
cam_data.clip_end = 2000


def aim(position_three, target_three, vfov=CAMERA_VFOV):
    p, f = tb(position_three), tb(target_three)
    fwd = (f - p).normalized()
    right = fwd.cross(Vector((0, 0, 1))).normalized()
    up = right.cross(fwd)
    rot = Matrix((right, up, -fwd)).transposed().to_4x4()
    cam.matrix_world = Matrix.Translation(p) @ rot
    cam_data.type = 'PERSP'
    cam_data.angle_y = math.radians(vfov)


def aim_ortho(center_three, width_units):
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = width_units / 1000
    p = tb(center_three) + Vector((0, 0, 60))
    cam.matrix_world = Matrix.Translation(p)


def frame_screen(key, fill, aspect=16 / 9):
    """camera square to a screen, filling `fill` of the tighter viewport axis"""
    s = screens[key]
    w, h = s['size']
    tv = math.tan(math.radians(CAMERA_VFOV) / 2)
    th = tv * aspect
    d = max((h / 2) / tv, (w / 2) / th) / fill
    c, n = Vector(s['center']), Vector(s['normal'])
    return tuple(c + n * d), tuple(c), d


views = {}
# the idle keyframe at t = 0 (Camera/CameraKeyframes.ts): x swings between
# -20000 and 20000 over about 78 s, y drifts slowly around 9000
views['default'] = lambda: aim((-19977, 9016, 20000), IDLE_FOCAL)
views['idle_right'] = lambda: aim((19990, 9650, 20000), IDLE_FOCAL)
views['idle_front'] = lambda: aim((0, 10200, 24000), IDLE_FOCAL)


def idle_proposed():
    # same direction as the default view, aimed between the desk and the car
    # and 28% closer, because the new setup is smaller than henry's desk
    focal = Vector((300, -1400, -1200))
    offset = Vector((-19977, 9016, 20000)) - Vector(IDLE_FOCAL)
    aim(tuple(focal + offset * 0.72), tuple(focal))


views['idle_proposed'] = idle_proposed
TITLES = {
    'default': 'Homepage default camera (idle keyframe at t = 0), unchanged',
    'idle_right': 'Idle camera at the other end of its swing (about 40 s in)',
    'idle_front': 'Idle camera mid swing (front)',
    'idle_proposed': 'Proposed idle framing: same angle, aimed at desk plus car, 28% closer',
    'desk': 'Proposed desk view (replaces the DESK keyframe)',
    'plan': 'Plan view (top down, orthographic)',
    'focus_m1': 'Focus M1: 92% of the viewport',
    'focus_m2': 'Focus M2: square to its 10 degree tilt',
    'focus_m3': 'Focus M3: portrait, 90% of the height',
    'focus_flipper': 'Focus Flipper Zero',
    'pc': 'PC close-up (panoramic corner)',
}
LABEL_FILTER = {
    'focus_m1': {'m1'},
    'focus_m2': {'m2'},
    'focus_m3': {'m3'},
    'focus_flipper': {'flipper'},
    'pc': {'pc', 'flipper'},
    'desk': {'m1', 'm2', 'm3', 'flipper', 'credits'},
}
if not args.current:
    views['desk'] = lambda: aim(room_to_three((0.10, 1.52, 1.62)), room_to_three((0.14, 1.06, -0.20)))
    views['plan'] = lambda: aim_ortho(room_to_three((0.6, 0, -1.3)), 6.2 * U)
    focus_distances = {}
    for key, fill in (('m1', 0.92), ('m2', 0.92), ('m3', 0.9)):
        pos, target, dist = frame_screen(key, fill)
        focus_distances[key] = dist

        def make(pos=pos, target=target):
            return lambda: aim(room_to_three(pos), room_to_three(target))

        views[f'focus_{key}'] = make()
    fl = SETUP['flipper']
    views['focus_flipper'] = lambda: aim(
        room_to_three((fl['x'] + 0.02, SETUP['desk']['h'] + 0.30, fl['z'] + 0.26)),
        room_to_three((fl['x'], SETUP['desk']['h'] + 0.01, fl['z'])),
    )
    views['pc'] = lambda: aim(
        room_to_three((-1.9, 0.95, 1.5)), room_to_three((-0.93, 0.24, 0.05))
    )

wanted = list(views) if args.views == 'all' else args.views.split(',')
meta = {
    'units_per_metre': U,
    'car_units_per_metre': units_per_metre,
    'car_bounds_three': [
        [car_lo.x * 1000, car_lo.z * 1000, -car_hi.y * 1000],
        [car_hi.x * 1000, car_hi.z * 1000, -car_lo.y * 1000],
    ],
    'screens_m': screens,
}
if not args.current:
    meta['focus_distance_m'] = focus_distances
    meta['focus_distance_units'] = {k: v * U for k, v in focus_distances.items()}

for name in wanted:
    if name not in views:
        continue
    views[name]()
    bpy.context.view_layer.update()
    small = name.startswith('focus_')
    scene.render.resolution_x = args.width // 2 if small else args.width
    scene.render.resolution_y = round(scene.render.resolution_x * 9 / 16)
    path = f'{OUT}/{args.tag}_{name}.png'
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    anchors = []
    for key, entry in labels.items():
        if name in LABEL_FILTER and key not in LABEL_FILTER[name]:
            continue
        p = tb(entry['at'])
        v = world_to_camera_view(scene, cam, p)
        if 0 <= v.x <= 1 and 0 <= v.y <= 1 and v.z > 0:
            anchors.append({
                'key': key,
                'text': entry['text'],
                'x': v.x * scene.render.resolution_x,
                'y': (1 - v.y) * scene.render.resolution_y,
            })
    title = TITLES.get(name, name)
    if args.current:
        title = 'Today: ' + title
    elif args.scale:
        title = f'{title} [room at {round(U)} units/m]'
    with open(f'{OUT}/{args.tag}_{name}.json', 'w') as fh:
        json.dump({'view': name, 'title': title, 'labels': anchors, **meta}, fh, indent=1)
    print('rendered', path)

bpy.ops.wm.save_as_mainfile(filepath=f'{OUT}/{args.tag}.blend')

# the new setup alone as a greybox glb in three.js units (y up), so screens,
# focus and camera work can start before the baked room exists. the screen
# meshes are named m1_screen, m2_screen, m3_screen
if not args.current:
    room.matrix_world = Matrix.Translation(tb((0, FLOOR_Y, 0)) * 1000) @ Matrix.Diagonal((U,) * 3 + (1,))
    bpy.ops.object.select_all(action='DESELECT')
    for obj in [room, *room.children_recursive]:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=f'{OUT}/{args.tag}_room_greybox.glb',
        use_selection=True,
        export_yup=True,
        export_apply=False,
    )
    meta['greybox'] = f'{OUT}/{args.tag}_room_greybox.glb'
print(json.dumps(meta, indent=1))
