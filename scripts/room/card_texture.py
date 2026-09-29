#!/usr/bin/env python3
"""
the small standing credits card on the room v2 desk, in the typewriter
layout of the old desk credits page. the title, closing lines and fonts come
from scripts/build-room-textures.py; the credits are room v2's own (the old
computer and environment models are gone), set large enough to read from the
desk view.

usage: python3 scripts/room/card_texture.py --out <png> [--repo .]
"""
import argparse
import importlib.util
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

CREDITS = [
    ('DEVELOPMENT', [
        ('Yassin Soliman', '2025 - 2026'),
        ('Henry Heffernan', 'Original, 2022'),
        ('Dustin Brett', 'daedalOS, the OS base'),
    ]),
    ('SOUND DESIGN & MUSIC', [('Henry Heffernan', 'Sound & Music')]),
    ('MODELING', [
        ('Yassin Soliman', 'Room v2 setup'),
        ('Henry Heffernan', 'Studio backdrop'),
        ('Sketchfab Artists', 'Car models'),
    ]),
    ('BUILT WITH', [('Three.js', '3D rendering'), ('React', 'Interface')]),
]

ap = argparse.ArgumentParser()
ap.add_argument('--out', required=True)
ap.add_argument('--repo', default='.')
ap.add_argument('--width', type=int, default=1050)
args = ap.parse_args()

spec = importlib.util.spec_from_file_location('room_textures', Path(args.repo) / 'scripts' / 'build-room-textures.py')
rt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rt)

W = args.width
H = round(W * 148 / 105)  # a6 card, 105 x 148 mm
PAPER = (242, 240, 234)
INK = (44, 42, 40)

img = Image.new('RGB', (W, H), PAPER)
ink = Image.new('L', (W, H), 0)
draw = ImageDraw.Draw(ink)
s = W / 1050
left, right, center = 90 * s, W - 90 * s, W / 2
face = rt.font(rt.TYPEWRITER, 38 * s)

# every row has to fit between the margins with a gap between name and role
for _, entries in CREDITS:
    for name, role in entries:
        if face.getlength(name) + face.getlength(role) + 40 * s > right - left:
            raise SystemExit(f'credits row too wide: {name} / {role}')


def line(text, x, y, anchor):
    draw.text((x, y), text, font=face, fill=255, anchor=anchor, stroke_width=max(1, round(1.5 * s)), stroke_fill=255)


y = 140 * s
line(rt.CREDITS_TITLE, center, y, 'ms')
y += 64 * s
line('CREDITS', center, y, 'ms')
y += 100 * s
for header, entries in CREDITS:
    line(header, center, y, 'ms')
    y += 54 * s
    for name, role in entries:
        line(name, left, y, 'ls')
        line(role, right, y, 'rs')
        y += 48 * s
    y += 70 * s
y = H - 140 * s
for text in rt.CREDITS_CLOSING:
    line(text, center, y, 'ms')
    y += 50 * s

soft = ink.filter(ImageFilter.GaussianBlur(0.5 * s))
img.paste(Image.new('RGB', (W, H), INK), (0, 0), soft)
# a faint border like a printed card
ImageDraw.Draw(img).rectangle((24 * s, 24 * s, W - 24 * s, H - 24 * s), outline=(214, 211, 204), width=max(1, round(3 * s)))
Path(args.out).parent.mkdir(parents=True, exist_ok=True)
img.save(args.out)
print('wrote', args.out, img.size)
