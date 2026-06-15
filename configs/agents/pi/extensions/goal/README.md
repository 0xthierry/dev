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
- `update_goal` — accepts `complete` or `blocked`; completion is mandatory-audited before terminal success.

`/goal auditor` shows the real auditor status for the current session: current model, runner mode, marker policy, active goal id/status, completion claim, attempts, and latest audit result.

The extension stores canonical goal state in custom session entries (`pi-goal-state`), injects active goal context on every model call, and queues safe idle continuations while a goal is active. The default turn limit is 512 and can be changed with `/goal turns <n>`.
