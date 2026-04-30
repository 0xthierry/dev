# Evidence And Screenshots

Use this reference when a UI test needs human proof: screenshots, crops, recordings, or visual review.

## Evidence Ladder

Prefer the strongest evidence that fits the claim:

1. **Machine-readable assertion:** URL, text, count, checkbox state, disabled state, selected tab, aria state, network status.
2. **Focused screenshot:** shows the exact visual state after the assertion.
3. **Short recording:** shows a sequence, transition, hover, drag/drop, animation, or timing behavior.
4. **Full-page screenshot:** useful context, but weak if the relevant state is small.

Use more than one layer when reviewers need trust and context: assertion plus focused screenshot is usually enough.

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

## Reviewing Existing Media

When asked whether a screenshot/video proves a fix:

- Open or render it.
- Check whether the target state is visible.
- Check whether the media loaded successfully in the target system.
- Reject ambiguous proof and create a focused replacement.

For screenshots, use dimensions and local viewing. For PR images, verify `naturalWidth` and `naturalHeight` in the browser.
