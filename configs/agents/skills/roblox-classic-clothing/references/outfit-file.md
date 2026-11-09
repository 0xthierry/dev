# The outfit folder and outfit.py

Read this when writing or editing an outfit. The worked example is [`examples/hoodie/outfit.py`](../examples/hoodie/outfit.py): a zip hoodie, jeans and sneakers that uses most drawing and shading calls below. [`examples/hoodie/hoodie-views.png`](../examples/hoodie/hoodie-views.png) is its finished result after one repaint.

## The folder

```
<outfit>/
  outfit.py                    labels and drawing (you write it)
  prompts/torso.md, arm.md, legs.md   the repaint's Subject lines (you write them)
  concept.png                  optional: the outfit's look, the repaint's reference for materials and colours
  guides/                      written by `guides`: code-only shirt.png / pants.png, guide_*.png, labels_*.png, views.png
  ai/                          written by `repaint`: ai_torso.png, ai_arm.png, ai_legs.png (+ earlier attempts .1, .2…)
  final/                       written by `build`: shirt.png, pants.png, views.png
  preview/                     written by `preview`: one texture per R15 body part, for Studio
```

Keep `outfit.py`, `prompts/`, `concept.png` and **`ai/`** under version control. The repaints are the only way to rebuild the templates exactly: the image model never returns the same image twice. `guides/`, `final/` and `preview/` are regenerated from them.

A game repository can either call the skill's scripts in place or copy `scripts/` into the repository (e.g. `tools/clothing/`) so its outfits rebuild without the skill. Outfit files import `engine` and `shading` either way.

## What outfit.py must give

```python
import engine
import shading as sh

PALETTE = {"coat": (120, 30, 40), "trim": (230, 190, 90), "trousers": (40, 40, 46),
           "boot": (60, 40, 30), "sole": (30, 26, 24), "sole_under": (60, 58, 56)}

def coat_torso(f, key): ...      # paint one torso face; key in "FBLRUD"
def sleeve(f, key): ...          # paint one face of the RIGHT arm
def trousers_waist(f, key): ...  # the Pants' torso faces (they show only where the Shirt is transparent)
def leg(f, key): ...             # one face of the RIGHT leg

def faces():
    shirt = engine.garment("shirt", coat_torso, sleeve)
    pants = engine.garment("pants", trousers_waist, leg)
    sh.button(shirt["left"]["L"], 32, 20, 3, "trim")  # one-sided details go after garment()
    return shirt, pants
```

- **`PALETTE`**: one entry per colour area, `name: (r, g, b)` in 0–255. Up to 254 labels. `"none"` is reserved: transparent in the template, flat mid-grey in the guides. Every pixel a face doesn't paint is `none`.
- **`faces()`** returns `(shirt, pants)`; either may be `None` for a Shirt-only or Pants-only item. Build each with `engine.garment(name, draw_torso, draw_limb)`. It hands every blank face to your function with its key and mirrors the right limb into the left.

**Limits:**
- The guide sheets cover the Shirt's torso and right arm and both of the Pants' legs. The Pants' torso faces get only the code's shading: put anything that shows on the torso (belts, waistbands seen under a short top) on the Shirt.
- An item sold alone (a Shirt worn with any Pants) can't rely on the other half.

## Optional settings

| Setting | Default | Use |
|---|---|---|
| `CONCEPT` | `"concept.png"` | The reference image, relative to the folder |
| `SHADE_AS` | by brightness | `{"label": "light" or "dark"}`. Labels whose brightest channel is above 0.4 (102/255) are shaded as light cloth (by multiplying), the rest as dark cloth (by adding light). `guides` prints each label's class. Override a label so it shades like the cloth next to it |
| `REGISTER_LEGS` | `()` (off) | `("sole", "shoe", 118)`: realign the legs repaint on each leg's last band of label `sole` (told apart from the label `shoe` above it), which must start at row 118 and run to 128. Use it whenever the shoes have a band at the bottom that contrasts with what's above it |
| `GREY_FILL` | `"edges"` | Where the build replaces flat mid grey the repaint left inside cloth (with that area's own repaint colour, shaded like the code): `"edges"` (within 6 px of a face's border, where the model's grey bleeds in), `"any"`, or `"off"` for outfits painted in greys themselves. Never touched: cloth whose colour is near grey (every channel 64–191), and areas the repaint made grey as a whole (a silver zip). `check` reports grey this setting leaves |
| `SKIN` | `()` | See-through skin labels, e.g. `("skin",)`. Painted in their `PALETTE` tone in the guides (so the image model paints skin, muscles included), they reach the template only as translucent dark and light, so the shading works on every wearer's skin tone. Under them the Pants' torso faces show through: put waistbands on the Shirt and leave the Pants' torso faces empty there. Example: [`examples/fighter`](../examples/fighter/outfit.py) |
| `CODE_LABELS` | `()` | Labels always taken from the code, never the repaint: details the model can't see, such as a mark on the left sleeve only |
| `NORMALIZE` | areas ≥ 2% of the painted pixels | Labels whose repaint colour is brought to the palette (its median), so the three sheets agree |
| `GAIN_FLOOR` | 0.7 for every label | `{"label": 0.25}`: how far the build may darken a repaint colour toward the palette; also excludes that label from the check |

## Drawing: `Face`

Coordinates are template px on the face, x right, y down, floats allowed. Torso faces are 128 wide (F, B, U, D) or 64 (L, R), and 128 tall (U and D: 64). Limb faces are 64 wide and 128 tall (U and D: 64×64). A label is a `PALETTE` name.

| Call | Draws |
|---|---|
| `f.rect(x0, y0, x1, y1, lab)` | A rectangle |
| `f.poly(points, lab)` | A polygon |
| `f.ellipse(cx, cy, rx, ry, lab)` | An ellipse |
| `f.line(points, width, lab)` | A polyline with round ends |
| `f.dashed(points, width, lab, dash=2, gap=1.5)` | Stitching, zip teeth, lace rows |
| `f.band(top_fn, bot_fn, lab)` | A band between two edge functions of the ring position (continues on the next face) |
| `f.stripes(labs, width, y0=0, y1=None, phase=0)` | Vertical stripes right round the part, cycling through `labs`; the girth (384 or 256) should be a multiple of `len(labs) * width` |
| `f.stroke(points, width, blur, dark=0, light=0, labs=None)` | Soft shade along a line: `dark` multiplies by (1 − dark), `light` adds; only on `labs` |
| `f.fold(points, width=1.4, blur=1.2, depth=0.08, labs=None)` | A crease, right for light and dark cloth (see [shading](shading.md)) |
| `f.gradient(fn, labs=None)` | Multiplies the shade by `fn(x, y)`, numpy arrays in, an array or a number out |

`f.w`, `f.h` are the face's size; `f.s0` is where the face starts round its part and `f.ring` the part's girth (torso 384, limb 256), for patterns of your own that must continue from face to face ([continuity](template-and-body.md#continuity-round-the-body)). The top and bottom faces (U, D) have no ring position (`s0` is 0).

Draw in this order on each face:
1. the fills, largest first;
2. the details on top: trims, buttons, pockets;
3. the shading.

Shading calls take `labs` so a highlight on the coat doesn't spill onto its trim. Shade is stored per pixel, and `labs` is read from the labels as they are when the call runs. So a detail drawn later keeps any shade already on its pixels, but misses shading meant for its own label.

## The example's choices, to copy

- **Rows as named constants** at the top (`HEM`, `CUFF`, `WRIST`, `SOLE_TOP`), so a change moves every face together.
- **One function per kind of face** (torso, sleeve, waist, leg) that branches on `key` for the front, the back and the sides.
- **The shoe at the bottom of the leg faces:** the upper from row 104, the sole from row 118, the sole's underside on the D face. Then `REGISTER_LEGS = ("sole", "shoe", 118)`.
- **A shading pass on every face:** `top_light`, `side_light` (limbs) or `underarm` (torso), and `round_edges` (limbs); then the seams, folds and cast shadows of its details.
