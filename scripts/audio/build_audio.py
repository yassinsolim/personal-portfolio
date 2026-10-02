"""builds the per-car race audio sprites in static/sounds/race/.

usage:
  python3 scripts/audio/fetch_sources.py          # once, about 600 MB
  python3 scripts/audio/build_audio.py            # every car + the shared sprite
  python3 scripts/audio/build_audio.py bmw-f82-m4 # just one

needs numpy, scipy, soundfile and ffmpeg (with libopus). each car ends up as
one opus/webm file, one aac/m4a fallback and a json manifest that says where
every loop and one-shot sits in the file.
"""
import json
import math
import os
import subprocess
import sys
import tempfile

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import enginekit as ek  # noqa: E402
import enginesynth as es  # noqa: E402
import specs  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SRC = os.path.join(ROOT, "audio-src")
OUT = os.path.join(ROOT, "static", "sounds", "race")
CACHE = os.path.join(SRC, ".cache")
SR = ek.SR

I6 = ([1.5, 3, 4.5, 6, 7.5, 9], [1.0, 1.2, 0.8, 1.0, 0.5, 0.6])
V8X = ([0.5 * k for k in range(1, 17)], [1.0 + (0.8 if k in (4, 8) else 0.0) for k in range(1, 17)])
V12 = ([3, 6, 9, 12, 18], [0.6, 1.0, 0.5, 0.7, 0.4])
V10 = ([2.5, 5, 7.5, 10, 15], [0.6, 1.0, 0.5, 0.7, 0.4])
V8F = ([2, 4, 6, 8, 12], [0.6, 1.0, 0.5, 0.7, 0.4])
FAMILIES = {"i6": I6, "v8x": V8X, "v12": V12, "v10": V10, "v8f": V8F}

LOOP_RMS_DB = -20.0
MARGIN_S = 0.05
GAP_S = 0.02
SHOT_PAD_S = 0.06


# ---------------------------------------------------------------- recordings

def src(rel):
    return os.path.join(SRC, rel)


def load_clip(rel, t0, t1, channel="mix"):
    if channel == "mix":
        return ek.load(src(rel), t0, t1)
    x = ek.load(src(rel), t0, t1, mono=False)
    return x[:, 0 if channel == "L" else 1].copy()


def tracked(rel, t0, t1, lo, hi, family, channel="mix", nfft=4096):
    """load a clip and its rpm track, cached on disk."""
    os.makedirs(CACHE, exist_ok=True)
    key = f"{rel.replace('/', '_')}_{t0}_{t1}_{lo}_{hi}_{family}_{channel}_{nfft}.npz"
    path = os.path.join(CACHE, key)
    x = load_clip(rel, t0, t1, channel)
    if os.path.exists(path):
        d = np.load(path)
        return x, d["t"], d["rpm"]
    orders, weights = FAMILIES[family]
    t, rpm = ek.track_rpm(x, lo, hi, orders, weights, nfft=nfft, hop=240)
    np.savez(path, t=t, rpm=rpm)
    return x, t, rpm


def recorded_loop(pieces, r0, seconds, delta=0.06, seed=0, min_corr=0.15, min_cycles=3):
    """cycle loop at r0 from every stretch of the recordings near that rpm.
    returns None when there isn't enough material or the cycles don't line
    up (a sign the rpm track was off there)."""
    y = ek.gather(pieces, r0, delta=delta, min_cycles=min_cycles)
    if y is None or len(y) < 4 * 120.0 / r0 * SR:
        return None
    rng = np.random.default_rng(seed + int(r0))
    loop, info = ek.cycle_loop(y, r0, seconds, rng=rng)
    info["material_s"] = len(y) / SR
    print(f"    loop {r0:.0f} rpm: {info['material_s']:.2f}s of material, cycle match {info['corr_mean']:.2f} (min {info['corr_min']:.2f})")
    if info["corr_mean"] < min_corr:
        print(f"    dropped {r0:.0f} rpm, cycles don't line up")
        return None
    return loop, info


def synth_fill(spec, rpms, match_on, match_off, seconds=1.1, above=False):
    """synth loops for rpm the recordings don't cover, eq'd so their tone
    lines up with the recorded loop they crossfade into (the lowest one, or
    the highest when filling above)."""
    on = [es.render_loop(spec, r, 1.0, seconds) for r in rpms]
    off = [es.render_loop(spec, r, 0.0, seconds, variant=2) for r in rpms]
    edge = 0 if above else -1
    c_on, d_on = match_eq([on[edge][0]], match_on, max_db=14)
    c_off, d_off = match_eq([off[edge][0]], match_off, max_db=14)
    out = []
    for (l, r), (lo, ro) in zip(on, off):
        out.append(("on", r, es.circular_eq(l, c_on, d_on), f"synth {spec.name} matched to the recording"))
        out.append(("off", ro, es.circular_eq(lo, c_off, d_off), f"synth {spec.name} matched to the recording"))
    return out


def load_eq(loop, amount=1.0):
    """what full throttle adds over a light-load hold: more low mid and bite."""
    return es.circular_eq(loop, [30, 90, 200, 500, 1200, 3000, 8000, 20000],
                          [0, 2.5 * amount, 3.5 * amount, 2.5 * amount, 3.0 * amount, 2.0 * amount, 0.5 * amount, 0])


def overrun_eq(loop):
    """closed throttle: thinner low end, a little more intake hiss on top."""
    return es.circular_eq(loop, [30, 100, 250, 600, 2000, 5000, 20000],
                          [-7, -6, -4, -2, 0, 1, 0])


def match_eq(loops, reference, max_db=9.0, smooth=3):
    """eq that moves the average spectrum of loops toward the reference."""
    edges = np.geomspace(40, 14000, 28)
    _, ref = ek.band_levels(reference, edges=edges)
    have = np.mean([ek.band_levels(l, edges=edges)[1] for l in loops], axis=0)
    diff = ref - have
    k = np.ones(smooth) / smooth
    diff = np.convolve(np.pad(diff, smooth // 2, mode="edge"), k, mode="valid")
    diff = np.clip(diff - np.median(diff), -max_db, max_db)
    centers = np.sqrt(edges[:-1] * edges[1:])
    return centers, diff


def envelope_blend(loops, amount=0.5):
    """pull each loop's spectral envelope part way to the set's average, so
    loops cut from different distances don't jump in tone."""
    edges = np.geomspace(40, 14000, 22)
    levels = [ek.band_levels(l, edges=edges)[1] for l in loops]
    avg = np.mean(levels, axis=0)
    centers = np.sqrt(edges[:-1] * edges[1:])
    out = []
    for l, lv in zip(loops, levels):
        d = np.clip((avg - lv) * amount, -6, 6)
        out.append(es.circular_eq(l, centers, d))
    return out


# ---------------------------------------------------------------- one-shots

def synth_shots(muffle, pops=True, turbo=False, seed=0):
    shots = []
    if pops:
        for i in range(4):
            shots.append(("pop", es.pop(seed=seed + i, size=0.4 + 0.2 * i, muffle=muffle)))
        for i in range(2):
            shots.append(("crackle", es.crackle(seed=seed + 10 + i, count=5 + 2 * i, spread=0.3 + 0.1 * i, muffle=muffle)))
        shots.append(("shift", es.crackle(seed=seed + 20, count=3, spread=0.07, muffle=muffle)))
    if turbo:
        shots.append(("bov", es.blowoff(seed=seed + 30)))
    return shots


def recorded_shot(rel, t0, t1, channel="mix", fade_in=0.004, fade_out=0.08, hp=None, lp=None):
    x = load_clip(rel, t0, t1, channel)
    if hp:
        x = ek.highpass(x, hp)
    if lp:
        x = ek.lowpass(x, lp)
    a = int(fade_in * SR)
    b = int(fade_out * SR)
    x[:a] *= np.linspace(0, 1, a)
    x[-b:] *= np.linspace(1, 0, b)
    return x / (np.abs(x).max() + 1e-9)


# ---------------------------------------------------------------- cars

def car_m4():
    t7 = "pp-bmw-m4-2014/t7_ext_idle_blips_steady.wav"
    t4 = "pp-bmw-m4-2014/t4_onboard_engine.wav"
    loops = []
    idle = [tracked(t7, 6, 19, 650, 800, "i6", nfft=16384)]
    l, info = recorded_loop(idle, float(np.median(idle[0][2])), 2.0)
    loops.append(("idle", info["rpm"], l, "t7 exterior idle"))
    holds = {
        1530: (64.5, 69, 1300, 1750),
        2950: (78, 83, 2600, 3400),
        3730: (99.5, 105.5, 3400, 4100),
        4970: (108, 115, 4500, 5500),
    }
    base = {}
    for r, (a, b, lo, hi) in holds.items():
        p = [tracked(t7, a, b, lo, hi, "i6", nfft=8192)]
        r0 = float(np.median(p[0][2]))
        l, info = recorded_loop(p, r0, 1.3, delta=0.08)
        base[r] = (info["rpm"], l)
    blips = [tracked(t7, 116, 119.6, 4000, 7200, "i6")]
    l, info = recorded_loop(blips, 6100, 1.0, delta=0.06)
    base[6100] = (info["rpm"], l)
    # on throttle comes from the onboard take: pulls from the whole drive,
    # including the full throttle gearshift runs
    sweeps = [tracked(t4, a, b, lo, hi, "i6") for a, b, lo, hi in
              [(31.0, 33.2, 1200, 3600), (35.0, 37.0, 1500, 4500), (38.2, 40.2, 1500, 4500),
               (40.6, 52.2, 2200, 4200), (83.5, 89.0, 1400, 4200), (93.2, 106.0, 2400, 4600),
               (15.6, 17.5, 3400, 7700), (17.8, 20.4, 4800, 7000), (20.7, 22.5, 5000, 6200), (111, 116.5, 3800, 7000)]]
    on = {}
    for r in (1700, 2400, 3100, 3800, 4500, 5300, 6100, 6900, 7400):
        got = recorded_loop(sweeps, r, 1.1, delta=0.05)
        if got:
            on[r] = got
    # the engine bay mic is far brighter than the exterior pair. meet in the
    # middle: darken the onboard loops most of the way, brighten the holds a bit
    centers, diff = match_eq([on[r][0] for r in on], np.concatenate([b[1] for b in base.values()]), max_db=16)
    for r, (l, info) in on.items():
        l = es.circular_eq(l, centers, 0.7 * diff)
        loops.append(("on", info["rpm"], l, "t4 onboard pulls, eq pulled toward the t7 exterior tone"))
    for r, (rr, l) in base.items():
        l = es.circular_eq(l, centers, -0.25 * diff)
        loops.append(("off", rr, overrun_eq(l) if r >= 3000 else l, "t7 exterior neutral hold"))
    shots = synth_shots(muffle=0.35, turbo=True, seed=40)
    shots.append(("start", recorded_shot(t7, 0.2, 2.8, fade_out=0.5)))
    return {"source": "recorded", "loops": loops, "shots": shots, "notes": "pole position bmw m4 2014 (f82, s55)"}


def car_c63_507():
    t3 = "pp-amg-c63-2009/t3_ext_start_fast_away.wav"
    loops = []
    idle = [tracked(t3, 8, 16.5, 1050, 1350, "v8x", channel="L", nfft=16384)]
    l, info = recorded_loop(idle, float(np.median(idle[0][2])), 2.0)
    loops.append(("idle", info["rpm"], l, "t3 exterior idle"))
    pulls = [tracked(t3, a, b, lo, hi, "v8x", channel="L") for a, b, lo, hi in
             [(45.2, 47.2, 3000, 7200), (48.25, 50.15, 4500, 7000), (50.45, 54.65, 4300, 6600),
              (54.9, 57.2, 4200, 5400), (28.5, 34.5, 1500, 4500)]]
    on = []
    for r in (2300, 3000, 3700, 4400, 5100, 5700, 6300):
        got = recorded_loop(pulls, r, 1.1, delta=0.06)
        if got:
            on.append((r, got))
    blended = envelope_blend([g[0] for _, g in on], 0.5)
    for (r, (l, info)), lb in zip(on, blended):
        loops.append(("on", info["rpm"], lb, "t3 exterior pull away"))
        loops.append(("off", info["rpm"], overrun_eq(lb), "t3 exterior pull with overrun eq"))
    lowest = min((l for l in loops if l[0] == "on"), key=lambda l: l[1])
    below = [r for r in (1600, 2300, 3000) if r < lowest[1] * 0.9]
    loops += synth_fill(specs.mercedes_v8("m156"), below, lowest[2], overrun_eq(lowest[2]))
    shots = synth_shots(muffle=0.1, turbo=False, seed=50)
    shots.append(("start", recorded_shot(t3, 2.6, 5.0, channel="L", fade_out=0.5)))
    return {"source": "recorded", "loops": loops, "shots": shots, "notes": "pole position mercedes amg c63 2009 (w204, m156)"}


def car_gtr_based(variant):
    ext = "pp-amg-gtr-2018/t13_ext_fast_away.wav"
    loops = []
    idle = [tracked(ext, 1.5, 3.6, 800, 1050, "v8x", channel="L", nfft=8192)]
    l, info = recorded_loop(idle, float(np.median(idle[0][2])), 1.4)
    loops.append(("idle", info["rpm"], l, "gt r exterior idle"))
    pulls = [tracked(ext, a, b, lo, hi, "v8x", channel="L") for a, b, lo, hi in
             [(4.0, 7.6, 2500, 7400), (7.7, 9.2, 4500, 7000), (9.3, 11.7, 4500, 7000), (11.8, 16.9, 4000, 6500)]]
    on = []
    for r in (3000, 3700, 4400, 5100, 5700, 6300):
        got = recorded_loop(pulls, r, 1.1, delta=0.06)
        if got:
            on.append((r, got))
    blended = envelope_blend([g[0] for _, g in on], 0.5)
    tone = {
        # c63 s coupe: shorter car, rawer and brighter
        "c63s": ([60, 150, 400, 1500, 4000, 12000], [1.5, 1.0, 0, 1.5, 2.0, 0]),
        # gt63 s 4-door: heavier, deeper, a bit more muffled
        "gt63s": ([60, 150, 400, 1500, 4000, 12000], [3.0, 2.0, 0.5, -1.0, -2.5, -3.0]),
    }[variant]
    for (r, (l, info)), lb in zip(on, blended):
        lb = es.circular_eq(lb, *tone)
        loops.append(("on", info["rpm"], lb, "amg gt r exterior pull away"))
        loops.append(("off", info["rpm"], overrun_eq(lb), "amg gt r pull with overrun eq"))
    loops[0] = ("idle", loops[0][1], es.circular_eq(loops[0][2], *tone), loops[0][3])
    lowest = min((l for l in loops if l[0] == "on"), key=lambda l: l[1])
    below = [r for r in (1500, 2200, 2900) if r < lowest[1] * 0.9]
    loops += synth_fill(specs.mercedes_v8("m177"), below, lowest[2], overrun_eq(lowest[2]))
    shots = synth_shots(muffle=0.2 if variant == "c63s" else 0.35, turbo=True, seed=60 if variant == "c63s" else 70)
    shots.append(("start", recorded_shot(ext, 0.2, 2.6, channel="L", fade_out=0.5)))
    return {"source": "recorded-sister-engine", "loops": loops, "shots": shots,
            "notes": "pole position mercedes amg gt r 2018 (m178, same family as the m177)"}


def synth_car(spec, rpms, on_s=1.1, off_rpms=None, idle_rpm=None, muffle=0.3, pops=True, turbo=False, seed=0,
              idle_recording=None):
    loops = []
    if idle_recording:
        rel, a, b, lo, hi, fam, ch = idle_recording
        p = [tracked(rel, a, b, lo, hi, fam, channel=ch, nfft=16384)]
        l, info = recorded_loop(p, float(np.median(p[0][2])), 2.0)
        loops.append(("idle", info["rpm"], l, "recorded idle"))
    else:
        l, r = es.render_loop(spec, idle_rpm or spec.idle, 0.18, 1.6, variant=1)
        loops.append(("idle", r, l, "synth idle"))
    for r in rpms:
        l, re = es.render_loop(spec, r, 1.0, on_s)
        loops.append(("on", re, l, "synth full load"))
    for r in (off_rpms or rpms[::2]):
        l, re = es.render_loop(spec, r, 0.0, on_s, variant=2)
        loops.append(("off", re, l, "synth overrun"))
    return {"source": "synth" if not idle_recording else "synth+recorded-idle", "loops": loops,
            "shots": synth_shots(muffle, pops=pops, turbo=turbo, seed=seed), "notes": spec.name}


def car_e92():
    sp = specs.s65_e92_m3()
    return synth_car(sp, [1500, 2600, 3700, 4800, 5900, 7000, 8100], off_rpms=[1500, 3200, 5000, 6800, 8100],
                     idle_rpm=900, muffle=0.25, seed=80)


def car_amg_one():
    sp = specs.pu106_amg_one()
    return synth_car(sp, [2200, 3600, 5000, 6400, 7800, 9200, 10600], off_rpms=[2200, 4600, 7000, 9400],
                     idle_rpm=1250, muffle=0.5, turbo=True, seed=90)


def car_crown():
    sp = specs.t24a_crown()
    return synth_car(sp, [1400, 2300, 3200, 4100, 5000, 5900], off_rpms=[1400, 3000, 4600, 5900],
                     idle_rpm=850, muffle=0.8, pops=False, turbo=True, seed=100)


def car_chiron():
    sp = specs.bugatti_w16()
    return synth_car(sp, [1400, 2300, 3200, 4100, 5000, 5900, 6800], off_rpms=[1400, 2800, 4400, 6000],
                     idle_rpm=900, muffle=0.6, pops=False, turbo=True, seed=160)


def car_jesko():
    sp = specs.koenigsegg_v8()
    return synth_car(sp, [1500, 2500, 3500, 4500, 5500, 6500, 7500, 8300], off_rpms=[1500, 3200, 5000, 6800, 8300],
                     idle_rpm=950, muffle=0.25, turbo=True, seed=170)


def car_huayra():
    sp = specs.amg_m158()
    return synth_car(sp, [1300, 2100, 2900, 3700, 4500, 5300, 6100], off_rpms=[1300, 2800, 4300, 5800],
                     idle_rpm=850, muffle=0.35, turbo=True, seed=158)


def car_valkyrie():
    sp = specs.cosworth_v12()
    return synth_car(sp, [2000, 3300, 4600, 5900, 7200, 8500, 9800, 10800], off_rpms=[2000, 4400, 6800, 9200, 10800],
                     idle_rpm=1200, muffle=0.1, seed=650)


def car_s63(variant):
    sp = specs.s63_m5_m8(variant)
    rec = ("flysound-bmw-x5m/exhaust_start_idle_stop.wav", 5, 26, 950, 1200, "v8x", "mix")
    car = synth_car(sp, [1400, 2300, 3200, 4100, 5000, 5900, 6800], off_rpms=[1400, 2800, 4400, 6000],
                    muffle=0.35, turbo=True, seed=110 if variant == "m5" else 120, idle_recording=rec)
    # pull the synth part of the way toward the tone of the real s63 exhaust
    idle_rec = car["loops"][0][2]
    idle_syn, _ = es.render_loop(sp, car["loops"][0][1], 0.18, 1.6, variant=1)
    centers, diff = match_eq([idle_syn], idle_rec, max_db=10)
    car["loops"] = [car["loops"][0]] + [
        (k, r, es.circular_eq(l, centers, 0.6 * diff), n + ", eq matched to the x5 m exhaust") for k, r, l, n in car["loops"][1:]
    ]
    car["shots"].append(("start", recorded_shot("flysound-bmw-x5m/exhaust_start_idle_stop.wav", 0.5, 3.0, fade_out=0.5)))
    return car


def split_runs(rel, t0, t1, lo, hi, family, channel="mix", min_db=-42.0, rate=150.0, min_s=0.15):
    """a stretch of a recording tracked once and cut into its loud runs where
    the revs climb (on throttle) and where they fall (overrun)."""
    x, t, rpm = tracked(rel, t0, t1, lo, hi, family, channel)
    half = int(0.04 * SR)
    level = np.array([
        20 * np.log10(np.sqrt(np.mean(x[max(0, int(tk * SR) - half):int(tk * SR) + half] ** 2)) + 1e-12)
        for tk in t
    ])
    # the track wobbles frame to frame, the trend over a fifth of a second
    # says which way the revs are going
    k = max(1, int(0.2 / (t[1] - t[0])))
    slope = np.gradient(np.convolve(rpm, np.ones(k) / k, mode="same"), t)

    def runs(mask):
        out = []
        edges = np.flatnonzero(np.diff(np.concatenate([[0], mask.astype(np.int8), [0]])))
        for a, b in zip(edges[::2], edges[1::2]):
            if t[b - 1] - t[a] < min_s:
                continue
            s0, s1 = int(t[a] * SR), int(t[b - 1] * SR)
            out.append((x[s0:s1], t[a:b] - t[a], rpm[a:b]))
        return out

    loud = level > min_db
    return runs(loud & (slope > rate)), runs(loud & (slope < -rate))


def car_recorded(idle, spans, spec, on_rpms, off_rpms, synth_below=(), synth_above=(), start=None,
                 muffle=0.3, pops=True, turbo=False, seed=0, notes="", delta=0.06, min_cycles=3):
    """recorded idle, on loops from the climbing runs and off loops from the
    falling ones, synth past either end of what was recorded."""
    loops = []
    rel, a, b, lo, hi, fam, ch = idle
    p = [tracked(rel, a, b, lo, hi, fam, channel=ch, nfft=16384)]
    l, info = recorded_loop(p, float(np.median(p[0][2])), 2.0)
    loops.append(("idle", info["rpm"], l, "recorded idle"))
    rising, falling = [], []
    for span in spans:
        up, down = split_runs(*span)
        rising += up
        falling += down
    # a free rev blip only spends a cycle or two near each rpm, so blips
    # take a wider band and shorter stretches
    on = [(r, g) for r in on_rpms for g in [recorded_loop(rising, r, 1.1, delta=delta, min_cycles=min_cycles)] if g]
    off = [(r, g) for r in off_rpms for g in [recorded_loop(falling, r, 1.1, delta=delta, min_cycles=min_cycles)] if g]
    on_blend = envelope_blend([g[0] for _, g in on], 0.5)
    for (r, (l, info)), lb in zip(on, on_blend):
        loops.append(("on", info["rpm"], lb, "recorded climb"))
    if off:
        for (r, (l, info)), lb in zip(off, envelope_blend([g[0] for _, g in off], 0.5)):
            loops.append(("off", info["rpm"], lb, "recorded overrun"))
    else:
        for (r, (l, info)), lb in zip(on, on_blend):
            loops.append(("off", info["rpm"], overrun_eq(lb), "recorded climb with overrun eq"))
    ons = sorted((x for x in loops if x[0] == "on"), key=lambda x: x[1])
    below = [r for r in synth_below if r < ons[0][1] * 0.9]
    if below:
        loops += synth_fill(spec, below, ons[0][2], overrun_eq(ons[0][2]))
    above = [r for r in synth_above if r > ons[-1][1] * 1.1]
    if above:
        loops += synth_fill(spec, above, ons[-1][2], overrun_eq(ons[-1][2]), above=True)
    shots = synth_shots(muffle=muffle, pops=pops, turbo=turbo, seed=seed)
    if start:
        shots.append(("start", recorded_shot(*start, fade_out=0.5)))
    return {"source": "recorded" if not above else "recorded+synth-top", "loops": loops, "shots": shots,
            "notes": notes}


def car_huracan():
    t12 = "pp-lamborghini-huracan-2014/t12_ext_start_idle_blips.wav"
    t10 = "pp-lamborghini-huracan-2014/t10_ext_bys_gearshifts.wav"
    return car_recorded(
        (t12, 14.5, 23.0, 700, 950, "v10", "mix"),
        [(t12, 6.5, 49.0, 700, 7200, "v10"), (t10, 1.5, 6.0, 1800, 3200, "v10", "mix", -45),
         (t10, 9.0, 14.0, 4800, 8200, "v10", "mix", -46)],
        specs.lamborghini_v10(), [1400, 2000, 2700, 3500, 4400, 5300, 6300, 7200],
        [1400, 2400, 3600, 5000, 6200], synth_below=[1100], synth_above=[7700, 8200],
        start=(t12, 3.4, 6.2), muffle=0.25, seed=610, delta=0.11, min_cycles=1.5,
        notes="pole position lamborghini huracan 2014 (5.2 v10)")


def car_aventador():
    t14 = "pp-lamborghini-aventador-2014/t14_onboard_exhaust.wav"
    return car_recorded(
        (t14, 88.0, 91.5, 900, 1100, "v12", "mix"),
        [(t14, 23.9, 80.0, 650, 4500, "v12"), (t14, 97.0, 140.0, 650, 4500, "v12"),
         (t14, 160.0, 240.0, 650, 4500, "v12"), (t14, 261.0, 292.0, 650, 4500, "v12")],
        specs.lamborghini_l539(), [1300, 1800, 2400, 3000, 3600],
        [1300, 2200, 3000], synth_above=[4300, 5100, 5900, 6700, 7500, 8300],
        start=(t14, 0.0, 3.0), muffle=0.25, seed=539,
        notes="pole position lamborghini aventador 2014 (6.5 v12), synth l539 above 4,000 rpm")


def car_laferrari():
    t7 = "pp-ferrari-812-2018/t7_onboard_idle_steady_blips.wav"
    t2 = "pp-ferrari-f12-2016/t2_onboard_engine.wav"
    return car_recorded(
        (t7, 18.0, 31.0, 850, 1050, "v12", "mix"),
        [(t7, 31.0, 57.0, 850, 4000, "v12"), (t2, 17.5, 30.0, 700, 2500, "v12", "mix", -45),
         (t2, 120.0, 129.0, 1300, 4200, "v12", "mix", -45)],
        specs.ferrari_f140(), [1400, 1900, 2500, 3100],
        [1400, 2200, 3000], synth_above=[3800, 4700, 5600, 6500, 7400, 8300, 9100],
        start=(t7, 2.0, 5.5), muffle=0.2, seed=140, delta=0.11, min_cycles=1.5,
        notes="pole position ferrari 812 superfast 2018 and f12 2016 (f140 v12, same family as the laferrari's f140fe), synth f140fe above 3,500 rpm")


def car_p1():
    t7 = "pp-mclaren-570s-2016/t7_onboard_idle_steady_blips.wav"
    t10 = "pp-mclaren-570s-2016/t10_onboard_exhaust.wav"
    return car_recorded(
        (t7, 24.6, 48.5, 750, 950, "v8f", "mix"),
        [(t7, 48.0, 100.0, 900, 4000, "v8f"), (t10, 10.0, 41.0, 1000, 6000, "v8f"),
         (t10, 69.0, 98.0, 1500, 6800, "v8f"), (t10, 124.0, 170.0, 1000, 8200, "v8f")],
        specs.flat_plane_v8("m838tq"), [1300, 1900, 2600, 3400, 4200, 5000, 5800, 6600, 7400],
        [1300, 2400, 3600, 4800, 6000, 7200], synth_above=[8200],
        start=(t7, 3.0, 7.5), muffle=0.3, turbo=True, seed=838, delta=0.09, min_cycles=2,
        notes="pole position mclaren 570s 2016 (m838te, the p1's m838tq family)")


def car_918():
    t8 = "pp-ferrari-458-2013/t8_onboard_intake.wav"
    spans = [(t8, a, b, 1100, 9600, "v8f") for a, b in
             [(7.5, 33.5), (36.5, 60.5), (90.5, 112.0), (154.5, 176.0), (208.0, 234.0), (250.5, 279.0), (293.5, 324.0)]]
    return car_recorded(
        (t8, 4.5, 6.5, 900, 1150, "v8f", "mix"),
        spans, specs.flat_plane_v8("918"), [1500, 2200, 3000, 3900, 4800, 5700, 6600, 7500, 8400, 9000],
        [1600, 2800, 4200, 5600, 7000, 8400], muffle=0.15, seed=918,
        notes="pole position ferrari 458 2013 (4.5 na flat-plane v8, the closest licensed match to the 918's 4.6 flat-plane v8)")


CARS = {
    "ferrari-laferrari": car_laferrari,
    "mclaren-p1": car_p1,
    "porsche-918-spyder": car_918,
    "lamborghini-aventador-s": car_aventador,
    "lamborghini-huracan": car_huracan,
    "amg-one": car_amg_one,
    "bmw-e92-m3": car_e92,
    "amg-c63-507": car_c63_507,
    "amg-c63s-coupe": lambda: car_gtr_based("c63s"),
    "bmw-f82-m4": car_m4,
    "bmw-f90-m5-competition": lambda: car_s63("m5"),
    "bmw-m8-competition-coupe": lambda: car_s63("m8"),
    "mercedes-gt63s-edition-one": lambda: car_gtr_based("gt63s"),
    "toyota-crown-platinum": car_crown,
    "bugatti-chiron-super-sport": car_chiron,
    "koenigsegg-jesko": car_jesko,
    "pagani-huayra": car_huayra,
    "aston-martin-valkyrie": car_valkyrie,
}


def common():
    skid = "pp-skids-tarmac/t4_skidding_circles.wav"
    loops = []
    for i, (a, b) in enumerate([(96.0, 99.4), (52.0, 55.2)]):
        x = ek.highpass(load_clip(skid, a - 0.5, b + 0.5), 850, order=4)
        loops.append(("squeal", 0.0, noise_loop(x, b - a), "pole position skids, skidding in circles, high passed"))
    shots = []
    thud = "pp-car-debris/mercedes_dropped_1m_concrete.wav"
    crash = "pp-car-debris/peugeot_dropped_5m_metal.wav"
    shots.append(("impact_heavy", recorded_shot(crash, 0.0, 1.1, fade_out=0.35)))
    shots.append(("impact_medium", recorded_shot(thud, 0.0, 0.9, fade_out=0.3)))
    shots.append(("impact_light", recorded_shot(thud, 1.0, 1.45, fade_out=0.15, lp=2500)))
    shots.append(("bump", recorded_shot(thud, 0.0, 0.3, fade_out=0.12, lp=700)))
    return {"source": "recorded", "loops": loops, "shots": shots, "notes": "shared tire and impact sounds"}


def noise_loop(x, seconds, fade_s=0.35):
    """loop for non-periodic material: crossfade the tail into the pre-roll."""
    pre = int(0.5 * SR)
    L = int(seconds * SR)
    W = int(fade_s * SR)
    body = x[pre:pre + L].copy()
    tail = body[-W:]
    lead = x[pre - W:pre]
    w = np.linspace(0, 1, W)
    body[-W:] = tail * np.cos(w * np.pi / 2) + lead * np.sin(w * np.pi / 2)
    return body


# ---------------------------------------------------------------- packing

def normalize_loops(loops):
    """each loop goes to the same rms so the codec treats them alike. the
    natural level (relative to the loudest loop) goes in the manifest."""
    levels = [ek.rms_db(l) for _, _, l, _ in loops]
    top = max(levels)
    out = []
    for (kind, rpm, l, note), lv in zip(loops, levels):
        g = 10 ** ((LOOP_RMS_DB - lv) / 20)
        y = l * g
        peak = np.abs(y).max()
        if peak > 0.95:
            y *= 0.95 / peak
        out.append((kind, rpm, y, note, lv - top))
    return out


def build(car_id, data):
    loops = normalize_loops(data["loops"])
    m = int(MARGIN_S * SR)
    gap = np.zeros(int(GAP_S * SR))
    parts = [np.zeros(int(0.03 * SR))]
    pos = len(parts[0])
    manifest_loops = []
    counts = {}
    for kind, rpm, y, note, db in loops:
        counts[kind] = counts.get(kind, 0) + 1
        body = np.concatenate([y[-m:], y, y[:m]])
        start = pos + m
        manifest_loops.append({
            "id": f"{kind}{counts[kind] - 1}", "kind": kind, "rpm": round(float(rpm), 2),
            "start": round(start / SR, 6), "dur": round(len(y) / SR, 6), "db": round(float(db), 2),
        })
        parts += [body, gap]
        pos += len(body) + len(gap)
    manifest_shots = []
    pad = np.zeros(int(SHOT_PAD_S * SR))
    for i, (kind, y) in enumerate(data["shots"]):
        y = y * (10 ** (-3 / 20)) / (np.abs(y).max() + 1e-9)
        start = pos + len(pad)
        manifest_shots.append({"id": f"{kind}{i}", "kind": kind, "start": round(start / SR, 6), "dur": round(len(y) / SR, 6)})
        parts += [pad, y, pad]
        pos += len(pad) * 2 + len(y)
    sprite = np.concatenate(parts)
    os.makedirs(OUT, exist_ok=True)
    with tempfile.TemporaryDirectory() as td:
        wav = os.path.join(td, "sprite.wav")
        ek.write_wav(wav, sprite)
        opus = os.path.join(OUT, f"{car_id}.webm")
        aac = os.path.join(OUT, f"{car_id}.m4a")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", wav, "-c:a", "libopus", "-b:a", "48k",
                        "-vbr", "on", "-application", "audio", "-frame_duration", "20", opus], check=True)
        aac_codec = "aac_at" if sys.platform == "darwin" else "aac"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", wav, "-c:a", aac_codec, "-b:a", "64k",
                        "-movflags", "+faststart", aac], check=True)
    manifest = {
        "version": 1, "carId": car_id, "sampleRate": SR, "source": data["source"], "notes": data["notes"],
        "files": {"opus": f"{car_id}.webm", "aac": f"{car_id}.m4a"},
        "bytes": {"opus": os.path.getsize(opus), "aac": os.path.getsize(aac)},
        "duration": round(len(sprite) / SR, 3),
        "loops": manifest_loops, "shots": manifest_shots,
    }
    with open(os.path.join(OUT, f"{car_id}.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    return manifest


def main(argv):
    ids = argv or list(CARS) + ["common"]
    for car_id in ids:
        data = common() if car_id == "common" else CARS[car_id]()
        man = build(car_id, data)
        kinds = {}
        for l in man["loops"]:
            kinds.setdefault(l["kind"], []).append(round(l["rpm"]))
        print(f"{car_id}: {man['duration']}s opus {man['bytes']['opus'] // 1024} KB aac {man['bytes']['aac'] // 1024} KB",
              {k: v for k, v in kinds.items()}, flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
