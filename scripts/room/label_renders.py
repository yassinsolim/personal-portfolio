#!/usr/bin/env python3
"""
labels the blockout renders: reads <name>.json next to each <name>.png from
scripts/room/blockout.py and writes <name>_labeled.png. optionally tiles a set
of renders into one sheet.

usage:
  python3 scripts/room/label_renders.py ~/Assets/portfolio-room/blockout [--sheet out.png a b c d]
needs pillow
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FONT_PATHS = ['/System/Library/Fonts/Helvetica.ttc', '/System/Library/Fonts/SFNS.ttf']


def font(size):
    for path in FONT_PATHS:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def place_column(items, top, bottom, gap):
    """spreads boxes down a column near their anchors' heights, no overlaps"""
    items.sort(key=lambda item: item['y'])
    y = top
    for item in items:
        item['by'] = max(y, item['y'] - item['bh'] / 2)
        y = item['by'] + item['bh'] + gap
    # pushed off the bottom: shift the whole run back up
    over = y - gap - bottom
    if over > 0:
        for item in items:
            item['by'] = max(top, item['by'] - over)


def label_image(png, meta):
    im = Image.open(png).convert('RGB')
    w, h = im.size
    scale = w / 1600
    f = font(max(12, round(20 * scale)))
    draw = ImageDraw.Draw(im, 'RGBA')
    pad = round(6 * scale)
    items = [dict(item) for item in meta.get('labels', [])]
    for item in items:
        tw, th = draw.textbbox((0, 0), item['text'], font=f)[2:]
        item['bw'], item['bh'] = tw + 2 * pad, th + 2 * pad
    if not items:
        items = []
    # callouts in two columns, left and right of everything labelled
    xs = sorted(item['x'] for item in items)
    split = xs[len(xs) // 2] if xs else w / 2
    left = [item for item in items if item['x'] < split] if len(items) > 1 else []
    right = [item for item in items if item not in left]
    # pinned to the image margins so the boxes never cover the subject
    margin = 16 * scale
    top = 60 * scale
    for item in left:
        item['bx'] = margin
    for item in right:
        item['bx'] = w - item['bw'] - margin
    if left:
        place_column(left, top, h - 8, 8 * scale)
    if right:
        place_column(right, top, h - 8, 8 * scale)
    for item in left + right:
        x, y = item['x'], item['y']
        box = (item['bx'], item['by'], item['bx'] + item['bw'], item['by'] + item['bh'])
        lx = box[2] if item in left else box[0]
        draw.line((x, y, lx, (box[1] + box[3]) / 2), fill=(255, 255, 255, 220), width=max(1, round(2 * scale)))
        r = max(3, round(5 * scale))
        draw.ellipse((x - r, y - r, x + r, y + r), fill=(255, 61, 165, 255), outline=(255, 255, 255, 255))
        draw.rounded_rectangle(box, radius=round(6 * scale), fill=(12, 12, 16, 205))
        draw.text((box[0] + pad, box[1] + pad - 1), item['text'], font=f, fill=(255, 255, 255, 255))
    title = meta.get('title')
    if title:
        tf = font(max(12, round(22 * scale)))
        tw, th = draw.textbbox((0, 0), title, font=tf)[2:]
        draw.rounded_rectangle((12, 12, 28 + tw, 28 + th + 4), radius=8, fill=(12, 12, 16, 210))
        draw.text((20, 18), title, font=tf, fill=(255, 255, 255, 255))
    out = png.with_name(png.stem + '_labeled.png')
    im.save(out)
    return out


def sheet(out, images, columns=2):
    ims = [Image.open(p).convert('RGB') for p in images]
    w = max(im.size[0] for im in ims)
    h = max(im.size[1] for im in ims)
    rows = (len(ims) + columns - 1) // columns
    canvas = Image.new('RGB', (w * columns, h * rows), (20, 20, 24))
    for i, im in enumerate(ims):
        canvas.paste(im, ((i % columns) * w, (i // columns) * h))
    canvas.save(out)
    return out


if __name__ == '__main__':
    folder = Path(sys.argv[1]).expanduser()
    if '--sheet' in sys.argv:
        i = sys.argv.index('--sheet')
        out = folder / sys.argv[i + 1]
        print(sheet(out, [folder / name for name in sys.argv[i + 2:]]))
        sys.exit(0)
    for meta_path in sorted(folder.glob('*.json')):
        png = meta_path.with_suffix('.png')
        if not png.exists():
            continue
        meta = json.loads(meta_path.read_text())
        print(label_image(png, meta))
