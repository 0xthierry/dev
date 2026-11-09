# The repaint: an image model paints the material

Read this before the `repaint` and `check` stages, and when a repaint comes back wrong. The repaint uses the `codex-image` skill (`~/.agents/skills/codex-image/`), which needs `bun` and a `codex` CLI logged in to a ChatGPT plan with image generation. Each image counts against the plan's limits, about a minute each; an outfit takes 3 images, plus redos.

## The guide sheets

`guides` writes three 1536×1024 sheets (4 px per template px). Faces that meet on the body meet on the sheet, so the model paints across the joins:

| Sheet | Holds |
|---|---|
| `guide_torso.png` | Middle row, left to right: the torso's right side, front, left side, back. Above the front: the top. Below the front: the underside |
| `guide_arm.png` | Middle row, left to right: the right arm's inner side, back, outer side, front. Above the front: the top (the left arm is this one mirrored) |
| `guide_legs.png` | Top row: the right leg's inner side, back, outer side, front. Bottom row: the left leg's front, outer side, back, inner side. On the right, the two soles' undersides (right leg above) |

Everything else on a sheet is flat mid grey, which the model is told to leave empty.

**Keep the canvas 1536×1024.** Square sheets came back resized (1254×1254) and shifted by 4–6 template px. This size comes back exactly and aligned within 0–2 px.

## The prompt

The `repaint` stage joins three parts per sheet:
- the outfit's `prompts/<sheet>.md` (one **Subject** paragraph);
- the input-image roles: the guide, plus `concept.png` when there is one;
- the skill's [`scripts/common-prompt.md`](../scripts/common-prompt.md), the shared rules: same canvas, outlines in place, grey stays grey, colours as the guide shows them.

Don't loosen the common prompt or put one outfit's colours in it.

**Write the Subject like this** (see the example's `prompts/`):

- **Say how the sheet is laid out**, in the words of the table above: "in the middle row, from left to right, the right side, the front, the left side and the back…".
- **Name each feature with its colour and its face:** the collar, the buttons, the pockets, the zip, the cuffs, the belt and where its buckle sits.
- **Place prints and embroidery by face and corner:** "a dragon winding from the front face's lower left (the wearer's right hip) up to its upper right (the wearer's left shoulder)". On the front face, the wearer's left is the image's right.
- **Say what continues across faces:** "stripes wrapping the forearm, continuing from face to face".
- **Name the material and finish:** brushed fleece, denim twill, glossy satin, worn leather, brocade. The model paints the sheen from these words.
- **Describe empty areas as empty:** a bare hand, a bare shin, an open neckline ("the grey inside it is empty").
- **Keep the same outfit's three Subjects consistent:** the same colour words and material words on every sheet.

**A concept image** (`concept.png`) gives the model the outfit's materials and colours. Without one, the Subject carries them. A front view of the outfit on a Blocky mannequin works well; `codex-image` can generate one from the outfit's description. The model is told to take only materials and colours from it, never shapes.

## The check

`check` compares each repaint with its guide, at template resolution:
- the canvas size;
- the best shift (−3…+3 px across, −6…+6 down);
- for each area, the empty grey included, its overlap with the guide.

Areas are told apart by the colour the repaint gave them.

- **PASS:** the 1536×1024 canvas, a shift of at most 1 template px, and every area larger than 1% of the sheet overlapping at least 0.6.
- **Read the shift first.** A shift of 2 px or more is misalignment: repaint that sheet (`repaint <dir> --sheets legs`).
- **A REDO with no shift** comes from low overlap. It usually means the model changed a colour or covered an area with a print (gold embroidery reads as a gold belt's colour). Look at the repaint before redoing it: the check sees positions, not taste.
- **Small areas** (under 1%: buttons, zip, drawstrings) are listed for information; they never fail a sheet.
- **Merged areas** are listed together (`sole+lace`): colours too close to tell apart are one area.
- **"flat grey left inside cloth"** fails a sheet: on some face, the model left more than 0.5% of its empty grey inside cloth where `GREY_FILL` won't replace it, so the template would show it. Set `GREY_FILL = "any"`, or repaint the sheet.
- The legs are realigned on their soles before the check (`REGISTER_LEGS`), as the build does.

Then **look at every repaint yourself**, ideally on the body (Studio preview). The model may improve small details on its own (gathered ankles, a fuller cuff, real zip teeth); keep them if they look right.

## How the build takes the repaint in

- **Its pixels are used as they are,** except that each big area's median colour is brought to the palette (gain 0.7–1.4 per channel), so the three sheets agree on colour.
- **Flat mid grey** the model left inside a face (by default within 6 px of its borders, `GREY_FILL`) is replaced with that area's own repaint colour, shaded like the code. Cloth near grey (every channel 64–191) and areas the repaint made grey as a whole are never replaced.
- **`CODE_LABELS`** areas take the code's pixels.
- **The left arm** is the right arm's repaint mirrored.
- **The legs** are remapped row by row so each sole band lands back on its rows (`REGISTER_LEGS`).

## What went wrong before, and the fix now built in

| Symptom | Cause | Fix |
|---|---|---|
| The repaint is 1254×1254 or shifted 4–6 px | The guide wasn't 1536×1024 | Keep `engine.SHEETS` at 384×256 template px |
| The legs come back squeezed vertically (a 10-row sole as 7 rows) | The model's habit on the legs sheet | `REGISTER_LEGS`: give the shoes a contrasting band at the bottom. Bare shins, light leg wraps or light trousers can look like soles; the search takes only a band 3–20 rows tall that ends within 12 rows of the leg's end, and otherwise leaves the leg as it is |
| Grey patches or a grey strip inside a face (often beside an empty area of the sheet) | The model painted its "empty" grey into the cloth | `GREY_FILL` (`check` reports what it leaves; `"any"` covers whole faces). Give mid-grey embroidery a tint, or set `GREY_FILL = "off"` for an outfit painted in greys |
| A mark on one sleeve appears on both, or on neither | The repaint sees only the right arm | Draw it on the left limb after `garment()`, and list its label in `CODE_LABELS` |
| A one-sided detail appears on both limbs | It was drawn before mirroring | Draw it on `garment["left"]` after `garment()` returns |
| The three sheets disagree on a colour | Each repaint drifts on its own | Automatic (`NORMALIZE`); for stubborn drift, `build --fuse` |
| Logos, text or extra objects appear | The model invents | The common prompt forbids them; name what *is* there precisely in the Subject, and repaint the sheet |

## Running many outfits

Run one outfit at a time with its three sheets in parallel (`repaint` already does). `codex-image` allows two or three runs at once. Pass several folders to any stage (`clothing.py repaint outfits/*`); they run one after another.
