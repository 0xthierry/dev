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
- `update_goal` — accepts `complete`, `blocked`, `paused`, or `amend`. Completion is mandatory-audited before terminal success. `blocked` is for a genuine external impasse. `paused` halts the autonomous loop so the model can ask the user a question (passed as the summary) and wait — needed because an active goal auto-continues, so a question asked while it is active is looped past and never seen; the user runs `/goal resume` after answering. `amend` revises the persistent contract (objective/criteria/plan/constraints/evidence) when a user or developer instruction changes a requirement, so the injected contract stops contradicting the live instruction; the model passes only the changed fields plus a summary citing the instruction, and the amended contract must still carry a verifiable stopping condition (it cannot narrow scope around already-done work).

`/goal auditor` shows the real auditor status for the current session: current model, runner mode, marker policy, active goal id/status, completion claim, attempts, and latest audit result.

The extension stores canonical goal state in custom session entries (`pi-goal-state`), injects active goal context on every model call, and queues safe idle continuations while a goal is active. The default turn limit is 512 and can be changed with `/goal turns <n>`.

## Stall guard

To stop a goal from looping indefinitely while making no real change (re-reading and re-verifying without acting), the extension tracks consecutive turns with no substantive state change. File edits (`edit`/`write`/`lsp_fix`), state-changing shell commands, delegated agent work, durable feedback writes, canvas updates, or a `/goal resume` reset the counter.

The guard escalates:

- **From 4 stalled turns** it injects a model-facing reflection into the goal context every turn (`pi-goal-stall`): it tells the model how many turns it has gone without a substantive state change, names the pattern as an inspection/decision loop, and asks it to reason about why and pick one concrete action — make the next edit, delegate real work, update an external artifact, `update_goal` complete/amend, or, when it needs the user or cannot name a next step, `update_goal(status="paused")` to halt and ask the user. This is the primary recovery mechanism: the model self-heals from inside its own context rather than relying on the user noticing.
- **At 8 stalled turns** it also surfaces a UI warning to the user.
- **At 16 stalled turns** it auto-pauses the goal as a backstop and notifies the user, who can redirect and `/goal resume`.
