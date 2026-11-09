# A piece generated ON our NPC head (an image model paints it onto npc_head.py's reference render, Tripo makes head and
# piece into one model) made into an accessory that fits that exact head:
#   1. split: faces whose texture is skin-coloured are the AI's head; the rest is the piece, less small islands
#      (a face painted on the reference head, specks);
#   2. fit: the AI head is mapped onto our NPC head (npc_head.py) by its width, its front and the level where it is
#      first 0.8 of its width from below, carrying the piece;
#   3. no clipping: piece vertices inside our head are pushed out to its surface plus 2%;
#   4. reduce: decimate to a triangle budget (UVs kept) and shrink the texture;
#   5. the paint check (texture_check.py): faces that sample unpainted texels, specks and the gutter round the UV
#      islands are fixed, checked again and reported, with a picture of what was fixed (<out>-<name>-paint.png);
#   6. anime finish (optional): brightness bands, and an inverted-hull outline piece.
# Writes the piece (and its outline) into a pieces JSON for the HeadsLab place, like fit_glb.py.
#   blender -b --factory-startup --python fit_on_head.py -- <in.glb> <name> <attachment> <out.json> \
#       [tris=3000] [tex=512] [bands=0] [outline=0.0] [flat=0.0]
# flat: texels darker than this luminance become one flat colour, their median (a uniform black band or strap; the
# generator bakes faint folds and blotches into it, which long decimated triangles stretch into streaks). 0 = off.
# Head space as everywhere in heads-lab: Blender +X the wearer's left, -Y the front, Z up.
import base64
import colorsys
import json
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import npc_head  # noqa: E402
import texture_check  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1:]
src, name, attachment, out = args[:4]
tris_budget = int(args[4]) if len(args) > 4 else 3000
tex_size = int(args[5]) if len(args) > 5 else 512
bands = int(args[6]) if len(args) > 6 else 0
outline = float(args[7]) if len(args) > 7 else 0.0
flat = float(args[8]) if len(args) > 8 else 0.0
MIN_ISLAND = 0.01  # islands smaller than this share of the piece's area are dropped
WIDE = 0.8  # the "bottom" of a head: the lowest level where it is this share of its full width

bpy.ops.wm.read_factory_settings(use_empty=True)

# our head: its surface, width, front and bottom level (measured the way the AI head is measured below)
head_me = npc_head.shell_mesh()
head = npc_head.surface(head_me)
HEAD_W = npc_head.RIG.x
FRONT = min(v.co.y for v in head_me.vertices)
bpy.data.meshes.remove(head_me)


def head_width(z):
    left = [head.ray_cast(Vector((-3, y, z)), Vector((1, 0, 0)))[0] for y in (-0.3, -0.15, 0, 0.15, 0.3)]
    right = [head.ray_cast(Vector((3, y, z)), Vector((-1, 0, 0)))[0] for y in (-0.3, -0.15, 0, 0.15, 0.3)]
    xs = [p.x for p in left + right if p is not None]
    return max(xs) - min(xs) if xs else 0.0


BOTTOM = next(z / 1000 for z in range(-600, 0, 2) if head_width(z / 1000) > WIDE * HEAD_W)

bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
me = ob.data
# glTF splits vertices along every UV seam, and Tripo's texture is hundreds of small islands: split vertices get
# different normals, so smooth shading breaks into facets (streaks on a flat band, sharded locks) and the outline
# cracks along the seams. Welded, the UVs stay (they are per corner) and the normals run smoothly across the seams.
bpy.ops.mesh.customdata_custom_splitnormals_clear()
bm = bmesh.new()
bm.from_mesh(me)
before = len(bm.verts)
bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
print(f"welded {before - len(bm.verts)} seam vertices")
bm.to_mesh(me)
bm.free()
for p in me.polygons:
    p.use_smooth = True

# the base colour texture, read once
img = next(n.image for s in ob.material_slots if s.material for n in s.material.node_tree.nodes
           if n.type == "TEX_IMAGE" and n.image and any(l.to_socket.name == "Base Color" for l in n.outputs[0].links))
W, H = img.size
pix = np.array(img.pixels[:], np.float32).reshape(H, W, 4)


def is_skin(rgb):
    h, s, v = colorsys.rgb_to_hsv(*rgb)
    return 0.02 < h < 0.12 and 0.2 < s < 0.75 and v > 0.35  # orange-ish, not dark: skin, not black or grey hair


# 1. split by colour: skin faces are the AI head (and neck)
bm = bmesh.new()
bm.from_mesh(me)
uv = bm.loops.layers.uv.active
skin = []
for f in bm.faces:
    c = sum((l[uv].uv for l in f.loops), Vector((0, 0))) / len(f.loops)
    x, y = min(W - 1, max(0, int(c.x * W))), min(H - 1, max(0, int(c.y * H)))
    if is_skin(pix[y, x, :3]):
        skin.append(f)
head_pts = [v.co.copy() for f in skin for v in f.verts]
print(f"faces {len(bm.faces)}, skin {len(skin)}")

# 2. fit. Hair hides the top and back of the AI head, so only its width (the sides show skin), its front and its
# bottom level are trusted; it is our head as the image model saw it, so one uniform scale.
xs = [p.x for p in head_pts]
wx = max(xs) - min(xs)
cx, front = (max(xs) + min(xs)) / 2, min(p.y for p in head_pts)
slices = {}
for p in head_pts:
    k = round(p.z / (wx / 40))
    lo_hi = slices.setdefault(k, [p.x, p.x])
    lo_hi[0], lo_hi[1] = min(lo_hi[0], p.x), max(lo_hi[1], p.x)
bottom = min(k for k, (a, b) in slices.items() if b - a > WIDE * wx) * (wx / 40)
s_ = HEAD_W / wx
print(f"AI head width {wx:.3f}, front {front:.3f}, bottom {bottom:.3f}; scale {s_:.3f}; our bottom level {BOTTOM:.3f}")
bmesh.ops.delete(bm, geom=skin, context="FACES")
for v in bm.verts:
    v.co = Vector(((v.co.x - cx) * s_, (v.co.y - front) * s_ + FRONT, (v.co.z - bottom) * s_ + BOTTOM))
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")

# small islands left by the split (a painted mouth, specks of non-skin colour on the face) are not the piece.
# glTF splits vertices at UV seams, so faces are joined by vertex position, not by shared vertices.
at = {}
for v in bm.verts:
    at.setdefault(v.co.to_tuple(5), []).extend(v.link_faces)
islands, seen = [], set()
for f in bm.faces:
    if f in seen:
        continue
    seen.add(f)
    island, stack = [], [f]
    while stack:
        g = stack.pop()
        island.append(g)
        for v in g.verts:
            for h in at[v.co.to_tuple(5)]:
                if h not in seen:
                    seen.add(h)
                    stack.append(h)
    islands.append(island)
total = sum(f.calc_area() for f in bm.faces)
specks = [i for i in islands if sum(f.calc_area() for f in i) < MIN_ISLAND * total]
bmesh.ops.delete(bm, geom=[f for i in specks for f in i], context="FACES")
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
print(f"islands {len(islands)}, dropped {len(specks)} under {MIN_ISLAND:.0%} of the area")

# what is painted for the piece: the texels under the faces it keeps (not the AI head, which a stretched triangle
# would otherwise sample as "painted"), less skin-coloured texels (the generator bleeds skin into a band's edge where
# it meets the head; the split above already takes skin colour as not the piece), at the final texture size
small = img.copy()
small.scale(tex_size, tex_size)
px = np.array(small.pixels[:], np.float32).reshape(tex_size, tex_size, 4)
uv = bm.loops.layers.uv.active
painted = texture_check.rasterize(np.array([[[l[uv].uv.x * tex_size, l[uv].uv.y * tex_size] for l in f.loops[:3]]
                                             for f in bm.faces], float), tex_size, tex_size)
r, g, b = px[..., 0], px[..., 1], px[..., 2]
mx, mn = np.maximum(np.maximum(r, g), b), np.minimum(np.minimum(r, g), b)
sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
hue = np.where(mx == r, ((g - b) / np.maximum(mx - mn, 1e-6)) % 6, 0) / 6  # skin is red-dominant: hue from red
skin_texels = (mx == r) & (mx > mn) & (hue > 0.02) & (hue < 0.12) & (sat > 0.2) & (sat < 0.75) & (mx > 0.35)
print(f"skin-coloured texels on the piece: {int((painted & skin_texels).sum())}")
painted &= ~skin_texels

# 3. no clipping: a vertex inside our head moves out along the line from the head's centre to 2% past the surface
pushed = 0
for v in bm.verts:
    r = v.co.length
    if r < 1e-4:
        continue
    d = v.co / r
    hit = head.ray_cast(d * 3, -d)[0]
    if hit is not None and r < hit.length * 1.02:
        v.co = d * hit.length * 1.02
        pushed += 1
print("pushed out", pushed)

# colour edges (a band against hair, a mask's pattern): vertices on an edge between faces of strongly different
# brightness are kept out of the decimation, or triangles end up spanning both colours and fade one into the other
lum_w = np.array([0.299, 0.587, 0.114], np.float32)
face_lum = {}
for f in bm.faces:
    c = sum((l[uv].uv for l in f.loops), Vector((0, 0))) / len(f.loops)
    face_lum[f] = float(pix[min(H - 1, max(0, int(c.y * H))), min(W - 1, max(0, int(c.x * W))), :3] @ lum_w)
bm.verts.index_update()
edge_verts = {v.index for e in bm.edges if len(e.link_faces) == 2
              and abs(face_lum[e.link_faces[0]] - face_lum[e.link_faces[1]]) > 0.35 for v in e.verts}
bm.to_mesh(me)
bm.free()
keep = ob.vertex_groups.new(name="colour_edges")
keep.add(sorted(edge_verts), 1.0, "REPLACE")
print(f"colour-edge vertices kept: {len(edge_verts)}")
detail = ob.copy()  # the full-detail piece, whose smooth normals the decimated one takes (step 4c)
detail.data = me.copy()
bpy.context.scene.collection.objects.link(detail)

# 4. reduce
tris = sum(len(p.vertices) - 2 for p in me.polygons)
if tris > tris_budget:
    mod = ob.modifiers.new("decimate", "DECIMATE")
    mod.ratio = tris_budget / tris
    mod.vertex_group, mod.invert_vertex_group = keep.name, True  # weight 1 = not decimated
    bpy.ops.object.modifier_apply(modifier=mod.name)
me = ob.data
me.calc_loop_triangles()


# 4b. the head must not show through: decimation moves vertices, and a flat triangle between two vertices on a curved
# head dips inside it (a chord), so skin shows through a band hugging the head in bars. Every triangle is sampled at 7
# points; the vertices of any triangle with a point within 0.4% of the surface move out, until none is.
def dips(points):
    for p in points:
        r = p.length
        hit = head.ray_cast(p / r * 3, -p / r)[0] if r > 1e-4 else None
        if hit is not None and r < hit.length * 1.004:
            return True
    return False


sample = texture_check.SAMPLES
first_dips = None
for _ in range(8):
    corners = [[me.vertices[i].co.copy() for i in lt.vertices] for lt in me.loop_triangles]
    bad_tris = [k for k, c in enumerate(corners) if dips([c[0] * w0 + c[1] * w1 + c[2] * w2 for w0, w1, w2 in sample])]
    first_dips = len(bad_tris) if first_dips is None else first_dips
    if not bad_tris:
        break
    for i in {i for k in bad_tris for i in me.loop_triangles[k].vertices}:
        me.vertices[i].co *= 1.006
    me.update()
    me.calc_loop_triangles()
print(f"head check: faces dipping into the head {first_dips}, left {len(bad_tris)}")

# 4c. normals from the full-detail piece: decimation leaves long thin triangles (across a band, say) whose averaged
# vertex normals differ, so shading shows stripes; the full-detail surface's normals keep it smooth
transfer = ob.modifiers.new("normals", "DATA_TRANSFER")
transfer.object = detail
transfer.use_loop_data = True
transfer.data_types_loops = {"CUSTOM_NORMAL"}
transfer.loop_mapping = "POLYINTERP_NEAREST"
bpy.ops.object.modifier_apply(modifier=transfer.name)
bpy.data.objects.remove(detail, do_unlink=True)
me = ob.data
me.calc_loop_triangles()

# 5a. flat dark colour (optional): one uniform colour for the piece's dark texels
if flat > 0:
    dark = painted & ((px[..., :3] @ lum_w) < flat)
    if dark.any():
        px[dark, :3] = np.median(px[dark, :3], 0)
    print(f"flat: {int(dark.sum())} texels darker than {flat} made one colour")

# 5. the paint check: fixes the UVs of unpainted faces, specks and the gutter, then checks again
check_png = os.path.splitext(out)[0] + f"-{name}-paint.png"
px, report = texture_check.check_and_fix(me, px, painted, check_png)
report["faces across a colour edge"] = texture_check.colour_edge_faces(me, px)
print("paint check:", ", ".join(f"{k} {v}" for k, v in report.items()), "->", check_png)
if report["unpainted faces after fix"] or report["specks left"]:
    print("paint check: NOT CLEAN, look at", check_png)

# 6. anime finish (optional): the brightness posterized into evenly spaced bands, white and black included
if bands:
    for y in range(tex_size):
        for x in range(tex_size):
            h, s, v = colorsys.rgb_to_hsv(*px[y, x, :3])
            px[y, x, :3] = colorsys.hsv_to_rgb(h, s, round(v * (bands - 1)) / (bands - 1))
raw = (np.clip(px[::-1], 0, 1) * 255 + 0.5).astype(np.uint8).tobytes()  # top row first, as EditableImage expects
me.calc_loop_triangles()


def export(mesh, flip=False):
    uvl = mesh.uv_layers.active.data if mesh.uv_layers.active else None
    verts, normals, uvs, idx = [], [], [], []
    for lt in mesh.loop_triangles:
        loops = list(lt.loops)[::-1] if flip else lt.loops
        for li in loops:
            loop = mesh.loops[li]
            co = mesh.vertices[loop.vertex_index].co
            n = -loop.normal if flip else loop.normal
            verts += [-co.x, co.z, co.y]
            normals += [-n.x, n.z, n.y]
            if uvl:
                uvs += [round(uvl[li].uv[0], 4), round(1 - uvl[li].uv[1], 4)]
            idx.append(len(idx))
    return {"v": [round(x, 3) for x in verts], "n": [round(x, 3) for x in normals], "t": idx, "uv": uvs}


pieces = json.load(open(out)) if os.path.exists(out) else {}
piece = export(me)
piece.update(color=(255, 255, 255), attachment=attachment, source=os.path.basename(src),
             texture={"size": tex_size, "rgba": base64.b64encode(raw).decode()})
pieces[name] = piece
n_tris = len(piece["t"]) // 3

# outline: the same mesh pushed out along its normals, faces flipped, plain black (an inverted hull)
if outline > 0:
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * outline
    shell = bpy.data.meshes.new(name + "Outline")
    bm.to_mesh(shell)
    bm.free()
    shell.calc_loop_triangles()
    hull = export(shell, flip=True)
    hull.update(color=(10, 10, 12), attachment=attachment, plain=True)
    hull.pop("uv")
    pieces[name + "Outline"] = hull
with open(out, "w") as f:
    json.dump(pieces, f, separators=(",", ":"))
print(f"{name}: {n_tris} tris, texture {tex_size}{', ' + str(bands) + ' bands' if bands else ''}"
      f"{', outline ' + str(outline) if outline else ''}")
