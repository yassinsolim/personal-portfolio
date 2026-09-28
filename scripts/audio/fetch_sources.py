"""download the raw recordings listed in sources.json into audio-src/.

usage: python3 scripts/audio/fetch_sources.py
the files are big (about 600 MB) and gitignored. only the processed loops in
static/sounds/race/ are committed.
"""
import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
DEST = os.path.join(ROOT, "audio-src")


def main():
    meta = json.load(open(os.path.join(HERE, "sources.json")))
    for rel, info in meta["files"].items():
        path = os.path.join(DEST, rel)
        if os.path.exists(path) and os.path.getsize(path) > 0:
            print("have", rel)
            continue
        os.makedirs(os.path.dirname(path), exist_ok=True)
        print("get ", rel, flush=True)
        req = urllib.request.Request(info["url"], headers={"User-Agent": "curl/8"})
        tmp = path + ".part"
        with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f:
            while True:
                b = r.read(1 << 20)
                if not b:
                    break
                f.write(b)
        os.replace(tmp, path)


if __name__ == "__main__":
    sys.exit(main())
