"""shared helpers for turning engine recordings into rpm loops.

everything works on mono float64 arrays at one sample rate (48 kHz by default).
the main pieces:
  - track_rpm: engine speed per frame from the harmonic comb
  - flatten: resample a segment so the engine speed is constant
  - steady_loop: seamless loop from a steady (or flattened) segment
  - cycle_loop: loop built from single engine cycles (for sweeps, where only a
    short stretch sits near each target rpm)
"""
import math

import numpy as np
import soundfile as sf
from scipy.signal import stft, resample_poly, savgol_filter, sosfiltfilt, butter

SR = 48000


def load(path, t0=0.0, t1=None, sr=SR, mono=True):
    info = sf.info(path)
    a = int(t0 * info.samplerate)
    b = int(t1 * info.samplerate) if t1 else info.frames
    x, fs = sf.read(path, start=a, stop=b, always_2d=True)
    if mono:
        x = x.mean(axis=1)
    if fs != sr:
        g = math.gcd(fs, sr)
        x = resample_poly(x, sr // g, fs // g, axis=0)
    return np.ascontiguousarray(x, dtype=np.float64)


def highpass(x, hz, sr=SR, order=2):
    sos = butter(order, hz, "highpass", fs=sr, output="sos")
    return sosfiltfilt(sos, x)


def lowpass(x, hz, sr=SR, order=2):
    sos = butter(order, hz, "lowpass", fs=sr, output="sos")
    return sosfiltfilt(sos, x)


# ---------------------------------------------------------------- tracking

def track_rpm(x, lo, hi, orders, weights=None, sr=SR, nfft=8192, hop=240,
              max_jump=0.03, fmax=2500.0, guide=None, sub_weight=0.6):
    """engine speed per stft frame.

    orders are crank orders expected to be strong (v8 exhaust: 2, 4, 6, 8,
    inline six: 1.5, 3, 4.5, 6). a viterbi pass keeps the track from jumping
    between harmonics. guide(t) -> (lo, hi) can narrow the range per frame.
    energy halfway below each order counts against a candidate, which stops
    the track from locking onto twice the real speed.
    returns (times, rpm) with times relative to the start of x.
    """
    f, t, Z = stft(x, sr, nperseg=nfft, noverlap=nfft - hop, window="hann",
                   boundary=None, padded=False)
    keep = f <= fmax
    f = f[keep]
    mag = np.abs(Z[keep])
    spec = np.log1p(mag / (np.median(mag) + 1e-12))
    if weights is None:
        weights = np.ones(len(orders))
    grid = np.geomspace(lo, hi, 700)
    df = f[1] - f[0]
    score = np.zeros((len(grid), len(t)))
    base = min(orders)
    terms = [(w, o) for w, o in zip(weights, orders)]
    terms += [(-sub_weight * np.mean(weights), o - base / 2) for o in orders]
    for w, o in terms:
        fh = grid / 60.0 * o
        idx = fh / df
        i0 = np.clip(np.floor(idx).astype(int), 0, len(f) - 2)
        fr = idx - i0
        ok = (fh < fmax)[:, None]
        score += w * ok * (spec[i0] * (1 - fr)[:, None] + spec[i0 + 1] * fr[:, None])
    if guide is not None:
        for k, tk in enumerate(t):
            glo, ghi = guide(tk)
            score[(grid < glo) | (grid > ghi), k] -= 1e3
    step = np.log(grid[1] / grid[0])
    nb = max(1, int(math.ceil(max_jump / step)))
    acc = score[:, 0].copy()
    back = np.zeros(score.shape, dtype=np.int32)
    ar = np.arange(len(grid))
    for k in range(1, len(t)):
        best = np.full(len(grid), -np.inf)
        arg = np.zeros(len(grid), dtype=np.int32)
        for d in range(-nb, nb + 1):
            sh = np.full(len(grid), -np.inf)
            if d > 0:
                sh[d:] = acc[:-d]
            elif d < 0:
                sh[:d] = acc[-d:]
            else:
                sh[:] = acc
            cand = sh - 0.02 * abs(d)
            m = cand > best
            best[m] = cand[m]
            arg[m] = (ar - d)[m]
        acc = best + score[:, k]
        back[:, k] = arg
    path = np.zeros(len(t), dtype=np.int32)
    path[-1] = int(np.argmax(acc))
    for k in range(len(t) - 1, 0, -1):
        path[k - 1] = back[path[k], k]
    rpm = grid[path]
    # refine on the strongest order with a parabolic fit
    main = orders[int(np.argmax(weights))]
    out = rpm.copy()
    for k in range(len(t)):
        i = int(round(rpm[k] / 60.0 * main / df))
        a, b = max(1, i - 3), min(len(f) - 2, i + 3)
        j = a + int(np.argmax(mag[a:b + 1, k]))
        y0, y1, y2 = np.log(mag[j - 1:j + 2, k] + 1e-12)
        den = y0 - 2 * y1 + y2
        off = 0.5 * (y0 - y2) / den if den != 0 else 0.0
        r = (j + float(np.clip(off, -0.5, 0.5))) * df / main * 60.0
        if abs(r / rpm[k] - 1) < 0.025:
            out[k] = r
    if len(out) > 9:
        out = savgol_filter(out, 9, 2)
    return t, out


def rpm_at_samples(times, rpm, n, sr=SR):
    ts = np.arange(n) / sr
    return np.interp(ts, times, rpm)


# ---------------------------------------------------------------- resampling

def _sinc_interp(x, pos, taps=16):
    """band-limited read of x at fractional positions (lanczos window)."""
    n = len(x)
    base = np.floor(pos).astype(np.int64)
    frac = pos - base
    out = np.zeros(len(pos))
    half = taps // 2
    for k in range(-half + 1, half + 1):
        idx = base + k
        d = frac - k
        w = np.sinc(d) * np.sinc(d / half)
        w[np.abs(d) >= half] = 0.0
        valid = (idx >= 0) & (idx < n)
        out[valid] += x[idx[valid]] * w[valid]
    return out


def flatten(x, rpm_samples, r0, sr=SR):
    """resample x so its engine speed becomes the constant r0.

    rpm_samples is the tracked speed at every input sample. the output keeps
    the engine phase continuous, so the result is periodic at 120/r0 seconds
    per engine cycle (up to tracking error).
    """
    cyc = np.cumsum(rpm_samples / 120.0 / sr)
    total = cyc[-1]
    rate = r0 / 120.0 / sr
    n_out = int(total / rate) - 2
    target = np.arange(n_out) * rate
    pos = np.interp(target, cyc, np.arange(len(x), dtype=np.float64))
    return _sinc_interp(x, pos)


def shift_pitch(x, ratio):
    """plain resampling by ratio (>1 raises pitch and shortens)."""
    n_out = int(len(x) / ratio)
    pos = np.arange(n_out) * ratio
    return _sinc_interp(x, pos)


# ---------------------------------------------------------------- loops

def _ncorr(a, b):
    a = a - a.mean()
    b = b - b.mean()
    den = math.sqrt(float(np.dot(a, a) * np.dot(b, b))) + 1e-12
    return float(np.dot(a, b)) / den


def steady_loop(y, r0, target_s, sr=SR, xfade_cycles=3, start=None, search_cycles=1.0):
    """seamless loop from a flattened steady segment.

    the loop length is searched within +-search_cycles engine cycles of the
    nearest whole number of cycles to target_s, picking the length whose end
    lines up best with the audio just before the start. the tail is then
    crossfaded into that pre-roll so the seam is continuous.
    returns (loop, info)
    """
    P = 120.0 / r0 * sr
    W = int(round(xfade_cycles * P))
    n_cyc = max(4, int(round(target_s * sr / P)))
    L0 = int(round(n_cyc * P))
    if start is None:
        start = W + int(P)
    if start + L0 + int(search_cycles * P) + 8 > len(y):
        raise ValueError("segment too short for requested loop")
    ref = y[start - W:start]
    best = (-2.0, L0)
    span = int(search_cycles * P)
    for L in range(L0 - span, L0 + span + 1):
        if L < W * 2:
            continue
        c = _ncorr(y[start + L - W:start + L], ref)
        if c > best[0]:
            best = (c, L)
    corr, L = best
    loop = y[start:start + L].copy()
    tail = y[start + L - W:start + L]
    fade = np.linspace(0.0, 1.0, W)
    g_in = np.sin(fade * np.pi / 2)
    g_out = np.cos(fade * np.pi / 2)
    loop[L - W:] = tail * g_out + ref * g_in
    cycles = L / P
    info = {"length": L, "corr": corr, "cycles": cycles, "rpm": r0 * (round(cycles) / cycles)}
    return loop, info


def cycle_loop(y, r0, out_s, sr=SR, rng=None, grain_cycles=2, search=0.5):
    """loop built by overlap-adding whole engine cycles picked from y.

    y should already be flattened to r0 and hold at least ~4 cycles. grains are
    grain_cycles long with a hann window, laid on a hop of one cycle, each one
    nudged (within +-search of a cycle) to line up with what's already there.
    the output wraps around so it loops cleanly.
    """
    rng = rng or np.random.default_rng(7)
    P = int(round(120.0 / r0 * sr))
    G = P * grain_cycles
    n = max(4, int(round(out_s * sr / P)))
    L = n * P
    if len(y) < G + 2 * P:
        raise ValueError("not enough material for a cycle loop")
    out = np.zeros(L)
    win = np.hanning(G + 1)[:-1]
    hop_norm = win.reshape(grain_cycles, P).sum(axis=0).mean()
    span = int(search * P)
    lo, hi = span, len(y) - G - span - 1
    corrs = []
    prev = first = None

    def match(q, last):
        # the new grain's first cycle should look like what followed the
        # previous grain in the recording; the last one also has to run on
        # into the first grain to close the loop
        c = _ncorr(y[q:q + P], y[prev + P:prev + 2 * P])
        if last:
            c = 0.5 * (c + _ncorr(y[q + P:q + 2 * P], y[first:first + P]))
        return c

    for k in range(n):
        pos = k * P
        s = int(rng.integers(lo, hi)) if hi > lo else lo
        idx = (pos + np.arange(G)) % L
        if k > 0:
            # search a whole cycle so the grain can land in phase: coarse
            # first, then sample by sample
            last = k == n - 1
            coarse = max(1, P // 160)
            best = (-2.0, s)
            for d in range(-span, span + 1, coarse):
                c = match(s + d, last)
                if c > best[0]:
                    best = (c, s + d)
            centre = best[1]
            for q in range(centre - coarse, centre + coarse + 1):
                if q < 0 or q + G > len(y):
                    continue
                c = match(q, last)
                if c > best[0]:
                    best = (c, q)
            corrs.append(best[0])
            s = best[1]
        if first is None:
            first = s
        prev = s
        np.add.at(out, idx, y[s:s + G] * win)
    out /= hop_norm
    return out, {"length": L, "rpm": 120.0 * sr / P, "corr_mean": float(np.mean(corrs)) if corrs else 1.0,
                 "corr_min": float(np.min(corrs)) if corrs else 1.0}


def gather(pieces, r0, delta=0.06, sr=SR, min_cycles=3):
    """collect the stretches of several tracked recordings that sit within
    +-delta of r0, flatten each one to r0 and join them with short fades.

    pieces: list of (x, times, rpm) with times relative to x.
    """
    P = 120.0 / r0 * sr
    out = []
    for x, times, rpm in pieces:
        rs = rpm_at_samples(times, rpm, len(x), sr)
        near = np.abs(rs / r0 - 1) <= delta
        # contiguous runs
        edges = np.flatnonzero(np.diff(np.concatenate([[0], near.astype(np.int8), [0]])))
        for a, b in zip(edges[::2], edges[1::2]):
            if b - a < min_cycles * P:
                continue
            seg = x[a:b]
            y = flatten(seg, rs[a:b], r0, sr)
            y = y / (np.sqrt(np.mean(y ** 2)) + 1e-12)
            out.append(y)
    if not out:
        return None
    fade = int(P)
    y = out[0]
    for z in out[1:]:
        if len(z) <= 3 * fade or len(y) <= fade:
            y = np.concatenate([y, z])
            continue
        # line the next piece up with the tail before fading into it
        tail = y[-fade:]
        best = (-2.0, 0)
        for d in range(0, fade, 2):
            c = _ncorr(z[d:d + fade], tail)
            if c > best[0]:
                best = (c, d)
        z = z[best[1]:]
        w = np.sin(np.linspace(0, np.pi / 2, fade)) ** 2
        y = np.concatenate([y[:-fade], tail * (1 - w) + z[:fade] * w, z[fade:]])
    return y


def seam_score(loop, sr=SR, win=1024):
    """spectral flux across the loop seam relative to the median inside.

    close to 1 means the seam is no worse than any other point.
    """
    x = np.concatenate([loop[-win * 4:], loop[:win * 4]])
    frames = []
    for i in range(0, len(x) - win, win // 2):
        frames.append(np.abs(np.fft.rfft(x[i:i + win] * np.hanning(win))))
    frames = np.array(frames)
    flux = np.sqrt((np.diff(np.log1p(frames), axis=0) ** 2).sum(axis=1))
    mid = len(flux) // 2
    inner = []
    y = loop
    for i in range(win * 4, len(y) - win * 5, win * 3):
        a = np.abs(np.fft.rfft(y[i:i + win] * np.hanning(win)))
        b = np.abs(np.fft.rfft(y[i + win // 2:i + win // 2 + win] * np.hanning(win)))
        inner.append(np.sqrt(((np.log1p(b) - np.log1p(a)) ** 2).sum()))
    med = float(np.median(inner)) if inner else 1.0
    return float(flux[mid - 1:mid + 2].max() / (med + 1e-9))


def harmonic_profile(x, rpm, orders, sr=SR):
    """level in db of each crank order in a (roughly) steady clip."""
    n = len(x)
    spec = np.abs(np.fft.rfft(x * np.hanning(n)))
    df = sr / n
    out = []
    for o in orders:
        f = rpm / 60.0 * o
        i = int(round(f / df))
        a, b = max(0, i - 2), min(len(spec) - 1, i + 2)
        out.append(20 * np.log10(spec[a:b + 1].max() + 1e-12))
    out = np.array(out)
    return out - out.max()


def band_levels(x, sr=SR, edges=None):
    """third-octave-ish band levels (db) for spectral comparison."""
    if edges is None:
        edges = np.geomspace(40, 12000, 25)
    n = 1 << int(math.ceil(math.log2(max(len(x), 4096))))
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x)), n)) ** 2
    f = np.fft.rfftfreq(n, 1 / sr)
    lv = []
    for a, b in zip(edges[:-1], edges[1:]):
        m = (f >= a) & (f < b)
        lv.append(10 * np.log10(spec[m].mean() + 1e-20))
    lv = np.array(lv)
    return edges, lv - lv.max()


def rms_db(x):
    return 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)


def write_wav(path, x, sr=SR):
    sf.write(path, np.clip(x, -1, 1).astype(np.float32), sr, subtype="FLOAT")
