# builds the desk flipper zero from scratch and bakes its lighting.
#
#   blender -b -P scripts/blender/build-flipper.py -- --out models-src/models/Props/handheld.glb
#
# the black unit: charcoal shell with its faceted front edge and the angled
# end (the ir window's), an orange d-pad disc split into its four keys with
# the arrows moulded in, an orange ok and back button, the led, the usb-c
# port on the round end and the gpio slots on the top edge. modelled from the
# public dimensions (100.3 x 40.1 x 25.6 mm) and photos of a unit; flipper's
# official cad (flipperdevices/flipperzero-3d-models, gpl-3.0) was only a
# visual reference, no geometry comes from it. no logo or wordmark anywhere.
#
# parts, named for Flipper.ts: flipper-body, flipper-screen (uv 0..1 over the
# 128x64 active area), flipper-led, flipper-btn-up|down|left|right|ok|back.
# everything but the screen shares one baked atlas; the screen gets the live
# canvas. x runs along the device (the angled end at -x), y across it (the
# gpio edge at +y), z out of the front face
import math
import sys

import bmesh
import bpy

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
out_path = argv[argv.index("--out") + 1] if "--out" in argv else "/tmp/handheld.glb"
atlas_size = int(argv[argv.index("--atlas") + 1]) if "--atlas" in argv else 1024

MM = 0.001
LENGTH, DEPTH, HEIGHT = 100.3 * MM, 40.1 * MM, 25.6 * MM
L2, W2, TOP = LENGTH / 2, DEPTH / 2, HEIGHT


def srgb(hex_value):
    r, g, b = ((hex_value >> 16) & 255) / 255, ((hex_value >> 8) & 255) / 255, (hex_value & 255) / 255
    lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (lin(r), lin(g), lin(b))


# colour, roughness. picked from the photos of the black unit
COLORS = {
    "shell": (srgb(0x232428), 0.46),
    "dark": (srgb(0x0b0b0c), 0.25),
    "glass": (srgb(0x050506), 0.08),
    "orange": (srgb(0xff7a1c), 0.38),
    "arrow": (srgb(0xc9500e), 0.45),
    "led": (srgb(0x151515), 0.3),
    "metal": (srgb(0x8e9196), 0.3),
}

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def material(name):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    color, roughness = COLORS[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    if name == "metal":
        bsdf.inputs["Metallic"].default_value = 1.0
    return mat


def new_object(name, bm, mat_names):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    for m in mat_names:
        obj.data.materials.append(material(m))
    return obj


def prism(points, z0, z1):
    """a closed outline in xy extruded from z0 to z1, as a bmesh"""
    bm = bmesh.new()
    bottom = [bm.verts.new((x, y, z0)) for x, y in points]
    top = [bm.verts.new((x, y, z1)) for x, y in points]
    bm.faces.new(bottom[::-1])
    bm.faces.new(top)
    n = len(points)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((bottom[i], bottom[j], top[j], top[i]))
    bm.normal_update()
    return bm


def bevel_rims(bm, z, offset, segments):
    edges = [e for e in bm.edges if all(abs(v.co.z - z) < 1e-7 for v in e.verts)]
    bmesh.ops.bevel(bm, geom=edges, offset=offset, segments=segments, affect="EDGES", profile=0.5)


def arc(cx, cy, r, a0, a1, steps):
    return [(cx + r * math.cos(a0 + (a1 - a0) * i / steps), cy + r * math.sin(a0 + (a1 - a0) * i / steps)) for i in range(steps + 1)]


def rounded_rect(w, h, r, steps=4):
    pts = []
    for cx, cy, a in ((w / 2 - r, -h / 2 + r, -math.pi / 2), (w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, math.pi / 2), (-w / 2 + r, -h / 2 + r, math.pi)):
        pts += arc(cx, cy, r, a, a + math.pi / 2, steps)
    return pts


def place(obj, x, y, z, rz=0.0):
    obj.location = (x, y, z)
    obj.rotation_euler = (0, 0, rz)
    return obj


def cylinder(r, h, segments, top_bevel, mats):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=r, radius2=r, depth=h)
    for v in bm.verts:
        v.co.z += h / 2
    if top_bevel > 0:
        bevel_rims(bm, h, top_bevel, 2)
    return bm


parts = []

# ---- shell: the outline, round at the usb end, angled at the ir end
R = 7.0 * MM
outline = [(-42.0 * MM, -W2)]
outline += arc(L2 - R, -W2 + R, R, -math.pi / 2, 0, 6)
outline += arc(L2 - R, W2 - R, R, 0, math.pi / 2, 6)
outline += [(-37.0 * MM, W2), (-L2, -1.0 * MM), (-L2, -12.0 * MM)]
bm = prism(outline, 0, TOP)
# soften the angled end's corners, then the faceted front edge and a small
# chamfer round the back
corner_edges = [
    e
    for e in bm.edges
    if abs(e.verts[0].co.z - e.verts[1].co.z) > 1e-7 and e.verts[0].co.x < -30 * MM
]
bmesh.ops.bevel(bm, geom=corner_edges, offset=1.4 * MM, segments=2, affect="EDGES", profile=0.5)
bevel_rims(bm, TOP, 2.6 * MM, 1)
bevel_rims(bm, 0, 1.0 * MM, 1)
parts.append(new_object("flipper-shell", bm, ["shell"]))

# ---- screen: a glossy black window, the lcd sits in it
SCREEN_X, SCREEN_Y = -7.0 * MM, 3.5 * MM
window = new_object("flipper-window", prism(rounded_rect(36 * MM, 21 * MM, 2.0 * MM), TOP - 0.2 * MM, TOP + 0.15 * MM), ["glass"])
parts.append(place(window, SCREEN_X, SCREEN_Y, 0))

# ---- d-pad: a dark seat, four orange quarter keys with arrows, the ok
PAD_X, PAD_Y = 24.0 * MM, 4.5 * MM
seat = new_object("flipper-seat", cylinder(12.0 * MM, 0.35 * MM, 64, 0, ["dark"]), ["dark"])
parts.append(place(seat, PAD_X, PAD_Y, TOP - 0.1 * MM))

R_IN, R_OUT, KEY_H = 5.2 * MM, 11.2 * MM, 1.7 * MM
for name, angle in (("right", 0), ("up", 90), ("left", 180), ("down", 270)):
    a = math.radians(angle)
    gap_out = 0.35 * MM / R_OUT
    gap_in = 0.35 * MM / R_IN
    outer = arc(0, 0, R_OUT, a - math.pi / 4 + gap_out, a + math.pi / 4 - gap_out, 12)
    inner = arc(0, 0, R_IN, a + math.pi / 4 - gap_in, a - math.pi / 4 + gap_in, 6)
    bm = prism(outer + inner, 0, KEY_H)
    bevel_rims(bm, KEY_H, 0.45 * MM, 2)
    # the arrow moulded into the key, pointing out
    tip = 9.4 * MM
    base = 6.9 * MM
    half = 1.5 * MM
    tri = [
        (math.cos(a) * tip, math.sin(a) * tip),
        (math.cos(a) * base - math.sin(a) * half, math.sin(a) * base + math.cos(a) * half),
        (math.cos(a) * base + math.sin(a) * half, math.sin(a) * base - math.cos(a) * half),
    ]
    key = place(new_object(f"flipper-btn-{name}", bm, ["orange"]), PAD_X, PAD_Y, TOP + 0.1 * MM)
    mark = place(new_object(f"flipper-arrow-{name}", prism(tri, KEY_H - 0.05 * MM, KEY_H + 0.18 * MM), ["arrow"]), PAD_X, PAD_Y, TOP + 0.1 * MM)
    bpy.ops.object.select_all(action="DESELECT")
    key.select_set(True)
    mark.select_set(True)
    bpy.context.view_layer.objects.active = key
    bpy.ops.object.join()
    parts.append(key)

ok = new_object("flipper-btn-ok", cylinder(4.4 * MM, 2.3 * MM, 40, 0.7 * MM, ["orange"]), ["orange"])
parts.append(place(ok, PAD_X, PAD_Y, TOP + 0.1 * MM))

back = new_object("flipper-btn-back", cylinder(3.3 * MM, 1.9 * MM, 32, 0.6 * MM, ["orange"]), ["orange"])
parts.append(place(back, 40.5 * MM, -6.5 * MM, TOP - 0.1 * MM))
back_seat = new_object("flipper-back-seat", cylinder(3.9 * MM, 0.35 * MM, 32, 0, ["dark"]), ["dark"])
parts.append(place(back_seat, 40.5 * MM, -6.5 * MM, TOP - 0.1 * MM))

led = new_object("flipper-led", cylinder(0.85 * MM, 0.3 * MM, 12, 0, ["led"]), ["led"])
parts.append(place(led, 15.5 * MM, -6.5 * MM, TOP - 0.1 * MM))

# ---- the ends and edges: ir window on the angled tip, usb-c on the round
# end, the gpio header slots along the top edge
ir = new_object("flipper-ir", prism(rounded_rect(0.6 * MM, 8.5 * MM, 0.2 * MM, 1), 0, 9 * MM), ["glass"])
parts.append(place(ir, -L2 + 0.05 * MM, -6.5 * MM, 8.3 * MM))
usb = new_object("flipper-usb", prism(rounded_rect(0.8 * MM, 9.0 * MM, 0.35 * MM, 2), 0, 3.3 * MM), ["dark"])
parts.append(place(usb, L2 - 0.2 * MM, 0, 11.2 * MM))
usb_tongue = new_object("flipper-usb-tongue", prism(rounded_rect(0.9 * MM, 6.6 * MM, 0.2 * MM, 1), 0, 0.7 * MM), ["metal"])
parts.append(place(usb_tongue, L2 - 0.3 * MM, 0, 12.5 * MM))
for x0, x1 in ((-29 * MM, 6 * MM), (11 * MM, 31 * MM)):
    slot = new_object("flipper-gpio", prism(rounded_rect(x1 - x0, 0.6 * MM, 0.2 * MM, 1), 0, 2.6 * MM), ["dark"])
    parts.append(place(slot, (x0 + x1) / 2, W2 - 0.25 * MM, 11.5 * MM))

# ---- screen quad: uv covers exactly the 128x64 active area, canvas texture
bm = bmesh.new()
w, h = 32.0 * MM, 16.0 * MM
verts = [bm.verts.new((x, y, 0)) for x, y in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2))]
face = bm.faces.new(verts)
uv = bm.loops.layers.uv.new("UVMap")
for loop, coord in zip(face.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
    loop[uv].uv = coord
screen_mesh = bpy.data.meshes.new("flipper-screen")
bm.to_mesh(screen_mesh)
bm.free()
screen = bpy.data.objects.new("flipper-screen", screen_mesh)
scene.collection.objects.link(screen)
screen_mat = bpy.data.materials.new("flipper-screen")
screen_mat.use_nodes = True
screen_mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.9, 0.3, 0.02, 1)
screen.data.materials.append(screen_mat)
place(screen, SCREEN_X, SCREEN_Y, TOP + 0.2 * MM)

# ---- bake: one uv atlas across every part, lit the way the desk lights it
bpy.ops.object.select_all(action="DESELECT")
for obj in parts:
    obj.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(50), island_margin=0.006)
bpy.ops.uv.pack_islands(margin=0.004)
bpy.ops.object.mode_set(mode="OBJECT")

atlas = bpy.data.images.new("flipper_atlas", atlas_size, atlas_size, alpha=False)
for mat in bpy.data.materials:
    if mat.name == "flipper-screen" or not mat.use_nodes:
        continue
    node = mat.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = atlas
    mat.node_tree.nodes.active = node

floor = bpy.data.meshes.new("floor")
bm = bmesh.new()
bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.4)
bm.to_mesh(floor)
bm.free()
floor_obj = bpy.data.objects.new("floor", floor)
scene.collection.objects.link(floor_obj)
floor_mat = bpy.data.materials.new("floor")
floor_mat.use_nodes = True
floor_mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.16, 0.13, 0.11, 1)
floor_obj.data.materials.append(floor_mat)

# a big soft key above and in front, a cooler rim from behind, dim world:
# the facets on the front edge and the keys' bevels catch the key
light = bpy.data.lights.new("key", type="AREA")
light.energy = 1.0
light.size = 0.3
light_obj = bpy.data.objects.new("key", light)
light_obj.location = (-0.05, -0.14, 0.3)
light_obj.rotation_euler = (math.radians(24), math.radians(-8), 0)
scene.collection.objects.link(light_obj)
rim = bpy.data.lights.new("rim", type="AREA")
rim.energy = 0.35
rim.size = 0.25
rim_obj = bpy.data.objects.new("rim", rim)
rim_obj.location = (0.12, 0.16, 0.18)
rim_obj.rotation_euler = (math.radians(-40), math.radians(30), 0)
scene.collection.objects.link(rim_obj)

world = bpy.data.worlds.new("world")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.4, 0.4, 0.42, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.22
scene.world = world

scene.render.engine = "CYCLES"
scene.cycles.samples = 128
scene.cycles.use_denoising = False
scene.render.bake.margin = 6
bpy.ops.object.select_all(action="DESELECT")
for obj in parts:
    obj.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
# diffuse and gloss from a fixed light: the highlights are part of the look
# of the satin shell, and the desk view hardly moves
bpy.ops.object.bake(type="COMBINED", margin=6)

atlas.filepath_raw = out_path.replace(".glb", "_atlas.png")
atlas.file_format = "PNG"
atlas.save()

# ---- one baked material, decorative bits joined into the body
baked = bpy.data.materials.new("flipper-baked")
baked.use_nodes = True
tex = baked.node_tree.nodes.new("ShaderNodeTexImage")
tex.image = atlas
bsdf = baked.node_tree.nodes["Principled BSDF"]
baked.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
bsdf.inputs["Roughness"].default_value = 1.0

keep = ["flipper-led", "flipper-btn-ok", "flipper-btn-back", "flipper-btn-up", "flipper-btn-down", "flipper-btn-left", "flipper-btn-right"]
body_parts = [o for o in parts if o.name not in keep]
for obj in parts:
    obj.data.materials.clear()
    obj.data.materials.append(baked)
    for poly in obj.data.polygons:
        poly.material_index = 0
bpy.ops.object.select_all(action="DESELECT")
for obj in body_parts:
    obj.select_set(True)
bpy.context.view_layer.objects.active = body_parts[0]
bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
body.name = "flipper-body"
body.data.name = "flipper-body"

exported = [screen, body] + [bpy.data.objects[name] for name in keep]
for obj in exported:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")

bpy.ops.object.select_all(action="DESELECT")
for obj in exported:
    obj.select_set(True)

triangles = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in exported)
print(f"[flipper] {len(exported)} parts, {triangles} triangles, atlas {atlas_size}px")

bpy.ops.export_scene.gltf(
    filepath=out_path,
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_yup=True,
    export_texcoords=True,
    export_normals=True,
    export_materials="EXPORT",
    export_image_format="JPEG",
    export_extras=False,
)
print(f"[flipper] wrote {out_path}")
