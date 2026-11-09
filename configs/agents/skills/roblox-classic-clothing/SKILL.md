---
name: roblox-classic-clothing
description: >-
  Make Roblox classic clothing (Shirt and Pants templates, 585x559 PNG) for any game: lay the outfit out in code on the
  R15 template, bake painted depth into it (the "3D effect": light, occlusion, seams, folds, raised pieces), have an
  image model repaint the material on aligned guide sheets, check the alignment, build the templates, preview them on
  the body in Studio without uploading, and upload them with Open Cloud. Also NPC heads: a head that is Roblox's
  default head without its eye discs, faces as flat textures, and head pieces (hair, hats, masks, bands) made from any
  reference supplied or described by the owner: painted onto a render of the head, made 3D by Tripo, fitted and paint-checked, then
  previewed and worn (morph pads) in Studio. Use when a task asks for game outfits, uniforms, NPC clothes or heads,
  faces, hair or head pieces for characters, shop clothing, a shirt or pants template, or more content in that style.
  Not for layered clothing or publishing items to the avatar marketplace.
---

# Make Roblox classic clothing and NPC heads

Turn an outfit idea into a Roblox Shirt and Pants pair: two 585×559 PNGs that dress any R15 Blocky, Man or Woman body (and R6). The layout and the depth are drawn in code, so every edge lands on the right row of the body. An image model then repaints the material on top, so the result looks hand-painted. The method is game-neutral. Each outfit is a folder with its own `outfit.py`, prompts and results.

The scripts are in this skill's `scripts/`; run them with Python through `uv`:

```bash
uv run --no-project --with pillow --with numpy python -I ~/.agents/skills/roblox-classic-clothing/scripts/clothing.py <stage> <outfit_dir>... [options]
```

Called `clothing.py` below. Stages: `new`, `guides`, `repaint`, `check`, `build`, `preview`, `upload`.

## Before the first outfit

- **Is classic right for this game?** Classic clothing shows only on bodies laid out for it: Blocky, Man, Woman, R6. UGC bodies (Anime styles) and some Rthro bodies show **nothing**. If players keep their own avatars, settle which bodies they get (avatar settings or a `StarterCharacter`) with the owner, or plan another way to dress the rest. See [template and body](references/template-and-body.md#bodies-that-show-classic-clothing).
- **Tools:**
  - `uv` (Python with Pillow and NumPy) for everything.
  - The `codex-image` skill for the repaint and concept images (it uses the owner's ChatGPT plan; about a minute per image).
  - The Studio MCP for the preview.
  - The `roblox-open-cloud-api` skill for uploads.
  - For heads: Blender 5 on the command line (`blender -b`), Rojo, and Tripo in the owner's browser (the `playwriter` skill).

  Without `codex-image`, the outfit can still be built from code alone (`build --code`).
- **Where outfits live:** in the game's repository, e.g. `tools/clothing/outfits/<id>/`. Keep `outfit.py`, `prompts/`, `concept.png` and `ai/` under version control: the repaints can't be regenerated identically.

## Make an outfit

1. **Describe it.** Write down, in the owner's words: the garments; the colours; the materials; every visible feature (collar, buttons, zip, pockets, belt, cuffs, trims, shoes, prints) and on which side of the body it sits; the back. If the request leaves the look open, ask instead of inventing a style. Optionally make `concept.png`, a front view on a Blocky mannequin, with `codex-image`.
2. **Scaffold:** `clothing.py new <outfit_dir>` copies the example (a zip hoodie, jeans and sneakers) to edit. For bare skin with muscles (a shirtless fighter), copy [`examples/fighter`](examples/fighter/outfit.py) instead.
3. **Write `outfit.py`:** a `PALETTE` of named colour areas and the drawing of each face.
   - Read [template and body](references/template-and-body.md) for the rows, the hidden areas and the mirroring.
   - Read [the outfit file](references/outfit-file.md) for the API and the settings.
   - Read [the 3D effect](references/shading.md) for the shading every face needs.
   - Reuse the example's structure: row constants, one function per kind of face, a shading pass on each.
4. **Guides:** `clothing.py guides <outfit_dir>`, then look at `guides/views.png` (front, right side, back, left side) and the three `guides/guide_*.png`. Check:
   - every shape the outfit needs is drawn and in place;
   - bands meet at the corners;
   - nothing one-sided appears on both sides;
   - the shading has no hard steps;
   - each label's shading class (printed by `guides`) suits it.

   Fix `outfit.py` and repeat until the code-only result is right. The repaint keeps positions; it can't fix them.
5. **Prompts:** rewrite `prompts/torso.md`, `arm.md` and `legs.md`, one Subject paragraph each, following [the repaint guide](references/ai-repaint.md#the-prompt). A Shirt-only outfit needs no `legs.md`; a Pants-only one needs only `legs.md`.
6. **Repaint:** `clothing.py repaint <outfit_dir>` makes 3 images in parallel into `ai/`. Open each and compare it with its guide. Redo one sheet with `--sheets legs`; earlier attempts are kept as `ai_<sheet>.<n>.png`.
7. **Check:** `clothing.py check <outfit_dir>`.
   - **PASS** means aligned.
   - **On REDO, read the shift first:** 2 px or more is misalignment, so repaint that sheet. A REDO with no shift is a colour or print change; judge it by eye.
   - **"flat grey left inside cloth"** means the model left its empty grey where the template would show it. Set `GREY_FILL = "any"` or repaint the sheet.
8. **Build:** `clothing.py build <outfit_dir>` writes `final/shirt.png`, `final/pants.png` and `final/views.png`. Look at `views.png`.

   It shows the faces flat, at their template rows, with no lighting and none of the rows the body hides. Judge sleeve, hem and sock lengths by the [row table](references/template-and-body.md#the-bodys-rows) and in Studio.
   - `--fuse` keeps only the repaint's light and shade on the palette colours.
   - `--code` skips the repaint.
9. **Preview in Studio** (recommended before any upload): `clothing.py preview <outfit_dir>`, then the relay and `ClassicPreview.luau` steps it prints ([preview](references/preview-and-upload.md#preview-without-uploading)). Ask before adding preview rigs to the owner's game place; delete the `ClassicPreview` folder afterwards.
10. **Upload, only with the owner's OK:** `clothing.py upload <outfit_dir> --creator user:<id>` prints dry-run commands. Show them, run them with `--yes` after the owner agrees, from the game's repository, and record the IDs ([upload](references/preview-and-upload.md#upload-the-owners-ok-first)).

Several outfits: pass several folders to any stage (`clothing.py check outfits/*`). Make the first one completely before batching; it fixes the palette, the structure and the prompts the others copy.

## Make a character's head

Encourage recognizable franchise characters, especially anime characters familiar to the game's child audience, when they fit the game's theme. The owner's design goal is to strengthen recognition and the fantasy of playing as familiar characters. Preserve the chosen character's signature hair, face markings, colours and accessories when adapting it to Roblox; follow an explicit request for an original design when given.

Clothes dress the body; the head is its own work. Read [heads](references/heads.md) first. In short:
1. **The head:** fetch Roblox's reference file once, then `scripts/heads/npc_head.py export`. That is Roblox's default head without the eye discs that show through any face.
2. **Faces:** one transparent image per expression, from [`prompts/face.md`](scripts/heads/prompts/face.md) (eyes at 42% of the height, mouth at 68%).
3. **Pieces from the owner's reference** (concept art, a sketch, a photo, a character, a description):
   1. `npc_head.py render` makes a render of our head with a simple face.
   2. `codex-image` paints the piece onto it from the reference, with [`prompts/piece-on-head.md`](scripts/heads/prompts/piece-on-head.md).
   3. Tripo makes it 3D (HD model, 20,000 polygons).
   4. `scripts/heads/fit_on_head.py` fits it to our head and runs the paint check. A clean run ends at 0 unpainted faces and 0 specks.
4. **Preview, Play and morph:** copy [`scripts/heads/lab/`](scripts/heads/lab/) into the game repository, `pack.py`, `rojo build`, then `H.npc(...)` in edit mode. In Play, a pad in front of each NPC turns the player into it.
5. **Into the game:** upload faces as Images and the head and pieces as meshes, only with the owner's OK.

## Rules that hold in every game

- **The layout comes from the code.** The image model repaints; it never places. A shape the outfit needs must be in the guide, at its place.
- **Hands transparent** (arm rows 108–128) unless the outfit has gloves. **Sole undersides dark.**
- **Off-white, not pure white:** about (244, 243, 238); Roblox's light greys white cloth.
- **585×559 is the resolution limit.** A 2× upload renders the same.
- **Read at 20 studs:** identity by colour blocks and big shapes; lines at least 2 template px.
- **Draw limbs as the right limb.** Draw one-sided details after `engine.garment()` mirrors it; keep one-sided arm details with `CODE_LABELS`.
- **Classic can't shape cloth off the body** (long hems, hanging sleeves): paint those shapes on the box.
- **Bare skin goes in a `SKIN` label:** its shading becomes see-through and works on every skin tone ([muscles](references/shading.md#muscles-and-see-through-skin)). A skin colour painted in would only match one tone.
- **Uploads are permanent** and need the owner's explicit OK; never handle the Open Cloud API key.

## Done

The outfit is done when:
- `final/shirt.png` and `final/pants.png` exist;
- `check` passed, or each REDO was looked at and accepted for a stated reason;
- you have looked at `views.png`, and at the Studio preview when Studio was available.

Report:
- the outfit folder and the final paths;
- the check results;
- what you looked at, and what you could not check (no Studio, no image model);
- any upload IDs and where they were recorded, or that nothing was uploaded.

Show the owner `views.png` or a Studio screenshot.
