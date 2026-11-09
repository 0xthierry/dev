# The paint check for a generated piece: finds what makes spots on it in the game, fixes it, and checks again.
#   - unpainted faces: after decimation a triangle can stretch across a gap between UV islands, so it samples texels
#     the generator never painted (light or dark spots, often on a flat colour like a blindfold). Such a triangle takes
#     the UVs of a painted neighbour (it shows the neighbour's colour);
#   - specks: a few texels far off the colour round them in an even area (a white highlight on a black band). They take
#     the median colour round them;
#   - the gutter: texels round the islands that were never painted bleed into the islands' edges when the texture is
#     filtered or mipmapped. The islands' colours are extended into them (padding).
# Used by fit_on_head.py (runs inside Blender's Python; needs only numpy). Texture arrays are Blender's: (H, W, 4)
# floats, row 0 at the bottom, so UV (u, v) is texel (u * W, v * H).
import numpy as np

SAMPLES = np.array([[0.70, 0.15, 0.15], [0.15, 0.70, 0.15], [0.15, 0.15, 0.70], [1 / 3, 1 / 3, 1 / 3],
                    [0.45, 0.45, 0.10], [0.10, 0.45, 0.45], [0.45, 0.10, 0.45]])  # points inside a triangle


def rasterize(tris: np.ndarray, w: int, h: int) -> np.ndarray:
    """The texels whose centres lie in any of the UV triangles (T, 3, 2 in texels); each triangle marks at least the
    texel under its centre, so slivers count too."""
    mask = np.zeros((h, w), bool)
    for t in tris:
        c = t.mean(0)
        mask[min(max(int(c[1]), 0), h - 1), min(max(int(c[0]), 0), w - 1)] = True
        x0, y0 = np.maximum(np.floor(t.min(0)).astype(int), 0)
        x1, y1 = np.minimum(np.ceil(t.max(0)).astype(int), [w - 1, h - 1])
        if x1 < x0 or y1 < y0:
            continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        (ax, ay), (bx, by), (cx, cy) = t
        d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(d) < 1e-9:
            continue
        l1 = ((by - cy) * (gx - cx) + (cx - bx) * (gy - cy)) / d
        l2 = ((cy - ay) * (gx - cx) + (ax - cx) * (gy - cy)) / d
        mask[y0:y1 + 1, x0:x1 + 1] |= (l1 >= -0.01) & (l2 >= -0.01) & (1 - l1 - l2 >= -0.01)
    return mask


def uv_triangles(me, w: int, h: int) -> np.ndarray:
    me.calc_loop_triangles()
    uv = me.uv_layers.active.data
    return np.array([[[uv[li].uv[0] * w, uv[li].uv[1] * h] for li in lt.loops] for lt in me.loop_triangles], float)


def unpainted_triangles(tris: np.ndarray, painted: np.ndarray) -> np.ndarray:
    """Triangles with 3 or more of their 7 sample points on unpainted texels."""
    h, w = painted.shape
    pts = np.einsum("sk,tkc->tsc", SAMPLES, tris)  # (T, 7, 2)
    xs = np.clip(pts[..., 0].astype(int), 0, w - 1)
    ys = np.clip(pts[..., 1].astype(int), 0, h - 1)
    return (~painted[ys, xs]).sum(1) >= 3


def colour_edge_faces(me, px: np.ndarray, contrast: float = 0.4) -> int:
    """Triangles whose 7 sample points span a strong brightness difference: they fade one colour into another across
    the surface (a band's edge turning grey). Reported, not fixed: fit_on_head keeps colour edges out of decimation."""
    h, w = px.shape[:2]
    tris = uv_triangles(me, w, h)
    pts = np.einsum("sk,tkc->tsc", SAMPLES, tris)
    lum = px[np.clip(pts[..., 1].astype(int), 0, h - 1), np.clip(pts[..., 0].astype(int), 0, w - 1), :3] @ np.array(
        [0.299, 0.587, 0.114])
    return int(((lum.max(1) - lum.min(1)) > contrast).sum())


def window_median(a: np.ndarray, valid: np.ndarray, r: int = 2) -> np.ndarray:
    """The median of each texel's (2r+1)^2 neighbourhood, over valid texels only (NaN where none)."""
    h, w = a.shape
    pad = np.pad(np.where(valid, a, np.nan), r, constant_values=np.nan)
    stack = np.stack([pad[dy:dy + h, dx:dx + w] for dy in range(2 * r + 1) for dx in range(2 * r + 1)])
    with np.errstate(all="ignore"):
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            return np.nanmedian(stack, 0)


def find_specks(px: np.ndarray, painted: np.ndarray, max_blob: int = 24):
    """Texels far off their neighbourhood's median in an even neighbourhood, in blobs of at most max_blob texels."""
    lum = px[..., :3] @ np.array([0.299, 0.587, 0.114])
    med = window_median(lum, painted)
    spread = window_median(np.abs(lum - np.nan_to_num(med)), painted)
    odd = painted & (np.abs(lum - med) > 0.3) & (spread < 0.08)
    blobs, seen = [], np.zeros_like(odd)
    for y, x in zip(*np.nonzero(odd)):
        if seen[y, x]:
            continue
        blob, stack = [], [(y, x)]
        seen[y, x] = True
        while stack:
            cy, cx = stack.pop()
            blob.append((cy, cx))
            for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                if 0 <= ny < odd.shape[0] and 0 <= nx < odd.shape[1] and odd[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    stack.append((ny, nx))
        if len(blob) > max_blob:
            continue
        # a speck is surrounded by the other colour; a corner of a dark band against light hair is not
        inside, ring = set(blob), []
        for cy, cx in blob:
            for ny in range(cy - 1, cy + 2):
                for nx in range(cx - 1, cx + 2):
                    if (ny, nx) not in inside and 0 <= ny < odd.shape[0] and 0 <= nx < odd.shape[1] and painted[ny, nx]:
                        ring.append(lum[ny, nx])
        own = np.mean([lum[cy, cx] for cy, cx in blob])
        if ring and np.mean(np.abs(np.array(ring) - own) > 0.2) >= 0.75:
            blobs.append(blob)
    return blobs


def check_and_fix(me, px: np.ndarray, painted: np.ndarray, debug_png: str | None = None, pad: int = 8):
    """Fixes the piece's unpainted faces (its UVs), specks and gutter (the texture) and returns the texture and a report.
    painted: texels the generator painted (rasterize() of the source mesh's UVs, at this texture's size)."""
    h, w = painted.shape
    report = {}
    debug = px.copy() if debug_png else None
    # 1. unpainted faces take the UVs of a painted neighbour (sharing a vertex), a few passes for runs of them
    tris = uv_triangles(me, w, h)
    bad = unpainted_triangles(tris, painted)
    report["unpainted faces"] = int(bad.sum())
    if debug is not None:
        debug[rasterize(tris[bad], w, h)] = (1, 0, 1, 1)
    uv = me.uv_layers.active.data
    lts = list(me.loop_triangles)
    by_vertex = {}
    for k, lt in enumerate(lts):
        for vi in lt.vertices:
            by_vertex.setdefault(vi, []).append(k)
    for _ in range(6):
        if not bad.any():
            break
        for k in np.nonzero(bad)[0]:
            good = [j for vi in lts[k].vertices for j in by_vertex[vi] if not bad[j]]
            if good:
                centre = tris[good[0]].mean(0)
                for li in lts[k].loops:
                    uv[li].uv = (centre[0] / w, centre[1] / h)
                tris[k] = centre
                bad[k] = False
    report["unpainted faces left"] = int(bad.sum())
    # 2. specks take their neighbourhood's median colour (computed without the specks), until none is left
    blobs = find_specks(px, painted)
    report["specks"] = len(blobs)
    report["speck texels"] = sum(len(b) for b in blobs)
    clean = painted.copy()  # texels never flagged: the only ones a speck takes its colour from
    for _ in range(12):  # fixing a speck can leave its neighbour standing out: repeat until none is left
        if not blobs:
            break
        for blob in blobs:
            for y, x in blob:
                clean[y, x] = False
        h, w = painted.shape
        for blob in blobs:
            for y, x in blob:
                for r in (2, 4):  # the window find_specks compares with; wider where it has no clean texel
                    y0, y1, x0, x1 = max(0, y - r), min(h, y + r + 1), max(0, x - r), min(w, x + r + 1)
                    ok = clean[y0:y1, x0:x1]
                    if ok.any():
                        px[y, x, :3] = np.median(px[y0:y1, x0:x1, :3][ok], 0)
                        break
                if debug is not None:
                    debug[y, x] = (1, 0, 0, 1)
        blobs = find_specks(px, painted)
    report["specks left"] = len(blobs)
    # 3. padding: each unpainted texel next to painted ones takes their mean colour, pad rings out
    filled = painted.copy()
    padded = 0
    for _ in range(pad):
        acc, cnt = np.zeros_like(px), np.zeros((h, w, 1))
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            src = np.roll(np.roll(filled, dy, 0), dx, 1)
            col = np.roll(np.roll(px, dy, 0), dx, 1)
            acc += col * src[..., None]
            cnt += src[..., None]
        ring = ~filled & (cnt[..., 0] > 0)
        px[ring] = acc[ring] / cnt[ring]
        filled |= ring
        padded += int(ring.sum())
    report["gutter texels padded"] = padded
    report["unpainted faces after fix"] = int(unpainted_triangles(uv_triangles(me, w, h), filled).sum())
    if debug is not None:
        debug[~painted & (debug[..., 0] != 1)] *= (0.35, 0.35, 0.35, 1)
        save_png(debug, debug_png)
    return px, report


def save_png(px: np.ndarray, path: str):
    import bpy
    h, w = px.shape[:2]
    img = bpy.data.images.new("texture_check", w, h, alpha=True)
    img.pixels = np.clip(px, 0, 1).ravel().tolist()
    img.filepath_raw, img.file_format = path, "PNG"
    img.save()
    bpy.data.images.remove(img)
