# Classic clothing stages for one or more outfit folders. Run with:
#   uv run --no-project --with pillow --with numpy python -I <skill>/scripts/clothing.py <stage> <outfit_dir>... [options]
# An outfit folder holds outfit.py (labels and drawing), prompts/{torso,arm,legs}.md (the repaint's Subject lines)
# and optionally concept.png (the reference for materials and colours). Stages, in order:
#   new        copy the example outfit into each (new) folder, to edit
#   guides     outfit.py -> guides/: the code-only shirt.png and pants.png, the three 1536x1024 guide sheets, views.png
#   repaint    the image model repaints each guide sheet into ai/ (codex-image skill); --sheets torso,arm,legs
#   check      each repaint against its guide: canvas size, shift and overlap per colour; PASS or REDO
#   build      final/: the templates from the repaints and views.png (--fuse: keep only their light and shade; --scale N: also @Nx;
#              --code: from the code alone, no repaint)
#   preview    preview/: the textures Roblox's compositor gives each R15 body part, and the Studio steps
#   upload     print the Open Cloud upload commands (dry runs; --creator user:<id> | group:<id>)
import concurrent.futures
import importlib.util
import os
import shutil
import subprocess
import sys

sys.dont_write_bytecode = True  # no __pycache__ folders in the skill or in the game's outfit folders
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)  # python -I leaves the script's folder off the path; outfit.py imports engine and shading

import engine  # noqa: E402

PY = ["uv", "run", "--no-project", "--with", "pillow", "--with", "numpy", "python", "-I"]
SKILLS = os.path.expanduser("~/.agents/skills")
CODEX_IMAGE = f"{SKILLS}/codex-image/scripts/codex-image.ts"
OC = f"{SKILLS}/roblox-open-cloud-api/scripts/oc.ts"
EXAMPLE = os.path.join(os.path.dirname(HERE), "examples", "hoodie")
SHEET_NAMES = ("torso", "arm", "legs")


def load(outfit_dir):
    path = os.path.join(outfit_dir, "outfit.py")
    if not os.path.exists(path):
        sys.exit(f"no {path}: run the `new` stage first, or write it (see the skill's references/outfit-file.md)")
    spec = importlib.util.spec_from_file_location(f"outfit_{abs(hash(path))}", path)
    outfit = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(outfit)
    engine.configure(outfit)
    return outfit


def concept_of(outfit_dir, outfit):
    path = os.path.join(outfit_dir, getattr(outfit, "CONCEPT", "concept.png"))
    return path if os.path.exists(path) else None


def stage_new(outfit_dir, opts):
    if os.path.exists(os.path.join(outfit_dir, "outfit.py")):
        sys.exit(f"{outfit_dir} already has an outfit.py; edit it instead")
    os.makedirs(outfit_dir, exist_ok=True)
    shutil.copy2(os.path.join(EXAMPLE, "outfit.py"), outfit_dir)
    shutil.copytree(os.path.join(EXAMPLE, "prompts"), os.path.join(outfit_dir, "prompts"), dirs_exist_ok=True)
    print(f"wrote {outfit_dir}/outfit.py and prompts/: set the palette, redraw the faces, rewrite each prompt's Subject")


def stage_guides(outfit_dir, opts):
    engine.build(load(outfit_dir), os.path.join(outfit_dir, "guides"), sheets=True)


def stage_repaint(outfit_dir, opts):
    outfit = load(outfit_dir)
    concept = concept_of(outfit_dir, outfit)
    ai = os.path.join(outfit_dir, "ai")
    os.makedirs(ai, exist_ok=True)
    common = open(os.path.join(HERE, "common-prompt.md")).read()
    roles = ("Input images: Image 1: the edit target, the exact layout. Image 2: reference for the outfit's materials "
             "and colours only (do not copy its shapes or framing).\n") if concept else \
        "Input images: Image 1: the edit target, the exact layout.\n"
    sheets = opts.get("sheets", ",".join(SHEET_NAMES)).split(",")

    def one(sheet):
        guide = os.path.join(outfit_dir, "guides", f"guide_{sheet}.png")
        subject = os.path.join(outfit_dir, "prompts", f"{sheet}.md")
        if not os.path.exists(guide):
            return f"{sheet}: no guide at {guide} (run the guides stage; a shirt-only outfit has no legs sheet)"
        if not os.path.exists(subject):
            return f"{sheet}: no prompt at {subject}"
        prompt = os.path.join(ai, f"prompt_{sheet}.md")
        with open(prompt, "w") as f:
            f.write(open(subject).read().strip() + "\n" + roles + common)
        out = os.path.join(ai, f"ai_{sheet}.png")
        if os.path.exists(out):  # keep earlier attempts
            n = 1
            while os.path.exists(os.path.join(ai, f"ai_{sheet}.{n}.png")):
                n += 1
            os.rename(out, os.path.join(ai, f"ai_{sheet}.{n}.png"))
        cmd = ["bun", CODEX_IMAGE, "--prompt-file", prompt, "--ref", guide] + (["--ref", concept] if concept else []) + \
              ["--out", out, "--meta"]
        res = subprocess.run(cmd, capture_output=True, text=True)
        lines = res.stdout.strip().splitlines()
        return f"{sheet}: {lines[-1] if lines else res.stderr.strip()[-300:]}"

    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:  # codex-image: at most two or three at once
        for line in pool.map(one, sheets):
            print(line)


def stage_check(outfit_dir, opts):
    load(outfit_dir)
    ok = engine.check(os.path.join(outfit_dir, "guides"), os.path.join(outfit_dir, "ai"))
    print("all sheets PASS" if ok else "repaint the REDO sheets again (--sheets <name>), after reading the shift")


def stage_build(outfit_dir, opts):
    outfit = load(outfit_dir)
    ai = None if "code" in opts else os.path.join(outfit_dir, "ai")
    engine.build(outfit, os.path.join(outfit_dir, "final"), ai, "fuse" if "fuse" in opts else "direct",
                 int(opts["scale"]) if "scale" in opts else None)


def stage_preview(outfit_dir, opts):
    final = os.path.join(outfit_dir, "final")
    shirt, pants = (os.path.join(final, f"{g}.png") for g in ("shirt", "pants"))
    shirt, pants = (p if os.path.exists(p) else "-" for p in (shirt, pants))
    if shirt == pants == "-":
        sys.exit(f"no templates in {final}: run the build stage")
    subprocess.run(PY + [os.path.join(HERE, "composite.py"), shirt, pants, os.path.join(outfit_dir, "preview")],
                   check=True)
    root, name = os.path.split(os.path.abspath(outfit_dir))
    print(f"""
Serve them (localhost only):  uv run --no-project --with pillow python -I {HERE}/relay.py {root} 8767
In Studio (edit mode), run {HERE}/ClassicPreview.luau once (command bar or the Studio MCP), then:
  local P = _G.ClassicPreview
  P.dress(P.rig("{name}", CFrame.new(0, 5, 0)), "{name}/preview")""")


def stage_upload(outfit_dir, opts):
    creator = opts.get("creator") or os.environ.get("ROBLOX_CREATOR") or "user:<id>"
    name = "".join(w.capitalize() for w in os.path.basename(os.path.abspath(outfit_dir)).replace("-", "_").split("_"))
    for g in ("shirt", "pants"):
        f = os.path.join(outfit_dir, "final", f"{g}.png")
        if os.path.exists(f):
            print(f"bun {OC} upload --file {f} --name {name}_{g.capitalize()} --type Image "
                  f"--description \"{name} classic {g} template\" --creator {creator}")
    print("Dry runs. Each upload is a permanent, moderated asset: add --yes only after the owner agrees. Run from the "
          "game's repository so oc.ts records it in that repository's roblox-uploads.lock.json.")


STAGES = {"new": stage_new, "guides": stage_guides, "repaint": stage_repaint, "check": stage_check,
          "build": stage_build, "preview": stage_preview, "upload": stage_upload}


def main():
    args = sys.argv[1:]
    if len(args) < 2 or args[0] not in STAGES:
        sys.exit("clothing.py <stage> <outfit_dir>... [--sheets torso,arm,legs] [--fuse] [--code] [--scale N] "
                 "[--creator user:<id>]\nstages: " + ", ".join(STAGES))
    stage, dirs, opts = args[0], [], {}
    i = 1
    while i < len(args):
        a = args[i]
        if a in ("--fuse", "--code"):
            opts[a[2:]] = True
        elif a.startswith("--"):
            opts[a[2:]] = args[i + 1]
            i += 1
        else:
            dirs.append(a)
        i += 1
    for d in dirs:
        if len(dirs) > 1:
            print(f"=== {d}", flush=True)
        STAGES[stage](d, opts)


if __name__ == "__main__":
    main()
