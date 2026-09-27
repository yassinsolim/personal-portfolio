#!/usr/bin/env python3
"""
builds the baked room textures: recolors (chair, computer, plant soil), the
credits page on the desk, and the yassin co. computer labels.

every edit starts from henry's original bakes and is masked by the real uv
islands of each mesh, so recolors cover the whole island plus its bake margin
instead of leaving the old color around the edges. the baked lighting is kept
by scaling the new color with the original shading.

writes a 4k and a 2k copy of each texture. the 2k ones are for mobile and
low power devices (see src/Application/sources.ts).

usage: python3 scripts/build-room-textures.py
needs numpy + pillow, full git history, and courier new + arial (macos has them)
"""
import io
import json
import random
import struct
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

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
SMALL_SIZE = 2048

CREDITS_TITLE = '\u201cYassin Soliman Showcase 2026\u201d'
CREDITS = [
    ('DEVELOPMENT', [
        ('Yassin Soliman', '2025 - 2026'),
        ('Henry Heffernan', 'Original (2022)'),
        ('Dustin Brett', 'daedalOS (OS base)'),
    ]),
    ('SOUND DESIGN & MUSIC', [('Henry Heffernan', 'Sound & Music')]),
    ('MODELING & TEXTURING', [
        ('Henry Heffernan', 'Texturing + UV'),
        ('Mickael Boitte', 'Computer Model'),
        ('Sean Nicolas', 'Environment Models'),
        ('Sketchfab Artists', 'Car Models'),
    ]),
    ('BUILT WITH', [('Three.js', '3D Rendering'), ('React', 'Interface')]),
]
CREDITS_CLOSING = ['Thank you so much for checking out', 'my portfolio website <3']

LABEL = {
    'title': 'YASSINVERSE XX 420',
    'maker': 'Yassin Co.',
    'blurb': [
        'Nested sandboxing since 1986. This machine runs',
        'yassinOS inside a website inside a 3D room, and',
        'shows off everything Yassin Co. has to offer!',
    ],
    'specs': [('Model No.', 'XX 420'), ('AC Input', '100-240Vac'), ('', '50/60Hz')],
    'origin': 'Assembled in Calgary',
    'brand': 'Yassin Co.',
    'brand_sub': 'yassinverse',
}

# pixel layout of henry's bakes (4k)
PAGE_BOX = (80, 160, 1955, 2800)  # inside the paper island, away from its edge
PAGE_LEFT, PAGE_RIGHT, PAGE_CENTER = 401, 1589, 995
PAGE_INK = (124, 121, 120)
MONITOR_LABEL_BOX = (1695, 534, 1835, 748)  # text runs bottom to top
TOWER_LABEL_BOX = (2774, 3294, 2994, 3439)
KEYBOARD_BADGE_BOX = (2256, 1920, 2410, 1988)

FONT_DIRS = [
    Path('/System/Library/Fonts/Supplemental'),
    Path('/Library/Fonts'),
    Path('/usr/share/fonts/truetype/msttcorefonts'),
]
TYPEWRITER = ['Courier New Bold.ttf', 'courbd.ttf']
SANS = ['Arial.ttf', 'arial.ttf']
SANS_BOLD_ITALIC = ['Arial Bold Italic.ttf', 'arialbi.ttf']


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
    img = Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8))
    img.save(path, quality=90, optimize=True)
    small = img.resize((SMALL_SIZE, SMALL_SIZE), Image.LANCZOS)
    small.save(path.with_name(f'{path.stem}_2k.jpg'), quality=90, optimize=True)


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


def font(names, size):
    for folder in FONT_DIRS:
        for name in names:
            if (folder / name).exists():
                return ImageFont.truetype(str(folder / name), int(size))
    raise SystemExit(f'missing font: tried {names} in {[str(f) for f in FONT_DIRS]}')


def fit_font(names, text, max_width, size):
    """largest font (up to size) that keeps text inside max_width"""
    while size > 6:
        candidate = font(names, size)
        if candidate.getlength(text) <= max_width:
            return candidate
        size *= 0.95
    return font(names, size)


def blend(img, box, rgb, alpha):
    x0, y0, x1, y1 = box
    a = np.asarray(alpha).astype(np.float32)[..., None] / 255
    color = np.asarray(rgb).astype(np.float32) / 255
    img[y0:y1, x0:x1] = img[y0:y1, x0:x1] * (1 - a) + color * a


def blank_paper(page, block=48):
    """paper without the old ink: per-block mean of the paper pixels, smoothed back up"""
    h, w, _ = page.shape
    gh, gw = -(-h // block), -(-w // block)
    padded = np.pad(page, ((0, gh * block - h), (0, gw * block - w), (0, 0)), mode='edge')
    luma = lum(padded)
    keep = (luma > np.percentile(luma, 40))[..., None]
    sums = (padded * keep).reshape(gh, block, gw, block, 3).sum(axis=(1, 3))
    counts = keep.reshape(gh, block, gw, block, 1).sum(axis=(1, 3))
    overall = (padded * keep).sum(axis=(0, 1)) / keep.sum()
    grid = np.where(counts > 0, sums / np.maximum(counts, 1), overall)
    small = Image.fromarray((grid * 255 + 0.5).astype(np.uint8))
    smooth = small.resize((gw * block, gh * block), Image.BILINEAR).filter(ImageFilter.GaussianBlur(block / 2))
    return np.asarray(smooth).astype(np.float32)[:h, :w] / 255


def credits_page(img):
    """retype the credits sheet on the desk in henry's typewriter layout"""
    x0, y0, x1, y1 = PAGE_BOX
    ink = Image.new('L', (x1 - x0, y1 - y0), 0)
    draw = ImageDraw.Draw(ink)
    typewriter = font(TYPEWRITER, 57)

    def line(text, x, baseline, anchor):
        # a 1px stroke gets courier new up to the weight of henry's typewriter face
        draw.text((x - x0, baseline - y0), text, font=typewriter, fill=255, anchor=anchor,
                  stroke_width=1, stroke_fill=255)

    # baselines follow henry's sheet
    line(CREDITS_TITLE, PAGE_CENTER, 343, 'ms')
    line('CREDITS', PAGE_CENTER, 438, 'ms')
    baseline = 697
    for header, entries in CREDITS:
        line(header, PAGE_CENTER, baseline, 'ms')
        baseline += 83
        for name, role in entries:
            line(name, PAGE_LEFT, baseline, 'ls')
            line(role, PAGE_RIGHT, baseline, 'rs')
            baseline += 57.5
        baseline += 280 - 57.5
    for i, text in enumerate(CREDITS_CLOSING):
        line(text, PAGE_CENTER, 2584 + 65 * i, 'ms')

    out = img.copy()
    out[y0:y1, x0:x1] = blank_paper(img[y0:y1, x0:x1])
    blend(out, PAGE_BOX, PAGE_INK, ink.filter(ImageFilter.GaussianBlur(0.6)))
    return out


def globe(draw, cx, cy, r, color, width):
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), outline=color, width=width)
    draw.ellipse((cx - r * 0.45, cy - r, cx + r * 0.45, cy + r), outline=color, width=width)
    draw.line((cx, cy - r, cx, cy + r), fill=color, width=width)
    for k in (-0.5, 0, 0.5):
        half = r * (1 - k * k) ** 0.5
        draw.line((cx - half, cy + k * r, cx + half, cy + k * r), fill=color, width=width)


def barcode(draw, box, color, unit):
    rng = random.Random(1986)
    x0, y0, x1, y1 = box
    x = x0
    while x < x1:
        width = rng.choice((1, 1, 2, 3)) * unit  # NOSONAR seeded so the barcode art rebuilds the same
        draw.rectangle((x, y0, min(x + width, x1), y1), fill=color)
        x += width + rng.choice((1, 1, 2)) * unit  # NOSONAR


LABEL_BG = (16, 16, 18)
LABEL_INK = (206, 206, 210)
LABEL_DIM = (158, 158, 164)
BADGE_BG = (48, 48, 51)
BADGE_INK = (168, 168, 174)


def label_art(width, height):
    """henry's product label layout with yassin co. text, drawn 4x and shrunk"""
    s = 4
    w, h = width * s, height * s
    art = Image.new('RGB', (w, h), LABEL_BG)
    shape = Image.new('L', (w, h), 0)
    ImageDraw.Draw(shape).rounded_rectangle((0, 0, w - 1, h - 1), radius=int(h * 0.07), fill=255)
    draw = ImageDraw.Draw(art)
    left, inner = w * 0.06, w * 0.88
    small = font(SANS, h * 0.05)

    draw.text((left, h * 0.2), LABEL['title'], fill=LABEL_INK, anchor='ls',
              font=fit_font(SANS_BOLD_ITALIC, LABEL['title'], inner, h * 0.12))
    draw.text((left, h * 0.3), LABEL['maker'], fill=LABEL_INK, anchor='ls',
              font=font(SANS_BOLD_ITALIC, h * 0.075))
    for i, text in enumerate(LABEL['blurb']):
        draw.text((left, h * (0.44 + 0.065 * i)), text, fill=LABEL_DIM, anchor='ls',
                  font=fit_font(SANS, text, inner, h * 0.05))
    for i, (key, value) in enumerate(LABEL['specs']):
        y = h * (0.68 + 0.065 * i)
        draw.text((left, y), key, font=small, fill=LABEL_DIM, anchor='ls')
        draw.text((left + w * 0.17, y), value, font=small, fill=LABEL_DIM, anchor='ls')
    draw.text((left, h * 0.92), LABEL['origin'], font=small, fill=LABEL_DIM, anchor='ls')

    r = h * 0.07
    gx, gy = w * 0.56, h * 0.7
    globe(draw, gx, gy, r, LABEL_INK, s)
    text_x = gx + r * 1.5
    draw.text((text_x, gy + r * 0.2), LABEL['brand'], fill=LABEL_INK, anchor='ls',
              font=fit_font(SANS_BOLD_ITALIC, LABEL['brand'], w * 0.95 - text_x, h * 0.12))
    draw.text((text_x + r * 0.1, gy + r * 1.1), LABEL['brand_sub'], fill=LABEL_INK, anchor='ls',
              font=font(SANS_BOLD_ITALIC, h * 0.065))
    barcode(draw, (w * 0.55, h * 0.82, w * 0.94, h * 0.93), LABEL_INK, s)
    return art.resize((width, height), Image.LANCZOS), shape.resize((width, height), Image.LANCZOS)


def keyboard_badge_art(width, height):
    s = 4
    w, h = width * s, height * s
    art = Image.new('RGB', (w, h), BADGE_BG)
    shape = Image.new('L', (w, h), 0)
    ImageDraw.Draw(shape).rounded_rectangle((0, 0, w - 1, h - 1), radius=int(h * 0.18), fill=255)
    draw = ImageDraw.Draw(art)
    r = h * 0.3
    gx, gy = h * 0.55, h * 0.5
    globe(draw, gx, gy, r, BADGE_INK, 2 * s)
    text_x = gx + r * 1.5
    draw.text((text_x, h * 0.54), LABEL['brand'], fill=BADGE_INK, anchor='ls',
              font=fit_font(SANS_BOLD_ITALIC, LABEL['brand'], w * 0.95 - text_x, h * 0.4))
    draw.text((text_x + r * 0.1, h * 0.82), LABEL['brand_sub'], fill=BADGE_INK, anchor='ls',
              font=font(SANS_BOLD_ITALIC, h * 0.2))
    return art.resize((width, height), Image.LANCZOS), shape.resize((width, height), Image.LANCZOS)


def computer_labels(img):
    out = img.copy()
    x0, y0, x1, y1 = TOWER_LABEL_BOX
    art, shape = label_art(x1 - x0, y1 - y0)
    blend(out, TOWER_LABEL_BOX, art, shape)
    x0, y0, x1, y1 = MONITOR_LABEL_BOX
    art, shape = label_art(y1 - y0, x1 - x0)
    blend(out, MONITOR_LABEL_BOX, art.rotate(90, expand=True), shape.rotate(90, expand=True))
    x0, y0, x1, y1 = KEYBOARD_BADGE_BOX
    art, shape = keyboard_badge_art(x1 - x0, y1 - y0)
    blend(out, KEYBOARD_BADGE_BOX, art, shape)
    return out


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
    return computer_labels(out)


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
    return credits_page(rebuild_margin(out, raster(soil, orig.shape[0]), region))


if __name__ == '__main__':
    outputs = [
        (environment, MODELS / 'World' / 'baked_environment.jpg'),
        (computer, MODELS / 'Computer' / 'baked_computer.jpg'),
        (decor, MODELS / 'Decor' / 'baked_decor_modified.jpg'),
    ]
    for build, path in outputs:
        save(build(), path)
        print('wrote', path.relative_to(ROOT), 'and its _2k copy')
