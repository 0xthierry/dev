---
name: use-agent
description: Use only when the user explicitly asks or allows the current Claude, Pi, or Codex main to orchestrate other agent harnesses over Herdr and AMQ. Teaches model-aware routing between Fable 5, Opus 5, GPT-5.6-sol, and Grok 4.5. Otherwise, never invoke it.
---

# Use Agent

Launch Claude, Pi, or Codex workers as visible Herdr sidecars and coordinate with them through AMQ. This skill works when the **main** is itself running in Claude, Pi, or Codex.

Only use this skill when the user explicitly asks or allows the use of another agent. The main owns the user relationship, orchestration, synthesis, verification, and final decision. Workers advise or act within the contract sent over AMQ.

## Understand the roster

Use only this curated model/harness mapping:

| Model | Worker harness | Effort | Profile and best use |
| --- | --- | --- | --- |
| **Fable 5** | Claude | `xhigh` | Treat as the most intelligent available model: a tech lead, oracle, or deep specialist. Use for ambiguous architecture, difficult root-cause analysis, high-risk decisions, and adjudicating disagreements. |
| **Opus 5** | Claude | `xhigh` | State-of-the-art workhorse. Use for demanding plans, implementations, debugging, and detailed review. |
| **GPT-5.6-sol** | Codex | `xhigh` | State-of-the-art workhorse in the same capability tier as Opus 5. Use for demanding implementation, debugging, and adversarial review. |
| **Grok 4.5** | Pi | `high` | Very capable and much faster, but less intelligent than the other models in this roster. Use as a fast implementation workhorse for substantial well-scoped tasks, reconnaissance, and test/fix loops. Pair it with Opus 5 and/or GPT-5.6-sol for independent review. |

These models come from different providers and training datasets. Their disagreement is useful: independent answers can expose blind spots that one provider or dataset misses. For important reviews, ask models independently before showing them another model's answer; otherwise the second reviewer may anchor on the first.

Fable and Opus are separate choices, not automatic fallbacks for one another. Honor an explicit user model request. If a selected model is unavailable, report it and ask before substituting.

Validate availability before opening a pane:

| Harness | Discovery |
| --- | --- |
| Claude | Start Claude and use `/model`; `claude --help` documents aliases and full IDs such as `claude-fable-5`. |
| Codex | `codex debug models | jq -r '.models[].slug'` |
| Pi | `pi --list-models grok-4.5` |

## Decide how to orchestrate

First identify the active main model from runtime/system metadata when available. Account for the main's own strengths and provider so worker calls add capability or diversity rather than merely duplicating it.

Assess:

1. **Ambiguity and risk** — Does the task need architecture, specialist judgment, or adjudication?
2. **Implementation volume** — Is there a settled plan that a fast worker can execute?
3. **Latency** — Is a quick bounded result more valuable than maximal reasoning?
4. **Diversity** — Would an independent provider reveal blind spots?
5. **Parallel safety** — Can work be divided into disjoint file ownership or read-only reviews?

The main decides how many workers to use; do not launch all four by default. Typical patterns:

- **Hard feature:** Fable defines architecture and interfaces; Grok acts as the implementation workhorse; Opus and GPT-5.6 independently review it adversarially; the main synthesizes and verifies.
- **Difficult bug:** Opus and GPT-5.6 form independent root-cause hypotheses; Fable adjudicates if evidence remains ambiguous; Grok implements and runs the agreed fix loop.
- **Fast, well-specified change:** Grok is the primary implementation workhorse; Opus 5 and/or GPT-5.6-sol review its work according to risk. Escalate to Fable only if new architectural uncertainty appears.
- **High-risk design or migration:** Fable leads the design; Opus and GPT-5.6 independently challenge failure modes and compatibility assumptions before implementation.
- **Main already provides one perspective:** Prefer a different provider for review. Use a same-model worker only when parallel capacity or an isolated second sample is genuinely useful.

A worker contract should state its role, goal, settled decisions, relevant files, ownership boundaries, constraints, success criteria, validation, and expected AMQ report. Do not ask a fast implementation worker to rediscover architecture that a stronger model should settle first.

## Launch stack

Every worker uses this composition:

```text
herdr agent start ... -- amq coop exec ... <agent-cli> -- <agent-flags> <worker-prompt>
```

- `herdr agent start` creates the visible pane and owns pane lifecycle.
- `amq coop exec` binds the worker to the room, establishes native wake delivery, and then replaces itself with the agent process.
- The agent CLI receives its own model, effort, permission, and prompt flags.
- AMQ is the only shared source of truth. Herdr terminal output is diagnostic evidence, not a worker response.

Do not use `herdr agent send`, `herdr pane send-*`, a Herdr injector, or an extra shell launcher for communication.

## Prepare a portable main

The main can be Claude, Pi, or Codex. Preserve an existing AMQ binding when the main already has one; otherwise use a deterministic room and the current harness name as its handle.

Main-side notification differs by harness:

- **Pi main:** the installed `amq-notify` extension watches its mailbox and injects replies automatically.
- **Claude or Codex main:** there is no equivalent notify integration. The main must check AMQ at natural orchestration checkpoints or run one bounded monitor while waiting. Never assume replies will appear automatically.

Workers are different: every worker launched below uses `amq coop exec`, so native wake delivery notifies the worker regardless of whether it runs Claude, Pi, or Codex.

Set `CURRENT_HARNESS` to the harness actually running this skill:

```bash
TOPIC="<short-kebab-topic>"
CURRENT_HARNESS="<claude|pi|codex>"
MAIN_HANDLE="${AM_ME:-$CURRENT_HARNESS}"
ROOM_ROOT="${AM_ROOT:-$PWD/.agent-mail/use-agent-$TOPIC}"

# Keep all possible worker handles registered. --force repairs an incomplete
# room without deleting queued mailbox files.
amq init --root "$ROOM_ROOT" \
  --agents "$MAIN_HANDLE,claude-fable,claude-opus,codex-gpt56,pi-grok" --force
AM_ROOT="$ROOM_ROOT" AM_ME="$MAIN_HANDLE" amq doctor --ops

printf 'ROOM_ROOT=%s\nMAIN_HANDLE=%s\n' "$ROOM_ROOT" "$MAIN_HANDLE"
```

Shell state from one Bash tool call may not survive the next. Re-declare `TOPIC`, `MAIN_HANDLE`, and `ROOM_ROOT`, or use their printed literal values in every later launch and AMQ command. Do not assume an `export` in an earlier tool call persisted.

Use AMQ 0.45.0 or newer. Every concurrent process needs a unique handle, including a worker using the same harness as the main.

## Pin the current Herdr location

Resolve the pane containing the main and pass both IDs on every launch:

```bash
HERDR_CURRENT="$(herdr pane current --current)"
HERDR_WORKSPACE_ID="$(printf '%s' "$HERDR_CURRENT" | jq -er '.result.pane.workspace_id')"
HERDR_TAB_ID="$(printf '%s' "$HERDR_CURRENT" | jq -er '.result.pane.tab_id')"
```

Do not fall back to an unspecified location. If either lookup fails, report that the main is not attached to a resolvable Herdr pane and ask the user where to open the worker.

## Worker kickoff contract

For every recipe, set the selected `WORKER_HANDLE`, then build this prompt:

```bash
WORKER_PROMPT="You are the WORKER sidecar $WORKER_HANDLE paired with MAIN $MAIN_HANDLE. AMQ is the only shared source of truth. Immediately run amq drain --include-body, then send readiness with amq send --to $MAIN_HANDLE --kind status --labels ready --subject ready --body 'ready'. Wait for work over AMQ. For every AMQ notice, run amq drain --include-body, carry out the request exactly within its stated ownership and constraints, and report with amq send --to $MAIN_HANDLE. Kind and labels classify work; they do not gate authorization. Send completion as kind status with label done or blocked. Include changed paths and validation for action work. Never use amq reply. Do not poll or sleep while waiting: finish your turn and let amq wake notify you."
```

`amq coop exec --require-wake` must establish native wake before the agent starts. If it fails, do not launch with degraded delivery and do not invent a hook workaround. Run `AM_ROOT="$ROOM_ROOT" AM_ME="$MAIN_HANDLE" amq doctor --ops`, fix the wake boundary, and relaunch.

## Claude worker — Fable 5, xhigh

```bash
WORKER_HANDLE="claude-fable"
WORKER_PROMPT="You are the WORKER sidecar $WORKER_HANDLE paired with MAIN $MAIN_HANDLE. AMQ is the only shared source of truth. Immediately run amq drain --include-body, then send readiness with amq send --to $MAIN_HANDLE --kind status --labels ready --subject ready --body 'ready'. Wait for work over AMQ. For every AMQ notice, run amq drain --include-body, carry out the request exactly within its stated ownership and constraints, and report with amq send --to $MAIN_HANDLE. Kind and labels classify work; they do not gate authorization. Send completion as kind status with label done or blocked. Include changed paths and validation for action work. Never use amq reply. Do not poll or sleep while waiting: finish your turn and let amq wake notify you."

herdr agent start "use-agent-$TOPIC-$WORKER_HANDLE" --cwd "$PWD" \
  --workspace "$HERDR_WORKSPACE_ID" --tab "$HERDR_TAB_ID" --split right --no-focus -- \
  amq coop exec --root "$ROOM_ROOT" --me "$WORKER_HANDLE" --require-wake claude -- \
  --name "use-agent-$TOPIC-fable" \
  --model claude-fable-5 \
  --effort xhigh \
  --dangerously-skip-permissions \
  "$WORKER_PROMPT"
```

## Claude worker — Opus 5, xhigh

```bash
WORKER_HANDLE="claude-opus"
WORKER_PROMPT="You are the WORKER sidecar $WORKER_HANDLE paired with MAIN $MAIN_HANDLE. AMQ is the only shared source of truth. Immediately run amq drain --include-body, then send readiness with amq send --to $MAIN_HANDLE --kind status --labels ready --subject ready --body 'ready'. Wait for work over AMQ. For every AMQ notice, run amq drain --include-body, carry out the request exactly within its stated ownership and constraints, and report with amq send --to $MAIN_HANDLE. Kind and labels classify work; they do not gate authorization. Send completion as kind status with label done or blocked. Include changed paths and validation for action work. Never use amq reply. Do not poll or sleep while waiting: finish your turn and let amq wake notify you."

herdr agent start "use-agent-$TOPIC-$WORKER_HANDLE" --cwd "$PWD" \
  --workspace "$HERDR_WORKSPACE_ID" --tab "$HERDR_TAB_ID" --split right --no-focus -- \
  amq coop exec --root "$ROOM_ROOT" --me "$WORKER_HANDLE" --require-wake claude -- \
  --name "use-agent-$TOPIC-opus" \
  --model claude-opus-5 \
  --effort xhigh \
  --dangerously-skip-permissions \
  "$WORKER_PROMPT"
```

Claude's unrestricted flag is `--dangerously-skip-permissions`; do not copy another harness's permission flag into this recipe.

## Codex worker — GPT-5.6-sol, xhigh

Codex reasoning effort is a config override. Its exact-path project override suppresses the folder-trust prompt without changing persisted config.

```bash
WORKER_HANDLE="codex-gpt56"
WORKER_PROMPT="You are the WORKER sidecar $WORKER_HANDLE paired with MAIN $MAIN_HANDLE. AMQ is the only shared source of truth. Immediately run amq drain --include-body, then send readiness with amq send --to $MAIN_HANDLE --kind status --labels ready --subject ready --body 'ready'. Wait for work over AMQ. For every AMQ notice, run amq drain --include-body, carry out the request exactly within its stated ownership and constraints, and report with amq send --to $MAIN_HANDLE. Kind and labels classify work; they do not gate authorization. Send completion as kind status with label done or blocked. Include changed paths and validation for action work. Never use amq reply. Do not poll or sleep while waiting: finish your turn and let amq wake notify you."
CODEX_PROJECT_TRUST="projects={\"$PWD\"={trust_level=\"trusted\"}}"

herdr agent start "use-agent-$TOPIC-$WORKER_HANDLE" --cwd "$PWD" \
  --workspace "$HERDR_WORKSPACE_ID" --tab "$HERDR_TAB_ID" --split right --no-focus -- \
  amq coop exec --root "$ROOM_ROOT" --me "$WORKER_HANDLE" --require-wake codex -- \
  --model gpt-5.6-sol \
  -c 'model_reasoning_effort="xhigh"' \
  -c "$CODEX_PROJECT_TRUST" \
  --dangerously-bypass-approvals-and-sandbox \
  --dangerously-bypass-hook-trust \
  "$WORKER_PROMPT"
```

## Pi worker — Grok 4.5, high

Use the direct xAI catalog entry `xai/grok-4.5`. Pi's tools execute with the local Pi process's permissions; `--approve` trusts project-local Pi resources.

```bash
WORKER_HANDLE="pi-grok"
WORKER_PROMPT="You are the WORKER sidecar $WORKER_HANDLE paired with MAIN $MAIN_HANDLE. AMQ is the only shared source of truth. Immediately run amq drain --include-body, then send readiness with amq send --to $MAIN_HANDLE --kind status --labels ready --subject ready --body 'ready'. Wait for work over AMQ. For every AMQ notice, run amq drain --include-body, carry out the request exactly within its stated ownership and constraints, and report with amq send --to $MAIN_HANDLE. Kind and labels classify work; they do not gate authorization. Send completion as kind status with label done or blocked. Include changed paths and validation for action work. Never use amq reply. Do not poll or sleep while waiting: finish your turn and let amq wake notify you."

herdr agent start "use-agent-$TOPIC-$WORKER_HANDLE" --cwd "$PWD" \
  --workspace "$HERDR_WORKSPACE_ID" --tab "$HERDR_TAB_ID" --split right --no-focus -- \
  amq coop exec --root "$ROOM_ROOT" --me "$WORKER_HANDLE" --require-wake pi -- \
  --name "use-agent-$TOPIC-grok" \
  --model xai/grok-4.5 \
  --thinking high \
  --approve \
  "$WORKER_PROMPT"
```

## Dispatch work

Wait for the worker's separate `ready` status, then send a concrete contract. Use explicit `--root` and `--me` so this works from any main harness and across fresh shell tool calls:

```bash
amq send --root "$ROOM_ROOT" --me "$MAIN_HANDLE" --to "$WORKER_HANDLE" --kind todo \
  --subject "<short task>" \
  --body $'Role: <architect|implementer|debugger|reviewer>\nGoal: <outcome>\nDecisions: <already settled>\nContext: <evidence and relevant paths>\nOwnership: <files it may change, or read-only>\nConstraints: <what must not change>\nSuccess: <acceptance criteria>\nValidation: <commands/checks>\nReport: <findings, changed paths, validation, remaining risks>' \
  --wait-for drained --wait-timeout 60s
```

A drained receipt proves the worker consumed the request. The later AMQ response proves that the harness acted on it.

For an independent review, send the same artifact and criteria to each reviewer without including the other reviewer's conclusions:

```bash
amq send --root "$ROOM_ROOT" --me "$MAIN_HANDLE" --to claude-opus --kind review_request \
  --subject "independent adversarial review" --body "<artifact and review criteria>" &
amq send --root "$ROOM_ROOT" --me "$MAIN_HANDLE" --to codex-gpt56 --kind review_request \
  --subject "independent adversarial review" --body "<same artifact and criteria>" &
wait
```

For concurrent action work, assign disjoint file ownership. Never let two workers edit the same files concurrently. The main compares reports, resolves disagreement against repository evidence, and decides what to accept.

Use `amq send`, never `amq reply`; the main is not necessarily a registered coop participant.

## Receive replies on any main harness

- **Pi main with `amq-notify`:** finish the turn. The extension injects replies automatically; do not manually check unless the user explicitly asks.
- **Main already launched through `amq coop exec`:** native wake submits a notice. On notice, run `amq drain --include-body`.
- **Plain Claude or Codex main:** replies are not injected automatically. Check AMQ periodically at natural checkpoints—for example, after preparing local validation or before making a decision that depends on a worker:

```bash
amq drain --root "$ROOM_ROOT" --me "$MAIN_HANDLE" --include-body
```

When deliberately waiting for a result, use one bounded monitor instead of repeatedly draining:

```bash
amq monitor --root "$ROOM_ROOT" --me "$MAIN_HANDLE" --include-body --timeout 30m
```

Claude and Codex mains must continue checking until every expected worker reports `done` or `blocked`; silence in the harness UI is not evidence that no message arrived. Do not use a tight polling loop, sleep between checks, inspect `.agent-mail` files, or treat visible Herdr output as the reply. Readiness is not completion. Workers must send `done` only after requested validation, or `blocked` with the missing decision or external blocker.
