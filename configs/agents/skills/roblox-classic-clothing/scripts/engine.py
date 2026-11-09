# The classic clothing engine. An outfit is drawn in code as colour labels plus baked light and shade at 8x the
# template's resolution; an image model may repaint guide sheets of it; the result is written as Roblox's 585x559
# Shirt and Pants templates. Game-neutral: the outfit file (outfit.py) names its own labels and draws its own faces.
#
# The R15 body's rows (Blocky, Man and Woman bodies; measured in Studio):
#   torso faces  rows 0-96 UpperTorso (row 0 at the shoulders), 96-128 LowerTorso
#   limb faces   rows 0-64 upper arm / thigh, 64-108 forearm / shin, 108-128 hand / foot
# Face keys: F front, B back, L and R the sides facing the wearer's left and right, U top, D bottom. Every face is
# drawn as seen from outside the body. Limbs are drawn as the right limb (its L side faces the body); the left limb
# is its mirror.
import os
import zlib

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

K = 8            # drawing scale: 8 px per template px
SHEET_SCALE = 4  # guide sheets for the image model: 4 px per template px (1536x1024)
TAU = 2 * np.pi

# Roblox's template: (x, y, w, h) of each face
TORSO = {"U": (231, 8, 128, 64), "R": (165, 74, 64, 128), "F": (231, 74, 128, 128),
         "L": (361, 74, 64, 128), "B": (427, 74, 128, 128), "D": (231, 204, 128, 64)}
RIGHT = {"U": (217, 289, 64, 64), "L": (19, 355, 64, 128), "B": (85, 355, 64, 128),
         "R": (151, 355, 64, 128), "F": (217, 355, 64, 128), "D": (217, 485, 64, 64)}
LEFT = {"U": (308, 289, 64, 64), "F": (308, 355, 64, 128), "L": (374, 355, 64, 128),
        "B": (440, 355, 64, 128), "R": (506, 355, 64, 128), "D": (308, 485, 64, 64)}
REGIONS = {"torso": TORSO, "right": RIGHT, "left": LEFT}
MIRROR = {"F": "F", "B": "B", "L": "R", "R": "L", "U": "U", "D": "D"}  # a right-limb face -> the left limb's face

# Where each side face starts round its part, so a band or stripe drawn with Face.band meets itself at the corners.
WAIST = {"F": 0, "L": 128, "B": 192, "R": 320}      # torso: front, wearer's left, back, wearer's right (384 round)
LIMB_RING = {"L": 0, "B": 64, "R": 128, "F": 192}   # right limb: inner, back, outer, front (256 round)

# Guide sheets, in template px (x, y) per face. All 384x256 (1536x1024 at SHEET_SCALE): the image model keeps this
# canvas exactly, while square sheets came back resized and shifted by 4-6 template px. Faces that meet on the body
# meet on the sheet, so the model paints across the joins.
SHEETS = {
    "torso": ("shirt", (384, 256), {("torso", "R"): (0, 64), ("torso", "F"): (64, 64), ("torso", "L"): (192, 64),
                                     ("torso", "B"): (256, 64), ("torso", "U"): (64, 0), ("torso", "D"): (64, 192)}),
    "arm": ("shirt", (384, 256), {("right", "L"): (0, 64), ("right", "B"): (64, 64), ("right", "R"): (128, 64),
                                   ("right", "F"): (192, 64), ("right", "U"): (192, 0)}),
    "legs": ("pants", (384, 256), {("right", "L"): (0, 0), ("right", "B"): (64, 0), ("right", "R"): (128, 0),
                                    ("right", "F"): (192, 0), ("left", "F"): (0, 128), ("left", "L"): (64, 128),
                                    ("left", "B"): (128, 128), ("left", "R"): (192, 128), ("right", "D"): (288, 32),
                                    ("left", "D"): (288, 160)}),
}


class Style:
    """The outfit's labels and intake settings; configure() fills it from the outfit module."""

    def __init__(self):
        self.names = ("none",)
        self.ids = {"none": 0}
        self.palette = np.full((1, 3), 0.5, np.float32)
        self.light, self.dark = (), ()
        self.normalize = None   # labels whose repaint colour is brought to the palette; None: every big area
        self.gain_floor = {}
        self.code = ()
        self.grey_fill = "edges"
        self.register_legs = ()


S = Style()


def configure(outfit):
    """Read the outfit module's settings (see the skill's outfit-file reference)."""
    pal = dict(outfit.PALETTE)
    pal.pop("none", None)
    if not pal or len(pal) > 254:
        raise SystemExit("PALETTE needs 1-254 labels")
    S.names = ("none",) + tuple(pal)
    S.ids = {n: i for i, n in enumerate(S.names)}
    S.palette = np.asarray([(128, 128, 128)] + [pal[n] for n in pal], np.float32) / 255
    value = S.palette.max(axis=1)  # the brightest channel: a saturated red or blue darkens visibly by multiplying
    shade_as = getattr(outfit, "SHADE_AS", {})
    kind = {i: shade_as.get(n, "light" if value[i] > 0.4 else "dark") for i, n in enumerate(S.names) if i}
    S.light = tuple(i for i, k in kind.items() if k == "light")
    S.dark = tuple(i for i, k in kind.items() if k == "dark")
    S.normalize = ids(outfit.NORMALIZE) if hasattr(outfit, "NORMALIZE") else None
    S.gain_floor = {ids(n)[0]: v for n, v in getattr(outfit, "GAIN_FLOOR", {}).items()}
    S.code = ids(getattr(outfit, "CODE_LABELS", ())) or ()
    S.grey_fill = getattr(outfit, "GREY_FILL", "edges")
    reg = getattr(outfit, "REGISTER_LEGS", ())
    S.register_legs = (ids(reg[0])[0], ids(reg[1])[0], float(reg[2])) if reg else ()


def ids(labs):
    """Label names (or ids) -> a tuple of ids; None stays None (every label)."""
    if labs is None:
        return None
    if isinstance(labs, (str, int, np.integer)):
        labs = (labs,)
    out = []
    for l in labs:
        if isinstance(l, str):
            if l not in S.ids:
                raise SystemExit(f"unknown label {l!r}: the outfit's PALETTE has {', '.join(S.names[1:])}")
            out.append(S.ids[l])
        else:
            out.append(int(l))
    return tuple(out)


def split(labs):
    """(light-cloth ids, dark-cloth ids) among labs (None: every label)."""
    sel = ids(labs) or tuple(range(1, len(S.names)))
    return tuple(l for l in sel if l in S.light), tuple(l for l in sel if l in S.dark)


class Face:
    """One template face, drawn at K x in template pixel coordinates (x right, y down; floats allowed)."""

    def __init__(self, w, h, seed=0, s0=0, ring=384):
        self.w, self.h = w, h
        self.s0, self.ring = s0, ring  # where this face starts round its part, and the part's girth (band())
        self.lab = Image.new("L", (w * K, h * K), 0)
        self.d = ImageDraw.Draw(self.lab)
        self.shade = np.ones((h * K, w * K), np.float32)  # multiplies the colour (strongly on light cloth)
        self.add = np.zeros((h * K, w * K), np.float32)   # added to the colour (highlights; creases on dark cloth)
        self.rng = np.random.default_rng(seed)
        yy, xx = np.mgrid[0:h * K, 0:w * K].astype(np.float32)
        self.x, self.y = (xx + 0.5) / K, (yy + 0.5) / K

    # ---- shapes: each fills its area with a label ----
    def P(self, pts):
        return [(x * K, y * K) for x, y in pts]

    def rect(self, x0, y0, x1, y1, lab):
        self.d.rectangle([x0 * K, y0 * K, x1 * K - 1, y1 * K - 1], fill=ids(lab)[0])

    def poly(self, pts, lab):
        self.d.polygon(self.P(pts), fill=ids(lab)[0])

    def ellipse(self, cx, cy, rx, ry, lab):
        self.d.ellipse([(cx - rx) * K, (cy - ry) * K, (cx + rx) * K, (cy + ry) * K], fill=ids(lab)[0])

    def line(self, pts, width, lab):
        """A polyline with round ends."""
        self.d.line(self.P(pts), fill=ids(lab)[0], width=max(1, round(width * K)), joint="curve")
        r = width / 2
        for x, y in (pts[0], pts[-1]):
            self.ellipse(x, y, r, r, lab)

    def dashed(self, pts, width, lab, dash=2.0, gap=1.5):
        """A dashed polyline: stitching, zip teeth, laces."""
        pts = np.asarray(pts, np.float32)
        seg = np.diff(pts, axis=0)
        lens = np.hypot(seg[:, 0], seg[:, 1])
        cum = np.concatenate([[0.0], np.cumsum(lens)])

        def at(dist):
            i = min(int(np.searchsorted(cum, dist, side="right")) - 1, len(lens) - 1)
            return tuple(pts[i] + seg[i] * ((dist - cum[i]) / max(lens[i], 1e-6)))

        dist = 0.0
        while dist < cum[-1]:
            end = min(dist + dash, cum[-1])
            self.d.line(self.P([at(dist), at(end)]), fill=ids(lab)[0], width=max(1, round(width * K)))
            dist = end + gap

    def band(self, top_fn, bot_fn, lab):
        """A band between two edge functions of the ring coordinate s (self.s0 + x), so it continues on the next face."""
        xs = np.linspace(0, self.w, 4 * self.w + 1)
        pts = [(x, top_fn(self.s0 + x)) for x in xs] + [(x, bot_fn(self.s0 + x)) for x in xs[::-1]]
        self.poly(pts, lab)

    def stripes(self, labs, width, y0=0.0, y1=None, phase=0.0):
        """Vertical stripes right round the part, cycling through labs, each `width` px wide along the ring, from
        row y0 to y1: they continue from face to face. Side faces only (U and D have no ring position). They meet
        where the ring closes only if the girth (torso 384, limb 256) is a multiple of len(labs) * width."""
        labs = [labs] if isinstance(labs, str) else list(labs)
        if self.ring % (len(labs) * width):
            print(f"[stripes] {len(labs)} x {width} px doesn't divide the {self.ring} px girth: the pattern breaks where it closes")
        y1 = self.h if y1 is None else y1
        a, b = self.s0, self.s0 + self.w
        k = int(np.floor((a - phase) / width))
        while phase + k * width < b:
            s_from, s_to = max(a, phase + k * width), min(b, phase + (k + 1) * width)
            self.rect(s_from - a, y0, s_to - a, y1, labs[k % len(labs)])
            k += 1

    # ---- light and shade (see shading.py for the recipes) ----
    def mask(self, draw, blur):
        im = Image.new("L", (self.w * K, self.h * K), 0)
        draw(ImageDraw.Draw(im), self.P)
        if blur > 0:
            im = im.filter(ImageFilter.GaussianBlur(blur * K))
        return np.asarray(im, np.float32) / 255

    def labels(self):
        return np.asarray(self.lab)

    def only(self, m, labs):
        return m if labs is None else m * np.isin(self.labels(), ids(labs))

    def stroke(self, pts, width, blur, dark=0.0, light=0.0, labs=None):
        """A soft line of shade: dark multiplies (1 - dark), light adds; only on labs (None: every label)."""
        def draw(d, P):
            d.line(P(pts), fill=255, width=max(1, round(width * K)), joint="curve")
        m = self.only(self.mask(draw, blur), labs)
        self.shade *= 1 - dark * m
        self.add += light * m

    def fold(self, pts, width=1.4, blur=1.2, depth=0.08, offset=(0.9, 0.9), labs=None):
        """A crease along pts. On light cloth a soft dark line with a highlight beside it; on dark cloth, where a
        darker line can't show, a lighter ridge with a shadow beside it."""
        light, dark = split(labs)
        beside = [(x + offset[0], y + offset[1]) for x, y in pts]
        if light:
            self.stroke(pts, width, blur, dark=depth, labs=light)
            self.stroke(beside, width * 0.8, blur, light=depth * 0.35, labs=light)
        if dark:
            self.stroke(pts, width, blur, light=depth * 0.8, labs=dark)
            self.stroke(beside, width * 0.8, blur, light=-depth * 0.5, labs=dark)

    def gradient(self, fn, labs=None):
        """Multiply the shade by fn(x, y) (template px), only on labs (None: every label)."""
        g = np.broadcast_to(np.asarray(fn(self.x, self.y), np.float32), self.shade.shape)
        if labs is not None:
            g = 1 + (g - 1) * np.isin(self.labels(), ids(labs))
        self.shade = self.shade * g

    # ---- output ----
    def render(self, ai=None, mode="direct"):
        lab = self.labels()
        base = S.palette[lab]
        light = np.isin(lab, S.light)[..., None]
        rgb = np.where(light, base * self.shade[..., None], base * (0.6 + 0.4 * self.shade[..., None]))
        rgb = rgb + self.add[..., None]
        weave = np.where(np.isin(lab, S.dark), 0.10, 0.025)  # a fine weave; dark cloth needs more to show it
        rgb = rgb * (1 + self.noise() * weave)[..., None]
        if ai is not None:
            rgb = direct(ai, lab, rgb) if mode == "direct" else fuse(base, lab, ai)
        alpha = (lab != 0).astype(np.float32)
        return np.dstack([np.clip(rgb, 0, 1), alpha])

    def noise(self):
        small = self.rng.normal(0, 1, (self.h * 2, self.w * 2)).astype(np.float32)
        im = Image.fromarray(small, "F").resize((self.w * K, self.h * K), Image.BILINEAR)
        return np.asarray(im, np.float32).clip(-2.5, 2.5) / 2.5

    def mirrored(self, vertical=False):
        """The face mirrored left to right (or top to bottom), labels and shading both."""
        f = Face.__new__(Face)
        f.w, f.h, f.rng, f.s0, f.ring = self.w, self.h, self.rng, self.s0, self.ring
        f.lab = self.lab.transpose(Image.FLIP_TOP_BOTTOM if vertical else Image.FLIP_LEFT_RIGHT)
        f.d = ImageDraw.Draw(f.lab)
        flip = (lambda a: a[::-1].copy()) if vertical else (lambda a: a[:, ::-1].copy())
        f.shade, f.add = flip(self.shade), flip(self.add)
        f.x, f.y = self.x, self.y
        return f


def garment(name, draw_torso, draw_limb):
    """Every face of one template: {"torso" | "right" | "left": {key: Face}}. draw_torso(face, key) and
    draw_limb(face, key) paint blank faces (None leaves them empty); the left limb is the right one mirrored.
    Draw anything on one side only (a patch, a badge on one sleeve) on garment["left"] after this returns."""
    g = {"torso": {}, "right": {}}
    for key in "FBLRUD":
        for part, ring, girth, draw in (("torso", WAIST, 384, draw_torso), ("right", LIMB_RING, 256, draw_limb)):
            w, h = REGIONS[part][key][2:]
            f = Face(w, h, zlib.crc32(f"{name}/{part}/{key}".encode()), ring.get(key, 0), girth)
            if draw:
                draw(f, key)
            g[part][key] = f
    # the top face mirrors top to bottom on the template, the others left to right
    g["left"] = {MIRROR[k]: f.mirrored(vertical=(k == "U")) for k, f in g["right"].items()}
    return g


# ---- taking in the image model's repaint ----
GREY_EDGE = 6  # template px from a face's border where GREY_FILL = "edges" replaces the repaint's flat grey


def greyish():
    """Labels whose own colour is near grey (every channel 64-191): grey in their repaint is their shading, never
    taken for the repaint's empty grey."""
    return [i for i in range(1, len(S.names)) if np.abs(S.palette[i] - 0.5).max() < 0.25]


def flat_grey(ai, lab):
    """Pixels of a face (not "none", not grey cloth) that the repaint left flat mid grey."""
    sat = ai.max(-1) - ai.min(-1)
    return (np.abs(ai - 0.5).max(-1) < 0.06) & (sat < 0.03) & (lab != 0) & ~np.isin(lab, greyish() + list(S.code))


def painted_grey(ai, lab, l):
    """True when the repaint made area l grey as a whole (a grey lining, a silver zip): its colour, not emptiness."""
    return np.abs(np.median(ai[lab == l], axis=0) - 0.5).max() < 0.1


def grey_zone(lab, scale):
    """Where GREY_FILL replaces flat grey, for a face at `scale` px per template px."""
    if S.grey_fill == "any":
        return np.ones(lab.shape, bool)
    if S.grey_fill == "off":
        return np.zeros(lab.shape, bool)
    h, w = lab.shape
    yy, xx = np.mgrid[0:h, 0:w]
    return np.minimum(np.minimum(yy, h - 1 - yy), np.minimum(xx, w - 1 - xx)) < GREY_EDGE * scale


def direct(ai, lab, proc):
    """The image model's pixels, with each big area's median colour brought to the palette (so the three sheets agree),
    the code-painted pixel for CODE_LABELS, and, where the model left its empty grey inside a face, the area's own
    repaint colour shaded like the code."""
    out = ai.copy()
    for l in S.normalize:
        m = lab == l
        if m.sum() < 64:
            continue
        gain = np.clip(S.palette[l] / np.maximum(np.median(ai[m], axis=0), 1e-3), S.gain_floor.get(l, 0.7), 1.4)
        out[m] = ai[m] * gain
    if S.code:
        keep = np.isin(lab, S.code)
        out[keep] = proc[keep]
    grey = flat_grey(ai, lab) & grey_zone(lab, K)
    for l in np.unique(lab[grey]):
        if painted_grey(ai, lab, l):
            continue
        fill = grey & (lab == l)
        rest = (lab == l) & ~grey
        ref = np.median(out[rest], axis=0) if rest.sum() >= 64 else S.palette[l]
        out[fill] = ref * np.clip(proc[fill] / np.maximum(S.palette[l], 1e-3), 0.5, 1.5)
    return out


def fuse(base, lab, ai):
    """Keep the palette colours, take only the light and shade from the repaint."""
    lum = ai[..., 0] * 0.2126 + ai[..., 1] * 0.7152 + ai[..., 2] * 0.0722
    out = base.copy()
    for l in np.unique(lab):
        if l == 0:
            continue
        m = lab == l
        ref = np.median(lum[m])
        if l in S.light:
            out[m] = base[m] * np.clip(lum / max(ref, 1e-3), 0.55, 1.15)[m][:, None]
        else:
            out[m] = base[m] + np.clip(lum - ref, -0.12, 0.25)[m][:, None]
    return out


def remap_rows(arr, src, dst, x1):
    """Move rows src[i] -> dst[i] (piecewise linear) in columns [0, x1)."""
    rows = np.interp(np.arange(arr.shape[0]) + 0.5, dst, src) - 0.5
    r0 = np.clip(np.floor(rows).astype(int), 0, arr.shape[0] - 1)
    r1 = np.clip(r0 + 1, 0, arr.shape[0] - 1)
    t = (rows - np.floor(rows))[:, None, None]
    out = arr.copy()
    part = arr[:, :x1]
    out[:, :x1] = part[r0] * (1 - t) + part[r1] * t
    return out


def register_legs(arr, band, above, band_top):
    """The image model has returned the legs sheet squeezed vertically (a 10-row sole came back 7 rows high). Find each
    leg's last band of the `band` label (rows where most pixels are nearer its colour than the `above` label's) and
    remap rows so it lands on rows band_top-128 of its leg. A leg whose band is missing or implausible is left as is."""
    c_band, c_above = S.palette[band], S.palette[above]
    if np.linalg.norm(c_band - c_above) < 0.2:
        print("[legs] the band and the label above it are too close in colour to align on; left unregistered")
        return arr
    legs = arr[:, :256 * K]
    nearer = ((legs - c_band) ** 2).sum(-1) < ((legs - c_above) ** 2).sum(-1)
    on = nearer.mean(1) > 0.5
    runs, start = [], None
    for i, v in enumerate(np.append(on, False)):
        if v and start is None:
            start = i
        elif not v and start is not None:
            if i - start > K:
                runs.append((start, i))
            start = None
    top = [r for r in runs if r[1] <= 132 * K]
    bottom = [r for r in runs if r[0] >= 124 * K]
    expected = ((band_top * K, 128 * K), ((128 + band_top) * K, 256 * K))
    found = [top[-1] if top else None, bottom[-1] if bottom else None]
    # a run is the band only if it ends near its leg's end and is a plausible height
    runs = [r if r and abs(r[1] - e[1]) <= 12 * K and 3 * K <= r[1] - r[0] <= 20 * K else e
            for r, e in zip(found, expected)]
    if runs == list(expected):
        print("[legs] no band found where expected; left unregistered (check the shoes by eye)")
        return arr
    (a0, a1), (b0, b1) = runs
    src = [0, a0, a1, b0, b1, arr.shape[0]]
    dst = [0, band_top * K, 128 * K, (128 + band_top) * K, 256 * K, arr.shape[0]]
    print("[legs] bands at rows", [round(v / K, 1) for v in src[1:5]], "->", [v / K for v in dst[1:5]])
    return remap_rows(arr, src, dst, 256 * K)


def load_repaint(path, name):
    """A repaint sheet at K x (the legs realigned), or None. Warns when its canvas isn't the guide's."""
    if not os.path.exists(path):
        return None
    garment_name, (w, h), _ = SHEETS[name]
    im = Image.open(path).convert("RGB")
    if im.size != (w * SHEET_SCALE, h * SHEET_SCALE):
        print(f"[{name}] WARNING: the repaint is {im.size[0]}x{im.size[1]}, the guide {w * SHEET_SCALE}x{h * SHEET_SCALE}: "
              "expect misalignment; repaint it again")
    arr = np.asarray(im.resize((w * K, h * K), Image.LANCZOS), np.float32) / 255
    if name == "legs" and S.register_legs:
        arr = register_legs(arr, *S.register_legs)
    return arr


def ai_crops(ai_dir):
    """Face crops of the repaints at K x, keyed (garment, part, key)."""
    crops = {}
    for name, (garment_name, _, place) in SHEETS.items():
        arr = load_repaint(f"{ai_dir}/ai_{name}.png", name)
        if arr is None:
            continue
        for (part, key), (x, y) in place.items():
            fw, fh = REGIONS[part][key][2:]
            crops[(garment_name, part, key)] = arr[y * K:(y + fh) * K, x * K:(x + fw) * K]
    return crops


# ---- output ----
def downsample(rgba, factor):
    """Box filter with premultiplied alpha."""
    h, w = rgba.shape[0] // factor, rgba.shape[1] // factor
    pre = rgba.copy()
    pre[..., :3] *= pre[..., 3:4]
    pre = pre.reshape(h, factor, w, factor, 4).mean(axis=(1, 3))
    a = pre[..., 3:4]
    pre[..., :3] = np.where(a > 1e-4, pre[..., :3] / np.maximum(a, 1e-4), 0)
    return pre


def template(garment_name, scale, rendered):
    canvas = np.zeros((559 * scale, 585 * scale, 4), np.float32)
    for part, regions in REGIONS.items():
        for key, (x, y, w, h) in regions.items():
            if (garment_name, part, key) in rendered:
                canvas[y * scale:(y + h) * scale, x * scale:(x + w) * scale] = \
                    downsample(rendered[(garment_name, part, key)], K // scale)
    return canvas


def write_sheets(out, rendered, labels):
    for name, (garment_name, (w, h), place) in SHEETS.items():
        if not any(k[0] == garment_name for k in rendered):
            continue
        s = SHEET_SCALE
        canvas = np.full((h * s, w * s, 3), 0.5, np.float32)
        lab = np.zeros((h * s, w * s), np.uint8)
        for (part, key), (x, y) in place.items():
            img = downsample(rendered[(garment_name, part, key)], K // s)
            a = img[..., 3:4]
            canvas[y * s:y * s + img.shape[0], x * s:x * s + img.shape[1]] = img[..., :3] * a + 0.5 * (1 - a)
            l = labels[(garment_name, part, key)][::K // s, ::K // s]
            lab[y * s:y * s + l.shape[0], x * s:x * s + l.shape[1]] = l
        save(canvas, f"{out}/guide_{name}.png")
        Image.fromarray(lab, "L").save(f"{out}/labels_{name}.png")


def save(arr, path):
    mode = "RGBA" if arr.shape[-1] == 4 else "RGB"
    Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8), mode).save(path)


def mock(out, skin=(234, 184, 146), scale=3):
    """views.png: the templates on a flat Blocky body seen from the front, the right side, the back and the left side
    (no lighting, no hidden rows), to check that faces meet and that each side shows what it should. It is not the
    in-game look: preview in Studio for that."""
    tpl = {}
    for g in ("shirt", "pants"):
        p = f"{out}/{g}.png"
        tpl[g] = np.asarray(Image.open(p).convert("RGBA"), np.float32) / 255 if os.path.exists(p) else None

    def face(part, key, layers):
        x, y, w, h = REGIONS[part][key]
        px = np.zeros((h, w, 3), np.float32) + np.array(skin, np.float32) / 255
        for g in layers:
            if tpl[g] is not None:
                c = tpl[g][y:y + h, x:x + w]
                px = c[..., :3] * c[..., 3:4] + px * (1 - c[..., 3:4])
        return px

    bg = 0.18
    views = []
    for view in ("F", "R", "B", "L"):
        if view in "FB":
            canvas = np.full((64 + 128 + 128 + 8, 64 + 128 + 64, 3), bg, np.float32)
            canvas[4:60, 100:156] = np.array(skin, np.float32) / 255  # the head
            arms = ("right", "left") if view == "F" else ("left", "right")  # the viewer's left first
            canvas[64:192, 0:64] = face(arms[0], view, ("shirt",))
            canvas[64:192, 64:192] = face("torso", view, ("pants", "shirt"))
            canvas[64:192, 192:256] = face(arms[1], view, ("shirt",))
            canvas[192:320, 64:128] = face(arms[0], view, ("pants",))
            canvas[192:320, 128:192] = face(arms[1], view, ("pants",))
        else:  # a side: the arm's outer face in front of the torso, the leg's outer face below
            side = "right" if view == "R" else "left"
            canvas = np.full((64 + 128 + 128 + 8, 64 + 48, 3), bg, np.float32)
            canvas[4:60, 28:84] = np.array(skin, np.float32) / 255
            canvas[64:192, 24:88] = face(side, view, ("shirt",))
            canvas[192:320, 24:88] = face(side, view, ("pants",))
        views.append(canvas)
    gap = np.full((views[0].shape[0], 24, 3), bg, np.float32)
    sheet = np.concatenate([v for pair in zip(views, [gap] * 4) for v in pair][:-1], axis=1)
    im = Image.fromarray((np.clip(sheet, 0, 1) * 255 + 0.5).astype(np.uint8), "RGB")
    im.resize((im.width * scale, im.height * scale), Image.NEAREST).save(f"{out}/views.png")


def build(outfit, out, ai_dir=None, mode="direct", extra_scale=None, sheets=False):
    """Render every face (with the repaint when ai_dir is given) and write the templates, views.png, and with
    sheets=True the guide sheets and their label maps."""
    configure(outfit)
    os.makedirs(out, exist_ok=True)
    shirt, pants = outfit.faces()
    garments = [(n, g) for n, g in (("shirt", shirt), ("pants", pants)) if g]
    every = [(n, part, key, f) for n, g in garments for part, fs in g.items() for key, f in fs.items()]
    if S.normalize is None:  # every area that covers at least 2% of the painted pixels
        counts = np.zeros(len(S.names))
        for *_, f in every:
            counts += np.bincount(f.labels().ravel(), minlength=len(S.names))
        counts[0] = 0
        S.normalize = tuple(int(l) for l in np.nonzero(counts >= 0.02 * counts.sum())[0])
    crops = ai_crops(ai_dir) if ai_dir else {}
    if ai_dir and not crops:
        print(f"no repaints in {ai_dir}: the templates are code-only")
    if sheets:
        print("shading:", ", ".join(f"{n} {'light' if i in S.light else 'dark'}" for i, n in enumerate(S.names) if i),
              "(light cloth darkens by multiplying, dark cloth by adding light; SHADE_AS overrides)")
    rendered, labels = {}, {}
    for n, part, key, f in every:
        rendered[(n, part, key)] = f.render(crops.get((n, part, key)), mode)
        labels[(n, part, key)] = f.labels()
    if crops and shirt:
        # the left arm has no sheet: it takes the right arm's repaint, mirrored like the faces were
        for key_r in "FBLR":
            src = crops.get(("shirt", "right", key_r))
            if src is not None:
                rendered[("shirt", "left", MIRROR[key_r])] = shirt["left"][MIRROR[key_r]].render(src[:, ::-1], mode)
        src = crops.get(("shirt", "right", "U"))
        if src is not None:
            rendered[("shirt", "left", "U")] = shirt["left"]["U"].render(src[::-1], mode)
    for n, _ in garments:
        save(template(n, 1, rendered), f"{out}/{n}.png")
        if extra_scale:  # a bigger copy for other uses (a layered carrier's texture); Roblox renders 1x only
            save(template(n, extra_scale, rendered), f"{out}/{n}@{extra_scale}x.png")
    if sheets:
        write_sheets(out, rendered, labels)
    mock(out)
    print("written", out)


def check(guides, ai_dir):
    """Per sheet: the canvas size, then the best shift and the overlap of each area between the guide and the repaint,
    at template resolution. Every area counts, the empty grey included; each repaint pixel joins the area whose colour
    (as the repaint painted it) is nearest. Returns True when all sheets PASS."""
    ok = True
    for name, (garment_name, (w, h), place) in SHEETS.items():
        if not os.path.exists(f"{guides}/labels_{name}.png"):
            continue
        path = f"{ai_dir}/ai_{name}.png"
        if not os.path.exists(path):
            print(f"{name}: no repaint")
            ok = False
            continue
        size = Image.open(path).size
        if size != (w * SHEET_SCALE, h * SHEET_SCALE):
            print(f"{name}: REDO - the repaint is {size[0]}x{size[1]}, the guide {w * SHEET_SCALE}x{h * SHEET_SCALE}")
            ok = False
            continue
        arr = load_repaint(path, name).reshape(h, K, w, K, 3).mean(axis=(1, 3))
        lab = np.asarray(Image.open(f"{guides}/labels_{name}.png"))[::SHEET_SCALE, ::SHEET_SCALE].astype(np.int32)
        ignore = np.isin(lab, list(S.gain_floor))  # areas the build recolours on purpose are not compared
        # each area's colour as the repaint painted it (the model shifts tones; the build evens them out later).
        # Areas closer than 0.15 in the palette or 0.08 in the repaint count as one; cloth painted mid grey counts
        # as empty. Areas under 0.2% of the sheet are left out.
        areas = [int(l) for l in np.unique(lab[~ignore]) if (lab == l).mean() > 0.002]
        ref = {l: np.full(3, 0.5, np.float32) if l == 0 else np.median(arr[lab == l], axis=0) for l in areas}
        group = {l: l for l in areas}
        for i, a in enumerate(areas):
            for b in areas[i + 1:]:
                if np.linalg.norm(S.palette[a] - S.palette[b]) < 0.15 or np.linalg.norm(ref[a] - ref[b]) < 0.08:
                    group[b] = group[a]
        g = np.vectorize(lambda v: group.get(v, -1))(lab)
        g[ignore] = -1
        valid = g >= 0
        nearest = np.argmin(((arr[..., None, :] - np.array([ref[l] for l in areas])) ** 2).sum(-1), -1)
        cls = np.array([group[l] for l in areas])[nearest]
        groups = sorted(set(group.values()))
        big = [x for x in groups if (g == x).mean() > 0.01]

        def overlap(c, x):
            a, b = g == x, (c == x) & valid
            return (a & b).sum() / max(1, (a | b).sum())

        best = (-1.0, 0, 0)
        for dy in range(-6, 7):
            for dx in range(-3, 4):
                shifted = np.roll(cls, (dy, dx), (0, 1))
                mean = float(np.mean([overlap(shifted, x) for x in groups]))
                if mean > best[0]:
                    best = (mean, dx, dy)
        ious = {x: overlap(cls, x) for x in groups}
        worst = min(big or groups, key=ious.get)
        verdict = "PASS" if abs(best[1]) <= 1 and abs(best[2]) <= 1 and ious[worst] >= 0.6 else "REDO"
        ok &= verdict == "PASS"
        # flat grey the repaint left inside cloth, face by face, that the build's GREY_FILL won't replace
        left = []
        grey_areas = [l for l in np.unique(lab) if l and painted_grey(arr, lab, l)]
        for (part, key), (x, y) in place.items():
            fw, fh = REGIONS[part][key][2:]
            fl = lab[y:y + fh, x:x + fw]
            stray = flat_grey(arr[y:y + fh, x:x + fw], fl) & ~grey_zone(fl, 1) & ~np.isin(fl, grey_areas)
            n = int(stray.sum())
            if n > max(16, 0.005 * fw * fh):
                left.append(f"{part} {key} {n} px")
        if left:
            verdict = "REDO"
            ok = False
        # a merged area is named after its members, biggest first
        names = {x: sorted((l for l in areas if group[l] == x), key=lambda l: -(lab == l).sum()) for x in groups}
        label = lambda x: "+".join("empty" if l == 0 else S.names[l] for l in names[x])
        print(f"{name}: {verdict} - best shift ({best[1]:+d}, {best[2]:+d}) template px, mean overlap {best[0]:.2f}; "
              "per area " + ", ".join(f"{label(x)} {ious[x]:.2f}" for x in sorted(groups, key=ious.get)))
        if left:
            print(f"  flat grey left inside cloth ({', '.join(left)}): the template would show it. Set "
                  f'GREY_FILL = "any" in outfit.py if no cloth is meant to be mid grey there, or repaint the sheet')
    return ok
