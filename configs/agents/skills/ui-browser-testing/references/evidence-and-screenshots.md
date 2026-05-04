# Evidence And Screenshots

Use this reference when a UI test needs human proof: screenshots, crops, recordings, or visual review.

Human media is evidence only when it is tied to a case and an observed result. For QA or PR validation, a screenshot/video should be part of an evidence packet, not a standalone claim.

## Evidence Ladder

Prefer the strongest evidence that fits the claim:

1. **Machine-readable assertion:** URL, text, count, checkbox state, disabled state, selected tab, aria state, network status.
2. **Focused screenshot:** shows the exact visual state after the assertion.
3. **Short recording:** shows a sequence, transition, hover, drag/drop, animation, or timing behavior.
4. **Full-page screenshot:** useful context, but weak if the relevant state is small.

Use more than one layer when reviewers need trust and context: assertion plus focused screenshot is usually enough.

For branch or PR QA, every case should have either:

- A machine-readable assertion artifact that names the case, action, expected result, observed result, and pass/fail state.
- A screenshot or video that visibly shows the same named case.
- Network or side-effect evidence when the claim depends on a request being sent, blocked, retried, or absent.

Do not upload a video as "proof the feature works" without the case matrix or assertion data that says which permutations it covers.

## Screenshot Workflow

1. Put the UI into the exact state under test.
2. Assert the state with `agent-browser get`, `agent-browser is`, or targeted `agent-browser eval` when possible.
3. Capture a screenshot.
4. View the image locally.
5. If the important state is small or ambiguous, crop it.
6. Re-view the crop.
7. Use the crop in PRs/issues when it is clearer than the full screenshot.

Good screenshot names describe the state, not the action:

```text
before-fields-unchecked.png
after-fields-checked.png
dropdown-open-selected-state.png
mobile-menu-overlap.png
```

## What Good Visual Proof Shows

Good proof:

- Shows the exact UI state named in the claim.
- Keeps the relevant element large enough to inspect without zooming.
- Includes enough surrounding context to identify the screen.
- Avoids unrelated panels, blank whitespace, or debug overlays.
- Uses stable labels, data, or URLs when available.

Weak proof:

- The dropdown/modal/hover state is closed.
- The target element is offscreen or too small.
- The image is annotated but the underlying UI state is not visible.
- It shows only that a page loaded, not that the behavior works.
- It relies on the viewer knowing where to look.

## Cropping

Use the bundled helper from the skill directory:

```bash
scripts/crop-screenshot.sh full.png crop.png 610 430 500 215
```

Arguments are:

```text
input output width height x y
```

If working outside the skill directory, call the absolute script path.

Manual fallback:

```bash
magick full.png -crop 610x430+500+215 +repage crop.png
```

If ImageMagick is unavailable:

```bash
ffmpeg -y -i full.png -vf "crop=610:430:500:215" crop.png
```

## Recordings

Use a recording when the proof depends on sequence:

```bash
agent-browser record start /tmp/ui-browser-testing/flow.webm <url>
# interact
agent-browser record stop
```

Keep recordings short. Start as close to the relevant interaction as possible and stop immediately after the result is visible.

For QA permutations, record one short clip per meaningful case when possible. A single long video is harder to review and often hides whether blocked states, recovery, or alternate routes were actually tested.

Name recordings by case:

```text
v3-stable-run-baseline.webm
v3-create-draft-pending-guard.webm
v3-update-draft-pending-guard.webm
legacy-v2-creating-draft-state-guard.webm
```

After recording, pair each file with its assertion JSON or manifest entry. If a case is a guard, disabled state, debounce, or permission check, the video must be accompanied by a network assertion showing the forbidden request or mutation did not occur.

## Evidence Packet

For multi-case validation, use a stable artifact layout:

```text
/tmp/ui-browser-testing/<task>/
  assertions/
    <case>.json
  videos/
    <case>.webm
  screenshots/
    <case>-after.png
  manifest.json
```

Generate the manifest from assertion files:

```bash
bun scripts/qa-manifest.ts /tmp/ui-browser-testing/<task> /tmp/ui-browser-testing/<task>/manifest.json
```

Before handing off or uploading, verify:

- Manifest case count matches the QA matrix.
- Every passing case has an assertion and either visual evidence or a reason visual proof is unnecessary.
- Every blocked-action case includes absence-of-request or absence-of-mutation evidence.
- Every uploaded media URL maps to a specific case.

## Reviewing Existing Media

When asked whether a screenshot/video proves a fix:

- Open or render it.
- Check whether the target state is visible.
- Check whether it maps to a named QA case and expected result.
- Check whether the media loaded successfully in the target system.
- Reject ambiguous proof and create a focused replacement.

For screenshots, use dimensions and local viewing. For PR images, verify `naturalWidth` and `naturalHeight` in the browser.
