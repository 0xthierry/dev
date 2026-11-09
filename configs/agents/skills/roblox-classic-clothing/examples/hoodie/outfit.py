# Example outfit: a blue zip hoodie (white drawstrings, ribbed cuffs and hem, hood lying on the back), dark jeans
# (orange topstitching, back pockets) and black canvas sneakers on white rubber soles. Copy it with
# `clothing.py new <dir>`, then change the palette and the drawing.
#
# An outfit file gives the engine:
#   PALETTE    {label: (r, g, b)}, one entry per colour area; "none" is reserved (transparent: skin shows)
#   faces()    -> (shirt, pants), each from engine.garment(); either may be None
# and optionally CONCEPT (reference image, default concept.png), SHADE_AS, NORMALIZE, GAIN_FLOOR, REGISTER_LEGS,
# GREY_FILL, CODE_LABELS (see the skill's references/outfit-file.md).
#
# Coordinates are template px on each face (x right, y down). Torso faces: 128 wide (F, B, U, D) or 64 (L, R),
# 128 tall (U, D: 64). Limb faces: 64 wide, 128 tall (U, D: 64x64). Rows: torso 0-96 UpperTorso, 96-128 LowerTorso;
# limbs 0-64 upper, 64-108 lower, 108-128 hand or foot.
import numpy as np

import engine
import shading as sh

PALETTE = {
    "hoodie": (52, 96, 168),      # mid-blue cotton fleece
    "rib": (44, 82, 146),         # ribbed cuffs and hem, a shade darker
    "lining": (176, 180, 188),    # the hood's heather-grey lining
    "zip": (214, 216, 222),       # zip teeth and pull
    "string": (244, 243, 238),    # drawstrings (off-white: pure white reads grey in Roblox's light)
    "jeans": (38, 52, 84),        # dark denim
    "stitch": (214, 140, 52),     # jeans topstitching
    "shoe": (28, 28, 32),         # black canvas upper
    "lace": (236, 236, 232),
    "sole": (238, 236, 230),      # white rubber sole
    "sole_under": (70, 70, 72),   # dark: the Man and Woman bodies' feet sample the foot's underside
}
REGISTER_LEGS = ("sole", "shoe", 118)  # realign the legs repaint on the light sole band, rows 118-128 of each leg

CLOTH = ("hoodie", "rib")
HEM, CUFF, WRIST = 116.0, 96.0, 108.0  # hoodie hem rib (torso rows), sleeve cuff (limb rows), the hand starts
JEANS_HEM, SHOE_TOP, SOLE_TOP = 104.0, 104.0, 118.0


# ---------------------------------------------------------------- the hoodie (shirt)
def hoodie_torso(f, key):
    if key == "D":  # the torso's underside: a rim of rib round an open middle (the pants' underside shows)
        f.rect(0, 0, 128, 64, "rib")
        f.rect(6, 6, 122, 58, "none")
        f.gradient(lambda x, y: 0.85)
        return
    f.rect(0, 0, f.w, f.h, "hoodie")
    if key == "U":  # the top of the shoulders, mostly hidden by the head in the middle
        sh.round_edges(f, width=12, depth=0.08, sides=True, ends=True)
        return
    sh.top_light(f)
    sh.underarm(f, key)
    # the ribbed hem right round the torso
    f.rect(0, HEM, f.w, 128, "rib")
    sh.ribbing(f, 0, HEM + 1, f.w, 128, labs="rib")
    sh.bevel(f, 0, HEM, f.w, 128, labs="rib")
    sh.cast_shadow(f, [(0, HEM - 0.6), (f.w, HEM - 0.6)], width=1.6, blur=0.8, depth=0.10, labs="hoodie")
    sh.bunching(f, HEM, count=5 if f.w > 64 else 3, length=9, labs="hoodie")
    if key == "F":
        hoodie_front(f)
    elif key == "B":
        hoodie_back(f)
    else:
        sh.seam(f, [(32, 2), (32, HEM)], labs="hoodie")  # side seam


def hoodie_front(f):
    # the hood's opening round the neck: grey lining inside, a rim of fleece
    f.poly([(40, 0), (88, 0), (74, 14), (54, 14)], "lining")
    f.line([(38, 0), (52, 14), (64, 17), (76, 14), (90, 0)], 4.0, "hoodie")
    sh.seam(f, [(40, 2.5), (53, 15.5), (64, 18.5), (75, 15.5), (88, 2.5)], labs="hoodie")
    sh.cast_shadow(f, [(42, 1), (54, 12), (74, 12), (86, 1)], width=2.0, blur=0.8, depth=0.16, labs="lining")
    # the zip down the middle, through the hem
    f.line([(64, 17), (64, 128)], 1.6, "zip")
    f.dashed([(64, 18), (64, 128)], 2.6, "zip", dash=0.7, gap=0.7)
    sh.cast_shadow(f, [(65.8, 18), (65.8, 128)], width=1.2, blur=0.6, depth=0.18, labs=CLOTH)
    f.rect(62.4, 17, 65.6, 26, "zip")  # the pull
    f.stroke([(63.2, 18), (63.2, 25)], 0.6, 0.2, light=0.12, labs="zip")
    sh.cast_shadow(f, [(62.4, 26.6), (65.6, 26.6)], width=1.4, blur=0.6, depth=0.2, labs="hoodie")
    # drawstrings with metal tips
    for top, bottom in (((55, 15), (53, 44)), ((73, 15), (75, 46))):
        sh.cast_shadow(f, [(top[0] + 1.2, top[1] + 1), (bottom[0] + 1.2, bottom[1] + 1)], width=1.8, depth=0.14, labs="hoodie")
        f.line([top, bottom], 1.6, "string")
        f.stroke([(top[0] - 0.4, top[1]), (bottom[0] - 0.4, bottom[1] - 2)], 0.5, 0.2, light=0.05, labs="string")
        f.rect(bottom[0] - 0.9, bottom[1], bottom[0] + 0.9, bottom[1] + 3.0, "zip")
    # two pockets each side of the zip: stitched top edge, slanted openings with a shadow inside
    for side in (-1, 1):
        x_open_top, x_open_bot = 64 + side * 30, 64 + side * 38
        sh.seam(f, [(64 + side * 4, 80), (x_open_top, 80)], labs="hoodie")
        sh.seam(f, [(64 + side * 4, 80), (64 + side * 4, HEM)], labs="hoodie")
        sh.cast_shadow(f, [(x_open_top - side * 1.4, 81), (x_open_bot - side * 1.4, HEM - 1)], width=2.0, depth=0.18, labs="hoodie")
        sh.seam(f, [(x_open_top, 80), (x_open_bot, HEM)], labs="hoodie")
    # folds from the shoulders toward the pockets, and across the chest
    sh.pull(f, [(16, 14), (24, 30)], (40, 78), depth=0.06, labs="hoodie")
    sh.pull(f, [(112, 14), (104, 30)], (88, 78), depth=0.06, labs="hoodie")


def hoodie_back(f):
    # the hood lying down on the back: its outline, centre seam, folds and the shadow it casts
    hood = [(28, 0), (100, 0), (98, 18), (88, 36), (64, 46), (40, 36), (30, 18)]
    sh.cast_shadow(f, [(30, 20), (41, 38), (64, 48.5), (87, 38), (98, 20)], width=3.0, blur=1.5, depth=0.18, labs="hoodie")
    sh.seam(f, hood[1:] + [hood[0]], labs="hoodie")
    sh.seam(f, [(64, 0), (64, 45)], labs="hoodie")
    for side in (-1, 1):
        f.fold([(64 + side * 10, 6), (64 + side * 16, 22), (64 + side * 12, 36)], depth=0.07, labs="hoodie")
    f.stroke([(40, 8), (64, 18), (88, 8)], 14, 6, light=0.02, labs="hoodie")  # the hood's rounded volume catches light
    sh.pull(f, [(14, 50), (114, 50)], (64, 104), reach=0.7, depth=0.05, labs="hoodie")


def hoodie_sleeve(f, key):
    if key == "D":  # the underside of the hand: skin
        return
    f.rect(0, 0, 64, f.h if key == "U" else WRIST, "hoodie")
    if key == "U":
        sh.round_edges(f, width=10, depth=0.06, sides=True, ends=True)
        return
    f.rect(0, CUFF, 64, WRIST, "rib")
    sh.side_light(f, key)
    sh.top_light(f)
    sh.round_edges(f)
    sh.seam(f, [(0, 2.5), (64, 2.5)], labs="hoodie")  # where the sleeve meets the shoulder
    sh.ribbing(f, 0, CUFF + 1, 64, WRIST, labs="rib")
    sh.bevel(f, 0, CUFF, 64, WRIST, labs="rib")
    sh.cast_shadow(f, [(0, CUFF - 0.6), (64, CUFF - 0.6)], width=1.6, blur=0.8, depth=0.10, labs="hoodie")
    sh.bunching(f, CUFF, count=4, length=12, labs="hoodie")
    sh.creases(f, 58 if key == "F" else 62, count=3 if key == "F" else 2, labs="hoodie")  # the elbow


# ---------------------------------------------------------------- the jeans and sneakers (pants)
def jeans_waist(f, key):
    """The pants' torso faces show only where the shirt is transparent: jeans from the waist down."""
    if key == "U":
        return
    f.rect(0, 0 if key == "D" else 96, f.w, f.h, "jeans")
    if key != "D":
        sh.wrap_band(f, 96, 104, "jeans")
        f.dashed([(0, 102.5), (f.w, 102.5)], 0.6, "stitch")


def leg(f, key):
    if key == "U":  # the thigh's top, hidden under the torso
        f.rect(0, 0, 64, 64, "jeans")
        return
    if key == "D":  # the sole's underside: tread
        f.rect(0, 0, 64, 64, "sole_under")
        for y in np.arange(6, 60, 5.0):
            f.stroke([(6, y), (58, y)], 1.4, 0.5, light=0.07, labs="sole_under")
        f.stroke([(3, 3), (61, 3), (61, 61), (3, 61), (3, 3)], 1.0, 0.5, light=0.06, labs="sole_under")
        return
    f.rect(0, 0, 64, JEANS_HEM, "jeans")
    f.rect(0, SHOE_TOP, 64, SOLE_TOP, "shoe")
    f.rect(0, SOLE_TOP, 64, 128, "sole")
    sh.side_light(f, key, labs=("jeans", "shoe"))
    sh.top_light(f, labs="jeans")
    sh.round_edges(f, labs=("jeans", "shoe"))
    # denim: seams with topstitching, faded creases at the knee and the hip, a stitched hem
    if key == "L":  # the inseam, topstitched
        sh.seam(f, [(32, 0), (32, JEANS_HEM)], labs="jeans")
        f.dashed([(34.2, 2), (34.2, JEANS_HEM - 2)], 0.6, "stitch")
    elif key == "R":  # the outseam
        sh.seam(f, [(32, 0), (32, JEANS_HEM)], labs="jeans")
    elif key == "F":
        for i, y in enumerate((14, 18, 22)):  # whiskers from the crotch, toward the outside
            f.fold([(62, y - 2), (48 - 4 * i, y + 2)], width=1.2, blur=0.8, depth=0.10, labs="jeans")
        sh.creases(f, 60, count=3, labs="jeans")
    elif key == "B":
        pocket = [(12, 14), (52, 14), (50, 34), (32, 38), (14, 34)]
        sh.cast_shadow(f, [(14, 35), (32, 39.4), (50, 35)], width=1.6, blur=0.8, depth=0.18, labs="jeans")
        f.dashed(pocket + [pocket[0]], 0.6, "stitch")
        f.dashed([(13, 17), (51, 17)], 0.6, "stitch")
        sh.creases(f, 66, count=2, labs="jeans")  # the back of the knee
    sh.bunching(f, JEANS_HEM, count=4, length=12, labs="jeans")
    sh.bevel(f, 0, JEANS_HEM - 3, 64, JEANS_HEM, labs="jeans")
    f.dashed([(0, JEANS_HEM - 2.2), (64, JEANS_HEM - 2.2)], 0.6, "stitch")
    sh.cast_shadow(f, [(0, JEANS_HEM + 0.8), (64, JEANS_HEM + 0.8)], width=1.6, blur=0.8, depth=0.2, labs="shoe")
    # the sneaker: laces on the front, a rubber toe cap, the sole's edge and its shadow
    if key == "F":
        f.rect(24, SHOE_TOP + 1, 40, SOLE_TOP - 5, "lace")
        for y in np.arange(SHOE_TOP + 2.5, SOLE_TOP - 5, 3.0):
            f.stroke([(24, y), (40, y)], 0.7, 0.3, dark=0.25, labs="lace")
        f.poly([(18, SOLE_TOP), (46, SOLE_TOP), (42, SOLE_TOP - 4), (22, SOLE_TOP - 4)], "sole")
    f.stroke([(0, SOLE_TOP + 0.5), (64, SOLE_TOP + 0.5)], 0.8, 0.4, dark=0.22, labs="sole")
    f.stroke([(0, SOLE_TOP + 4.5), (64, SOLE_TOP + 4.5)], 0.7, 0.3, dark=0.12, labs="sole")  # a foxing line, as shade
    f.stroke([(0, 127.4), (64, 127.4)], 1.0, 0.5, dark=0.10, labs="sole")
    f.stroke([(0, SHOE_TOP + 0.8), (64, SHOE_TOP + 0.8)], 0.9, 0.4, light=0.08, labs="shoe")


def faces():
    shirt = engine.garment("shirt", hoodie_torso, hoodie_sleeve)
    pants = engine.garment("pants", jeans_waist, leg)
    return shirt, pants
