# Build the R15 Blocky body's own textures from classic Shirt/Pants templates (585x559), the way Roblox's
# compositor lays them out, so the outfit can be previewed in Studio on the real body meshes without uploading
# the templates: Studio's Shirt.ShirtTemplateContent accepts an EditableImage but does not composite it, while
# MeshPart.TextureContent renders one.
#   uv run --no-project --with pillow --with numpy python -I composite.py <shirt.png|-> <pants.png|-> <out_dir> [r,g,b]
# Writes UpperTorso.png and LowerTorso.png (both the torso composite, 388x272) and <Side><Part>.png per limb
# part (the limb composite, 264x284), shirt over pants over the skin colour.
#
# Layout read from the Blocky R15 meshes' UVs in Studio (2026-10-29) and checked against uploaded templates on
# the Blocky, Man and Woman bodies: each template face is copied 1:1. On the limbs, the side band (template rows 0-128)
# lands at composite rows 66-194, of which the upper limb shows rows ~3-64 and the lower limb ~64-108; the
# hand or foot shows rows 108-128, copied again to composite rows 214-234 (and 236-256 for its back face).
import os
import sys

import numpy as np
from PIL import Image

TORSO_TPL = {"U": (231, 8, 128, 64), "R": (165, 74, 64, 128), "F": (231, 74, 128, 128),
             "L": (361, 74, 64, 128), "B": (427, 74, 128, 128), "D": (231, 204, 128, 64)}
RIGHT_TPL = {"U": (217, 289, 64, 64), "L": (19, 355, 64, 128), "B": (85, 355, 64, 128),
             "R": (151, 355, 64, 128), "F": (217, 355, 64, 128), "D": (217, 485, 64, 64)}
LEFT_TPL = {"U": (308, 289, 64, 64), "F": (308, 355, 64, 128), "L": (374, 355, 64, 128),
            "B": (440, 355, 64, 128), "R": (506, 355, 64, 128), "D": (308, 485, 64, 64)}

TORSO_SIZE = (388, 272)
TORSO_DST = {"U": (2, 10), "F": (2, 74), "L": (130, 74), "B": (194, 74), "R": (322, 74), "D": (2, 202)}
LIMB_SIZE = (264, 284)
LIMB_SIDE_X = {"R": 2, "F": 66, "L": 130, "B": 194}
HAND_ROWS = (108, 128)


def over(dst, src):
    """Alpha-over of float RGBA arrays (straight alpha)."""
    a = src[..., 3:4]
    out = dst.copy()
    out[..., :3] = src[..., :3] * a + dst[..., :3] * (1 - a)
    out[..., 3:4] = a + dst[..., 3:4] * (1 - a)
    return out


def crop(tpl, rect, rows=None):
    x, y, w, h = rect
    r0, r1 = rows if rows else (0, h)
    return tpl[y + r0:y + r1, x:x + w]


def paste(canvas, img, x, y):
    h, w = img.shape[:2]
    canvas[y:y + h, x:x + w] = img


def bleed(canvas, filled, steps=3):
    """Grow filled pixels into empty gutters so texture filtering never samples the background."""
    for _ in range(steps):
        grown = filled.copy()
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            src = np.roll(filled, (dy, dx), axis=(0, 1))
            take = src & ~grown
            canvas[take] = np.roll(canvas, (dy, dx), axis=(0, 1))[take]
            grown |= take
        filled = grown
    return canvas


def torso(layers):
    canvas = np.zeros((TORSO_SIZE[1], TORSO_SIZE[0], 4), np.float32)
    canvas[...] = layers[0][0, 0]  # body colour outside the copied faces (other bodies' hands sample there)
    filled = np.zeros(canvas.shape[:2], bool)
    for key, (x, y) in TORSO_DST.items():
        face = None
        for tpl in layers:
            part = crop(tpl, TORSO_TPL[key])
            face = part if face is None else over(face, part)
        paste(canvas, face, x, y)
        filled[y:y + face.shape[0], x:x + face.shape[1]] = True
    return bleed(canvas, filled)


def limb(layers, regions):
    canvas = np.zeros((LIMB_SIZE[1], LIMB_SIZE[0], 4), np.float32)
    canvas[...] = layers[0][0, 0]
    filled = np.zeros(canvas.shape[:2], bool)

    def face(key, rows=None):
        out = None
        for tpl in layers:
            part = crop(tpl, regions[key], rows)
            out = part if out is None else over(out, part)
        return out

    def put(img, x, y):
        paste(canvas, img, x, y)
        filled[y:y + img.shape[0], x:x + img.shape[1]] = True

    put(face("U"), 2, 2)
    for key, x in LIMB_SIDE_X.items():
        put(face(key), x, 66)
    for key in ("R", "F", "L"):
        put(face(key, HAND_ROWS), LIMB_SIDE_X[key], 214)
    put(face("B", HAND_ROWS), 2, 236)
    put(face("D"), 198, 218)
    return bleed(canvas, filled)


def load(path):
    if not path or path == "-":
        return np.zeros((559, 585, 4), np.float32)
    return np.asarray(Image.open(path).convert("RGBA"), np.float32) / 255.0


def save(arr, path):
    Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA").save(path)


def main():
    shirt_path, pants_path, out = sys.argv[1], sys.argv[2], sys.argv[3]
    skin = [int(c) / 255 for c in (sys.argv[4] if len(sys.argv) > 4 else "234,184,146").split(",")]
    os.makedirs(out, exist_ok=True)
    shirt, pants = load(shirt_path), load(pants_path)
    base = np.zeros_like(shirt)
    base[...] = (*skin, 1.0)
    t = torso([base, pants, shirt])
    save(t, f"{out}/UpperTorso.png")
    save(t, f"{out}/LowerTorso.png")
    for side, regions in (("Right", RIGHT_TPL), ("Left", LEFT_TPL)):
        arm = limb([base, shirt], regions)
        leg = limb([base, pants], regions)
        for part in ("UpperArm", "LowerArm", "Hand"):
            save(arm, f"{out}/{side}{part}.png")
        for part in ("UpperLeg", "LowerLeg", "Foot"):
            save(leg, f"{out}/{side}{part}.png")
    print("composites written to", out)


if __name__ == "__main__":
    main()
