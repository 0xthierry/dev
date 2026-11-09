# Our NPC head: Roblox's default head without its eyes. Roblox's dynamic-head reference file BlockyCharacter.fbx holds
# the default R15 head (same size and shape as the one in Studio, measured to within 0.01 studs). It is a closed, smooth
# shell with two eye discs floating just in front of it and teeth and a tongue inside it; the shell alone is our head.
# It is scaled to the rig's head (the default head under BodyTypeScale 0.3) and takes the face by a flat projection
# onto its front, like a face image drawn for the front of the head.
#   blender -b --factory-startup --python npc_head.py -- export <pieces.json>
#       adds "NpcHead" (per-corner vertices, normals, UVs in Roblox head space) for HeadLab.npcHead
#   blender -b --factory-startup --python npc_head.py -- render <out.png> [face=1]
#       the reference image an image model paints a piece onto (our head on a short neck, three-quarter view)
# fit_on_head.py imports it for the head a generated piece is fitted to. Needs Roblox's reference file at
# $NPC_HEAD_FBX or build/heads-lab/reference/BlockyCharacter.fbx (run from the game repository's root):
#   curl --create-dirs -o build/heads-lab/reference/BlockyCharacter.fbx \
#       https://prod.docsiteassets.roblox.com/assets/avatar/dynamic-heads/reference-files/BlockyCharacter.fbx
# Head space as everywhere in heads-lab: Blender +X the wearer's left, -Y the front, Z up, head centre at 0.
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

# Roblox's reference file, from the environment or the game repository's build folder (commands run from its root)
FBX = os.environ.get("NPC_HEAD_FBX") or os.path.abspath(os.path.join("build", "heads-lab", "reference", "BlockyCharacter.fbx"))
RIG = Vector((1.1590, 1.1606, 1.1820))  # the rig's head in Studio (width, depth, height): Size, not OriginalSize
SKIN = (0.62, 0.36, 0.24, 1.0)
GRID = 18  # quads per cube side when resampling the shell: 6 x 18 x 18 quads, ~3,900 triangles


def shell_mesh() -> bpy.types.Mesh:
    """The head shell from the reference file as a new mesh: centred on its bounds, scaled to RIG, smooth."""
    if not os.path.exists(FBX):
        sys.exit(f"missing {FBX}: download it first (see the top of npc_head.py)")
    before_obj, before_act = set(bpy.data.objects), set(bpy.data.actions)
    bpy.ops.import_scene.fbx(filepath=FBX)
    new = [o for o in bpy.data.objects if o not in before_obj]
    src = next(o for o in new if o.type == "MESH" and o.name.startswith("Head_Geo"))
    bm = bmesh.new()
    bm.from_mesh(src.data)
    bm.transform(src.matrix_world)
    bm.verts.ensure_lookup_table()
    # the largest connected part is the shell; the eye discs, teeth and tongue are parts of their own
    seen, shell = set(), set()
    for v in bm.verts:
        if v in seen:
            continue
        part, stack = {v}, [v]
        seen.add(v)
        while stack:
            x = stack.pop()
            for e in x.link_edges:
                w = e.other_vert(x)
                if w not in seen:
                    seen.add(w)
                    part.add(w)
                    stack.append(w)
        if len(part) > len(shell):
            shell = part
    index = {v: i for i, v in enumerate(v for v in bm.verts if v in shell)}
    pts = [v.co.copy() for v in index]
    faces = [[index[v] for v in f.verts] for f in bm.faces if f.verts[0] in shell]
    bm.free()
    for o in new:  # leave nothing of the import behind
        data, kind = o.data, o.type
        bpy.data.objects.remove(o, do_unlink=True)
        if data is not None and data.users == 0 and kind in ("MESH", "ARMATURE"):
            (bpy.data.meshes if kind == "MESH" else bpy.data.armatures).remove(data)
    for a in set(bpy.data.actions) - before_act:
        bpy.data.actions.remove(a)
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    centre, span = (lo + hi) / 2, hi - lo
    pts = [Vector(((p - centre).x * RIG.x / span.x, (p - centre).y * RIG.y / span.y, (p - centre).z * RIG.z / span.z)) for p in pts]
    # The shell's lips close over a mouth cavity inside the head; smooth shading shows the slit as a line across our
    # faces. So its outer surface is resampled: a cube of GRID x GRID quads per side, each vertex cast onto the shell
    # from outside (the outermost of a few nearby rays, so none slips into the slit). Within ~0.001 studs of the shell.
    bvh = BVHTree.FromPolygons(pts, faces)
    me = bpy.data.meshes.new("NpcHead")
    bm = bmesh.new()
    for axis in range(3):
        for sign in (-1, 1):
            grid = {}
            for i in range(GRID + 1):
                for j in range(GRID + 1):
                    a, b = -1 + 2 * i / GRID, -1 + 2 * j / GRID
                    c = [a, b]
                    c.insert(axis, sign)
                    d = Vector(c).normalized()
                    side = d.orthogonal().normalized()
                    up = d.cross(side)
                    reach = 0.0
                    for o in (Vector(), side * 0.003, -side * 0.003, up * 0.003, -up * 0.003):
                        hit = bvh.ray_cast(d * 3 + o, -d)
                        if hit[0] is not None:
                            reach = max(reach, hit[0].dot(d))
                    grid[i, j] = bm.verts.new(d * reach)
            for i in range(GRID):
                for j in range(GRID):
                    quad = [grid[i, j], grid[i + 1, j], grid[i + 1, j + 1], grid[i, j + 1]]
                    bm.faces.new(quad if (sign > 0) != (axis == 1) else quad[::-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    me.update()
    return me


def surface(me: bpy.types.Mesh) -> BVHTree:
    return BVHTree.FromPolygons([v.co for v in me.vertices], [tuple(p.vertices) for p in me.polygons])


def export(out: str):
    """The head as a HeadLab piece: unshared corners in Roblox head space (X = -x, Y = z, Z = y). Triangles on the front
    take a face image spanning the head's front by a flat projection; the rest sample its corner (skin, once baked)."""
    me = shell_mesh()
    me.calc_loop_triangles()
    verts, normals, uvs, idx = [], [], [], []
    for lt in me.loop_triangles:
        corners = [me.vertices[me.loops[li].vertex_index].co for li in lt.loops]
        front = sum(c.y for c in corners) / 3 < -0.15
        for li in lt.loops:
            co, n = me.vertices[me.loops[li].vertex_index].co, me.loops[li].normal
            X, Y, Z = -co.x, co.z, co.y
            verts += [X, Y, Z]
            normals += [-n.x, n.z, n.y]
            uvs += [0.5 + X / RIG.x, 0.5 - Y / RIG.z] if front else [0.002, 0.002]
            idx.append(len(idx))
    pieces = json.load(open(out)) if os.path.exists(out) else {}
    pieces["NpcHead"] = {"v": [round(x, 4) for x in verts], "n": [round(x, 3) for x in normals], "t": idx,
                         "uv": [round(x, 4) for x in uvs], "head": True, "color": (255, 255, 255),
                         "size": [round(RIG.x, 4), round(RIG.z, 4), round(RIG.y, 4)], "source": os.path.basename(FBX)}
    with open(out, "w") as f:
        json.dump(pieces, f, separators=(",", ":"))
    print(f"NpcHead: {len(idx) // 3} triangles, size {tuple(round(c, 4) for c in RIG)} -> {out}")


def material(name, colour):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = colour
    b.inputs["Roughness"].default_value = 0.5
    return m


def face_marks(head_obj, bvh):
    """A simple face where our face images put it (eyes at 42% of the height, mouth at 68%), laid on the surface,
    so an image model knows the eye line (a blindfold or mask then lands on the eyes)."""
    ink = material("FaceInk", (0.02, 0.02, 0.02, 1.0))
    marks = []
    for name, x, z, rx, rz in (("Face_EyeL", 0.19, 0.10, 0.045, 0.075), ("Face_EyeR", -0.19, 0.10, 0.045, 0.075),
                               ("Face_Mouth", 0.0, -0.20, 0.10, 0.018)):
        bm = bmesh.new()  # a fan of small triangles, every vertex laid on the curved surface
        bmesh.ops.create_circle(bm, cap_ends=True, cap_tris=True, segments=24, radius=1.0)
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=3, use_grid_fill=True)
        for v in bm.verts:
            px, pz = x + v.co.x * rx, z + v.co.y * rz
            hit = bvh.ray_cast(Vector((px, -3, pz)), Vector((0, 1, 0)))
            v.co = Vector((px, hit[0].y - 0.002, pz))
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        me.materials.append(ink)
        marks.append(bpy.data.objects.new(name, me))
    return marks


def render(out: str, with_face: bool = True):
    """The reference render (the setup of the earlier HeadRef scene): EEVEE, 1024 square, a 70 mm camera from the
    wearer's front right, one sun, a light grey world."""
    scene = bpy.data.scenes.new("NpcHeadRef")
    if bpy.context.window:
        bpy.context.window.scene = scene
    me = shell_mesh()
    head = bpy.data.objects.new("NpcHead", me)
    skin = material("HeadSkin", SKIN)
    me.materials.append(skin)
    scene.collection.objects.link(head)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=32, radius1=0.28, radius2=0.28, depth=0.35)
    neck_me = bpy.data.meshes.new("Neck")
    bm.to_mesh(neck_me)
    bm.free()
    neck_me.materials.append(skin)
    neck = bpy.data.objects.new("Neck", neck_me)
    neck.location = (0, 0, -0.72)
    scene.collection.objects.link(neck)
    if with_face:
        for o in face_marks(head, surface(me)):
            scene.collection.objects.link(o)
    cam = bpy.data.objects.new("RefCam", bpy.data.cameras.new("RefCam"))
    cam.data.lens = 70
    cam.location, cam.rotation_euler = (-2.6, -5.0, 1.6), (1.302, 0.0, -0.48)
    scene.collection.objects.link(cam)
    scene.camera = cam
    sun = bpy.data.objects.new("Key", bpy.data.lights.new("Key", "SUN"))
    sun.data.energy = 1.6
    sun.rotation_euler = (0.873, 0.0, -0.524)
    scene.collection.objects.link(sun)
    world = bpy.data.worlds.new("RefWorld")
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs[0].default_value, bg.inputs[1].default_value = (1, 1, 1, 1), 0.55
    scene.world = world
    try:
        scene.render.engine = "BLENDER_EEVEE"
    except TypeError as e:
        print("engine:", e)
    scene.render.resolution_x = scene.render.resolution_y = 1024
    scene.view_settings.view_transform = "Standard"
    scene.render.filepath = out
    bpy.ops.render.render(write_still=True, scene=scene.name)
    print("rendered", out)


if __name__ == "__main__" and "--" in sys.argv:
    args = sys.argv[sys.argv.index("--") + 1:]
    if args[0] == "export":
        export(os.path.abspath(args[1]))
    elif args[0] == "render":
        render(os.path.abspath(args[1]), len(args) < 3 or args[2] != "0")
