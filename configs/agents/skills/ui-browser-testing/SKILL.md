---
name: ui-browser-testing
description: "Use for browser-driven UI testing: reproduce frontend bugs, verify fixes, collect screenshots/videos, validate PR evidence, and debug browser-only behavior."
disable_model_invocation: true
---

# UI Browser Testing

## Overview

This skill is for systematic UI verification in a real browser. Use `agent-browser` for browser control, but treat this skill as the testing process: define the claim, drive the UI like a user, assert the result, capture clear evidence, and clean up any state you changed.

The core rule is: do not stop at "I clicked through it." A UI test is complete only when the expected behavior has been observed with a focused assertion or unmistakable visual evidence.

## When To Use

Use this for:

- Reproducing frontend bugs.
- Verifying UI fixes in a local dev app, preview deployment, or production-like app.
- Testing interactions that depend on browser state, editor behavior, popovers, menus, drag/drop, uploads, canvas, or responsive layout.
- Producing screenshots or recordings for PRs, issues, or incident follow-up.
- Checking whether a screenshot/video actually proves the claimed behavior.
- Investigating browser-only behavior that unit tests cannot prove.

Do not use this for pure code review, pure API tests, or simple static assertions that can be proven faster with unit tests.

## Bundled Resources

Load these only when needed:

| Resource | When To Load | Purpose |
| --- | --- | --- |
| `references/evidence-and-screenshots.md` | When producing, reviewing, cropping, or selecting UI screenshots/videos | Evidence quality rubric and screenshot/video workflow |
| `references/github-pr-attachments.md` | When attaching screenshots/videos to GitHub PRs/issues without committing media | Browser upload flow, URL extraction, cleanup, and render verification |
| `scripts/crop-screenshot.sh` | When a screenshot needs a focused crop | Deterministic ImageMagick/ffmpeg crop helper with fallback |

## Process

### 1. Define The Claim

Before opening the browser, state the behavior under test in one sentence:

```text
Claim: When X is in state Y and the user does Z, the UI shows/result changes to W.
```

Identify:

- The URL or route.
- Required login/session state.
- Required fixture or existing data.
- The user-visible action sequence.
- The pass condition.
- Any state that must be restored afterward.

If the user gives an already-open tab, start with `agent-browser get url` and work in that session unless it is stuck.

### 2. Choose Evidence Before Interacting

Pick the evidence type that proves the claim:

- **DOM/accessibility assertion:** best for checked state, text, enabled/disabled state, selected tab, URL, count, aria state.
- **Screenshot:** best for visual layout, popovers, styling, canvas, or proof for humans.
- **Video:** best for animation, multi-step interaction, hover/dropdown timing, or PR walkthroughs.
- **Network/console/errors:** useful when UI behavior depends on requests or client exceptions.

Prefer a machine-readable assertion before taking screenshots. A screenshot without a clear visible proof is weak evidence.

### 3. Start Stable

Use the least disruptive browser setup that matches the user request:

```bash
agent-browser get url
agent-browser open <url>
agent-browser wait --load networkidle
agent-browser snapshot -i
```

If deep-linking opens a broken or partial app state, navigate through the normal user entry point instead, such as a dashboard, list page, or login flow.

If auth is required and the user already has a browser tab open, prefer the existing session over creating a new profile or state file.

### 4. Discover Controls

Use `snapshot -i` first. Re-run it after navigation, opening a modal/popover, or major DOM updates because refs become stale.

When `snapshot -i` is too sparse, try:

```bash
agent-browser snapshot -i -C
agent-browser snapshot -s "<stable selector>" -i
agent-browser get text body
```

When snapshots time out on heavy apps, stop retrying the same command. Switch to screenshots, targeted `get` commands, or narrow `eval` checks.

### 5. Interact Like A User

Prefer accessible refs:

```bash
agent-browser click @e12
agent-browser fill @e15 "value"
agent-browser check @e18
agent-browser press Enter
```

Use coordinates only when refs/selectors are unavailable or wrong. If using coordinates:

- Take a screenshot first.
- Click once.
- Immediately verify with a fresh screenshot or assertion.
- Mention that the interaction was coordinate-based in the handoff if it matters.

For editors and custom input surfaces, focus first, then use keyboard commands:

```bash
agent-browser click @editor
agent-browser keyboard type "@"
agent-browser press Enter
```

### 6. Assert The Result

Assert the smallest stable fact that proves the claim. Examples:

```bash
agent-browser get url
agent-browser get text @e5
agent-browser is checked @e7
agent-browser eval '([...document.querySelectorAll("input[type=checkbox]")].map(e => e.checked))'
agent-browser errors
agent-browser console --clear
```

For a passing UI check, record:

- The exact state/action tested.
- The observed result.
- The command or screenshot that proves it.

For a failing UI check, record:

- The expected result.
- The actual result.
- Whether the failure is reproducible after reload or retry.
- Any console errors or failed requests that appeared.

### 7. Capture Human Evidence

For detailed screenshot/video guidance, load `references/evidence-and-screenshots.md`.

Save artifacts in an ignored project artifact directory when one exists, or under `/tmp/ui-browser-testing` otherwise. Do not put proof files in tracked source paths unless the user explicitly asks.

```bash
mkdir -p .dev/prints/<short-task-name>
agent-browser screenshot .dev/prints/<short-task-name>/after.png
agent-browser record start .dev/prints/<short-task-name>/flow.webm <url>
agent-browser record stop
```

Before using a screenshot as proof:

- Open it locally with the image viewer.
- Confirm it visibly shows the behavior, not just the page.
- Crop if the relevant state is too small.
- Avoid annotation overlays unless the user asked for them or refs are the point.

For focused crops:

```bash
scripts/crop-screenshot.sh full.png crop.png <width> <height> <x> <y>
```

Do not commit screenshots, videos, traces, HARs, downloaded files, or temporary state unless the user explicitly asked for committed artifacts.

### 8. PR Or Issue Attachments

For GitHub-specific attachment details, load `references/github-pr-attachments.md`.

When the user wants media in GitHub/GitLab/Linear/etc. but not committed:

1. Upload through the browser attachment flow.
2. Extract the hosted attachment URL.
3. Clear any draft comment used for upload unless the user wanted a comment.
4. Update the PR/issue description with the hosted URL.
5. Reload the page and verify the media renders.

For GitHub image proof, verify rendered dimensions:

```bash
agent-browser eval '([...document.images].map(img => ({ src: img.src, complete: img.complete, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, alt: img.alt })))'
```

### 9. Clean Up

If you changed app data to test:

- Restore it through the UI or API.
- Reload and verify the restored state.
- Mention the restored value in the final response.

If browser automation becomes stuck:

```bash
ps -eo pid,ppid,stat,comm,args | rg 'agent-browser'
pkill -f 'agent-browser' || true
kill -9 <pid>  # only for a stuck agent-browser daemon that ignores normal signals
```

Do not kill the app server, database, or unrelated browser processes unless the user explicitly asks.

Before final response:

```bash
git status --short
```

Confirm no temporary artifacts are staged or accidentally committed.

## Timeout Strategy

Do not keep piling commands onto a stuck browser session.

If a command times out:

1. Check `agent-browser get url`.
2. Try a simple screenshot.
3. If simple commands work, continue with narrower checks.
4. If all commands hang, kill only `agent-browser` and reconnect.
5. If the app itself is rebuilding/loading, wait for the app, then retry from a normal entry route.

If `snapshot -i` times out repeatedly on `DOM.enable`, avoid more snapshots for that page and use screenshot plus targeted `eval` or direct refs from earlier stable snapshots.

If `Runtime.evaluate` times out, make the eval smaller. Avoid broad reads like full `document.body.innerText` in large editor or canvas apps.

## Evidence Quality Bar

Good evidence:

- Shows the exact fixed state or failure.
- Is focused enough that a reviewer can see it without zooming.
- Has a matching assertion or command output when possible.
- Uses stable data names, labels, or URLs.
- Is verified after upload if used in an external system.

Weak evidence:

- Full-page screenshot where the relevant state is tiny or offscreen.
- Screenshot taken before opening the dropdown/modal/state under test.
- Video or image link that does not render in the PR/issue.
- DOM assertion that checks implementation details but not user-visible behavior.
- "It worked" without observed output.

## Final Response Format

Keep the final concise and factual:

```text
Verified <claim> at <url/context>.

Evidence:
- <assertion or command result>
- <screenshot/video path or hosted URL, if relevant>

Cleanup:
- Restored <state>, or no app state was changed.

Notes:
- <blocked checks, timeouts, or residual risk>
```

If the test failed, lead with the failure and include expected vs actual behavior.

## Common Mistakes

- Taking a screenshot that does not actually show the asserted state.
- Forgetting to refresh refs after opening a popover or changing route.
- Treating a passing click sequence as proof without checking the resulting state.
- Leaving modified test data behind.
- Committing generated media artifacts.
- Retrying heavy snapshots after the browser already showed that snapshots are the slow path.
- Uploading media to a PR and not verifying that GitHub renders it.
