# assembles the final node layout and writes a glb in site units:
#   room_shell, room_desk, room_pc, room_chair, room_props at the top level,
#   each one mesh with its baked material, with the separate meshes and the
#   empties as children. vertices are in site units, every node transform is
#   identity except the empties' own.
import bpy
from mathutils import Matrix

GROUPS = ('room_shell', 'room_desk', 'room_pc', 'room_chair', 'room_props')
ATLAS_OF = {'room_shell': 'shell', 'room_desk': 'setup', 'room_pc': 'pc',
            'room_chair': 'setup', 'room_props': 'setup'}
SPECIAL = {'screen': 'screen', 'led': 'led', 'glass': 'glass'}


def site_matrix(setup):
    u = setup['units']['per_metre']
    fy = setup['units']['floor_y']
    return Matrix.Translation((0, 0, fy)) @ Matrix.Diagonal((u, u, u, 1.0))


def bake_material(atlas, image_path, greybox):
    name = f'bake_{atlas}'
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    if mat.node_tree is None:
        mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    for n in list(nodes):
        nodes.remove(n)
    out = nodes.new('ShaderNodeOutputMaterial')
    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Roughness'].default_value = 1.0
    bsdf.inputs['Metallic'].default_value = 0.0
    links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    if greybox or not image_path:
        grey = {'setup': 0.18, 'pc': 0.7, 'shell': 0.5}[atlas]
        bsdf.inputs['Base Color'].default_value = (grey, grey, grey, 1.0)
    else:
        tex = nodes.new('ShaderNodeTexImage')
        img = bpy.data.images.load(image_path, check_existing=False)
        img.colorspace_settings.name = 'sRGB'
        tex.image = img
        links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    return mat


def special_material(kind, setup):
    name = SPECIAL[kind]
    mat = bpy.data.materials.get(name + '__export') or bpy.data.materials.new(name + '__export')
    if mat.node_tree is None:
        mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    for n in list(nodes):
        nodes.remove(n)
    out = nodes.new('ShaderNodeOutputMaterial')
    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    ex = setup['export']['materials'][kind]
    bsdf.inputs['Base Color'].default_value = (*ex['color'], 1.0)
    bsdf.inputs['Roughness'].default_value = ex.get('rough', 1.0)
    if kind == 'glass':
        bsdf.inputs['Alpha'].default_value = ex['alpha']
        try:
            mat.surface_render_method = 'BLENDED'
        except AttributeError:
            mat.blend_method = 'BLEND'
    if kind == 'led':
        bsdf.inputs['Emission Color'].default_value = (*ex['color'], 1.0)
        bsdf.inputs['Emission Strength'].default_value = 1.0
    return mat


def export(setup, path, textures=None, export_normals=True):
    """textures: {atlas: png path}; None writes the greybox (flat greys)"""
    greybox = textures is None
    to_site = site_matrix(setup)
    col = bpy.data.collections.new('export')
    bpy.context.scene.collection.children.link(col)
    made = []
    parts = [o for o in bpy.data.objects if o.get('group') in GROUPS]
    # free the final names for the exported copies
    for o in parts:
        o['name0'] = o.name
        o.name = o.name + '__src'
        if o.data is not None:
            o.data.name = o.data.name + '__src'
    for sp in ('screen', 'led', 'glass'):
        src = bpy.data.materials.get(SPECIAL[sp])
        if src:
            src.name = SPECIAL[sp] + '__src'
    for group in GROUPS:
        atlas = ATLAS_OF[group]
        baked = [o for o in parts if o.type == 'MESH' and o.get('group') == group and o.get('atlas') == atlas]
        mat = bake_material(atlas, None if greybox else textures[atlas], greybox)
        copies = []
        for o in baked:
            c = o.copy()
            c.data = o.data.copy()
            for layer in list(c.data.uv_layers):
                if layer.name != 'UVMap':
                    c.data.uv_layers.remove(layer)
            c.data.materials.clear()
            c.data.materials.append(mat)
            c.data.polygons.foreach_set('material_index', [0] * len(c.data.polygons))
            col.objects.link(c)
            copies.append(c)
        bpy.ops.object.select_all(action='DESELECT')
        for c in copies:
            c.select_set(True)
        bpy.context.view_layer.objects.active = copies[0]
        if len(copies) > 1:
            bpy.ops.object.join()
        root = bpy.context.view_layer.objects.active
        root.data.transform(to_site @ root.matrix_world)
        root.matrix_world = Matrix.Identity(4)
        root.name = group
        root.data.name = group
        made.append(root)
        for o in parts:
            if o.get('group') != group or o in baked:
                continue
            if o.type == 'MESH' and o.get('atlas') in SPECIAL:
                c = o.copy()
                c.data = o.data.copy()
                c.data.materials.clear()
                c.data.materials.append(special_material(o['atlas'], setup))
                c.data.transform(to_site @ o.matrix_world)
                c.matrix_world = Matrix.Identity(4)
                col.objects.link(c)
                c.parent = root
                c.matrix_parent_inverse = Matrix.Identity(4)
                c.name = o['name0']
                c.data.name = o['name0']
                made.append(c)
            elif o.type == 'EMPTY':
                loc = to_site @ o.matrix_world.to_translation()
                rot = o.matrix_world.to_3x3().normalized().to_4x4()
                e = bpy.data.objects.new(o['name0'], None)
                col.objects.link(e)
                e.parent = root
                e.matrix_parent_inverse = Matrix.Identity(4)
                e.matrix_world = Matrix.Translation(loc) @ rot
                made.append(e)
    for sp in ('screen', 'led', 'glass'):
        m = bpy.data.materials.get(SPECIAL[sp] + '__export')
        if m:
            m.name = SPECIAL[sp]
    bpy.ops.object.select_all(action='DESELECT')
    for o in made:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_texcoords=True,
        export_normals=export_normals,
        export_materials='EXPORT',
        export_image_format='AUTO' if not greybox else 'NONE',
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_animations=False,
    )
    return made
