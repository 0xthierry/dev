# Pack head assets into build/heads-lab/data/ for the HeadsLab place: Studio's Assistant blocks HTTP to localhost
# (the relay), so the data travels inside the place file instead. Rojo turns pieces.json into a ModuleScript and each
# face into a StringValue holding a run-length encoded RGBA image ("W,H;" then 12 hex digits per run: count, r, g, b, a).
# A face image is the features on a transparent square that spans the head's front (our NPC head projects it flat).
#   uv run --no-project --with pillow --with numpy python -I pack.py [--out DIR] <pieces.json>... <face.png>...
# Each pieces file becomes a ModuleScript of its own name; a piece's "texture" ({size, rgba: base64}) moves out into a
# StringValue <piece>_tex ("W,H;" then the base64 RGBA) so the modules stay small.
import json
import os
import sys

import numpy as np
from PIL import Image

OUT = os.path.join("build", "heads-lab", "data")  # or --out DIR
SIZE = 512  # the face spans the head's front; EditableImage allows up to 1024


def encode(path):
    size = SIZE
    a = np.asarray(Image.open(path).convert("RGBA").resize((size, size), Image.LANCZOS)).astype(int)
    a = np.minimum((a // 8) * 8 + 4, 255)  # 5 bits per channel: longer runs, no visible loss on a cartoon face
    a[..., 3] = np.where(a[..., 3] < 16, 0, a[..., 3])
    a[a[..., 3] == 0] = 0
    flat, runs, i = a.reshape(-1, 4), [], 0
    while i < len(flat):
        j = i + 1
        while j < len(flat) and j - i < 65535 and (flat[j] == flat[i]).all():
            j += 1
        runs.append("%04x%02x%02x%02x%02x" % ((j - i,) + tuple(flat[i])))
        i = j
    return f"{size},{size};" + "".join(runs)


def main():
    global OUT
    if "--out" in sys.argv:
        i = sys.argv.index("--out")
        OUT = sys.argv[i + 1]
        del sys.argv[i:i + 2]
    os.makedirs(OUT, exist_ok=True)
    for path in [a for a in sys.argv[1:] if a.endswith(".json")]:
        pieces = json.load(open(path))
        for name, p in pieces.items():
            tex = p.pop("texture", None)
            if tex:
                with open(os.path.join(OUT, f"{name}_tex.txt"), "w") as f:
                    f.write(f"{tex['size']},{tex['size']};{tex['rgba']}")
                p["textured"] = True
        with open(os.path.join(OUT, os.path.basename(path)), "w") as f:
            json.dump(pieces, f, separators=(",", ":"))
        print("packed", os.path.basename(path), len(pieces), "pieces")
    for face in [a for a in sys.argv[1:] if not a.endswith(".json")]:
        name = os.path.splitext(os.path.basename(face))[0]
        with open(os.path.join(OUT, f"{name}.txt"), "w") as f:
            f.write(encode(face))
        print("packed", name)


if __name__ == "__main__":
    main()
