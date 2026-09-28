"""engine definitions for the synthesized cars.

numbers come from the manufacturer or training material cited in
CREDITS.md. cylinder numbering follows each maker's own scheme.
"""
from enginesynth import EngineSpec, Path, firing_angles


def s65_e92_m3():
    # bmw s65b40: 4.0 na v8, cross-plane crank, firing order 1-5-4-8-7-2-6-3
    # (bmw st709 training manual), 8 individual throttle bodies, 4-into-1
    # manifold per bank, dual-flow system into a shared 35 l rear muffler.
    # bmw numbering: 1-4 right bank, 5-8 left bank.
    fire = firing_angles([1, 5, 4, 8, 7, 2, 6, 3], [90])
    right = Path([1, 2, 3, 4], [0.50, 0.53, 0.52, 0.49], pipe_m=2.1, tail_m=0.42, gain=1.0)
    left = Path([5, 6, 7, 8], [0.51, 0.50, 0.54, 0.52], pipe_m=2.2, tail_m=0.42, delay_ms=0.35, gain=0.95)
    return EngineSpec(
        name="bmw-s65b40", cylinders=8, fire_deg=fire, paths=[right, left],
        redline=8400, idle=900, turbo=0.0, muffler_hz=2400, pipe_reflect=-0.32,
        runner_reflect=-0.42, blowdown_ms=0.9, intake=0.22, intake_hz=950,
        rasp=0.10, rasp_hz=3400, mech=0.018, jitter_amp=0.045, jitter_deg=0.25,
        cyl_spread=0.035, low_boost_db=1.5, seed=65,
    )


def pu106_amg_one():
    # mercedes-amg one: 1.6 turbo v6 from the pu106b f1 engine, 90 degree
    # bank angle, three-throw crank (split pins are banned in f1) so the
    # firing gaps alternate 90 and 150 degrees. each bank has a 3-into-1
    # manifold into one turbine with the mgu-h. road car adds metal cats,
    # four particulate filters and a titanium silencer. idle 1,280 rpm,
    # limit 11,000 rpm.
    fire = {1: 0.0, 4: 90.0, 2: 240.0, 5: 330.0, 3: 480.0, 6: 570.0}
    a = Path([1, 2, 3], [0.38, 0.38, 0.38], pipe_m=1.1, tail_m=0.30, gain=1.0)
    b = Path([4, 5, 6], [0.38, 0.38, 0.38], pipe_m=1.1, tail_m=0.30, gain=1.0)
    return EngineSpec(
        name="amg-pu106b-road", cylinders=6, fire_deg=fire, paths=[a, b],
        redline=11000, idle=1280, turbo=0.55, muffler_hz=2600, pipe_reflect=-0.28,
        runner_reflect=-0.40, blowdown_ms=0.55, intake=0.10, intake_hz=1300,
        rasp=0.16, rasp_hz=4200, mech=0.05, jitter_amp=0.05, jitter_deg=0.3,
        cyl_spread=0.03, low_boost_db=-2.0, seed=106,
    )


def s63_m5_m8(variant="m5"):
    # bmw s63b44t4: 4.4 twin-turbo v8, cross-plane crank, firing order
    # 1-5-4-8-6-3-7-2. the cross-bank manifold feeds cylinders 1/6 and 4/7
    # into one twin-scroll turbo and 2/8 and 3/5 into the other, so each
    # turbo sees an even pulse every 180 degrees (s63tu training manual).
    # that is why it sounds smoother than an amg v8.
    fire = firing_angles([1, 5, 4, 8, 6, 3, 7, 2], [90])
    ta = Path([1, 6, 4, 7], [0.62, 0.66, 0.60, 0.64], pipe_m=2.4, tail_m=0.40, gain=1.0)
    tb = Path([2, 8, 3, 5], [0.63, 0.61, 0.65, 0.62], pipe_m=2.5 if variant == "m5" else 2.3, tail_m=0.40, delay_ms=0.25, gain=0.97)
    return EngineSpec(
        name=f"bmw-s63b44t4-{variant}", cylinders=8, fire_deg=fire, paths=[ta, tb],
        redline=7200, idle=850, turbo=0.55, muffler_hz=1500 if variant == "m5" else 1650,
        drone_notch_hz=70, pipe_reflect=-0.30, runner_reflect=-0.38, blowdown_ms=1.1,
        intake=0.05, intake_hz=700, rasp=0.05, rasp_hz=3000, mech=0.03,
        jitter_amp=0.045, jitter_deg=0.25, cyl_spread=0.03, low_boost_db=2.5,
        crowding=0.25, seed=63 if variant == "m5" else 88,
    )


def mercedes_v8(kind="m156"):
    # mercedes m156 (6.2 na) and m177 (4.0 twin turbo): 90 degree cross-plane
    # v8, firing order 1-5-4-2-6-3-7-8, cylinders 1-4 right bank, 5-8 left.
    # each bank keeps its own pipe (per-bank turbo on the m177, hot inside
    # v), which is where the uneven amg burble comes from. only used to fill
    # the low rpm range under the recordings.
    fire = firing_angles([1, 5, 4, 2, 6, 3, 7, 8], [90])
    na = kind == "m156"
    right = Path([1, 2, 3, 4], [0.55, 0.60, 0.58, 0.52] if na else [0.34, 0.37, 0.36, 0.33], pipe_m=2.0, tail_m=0.5, gain=1.0)
    left = Path([5, 6, 7, 8], [0.57, 0.53, 0.61, 0.56] if na else [0.36, 0.33, 0.37, 0.35], pipe_m=2.3, tail_m=0.5, delay_ms=0.6, gain=0.92)
    return EngineSpec(
        name=f"mercedes-{kind}", cylinders=8, fire_deg=fire, paths=[right, left],
        redline=7200 if na else 7000, idle=900 if na else 850, turbo=0.0 if na else 0.45,
        muffler_hz=1400 if na else 1200, pipe_reflect=-0.38, runner_reflect=-0.45,
        blowdown_ms=1.3, intake=0.08, intake_hz=600, rasp=0.05, rasp_hz=2600, mech=0.015,
        jitter_amp=0.06, jitter_deg=0.35, cyl_spread=0.05, low_boost_db=3.0, crowding=0.4,
        seed=156 if na else 177,
    )


def t24a_crown():
    # toyota t24a-fts: 2.4 turbo inline four, firing order 1-3-4-2, twin
    # scroll turbo (cylinders 1+4 and 2+3 share a scroll), hybrid max
    # system with a 6-speed automatic. quiet luxury exhaust.
    fire = firing_angles([1, 3, 4, 2], [180])
    s1 = Path([1, 4], [0.30, 0.30], pipe_m=2.6, tail_m=0.5, gain=1.0)
    s2 = Path([2, 3], [0.28, 0.28], pipe_m=2.6, tail_m=0.5, gain=1.0)
    return EngineSpec(
        name="toyota-t24a-fts", cylinders=4, fire_deg=fire, paths=[s1, s2],
        redline=6200, idle=850, turbo=0.65, muffler_hz=1100, drone_notch_hz=95,
        pipe_reflect=-0.25, runner_reflect=-0.35, blowdown_ms=1.3, intake=0.06,
        intake_hz=800, rasp=0.04, rasp_hz=2800, mech=0.035, jitter_amp=0.04,
        jitter_deg=0.25, cyl_spread=0.03, seed=24,
    )
