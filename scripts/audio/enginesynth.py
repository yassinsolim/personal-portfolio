"""physically informed engine synth that renders seamless rpm loops.

each cylinder fires at its real crank angle (from the firing order and crank
layout). the exhaust blowdown pulse travels down its own runner, merges into
the exhaust path it really feeds (bank, turbo scroll or collector), then goes
through the pipe, muffler and tailpipe resonances. everything is rendered over
three loop lengths with a jitter pattern that repeats every loop, and only the
middle copy is kept, so the output is exactly periodic and loops without a
seam.
"""
import math
from dataclasses import dataclass, field

import numpy as np
from scipy.signal import butter, sosfilt, lfilter

SR = 48000


@dataclass
class Path:
    cylinders: list
    runner_m: list            # header runner length per cylinder (m)
    pipe_m: float = 1.6       # collector to muffler
    tail_m: float = 0.45      # tailpipe
    delay_ms: float = 0.0     # extra delay to the listener (other side of the car)
    gain: float = 1.0


@dataclass
class EngineSpec:
    name: str
    cylinders: int
    fire_deg: dict            # cylinder -> firing angle in the 720 degree cycle
    paths: list
    redline: float
    idle: float
    turbo: float = 0.0        # 0 = na, 1 = pulses heavily smoothed by the turbine
    muffler_hz: float = 1800.0
    muffler_q: float = 0.7
    drone_notch_hz: float = 0.0
    pipe_reflect: float = -0.35
    runner_reflect: float = -0.45
    c_hot: float = 560.0      # speed of sound in the headers (m/s)
    c_pipe: float = 470.0
    blowdown_ms: float = 1.1
    intake: float = 0.15      # induction noise level (itbs are loud)
    intake_hz: float = 700.0
    rasp: float = 0.08        # combustion noise bursts
    rasp_hz: float = 3200.0
    mech: float = 0.02        # valvetrain and injector ticking
    jitter_amp: float = 0.05
    jitter_deg: float = 0.25
    cyl_spread: float = 0.04  # static cylinder to cylinder differences
    low_boost_db: float = 0.0
    tilt_db_per_oct: float = 0.0
    crowding: float = 0.3     # how much a closely following pulse is weakened
    seed: int = 1


def firing_angles(order, intervals):
    """cylinder -> angle for a firing order and the gaps between firings."""
    ang = {}
    a = 0.0
    for i, c in enumerate(order):
        ang[c] = a
        a += intervals[i % len(intervals)]
    return ang


def _pulse_kernel(frac, n, tau_s, rise_s, sr):
    t = (np.arange(n) - frac) / sr
    t = np.maximum(t, 0.0)
    k = (1 - np.exp(-t / rise_s)) * np.exp(-t / tau_s)
    return k


def _place(buf, pos, amp, kernel_fn, n):
    i = int(math.floor(pos))
    frac = pos - i
    k = kernel_fn(frac, n) * amp
    j = np.arange(n) + i
    ok = (j >= 0) & (j < len(buf))
    buf[j[ok]] += k[ok]


def _comb_fb(x, d, r):
    """y[n] = x[n] + r * y[n - d] with fractional d (linear interp)."""
    di = int(d)
    fr = d - di
    a = np.zeros(di + 2)
    a[0] = 1.0
    a[di] -= r * (1 - fr)
    a[di + 1] -= r * fr
    return lfilter([1.0], a, x)


def _comb_ff(x, d, r):
    di = int(d)
    fr = d - di
    b = np.zeros(di + 2)
    b[0] = 1.0
    b[di] += r * (1 - fr)
    b[di + 1] += r * fr
    return lfilter(b, [1.0], x)


def _peq(x, f0, gain_db, q, sr):
    """rbj peaking eq."""
    A = 10 ** (gain_db / 40)
    w = 2 * math.pi * f0 / sr
    al = math.sin(w) / (2 * q)
    b = [1 + al * A, -2 * math.cos(w), 1 - al * A]
    a = [1 + al / A, -2 * math.cos(w), 1 - al / A]
    return lfilter(np.array(b) / a[0], np.array(a) / a[0], x)


def _noise(n, rng):
    return rng.standard_normal(n)


def render_loop(spec: EngineSpec, rpm: float, load: float, seconds: float = 1.2,
                sr: int = SR, variant: int = 0):
    """one seamless loop at a fixed rpm. load is 0 (overrun) to 1 (full)."""
    rng = np.random.default_rng(spec.seed * 1000 + int(rpm) + int(load * 100) + variant * 7)
    P = int(round(120.0 / rpm * sr))
    rpm_eff = 120.0 * sr / P
    n_cyc = max(3, int(round(seconds * sr / P)))
    L = n_cyc * P
    N = 3 * L
    deg = P / 720.0
    rn = rpm_eff / spec.redline

    overrun = load < 0.3
    base_amp = 0.12 + 0.88 * load ** 1.3
    jit_a = spec.jitter_amp * (1.0 + 2.5 * (1 - load)) * (1.6 if rpm < spec.idle * 1.3 else 1.0)
    jit_d = spec.jitter_deg * (1.0 + 2.0 * (1 - load))
    # blowdown gets sharper and louder with load
    tau = spec.blowdown_ms * 1e-3 * (1.6 - 0.6 * load) * (1.15 - 0.3 * rn)
    rise = 0.00012 + 0.00025 * (1 - load)
    n_k = int(sr * (tau * 7 + rise * 4)) + 8

    cyl_static = {c: rng.normal(0, spec.cyl_spread) for c in spec.fire_deg}
    ja = rng.normal(0, jit_a, size=(n_cyc, spec.cylinders + 1))
    jd = rng.normal(0, jit_d, size=(n_cyc, spec.cylinders + 1))
    # slow breathing of the whole engine, periodic over the loop
    breathe = 1 + 0.03 * np.sin(2 * np.pi * rng.integers(1, 3) * np.arange(n_cyc) / n_cyc + rng.uniform(0, 6.28))
    # on overrun some cycles barely burn
    weak = (rng.random((n_cyc, spec.cylinders + 1)) < (0.18 if overrun else 0.0)) * rng.uniform(0.2, 0.6, (n_cyc, spec.cylinders + 1))

    kern = lambda frac, n: _pulse_kernel(frac, n, tau, rise, sr)
    out = np.zeros(N)
    evo = 140.0  # exhaust valve opens this far after firing tdc
    for path in spec.paths:
        pbuf = np.zeros(N)
        # a pulse that lands soon after the previous one in the same pipe sees
        # higher back pressure and comes out weaker. on a cross-plane v8 bank
        # this is what turns the uneven gaps into the burble.
        angs = sorted((spec.fire_deg[c] % 720, c) for c in path.cylinders)
        crowd = {}
        for i, (ang, c) in enumerate(angs):
            gap = (ang - angs[i - 1][0]) % 720 or 720
            crowd[c] = 1 - spec.crowding * math.exp(-gap / 110.0)
        for ci, cyl in enumerate(path.cylinders):
            cbuf = np.zeros(N)
            for c in range(3 * n_cyc):
                cc = c % n_cyc
                a = base_amp * crowd[cyl] * (1 + cyl_static[cyl]) * (1 + ja[cc, cyl]) * breathe[cc]
                if weak[cc, cyl]:
                    a *= weak[cc, cyl]
                pos = (c + (spec.fire_deg[cyl] + evo + jd[cc, cyl]) / 720.0) * P
                _place(cbuf, pos, a, kern, n_k)
            # runner round trip: the pulse bounces off the collector
            d_run = 2 * path.runner_m[ci] / spec.c_hot * sr
            cbuf = _comb_fb(cbuf, d_run, spec.runner_reflect)
            pbuf += np.roll(cbuf, int(path.runner_m[ci] / spec.c_hot * sr))
        if spec.turbo > 0:
            # the turbine eats pulse energy and smooths the shape
            sos = butter(1, 900 - 500 * spec.turbo, "lowpass", fs=sr, output="sos")
            sm = sosfilt(sos, pbuf)
            pbuf = (1 - spec.turbo) * pbuf + spec.turbo * sm * 1.6
            flow = lfilter([1], [1, -0.995], np.abs(pbuf)) * 0.004
            tn = sosfilt(butter(2, [1500, 7000], "bandpass", fs=sr, output="sos"), _noise(N, rng))
            pbuf += tn * flow * spec.turbo * (0.4 + load)
        # pipe to the muffler and back
        d_pipe = 2 * path.pipe_m / spec.c_pipe * sr
        pbuf = _comb_fb(pbuf, d_pipe, spec.pipe_reflect)
        d_tail = 2 * path.tail_m / spec.c_pipe * sr
        pbuf = _comb_fb(pbuf, d_tail, spec.pipe_reflect * 0.7)
        # flow noise rides on the pulses
        env = lfilter([1], [1, -0.97], np.abs(pbuf))
        fn = sosfilt(butter(2, [300, 4000], "bandpass", fs=sr, output="sos"), _noise(N, rng))
        pbuf += fn * env * 0.012 * (0.5 + load)
        out += np.roll(pbuf, int(path.delay_ms * 1e-3 * sr)) * path.gain

    # muffler: absorptive low pass plus a resonator notch for drone
    sos = butter(2, spec.muffler_hz * (0.8 + 0.4 * load), "lowpass", fs=sr, output="sos")
    out = sosfilt(sos, out)
    if spec.drone_notch_hz:
        out = _peq(out, spec.drone_notch_hz, -8, 1.5, sr)
    # radiation from the tailpipe rolls off the very low end
    out = sosfilt(butter(1, 45, "highpass", fs=sr, output="sos"), out)
    out = out - np.convolve(out, np.ones(64) / 64, mode="same") * 0.0

    # induction noise: intake valve events, loud on itb engines
    if spec.intake > 0:
        ib = np.zeros(N)
        ik = lambda frac, n: _pulse_kernel(frac, n, 0.0022, 0.0004, sr)
        for c in range(3 * n_cyc):
            cc = c % n_cyc
            for cyl, a0 in spec.fire_deg.items():
                pos = (c + (a0 + 420 + jd[cc, cyl]) / 720.0) * P
                _place(ib, pos, (0.3 + 0.7 * load) * (1 + ja[cc, cyl] * 0.5), ik, int(sr * 0.016))
        noise = sosfilt(butter(2, [spec.intake_hz * 0.5, spec.intake_hz * 2.2], "bandpass", fs=sr, output="sos"), _noise(N, rng))
        env = lfilter([1], [1, -0.985], ib)
        tone = sosfilt(butter(2, [spec.intake_hz * 0.7, spec.intake_hz * 1.4], "bandpass", fs=sr, output="sos"), ib)
        out += (noise * env * 0.02 + tone * 0.35) * spec.intake * (0.4 + 0.6 * rn)

    # combustion rasp: short noise bursts at each firing
    if spec.rasp > 0:
        rb = np.zeros(N)
        rk = lambda frac, n: _pulse_kernel(frac, n, 0.0012, 0.0001, sr)
        for c in range(3 * n_cyc):
            cc = c % n_cyc
            for cyl, a0 in spec.fire_deg.items():
                pos = (c + (a0 + 8 + jd[cc, cyl]) / 720.0) * P
                _place(rb, pos, load * (1 + ja[cc, cyl]), rk, int(sr * 0.01))
        n2 = sosfilt(butter(2, [spec.rasp_hz * 0.6, spec.rasp_hz * 1.8], "bandpass", fs=sr, output="sos"), _noise(N, rng))
        out += n2 * rb * spec.rasp * (0.3 + 0.7 * rn)

    # valvetrain and injector ticks, mostly heard at idle
    if spec.mech > 0:
        mb = np.zeros(N)
        mk = lambda frac, n: _pulse_kernel(frac, n, 0.0004, 0.00005, sr)
        for c in range(3 * n_cyc):
            cc = c % n_cyc
            for cyl, a0 in spec.fire_deg.items():
                pos = (c + (a0 - 60 + jd[cc, cyl]) / 720.0) * P
                _place(mb, pos, 1 + ja[cc, cyl], mk, int(sr * 0.004))
        mb = sosfilt(butter(2, [3500, 9000], "bandpass", fs=sr, output="sos"), mb)
        out += mb * spec.mech * (1.4 - rn)

    if spec.low_boost_db:
        out = _peq(out, 110, spec.low_boost_db, 0.7, sr)
    loop = out[L:2 * L].copy()
    if spec.tilt_db_per_oct:
        loop = tilt(loop, spec.tilt_db_per_oct, sr)
    return loop, rpm_eff


def tilt(loop, db_per_oct, sr=SR, pivot=500.0):
    """zero-phase spectral tilt applied circularly, so the loop stays seamless."""
    X = np.fft.rfft(loop)
    f = np.fft.rfftfreq(len(loop), 1 / sr)
    g = 10 ** (db_per_oct * np.log2(np.maximum(f, 20) / pivot) / 20)
    return np.fft.irfft(X * g, len(loop))


def circular_eq(loop, freqs, gains_db, sr=SR):
    """zero-phase eq from a (freq, gain) curve, circular so loops stay seamless."""
    X = np.fft.rfft(loop)
    f = np.fft.rfftfreq(len(loop), 1 / sr)
    g = np.interp(np.log(np.maximum(f, 1)), np.log(freqs), gains_db)
    return np.fft.irfft(X * 10 ** (g / 20), len(loop))


# ---------------------------------------------------------------- one-shots

def pop(sr=SR, seed=0, size=1.0, muffle=0.0):
    """afterfire pop: a sharp bang that rings the exhaust, plus a noisy tail."""
    rng = np.random.default_rng(seed)
    n = int(sr * 0.35)
    t = np.arange(n) / sr
    bang = np.zeros(n)
    k = int(sr * 0.0004)
    bang[:k] = np.hanning(2 * k)[k:] * 0 + np.linspace(1, 0, k)
    bang += rng.standard_normal(n) * np.exp(-t / 0.012) * 0.5
    ring = _comb_fb(bang, sr * (0.0045 + 0.002 * rng.random()), -0.55)
    ring = sosfilt(butter(2, [90, 3500 - 2500 * muffle], "bandpass", fs=sr, output="sos"), ring)
    tail = sosfilt(butter(2, [400, 5000 - 3000 * muffle], "bandpass", fs=sr, output="sos"), rng.standard_normal(n))
    tail *= np.exp(-t / (0.03 + 0.03 * size)) * 0.15
    y = ring + tail
    y *= np.exp(-t / (0.05 + 0.04 * size))
    return y / (np.abs(y).max() + 1e-9)


def crackle(sr=SR, seed=0, count=6, spread=0.35, muffle=0.0):
    """a burst of small pops like an overrun crackle or an upshift brap."""
    rng = np.random.default_rng(seed)
    n = int(sr * (spread + 0.3))
    y = np.zeros(n)
    times = np.sort(rng.uniform(0, spread, count))
    for i, tt in enumerate(times):
        p = pop(sr, seed * 31 + i, size=rng.uniform(0.3, 1.0), muffle=muffle) * rng.uniform(0.3, 1.0)
        a = int(tt * sr)
        m = min(len(p), n - a)
        y[a:a + m] += p[:m]
    return y / (np.abs(y).max() + 1e-9)


def blowoff(sr=SR, seed=0, dur=0.45, f_hi=4200, f_lo=900, recirc=True):
    """diverter or blow-off valve release: a falling band of noise."""
    rng = np.random.default_rng(seed)
    n = int(sr * dur)
    t = np.arange(n) / sr
    x = rng.standard_normal(n)
    # sweep a band pass down by processing short blocks
    y = np.zeros(n)
    blk = 256
    zi = None
    for i in range(0, n, blk):
        fc = f_hi * (f_lo / f_hi) ** (i / n)
        sos = butter(2, [fc * 0.6, min(fc * 1.6, sr / 2 - 100)], "bandpass", fs=sr, output="sos")
        if zi is None:
            zi = np.zeros((sos.shape[0], 2))
        y[i:i + blk], zi = sosfilt(sos, x[i:i + blk], zi=zi)
    env = (1 - np.exp(-t / 0.004)) * np.exp(-t / (dur * (0.25 if recirc else 0.4)))
    y *= env
    return y / (np.abs(y).max() + 1e-9)
