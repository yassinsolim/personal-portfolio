#!/usr/bin/env python3
"""
the small credits card that lies on the room v2 desk. the text is the desk
credits page from scripts/build-room-textures.py (imported, so there's one
copy of the credits), set in the same typewriter layout on a card.

usage: python3 scripts/room/card_texture.py --out <png> [--repo .]
"""
import argparse
import importlib.util
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

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
INK = (58, 56, 54)

img = Image.new('RGB', (W, H), PAPER)
ink = Image.new('L', (W, H), 0)
draw = ImageDraw.Draw(ink)
s = W / 1050
left, right, center = 110 * s, W - 110 * s, W / 2
lines = 2 + sum(1 + len(entries) for _, entries in rt.CREDITS) + len(rt.CREDITS_CLOSING)
size = 30 * s
face = rt.font(rt.TYPEWRITER, size)


def line(text, x, y, anchor):
    draw.text((x, y), text, font=face, fill=255, anchor=anchor, stroke_width=max(1, round(s)), stroke_fill=255)


y = 150 * s
line(rt.CREDITS_TITLE, center, y, 'ms')
y += 58 * s
line('CREDITS', center, y, 'ms')
y += 110 * s
for header, entries in rt.CREDITS:
    line(header, center, y, 'ms')
    y += 46 * s
    for name, role in entries:
        line(name, left, y, 'ls')
        line(role, right, y, 'rs')
        y += 38 * s
    y += 74 * s
y = H - 150 * s
for text in rt.CREDITS_CLOSING:
    line(text, center, y, 'ms')
    y += 42 * s

soft = ink.filter(ImageFilter.GaussianBlur(0.5 * s))
img.paste(Image.new('RGB', (W, H), INK), (0, 0), soft)
# a faint border like a printed card
ImageDraw.Draw(img).rectangle((24 * s, 24 * s, W - 24 * s, H - 24 * s), outline=(214, 211, 204), width=max(1, round(3 * s)))
Path(args.out).parent.mkdir(parents=True, exist_ok=True)
img.save(args.out)
print('wrote', args.out, img.size)
