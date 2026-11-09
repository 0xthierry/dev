# Example outfit: a bare-chested fighter. Muscle definition on see-through skin (works on any skin tone), red cloth
# hand wraps, a red belt, black trousers and cloth shoes. Shows SKIN labels and the muscle shading.
#
# SKIN labels are painted in a reference tone in the guides (so the image model paints skin with muscles), and reach
# the template only as translucent light and shade, over whatever skin the wearer has. Under see-through skin the
# Pants' torso faces would show through, so the belt and the trousers' top are painted on the Shirt here and the
# Pants' torso faces stay empty.
import numpy as np

import engine
import shading as sh

STRENGTH = 1.0  # muscle definition: about 0.4 lean, 0.7 athletic, 1.0 ripped

PALETTE = {
    "skin": (204, 142, 105),      # reference tone for the guides only; the template keeps just its light and shade
    "belt": (176, 30, 36),
    "wrap": (236, 230, 216),      # cloth hand wraps
    "trousers": (34, 34, 40),
    "band": (28, 28, 32),
    "shoe": (24, 24, 28),
    "sole": (232, 228, 218),
    "sole_under": (70, 70, 72),
}
SKIN = ("skin",)
REGISTER_LEGS = ("sole", "shoe", 118)

BELT_TOP, BELT_BOT = 98.0, 110.0   # torso rows
WRAP_TOP = 90.0                    # arm rows: wraps from mid-forearm over the hand
TROUSER_END, SHOE_TOP, SOLE_TOP = 100.0, 106.0, 118.0


def torso(f, key):
    if key == "U":
        f.rect(0, 0, 128, 64, "skin")
        sh.round_edges(f, width=12, depth=0.06, sides=True, ends=True)
        return
    if key == "D":
        f.rect(0, 0, 128, 64, "trousers")
        f.gradient(lambda x, y: 0.85)
        return
    f.rect(0, 0, f.w, BELT_TOP, "skin")
    sh.wrap_band(f, BELT_TOP, BELT_BOT, "belt")
    f.rect(0, BELT_BOT, f.w, 128, "trousers")  # the trousers' top, on the Shirt so it covers the waist
    sh.top_light(f, labs="skin")
    sh.underarm(f, key, labs="skin")
    sh.muscles_torso(f, key, STRENGTH, labs="skin")
    sh.cast_shadow(f, [(0, BELT_BOT + 0.8), (f.w, BELT_BOT + 0.8)], width=1.8, depth=0.2, labs="trousers")
    sh.bunching(f, 128, count=5 if f.w > 64 else 3, length=10, labs="trousers")
    if key == "F":  # the knot at the wearer's left hip and its two ends
        f.ellipse(96, BELT_TOP + 6, 7, 6, "belt")
        f.poly([(92, 108), (100, 108), (102, 128), (94, 128)], "belt")
        sh.cast_shadow(f, [(91, 113), (91, 127)], width=1.6, depth=0.25, labs="trousers")
        f.stroke([(90, BELT_TOP + 2), (102, BELT_TOP + 2)], 1.2, 0.6, light=0.1, labs="belt")


def arm(f, key):
    if key == "D":
        f.rect(0, 0, 64, 64, "wrap")
        return
    if key == "U":
        f.rect(0, 0, 64, 64, "skin")
        sh.round_edges(f, width=10, depth=0.05, sides=True, ends=True)
        return
    f.rect(0, 0, 64, WRAP_TOP, "skin")
    f.rect(0, WRAP_TOP, 64, 128, "wrap")
    sh.side_light(f, key)
    sh.top_light(f, labs="skin")
    sh.round_edges(f)
    sh.muscles_arm(f, key, STRENGTH, labs="skin")
    for y in np.arange(WRAP_TOP + 4, 128, 5.0):  # the wraps' turns
        f.stroke([(0, y + 2), (64, y - 2)], 1.0, 0.5, dark=0.18, labs="wrap")
        f.stroke([(0, y + 3), (64, y - 1)], 0.8, 0.5, light=0.04, labs="wrap")
    sh.cast_shadow(f, [(0, WRAP_TOP + 0.6), (64, WRAP_TOP + 0.6)], width=1.4, depth=0.12, labs="skin")


def leg(f, key):
    if key == "U":
        f.rect(0, 0, 64, 64, "trousers")
        return
    if key == "D":
        f.rect(0, 0, 64, 64, "sole_under")
        return
    f.rect(0, 0, 64, TROUSER_END, "trousers")
    f.rect(0, TROUSER_END, 64, SHOE_TOP, "band")
    f.rect(0, SHOE_TOP, 64, SOLE_TOP, "shoe")
    f.rect(0, SOLE_TOP, 64, 128, "sole")
    sh.side_light(f, key)
    sh.round_edges(f, labs=("trousers", "band", "shoe"))
    sh.creases(f, 60, count=2, labs="trousers")
    sh.bunching(f, TROUSER_END, count=4, length=12, labs="trousers")
    sh.bevel(f, 0, TROUSER_END, 64, SHOE_TOP, labs="band")
    f.stroke([(0, SOLE_TOP + 0.5), (64, SOLE_TOP + 0.5)], 0.8, 0.4, dark=0.22, labs="sole")


def faces():
    shirt = engine.garment("shirt", torso, arm)
    pants = engine.garment("pants", None, leg)  # empty torso faces: nothing shows through the see-through skin
    return shirt, pants
