#!/usr/bin/env python3
"""
recolors the baked room textures (chair, computer, plant soil).

every edit starts from henry's original bakes and is masked by the real uv
islands of each mesh, so recolors cover the whole island plus its bake margin
instead of leaving the old color around the edges. the baked lighting is kept
by scaling the new color with the original shading.

usage: python3 scripts/recolor-room.py   (needs numpy + pillow, full git history)
"""
import io
import json
import struct
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / 'static' / 'models'
# the last commit before the november recolor still has the untouched bakes
ORIGINAL_BAKES_REV = 'b35f2d4^'

CHAIR_LEATHER = (48, 31, 23)  # srgb at the leather's median shade
CHAIR_METAL_SCALE = 0.3  # linear scale for the chrome parts, 1 keeps chrome
SOIL = (46, 33, 24)
CHARCOAL_TINT = np.array([0.98, 0.98, 1.02], np.float32)
# srgb luma for each part's beige plastic
COMPUTER_PLASTIC = {'monitor_base': 0.15, 'computer': 0.15, 'mouse': 0.15, 'keyboard': 0.26}
SOIL_UV = (0.835, 0.552)  # a point inside the soil island on the plant mesh
GROW_PX = 24


def read_glb_uvs(path):
    """returns {node name: [[u0, v0, u1, v1, u2, v2], ...]}"""
    data = path.read_bytes()
    gltf, binary, offset = None, None, 12
    while offset < len(data):
        length, kind = struct.unpack_from('<II', data, offset)
        chunk = data[offset + 8: offset + 8 + length]
        offset += 8 + length
        if kind == 0x4E4F534A:
            gltf = json.loads(chunk)
        elif kind == 0x004E4942:
            binary = chunk

    def accessor(index):
        acc = gltf['accessors'][index]
        view = gltf['bufferViews'][acc['bufferView']]
        width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[acc['type']]
        dtype = np.dtype({5121: np.uint8, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}[acc['componentType']])
        start = view.get('byteOffset', 0) + acc.get('byteOffset', 0)
        stride = view.get('byteStride', width * dtype.itemsize)
        raw = np.frombuffer(binary, np.uint8, acc['count'] * stride, start).reshape(acc['count'], stride)
        values = raw[:, : width * dtype.itemsize].copy().view(dtype).reshape(acc['count'], width)
        if acc.get('normalized'):
            values = values / np.iinfo(dtype).max
        return values.astype(np.float64)

    meshes = {}
    for node in gltf['nodes']:
        if 'mesh' not in node:
            continue
        tris = []
        for prim in gltf['meshes'][node['mesh']]['primitives']:
            uv = accessor(prim['attributes']['TEXCOORD_0'])
            if 'indices' in prim:
                idx = accessor(prim['indices'])[:, 0].astype(np.int64)
            else:
                idx = np.arange(len(uv))
            tris.extend(uv[idx].reshape(-1, 6).tolist())
        meshes[node['name']] = tris
    return meshes


def git_image(rev_path):
    blob = subprocess.run(['git', 'show', rev_path], cwd=ROOT, check=True, capture_output=True).stdout
    return to_float(Image.open(io.BytesIO(blob)))


def to_float(img):
    return np.asarray(img.convert('RGB')).astype(np.float32) / 255.0


def save(arr, path):
    Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8)).save(path, quality=90, optimize=True)


def raster(tris, size):
    img = Image.new('L', (size, size), 0)
    draw = ImageDraw.Draw(img)
    for t in tris:
        draw.polygon([(t[0] * size, t[1] * size), (t[2] * size, t[3] * size), (t[4] * size, t[5] * size)], fill=255)
    return np.asarray(img) > 0


def island_labels(meshes, size):
    """label every uv island by mesh, then hand the bake margin to the nearest island"""
    labels = np.zeros((size, size), np.int32)
    for i, (_, tris) in enumerate(meshes, start=1):
        labels[raster(tris, size) & (labels == 0)] = i
    for _ in range(GROW_PX):
        empty = labels == 0
        for shift in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            moved = np.roll(labels, shift, axis=(0, 1))
            take = empty & (moved > 0)
            labels[take] = moved[take]
            empty &= ~take
    return labels


def rebuild_margin(img, inside, region):
    """push island edge colors back out over the margin, like the bake did"""
    ys, xs = np.nonzero(region)
    y0, y1, x0, x1 = max(ys.min() - 2, 0), ys.max() + 3, max(xs.min() - 2, 0), xs.max() + 3
    out = img[y0:y1, x0:x1].copy()
    filled = inside[y0:y1, x0:x1].copy()
    todo = region[y0:y1, x0:x1] & ~filled
    for _ in range(GROW_PX + 4):
        if not todo.any():
            break
        total = np.zeros_like(out)
        count = np.zeros(out.shape[:2], np.float32)
        for shift in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            ok = np.roll(filled, shift, axis=(0, 1))
            total += np.roll(out, shift, axis=(0, 1)) * ok[..., None]
            count += ok
        new = todo & (count > 0)
        out[new] = total[new] / count[new][:, None]
        filled |= new
        todo &= ~new
    result = img.copy()
    result[y0:y1, x0:x1] = out
    return result


def to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def lum(rgb):
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def reshade(orig, color, ref_mask):
    """new albedo times the original's lighting ratio, done in linear light"""
    lin = to_linear(orig)
    y = lum(lin)
    target = to_linear(np.array(color, np.float32) / 255)
    return to_srgb(target * (y / np.median(y[ref_mask]))[..., None]), lin


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def environment():
    orig = git_image(f'{ORIGINAL_BAKES_REV}:static/models/World/baked_environment.jpg')
    uv = read_glb_uvs(MODELS / 'World' / 'environment.glb')
    names = ['Background', 'desk', 'chair_base', 'chair_seat']
    labels = island_labels([(n, uv[n]) for n in names], orig.shape[0])
    seat = labels == names.index('chair_seat') + 1
    # leather is the saturated warm part of the seat, the rest is chrome and black plastic
    spread = orig.max(axis=-1) - orig.min(axis=-1)
    sat = np.where(orig.max(axis=-1) > 1e-4, spread / np.maximum(orig.max(axis=-1), 1e-4), 0)
    leather_w = smoothstep(0.15, 0.32, sat) * (orig[..., 0] > orig[..., 2] + 0.04) * seat
    leather, lin = reshade(orig, CHAIR_LEATHER, seat & (leather_w > 0.9))
    metal = to_srgb(lin * CHAIR_METAL_SCALE)
    w = leather_w[..., None]
    out = orig.copy()
    out[seat] = (w * leather + (1 - w) * metal)[seat]
    return rebuild_margin(out, raster(uv['chair_seat'], orig.shape[0]), seat)


def computer():
    orig = git_image(f'{ORIGINAL_BAKES_REV}:static/models/Computer/baked_computer.jpg')
    uv = read_glb_uvs(MODELS / 'Computer' / 'computer_setup.glb')
    names = list(uv)
    labels = island_labels([(n, uv[n]) for n in names], orig.shape[0])
    luma = lum(orig)
    out = orig.copy()
    black = 0.02
    for i, name in enumerate(names, start=1):
        if name not in COMPUTER_PLASTIC:
            continue
        part = labels == i
        # the background is black, so the margin maps to black and needs no rebuild
        scale = (COMPUTER_PLASTIC[name] - black) / max(np.percentile(luma[part], 75) - black, 1e-3)
        shade = np.clip(luma * scale + black * (1 - scale), 0, 1)
        out[part] = (shade[..., None] * CHARCOAL_TINT)[part]
    return out


def point_in_triangle(t, u, v):
    x0, y0, x1, y1, x2, y2 = t
    d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
    if abs(d) < 1e-12:
        return False
    a = ((y1 - y2) * (u - x2) + (x2 - x1) * (v - y2)) / d
    b = ((y2 - y0) * (u - x2) + (x0 - x2) * (v - y2)) / d
    return a >= 0 and b >= 0 and a + b <= 1


def uv_island(tris, u, v):
    """the island (triangles sharing uv verts) that contains the point"""
    parent = list(range(len(tris)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    owner = {}
    for i, t in enumerate(tris):
        for k in range(3):
            key = (round(t[2 * k], 5), round(t[2 * k + 1], 5))
            if key in owner:
                parent[find(i)] = find(owner[key])
            else:
                owner[key] = i
    hit = next(i for i, t in enumerate(tris) if point_in_triangle(t, u, v))
    return [t for i, t in enumerate(tris) if find(i) == find(hit)]


def decor():
    orig = to_float(Image.open(MODELS / 'Decor' / 'baked_decor.jpg'))
    uv = read_glb_uvs(MODELS / 'Decor' / 'decor.glb')
    soil = uv_island(uv['plant'], *SOIL_UV)
    soil_set = {tuple(t) for t in soil}
    meshes = [(n, t) for n, t in uv.items() if n != 'plant']
    meshes += [('plant', [t for t in uv['plant'] if tuple(t) not in soil_set]), ('soil', soil)]
    region = island_labels(meshes, orig.shape[0]) == len(meshes)
    luma = lum(orig)
    painted, _ = reshade(orig, SOIL, region & (luma > np.percentile(luma[region], 40)))
    out = orig.copy()
    out[region] = painted[region]
    return rebuild_margin(out, raster(soil, orig.shape[0]), region)


if __name__ == '__main__':
    save(environment(), MODELS / 'World' / 'baked_environment.jpg')
    save(computer(), MODELS / 'Computer' / 'baked_computer.jpg')
    save(decor(), MODELS / 'Decor' / 'baked_decor_modified.jpg')
    print('wrote baked_environment.jpg, baked_computer.jpg, baked_decor_modified.jpg')
