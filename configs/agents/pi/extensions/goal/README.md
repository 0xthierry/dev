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

- `get_goal` — returns current goal state.
- `create_goal` — model-facing goal creation for explicitly requested autonomous long-running work.
- `update_goal` — accepts `complete` or `blocked`; completion is mandatory-audited before terminal success.

`/goal auditor` shows the real auditor status for the current session: current model, runner mode, marker policy, active goal id/status, completion claim, attempts, and latest audit result.

The extension stores canonical goal state in custom session entries (`pi-goal-state`), injects active goal context on every model call, and queues safe idle continuations while a goal is active. The default turn limit is 512 and can be changed with `/goal turns <n>`.
