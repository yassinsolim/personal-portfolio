"""checks every loop in static/sounds/race against its engine layout.

for a four-stroke engine the firing frequency is rpm / 60 * cylinders / 2.
this decodes each car's opus sprite, looks at every on-load loop, and reports
how strong the firing order is next to the other orders, plus which order is
the loudest.

usage: python3 scripts/audio/analyze_orders.py
"""
import json
import os
import subprocess
import sys
import tempfile

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import enginekit as ek  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "static", "sounds", "race")

CYLINDERS = {
    "amg-one": 6, "bmw-e92-m3": 8, "amg-c63-507": 8, "amg-c63s-coupe": 8, "bmw-f82-m4": 6,
    "bmw-f90-m5-competition": 8, "bmw-m8-competition-coupe": 8, "mercedes-gt63s-edition-one": 8,
    "toyota-crown-platinum": 4, "ferrari-laferrari": 12, "mclaren-p1": 8, "porsche-918-spyder": 8,
    "lamborghini-aventador-s": 12, "lamborghini-huracan": 10,
}


def order_levels(y, rpm, max_order=12):
    n = len(y)
    spec = np.abs(np.fft.rfft(y * np.hanning(n)))
    f = np.fft.rfftfreq(n, 1 / ek.SR)
    orders = np.arange(0.5, max_order + 0.01, 0.5)
    lv = []
    for o in orders:
        i = int(round(rpm / 60 * o / (f[1] - f[0])))
        lv.append(20 * np.log10(spec[max(0, i - 2):i + 3].max() + 1e-12))
    lv = np.array(lv)
    return orders, lv - lv.max()


def main():
    rows = []
    for car, cyl in CYLINDERS.items():
        man = json.load(open(os.path.join(OUT, f"{car}.json")))
        with tempfile.TemporaryDirectory() as td:
            wav = os.path.join(td, "x.wav")
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", os.path.join(OUT, man["files"]["opus"]),
                            "-ac", "1", "-ar", str(ek.SR), wav], check=True)
            x = ek.load(wav)
        firing = cyl / 2
        ranks = []
        tops = []
        for loop in sorted((l for l in man["loops"] if l["kind"] == "on"), key=lambda l: l["rpm"]):
            a = int(loop["start"] * ek.SR)
            y = x[a:a + int(loop["dur"] * ek.SR)]
            orders, lv = order_levels(y, loop["rpm"])
            # rank of the firing order among all half orders (1 = loudest)
            rank = int((lv > lv[list(orders).index(firing)]).sum()) + 1
            ranks.append(rank)
            tops.append(float(orders[int(np.argmax(lv))]))
            rows.append((car, round(loop["rpm"]), round(loop["rpm"] / 60 * firing, 1), rank, float(orders[int(np.argmax(lv))])))
        print(f"{car:28s} {cyl} cyl, firing order {firing:g}: rank per on loop {ranks}, loudest orders {tops}")
    return rows


if __name__ == "__main__":
    main()
