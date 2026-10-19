---
name: codex-image
description: Generate one raster image, or edit one from reference images, with OpenAI image generation through the Codex CLI on the user's ChatGPT subscription (no API key), and save it as a PNG at a chosen path. Use when a task needs a generated or edited bitmap such as concept art, product shots, illustrations, textures, sprites, mockups, a cutout on a transparent background, or a variant of a reference image. Not for SVG/vector work, diagrams or charts better drawn in code, or API-billed image generation.
---

# Generate one image with Codex

Produce one PNG at the path the task needs. Codex's built-in image tool makes it, and it counts against the ChatGPT plan, not an API key. One run makes one image: run again for each further image or variant.

If you are Codex and your session has the built-in `image_gen` tool, call it directly and follow Codex's own `imagegen` skill. This skill is for other agents and for scripts.

## Before the first image

- `codex` must be on `PATH` and logged in with a ChatGPT plan that includes image generation. If a run fails on authentication, ask the user to run `codex login`; do not try to log in for them.
- `bun` must be on `PATH`.
- Images use the plan's Codex limits about 3-5 times faster than other Codex work, then paid credits if the user enabled them; the Free plan has no image generation (OpenAI Codex pricing page, read 2026-10-17). Generate what the task needs, not speculative variants.

## Generate

1. Write the prompt (next section).
2. Run, from the project folder:
   ```bash
   bun ~/.agents/skills/codex-image/scripts/codex-image.ts --prompt "<prompt>" --out <path>.png
   ```
   | Option | Use |
   | --- | --- |
   | `--prompt-file <file>` | Long prompts, instead of `--prompt` |
   | `--ref <image>` | Attach an image as an edit target or reference; repeat for several |
   | `--transparent` | Ask for a transparent background; the run fails unless the PNG has an alpha channel |
   | `--meta` | Also write `<out>.json`: prompt, references, size, timing |
   | `--tries <n>` / `--timeout <s>` | Retries (default 3) and seconds per try (default 600) |
   | `--model` / `--effort` | Override the Codex model that drives the tool; the image model itself cannot be chosen |
   | `--dry-run` | Print the Codex command without running it |
3. Read the one-line JSON result. `"ok": true` means the PNG exists at `out`, with `width`, `height` and `alpha`. `"ok": false` means read **Failures**.
4. Open the image with your image-viewing tool and check it against the prompt: subject, composition, style, constraints, and any text letter by letter. A saved file is not proof that it shows what was asked.
5. If it is wrong, change one thing in the prompt and run again.

`--out` overwrites an existing file. To keep the earlier image, write the new one to a sibling name such as `hero-v2.png`. Parent folders are created.

## Write the prompt

Use the labelled spec from Codex's `imagegen` skill, keeping only the lines that help:

```text
Use case: <product-mockup | stylized-concept | illustration-story | background-extraction | style-transfer | ...>
Asset type: <where the image will be used>
Primary request: <the main ask>
Input images: Image 1: <edit target | reference>; Image 2: <role>
Subject / Style/medium / Composition/framing / Lighting/mood / Color palette / Materials/textures
Text (verbatim): "<exact text>"
Constraints: <what must stay / what must not appear>
Avoid: <negative constraints>
```

- The tool has no size, aspect-ratio, quality or seed setting. State orientation in words. Observed outputs: 1254x1254 for "square, 1024 x 1024", and 1536x1024 or 1774x887 for wide requests. If exact pixels matter, resize or crop afterwards.
- With `--ref`, give each image its role by index. For an edit, list what must not change: "change only the background; keep the product and its edges unchanged".
- For a set that must share one style, reuse the same reference image and the same prompt template on every run. No seed exists, so wording and references are the only consistency controls.
- For a cutout, pass `--transparent` and also write "on a fully transparent background" in the prompt. Observed: the subject's alpha is 250-254, never 255, and the background is 0. If the consumer needs fully opaque pixels, set alpha of 250 and above to 255.
- For text in the image, quote it exactly and spell unusual words letter by letter. Check the result; image text can still come out wrong.

## How the script works

It runs `codex exec --json --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check` inside a new empty temporary folder, with stdin closed and each `--ref` attached with `--image`. Codex calls its image tool, which stores the image under `$CODEX_HOME/generated_images/<thread_id>/`, and copies it into the temporary folder. If Codex skips the copy, the script finds the file through the `thread_id` in the JSONL events. The script then checks the PNG signature, its size, and alpha when `--transparent` was given, and copies it to `--out`.

- Bypass mode lets the Codex agent run commands without approval or sandbox. The empty working folder keeps it out of the project, but it still runs as the user. Never put secrets in the prompt. Reference images are uploaded to OpenAI.
- A run took 35-56 s in tests (2026-10-17 to 2026-10-19). Run at most two or three at once; each run is a separate Codex session against the same plan limits.

## Failures

| Result | Action |
| --- | --- |
| Exit 2, `"error"` names an argument | Fix the command: `--out` must end in `.png`, references must exist |
| `codex CLI not found on PATH` | Report it; the user installs Codex |
| `no image saved` after all tries | Read `attemptN.log` in the `logs` folder from the result. Expired login: ask the user to run `codex login`. Usage limit reached: stop and report it. Refusal: rephrase only within the user's intent, otherwise report it |
| `not a PNG` | Retry once; if it repeats, report the file path from the error |
| `no alpha channel` | The tool ignored the transparency request. Retry with the transparent background stated first in the prompt |

Exit codes: 0 saved, 1 failed after all tries, 2 bad arguments.

## Done

The PNG is at `--out`, you have looked at it, and it matches the request. Report the path, the pixel size, the prompt used, and anything that differs from the request. When the run failed, report the error and the logs folder instead of an image.
