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


def lamborghini_l539():
    # lamborghini l539: 6.5 na v12, 60 degree vee, even 60 degree firing,
    # firing order 1-7-4-10-2-8-6-12-3-9-5-11 (1-6 right bank, 7-12 left).
    # each bank runs a 6-into-2-into-1 manifold into its own silencer, the
    # valved system opens under load. aventador s: 8,500 rpm.
    fire = firing_angles([1, 7, 4, 10, 2, 8, 6, 12, 3, 9, 5, 11], [60])
    right = Path([1, 2, 3, 4, 5, 6], [0.46, 0.48, 0.47, 0.47, 0.48, 0.46], pipe_m=1.4, tail_m=0.3, gain=1.0)
    left = Path([7, 8, 9, 10, 11, 12], [0.47, 0.46, 0.48, 0.48, 0.46, 0.47], pipe_m=1.5, tail_m=0.3, delay_ms=0.3, gain=0.96)
    return EngineSpec(
        name="lamborghini-l539", cylinders=12, fire_deg=fire, paths=[right, left],
        redline=8500, idle=1000, turbo=0.0, muffler_hz=2300, pipe_reflect=-0.30,
        runner_reflect=-0.42, blowdown_ms=0.75, intake=0.18, intake_hz=1100,
        rasp=0.12, rasp_hz=3600, mech=0.02, jitter_amp=0.04, jitter_deg=0.2,
        cyl_spread=0.03, low_boost_db=1.0, crowding=0.35, seed=539,
    )


def ferrari_f140():
    # ferrari f140fe (laferrari): 6.3 na v12, 65 degree vee, even 60 degree
    # firing, firing order 1-7-5-11-3-9-6-12-2-8-4-10 (1-6 right bank),
    # equal length 6-into-1 headers per bank, 9,250 rpm limit. the hy-kers
    # motor rides on the gearbox
    fire = firing_angles([1, 7, 5, 11, 3, 9, 6, 12, 2, 8, 4, 10], [60])
    right = Path([1, 2, 3, 4, 5, 6], [0.52] * 6, pipe_m=1.2, tail_m=0.25, gain=1.0)
    left = Path([7, 8, 9, 10, 11, 12], [0.52] * 6, pipe_m=1.25, tail_m=0.25, delay_ms=0.25, gain=0.97)
    return EngineSpec(
        name="ferrari-f140fe", cylinders=12, fire_deg=fire, paths=[right, left],
        redline=9250, idle=1000, turbo=0.0, muffler_hz=2700, pipe_reflect=-0.28,
        runner_reflect=-0.44, blowdown_ms=0.65, intake=0.24, intake_hz=1300,
        rasp=0.15, rasp_hz=4100, mech=0.022, jitter_amp=0.035, jitter_deg=0.18,
        cyl_spread=0.025, low_boost_db=0.5, crowding=0.35, seed=140,
    )


def lamborghini_v10():
    # lamborghini/audi 5.2 fsi v10 (huracan lp610-4): 90 degree vee with split
    # crankpins for even 72 degree firing, firing order 1-6-5-10-2-7-3-8-4-9
    # (1-5 right bank), 5-into-1 per bank, 8,250 rpm limit
    fire = firing_angles([1, 6, 5, 10, 2, 7, 3, 8, 4, 9], [72])
    right = Path([1, 2, 3, 4, 5], [0.44, 0.46, 0.45, 0.46, 0.44], pipe_m=1.5, tail_m=0.32, gain=1.0)
    left = Path([6, 7, 8, 9, 10], [0.45, 0.44, 0.46, 0.45, 0.46], pipe_m=1.6, tail_m=0.32, delay_ms=0.3, gain=0.96)
    return EngineSpec(
        name="lamborghini-v10", cylinders=10, fire_deg=fire, paths=[right, left],
        redline=8250, idle=1000, turbo=0.0, muffler_hz=2200, pipe_reflect=-0.32,
        runner_reflect=-0.42, blowdown_ms=0.8, intake=0.15, intake_hz=1000,
        rasp=0.12, rasp_hz=3500, mech=0.02, jitter_amp=0.045, jitter_deg=0.22,
        cyl_spread=0.035, low_boost_db=1.2, crowding=0.35, seed=610,
    )


def flat_plane_v8(kind="m838tq"):
    # flat-plane v8s fire alternate banks every 90 degrees, so each bank
    # pulses evenly every 180: the hard, high rasp. firing order 1-5-3-7-4-8-2-6
    # (1-4 one bank). mclaren m838tq (p1): 3.8 twin turbo, a turbo per bank,
    # 8,500 rpm. porsche 918: 4.6 na from the rs spyder, top exit pipes right
    # behind the cabin, 9,150 rpm
    fire = firing_angles([1, 5, 3, 7, 4, 8, 2, 6], [90])
    turbo = kind == "m838tq"
    a = Path([1, 2, 3, 4], [0.40, 0.41, 0.41, 0.40], pipe_m=1.3 if turbo else 0.6, tail_m=0.3 if turbo else 0.12, gain=1.0)
    b = Path([5, 6, 7, 8], [0.41, 0.40, 0.40, 0.41], pipe_m=1.35 if turbo else 0.62, tail_m=0.3 if turbo else 0.12,
             delay_ms=0.25, gain=0.96)
    return EngineSpec(
        name=f"flat-plane-{kind}", cylinders=8, fire_deg=fire, paths=[a, b],
        redline=8500 if turbo else 9150, idle=850 if turbo else 950, turbo=0.5 if turbo else 0.0,
        muffler_hz=1700 if turbo else 3000, pipe_reflect=-0.30, runner_reflect=-0.42,
        blowdown_ms=0.9 if turbo else 0.7, intake=0.07 if turbo else 0.2, intake_hz=900 if turbo else 1200,
        rasp=0.09 if turbo else 0.16, rasp_hz=3300 if turbo else 4200, mech=0.03,
        jitter_amp=0.04, jitter_deg=0.22, cyl_spread=0.03, low_boost_db=0.5,
        seed=838 if turbo else 918,
    )


def bugatti_w16():
    # bugatti w16 (chiron): two narrow vr8 banks at 90 degrees on one crank,
    # 16 cylinders firing every 45 degrees, firing order
    # 1-14-9-4-7-12-15-6-13-8-3-16-11-2-5-10. four turbos, two of them only
    # above 3,800 rpm, and a big silenced titanium exhaust: deep and smooth
    # more than loud. which cylinders feed which turbo isn't published; here
    # each turbo gets evenly spaced pulses, which is how smooth it sounds
    order = [1, 14, 9, 4, 7, 12, 15, 6, 13, 8, 3, 16, 11, 2, 5, 10]
    fire = firing_angles(order, [45])
    runners = [0.34, 0.36, 0.35, 0.33]
    paths = [
        Path(order[k::4], runners, pipe_m=2.2 + 0.1 * k, tail_m=0.35, delay_ms=0.2 * (k % 2), gain=1.0 - 0.03 * k)
        for k in range(4)
    ]
    return EngineSpec(
        name="bugatti-w16", cylinders=16, fire_deg=fire, paths=paths,
        redline=7100, idle=900, turbo=0.75, muffler_hz=1100, drone_notch_hz=60,
        pipe_reflect=-0.30, runner_reflect=-0.38, blowdown_ms=1.0, intake=0.06,
        intake_hz=650, rasp=0.04, rasp_hz=2600, mech=0.03, jitter_amp=0.035,
        jitter_deg=0.2, cyl_spread=0.025, low_boost_db=3.0, crowding=0.3, seed=16,
    )


def koenigsegg_v8():
    # koenigsegg jesko: 5.0 twin turbo flat-plane v8, a turbo per bank,
    # 8,500 rpm. firing order taken as the usual flat-plane 1-5-3-7-4-8-2-6.
    # short, barely silenced exhaust out of the centre of the diffuser: harder
    # and louder than the mclaren
    fire = firing_angles([1, 5, 3, 7, 4, 8, 2, 6], [90])
    a = Path([1, 2, 3, 4], [0.36, 0.37, 0.37, 0.36], pipe_m=1.0, tail_m=0.2, gain=1.0)
    b = Path([5, 6, 7, 8], [0.37, 0.36, 0.36, 0.37], pipe_m=1.05, tail_m=0.2, delay_ms=0.2, gain=0.97)
    return EngineSpec(
        name="koenigsegg-v8", cylinders=8, fire_deg=fire, paths=[a, b],
        redline=8500, idle=950, turbo=0.45, muffler_hz=2400, pipe_reflect=-0.30,
        runner_reflect=-0.42, blowdown_ms=0.8, intake=0.09, intake_hz=1000,
        rasp=0.13, rasp_hz=3800, mech=0.03, jitter_amp=0.045, jitter_deg=0.24,
        cyl_spread=0.035, low_boost_db=1.0, seed=170,
    )


def amg_m158():
    # mercedes-amg m158 (pagani huayra): 6.0 twin turbo 60 degree v12, even
    # 60 degree firing, a turbo per bank. the firing order is taken from
    # mercedes' other v12s, 1-12-5-8-3-10-6-7-2-11-4-9 (1-6 right bank).
    # pagani's titanium system ends in four pipes in the middle of the tail
    fire = firing_angles([1, 12, 5, 8, 3, 10, 6, 7, 2, 11, 4, 9], [60])
    right = Path([1, 2, 3, 4, 5, 6], [0.40, 0.42, 0.41, 0.41, 0.42, 0.40], pipe_m=1.8, tail_m=0.3, gain=1.0)
    left = Path([7, 8, 9, 10, 11, 12], [0.41, 0.40, 0.42, 0.42, 0.40, 0.41], pipe_m=1.85, tail_m=0.3, delay_ms=0.2,
                gain=0.97)
    return EngineSpec(
        name="amg-m158", cylinders=12, fire_deg=fire, paths=[right, left],
        redline=6500, idle=850, turbo=0.6, muffler_hz=1700, pipe_reflect=-0.32,
        runner_reflect=-0.40, blowdown_ms=1.0, intake=0.06, intake_hz=750,
        rasp=0.07, rasp_hz=3000, mech=0.025, jitter_amp=0.04, jitter_deg=0.22,
        cyl_spread=0.03, low_boost_db=2.0, crowding=0.35, seed=158,
    )


def cosworth_v12():
    # cosworth 6.5 na v12 (aston martin valkyrie): 65 degree vee, even 60
    # degree firing, 11,100 rpm. the firing order isn't published, the usual
    # 1-7-5-11-3-9-6-12-2-8-4-10 stands in. short equal length headers and
    # next to no silencing: an old f1 car's scream
    fire = firing_angles([1, 7, 5, 11, 3, 9, 6, 12, 2, 8, 4, 10], [60])
    right = Path([1, 2, 3, 4, 5, 6], [0.46] * 6, pipe_m=0.9, tail_m=0.18, gain=1.0)
    left = Path([7, 8, 9, 10, 11, 12], [0.46] * 6, pipe_m=0.92, tail_m=0.18, delay_ms=0.2, gain=0.97)
    return EngineSpec(
        name="cosworth-v12", cylinders=12, fire_deg=fire, paths=[right, left],
        redline=11100, idle=1200, turbo=0.0, muffler_hz=3800, pipe_reflect=-0.26,
        runner_reflect=-0.44, blowdown_ms=0.55, intake=0.3, intake_hz=1500,
        rasp=0.2, rasp_hz=4800, mech=0.025, jitter_amp=0.03, jitter_deg=0.16,
        cyl_spread=0.02, low_boost_db=0.0, crowding=0.35, seed=650,
    )


def toyota_2jz():
    # toyota 2jz-gte (supra a80): 3.0 inline six, firing order 1-5-3-6-2-4,
    # even 120 degree firing. sounds like the usual single turbo build: a
    # twin scroll manifold (1-2-3 and 4-5-6) into one big turbo, then a
    # straight through 3.5 inch system. smooth, a metallic rasp on top
    fire = firing_angles([1, 5, 3, 6, 2, 4], [120])
    # both scrolls meet in the turbine: one pipe out of it
    pipe = Path([1, 2, 3, 4, 5, 6], [0.52, 0.49, 0.47, 0.47, 0.49, 0.52], pipe_m=2.9, tail_m=0.40, gain=1.0)
    return EngineSpec(
        name="toyota-2jz-gte", cylinders=6, fire_deg=fire, paths=[pipe],
        redline=6800, idle=700, turbo=0.5, muffler_hz=2500, pipe_reflect=-0.30,
        runner_reflect=-0.42, blowdown_ms=0.95, intake=0.07, intake_hz=800,
        rasp=0.11, rasp_hz=3400, mech=0.03, jitter_amp=0.045, jitter_deg=0.24,
        cyl_spread=0.03, low_boost_db=2.0, crowding=0.25, seed=2,
    )
