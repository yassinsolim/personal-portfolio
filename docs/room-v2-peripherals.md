# Room v2: Yassin's peripherals

Research for the modelled peripherals in the baked room (`scripts/room/parts/keyboard.py` and
`props.py`, sizes in `scripts/room/setup.json`). Everything is modelled from scratch in bpy; no
downloaded models, and brand logos are left off.

| Product | Dimensions used | Look modelled | Sources | Confidence |
|---|---|---|---|---|
| Finalmouse UltralightX Phantom, Lion (medium) | 121.3 L x 56.8 W (grip) x 37 H mm | Matte black shell with black knurled wheel and side buttons, and the Phantom's small light grey inlays (they read pale blue in Finalmouse's photo) near the front of the buttons, low on the front sides and on the hump; symmetric Finalmouse shape with the hump behind centre | [Finalmouse archive: UltralightX Phantom](https://finalmouse.com/pages/mice) (its photo is the colour reference), [Lion, Cheetah and Tiger sizes from Finalmouse's size guide](https://bestgamingmice.net/finalmouse/), ["UltralightX Lion (Medium) / Phantom", colour black](https://www.ebay.com/p/22064352406) | Model and size: high (his answer). Inlay placement: medium |
| Artisan Ninja FX Hien, size L | 420 x 330 mm; 4 mm thick (XSOFT and SOFT, the MID base is 3 mm) | Ninja Black cloth, square cut edges with small rounded corners, no stitching; the small Hien logo is left off | [Artisan FX Hien sizes and surface](https://artisan-jp.com/global/fx-hien), [colours and part numbers](https://item.rakuten.co.jp/onlineshop-a-style/artisan-hien04/) | Size: high. Colour and hardness: medium |
| Wooting 60HE | 302 x 116 x 38 mm with caps, 18 mm at the front edge, 6 degree typing angle, 605 g | Black textured ABS tray case with thin bezels, 61 key ANSI 60% layout, black PBT caps over a light switch plate, the yellow "Take Control" strap clipped to the left side near the back, black USB-C cable off the back edge | [Wooting 60HE tech specs](https://wooting.io/wooting-60he), [LanOC review (18 mm front, strap on the left, textured black case)](https://lanoc.org/review/input-devices/wooting-60he?showall=1), [strap clip on the left top side](https://wooting.io/quickstart/keyboard/wooting-60he/prebuilt), [white switch plate](https://prosettings.net/reviews/wooting-60-he/) | Size: high. Strap colour: medium |
| Sennheiser HD 599 SE, black | Oval cups about 110 x 88 mm, pads about 24 mm, shells 30 mm, 176 mm between cup centres lying flat, 30 mm band; whole headphone about 183 x 155 x 81 mm, 250 g | Black open back over ear: matte black band and cups, dark grey grille, thin silver trim ring, dark grey velour pads. Lying flat on the desk's left side, pads down, band arcing behind | [Sennheiser HD 599 SE specifications](https://support.sennheiser-hearing.com/hc/en-us/articles/38273810522141-HD-599-SE-Specifications), [black SE pads](https://eu.sennheiser-hearing.com/en-de/products/op-hd-599), [product dimensions and silver accents](https://www.amazon.ca/dp/B07RFNZYJZ), [HD 5xx pad size 110 x 85 x 25 mm (third party)](https://www.equipo.co.uk/products/replacement-sennheiser-hd598-range-ear-pad-cushions) | Weight and type: high. Cup and band sizes: medium |

## What's uncertain

- **The Phantom's inlays.** Their colour and places come from Finalmouse's one archive photo, so
  they're close but not measured. The shell's engraved panel lines are left off. The three ULX
  sizes are one shape scaled (their published length, grip width and height keep the same ratios),
  so the Lion is the Tiger's profile at 121.3 x 56.8 x 37 mm.
- **Pad colour and base.** The Hien comes in Ninja Black, Wine Red and Navy Blue, and in XSOFT, SOFT
  and MID bases. Black and 4 mm are assumed.
- **Strap colour.** Wooting ships the yellow strap; it can be swapped.
- **HD 599 SE sizes.** Sennheiser publishes the weight but no dimensions. The cup and pad sizes come
  from third party replacement pads and the retail listing's overall size, so they're good to a few
  millimetres.
- Keyboard lighting is off in the bake (the per key RGB isn't baked), and no cable is modelled for
  the headphones.
