# The 3D effect: painted depth on a box body

Read this when shading an outfit, or when a result looks flat. Classic clothing gets no normal map, and Roblox lights each face of the box body almost flat. So every sense of depth (round limbs, folds, raised pockets, a belt standing off the cloth) is painted into the template. It happens in two stages:

1. **The code bakes light and shade** into each face. It decides where the depth is: which edges darken, where folds run, what casts a shadow. This alone gives a clean, readable result (`build --code`).
2. **The image model repaints** the shaded guide. It keeps the positions and adds what code does badly: the material (fleece, denim, silk, leather), sheen, soft fold shapes, embroidery and prints. It paints its folds where the guide already shows them, which is why the code's shading matters even when you repaint.

## How the engine shades

Each `Face` holds a label map and two shade layers at 8× resolution: `shade`, which multiplies the colour, and `add`, which is added to it. At render time:

- **Light cloth** (brightest channel above 0.4, so saturated reds and blues count; or `SHADE_AS = {"x": "light"}`): colour × shade + add. Darkening by multiplying looks natural on light cloth. The `guides` stage prints each label's class.
- **Dark cloth**: colour × (0.6 + 0.4 × shade) + add. Multiplying near-black changes almost nothing, so on dark cloth depth comes from *adding light*. A crease on black cloth is a lighter ridge with a shadow beside it, not a dark line. `Face.fold` and the `shading.py` functions switch automatically by label.
- **Weave:** a fine noise, ±2.5% on light cloth and ±10% on dark cloth (dark cloth needs more for the texture to show).

Shade a black outfit as light cloth and it renders flat. Shade a white one as dark cloth and its folds glow.

## The six layers, and the calls that paint them

Paint them roughly in this order on every face. Depths are fractions of brightness (0.08 = 8% darker); sizes are template px. The defaults are the values that worked on the outfits this came from.

| Layer | What it does | Calls (in `shading.py`, `import shading as sh`) |
|---|---|---|
| 1. Key light | Light from above: each face a little brighter at the top (+2.5% to −3%). Each side of a limb gets its own value: front 1.0, back 0.97, outer 0.99, **inner 0.90** (it faces the body) | `sh.top_light(f)`, `sh.side_light(f, key)` on limbs |
| 2. Occlusion | Darken where parts meet: torso front and back toward their sides, under the arms; the torso's sides under the arm; each limb face toward its long edges, so the box reads round | `sh.underarm(f, key)` on the torso, `sh.round_edges(f)` on limbs, `round_edges(f, sides=True, ends=True)` on top faces |
| 3. Seams | A thin dark line with a thinner highlight beside it (on dark cloth: a light ridge with a shadow) | `sh.seam(f, points)`: side seams at x 32, the shoulder seam at row ~2.5, panel edges, pocket edges |
| 4. Folds | Cloth bends at joints and gathers where it is held | `sh.creases(f, row)` arcs at the elbow and knee (rows ~58–66); `sh.bunching(f, row)` short creases above a cuff, hem or band; `sh.pull(f, starts, target)` long folds toward what pulls the cloth (shoulders toward a belt knot, a zip, a pocket); `f.fold(points)` for any other |
| 5. Raised pieces | A lit top edge, a shaded bottom edge, and a soft shadow on the cloth below | `sh.bevel(f, x0, y0, x1, y1, labs=...)` on cuffs, bands and flaps; `sh.cast_shadow(f, points, labs=<the cloth below>)` under collars, belts, pockets, straps, drawstrings, hems; `sh.button(f, cx, cy, r, lab, cloth=...)`; `sh.ribbing(...)` for knit cuffs and hems; `sh.wrap_band(f, top, bottom, lab)` for a belt right round |
| 6. Weave | Fine noise | Automatic |

**Where folds go on the R15 body:**
- **Torso front:** from the shoulders (rows 10–30, near the sides) diagonally toward the waist's centre or whatever gathers the cloth.
- **Torso back:** shallow and fewer.
- **Arms:** a few long folds down the upper arm; arcs at the inside of the elbow on the front face (row ~58); short creases piled above the cuff.
- **Legs:** arcs at the knee on the front (row ~60) and behind it on the back (row ~66); short creases above the hem or shoe; whiskers from the crotch on jeans (front face, inner edge, rows 10–25).

## Judging the shading

- **Look at `guides/views.png` and the guide sheets first.** Every fold, seam and shadow the repaint should keep must already be there, at its place. The model repaints; it doesn't place.
- **Keep it subtle in code.** Depths of 0.05–0.10 for folds and 0.14–0.22 for seams and cast shadows. The repaint strengthens what it sees; heavy code shading comes back as hard stripes.
- **No hard steps.** A shading change that stops at a row (`np.where(y < 84, …)`) shows as a line across the cloth unless a band covers that row. Fade it over 10–20 rows, as `sh.underarm` does.
- **Shadows go on the cloth below**, not on the piece that casts them: `cast_shadow(..., labs="coat")` under a belt drawn in `"belt"`.
- **Check at game distance.** Fine shading disappears at 20 studs; the light and dark sides of the limbs and the shadows under big pieces stay.

## Code-only, fused or repainted

| Build | Gives | When |
|---|---|---|
| `build --code` | The code's colours and shading only | No image model available; very simple or stylized outfits; a quick placeholder |
| `build --fuse` | The palette's flat colours with the repaint's light and shade | The repaint's colours drifted but its folds are good |
| `build` (direct) | The repaint's pixels, each big area's colour brought to the palette | The normal result |
