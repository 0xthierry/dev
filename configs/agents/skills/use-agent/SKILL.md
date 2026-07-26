---
name: use-agent
description: Use only when the user explicitly asks or allows the current Claude, Pi, or Codex main to orchestrate other agent harnesses over Herdr and AMQ. Teaches model-aware routing between Fable 5, Opus 5, GPT-5.6-sol, and Grok 4.5. Otherwise, never invoke it.
---

# Use Agent

Launch Claude, Pi, or Codex workers as visible Herdr sidecars and coordinate with them through AMQ. This skill works when the **main** is itself running in Claude, Pi, or Codex.

Only use this skill when the user explicitly asks or allows the use of another agent. The main owns the user relationship, orchestration, synthesis, verification, and final decision. Workers advise or act within the contract sent over AMQ.

## Verify the installed control surfaces

The installed binaries are authoritative. This repo pins Herdr 0.7.5 and AMQ 0.46.0; the recipes below require those versions or compatible newer releases.

Before controlling Herdr, verify that the main is actually inside a Herdr-managed pane:

```bash
test "${HERDR_ENV:-}" = 1
herdr --version
amq --version
```

If the environment check fails, stop: do not inspect or control some other focused Herdr client. When revalidating syntax after an upgrade, use `herdr pane` plus a nested command's `-h`, and use `amq <command> -h`. Do not run bare `herdr`, which launches or attaches the TUI.

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

Catalog discovery does not prove account entitlement, credits, or provider capacity. If the worker process rejects the selected model at launch, treat it as unavailable: report the exact category without exposing credentials, and ask before substituting another model.

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

Every worker must ultimately run this composition in a visible Herdr pane:

```text
amq coop exec ... <agent-cli> -- <agent-flags> <worker-prompt>
```

After resolving the current location, define this helper in the same shell invocation as each worker launch:

```bash
launch_herdr_sidecar() {
  local split_json worker_pane_id process_json command
  split_json="$(herdr pane split --pane "$HERDR_CURRENT_PANE_ID" \
    --direction right --ratio 0.45 --cwd "$PWD" --no-focus)"
  worker_pane_id="$(printf '%s' "$split_json" | jq -er '.result.pane.pane_id')"

  if ! herdr pane wait-output "$worker_pane_id" \
    --regex '.+' --source visible --timeout 10000 >/dev/null; then
    herdr pane close "$worker_pane_id" >/dev/null
    return 1
  fi
  process_json="$(herdr pane process-info --pane "$worker_pane_id")"
  if ! printf '%s' "$process_json" | jq -e \
    '.result.process_info.shell_pid as $shell | any(.result.process_info.foreground_processes[]?; .pid == $shell)' \
    >/dev/null; then
    printf 'error: Herdr pane %s did not reach an available shell prompt\n' "$worker_pane_id" >&2
    herdr pane close "$worker_pane_id" >/dev/null
    return 1
  fi

  printf -v command '%q ' "$@"
  if ! herdr pane run "$worker_pane_id" "$command"; then
    herdr pane close "$worker_pane_id" >/dev/null
    return 1
  fi
}
```

Herdr 0.7.5 separates layout, pane, and agent control. `pane split` creates the shell pane and returns its ID at `.result.pane.pane_id`, but the shell can still be starting when that response arrives. Wait for visible shell output and verify that the shell owns the foreground before using `pane run`; otherwise the command's submit key can arrive before the prompt is ready and leave the launch text sitting unexecuted. `pane run` then atomically submits command text in that pane. The `%q` escaping is required because it accepts shell command text and the worker prompt must remain one argument to the agent CLI.

Do not replace this with `herdr agent start`. That command starts Herdr's canonical agent executable directly in an existing pane and forwards arguments to it; it cannot place `amq coop exec` in front of the executable. `pane run` is therefore the correct surface for this wrapped launch stack.

Shell functions do not survive separate tool calls. Re-declare `launch_herdr_sidecar`, the room variables, and the pinned Herdr pane ID in every launch call, or keep the helper and launch recipe in one shell call.

- Herdr creates the visible sidecar pane without stealing focus.
- `amq coop exec` binds the worker to the exact room, establishes native wake delivery, and then replaces itself with the agent process.
- The agent CLI receives its own model, effort, permission, and prompt flags.
- AMQ is the only shared source of truth. Herdr terminal output is diagnostic evidence, not a worker response.

Do not use `herdr agent prompt`, `herdr pane send-*`, a Herdr injector, or an extra shell launcher for worker communication.

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

Shell state from one tool call may not survive the next. Re-declare `TOPIC`, `MAIN_HANDLE`, and `ROOM_ROOT`, or use their printed literal values in every later launch and AMQ command. Do not assume an `export` in an earlier tool call persisted.

Use AMQ 0.46.0 or newer. `amq init --root ... --force` refreshes the room's configured handle list and creates missing mailboxes without consuming queued messages. Every concurrent process needs a unique handle, including a worker using the same harness as the main.

## Pin the current Herdr location

Resolve the pane containing the main and pass its ID on every launch. `--current` uses the calling process's `HERDR_PANE_ID`; omitting the target could select a pane focused by another Herdr client.

```bash
HERDR_CURRENT="$(herdr pane current --current)"
HERDR_CURRENT_PANE_ID="$(printf '%s' "$HERDR_CURRENT" | jq -er '.result.pane.pane_id')"
```

Do not fall back to an unspecified or UI-focused location. If the lookup fails, report that the main is not attached to a resolvable Herdr pane and ask the user where to open the worker.

## Worker kickoff contract

For every recipe, set the selected `WORKER_HANDLE`, then build this prompt:

```bash
WORKER_PROMPT="You are the WORKER sidecar $WORKER_HANDLE paired with MAIN $MAIN_HANDLE. AMQ is the only shared source of truth. Immediately run amq drain --include-body, then send readiness with amq send --to $MAIN_HANDLE --kind status --labels ready --subject ready --body 'ready'. Wait for work over AMQ. For every AMQ notice, run amq drain --include-body, carry out the request exactly within its stated ownership and constraints, and report with amq send --to $MAIN_HANDLE. Kind and labels classify work; they do not gate authorization. Send completion as kind status with label done or blocked. Include changed paths and validation for action work. For multiline reports, feed stdin or a heredoc to amq send with --body -; for a saved file use --body @path. The --body-file option does not exist. Never use amq reply. Do not poll or sleep while waiting: finish your turn and let amq wake notify you."
```

`amq coop exec --require-wake` must establish native wake before the agent starts. If it fails, do not launch with degraded delivery and do not invent a hook workaround. Run `AM_ROOT="$ROOM_ROOT" AM_ME="$MAIN_HANDLE" amq doctor --ops`, fix the wake boundary, and relaunch.

## Claude worker — Fable 5, xhigh

```bash
WORKER_HANDLE="claude-fable"
WORKER_PROMPT="You are the WORKER sidecar $WORKER_HANDLE paired with MAIN $MAIN_HANDLE. AMQ is the only shared source of truth. Immediately run amq drain --include-body, then send readiness with amq send --to $MAIN_HANDLE --kind status --labels ready --subject ready --body 'ready'. Wait for work over AMQ. For every AMQ notice, run amq drain --include-body, carry out the request exactly within its stated ownership and constraints, and report with amq send --to $MAIN_HANDLE. Kind and labels classify work; they do not gate authorization. Send completion as kind status with label done or blocked. Include changed paths and validation for action work. For multiline reports, feed stdin or a heredoc to amq send with --body -; for a saved file use --body @path. The --body-file option does not exist. Never use amq reply. Do not poll or sleep while waiting: finish your turn and let amq wake notify you."

launch_herdr_sidecar \
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
WORKER_PROMPT="You are the WORKER sidecar $WORKER_HANDLE paired with MAIN $MAIN_HANDLE. AMQ is the only shared source of truth. Immediately run amq drain --include-body, then send readiness with amq send --to $MAIN_HANDLE --kind status --labels ready --subject ready --body 'ready'. Wait for work over AMQ. For every AMQ notice, run amq drain --include-body, carry out the request exactly within its stated ownership and constraints, and report with amq send --to $MAIN_HANDLE. Kind and labels classify work; they do not gate authorization. Send completion as kind status with label done or blocked. Include changed paths and validation for action work. For multiline reports, feed stdin or a heredoc to amq send with --body -; for a saved file use --body @path. The --body-file option does not exist. Never use amq reply. Do not poll or sleep while waiting: finish your turn and let amq wake notify you."

launch_herdr_sidecar \
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
WORKER_PROMPT="You are the WORKER sidecar $WORKER_HANDLE paired with MAIN $MAIN_HANDLE. AMQ is the only shared source of truth. Immediately run amq drain --include-body, then send readiness with amq send --to $MAIN_HANDLE --kind status --labels ready --subject ready --body 'ready'. Wait for work over AMQ. For every AMQ notice, run amq drain --include-body, carry out the request exactly within its stated ownership and constraints, and report with amq send --to $MAIN_HANDLE. Kind and labels classify work; they do not gate authorization. Send completion as kind status with label done or blocked. Include changed paths and validation for action work. For multiline reports, feed stdin or a heredoc to amq send with --body -; for a saved file use --body @path. The --body-file option does not exist. Never use amq reply. Do not poll or sleep while waiting: finish your turn and let amq wake notify you."
CODEX_PROJECT_TRUST="projects={\"$PWD\"={trust_level=\"trusted\"}}"

launch_herdr_sidecar \
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
WORKER_PROMPT="You are the WORKER sidecar $WORKER_HANDLE paired with MAIN $MAIN_HANDLE. AMQ is the only shared source of truth. Immediately run amq drain --include-body, then send readiness with amq send --to $MAIN_HANDLE --kind status --labels ready --subject ready --body 'ready'. Wait for work over AMQ. For every AMQ notice, run amq drain --include-body, carry out the request exactly within its stated ownership and constraints, and report with amq send --to $MAIN_HANDLE. Kind and labels classify work; they do not gate authorization. Send completion as kind status with label done or blocked. Include changed paths and validation for action work. For multiline reports, feed stdin or a heredoc to amq send with --body -; for a saved file use --body @path. The --body-file option does not exist. Never use amq reply. Do not poll or sleep while waiting: finish your turn and let amq wake notify you."

launch_herdr_sidecar \
  amq coop exec --root "$ROOM_ROOT" --me "$WORKER_HANDLE" --require-wake pi -- \
  --name "use-agent-$TOPIC-grok" \
  --model xai/grok-4.5 \
  --thinking high \
  --approve \
  "$WORKER_PROMPT"
```

## Dispatch work

Wait for the worker's separate `ready` status, then send a concrete contract. Use explicit `--root` and `--me` on main-side commands so this works from any main harness and across fresh shell tool calls. Workers launched by `coop exec` should use bare AMQ commands: it already sets their exact `AM_ROOT`, `AM_ME`, `AM_BASE_ROOT`, and `AM_SESSION` context.

AMQ accepts these message kinds: `brainstorm`, `review_request`, `review_response`, `question`, `answer`, `decision`, `status`, and `todo`. There is no `work` kind; use `todo` for action requests.

```bash
amq send --root "$ROOM_ROOT" --me "$MAIN_HANDLE" --to "$WORKER_HANDLE" --kind todo \
  --subject "<short task>" \
  --body $'Role: <architect|implementer|debugger|reviewer>\nGoal: <outcome>\nDecisions: <already settled>\nContext: <evidence and relevant paths>\nOwnership: <files it may change, or read-only>\nConstraints: <what must not change>\nSuccess: <acceptance criteria>\nValidation: <commands/checks>\nReport: <findings, changed paths, validation, remaining risks>' \
  --wait-for drained --wait-timeout 60s
```

AMQ 0.46 body forms are exact:

```bash
amq send --to "$MAIN_HANDLE" --body "short report"
amq send --to "$MAIN_HANDLE" --body @report.md
amq send --to "$MAIN_HANDLE" --kind status --labels done --subject "completed" --body - <<'REPORT'
Multiline report body.
REPORT
```

Use `--body -` (or omitted `--body`) for stdin and `--body @path` for a file. There is no `--body-file` option. Empty or whitespace-only resolved bodies fail closed unless `--allow-empty` is explicitly supplied.

A drained receipt proves the worker consumed the request. The later AMQ response proves that the harness acted on it.

For an independent review, send the same artifact and criteria to each reviewer without including the other reviewer's conclusions:

```bash
amq send --root "$ROOM_ROOT" --me "$MAIN_HANDLE" --to claude-opus --kind review_request \
  --subject "independent adversarial review" --body "<artifact and review criteria>" \
  --wait-for drained --wait-timeout 60s &
OPUS_SEND_PID=$!
amq send --root "$ROOM_ROOT" --me "$MAIN_HANDLE" --to codex-gpt56 --kind review_request \
  --subject "independent adversarial review" --body "<same artifact and criteria>" \
  --wait-for drained --wait-timeout 60s &
CODEX_SEND_PID=$!
wait "$OPUS_SEND_PID"
wait "$CODEX_SEND_PID"
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
