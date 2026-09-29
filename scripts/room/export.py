# writes the raw room glb for one tier from its baked .blend: the final node
# layout (exporter.py), baked materials bake_setup, bake_pc and bake_shell with
# the tier's atlas pngs, site units. scripts/room/pack-room.mjs turns it into
# the draco + webp and draco + ktx2 files in static/models/Room.
#
#   blender -b <out>/room_v2_<tier>.blend --python scripts/room/export.py -- \
#       --out ~/Assets/portfolio-room/v2 --tier high
import argparse
import json
import os
import sys


HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import exporter  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--out', required=True)
ap.add_argument('--tier', default='high')
args = ap.parse_args(argv)
OUT = os.path.abspath(os.path.expanduser(args.out))
with open(os.path.join(HERE, 'setup.json')) as fh:
    SETUP = json.load(fh)

textures = {a: os.path.join(OUT, 'atlas', f'{args.tier}_{a}.png') for a in ('setup', 'pc', 'shell')}
for a, p in textures.items():
    if not os.path.exists(p):
        raise SystemExit(f'missing atlas {p}: run bake.py for this tier first')
os.makedirs(os.path.join(OUT, 'export'), exist_ok=True)
path = os.path.join(OUT, 'export', 'room_v2.raw.glb' if args.tier == 'high' else 'room_v2.low.raw.glb')
exporter.export(SETUP, path, textures=textures)
print('exported', path)
