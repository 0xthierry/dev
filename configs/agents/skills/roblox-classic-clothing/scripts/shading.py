# Baked light and shade: what makes a flat template read as cloth on a box-shaped body (the "3D effect").
# Classic clothing has no normal map, and Roblox lights each box face nearly flat, so the depth is painted in:
#   1. light from above on every face, and a darker inner side on the limbs (it faces the body);
#   2. occlusion where parts meet: under the arms, along each box's edges, under collars, bands and pockets;
#   3. seams: a dark line with a thin highlight beside it;
#   4. folds where cloth bends or gathers: elbows, knees, the waist, above cuffs and hems;
#   5. raised pieces (cuffs, bands, pocket flaps, buttons): a lit top edge, a shaded bottom edge, a cast shadow;
#   6. a fine weave noise, stronger on dark cloth (Face.render adds it).
# Light cloth is shaded by multiplying; on dark cloth multiplying barely shows, so these functions add light instead
# (a crease on black cloth is a lighter ridge). Every function takes labs: the labels it may touch (None: all).
# Sizes are template px; depth is a fraction of brightness (0.08 = 8% darker).
import numpy as np

from engine import TAU, split

LIMB_LIGHT = {"F": 1.0, "B": 0.97, "R": 0.99, "L": 0.90, "U": 1.0, "D": 0.85}  # right limb: L is the inner side
TORSO_LIGHT = {"F": 1.0, "B": 0.98, "L": 0.97, "R": 0.97, "U": 1.0, "D": 0.85}


def top_light(f, top=1.025, bottom=0.97, labs=None):
    """Light from above: a face is a little brighter at its top than at its bottom."""
    f.gradient(lambda x, y: top + (bottom - top) * y / f.h, labs)


def side_light(f, key, part="limb", labs=None):
    """Each side of a box gets its own brightness: the limbs' inner side is the darkest (it faces the body)."""
    value = (LIMB_LIGHT if part == "limb" else TORSO_LIGHT)[key]
    f.gradient(lambda x, y: value, labs)


def round_edges(f, width=6.0, depth=0.06, sides=True, ends=False, labs=None):
    """Darken toward the face's edges so a box reads as a rounded limb: sides (left and right edges), ends (top and
    bottom edges, for top faces)."""
    def g(x, y):
        d = np.full_like(x, np.inf)
        if sides:
            d = np.minimum(d, np.minimum(x, f.w - x))
        if ends:
            d = np.minimum(d, np.minimum(y, f.h - y))
        return 1 - depth + depth * np.clip(d / width, 0, 1)
    f.gradient(g, labs)


def underarm(f, key, bottom=96.0, fade=16.0, depth=0.10, width=9.0, labs=None):
    """Torso faces: occlusion where the arms hang beside the torso, fading out over `fade` rows above row `bottom`.
    The front and back darken toward their side edges; the sides (L, R) are under the arm and darken toward their
    middle."""
    def g(x, y):
        if key in "FB":
            v = 1 - depth + depth * np.clip(np.minimum(x, f.w - x) / width, 0, 1)
        else:
            v = 1 - 1.4 * depth + 0.6 * depth * np.abs(x - f.w / 2) / (f.w / 2)
        return 1 + (v - 1) * np.clip((bottom - y) / fade, 0, 1)
    if key in "FBLR":
        f.gradient(g, labs)


def _beside(pts, d):
    """pts moved d px to the right of their direction of travel."""
    (x0, y0), (x1, y1) = pts[0], pts[-1]
    n = np.hypot(x1 - x0, y1 - y0) or 1.0
    ox, oy = -(y1 - y0) / n * d, (x1 - x0) / n * d
    return [(x + ox, y + oy) for x, y in pts]


def seam(f, pts, depth=0.22, width=0.6, labs=None):
    """A sewn seam: a thin dark line with a thinner highlight just beside it (a light ridge on dark cloth)."""
    light, dark = split(labs)
    if light:
        f.stroke(pts, width, width / 2, dark=depth, labs=light)
        f.stroke(_beside(pts, 0.9), width, width / 2, light=depth * 0.15, labs=light)
    if dark:
        f.stroke(pts, width, width / 2, light=depth * 0.3, labs=dark)
        f.stroke(_beside(pts, 0.9), width, width / 2, light=-depth * 0.15, labs=dark)


def cast_shadow(f, pts, width=2.4, blur=1.2, depth=0.14, labs=None):
    """The soft shadow a raised edge (collar, band, pocket, cuff, strap) casts on the cloth just below it."""
    light, dark = split(labs)
    if light:
        f.stroke(pts, width, blur, dark=depth, labs=light)
    if dark:
        f.stroke(pts, width, blur, dark=depth, light=-depth * 0.35, labs=dark)


def bevel(f, x0, y0, x1, y1, light=0.08, depth=0.14, labs=None):
    """A raised rectangle (cuff, band, pocket flap, belt): lit along its top edge, shaded along its bottom edge."""
    f.stroke([(x0, y0 + 0.8), (x1, y0 + 0.8)], 1.2, 0.5, light=light, labs=labs)
    f.stroke([(x0, y1 - 0.8), (x1, y1 - 0.8)], 1.2, 0.5, dark=depth, light=-depth * 0.25, labs=labs)


def ribbing(f, x0, y0, x1, y1, pitch=2.0, depth=0.10, labs=None):
    """Knit ribs (cuffs, hems and collars of knitwear): vertical grooves every `pitch` px."""
    for x in np.arange(x0 + pitch / 2, x1, pitch):
        f.stroke([(x, y0), (x, y1)], pitch * 0.35, 0.3, dark=depth, light=-depth * 0.2, labs=labs)


def creases(f, row, count=2, spacing=4.0, sag=3.0, depth=0.08, labs=None):
    """Shallow arcs across a face where it bends (elbow or knee: about row 60 on a limb), `spacing` px apart; the
    middle sits `sag` px higher than the ends."""
    for i in range(count):
        y = row + i * spacing
        f.fold([(f.w * 0.12, y + sag), (f.w * 0.5, y), (f.w * 0.88, y + sag)], width=1.3, blur=1.2,
               depth=depth * (1 - 0.25 * i), labs=labs)


def bunching(f, row, count=4, length=10.0, depth=0.08, labs=None):
    """Short creases just above a cuff, hem or band at `row`, where the cloth piles up."""
    for i, x in enumerate(np.linspace(f.w * 0.15, f.w * 0.85, count)):
        f.fold([(x, row - length), (x + (2.5 if i % 2 else -2.0), row - 0.5)], width=1.2, blur=0.9, depth=depth, labs=labs)


def pull(f, starts, target, reach=0.8, bend=4.0, depth=0.07, labs=None):
    """Long folds from each start point toward a point the cloth is pulled to (shoulders toward a belt knot, a zip,
    a pocket), ending at `reach` of the way, gently curved."""
    tx, ty = target
    for i, (sx, sy) in enumerate(starts):
        mx, my = sx + (tx - sx) * reach / 2, sy + (ty - sy) * reach / 2
        nx, ny = -(ty - sy), tx - sx
        n = np.hypot(nx, ny) or 1.0
        b = bend * (1 if i % 2 else -1)
        f.fold([(sx, sy), (mx + nx / n * b, my + ny / n * b), (sx + (tx - sx) * reach, sy + (ty - sy) * reach)],
               width=1.6, blur=1.4, depth=depth, labs=labs)


def button(f, cx, cy, r, lab, cloth=None):
    """A round button: its colour, a highlight at the top left, shade at the bottom right, and its shadow on `cloth`."""
    if cloth is not None:
        cast_shadow(f, [(cx - r * 0.8, cy + r + 0.3), (cx + r * 0.8, cy + r + 0.3)], width=r * 0.8, blur=r * 0.5,
                    depth=0.12, labs=cloth)
    f.ellipse(cx, cy, r, r, lab)
    f.stroke([(cx - r * 0.45, cy - r * 0.3), (cx - r * 0.1, cy - r * 0.5)], r * 0.5, r * 0.25, light=0.16, labs=lab)
    f.stroke([(cx + r * 0.15, cy + r * 0.5), (cx + r * 0.5, cy + r * 0.15)], r * 0.5, r * 0.3, dark=0.2, light=-0.04, labs=lab)


def wrap_band(f, top, bottom, lab, wave=0.6):
    """A band right round the torso or a limb (belt, waistband, stripe) between rows top and bottom, its edges gently
    wavy in the ring coordinate so they meet at every corner; then its bevel."""
    f.band(lambda s: top + wave * np.sin(TAU * 7 * s / f.ring), lambda s: bottom + wave * np.sin(TAU * 5 * s / f.ring + 1.0), lab)
    bevel(f, 0, top + wave, f.w, bottom - wave, labs=lab)
