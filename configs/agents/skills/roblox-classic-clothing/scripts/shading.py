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


# ---- muscles: light and shade for bare skin (a SKIN label) or for a tight top ----
# strength scales every depth: about 0.4 lean, 0.7 athletic, 1.0 ripped. Coordinates follow the R15 rows: chest rows
# 12-44, abdomen 46-104 on the torso; deltoid 0-22, upper arm 22-62, forearm 64-108 on the arm (forearm rows 64-85
# hide under the upper arm at rest); thigh 12-58, knee 58-70, shin and calf 70-104 on the leg.
def _soft(f, pts, width, blur, dark=0.0, light=0.0, labs=None):
    """A soft stroke along pts, or a soft round spot `width` across when pts is one point."""
    if len(pts) > 1:
        f.stroke(pts, width, blur, dark=dark, light=light, labs=labs)
        return
    (x, y), r = pts[0], width / 2

    def draw(d, P):
        d.ellipse([P([(x - r, y - r)])[0], P([(x + r, y + r)])[0]], fill=255)
    m = f.only(f.mask(draw, blur), labs)
    f.shade *= 1 - dark * m
    f.add += light * m


def muscles_torso(f, key, strength=1.0, labs=None):
    k = strength
    if key == "F":
        for side in (-1, 1):  # side -1: the image's left half (the wearer's right)
            x = lambda d: 64 + side * d
            # pecs: light on the upper chest, a shadow under each lower edge, the gap at the sternum
            _soft(f, [(x(10), 24), (x(34), 20), (x(50), 26)], 12, 5, light=0.05 * k, labs=labs)
            _soft(f, [(x(4), 40), (x(20), 44), (x(40), 42), (x(52), 34)], 2.6, 1.6, dark=0.16 * k, labs=labs)
            _soft(f, [(x(52), 34), (x(56), 22)], 2.0, 1.4, dark=0.08 * k, labs=labs)  # into the armpit
            # the six-pack: three blocks a side, a highlight on each, an outer edge curving in at the waist
            for top in (48, 64, 80):
                _soft(f, [(x(10), top + 6), (x(12), top + 8)], 6, 3, light=0.05 * k, labs=labs)
            for row in (63, 79, 95):
                _soft(f, [(x(2), row), (x(10), row + 1.2), (x(19), row - 0.4)], 1.6, 0.9, dark=0.14 * k, labs=labs)
            _soft(f, [(x(21), 48), (x(22), 70), (x(20), 92), (x(16), 104)], 1.8, 1.0, dark=0.12 * k, labs=labs)
            # serratus fingers below the armpit, the oblique, the V at the hips
            for i in range(3):
                _soft(f, [(x(40 - i * 2), 46 + i * 7), (x(30 - i * 2), 50 + i * 7)], 1.4, 0.9, dark=0.08 * k, labs=labs)
            _soft(f, [(x(34), 64), (x(30), 84), (x(26), 100)], 2.0, 1.4, dark=0.06 * k, labs=labs)
            _soft(f, [(x(24), 98), (x(12), 116), (x(6), 128)], 1.8, 1.1, dark=0.12 * k, labs=labs)
        _soft(f, [(64, 16), (64, 42)], 1.6, 1.0, dark=0.12 * k, labs=labs)    # sternum
        _soft(f, [(64, 46), (64, 104)], 1.4, 0.8, dark=0.12 * k, labs=labs)   # the line down the abdomen
        f.stroke([(64, 99), (64, 101)], 1.6, 0.5, dark=0.25 * k, labs=labs)  # navel
    elif key == "B":
        _soft(f, [(64, 4), (64, 122)], 1.8, 1.2, dark=0.12 * k, labs=labs)   # spine groove
        for side in (-1, 1):
            x = lambda d: 64 + side * d
            _soft(f, [(x(8), 10), (x(30), 6)], 10, 5, light=0.04 * k, labs=labs)                    # trapezius
            _soft(f, [(x(30), 30)], 20, 8, light=0.04 * k, labs=labs)                               # shoulder blade
            _soft(f, [(x(16), 24), (x(22), 42), (x(36), 48), (x(46), 42)], 3.0, 2.4, dark=0.08 * k, labs=labs)
            _soft(f, [(x(52), 40), (x(42), 74), (x(26), 96)], 3.0, 2.4, dark=0.07 * k, labs=labs)  # the lat's edge
            _soft(f, [(x(7), 74), (x(7), 112)], 8, 5, light=0.025 * k, labs=labs)                   # lower back columns
    elif key in "LR":
        for i in range(3):  # ribs under the arm
            _soft(f, [(18, 44 + i * 9), (46, 40 + i * 9)], 1.4, 1.0, dark=0.06 * k, labs=labs)


def muscles_arm(f, key, strength=1.0, labs=None):
    """The right arm's faces (the left arm is its mirror)."""
    k = strength
    if key in "FBR":  # the deltoid's cap and the shadow under it
        _soft(f, [(10, 9), (32, 7), (54, 9)], 9, 4, light=0.05 * k, labs=labs)
        _soft(f, [(4, 18), (32, 25), (60, 18)], 2.2, 1.4, dark=0.12 * k, labs=labs)
    if key == "F":  # biceps, elbow, forearm
        _soft(f, [(32, 32), (32, 46)], 14, 6, light=0.06 * k, labs=labs)
        _soft(f, [(14, 30), (12, 46), (18, 58)], 1.8, 1.4, dark=0.10 * k, labs=labs)
        _soft(f, [(50, 30), (52, 46), (46, 58)], 1.8, 1.4, dark=0.10 * k, labs=labs)
        _soft(f, [(20, 61), (32, 63), (44, 61)], 1.6, 1.0, dark=0.12 * k, labs=labs)
        _soft(f, [(42, 88), (28, 104)], 7, 3, light=0.04 * k, labs=labs)
    elif key == "B":  # the triceps' horseshoe
        _soft(f, [(18, 26), (22, 46), (32, 52), (42, 46), (46, 26)], 1.8, 1.3, dark=0.11 * k, labs=labs)
        _soft(f, [(32, 34)], 10, 5, light=0.04 * k, labs=labs)
        _soft(f, [(32, 60), (32, 64)], 3, 1.4, dark=0.08 * k, labs=labs)  # the elbow's point
    elif key == "R":  # the outer side: the groove between biceps and triceps
        _soft(f, [(30, 24), (34, 44), (32, 60)], 1.6, 1.2, dark=0.10 * k, labs=labs)
        _soft(f, [(36, 88), (30, 104)], 6, 3, light=0.04 * k, labs=labs)


def muscles_leg(f, key, strength=1.0, labs=None):
    """The right leg's faces (the left leg is its mirror). Rows 0-12 hide under the torso."""
    k = strength
    if key == "F":  # quads with the teardrop above the inner knee, the kneecap, the shin
        _soft(f, [(30, 20), (32, 44)], 16, 7, light=0.05 * k, labs=labs)
        _soft(f, [(10, 16), (12, 40), (20, 56)], 1.8, 1.4, dark=0.09 * k, labs=labs)
        _soft(f, [(44, 40), (50, 50), (44, 58)], 2.0, 1.4, dark=0.10 * k, labs=labs)
        _soft(f, [(24, 60), (32, 66), (40, 60)], 1.8, 1.1, dark=0.10 * k, labs=labs)
        _soft(f, [(32, 64)], 6, 2.5, light=0.05 * k, labs=labs)
        _soft(f, [(24, 72), (32, 76), (40, 72)], 1.6, 1.0, dark=0.09 * k, labs=labs)
        _soft(f, [(30, 78), (32, 104)], 3, 1.6, light=0.04 * k, labs=labs)
    elif key == "B":  # hamstrings, the back of the knee, the calf's two heads
        _soft(f, [(32, 14), (32, 54)], 1.6, 1.2, dark=0.08 * k, labs=labs)
        _soft(f, [(18, 62), (46, 62)], 2.0, 1.2, dark=0.10 * k, labs=labs)
        for x in (22, 42):
            _soft(f, [(x, 72), (x, 82)], 10, 4, light=0.05 * k, labs=labs)
        _soft(f, [(12, 90), (32, 96), (52, 90)], 2.2, 1.6, dark=0.10 * k, labs=labs)
    elif key in "LR":
        _soft(f, [(32, 16), (34, 56)], 1.6, 1.4, dark=0.06 * k, labs=labs)
        _soft(f, [(30, 74), (34, 92)], 7, 3, light=0.04 * k, labs=labs)
