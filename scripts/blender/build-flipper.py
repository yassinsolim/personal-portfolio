# builds the desk flipper zero from scratch and bakes its lighting.
#
#   blender -b -P scripts/blender/build-flipper.py -- --out models-src/models/Props/handheld.glb
#
# modelled from the public dimensions (100.3 x 40.1 x 25.6 mm) and photos; flipper's
# official cad (flipperdevices/flipperzero-3d-models, gpl-3.0) was only used as a
# visual reference, no geometry comes from it. no logo or wordmark anywhere.
#
# parts, named for FlipperDesk.ts: flipper-body, flipper-screen (uv 0..1 over the
# 128x64 active area), flipper-led, flipper-btn-up|down|left|right|ok|back. body,
# led and buttons share one baked 512 px atlas; the screen gets the live canvas.
import math
import sys

import bmesh
import bpy

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
out_path = argv[argv.index("--out") + 1] if "--out" in argv else "/tmp/handheld.glb"
atlas_size = int(argv[argv.index("--atlas") + 1]) if "--atlas" in argv else 512

MM = 0.001
LENGTH, DEPTH, HEIGHT = 100.3 * MM, 40.1 * MM, 25.6 * MM
TOP = HEIGHT

# linear colours, picked from photos of a white unit
COLORS = {
    "flipper-body": (0.80, 0.78, 0.74),
    "flipper-dark": (0.018, 0.018, 0.02),
    "flipper-ring": (0.40, 0.38, 0.35),
    "flipper-led": (0.05, 0.05, 0.05),
    "flipper-btn-up": (0.62, 0.60, 0.56),
    "flipper-btn-down": (0.62, 0.60, 0.56),
    "flipper-btn-left": (0.62, 0.60, 0.56),
    "flipper-btn-right": (0.62, 0.60, 0.56),
    "flipper-btn-ok": (0.80, 0.78, 0.74),
    "flipper-btn-back": (0.80, 0.78, 0.74),
}

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def material(name, color):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.6
    return mat


def new_object(name, bm, mat_name):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    obj.data.materials.append(material(mat_name, COLORS[mat_name]))
    return obj


def rounded_slab(sx, sy, sz, radius, radius_segments, edge, edge_segments):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= sx
        v.co.y *= sy
        v.co.z = (v.co.z + 0.5) * sz
    vertical = [e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > 1e-6]
    bmesh.ops.bevel(bm, geom=vertical, offset=radius, segments=radius_segments, affect="EDGES", profile=0.5)
    if edge > 0:
        rims = [
            e
            for e in bm.edges
            if abs(e.verts[0].co.z - e.verts[1].co.z) < 1e-7
            and (abs(e.verts[0].co.z) < 1e-7 or abs(e.verts[0].co.z - sz) < 1e-7)
        ]
        bmesh.ops.bevel(bm, geom=rims, offset=edge, segments=edge_segments, affect="EDGES", profile=0.5)
    return bm


def cylinder(radius, depth, segments, cap_bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=radius, radius2=radius, depth=depth)
    for v in bm.verts:
        v.co.z += depth / 2
    if cap_bevel > 0:
        top = [e for e in bm.edges if all(abs(v.co.z - depth) < 1e-7 for v in e.verts)]
        bmesh.ops.bevel(bm, geom=top, offset=cap_bevel, segments=1, affect="EDGES")
    return bm


def place(obj, x, y, z):
    obj.location = (x, y, z)
    return obj


parts = []

# body: chunky rounded slab, the front face is +z
parts.append(new_object("flipper-body", rounded_slab(LENGTH, DEPTH, HEIGHT, 8.5 * MM, 5, 2.0 * MM, 2), "flipper-body"))

# dark screen bezel, a hair above the face
SCREEN_X, SCREEN_Y = -17.0 * MM, 1.0 * MM
bezel = new_object("flipper-bezel", rounded_slab(43 * MM, 25 * MM, 0.5 * MM, 3 * MM, 3, 0, 0), "flipper-dark")
parts.append(place(bezel, SCREEN_X, SCREEN_Y, TOP - 0.1 * MM))

# ir window on the top edge and the usb-c port on the left end
ir = new_object("flipper-ir", rounded_slab(14 * MM, 1.0 * MM, 6 * MM, 0.4 * MM, 1, 0, 0), "flipper-dark")
parts.append(place(ir, -30 * MM, DEPTH / 2 - 0.3 * MM, 12 * MM))
usb = new_object("flipper-usb", rounded_slab(1.0 * MM, 9 * MM, 3.2 * MM, 0.4 * MM, 1, 0, 0), "flipper-dark")
parts.append(place(usb, -LENGTH / 2 + 0.3 * MM, 0, 10.5 * MM))

# d-pad ring
PAD_X, PAD_Y = 27.0 * MM, 1.5 * MM
ring = new_object("flipper-ring", cylinder(13 * MM, 0.6 * MM, 40), "flipper-ring")
parts.append(place(ring, PAD_X, PAD_Y, TOP - 0.1 * MM))

# four direction keys, turned so each points away from the ok button
key_offset = 8.6 * MM
for name, angle in (("up", 90), ("down", 270), ("left", 180), ("right", 0)):
    bm = rounded_slab(5.2 * MM, 6.4 * MM, 2.0 * MM, 1.2 * MM, 2, 0.5 * MM, 1)
    obj = new_object(f"flipper-btn-{name}", bm, f"flipper-btn-{name}")
    obj.rotation_euler = (0, 0, math.radians(angle))
    rad = math.radians(angle)
    parts.append(place(obj, PAD_X + math.cos(rad) * key_offset, PAD_Y + math.sin(rad) * key_offset, TOP + 0.4 * MM))

ok = new_object("flipper-btn-ok", cylinder(4.9 * MM, 2.4 * MM, 28, 0.5 * MM), "flipper-btn-ok")
parts.append(place(ok, PAD_X, PAD_Y, TOP + 0.4 * MM))

back = new_object("flipper-btn-back", cylinder(4.2 * MM, 2.4 * MM, 24, 0.5 * MM), "flipper-btn-back")
parts.append(place(back, 43.0 * MM, -12.5 * MM, TOP - 0.1 * MM))

led = new_object("flipper-led", cylinder(0.9 * MM, 0.5 * MM, 10), "flipper-led")
parts.append(place(led, 6.0 * MM, 14.5 * MM, TOP - 0.1 * MM))

# screen quad: uv covers exactly the 128x64 active area, canvas texture at runtime
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
place(screen, SCREEN_X, SCREEN_Y, TOP + 0.9 * MM)

# ---- bake: join the atlas parts, unwrap once, bake diffuse light and colour

for obj in parts:
    obj.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.join()
joined = bpy.context.view_layer.objects.active
joined.name = "flipper-atlas"

bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.01)
bpy.ops.uv.pack_islands(margin=0.006)
bpy.ops.object.mode_set(mode="OBJECT")

atlas = bpy.data.images.new("flipper_atlas", atlas_size, atlas_size, alpha=False)
for mat in joined.data.materials:
    node = mat.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = atlas
    mat.node_tree.nodes.active = node

# soft studio light like the desk: big area light above, dim fill from the world
floor = bpy.data.meshes.new("floor")
bm = bmesh.new()
bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.4)
bm.to_mesh(floor)
bm.free()
floor_obj = bpy.data.objects.new("floor", floor)
scene.collection.objects.link(floor_obj)
floor_obj.data.materials.append(material("floor", (0.18, 0.15, 0.13)))

light = bpy.data.lights.new("key", type="AREA")
light.energy = 2.2
light.size = 0.35
light_obj = bpy.data.objects.new("key", light)
light_obj.location = (-0.08, -0.12, 0.35)
light_obj.rotation_euler = (math.radians(20), math.radians(-10), 0)
scene.collection.objects.link(light_obj)

world = bpy.data.worlds.new("world")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.35, 0.35, 0.36, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.35
scene.world = world

scene.render.engine = "CYCLES"
scene.cycles.samples = 96
scene.cycles.use_denoising = False
scene.render.bake.margin = 6
bpy.ops.object.select_all(action="DESELECT")
joined.select_set(True)
bpy.context.view_layer.objects.active = joined
bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT", "COLOR"}, margin=6)

atlas.filepath_raw = out_path.replace(".glb", "_atlas.png")
atlas.file_format = "PNG"
atlas.save()

# ---- split back into parts; decorative bits stay in the body

bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.separate(type="MATERIAL")
bpy.ops.object.mode_set(mode="OBJECT")

baked = bpy.data.materials.new("flipper-baked")
baked.use_nodes = True
tex = baked.node_tree.nodes.new("ShaderNodeTexImage")
tex.image = atlas
bsdf = baked.node_tree.nodes["Principled BSDF"]
baked.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
bsdf.inputs["Roughness"].default_value = 1.0

keep = {}
for obj in [o for o in scene.objects if o.type == "MESH" and o.name.startswith("flipper-atlas")]:
    part = obj.data.materials[0].name
    keep.setdefault(part, []).append(obj)

final = []
for part, objs in keep.items():
    name = "flipper-body" if part in ("flipper-body", "flipper-dark", "flipper-ring") else part
    for obj in objs:
        obj.name = f"tmp-{name}"
    final.append((name, objs))

merged = {}
for name, objs in final:
    merged.setdefault(name, []).extend(objs)

exported = [screen]
for name, objs in merged.items():
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objs:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    obj.data.name = name
    obj.data.materials.clear()
    obj.data.materials.append(baked)
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    exported.append(obj)

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
