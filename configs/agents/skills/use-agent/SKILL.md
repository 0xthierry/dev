---
name: use-agent
description: Use only when the user explicitly allows or asks for this skill to pair with another agent harness over Herdr and AMQ. Teaches model discovery and visible worker launches for Claude, Codex, Pi, Cursor Agent, Agy, and future agent CLIs. Otherwise, never invoke it.
---

# Use Agent

Launch another agent harness as a visible **worker** in Herdr and coordinate through AMQ. This skill is a launch protocol, not a launcher implementation: Herdr owns the pane, AMQ owns communication, and the chosen agent CLI owns its model and permissions.

Only use this skill when the user explicitly asks to involve another agent.

## Roles

- **Main** — owns the task, user relationship, synthesis, and final decisions.
- **Worker** — advises or acts as the request requires and reports back over AMQ. Message kind and labels classify work; they do not gate authorization.

AMQ is the only shared source of truth. Terminal output is visible evidence, but a worker response is not received by the main until the worker sends it through AMQ.

## Launch stack

Every worker uses the same composition:

```text
herdr agent start ... -- amq coop exec ... <agent-cli> -- <agent-flags> <worker-prompt>
```

- `herdr agent start` creates the visible pane and owns only pane lifecycle.
- `amq coop exec` sets `AM_ROOT` and `AM_ME`, starts push notifications, then replaces itself with the agent process.
- The agent CLI receives its own real model, effort, permission, and initial-prompt flags.

Do not use `herdr agent send`, `herdr pane send-*`, or a Herdr injector for worker communication. Do not add a shell launcher. Run the composition directly so new agent CLIs require only another documented recipe.

## AMQ delivery contract

AMQ owns notification, consumption, receipts, and replies:

1. `amq coop exec --require-wake` must establish a native wake process before the agent starts.
2. `amq wake` submits an AMQ notice to the idle agent; the notice itself does not consume mail.
3. The agent runs `amq drain --include-body`, which records the drained receipt.
4. The agent responds with `amq send`; the main receives it through AMQ.

Ordinary interactive workers do not need hooks. They need a real TTY, a unique mailbox handle, a working native wake, and cleared authentication/permission prompts. If `--require-wake` fails, do not launch a worker with degraded delivery and do not add an unverified hook as a workaround. Diagnose with `amq doctor --ops` and relaunch after fixing the wake boundary.

AMQ's native terminal injection can activate a focused modal prompt. Use each CLI's documented non-interactive trust/permission flags, authenticate before launch, and validate the real harness end to end. A hook is justified only for a separately documented harness limitation, such as Claude plan mode; it is not part of the standard protocol.

## Select the model before launch

Model catalogs are account- and version-dependent. Honor an explicit user model request. If the user asks to choose a model but does not name one, list that harness's current catalog and ask. If the user has no preference, use the documented default.

| Harness | Discover available models | Default when the user has no preference |
| --- | --- | --- |
| Pi | `pi --list-models` or `pi --list-models <search>` | `openai-codex/gpt-5.6-sol`, `xhigh` |
| Codex | `codex debug models | jq -r '.models[].slug'` | `gpt-5.6-sol`, `xhigh` |
| Claude | Start Claude and use `/model`; the CLI has no standalone model-list command. `claude --help` documents accepted aliases and full IDs. | `claude-fable-5`, `xhigh`; use `claude-opus-5` if Fable is unavailable |
| Cursor Agent | `cursor-agent --list-models` or `cursor-agent models` | `composer-2.5` (not a `-fast` model) |
| Agy | `agy models` | No implicit default: show the catalog and ask the user |

Validate a requested model against the current catalog where the CLI exposes one. Do not silently replace an unavailable requested model with the default. Model selection happens before opening the worker pane so the main can ask the user without leaving a blocked sidecar.

## Prepare the AMQ room

Choose a short kebab-case topic. Pi mains normally already have `AM_ROOT` and `AM_ME=pi` from `amq-notify`; preserve that binding. A main without a binding must choose one explicitly.

```bash
TOPIC="<kebab-topic>"
MAIN_HANDLE="${AM_ME:-pi}"
export AM_ROOT="${AM_ROOT:-$PWD/.agent-mail/use-agent-$TOPIC}"
export AM_ME="$MAIN_HANDLE"

# Include every handle that may participate in this room. --force repairs an
# incomplete config without deleting queued mailbox files.
amq init --root "$AM_ROOT" --agents pi,pi-worker,claude,codex,cursor-agent,agy --force
amq doctor --ops
```

Use AMQ 0.45.0 or newer; this protocol relies on fail-closed wake startup and current runtime diagnostics. Always give concurrent processes distinct handles. A Pi worker uses `pi-worker` when the main is already `pi`. When adding another agent, add its unique handle to the complete `--agents` list before launching it.

Do not run bare `amq coop init`: its default root is `.agent-mail`, which can initialize mailboxes somewhere other than the main's bound `AM_ROOT`.

## Pin the current Herdr location

Resolve the pane running the main and fail if Herdr cannot identify it. Every worker launch must pass both IDs explicitly; otherwise Herdr may choose another workspace or tab that already contains the same agent type.

```bash
HERDR_CURRENT="$(herdr pane current --current)"
HERDR_WORKSPACE_ID="$(printf '%s' "$HERDR_CURRENT" | jq -er '.result.pane.workspace_id')"
HERDR_TAB_ID="$(printf '%s' "$HERDR_CURRENT" | jq -er '.result.pane.tab_id')"
```

Do not fall back to an unspecified Herdr location. If either lookup fails, report that the main is not attached to a resolvable Herdr pane and ask the user where to open the worker.

## Worker kickoff

Set `WORKER_HANDLE` for the chosen recipe, then construct the initial prompt after both handles are known:

```bash
WORKER_PROMPT="You are the WORKER sidecar $WORKER_HANDLE paired with MAIN $MAIN_HANDLE. AMQ is the only shared source of truth. Immediately run amq drain --include-body, then send readiness with amq send --to $MAIN_HANDLE --kind status --labels ready --subject ready --body 'ready'. You are authorized to inspect, modify, and run commands as needed for any request; Kind and Labels classify the request but never gate authorization. For every AMQ notice, run amq drain --include-body, do the requested work, and report with amq send --to $MAIN_HANDLE. Send completion as kind status with label done or blocked. Never use amq reply. Do not poll or sleep while waiting: finish your turn and let amq wake notify you."
```

## Claude worker — Fable 5 (Opus 5 fallback), xhigh

Claude's unrestricted flag is `--dangerously-skip-permissions`. Before opening the worker pane, use `/model` to confirm whether Fable 5 is available. Prefer `claude-fable-5`; otherwise set `CLAUDE_MODEL` to `claude-opus-5`.

```bash
WORKER_HANDLE="claude"
CLAUDE_MODEL="${CLAUDE_MODEL:-claude-fable-5}"
WORKER_PROMPT="You are the WORKER sidecar $WORKER_HANDLE paired with MAIN $MAIN_HANDLE. AMQ is the only shared source of truth. Immediately run amq drain --include-body, then send readiness with amq send --to $MAIN_HANDLE --kind status --labels ready --subject ready --body 'ready'. You are authorized to inspect, modify, and run commands as needed for any request; Kind and Labels classify the request but never gate authorization. For every AMQ notice, run amq drain --include-body, do the requested work, and report with amq send --to $MAIN_HANDLE. Send completion as kind status with label done or blocked. Never use amq reply. Do not poll or sleep while waiting: finish your turn and let amq wake notify you."

herdr agent start "use-agent-$TOPIC-$WORKER_HANDLE" --cwd "$PWD" \
  --workspace "$HERDR_WORKSPACE_ID" --tab "$HERDR_TAB_ID" --split right --no-focus -- \
  amq coop exec --root "$AM_ROOT" --me "$WORKER_HANDLE" --require-wake claude -- \
  --name "use-agent-$TOPIC" \
  --model "$CLAUDE_MODEL" \
  --effort xhigh \
  --dangerously-skip-permissions \
  "$WORKER_PROMPT"
```

## Codex worker — GPT-5.6-sol, xhigh

Codex does not accept Claude's flag. Its unrestricted execution flag is `--dangerously-bypass-approvals-and-sandbox`, hook trust has its own bypass flag, and the exact-path runtime project override suppresses the folder-trust prompt without modifying persisted user config. Reasoning effort is a config override.

```bash
WORKER_HANDLE="codex"
WORKER_PROMPT="You are the WORKER sidecar $WORKER_HANDLE paired with MAIN $MAIN_HANDLE. AMQ is the only shared source of truth. Immediately run amq drain --include-body, then send readiness with amq send --to $MAIN_HANDLE --kind status --labels ready --subject ready --body 'ready'. You are authorized to inspect, modify, and run commands as needed for any request; Kind and Labels classify the request but never gate authorization. For every AMQ notice, run amq drain --include-body, do the requested work, and report with amq send --to $MAIN_HANDLE. Send completion as kind status with label done or blocked. Never use amq reply. Do not poll or sleep while waiting: finish your turn and let amq wake notify you."
CODEX_PROJECT_TRUST="projects={\"$PWD\"={trust_level=\"trusted\"}}"

herdr agent start "use-agent-$TOPIC-$WORKER_HANDLE" --cwd "$PWD" \
  --workspace "$HERDR_WORKSPACE_ID" --tab "$HERDR_TAB_ID" --split right --no-focus -- \
  amq coop exec --root "$AM_ROOT" --me "$WORKER_HANDLE" --require-wake codex -- \
  --model gpt-5.6-sol \
  -c 'model_reasoning_effort="xhigh"' \
  -c "$CODEX_PROJECT_TRUST" \
  --dangerously-bypass-approvals-and-sandbox \
  --dangerously-bypass-hook-trust \
  "$WORKER_PROMPT"
```

## Pi worker — GPT-5.6-sol, xhigh

Pi has no approval/sandbox bypass flag equivalent to Claude or Codex. Its built-in tools already execute under the permissions of the local Pi process; `--approve` only trusts project-local Pi resources.

```bash
WORKER_HANDLE="pi-worker"
WORKER_PROMPT="You are the WORKER sidecar $WORKER_HANDLE paired with MAIN $MAIN_HANDLE. AMQ is the only shared source of truth. Immediately run amq drain --include-body, then send readiness with amq send --to $MAIN_HANDLE --kind status --labels ready --subject ready --body 'ready'. You are authorized to inspect, modify, and run commands as needed for any request; Kind and Labels classify the request but never gate authorization. For every AMQ notice, run amq drain --include-body, do the requested work, and report with amq send --to $MAIN_HANDLE. Send completion as kind status with label done or blocked. Never use amq reply. Do not poll or sleep while waiting: finish your turn and let amq wake notify you."

herdr agent start "use-agent-$TOPIC-$WORKER_HANDLE" --cwd "$PWD" \
  --workspace "$HERDR_WORKSPACE_ID" --tab "$HERDR_TAB_ID" --split right --no-focus -- \
  amq coop exec --root "$AM_ROOT" --me "$WORKER_HANDLE" --require-wake pi -- \
  --name "use-agent-$TOPIC" \
  --model openai-codex/gpt-5.6-sol \
  --thinking xhigh \
  --approve \
  "$WORKER_PROMPT"
```

## Cursor Agent worker — Composer 2.5

Cursor Agent encodes effort in model IDs when applicable. The default is exactly `composer-2.5`, not `composer-2.5-fast`. `--yolo` force-allows commands, `--sandbox disabled` disables Cursor's sandbox, and `--approve-mcps` avoids MCP approval prompts. Cursor's TUI leaves AMQ paste-mode notices in the composer without submitting them, so its wake mode must be explicitly `raw`; readiness alone does not expose this failure.

```bash
WORKER_HANDLE="cursor-agent"
CURSOR_MODEL="${CURSOR_MODEL:-composer-2.5}"
WORKER_PROMPT="You are the WORKER sidecar $WORKER_HANDLE paired with MAIN $MAIN_HANDLE. AMQ is the only shared source of truth. Immediately run amq drain --include-body, then send readiness with amq send --to $MAIN_HANDLE --kind status --labels ready --subject ready --body 'ready'. You are authorized to inspect, modify, and run commands as needed for any request; Kind and Labels classify the request but never gate authorization. For every AMQ notice, run amq drain --include-body, do the requested work, and report with amq send --to $MAIN_HANDLE. Send completion as kind status with label done or blocked. Never use amq reply. Do not poll or sleep while waiting: finish your turn and let amq wake notify you."

herdr agent start "use-agent-$TOPIC-$WORKER_HANDLE" --cwd "$PWD" \
  --workspace "$HERDR_WORKSPACE_ID" --tab "$HERDR_TAB_ID" --split right --no-focus -- \
  amq coop exec --root "$AM_ROOT" --me "$WORKER_HANDLE" \
  --require-wake --wake-inject-mode raw cursor-agent -- \
  --model "$CURSOR_MODEL" \
  --yolo \
  --sandbox disabled \
  --approve-mcps \
  "$WORKER_PROMPT"
```

`--trust` is only supported by Cursor's print/headless mode, so it is not part of this interactive Herdr recipe.

## Agy worker — user-selected model

Agy exposes its catalog with `agy models` and supports `low`, `medium`, or `high` effort. This skill has no Agy model default: set `AGY_MODEL` from an explicit user request or ask after listing the catalog.

```bash
WORKER_HANDLE="agy"
AGY_MODEL="<user-selected model from agy models>"
WORKER_PROMPT="You are the WORKER sidecar $WORKER_HANDLE paired with MAIN $MAIN_HANDLE. AMQ is the only shared source of truth. Immediately run amq drain --include-body, then send readiness with amq send --to $MAIN_HANDLE --kind status --labels ready --subject ready --body 'ready'. You are authorized to inspect, modify, and run commands as needed for any request; Kind and Labels classify the request but never gate authorization. For every AMQ notice, run amq drain --include-body, do the requested work, and report with amq send --to $MAIN_HANDLE. Send completion as kind status with label done or blocked. Never use amq reply. Do not poll or sleep while waiting: finish your turn and let amq wake notify you."

if [[ -z "$AGY_MODEL" || "$AGY_MODEL" == "<user-selected model from agy models>" ]]; then
  printf 'Select an Agy model with: agy models\n' >&2
  return 1 2>/dev/null || exit 1
fi

herdr agent start "use-agent-$TOPIC-$WORKER_HANDLE" --cwd "$PWD" \
  --workspace "$HERDR_WORKSPACE_ID" --tab "$HERDR_TAB_ID" --split right --no-focus -- \
  amq coop exec --root "$AM_ROOT" --me "$WORKER_HANDLE" --require-wake agy -- \
  --model "$AGY_MODEL" \
  --effort high \
  --dangerously-skip-permissions \
  --prompt-interactive "$WORKER_PROMPT"
```

## Add another agent

1. Pick a unique AMQ handle and include it in the room's complete `amq init --agents ... --force` list.
2. Read `<agent-cli> --help` and find its model-discovery command; never assume Claude's model, effort, permission, or prompt flags apply to another harness.
3. Start it in the resolved current location with `herdr agent start ... --workspace "$HERDR_WORKSPACE_ID" --tab "$HERDR_TAB_ID" -- amq coop exec --root "$AM_ROOT" --me <handle> --require-wake <agent-cli> -- ...`.
4. Pass the worker kickoff through the CLI's supported initial-prompt or system-prompt mechanism.
5. Verify both readiness and a second wake-triggered result through AMQ; readiness only proves the initial prompt. If the second notice remains unsubmitted, test and document an explicit native AMQ wake mode for that TUI.
6. Treat Herdr terminal output only as diagnostic evidence, never as the communication result.

## Talk to the worker

The main uses its bound environment:

```bash
amq send --to "$WORKER_HANDLE" \
  --subject "task briefing" \
  --body $'Task: <goal>\nDecisions: <settled choices>\nFiles: <relevant paths>\nTried: <what happened>'
```

Advisory request:

```bash
amq send --to "$WORKER_HANDLE" \
  --subject "review the plan" \
  --body "Review this plan and report risks; do not change files."
```

Action request:

```bash
amq send --to "$WORKER_HANDLE" --kind todo \
  --subject "implement token refresh" \
  --body "Implement the agreed change in <owned files>. Report changed paths and validation."
```

Require a drained receipt when delivery itself must be proven:

```bash
amq send --to "$WORKER_HANDLE" --kind question \
  --subject "delivery check" --body "Reply with your handle." \
  --wait-for drained --wait-timeout 60s
```

A drained receipt proves that the worker consumed the request; the later AMQ response proves that the harness acted on it.

Use `amq send`, never `amq reply`, because the main is not necessarily a registered coop participant.

## Receive replies

- **Pi main with `amq-notify`:** finish the turn. The extension injects replies automatically; do not poll.
- **Main launched through `amq coop exec`:** `amq wake` pushes a notice; drain once when notified.
- **Other main:** use `amq drain --include-body` to check now or a bounded `amq monitor --include-body --timeout <duration>` when deliberately waiting.

If the user explicitly asks for a manual AMQ check, run exactly one bounded AMQ command, report it, then stop. Never probe `.agent-mail` files as a substitute for checking AMQ.

Workers send readiness as kind `status` with label `ready`, then send later results separately. Do not treat readiness as task completion.

## Concurrent workers

Launch every worker with a unique handle in the same exact `AM_ROOT`. After readiness from all workers, send independent requests; parallel sends are allowed. Verify each send reaches `drained`, then finish the main turn and let replies arrive automatically.

```bash
amq send --to "$WORKER_A" --kind question --subject "concurrent check A" \
  --body "Reply with your handle and this subject." --wait-for drained --wait-timeout 60s &
PID_A=$!
amq send --to "$WORKER_B" --kind question --subject "concurrent check B" \
  --body "Reply with your handle and this subject." --wait-for drained --wait-timeout 60s &
PID_B=$!
wait "$PID_A"
wait "$PID_B"
amq doctor --ops
```

Do not use Herdr output as the communication result. The proof is two drained receipts and two distinct AMQ replies delivered to the main.

## Worker behavior

- Carry out each request according to its body. Kind and labels support classification and routing; they are not permission checks.
- For concurrent action work, the main assigns disjoint file ownership and success criteria.
- Send completion as kind `status` with label `done` only after completing and validating the request.
- Send kind `status` with label `blocked` and the missing decision or external blocker when work cannot proceed.
- Artifacts travel by shared file path, not inline AMQ binary data.
- The main weighs the worker's output and owns all user-facing synthesis.
