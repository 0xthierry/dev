# Branch And PR QA

Use this reference when UI testing a branch, PR, feature, fix, release candidate, or request for "all permutations". The goal is not to prove one happy path. The goal is to understand the product change and validate the behaviors it creates, blocks, or could regress.

## QA Mindset

Start from product impact:

- What can a user do now that they could not do before?
- What existing workflow must still work?
- What new guard, blocked state, validation, permission, or error path was introduced?
- What race condition, async state, stale data, or double-submit risk does the change imply?
- What legacy or alternate surface still calls the changed logic?
- What state must recover after loading, saving, cancelling, retrying, or navigating?

Do not treat "I clicked the button" or "the UI looked right" as complete evidence. A QA pass must connect the user action to an observed UI state and, when relevant, to the expected network request, storage change, console state, or absence of side effect.

## Diff To Test Matrix

For branch or PR validation, inspect the diff before opening the browser:

```bash
git diff --stat origin/main...HEAD
git diff --name-only origin/main...HEAD
git diff --unified=80 origin/main...HEAD -- <relevant-ui-files>
```

Use `rg` to find consumers and alternate surfaces for changed functions, props, events, composables, stores, feature flags, and API calls.

Build a matrix with these columns:

| Case | Surface / route | Precondition | User action | Expected UI | Expected side effect | Evidence | Cleanup |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Happy path | Main changed workflow | Stable saved state | Primary action | Success/running/result state | Required request sent with expected payload | Assertion + video/screenshot | Restore created data |
| Guard path | Same surface | Pending/invalid/unauthorized state | Try blocked action | Disabled/error/no-op state | Forbidden request is not sent | DOM + network assertion | Release pending state |
| Recovery | Same surface | Guard state clears | Wait/retry/action again | Control re-enables | Request can be sent again if action is allowed | DOM + network assertion | Restore state |

Show the matrix to the user before execution when they explicitly ask for QA, PR evidence, all permutations, or a test plan. If the request is a narrow bug reproduction, a smaller matrix is fine.

## Required Permutations

For every changed UI behavior, cover the smallest useful set from this list:

- **Positive path:** the intended workflow succeeds in a valid state.
- **Negative path:** invalid, incomplete, unauthorized, disabled, or pending state blocks the workflow.
- **No side effect:** blocked user action does not send the forbidden request, mutate data, navigate, enqueue work, or start execution.
- **Recovery path:** the control/state recovers after save, retry, cancel, stop, navigation, or pending request completion.
- **Race path:** rapid clicks, in-flight saves, stale selected entities, duplicate submits, and request abort/retry coordination.
- **Existing constraint:** old disabled/error conditions still take precedence where applicable.
- **Alternate surface:** selected-item details, compact/collapsed view, modal, sidebar, mobile/responsive view, or legacy route when changed code is shared.
- **Failure path:** failed request, server validation error, empty state, missing fixture, or permission denial if the change touches those boundaries.

Do not test every theoretical combination. Test combinations that the diff makes plausible, user-visible, or risky.

## Async Guard Checklist

When a change disables or guards an action during async state, prove all of these:

- The action is enabled before the guarded state when the workflow is otherwise valid.
- The expected pending request or state is actually in flight.
- The visible control is disabled or the action is visibly blocked.
- Clicking during the guarded state does not send the forbidden request.
- The control re-enables or the workflow recovers after the pending state resolves.
- The intended action still works afterward when appropriate.

For request-based guards, capture method and URL, for example:

```text
held request: POST /prompt-version
forbidden request absent: POST /workflow/test
recovery: Run disabled true -> false
```

## Evidence Manifest

For multi-case QA, create an artifact directory and manifest:

```text
/tmp/ui-browser-testing/<task>/
  assertions/
    <case>.json
  videos/
    <case>.webm
  screenshots/
    <case>-before.png
    <case>-after.png
```

Each assertion JSON or manifest entry should include:

- `case`: short stable name.
- `surface`: route or component area.
- `precondition`: fixture/state required.
- `action`: user-visible action.
- `expected`: expected UI and side effect.
- `observed`: observed UI and side effect.
- `network`: relevant requests/responses or forbidden requests checked.
- `media`: screenshot/video paths or uploaded URLs.
- `pass`: boolean.
- `cleanup`: restored, intentionally mutated, or not applicable.

## Product-Level Handoff

Report results as QA findings, not a demo recap:

- Lead with any failing or untested case.
- List passing cases with the behavior proven and evidence path/URL.
- State data mutations and cleanup.
- State what was not tested and why.
- Separate source inspection, unit tests, browser evidence, and uploaded PR evidence.

Example:

```text
Validated create/update/run behavior for Workflow V3.

Passed:
- Stable saved version runs and sends POST /workflow/test with promptVersionId.
- Run is disabled during POST /prompt-version and no workflow test request is sent.
- Run is disabled during PATCH /prompt-version/:id and no workflow test request is sent.
- Run re-enables after each save completes.

Evidence:
- /tmp/ui-browser-testing/case/videos/create-draft-guard.webm
- /tmp/ui-browser-testing/case/assertions/create-draft-guard.json

Not covered:
- Mobile layout; branch did not change responsive behavior.
```

## Common QA Failures

- Testing only the final disabled state and missing the normal path.
- Testing only the happy path and missing the race or blocked state introduced by the branch.
- Treating a screenshot as proof for a network guard.
- Forgetting recovery after pending state clears.
- Testing the wrong surface because app state persisted on a different tab.
- Counting a setup failure or wrong interaction as a failed product case without investigating whether the case was actually exercised.
- Uploading videos without the assertion data that says what passed.
