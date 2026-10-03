# Race cars: real drivetrains

Every car in race mode drives on its real gearing: the published gear ratios and final drive, the
real tyre's rolling radius, the rev limiter at the published redline, the electronic top speed
limiter where the car has one, a full load torque curve built from the published power and torque,
and gear changes that behave like that car's gearbox. The speedo shows true speed over the road.

- Game data: `race` in `src/Application/carOptions.ts` (gearing, tyres, transmission, limiters,
  torque curve). `Vehicle/carPhysics.ts` turns it into the physics spec, `Vehicle/tyres.ts` works
  out the rolling radius, `Vehicle/VehiclePhysics.ts` runs it.
- Published figures, kept apart from the game data: `scripts/race-drivetrain-reference.mjs`.
- Check: `npm run check:drivetrain` prints the tables below, `npm run test:drivetrain` runs the
  same as tests. Both run the game's own physics in node, about 3 seconds.

How to read the marks in the tables: **P** published by the maker, **T** measured in a road test,
**D** derived from published figures (the arithmetic is given), **E** estimated (how it was chosen
is given). Nothing marked P or T is a guess; everything marked E is.

## How the sim uses the figures

- **Revs follow the wheels.** Engine rpm is the driven wheels' speed times the gear ratio and the
  final drive. The clutch (or torque converter) slips only when pulling away in first or reverse,
  where it holds the launch revs, and mid drift, where the drift assist holds the revs up the way a
  driver kicks the clutch. In any other gear it only slips to keep the engine off idle.
- **Rolling radius.** The radius that turns wheel rpm into road speed comes from the driven
  axle's tyre, not the 3D model. Where the tyre maker publishes measured revolutions per mile for
  the size (SAE J1025, under load) that is used; otherwise the loaded circumference is 0.970 of the
  nominal one. That factor is the mean of eight measured Michelin Pilot Sport 4S sizes (below),
  range 0.969 to 0.974. The visual wheels are scaled to roll at the same road speed.
- **Rev limiter.** A hard cut at the redline: fuel off for 60 ms each time the revs reach it. The
  audio gets the limiter flag from the physics, so the limiter sounds exactly there.
- **Speed limiter.** Drive torque fades out over the last 0.3 m/s before the limit, so the car
  settles on it (within 0.5 km/h in the check). The garage can take it out.
- **Torque curve.** A full load curve per car, `[rpm, Nm]` points joined by straight lines and
  sampled every 50 rpm. For turbo engines the published torque plateau and power band fix most of
  it (constant torque, then constant power); for the naturally aspirated V8s the torque peak and the
  power peak are published and the shape between is estimated. The garage engine map scales the
  whole curve.
- **Gear changes.** Each box has a shift time and a share of drive torque that keeps flowing during
  the change: a dual clutch hands over between its clutches (70% kept), the AMG MCT boxes and the
  automatics cut part of it (30 to 40% kept), a manual or single clutch box cuts it all. The AMG
  One keeps 30% because its front axle motors keep pulling while the clutch is open. Automatic
  upshifts at full throttle happen just under the redline (these curves still pull harder there
  than in the next gear).
- **Launch.** A clutch (or the MCT's wet start clutch) holds the launch revs until the wheels catch
  up. The torque converter in the BMW 8-speed also multiplies torque while it slips (1.8 at stall).

## Tyres and rolling radius

Measured revolutions per mile, Michelin Pilot Sport 4S, from
[tiresize.com](https://tiresize.com/tires/Michelin/Pilot-Sport-4S.htm) (tyre maker data):

| Size | Nominal diameter | Revs/mile | Measured circumference / (pi x nominal diameter) |
| --- | --- | --- | --- |
| 265/40 ZR18 | 669.2 mm | 790 | 0.969 |
| 285/30 ZR19 | 653.6 mm | 805 | 0.974 |
| 275/35 ZR19 | 675.1 mm | 783 | 0.969 |
| 285/35 ZR19 | 682.1 mm | 774 | 0.970 |
| 285/35 ZR20 | 707.5 mm | 746 | 0.971 |
| 275/35 ZR20 | 700.5 mm | 755 | 0.969 |
| 265/35 ZR20 | 693.5 mm | 761 | 0.971 |
| 315/30 ZR20 | 697.0 mm | 757 | 0.971 |

The mean is 0.970. Rolling radius = circumference / 2 pi. Sizes used by the cars:

| Car | Driven (rear) tyre | Rolling radius | How |
| --- | --- | --- | --- |
| AMG One | 335/30 ZR20 | 0.3439 m | D: 0.970 x 709.0 mm / 2 |
| E92 M3 | 265/40 ZR18 | 0.3242 m | P: 790 revs/mile |
| C63 507 | 255/30 R19 | 0.3083 m | D: 0.970 x 635.6 mm / 2 |
| C63 S Coupe | 285/30 ZR19 | 0.3182 m | P: 805 revs/mile |
| F82 M4 | 275/40 ZR18 | 0.3284 m | D: 0.970 x 677.2 mm / 2 |
| M5 Competition | 285/35 ZR20 | 0.3433 m | P: 746 revs/mile |
| M8 Competition | 285/35 ZR20 | 0.3433 m | P: 746 revs/mile |
| GT 63 S Edition 1 | 315/30 R21 | 0.3504 m | D: 0.970 x 722.4 mm / 2 |
| Crown Platinum | 225/45 R21 | 0.3569 m | D: 0.970 x 735.9 mm / 2 |
| Huracán | 305/30 R20 | 0.3351 m | D: 0.970 x 691.0 mm / 2 |
| Aventador S | 355/25 R21 | 0.3448 m | D: 0.970 x 710.9 mm / 2 |
| LaFerrari | 345/30 ZR20 | 0.3468 m | D: 0.970 x 715.0 mm / 2 |
| P1 | 315/30 R20 | 0.3380 m | D: 0.970 x 697.0 mm / 2 |
| 918 Spyder | 325/30 ZR21 | 0.3533 m | D: 0.970 x 728.4 mm / 2 |
| Chiron Super Sport | 355/25 R21 | 0.3448 m | D: 0.970 x 710.9 mm / 2 |
| Jesko Attack | 325/30 R21 | 0.3533 m | D: 0.970 x 728.4 mm / 2 |
| Huayra | 335/30 ZR20 | 0.3439 m | D: 0.970 x 709.0 mm / 2 |
| Senna | 315/30 R20 | 0.3380 m | D: 0.970 x 697.0 mm / 2 |
| SF90 Stradale | 315/30 ZR20 | 0.3380 m | D: 0.970 x 697.0 mm / 2 |
| Valkyrie | 325/30 ZR21 | 0.3533 m | D: 0.970 x 728.4 mm / 2 |
| Supra MK4 | 255/40 ZR17 | 0.3084 m | D: 0.970 x 635.8 mm / 2 |

The model based radius the physics used before was 0.328 to 0.360 m, up to 7% off (the C63 507's
model wheels gave 0.331 m, the real tyre rolls at 0.308 m).

## The cars

### Mercedes-AMG ONE

Production car (2022). The 3D model is the Project ONE show car; the figures are the production
car's.

| Figure | Value | Mark | Source |
| --- | --- | --- | --- |
| Engine | 1.6 V6 turbo hybrid from the F1 PU106, MGU-K on the crank, two front axle motors | P | [Mercedes-AMG](https://www.mercedes-amg.com/en/home/vehicles/amg-one/hypercar.html) |
| Transmission | 7-speed automated manual, single 4-disc carbon clutch | P | Mercedes-AMG, [Wikipedia](https://en.wikipedia.org/wiki/Mercedes-AMG_ONE) |
| Overall ratios (gear x final drive) | 12.803, 9.267, 7.058, 5.581, 4.562, 3.878, 3.435, R 14.599 | P | Mercedes-AMG data via [AMG In Years](https://www.amginyears.com/amg-overview/amg-project-one/) |
| Tyres | 285/35 ZR19, 335/30 ZR20 (Pilot Sport Cup 2 R) | P | AMG In Years, [WardsAuto](https://www.wardsauto.com/news/archive-wards-mercedes-amg-one-guns-for-hypercar-glory/796118/) |
| Idle | 1,280 rpm | P | Tobias Moers, via Wikipedia |
| Redline, limiter | 11,000 rpm | P | Mercedes-AMG ("maximum speed of the combustion engine of 11,000 rpm") |
| Power | 422 kW at 9,000 rpm (V6), 782 kW system | P | AMG In Years, Mercedes-AMG |
| Torque | not published ("not possible due to complex drive train") | | AMG In Years |
| Top speed | 352 km/h, electronically limited | P | Mercedes-AMG |
| 0-100 / 0-200 / 0-300 | 2.9 / 7.0 / 15.6 s | P | Mercedes-AMG |
| Mass | 1,695 kg (DIN) | P | AMG In Years |

Estimated: the torque curve below the 782 kW peak (a peaky F1 style shape, 300 Nm at idle rising
to 830 Nm at 9,000 rpm), the drag area (1.15 m2, high downforce aero) and the launch revs
(5,500 rpm). These were fitted together so the sim lands on Mercedes' 0-100, 0-200 and 0-300. With
them, the drag limited top speed with the limiter out is 357 km/h, which is only an estimate. The
front motors are modelled as part of the drive through the gearbox with a fixed 30% front split,
as before.

### BMW M3 Coupe (E92)

| Figure | Value | Mark | Source |
| --- | --- | --- | --- |
| Engine | S65B40 4.0 V8, naturally aspirated | P | [BMW press kit](https://www.press.bmwgroup.com/global/article/detail/T0137039EN/the-new-bmw-m3?language=en) |
| Transmission | 6-speed manual (Getrag), the launch gearbox and the one the game had | P | [BMW technical data](https://www.e46fanatics.com/d1/pdf/the_new_bmw_m3.pdf) |
| Ratios | 4.055, 2.369, 1.582, 1.192, 1.000, 0.872, R 3.678, final drive 3.846 | P | BMW technical data |
| Tyres | 245/40 ZR18, 265/40 ZR18 | P | BMW technical data (the model wears the optional 19s; 265/35 R19 is 668 mm, the same diameter) |
| Idle | 700 rpm | E | BMW gives no number; owners read 600 to 750 warm ([M3Post](https://www.m3post.com/forums/showthread.php?t=2197597)) |
| Redline, limiter | 8,400 rpm | P | BMW press kit; BMW service data "max permissible engine speed 8400" ([diagnostdata](https://diagnostdata.com/bmw/m3/e90-2007-2013/remont/mechanical/engine/engine-technical-data-e9293/)) |
| Power | 309 kW at 8,300 rpm | P | BMW |
| Torque | 400 Nm at 3,900 rpm; 85% of it over a 6,500 rpm span | P | BMW |
| Top speed | 250 km/h, electronically limited | P | BMW |
| 0-100 | 4.8 s | P | BMW |
| 0-200 | 16.3 s | T | magazine test table quoted on [M3Post](https://www.m3post.com/forums/showthread.php?t=155518), the magazine isn't named |
| 0-150 mph (241 km/h) | 24.3 s (+0.3 s rollout) | T | Car and Driver, June 2008, quoted in the same thread |
| Mass | 1,655 kg (EU) | P | BMW |
| Drag area | 0.684 m2 | P | BMW |

The game had 2nd gear as 2.40; it is 2.369.

### Mercedes-Benz C 63 AMG Coupe Edition 507 (C204)

| Figure | Value | Mark | Source |
| --- | --- | --- | --- |
| Engine | M156 6.2 V8, naturally aspirated | P | [Mercedes-Benz archive](https://mercedes-benz-publicarchive.com/marsClassic/en/instance/ko/C-63-AMG-Edition-507-2013---2014.xhtml?oid=189266535) |
| Transmission | AMG SPEEDSHIFT MCT 7-speed, wet start clutch | P | Mercedes-Benz archive |
| Ratios | 4.38, 2.86, 1.92, 1.37, 1.00, 0.82, 0.73, R 3.42 | P | Mercedes-Benz archive |
| Final drive | 2.82 | P | [Car and Driver spec data](https://www.caranddriver.com/mercedes-benz/c63-amg/specs), [Australian Car Reviews](http://australiancar.reviews/review-mercedes-c204-c-63-amg-2011-15/), an owner reading the ring gear ([MBWorld](https://mbworld.org/forums/c63-amg-w204/708113-3-06-final-drive-swap-game-changer.html)) |
| Tyres | 235/35 R19, 255/30 R19 | P | Mercedes-Benz archive |
| Idle | 700 rpm | E | not published; typical warm idle for the engine |
| Redline, limiter | 7,200 rpm | T | Car and Driver on the M156 ([CL63 test](https://www.caranddriver.com/reviews/a17012244/2008-mercedes-benz-cl63-amg-short-take-road-test/)) |
| Power | 373 kW at 6,800 rpm | P | Mercedes-Benz archive |
| Torque | 610 Nm at 5,200 rpm | P | Mercedes-Benz archive |
| Top speed | 280 km/h, limited (AMG Driver's Package standard on the 507) | P | [Mercedes press release](https://emercedesbenz.com/autos/mercedes-benz/c-class/mercedes-c63-amg-edition-507-and-a45-amg-edition-available-for-order/); Car and Driver hit the governor at 176 mph |
| 0-100 | 4.2 s (coupe) | P | Mercedes press release |
| 0-60 / 0-100 / 0-160 mph | 3.9 / 9.2 / 27.0 s (+0.3 s rollout) | T | [Car and Driver](https://www.caranddriver.com/reviews/a15111205/2014-mercedes-benz-c63-amg-edition-507-test-review/) |
| Mass | 1,798 kg | T | Car and Driver curb weight |

The game had a 3.06 final drive and a 7,000 rpm redline; both were wrong. One Canadian data sheet
quoted on MBWorld says 3.06 for 2012 cars, but the rest of the sources, including an owner's ring
gear, say 2.82. Estimated: the curve between the published torque and power peaks, and the drag
area (0.85 m2, not published, fitted to Car and Driver's high speed times).

### Mercedes-AMG C 63 S Coupe (C205 facelift, 2019)

| Figure | Value | Mark | Source |
| --- | --- | --- | --- |
| Engine | M177 4.0 twin turbo V8 | P | Mercedes |
| Transmission | AMG SPEEDSHIFT MCT 9G, wet start clutch | P | [mbpassion (Mercedes data)](https://mbpassion.de/2018/07/optisch-und-technisch-ueberarbeitet-in-der-modellpflege-des-c-63-s-coupes-auf-testfahrt/) |
| Ratios | 5.35, 3.24, 2.25, 1.64, 1.21, 1.00, 0.86, 0.72, 0.60, R 4.80 | P | Mercedes-Benz USA spec release, Chrome data ([auto123](https://www.auto123.com/en/specs/mercedes-benz/c-class/mercedes-benz-c-class-2019-amg-c-63-s-coupe-404757/)) |
| Final drive | 2.82 | P | factory build data for 2019, 2020 and 2021 C 63 S Coupes ([1](https://badvin.com/v/WDDWJ8HB6KF838292-2019-mercedes-benz-c-class-c12), [2](https://badvin.com/v/WDDWJ8HB0LF950765-2020-mercedes-benz-c-63-amg-30b), [3](https://badvin.com/v/W1KWJ8HB2MG050980-2021-mercedes-benz-amg-c-63-6f9)) |
| Tyres | 255/35 ZR19, 285/30 ZR19 (US standard; a 285/30 R20 rear was optional) | P | auto123, [Mercedes 2016 press data](https://carsite.co.za/the-new-mercedes-amg-c-63-coupe/) |
| Idle | 700 rpm | E | not published |
| Redline, limiter | 7,000 rpm | P | Mercedes-Benz USA spec release (see CREDITS.md) |
| Power | 375 kW at 5,500 to 6,250 rpm | P | Mercedes |
| Torque | 700 Nm at 2,000 to 4,500 rpm | P | Mercedes |
| Top speed | 290 km/h, limited | P | Mercedes-Benz USA (180 mph), mbpassion |
| 0-100 | 3.9 s | P | Mercedes |
| 0-100 / 0-130 / 0-150 mph | 8.1 / 13.5 / 18.7 s (+0.3 s rollout) | T | [Car and Driver, C 63 S sedan, same drivetrain](https://www.caranddriver.com/reviews/a22174935/2019-mercedes-amg-c63-first-drive-review/) |

Chrome data disagrees on the facelift's axle (2.82, 3.07, 3.27 on different pages); the VIN build
records are the most specific source. Estimated: below 2,000 rpm, past 6,250 rpm, the drag area
(0.72 m2).

### BMW M4 Coupe (F82)

| Figure | Value | Mark | Source |
| --- | --- | --- | --- |
| Engine | S55B30 3.0 twin turbo inline 6 | P | [BMW USA media information](https://www.press.bmwgroup.com/usa/article/attachment/T0160684EN_US/391903) |
| Transmission | 7-speed M DCT (the game's ratios were the DCT's) | P | BMW USA |
| Ratios | 4.806, 2.593, 1.701, 1.277, 1.000, 0.844, 0.671, R 4.172, final drive 3.462 | P | BMW USA, [BMW specifications](https://www.press.bmwgroup.com/global/article/attachment/T0286585EN/419605) |
| Tyres | 255/40 ZR18, 275/40 ZR18 | P | BMW USA |
| Idle | 720 rpm | D | measured from the steady idle in the Pole Position M4 recording the race audio uses (`scripts/audio/build_audio.py`) |
| Redline, limiter | 7,600 rpm | P | BMW ([press text](https://www.bimmerfest.com/threads/2015-bmw-m3-sedan-and-m4-coupe-official-details.740555/)) |
| Power | 317 kW at 5,500 to 7,300 rpm | P | BMW USA |
| Torque | 550 Nm at 1,850 to 5,500 rpm | P | BMW USA |
| Top speed | 250 km/h, limited (280 with the M Driver's Package) | P | BMW |
| 0-100 | 4.1 s | P | BMW |
| 0-100 / 0-130 mph | 8.5 / 14.5 s (+0.3 s rollout) | T | [Car and Driver](https://www.caranddriver.com/reviews/a15110053/2015-bmw-m4-dct-automatic-test-review/) |
| Launch | about 2,500 rpm | T | Car and Driver: their best launch |
| Drag area | 0.34 x 2.23 m2 | P | BMW specifications |

Car and Driver's 160 mph split isn't used: their US car had a 163 mph governor.

### BMW M5 Competition (F90 LCI, 2021)

| Figure | Value | Mark | Source |
| --- | --- | --- | --- |
| Engine | S63B44T4 4.4 twin turbo V8 | P | [BMW specifications](https://www.press.bmwgroup.com/global/article/attachment/T0280678EN/412670) |
| Transmission | 8-speed M Steptronic (ZF 8HP) with a torque converter, M xDrive | P | BMW |
| Ratios | 5.000, 3.200, 2.143, 1.720, 1.313, 1.000, 0.823, 0.640, R 3.478, final drive 3.150 | P | BMW specifications (2018 M5 Competition; the LCI drivetrain carries over) |
| Tyres | 275/35 ZR20, 285/35 ZR20 | P | BMW |
| Idle | 650 rpm | E | not published |
| Redline, limiter | 7,200 rpm | P | [BMW USA](https://www.press.bmwgroup.com/usa/article/detail/T0296777EN_US/the-new-2020-bmw-m8-coupe-and-convertible?language=en_US) ("7,200 rpm redline" for this S63) |
| Power | 460 kW at 6,000 rpm | P | [BMW UK](https://www.press.bmwgroup.com/united-kingdom/article/attachment/T0309398EN_GB/463450) |
| Torque | 750 Nm at 1,800 to 5,860 rpm | P | BMW UK |
| Top speed | 305 km/h, limited, with the M Driver's Package (250 without) | P | BMW |
| 0-100 / 0-200 | 3.3 / 10.8 s | P | BMW |
| Drag area | 0.758 m2 | P | BMW |
| Converter torque ratio | 1.8 at stall | E | typical for this kind of converter |

### BMW M8 Competition Coupe (F92, 2020)

| Figure | Value | Mark | Source |
| --- | --- | --- | --- |
| Engine, transmission | as the M5 Competition | P | [BMW specifications](https://www.press.bmwgroup.com/global/article/attachment/T0330570EN/477179) |
| Final drive | 3.154 | P | BMW |
| Tyres | 275/35 ZR20, 285/35 ZR20 | P | BMW |
| Redline, limiter | 7,200 rpm | P | BMW USA |
| Power, torque | 460 kW at 6,000 rpm, 750 Nm at 1,800 to 5,860 rpm | P | BMW USA |
| Top speed | 305 km/h, limited, with the M Driver's Package (250 without) | P | BMW |
| 0-100 / 0-200 | 3.2 / 10.6 s | P | BMW |
| Drag area | 0.33 x 2.25 m2 | P | BMW |

### Mercedes-AMG GT 63 S 4MATIC+ 4-Door Coupe Edition 1 (X290, 2019)

| Figure | Value | Mark | Source |
| --- | --- | --- | --- |
| Engine | M177 4.0 twin turbo V8 | P | [Mercedes press data](https://www.caricos.com/cars/m/mercedes-benz/2019_mercedes-amg_gt63_s_edition_1/) |
| Transmission | AMG SPEEDSHIFT MCT 9G | P | Mercedes |
| Ratios | as the C 63 S | P | Chrome data |
| Final drive | 3.27 | P | [Chrome data via Car and Driver](https://www.caranddriver.com/mercedes-amg/gt43-gt53-gt63/specs/2020/mercedes-amg_gt63-gt63-s_mercedes-amg-gt63-gt63-s-sedan_2020) |
| Tyres | 275/35 R21, 315/30 R21 | P | [Drive.com.au](https://www.drive.com.au/showrooms/mercedes-benz/amg-gt/8bd1c259ad52d626/) |
| Idle | 700 rpm | E | not published |
| Redline, limiter | 7,000 rpm | E | not published for this car; the same M177 has 7,000 in the C 63 S |
| Power | 470 kW at 5,500 to 6,500 rpm | P | Mercedes |
| Torque | 900 Nm at 2,500 to 4,500 rpm | P | Mercedes |
| Top speed | 315 km/h | P | Mercedes (it doesn't say whether that's governed; the sim treats it as the limiter) |
| 0-100 | 3.2 s | P | Mercedes |
| 0-100 / 0-160 / 0-200 | 3.0 / 6.6 / 10.2 s | T | Auto Bild, via [Wikipedia](https://en.wikipedia.org/wiki/Mercedes-AMG_GT_4-Door_Coup%C3%A9) |
| Mass | 2,120 kg (EU) | P | Mercedes |

Estimated: the drag area (0.78 m2).

### Toyota Crown Platinum (2023 to 2025), Hybrid MAX

| Figure | Value | Mark | Source |
| --- | --- | --- | --- |
| Engine | T24A-FTS 2.4 turbo inline 4, front motor in the transmission, rear eAxle | P | [Toyota Canada](https://toyotacanada.scene7.com/is/content/toyotacanada/2025%20Crown%20Product%20Informationpdf), [Toyota USA](https://pressroom.toyota.com/toyota-crown-brings-even-more-premium-style-and-technology-for-2025/) |
| Transmission | Direct Shift-6AT with a wet start clutch instead of a converter | P | Toyota, [Car and Driver](https://www.caranddriver.com/reviews/a41711747/2023-toyota-crown-drive/) |
| Ratios | 4.475, 2.517, 1.561, 1.143, 0.851, 0.672, R 3.196, final drive 3.737 | P* | Lexus for the same Hybrid MAX transaxle in the RX 500h ([Lexus UK](https://media.lexus.co.uk/wp-content/uploads/sites/3/pdf/230217M-RX-Tech-Spec.pdf)); Toyota doesn't publish the Crown's |
| Tyres | 225/45 R21 | P | Car and Driver test car |
| Idle | 800 rpm | E | not published |
| Redline, limiter | 6,500 rpm | E | not published; Motor Matchup lists 6,800 but I couldn't confirm it. Peak power is at 6,000 |
| Engine | 197 kW at 6,000 rpm, 450 Nm at 2,000 to 3,000 rpm | P | Toyota Canada |
| System | 254 kW (340 hp), 542 Nm (400 lb-ft) | P | Toyota |
| Top speed | 208 km/h, governed | T | Car and Driver: 129 mph |
| 0-60 mph | 5.7 s | P | Toyota Canada |
| 0-60 / 0-100 / 0-120 mph | 5.1 / 13.5 / 20.8 s (+0.3 s rollout) | T | Car and Driver |
| Mass | 1,968 kg | T | Car and Driver |

\*The ratios are the RX 500h's; the Crown shares the powertrain, but whether its final drive is the
same isn't published. The system's 254 kW needs the 0.6 kWh battery, so past the torque plateau
the curve is fitted to Car and Driver's full throttle run and peaks near 217 kW; the garage shows
that figure because it's what the car drives with. The 0-100 km/h target (5.6 s) is Car and
Driver's 5.1 s to 60 mph plus the rollout and the last 2 mph.

### Lamborghini Huracán LP 610-4 (2014 to 2019)

| Figure | Value | Mark | Source |
| --- | --- | --- | --- |
| Engine | 5.2 V10, naturally aspirated | P | [Car and Driver](https://www.caranddriver.com/reviews/a15108747/2015-lamborghini-huracan-lp610-4-tested-review/) |
| Transmission | 7-speed LDF dual clutch, two output shafts | P | Huracán owner's handbook ([STO edition, same box](https://www.manualslib.com/manual/3723878/Lamborghini-Huracan-Sto-2021.html?page=392)) |
| Ratios | 3.133, 2.588, 1.958, 1.244, 0.979, 0.976, 0.841, R 2.647 | P | handbook |
| Final drives | 4.89 (1st, 4th, 5th, reverse), 3.938 (2nd, 3rd, 6th, 7th) | P, D | handbook prints 3.938 and "2.48937" for the first shaft, which would make 1st reach 140 km/h; 4.89 gives the speeds below and matches a restated table ([ccdiscussion](https://ccdiscussion.com/t/2014-lamborghini-huracan-lp-610-4/7495)) |
| Overall ratios | 15.32, 10.19, 7.711, 6.083, 4.787, 3.843, 3.312, R 12.94 | D | gear x its shaft's final drive |
| Tyres | 245/30 R20, 305/30 R20 | P | Car and Driver spec data |
| Idle | 1,000 rpm | E | not published |
| Redline, limiter | 8,500 rpm | P | Lamborghini, via Car and Driver |
| Power, torque | 449 kW at 8,250 rpm, 560 Nm at 6,500 rpm | P | Lamborghini |
| Top speed | 325 km/h, on the limiter in 7th | P | Car and Driver ("redline ltd") |
| 0-100 | 3.2 s | P | Lamborghini |
| 0-60 / 0-100 / 0-150 mph | 2.5 / 5.7 / 13.3 s (+0.3 s rollout) | T | Car and Driver |
| Mass | 1,553 kg | T | Car and Driver curb weight |
| Launch | about 4,200 rpm | T | Car and Driver ("north of 4,000") |

Estimated: the curve between the published peaks, the drag area (0.74 m2: Cd 0.39 over about
1.9 m2) and the 30% front torque share of the Haldex coupling.

### Lamborghini Aventador S LP 740-4 (2017)

| Figure | Value | Mark | Source |
| --- | --- | --- | --- |
| Engine | L539 6.5 V12, naturally aspirated | P | [Lamborghini technical data](https://autointernational.com.my/WebNews/News/Year%202017/Lamborghini%20Avantador%20S%20-%202%20Mar%2017/Aventador%20S%20technical%20specs.pdf) |
| Transmission | 7-speed ISR, single clutch | P | Lamborghini |
| Ratios | 3.909, 2.438, 1.810, 1.458, 1.185, 0.967, 0.844, R 2.929, final drive 2.867 (rear) | P | Lamborghini |
| Tyres | 255/30 R20, 355/25 R21 | P | Lamborghini |
| Redline, limiter | 8,500 rpm | T | [Car and Driver](https://www.caranddriver.com/reviews/a15098260/2017-lamborghini-aventador-s-first-drive-review/) |
| Power, torque | 544 kW at 8,400 rpm, 690 Nm at 5,500 rpm | P | Lamborghini |
| Top speed | 350 km/h | P | Lamborghini |
| 0-100 / 0-200 / 0-300 | 2.9 / 8.8 / 24.2 s | P | Lamborghini |
| Mass | 1,740 kg | E | dry weight 1,525 to 1,575 kg plus fluids, from spec sites; no road test of the S |
| Weight split | 43 / 57 | P | Lamborghini |

Estimated: the curve between the peaks, the drag area (0.77 m2, fitted to the 350 km/h top speed)
and the launch revs (5,500 rpm).

### Ferrari LaFerrari (2013 to 2016)

| Figure | Value | Mark | Source |
| --- | --- | --- | --- |
| Engine | F140FE 6.3 V12 with HY-KERS | P | [Ferrari](https://web.archive.org/web/20150110075807/http://www.laferrari.com/en/techicalspecifications/) |
| Transmission | 7-speed dual clutch | P | Ferrari |
| Ratios | 3.077, 2.185, 1.626, 1.286, 1.028, 0.839, 0.693, R 2.791, final drive 4.375 | P* | the F12berlinetta's ([owner's manual](https://www.manualslib.com/manual/1110293/Ferrari-2012-F12-Berlinetta.html?page=28)); [Motor Trend](https://www.motortrend.com/reviews/ferrari-laferrari-first-test/) measured the LaFerrari's axle at 4.38 and its top gear at 3.02 overall |
| Tyres | 265/30 ZR19, 345/30 ZR20 | P | Ferrari |
| Redline, limiter | 9,250 rpm | P | Ferrari |
| Power | 588 kW at 9,000 rpm (V12), 120 kW motor, 708 kW system | P | Ferrari |
| Torque | 700 Nm at 6,750 rpm (V12), over 900 Nm system | P | Ferrari |
| Top speed | over 350 km/h | P | Ferrari (it doesn't say whether that's governed; the sim treats it as the limiter) |
| 0-100 / 0-200 | under 3 / under 7 s | P | Ferrari |
| Mass | 1,585 kg | T | Motor Trend curb weight |
| Weight split | 41 / 59 | P | Ferrari |

\*The LaFerrari's own ratios aren't published. Estimated: the low end of the curve where the motor
fills in, and the drag area (0.75 m2).

### McLaren P1 (2013 to 2015)

| Figure | Value | Mark | Source |
| --- | --- | --- | --- |
| Engine | M838TQ 3.8 twin turbo V8 with the IPAS motor | P | [P1 owner's handbook](https://www.manualslib.com/manual/1643049/Mclaren-P1.html?page=224) |
| Transmission | 7-speed SSG dual clutch | P | handbook |
| Ratios | 3.981, 2.613, 1.905, 1.479, 1.161, 0.906, 0.686, final drive 3.308 | P | handbook; [Motor Trend](https://www.motortrend.com/reviews/mclaren-p1-how-i-set-the-motor-trend-production-car-record/) confirms 3.31 |
| Reverse | as 1st | E | not found |
| Tyres | 245/35 R19, 315/30 R20 | P | handbook |
| Redline, limiter | 8,500 rpm | P | handbook (Motor Trend lists 8,300) |
| Power | 542 kW (engine), 132 kW (motor), 674 kW system at 7,500 rpm | P | McLaren |
| Torque | 720 Nm from 4,000 to 7,000 rpm (engine), 900 Nm system | P | handbook, McLaren |
| Top speed | 350 km/h, electronically limited | P | McLaren |
| 0-100 / 0-200 / 0-300 | 2.8 / 6.8 / 16.5 s | P | McLaren |
| Mass | 1,492 kg, with fluids and 90% fuel | P | handbook |
| Weight split | 42 / 58 | P | handbook |

Estimated: the fall past 7,500 rpm and the drag area (0.80 m2), fitted to McLaren's 0-300.

### Porsche 918 Spyder (2013 to 2015)

| Figure | Value | Mark | Source |
| --- | --- | --- | --- |
| Engine | 4.6 V8 with a rear motor and a front axle motor | P | [Porsche press kit](https://web.archive.org/web/20190721105445/https://presse.porsche.de/presskits_until_2015/products/2013/spyder/text/presskit/918_Spyder_Fahrvorstellung_EN6_hp.pdf) |
| Transmission | 7-speed PDK | P | Porsche |
| Ratios | 3.91, 2.29, 1.58, 1.19, 0.97, 0.83, 0.67, R 3.55, final drive 3.09 | P | Porsche |
| Tyres | 265/35 ZR20, 325/30 ZR21 | P | Porsche |
| Redline, limiter | 9,150 rpm | P | Porsche |
| Power | 447 kW at 8,700 rpm (V8), 652 kW system | P | Porsche |
| Torque | 540 Nm at 6,700 rpm (V8), up to 1,280 Nm system | P | Porsche |
| Top speed | 345 km/h | P | Porsche |
| 0-100 / 0-200 / 0-300 | 2.6 / 7.3 / 20.9 s | P | Porsche (the car without the Weissach package) |
| Mass | 1,674 kg (DIN) | P | Porsche |
| Weight split | 43 / 57 | P | Porsche |

Estimated: the system curve's shape (the motors carry the low end), the 25% front share and the
drag area (1.0 m2, fitted to the top speed and 0-300; the real car also loses its front motor past
265 km/h, which the sim doesn't model).

### Bugatti Chiron Super Sport (2021 to 2022)

| Figure | Value | Mark | Source |
| --- | --- | --- | --- |
| Engine | 8.0 W16, four turbos, two of them only above 3,800 rpm | P | [Bugatti technical data](https://bugatti-newsroom.imgix.net/6673edce31d99cf64fc74087/211122_BU_Chiron%20Super%20Sport_ENG.pdf) |
| Transmission | 7-speed DSG dual clutch | P | Bugatti; Ricardo builds it ([Car and Driver](https://www.caranddriver.com/reviews/a35353692/2021-bugatti-chiron-sport-by-the-numbers/)) |
| Speed in each gear at the limiter | 100, 160, 210, 280, 340, 415 km/h, 7th "deactivated" | P | Bugatti technical data |
| Overall ratios, 1st to 6th | 9.229, 5.768, 4.395, 3.296, 2.714, 2.224 | D | 7,100 / 60 x 2 pi x 0.3448 m / (gear speed / 3.6) |
| Overall ratio, 7th | 1.882 | E | Bugatti only says 7th is 3.6% longer than the Chiron's ([press release](https://newsroom.bugatti.com/press-releases/the-bugatti-chiron-super-sport-the-quintessence-of-luxury-and-speed)); this assumes the 300+'s 490.48 km/h was at 7,100 rpm in the same gear |
| Tyres | 285/30 R20, 355/25 R21 (Michelin Pilot Sport Cup 2) | P | Bugatti |
| Redline, limiter | about 7,100 rpm | P | Bugatti press release |
| Power | 1,177 kW (1,600 PS) at 7,050 rpm | P | Bugatti |
| Torque | 1,600 Nm from 2,250 to 7,000 rpm | P | Bugatti technical data (the press release says from 2,000) |
| Top speed | 440 km/h, electronically limited, with the top speed key (380 without) | P | Bugatti |
| 0-100 / 0-200 / 0-300 / 0-400 | 2.4 / 5.8 / 12.1 / 28.6 s | P | Bugatti technical data (the press release says 5.5 s to 200) |
| Mass | 1,995 kg DIN, the Chiron's homologated figure; the Super Sport is 23 kg lighter | P | Bugatti |

Estimated: idle (900 rpm), the torque below 2,250 rpm, the 30% front share, the drag area
(0.855 m2) and the mass the sim uses (2,110 kg, the DIN figure plus a driver and test kit). The
last two are fitted together: Bugatti's 300 to 400 km/h takes 16.5 s, longer than any drag that
still lets the car reach 440 allows, so the extra mass slows that stretch without lowering the top
speed. With the limiter out the sim tops out at 436 km/h on drag, short of the 490.48 km/h the
300+ did.

### Koenigsegg Jesko Attack (2022)

| Figure | Value | Mark | Source |
| --- | --- | --- | --- |
| Engine | 5.0 twin turbo flat-plane V8 | P | [Koenigsegg](https://www.koenigsegg.com/technical-specifications-jesko-attack) |
| Transmission | 9-speed Light Speed Transmission: seven wet clutches, two 3-speed sets in series, any gear to any gear | P | Koenigsegg, [Car and Driver](https://www.caranddriver.com/features/a28927301/koenigsegg-new-transmission-promises-ultraquick-shifts/) |
| Ratio, 9th | 0.66 | P | Car and Driver |
| Ratios, 1st to 8th | 4.62, 3.62, 2.84, 2.23, 1.75, 1.37, 1.07, 0.84 | E | an even spread down to 9th |
| Final drive | 3.33 | E | puts the Absolut's claimed 531 km/h at 8,500 rpm in 9th on the tyre's nominal size, assuming the two share their gearing (on the loaded radius 9th tops out at 515) |
| Tyres | 265/35 R20, 325/30 R21 (Michelin Pilot Sport Cup 2) | P | Koenigsegg |
| Redline, limiter | 8,500 rpm | P | Koenigsegg |
| Power | 1,280 hp on petrol, 1,600 hp (1,195 kW) on E85, at 7,800 rpm | P | Koenigsegg |
| Torque | 1,500 Nm at 5,100 rpm, over 1,000 Nm from 2,700 to 6,170 | P | Koenigsegg |
| Downforce | 700 kg at 250 km/h, 1,000 kg at 290, 1,400 kg at most | P | Koenigsegg |
| Top speed, times | not published for the Attack | | |
| Mass | 1,420 kg kerb (1,320 kg dry) | P | Koenigsegg |

The sim runs the E85 figures. Estimated: all the gearing but 9th, idle (950 rpm), the torque
curve's shape and the aero. The drag area (1.0 m2) is a guess from the downforce, at about a third
of the lift like other high downforce road cars; the downforce area (2.0 m2) is cut back like the
other cars'. The top speed (413 km/h) and 0-100 (2.5 s) in carOptions are the sim's, with nothing
published to check them against.

### Pagani Huayra (2012 to 2017)

| Figure | Value | Mark | Source |
| --- | --- | --- | --- |
| Engine | Mercedes-AMG M158 6.0 twin turbo V12 | P | [Pagani](https://web.archive.org/web/20140118005046/http://www.pagani.com/huayra/default.aspx) |
| Transmission | 7-speed Xtrac sequential, single clutch, transverse | P | Pagani |
| Overall ratios | 8.870, 6.019, 4.555, 3.586, 2.957, 2.515, 2.161 | E | not published; set for 95, 140, 185, 235, 285, 335 and 390 km/h at 6,500 rpm |
| Tyres | 255/35 ZR19, 335/30 ZR20 (Pirelli P Zero) | E | the sizes usually quoted; Pagani only names Pirelli |
| Redline, limiter | 6,500 rpm | E | |
| Power | 537 kW (730 hp) | P | Pagani; the 5,800 rpm is the figure usually quoted |
| Torque | 1,000 Nm | P | Pagani; the 2,250 to 4,500 rpm plateau is the figure usually quoted |
| Top speed | over 370 km/h (230 mph) | P | as quoted by [Top Gear](https://www.topgear.com/car-reviews/pagani/huayra) |
| 0-100 | under 3.5 s | P | Top Gear |
| Mass | 1,350 kg dry, 44 / 56 split | P | Pagani |

Estimated: the gearing and redline, the torque curve's shape, the mass the sim uses (1,440 kg, dry
plus fluids) and the drag area (0.7 m2, set for the 370 km/h drag limit). The sim's 0-100 is
3.35 s, inside Top Gear's "under 3.5".

### McLaren Senna (2018)

| Figure | Value | Mark | Source |
| --- | --- | --- | --- |
| Engine | M840TR 4.0 twin turbo flat-plane V8 | P | [McLaren](https://cms-assets-production.mclaren.com/1628/McLaren-Senna-Technical-Specification.pdf) |
| Transmission | 7-speed SSG dual clutch | P | McLaren |
| Ratios | 3.981, 2.613, 1.905, 1.479, 1.161, 0.906, 0.686, R 3.981, final drive 3.308 | E | not published; the P1's, from the same SSG family |
| Tyres | 245/35 R19, 315/30 R20 (Pirelli P Zero Trofeo R) | P | McLaren |
| Redline, limiter | 8,500 rpm | P | McLaren |
| Power | 588 kW (800 PS) at 7,250 rpm | P | McLaren |
| Torque | 800 Nm from 5,500 to 6,700 rpm | P | McLaren |
| Top speed | 335 km/h, drag limited | P | McLaren |
| 0-100 / 0-200 | 2.8 / 6.8 s | P | McLaren |
| 0-60 / 0-100 / 0-160 mph | 2.8 / 5.1 / 12.5 s (+0.3 s rollout) | T | [Car and Driver](https://www.caranddriver.com/reviews/a25293693/2019-mclaren-senna-supercar-drive/) |
| Mass | 1,309 kg DIN (1,198 kg lightest dry) | P | McLaren |

Car and Driver's run is left out of the check: it is about 15% behind McLaren's own figures, and
no car can meet both. Estimated: the gearing, the torque outside the plateau and the drag area
(1.0 m2, set for the 335 km/h drag limit).

### Ferrari SF90 Stradale (2020)

| Figure | Value | Mark | Source |
| --- | --- | --- | --- |
| Engine | 4.0 twin turbo flat-plane V8 with three motors: one between engine and gearbox, one per front wheel | P | [Ferrari](https://cdn.ferrari.com/cms/network/media/pdf/pr_ferrari_sf90_stradale_gbr.pdf) |
| Transmission | 8-speed dual clutch, no reverse gear (the front motors back it up) | P | Ferrari |
| Overall ratios | 11.328, 7.842, 5.927, 4.742, 3.921, 3.289, 2.832, 2.427 | E | not published; set for 90, 130, 172, 215, 260, 310, 360 and 420 km/h at 8,000 rpm, top speed in 7th |
| Tyres | 255/35 ZR20, 315/30 ZR20 | P | Ferrari |
| Redline, limiter | 8,000 rpm | P | Ferrari |
| Power | 574 kW (780 cv) at 7,500 rpm (V8), 735 kW (1,000 cv) system | P | Ferrari |
| Torque | 800 Nm at 6,000 rpm (V8); system not published | P | Ferrari |
| Top speed | 340 km/h | P | Ferrari |
| 0-100 / 0-200 | 2.5 / 6.7 s | P | Ferrari |
| 0-60 mph | 2.0 s (+0.3 s rollout) | T | [Car and Driver](https://www.caranddriver.com/news/a37066187/2021-ferrari-sf90-stradale-60-mph-acceleration/) (Assetto Fiorano) |
| Mass | 1,570 kg dry with options, 45 / 55 split | P | Ferrari |
| Mass, measured | 1,741 kg (Assetto Fiorano) | T | [Motor Trend](https://www.motortrend.com/reviews/2021-ferrari-sf90-stradale-assetto-fiorano-first-test-review) |

Estimated: the gearing, what the motors add to the curve, the 25% front share (Car and Driver puts
the front motors at about 27% of peak power) and the drag area (1.22 m2, set for the 340 km/h drag
limit).

### Aston Martin Valkyrie (2021)

| Figure | Value | Mark | Source |
| --- | --- | --- | --- |
| Engine | Cosworth 6.5 V12, naturally aspirated, with a motor between engine and gearbox | P | [Aston Martin](https://www.astonmartin.com/en/models/valkyrie) |
| Transmission | 7-speed sequential, single clutch, no reverse gear (the motor backs it up) | P | Aston Martin |
| Overall ratios | 14.783, 10.195, 7.781, 6.291, 5.280, 4.549, 3.995 | E | not published; set for 100, 145, 190, 235, 280, 325 and 370 km/h at 11,100 rpm |
| Tyres | 265/35 ZR20, 325/30 ZR21 (Michelin Pilot Sport Cup 2) | P | Aston Martin |
| Idle | 1,200 rpm | P | Aston Martin |
| Redline, limiter | 11,100 rpm | P | Aston Martin |
| Power | 1,000 bhp at 10,500 rpm (V12), 1,160 bhp system | P | [Aston Martin, 2019](https://media.astonmartin.com/aston-martin-valkyrie-the-ultimate-hybrid-powertrain-for-the-ultimate-hypercar/) |
| Torque | 740 Nm at 7,000 rpm (V12), 900 Nm at 6,000 rpm system | P | Aston Martin, 2019 |
| Top speed | 354 km/h (220 mph) | P | Aston Martin |
| Mass | 1,270 kg "overall weight" | P | Aston Martin |

The current site gives the V12 as 1,001 bhp at 10,600 rpm and 780 Nm; the sim uses the 2019
system figures. Aston doesn't say what holds the car at 354 km/h, so the sim holds it there like
the LaFerrari. Estimated: the gearing, the torque curve's shape, the mass (1,355 kg, the kerb
weight usually quoted), the aero (drag area 1.1 m2, downforce area 1.3 m2) and so the sim's 0-100
of 2.7 s.

### Toyota Supra MK4 (JZA80 Turbo, export, 1993-1998)

| Figure | Value | Mark | Source |
| --- | --- | --- | --- |
| Engine | 2JZ-GTE 3.0 inline six, sequential twin turbos | P | [mkiv.supras.org.nz](http://mkiv.supras.org.nz/specs.htm) |
| Transmission | Getrag V160 6-speed manual | P | mkiv.supras.org.nz |
| Gear ratios | 3.827, 2.360, 1.685, 1.312, 1.000, 0.793, reverse 3.280 | P | mkiv.supras.org.nz |
| Final drive | 3.133 (export twin turbo, Torsen; Japanese cars 3.266) | P | mkiv.supras.org.nz |
| Tyres | 235/45 ZR17, 255/40 ZR17 | P | [Car and Driver](https://www.caranddriver.com/news/a27452748/2020-toyota-supra-vs-1993-toyota-supra-turbo-test-numbers/) |
| Idle | 600 to 700 rpm | P | mkiv.supras.org.nz |
| Redline | 6,800 rpm | P | Toyota |
| Power | 239 kW (320 hp) at 5,600 rpm | P | Car and Driver |
| Torque | 427 Nm at 4,000 rpm; 407 Nm from 1,800 rpm on the first turbo | P | Car and Driver, [Wikipedia](https://en.wikipedia.org/wiki/Toyota_Supra) |
| Top speed | 257 km/h (160 mph), governor limited | T | Car and Driver |
| 0-60 / 100 / 130 / 150 mph | 4.6 / 11.1 / 19.9 / 29.6 s (+0.3 s rollout) | T | Car and Driver |
| Mass | 1,565 kg (6-speed), 53 / 47 split | P | Wikipedia |

Estimated: the torque curve between the published points and the drag area (0.76 m2; Cd 0.32 on
about 1.9 m2 would be 0.61, fitted to the 130 and 150 mph times like the C63 507's).

## Transmissions

Estimated from the gearbox type, not measured on these cars:

| Box | Cars | Shift time | Torque kept while shifting | Launch revs |
| --- | --- | --- | --- | --- |
| Automated manual, single clutch | AMG One | 0.10 s | 30% (front motors) | 5,500 |
| 6-speed manual | E92 M3 | 0.30 s (a quick driver) | 0 | 4,200 |
| MCT 7 | C63 507 | 0.10 s | 30% | 3,500 |
| MCT 9G | C63 S, GT 63 S | 0.10 s | 30% | 3,000 |
| M DCT | M4 | 0.10 s | 70% | 2,500 (T) |
| ZF 8HP, converter | M5, M8 | 0.15 s | 40% | 3,000, converter 1.8 |
| Direct Shift-6AT | Crown | 0.30 s | 40% | 2,400 |
| Dual clutch | Huracán | 0.10 s | 70% | 4,200 (T) |
| Dual clutch with a motor filling the gap | LaFerrari, P1, 918 | 0.10 s | 80% | 3,000 to 3,500 |
| ISR, single clutch | Aventador S | 0.10 s | 0 | 5,500 |
| Dual clutch | Chiron Super Sport, Senna | 0.10 s | 70% | 3,500 |
| Light Speed Transmission, seven clutches | Jesko | 0.05 s | 80% | 4,000 |
| Sequential, single clutch | Huayra | 0.15 s | 0 | 3,500 |
| Dual clutch with motors filling the gap | SF90 Stradale | 0.08 s | 80% | 3,000 |
| Sequential, single clutch, with a motor | Valkyrie | 0.08 s | 30% | 6,000 |
| 6-speed manual | Supra MK4 | 0.30 s (a quick driver) | 0 | 4,000 |

## Tolerances

`scripts/race-drivetrain-check.mjs` fails outside these:

| What | Tolerance |
| --- | --- |
| Gear ratios, final drive, redline, idle, speed limiter, rolling radius | equal to the published figures |
| Revs at 100 km/h in top gear | 1% of the value from the published gearing and tyre |
| Driven wheel speed at the limiter, each gear | 1.5% of the published gearing |
| Road speed at the limiter, each gear | up to 8% below (wheelspin in the low gears), 1.5% above |
| Time to a speed, maker's figure | 10% |
| Time to a speed, road test | 12% |
| Top speed | 1.5% of the published figure |
| Revs never past the limiter | 2% overshoot at most |
| Top speed with the limiter out | 2% of the drag and gearing prediction |
| Final drive tune | revs at 100 km/h and gear speeds scale with the final drive within 1.5% |
| Engine map 115% | at least 2% quicker to 200 km/h |
| Wing, more power, limiter out | the wing lowers and more power raises a drag limited top speed |

## Results, stock (in game / real)

From `npm run check:drivetrain`, standard assists (traction control on), auto gears, flat road.
The in-browser harness (`scripts/race-harness-run.mjs`, `straight`) gives the same 0-100, 0-200 and
top speeds to the hundredth. Road test times include the 0.3 s rollout.

| Car | 0-100 s | 0-200 s | Top km/h | rpm at 100 km/h, top gear | Other |
| --- | --- | --- | --- | --- | --- |
| AMG One | 2.92 / 2.9 | 6.77 / 7.0 | 351.0 / 352 | 2,653 / 2,650 | 0-300: 15.40 / 15.6 |
| E92 M3 | 4.78 / 4.8 | 15.70 / 16.3 T | 249.9 / 250 | 2,748 / 2,744 | 0-241: 24.20 / 24.6 T |
| C63 507 | 4.22 / 4.2 | 12.78 / - | 279.5 / 280 | 1,775 / 1,771 | 0-97: 3.95 / 4.2 T, 0-161: 8.63 / 9.5 T, 0-257: 24.27 / 27.3 T |
| C63 S Coupe | 4.02 / 3.9 | 12.15 / - | 289.6 / 290 | 1,413 / 1,411 | 0-161: 8.10 / 8.4 T, 0-209: 13.27 / 13.8 T, 0-241: 18.43 / 19.0 T |
| F82 M4 | 3.93 / 4.1 | 12.68 / - | 249.9 / 250 | 1,879 / 1,876 | 0-161: 8.33 / 8.8 T, 0-209: 14.05 / 14.8 T |
| M5 Competition | 3.13 / 3.3 | 10.12 / 10.8 | 304.6 / 305 | 1,559 / 1,558 | |
| M8 Competition | 3.13 / 3.2 | 10.17 / 10.6 | 304.6 / 305 | 1,561 / 1,559 | |
| GT 63 S | 3.15 / 3.2 | 10.37 / 10.2 T | 314.4 / 315 | 1,487 / 1,485 | 0-160: 6.75 / 6.6 T |
| Crown Platinum | 5.72 / - | 22.90 / - | 208.0 / 208 | 1,868 / 1,866 | 0-97: 5.40 / 5.7 P and 5.4 T, 0-161: 13.85 / 13.8 T, 0-193: 20.63 / 21.1 T |
| Huracán | 3.07 / 3.2 | 9.15 / - | 321.7 / 325 | 2,624 / 2,621 | 0-97: 2.93 / 2.8 T, 0-161: 6.18 / 6.0 T, 0-241: 13.62 / 13.6 T |
| Aventador S | 3.15 / 2.9 | 8.85 / 8.8 | 353.7 / 350 | 1,863 / 1,862 | 0-300: 22.42 / 24.2 |
| LaFerrari | 2.78 / 3.0 | 6.48 / 7.0 | 349.6 / 350 | 2,322 / 2,319 | |
| P1 | 2.83 / 2.8 | 6.63 / 6.8 | 349.3 / 350 | 1,783 / 1,781 | 0-300: 15.07 / 16.5 |
| 918 Spyder | 2.47 / 2.6 | 7.23 / 7.3 | 341.8 / 345 | 1,557 / 1,554 | 0-300: 19.00 / 20.9 |
| Chiron Super Sport | 2.35 / 2.4 | 5.52 / 5.8 | 435.3 / 440 | 1,449 / 1,448 | 0-300: 11.58 / 12.1, 0-400: 25.87 / 28.6 |
| Jesko Attack | 2.47 / - | 4.82 / - | 412.8 / 413 E | 1,653 / 1,650 | |
| Huayra | 3.35 / - | 8.07 / - | 367.8 / 370 | 1,669 / 1,667 | |
| Senna | 2.67 / 2.8 | 6.53 / 6.8 | 337.4 / 335 | 1,784 / 1,781 | |
| SF90 Stradale | 2.40 / 2.5 | 6.45 / 6.7 | 341.1 / 340 | 1,907 / 1,904 | 0-97: 2.30 / 2.3 T |
| Valkyrie | 2.73 / - | 5.85 / - | 353.2 / 354 | 3,005 / 3,000 | |
| Supra MK4 | 5.07 / - | 18.28 / - | 256.3 / 257 T | 2,141 / 2,137 | 0-97: 4.85 / 4.9 T, 0-161: 11.55 / 11.4 T, 0-209: 20.25 / 20.2 T, 0-241: 30.32 / 29.9 T |

Max speed per gear at the limiter, km/h (road speed in game / from the published gearing). The
driven wheels match the published figure within 1 km/h in every gear; road speed is a little lower
in the low gears because the wheels slip. A dash is a gear the car can't reach the limiter in.

| Car | Gears |
| --- | --- |
| AMG One | 109/111, 151/154, 199/202, 252/256, 309/313, -/368, -/415 |
| E92 M3 | 65/66, 111/113, 166/169, 221/224, 264/267, 303/306 |
| C63 507 | 66/68, 102/104, 152/155, 213/217, 293/297, -/362, -/406 |
| C63 S Coupe | 55/56, 90/92, 130/132, 179/182, 243/246, 294/298, -/346, -/414, -/496 |
| F82 M4 | 56/57, 103/105, 157/160, 210/213, 268/272, -/322, -/405 |
| M5 Competition | 59/59, 91/92, 137/138, 170/172, 223/225, 293/296, -/359, -/462 |
| M8 Competition | 59/59, 91/92, 136/138, 170/172, 223/225, 293/295, -/359, -/462 |
| GT 63 S | 52/53, 86/87, 124/126, 171/172, 232/234, 281/283, 327/329, -/393, -/471 |
| Crown Platinum | 52/52, 92/93, 149/150, 203/205, -/275, -/348 |
| Huracán | 70/70, 104/105, 138/139, 175/177, 222/224, 277/279, 322/324 |
| Aventador S | 98/99, 156/158, 211/213, 262/264, 323/325, -/399, -/457 |
| LaFerrari | 87/90, 123/127, 166/170, 210/215, 264/269, 324/329, -/399 |
| P1 | 80/82, 122/125, 168/172, 217/221, 277/282, 357/361, -/477 |
| 918 Spyder | 99/101, 169/172, 246/250, 328/331, -/407, -/475, -/589 |
| Chiron Super Sport | 97/100, 157/160, 207/210, 276/280, 336/340, 411/415, -/490 |
| Jesko Attack | 72/74, 90/94, 113/120, 142/152, 187/194, 241/248, 311/318, 399/405, -/515 |
| Huayra | 91/95, 136/140, 181/185, 230/235, 280/285, 330/335, -/390 |
| Senna | 80/82, 122/125, 168/172, 217/221, 277/282, -/361, -/477 |
| SF90 Stradale | 88/90, 127/130, 169/172, 211/215, 256/260, 306/310, -/360, -/420 |
| Valkyrie | 97/100, 140/145, 185/190, 229/235, 274/280, 319/325, -/370 |
| Supra MK4 | 65/66, 105/107, 148/150, 190/192, 249/252, -/318 |

The per gear runs take the speed limiter out, so the gears above the stock limit show where drag
stops them.

## Tunes

The garage's tune works through the same physics, so it changes the car the way it would change the
real one:

- **Final drive** (plus or minus 10%): revs at a given speed go up or down by exactly that much and
  every gear's top speed down or up by the same share. A short final drive makes the E92 turn
  3,023 rpm at 100 km/h in 6th instead of 2,748 and run out of 1st at 60 instead of 66 km/h.
- **Engine map** (85 to 115%): scales the whole torque curve. At 115% the M5 goes 0-200 in 8.93 s
  instead of 10.12. It doesn't move the speed limiter.
- **Speed limiter** (new, garage Tuning tab): taking it out lets the car run to where drag or the
  redline in top gear stops it. It counts as a tune (tuned leaderboard), and adds a digit to the
  tune code, so older codes keep their meaning.
- **GT wing and ducktail**: their extra drag lowers a drag limited top speed; with the limiter in
  it only shows when the drag limit drops below it.

Top speed with the limiter out, km/h, in game (drag and gearing prediction):

| Car | Limiter out | Limiter out, 115% | Limiter out, GT wing |
| --- | --- | --- | --- |
| AMG One | 353.7 (356.9 drag) | 371.6 | 349.1 |
| E92 M3 | 302.6 (306.2, 6th gear redline) | 302.1 (redline) | 302.9 |
| C63 507 | 305.6 (306.8 drag) | 321.2 | 299.4 |
| C63 S Coupe | 322.7 (326.9 drag) | 340.9 | 316.7 |
| F82 M4 | 302.6 (304.0 drag) | 316.9 | 296.3 |
| M5 Competition | 337.2 (338.3 drag) | 352.6 | 331.1 |
| M8 Competition | 339.2 (340.3 drag) | 356.5 | 333.0 |
| GT 63 S | 342.4 (343.3 drag) | 358.6 | 335.3 |
| Crown Platinum | 264.9 (267.3 drag) | 278.8 | 261.0 |
| Chiron Super Sport | 436.1 (436.2 drag) | 467.7 | 423.9 |
| Valkyrie | 364.3 (370.1, 7th gear redline) | 363.4 (redline) | 363.8 |

None of these have a real reference; they follow from the published power and the drag areas above
(several of which are estimated). The prediction counts aero drag only: in this tire model rolling
resistance only acts while a wheel's speed is changing, so it doesn't hold the car back at a steady
speed either.

## Drifting before and after

`scripts/race-harness-run.mjs --skip physics,stress` before (commit b952d52) and after. The drift
assist test flicks on the handbrake at 80 km/h, then holds full throttle with a bit of steer for
3.5 s (held share, mean and standard deviation of the body slip angle, speed at the end):

| Car | Held | Mean slip | Slip sd | End speed |
| --- | --- | --- | --- | --- |
| AMG One | 100 -> 100% | 21 -> 21 deg | 0.2 -> 0.3 | 147 -> 140 km/h |
| E92 M3 | 100 -> 100% | 21 -> 21 deg | 0.9 -> 0.9 | 99 -> 98 km/h |
| C63 507 | 100 -> 100% | 22 -> 22 deg | 0.8 -> 0.6 | 104 -> 111 km/h |
| C63 S Coupe | 100 -> 100% | 22 -> 22 deg | 1.0 -> 0.7 | 116 -> 119 km/h |
| F82 M4 | 100 -> 100% | 22 -> 22 deg | 0.5 -> 0.4 | 112 -> 115 km/h |
| M5 Competition | 100 -> 100% | 21 -> 21 deg | 0.3 -> 0.3 | 121 -> 125 km/h |
| M8 Competition | 100 -> 100% | 20 -> 21 deg | 1.0 -> 0.3 | 115 -> 119 km/h |
| GT 63 S | 100 -> 100% | 20 -> 21 deg | 0.5 -> 0.2 | 123 -> 127 km/h |
| Crown Platinum | 100 -> 100% | 20 -> 20 deg | 1.0 -> 0.3 | 99 -> 99 km/h |

No car spins, the exit takes the same time (0.38 to 0.42 s). The skidpad, step steer and braking
numbers are unchanged, and so are the on track stress runs (200 km/h drift and 220 km/h slalom
from Döttinger Höhe, the Flugplatz and Pflanzgarten crests): no spins, recoveries or sunk wheels.

What changed and why:

- The real tyres are smaller than the model based radius for most cars (up to 7%), so the same
  road speed means more revs. The drift assist picks its gear by road speed revs, so it upshifted
  a little earlier mid slide, and with the E92's slower manual shift the car then dropped back
  under the threshold and hunted between 2nd and 3rd (slip sd went to 1.9). The threshold is now
  64% of the redline instead of 62%, which puts the shift back where it was, and mid slide it only
  shifts back down once the lower gear is well inside its range (54%), so it can't hunt.
- Before, the clutch slipped up to the launch revs in any gear whenever the wheels were slower,
  which also meant cruising in a high gear showed the wrong revs. Now that only happens pulling
  away and mid drift, where it acts like a clutch kick and keeps the slide going after a shift the
  way the old behaviour did.
- The automatics and the dual clutch keep some drive while they shift, so the drift assist's gear
  changes mid slide are gentler. That's why several cars hold their angle more steadily.
- The rev limiter no longer reads as active through a whole gear change (it used to, when a shift
  started on the limiter), so the limiter sound stops during shifts.

## Also changed

- The HUD tach has a per car range (`tachMaxRpm`) with the red zone from the car's redline. The
  speed shown is the true speed over the ground, as before.
- Audio: the limiter plays when the physics cuts, at the real redline. The Crown's audio profile
  limiter moved to 6,500 rpm with its redline; the other profiles already matched. Remote cars and
  ghosts get their revs from the same gearing and rolling radius (they used to add idle revs on
  top). The demo clips in `docs/audio-samples` are re-rendered with the new gearing and limiters;
  the Crown's pulls to the limiter in 3rd because its 4th runs out at its top speed.
- Stock lap times change for every car, so the lap tag is `@v4`, the multiplayer channels use
  physics season `p4`, and the local leaderboard, ghost and sector keys moved to v4.

## Not verified

- Idle speeds, except the AMG One (1,280, quoted) and the M4 (720, measured from a recording).
- The Crown's redline (6,500 is an estimate) and its own gear ratios and final drive (the RX 500h's
  are used).
- The GT 63 S's redline (7,000, from the same engine in the C 63 S) and whether its 315 km/h is
  governed.
- The AMG One's combined torque curve and drag, the C63 507's, C63 S's, GT 63 S's and Crown's drag
  areas: estimated or fitted to the times above.
- Shift times and the torque kept while shifting, and the converter's torque ratio.
- The shape of every torque curve outside the published plateau and peak points.
- The E92's 16.3 s 0-200 is from a magazine table quoted on a forum; the magazine isn't named.
