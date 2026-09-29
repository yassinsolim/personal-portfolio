# the studio backdrop: today's Background mesh from static/models/World/
# environment.glb (scaled 900x like BakedModel does), in room metres. the flat
# floor gets a few extra coplanar cuts so its uvs can spend more texels near
# the setup and the car (see uv.py)

import bmesh
import bpy
from mathutils import Matrix


def build(b, repo):
    s = b.setup
    u = s['units']['per_metre']
    floor_y = s['units']['floor_y']
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=f'{repo}/static/models/World/environment.glb')
    new = [o for o in bpy.data.objects if o not in before]
    bg = next(o for o in new if o.name.startswith('Background'))
    for o in new:
        if o is not bg:
            bpy.data.objects.remove(o, do_unlink=True)
    for col in list(bg.users_collection):
        col.objects.unlink(bg)
    b.collection('room_shell').objects.link(bg)
    bg.name = 'shell'
    bg.data.name = 'shell'
    # glb units -> site units (x900) -> room metres, blender axes
    k = 900.0 / u
    m = Matrix.Translation((0, 0, -floor_y / u)) @ Matrix.Diagonal((k, k, k, 1.0))
    bg.data.transform(m @ bg.matrix_world)
    bg.matrix_world = Matrix.Identity(4)
    bg.data.materials.clear()
    bg.data.materials.append(b.materials['floor'])
    bg.data.materials.append(b.materials['wall'])
    for layer in list(bg.data.uv_layers):
        bg.data.uv_layers.remove(layer)

    bm = bmesh.new()
    bm.from_mesh(bg.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    zmin = min(v.co.z for v in bm.verts)

    def floor_faces():
        return [f for f in bm.faces if all(abs(v.co.z - zmin) < 1e-5 for v in f.verts)]

    sh = s['shell']
    for axis, cuts in (('x', sh['floor_cuts_x']), ('z', sh['floor_cuts_z'])):
        for c in cuts:
            faces = floor_faces()
            geom = list(faces) + list({e for f in faces for e in f.edges}) + list({v for f in faces for v in f.verts})
            if axis == 'x':
                co, no = (c, 0, 0), (1, 0, 0)
            else:
                co, no = (0, -c, 0), (0, 1, 0)
            bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no, dist=1e-6)
    floor = set(floor_faces())
    for f in bm.faces:
        f.material_index = 0 if f in floor else 1
        f.smooth = False
    bm.normal_update()
    up = sum((f.normal.z for f in floor), 0.0) / max(1, len(floor))
    if up < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(bg.data)
    bm.free()
    bg.data.update()
    bg['atlas'] = 'shell'
    bg['group'] = 'room_shell'
    bg['uv_weight'] = 1.0
    bg['uv_mode'] = 'shell'
    bg['floor_z'] = zmin
    b.objects.append(bg)
    return bg
