# The template and the R15 body

Read this before drawing any face. It holds the geometry that every outfit must respect. The engine (`scripts/engine.py`) encodes the same numbers; use the constants there rather than retyping them.

## The template

Roblox's classic Shirt and Pants images are 585×559 PNGs with the same layout. A Shirt paints the torso and both arms; Pants paint the torso and both legs. Where both cover the torso, the Shirt is drawn over the Pants. Transparent pixels show the body (skin) underneath.

| Part | Face | x, y | w × h |
|---|---|---|---|
| Torso | U top | 231, 8 | 128 × 64 |
| | R wearer's right side | 165, 74 | 64 × 128 |
| | F front | 231, 74 | 128 × 128 |
| | L wearer's left side | 361, 74 | 64 × 128 |
| | B back | 427, 74 | 128 × 128 |
| | D bottom | 231, 204 | 128 × 64 |
| Right limb | U top | 217, 289 | 64 × 64 |
| | L inner side | 19, 355 | 64 × 128 |
| | B back | 85, 355 | 64 × 128 |
| | R outer side | 151, 355 | 64 × 128 |
| | F front | 217, 355 | 64 × 128 |
| | D bottom (palm or sole) | 217, 485 | 64 × 64 |
| Left limb | U, F, L (outer), B, R (inner), D | 308, 289 / 308, 355 / 374 / 440 / 506 / 308, 485 | same sizes |

Every face is drawn as seen from outside the body. On the front face the wearer's left is the image's right. On the back face the wearer's left is the image's left.

**Resolution:** 585×559 is the limit. A 1170×1118 upload rendered identically in Studio, so detail must come from the art, not from pixels.

## The body's rows

Measured on the R15 Blocky body in Studio; Roblox's Man and Woman bodies map the same way.

| Template rows | Torso face | Limb face (F, B, L, R) |
|---|---|---|
| 0–96 | UpperTorso. Row 0 is at the shoulders; the head hides rows ~0–3 in the middle | 0–64: upper arm or thigh. A leg's rows 0–12 are hidden under the torso |
| 96–128 | LowerTorso, down to the hip line where the legs start | 64–108: forearm or shin. At rest the upper arm hides forearm rows 64–85 |
| 108–128 | | Hand or foot. The foot shows rows ~114–126 |

**Rules that follow from the rows:**
- **Hands:** leave rows 108–128 of the arms transparent (`none`) so the skin shows, unless the outfit has gloves.
- **Feet:** the shoe lives in rows ~104–128; a sole from row ~118 reads. Keep the sole's underside (leg D faces) dark: the Man and Woman bodies' feet sample it, and a light underside reads as white shoes.
- **The waist seam:** UpperTorso and LowerTorso meet at row 96. A belt or band over rows ~84–104 hides the seam; without one, keep shading continuous across row 96.
- **The torso's U and D faces** are mostly hidden (the head, the legs). Fill them plainly. The Shirt's D face is usually a rim round a transparent middle, so the Pants' D face shows through.
- **Which edge of a U or D face meets which side face hasn't been verified.** On the template the torso's U sits right above its front, which suggests U's bottom edge meets the front's top edge. Keep U and D faces plain or symmetric, or check them in the Studio preview before relying on an orientation.

**Starting rows for common lengths** (limb rows; derived from the table above, with the elbow and knee at about row 64; confirm in Studio):

| The garment ends | Row | The garment ends | Row |
|---|---|---|---|
| Cap sleeve | ~20 | Short shorts | ~30–40 |
| T-shirt sleeve | ~36–44 | Shorts above the knee | ~48–56 |
| Elbow-length sleeve | ~60 | Knee-length | ~64–70 |
| Three-quarter sleeve | ~88–95 | Below the knee (capri) | ~80–90 |
| Long sleeve, at the wrist | 108 | Long trousers, over the shoe | ~100–104 |
| Knee socks start | ~68–74 | Ankle socks start | ~98–102 |
| Shoe upper starts | ~104 | Sole starts | ~118 |

A sleeve that ends inside forearm rows 64–85 looks, at rest, as if it ended at the elbow: the upper arm hides those rows.

## Continuity round the body

Bands and stripes must meet at the corners of the box. The engine gives each side face a start position round its part:

- **The torso** is 384 px round: F starts at 0, L at 128, B at 192, R at 320 (`engine.WAIST`).
- **The right limb** is 256 px round: L (inner) at 0, B at 64, R (outer) at 128, F at 192 (`engine.LIMB_RING`).

`Face.band(top_fn, bot_fn, lab)` and `shading.wrap_band` take the edges as functions of that ring position, so a wavy belt meets itself on every corner. `Face.stripes(labs, width)` does the same for vertical stripes. Straight bands (a `rect` at the same rows on every face) meet without it. The U and D faces have no ring position.

**The torso and legs:** the torso front's x 0–64 sits over the right leg's front, and x 64–128 over the left leg's. A long coat hem carried onto the thighs must line up there.

## Mirroring

Draw each limb once, as the right limb; `engine.garment` makes the left limb by mirroring it. The right limb's L face (inner) becomes the left limb's R face (also inner), and so on (`engine.MIRROR`). The top face (U) mirrors top to bottom; the others mirror left to right.

- **One-sided details** (a badge on one sleeve, a patch on one knee, a tail hanging on one leg) must be drawn on `garment["left"]` or `garment["right"]` **after** `engine.garment` returns. Drawn before, they appear on both sides.
- **The repaint sees only the right arm.** The left arm takes the right arm's repaint, mirrored. Keep a one-sided arm detail with `CODE_LABELS` ([outfit file](outfit-file.md)). The legs sheet holds both legs, so the legs can differ.

## Bodies that show classic clothing

| Body | Classic clothing |
|---|---|
| R15 Blocky; Roblox's Man and Woman bodies | Shows, as this reference describes |
| R6 | Shows (the same template; the R6 body has fewer parts). Not tested with this engine |
| UGC bodies (e.g. Anime styles) and some Rthro bodies (e.g. Oinan) | Shows **nothing**: these meshes aren't laid out for the template |

If the game lets players keep their own avatar bodies, decide how to handle the bodies that show nothing before making many outfits:
- force a body in the game's avatar settings or with a `StarterCharacter`;
- or dress those bodies another way (layered clothing).

## What classic can't shape

Classic clothing paints on boxes. A hem below the hips splits with the legs, a wide sleeve can't hang free, and nothing sticks out of the body. Paint such shapes onto the box instead (a long coat's hem painted on the thighs) or use 3D accessories or layered clothing.

## Reading at game distance

At 20 studs with the default camera a character is ~200 px tall, about the size on a phone. Only colour blocks survive. Make an outfit's identity a colour or a big shape, not a fine detail. Keep lines at least 2 template px wide; a button is a dot.

**Whites:** Roblox's lighting greys an off-white. Use about (244, 243, 238) for white cloth.
