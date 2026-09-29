# bake materials from setup.json's palette: plain diffuse colours (the bake
# keeps diffuse only), emitters for the screens and leds, and the card texture
import os

import bpy

from .common import hex_rgb, srgb_to_linear


def _tree(mat):
    if mat.node_tree is None:
        mat.use_nodes = True
    return mat.node_tree


def linear(hex_value):
    return tuple(srgb_to_linear(c) for c in hex_rgb(hex_value))


def make(setup, card_image=None):
    mats = {}
    for key, spec in setup['palette'].items():
        mat = bpy.data.materials.new(key)
        tree = _tree(mat)
        nodes, links = tree.nodes, tree.links
        for n in list(nodes):
            nodes.remove(n)
        out = nodes.new('ShaderNodeOutputMaterial')
        kind = spec.get('kind', 'diffuse')
        if kind == 'emit':
            bb = nodes.new('ShaderNodeBlackbody')
            bb.inputs['Temperature'].default_value = spec['temp']
            em = nodes.new('ShaderNodeEmission')
            em.inputs['Strength'].default_value = spec['strength']
            links.new(bb.outputs['Color'], em.inputs['Color'])
            if spec.get('one_sided'):
                geo = nodes.new('ShaderNodeNewGeometry')
                black = nodes.new('ShaderNodeBsdfDiffuse')
                black.inputs['Color'].default_value = (0, 0, 0, 1)
                mix = nodes.new('ShaderNodeMixShader')
                links.new(geo.outputs['Backfacing'], mix.inputs['Fac'])
                links.new(em.outputs['Emission'], mix.inputs[1])
                links.new(black.outputs['BSDF'], mix.inputs[2])
                links.new(mix.outputs['Shader'], out.inputs['Surface'])
            else:
                links.new(em.outputs['Emission'], out.inputs['Surface'])
            col = spec.get('display', '#dfeaff')
            mat.diffuse_color = (*linear(col), 1.0)
            mat['kind'] = 'emit'
        else:
            bsdf = nodes.new('ShaderNodeBsdfPrincipled')
            rgb = linear(spec['color'])
            bsdf.inputs['Base Color'].default_value = (*rgb, 1.0)
            bsdf.inputs['Roughness'].default_value = spec.get('rough', 0.8)
            links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
            mat.diffuse_color = (*rgb, 1.0)
            if kind == 'glass':
                bsdf.inputs['Alpha'].default_value = spec.get('alpha', 0.12)
                bsdf.inputs['Roughness'].default_value = 0.05
                try:
                    mat.surface_render_method = 'BLENDED'
                except AttributeError:
                    mat.blend_method = 'BLEND'
                mat.diffuse_color = (*rgb, spec.get('alpha', 0.12))
            if kind == 'card' and card_image is not None:
                tex = nodes.new('ShaderNodeTexImage')
                tex.image = card_image
                tex.name = 'card_texture'
                uvn = nodes.new('ShaderNodeUVMap')
                uvn.uv_map = 'CardUV'
                links.new(uvn.outputs['UV'], tex.inputs['Vector'])
                links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
            mat['kind'] = kind
        mat['key'] = key
        mats[key] = mat
    return mats


def load_card(path):
    if not os.path.exists(path):
        return None
    img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = 'sRGB'
    return img
