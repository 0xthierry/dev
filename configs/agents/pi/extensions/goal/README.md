# pi-goal

Persistent autonomous goals for Pi.

## Commands

```text
/goal <objective>
/goal status
/goal pause
/goal resume
/goal clear
/goal turns <n>
/goal auditor
```

## Tools

- `get_goal` — returns the authoritative current goal state. The user can pause/resume/clear/replace the goal without it appearing in the conversation, so the model must call this before reporting goal status rather than trusting injected context or memory.
- `create_goal` — model-facing goal creation for explicitly requested autonomous long-running work. The model should inspect the relevant source/tests first and write a falsifiable verifier (exact command, test, file, or artifact) instead of generic placeholders.
- `update_goal` — accepts `complete`, `blocked`, or `amend`. Completion is mandatory-audited before terminal success. `amend` revises the persistent contract (objective/criteria/plan/constraints/evidence) when a user or developer instruction changes a requirement, so the injected contract stops contradicting the live instruction; the model passes only the changed fields plus a summary citing the instruction, and the amended contract must still carry a verifiable stopping condition (it cannot narrow scope around already-done work).

`/goal auditor` shows the real auditor status for the current session: current model, runner mode, marker policy, active goal id/status, completion claim, attempts, and latest audit result.

The extension stores canonical goal state in custom session entries (`pi-goal-state`), injects active goal context on every model call, and queues safe idle continuations while a goal is active. The default turn limit is 512 and can be changed with `/goal turns <n>`.

## Stall guard

To stop a goal from looping indefinitely while making no real change (re-reading and re-verifying without editing), the extension tracks consecutive turns with no file mutation (`edit`/`write`/`lsp_fix`). It warns after 8 such turns and auto-pauses the goal after 20, surfacing a notice so the user can redirect and `/goal resume`. Any file mutation, or a `/goal resume`, resets the counter.
