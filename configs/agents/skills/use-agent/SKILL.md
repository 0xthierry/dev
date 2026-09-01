---
name: use-agent
description: Use only when the user explicitly asks or allows the current Claude or Pi main to orchestrate other agent harnesses over Herdr and AMQ. Teaches model-aware routing between Fable 5.1, GPT-5.6-sol, Grok 4.5, and Grok 4.6. Otherwise, never invoke it.
---

# Use Agent

Launch Claude or Pi workers as visible Herdr sidecars and coordinate with them through AMQ. This skill works when the **main** is itself running in Claude or Pi.

Only use this skill when the user explicitly asks or allows the use of another agent. The main owns the user relationship, orchestration, synthesis, verification, and final decision. Workers advise or act within the contract sent over AMQ.

## Verify the installed control surfaces

The installed binaries are authoritative. This repo pins and validates Herdr 0.7.5 with AMQ 0.46.0. Do not assume a newer release preserves the launch lifecycle; rerun a real Herdr sidecar launch/close smoke test before changing either pin.

Before controlling Herdr, verify that the main is actually inside a Herdr-managed pane:

```bash
test "${HERDR_ENV:-}" = 1
herdr --version
amq --version
```

If the environment check fails, stop: do not inspect or control some other focused Herdr client. When revalidating syntax after an upgrade, use `herdr pane` plus a nested command's `-h`, and use `amq <command> -h`. Do not run bare `herdr`, which launches or attaches the TUI.

## Understand the roster

Use only this curated model/harness mapping. The roles are workflow policy, not claims that a model is intrinsically incapable of other work.

| Profile | Harness | Effort | Complexity, scope, and ownership |
| --- | --- | --- | --- |
| **Fable 5.1 oracle** | Claude | `xhigh` | Highest-capability profile used by this skill. Read-only. Reserve for ambiguous architecture, stubborn root causes, high-risk decisions, specialist judgment, and adjudication after ordinary evidence or reviewers disagree. |
| **Fable 5.1 adversary** | Claude | `high` | Read-only. Demanding plan, implementation, debugging-hypothesis, security, and correctness review. Use one explicit lens per run. |
| **GPT-5.6-sol implementer** | Pi | `high` | Writing workhorse for demanding multi-file features, refactors, debugging, tests, integration, and test/fix loops. Give exact file ownership and a verifiable definition of done. |
| **Grok 4.5 scout** | Pi | `high` | Fast and always read-only in this skill. Use for codebase checks: locating files and symbols, tracing call paths, inventorying dependencies/config, finding analogous patterns, and bounded verification. |
| **Grok 4.6 adversary** | Pi | `high` | Fast, read-only adversarial reviewer and independent debugger. Pair with Fable 5.1 `high` when provider-diverse challenge is warranted. |

Fable 5.1 and GPT-5.6-sol are frontier models intended for complex, long-horizon work. Grok 4.6 is also a frontier coding/agentic model; this skill deliberately specializes it as the fast adversarial lane. Grok 4.5 is capable of implementation, but this skill deliberately restricts it to fast read-only reconnaissance. Do not infer these workflow restrictions from benchmark rank alone.

These models come from different providers and training datasets. Their disagreement is useful: independent answers can expose blind spots that one provider or dataset misses. Fable 5.1 `high` and Grok 4.6 `high` are the default adversarial pair. Ask them independently before showing either model the other's answer. Grok 4.5 and Grok 4.6 add within-family diversity, not provider diversity.

Fable 5.1, GPT-5.6-sol, Grok 4.5, and Grok 4.6 are separate model choices, not automatic fallbacks for one another. Fable 5.1 at `xhigh` and `high` are separate launch profiles with different roles. Honor an explicit user model or effort request. If a selected profile is unavailable, report it and ask before substituting.

### Verify model surfaces

Validate availability before opening a pane:

| Harness | Discovery and exact invocation |
| --- | --- |
| Claude | Require Claude Code 2.1.255 or newer. Use `/model` to confirm entitlement. Pin `--model claude-fable-5-1`; select the role with `--effort xhigh` or `--effort high`. The `fable` alias currently resolves to 5.1 but can be overridden, so recipes pin the full ID. |
| Pi | Run `pi --list-models gpt-5.6-sol`, `pi --list-models grok-4.5`, and `pi --list-models grok-4.6`. Pin `openai-codex/gpt-5.6-sol`, `xai/grok-4.5`, or `xai/grok-4.6`, then pass `--thinking <level>`. |

Catalog discovery does not prove account entitlement, credits, or provider capacity. If the worker process rejects the selected model at launch, treat it as unavailable: report the exact category without exposing credentials, and ask before substituting another model.

| Model surface used here | Context exposed here | Maximum output | Important boundary |
| --- | ---: | ---: | --- |
| Claude Code `claude-fable-5-1` | 1,000,000 | 128,000 | Adaptive thinking is always on; latency is comparatively high. |
| Pi `openai-codex/gpt-5.6-sol` | 272,000 | 128,000 | OpenAI documents a 1,050,000-token upstream context, but Pi intentionally defaults this route to 272K. |
| Pi `xai/grok-4.5` | 500,000 | 500,000 catalog cap | Text/image input; reasoning cannot be disabled. |
| Pi `xai/grok-4.6` | 500,000 | 500,000 catalog cap | Text/image input; reasoning cannot be disabled. |

### Choose reasoning effort deliberately

Effort labels are provider-specific controls, not comparable token budgets. Always pass the exact effort in the launch recipe; never rely on a provider default.

| Model | Supported ladder on this harness | How this skill uses it |
| --- | --- | --- |
| **Fable 5.1** | `low`, `medium`, `high` (default), `xhigh`, `max`; always-on adaptive thinking | `high` for demanding adversarial review. `xhigh` for the oracle profile and long-horizon, capability-critical questions. Although `max` is supported and is technically the top effort, it is outside this curated roster; do not silently promote the oracle beyond the user-selected `xhigh`. Use `medium`/`low` only if the user explicitly prioritizes latency or usage and accepts reduced search/retrieval behavior. |
| **GPT-5.6-sol through Pi** | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`; Pi maps `minimal` to OpenAI `low`, while `off` omits the reasoning field rather than explicitly sending OpenAI `none` | Use `high` for the writing lane. `low` fits tightly specified, latency-sensitive work; `medium` is the upstream balanced default; `xhigh` fits unusually difficult multi-step coding or review; `max` is only for rare quality-first tasks after `high`/`xhigh` is insufficient. This skill's standard recipe remains `high`. |
| **Grok 4.5 through Pi** | `low`, `medium`, `high` (default); no `off`, `minimal`, `xhigh`, or `max` | This skill pins `high` for reliable read-only codebase checks. Outside this policy, xAI describes `low` for simple latency-sensitive tool use and `medium` for complex analysis or long context. Never request `xhigh`. |
| **Grok 4.6 through Pi** | `low`, `medium`, `high` (default), `xhigh`; no `off`, `minimal`, or `max` | This skill pins `high` for the fast adversarial lane. `xhigh` is available for the hardest quality-first problems but is not the default adversarial profile; use it only on explicit request. |

Higher effort generally increases reasoning tokens and latency. It does not repair a vague contract, missing evidence, excessive scope, or concurrent ownership conflicts. Prefer a bounded task and the lowest effort that passes representative evaluation; for this curated roster, keep the pinned profiles above unless the user asks to change them.

### Use benchmark evidence carefully

Benchmarks are directional. Scores depend on effort, harness, tool policy, benchmark version, and safeguards; do not compare similarly named but differently versioned tests as if they were one leaderboard. Representative published results:

| Model | Selected evidence | Routing implication |
| --- | --- | --- |
| **Fable 5.1** | Anthropic reports CursorBench 3.2.0 **73.4%**, Terminal-Bench 4.0 **55.8%**, Terminal-Bench-Science 0.1 **52.6%**, and AutomationBench **31.4%**. | Strongest fit for repository-scale, long-running, ambiguous, or high-consequence reasoning. Safeguards can refuse or reroute some cyber/biology work. |
| **GPT-5.6-sol** | OpenAI reports SWE-Bench Pro **64.6%**, DeepSWE 1.1 **72.7%**, Terminal-Bench 2.1 **88.8%**, and the AA Coding Agent Index v1.1 at **80**. | Strong writing/tool-use lane for complex professional coding, terminal workflows, and deep debugging; not a reason to omit tests or repository evidence. |
| **Grok 4.5 `high`** | xAI's later same-harness comparison reports CursorBench 3.2 **66.7%**, DeepSWE 1.1 **54.0%**, and Terminal-Bench 3.0 **15.7%**. Its launch also emphasized high token efficiency and fast generation. | Prefer as the quick reconnaissance sample, not the final authority for difficult repository-wide conclusions. |
| **Grok 4.6 `high`** | xAI reports CursorBench 3.2 **69.9%**, DeepSWE 1.1 **65.9%**, and Terminal-Bench 3.0 **26.0%**, improving every listed 4.5 row in its launch comparison. | Good fast independent adversary; use provider-diverse Fable review for high-risk artifacts. |

Primary references: [Fable 5.1 overview and benchmarks](https://www.anthropic.com/claude/fable), [Fable effort guidance](https://platform.claude.com/docs/en/build-with-claude/effort), [GPT-5.6-sol model limits](https://developers.openai.com/api/docs/models/gpt-5.6-sol), [GPT-5.6 launch evaluations](https://openai.com/index/gpt-5-6/), [Grok reasoning levels](https://docs.x.ai/developers/model-capabilities/text/reasoning), [Grok 4.5 launch](https://x.ai/news/grok-4-5), and [Grok 4.6 launch](https://x.ai/news/grok-4-6). Revalidate these sources and the installed catalogs before changing routing policy.

## Plan the workload before launching

First identify the active main model from runtime/system metadata. Build the task graph and its immediately runnable frontier before choosing workers. For every proposed lane, record:

| Field | Required decision |
| --- | --- |
| Task | One bounded outcome, not a general mission |
| Dependencies | What must settle before this lane starts |
| Difficulty and risk | Routine, demanding, or architecture/adjudication |
| Role | Oracle, architect, implementer, debugger, scout, tester, or adversarial reviewer |
| Ownership | Exact files/modules it may change, or read-only |
| Model and handle | Why this capability or provider adds value |
| Lifetime | One primary contract and, at most, one immediate same-artifact follow-up |

Find the critical path before adding parallelism. Increase worker count only when tasks are independent, ownership is disjoint, and expected coordination cost is lower than serial execution. Launch only the runnable frontier; do not keep speculative workers idle, and do not launch a reviewer until an artifact exists to review.

### Match the fleet to the workload

Worker count and model mix are dynamic. Never launch one of every model by habit.

- Use **Grok 4.5 at `high`** for fast read-only codebase checks, reconnaissance, file and symbol discovery, pattern finding, and bounded verification. Its ownership is always read-only.
- Use **GPT-5.6-sol at `high`** for medium-to-complex implementation, debugging, and test/fix work.
- Use **Fable 5.1 at `high`** and **Grok 4.6 at `high`** as independent read-only adversarial reviewers. Assign each a named lens, send the artifact independently, and let the main synthesize against repository evidence.
- Use **Fable 5.1 at `xhigh`** only as this skill's highest-capability read-only oracle when genuine architecture ambiguity, difficult root-cause analysis, high-risk judgment, specialist reasoning, or adjudication justifies it.
- Scale any selected model horizontally from one to N replicas when tasks and file ownership are independent. N is the justified width of the runnable frontier, bounded only by useful parallelism, machine resources, and provider capacity—not an arbitrary model quota.
- Prefer provider diversity for independent diagnosis or review. Do not show one reviewer another reviewer's conclusions before both answer.
- Same-model replicas are useful for independent lanes, not for duplicating the same uncertainty without a designated synthesis owner.

Typical fleets:

- **Codebase question or preflight:** one Grok 4.5 read-only scout.
- **Several reconnaissance lanes:** N Grok 4.5 read-only scouts with distinct questions.
- **Medium/complex implementation:** N GPT-5.6-sol workers on disjoint modules.
- **Adversarial review:** one Fable 5.1 `high` reviewer plus one Grok 4.6 `high` reviewer, both read-only and given the artifact independently.
- **Wide mixed feature:** Grok 4.5 scouts map the codebase; GPT-5.6-sol workers own disjoint implementation modules; Fable 5.1 `high` and Grok 4.6 `high` review after the implementation wave settles.
- **Difficult bug:** Fable 5.1 `high` and Grok 4.6 `high` form independent read-only hypotheses; the main chooses using repository evidence, then GPT-5.6-sol applies the fix.
- **High-risk design or unresolved disagreement:** one Fable 5.1 `xhigh` oracle wave, then retire it before implementation. Use the adversarial pair separately when the resulting artifact warrants challenge.
- **Main already supplies one perspective:** add a different provider or a fresh isolated sample rather than duplicating the main by default.

### Bound context and rotate workers

A worker gets one primary contract and at most one immediate follow-up tied to the same artifact. Allowed follow-ups include fixing a test exposed by its patch, applying review feedback to that patch, or answering a clarification about its assigned artifact. A new module, different investigation, widened ownership, or unrelated third task requires a fresh worker.

The main owns compact handoffs. Brief a replacement with only: objective, current decision, artifact paths and ownership, completed work, unresolved uncertainty, and exact next action. Do not route transcripts or ask a long-lived worker to rediscover the whole project.

Handles are reservations, not running capacity. Size the handle pool to the planned concurrent frontier, launch only what the workload needs, and keep exactly one live process per handle. N is concurrent capacity, not the total number of workers over the job: after verified retirement, a handle can launch a fresh-context replacement. Every concurrently writing worker must own disjoint files; reviewers remain read-only until the implementation wave settles.

## Launch stack

Every worker must ultimately run this composition in a visible Herdr pane:

```text
amq coop exec ... <agent-cli> -- <agent-flags> <worker-prompt>
```

After resolving the current location, define these helpers in the same shell invocation as each worker launch. The binding guard is fail-closed: a main that inherited `AM_ROOT` may operate only on that exact room.

```bash
require_preserved_main_amq_binding() {
  local candidate_root="$1"

  if [[ -z "$candidate_root" ]]; then
    printf 'error: ROOM_ROOT is required\n' >&2
    return 2
  fi
  if [[ -n "${AM_ROOT:-}" && "$candidate_root" != "$AM_ROOT" ]]; then
    printf 'error: refusing AMQ room override: inherited AM_ROOT=%s, ROOM_ROOT=%s\n' \
      "$AM_ROOT" "$candidate_root" >&2
    printf 'error: use ROOM_ROOT="${AM_ROOT}"; the main notifier watches only that exact room\n' >&2
    return 2
  fi
}

launch_herdr_sidecar() {
  local split_target="$1" split_direction="$2"
  local split_json worker_pane_id process_json command
  shift 2

  require_preserved_main_amq_binding "${ROOM_ROOT:-}" || return

  case "$split_direction" in
    right | down) ;;
    *)
      printf 'error: invalid Herdr split direction: %s\n' "$split_direction" >&2
      return 2
      ;;
  esac

  split_json="$(herdr pane split --pane "$split_target" \
    --direction "$split_direction" --ratio 0.45 --cwd "$PWD" --no-focus)"
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
  if ! herdr pane run "$worker_pane_id" "$command" >/dev/null; then
    herdr pane close "$worker_pane_id" >/dev/null
    return 1
  fi
  printf '%s\n' "$worker_pane_id"
}
```

Herdr 0.7.5 separates layout, pane, and agent control. `pane split` creates the shell pane and returns its ID at `.result.pane.pane_id`, but the shell can still be starting when that response arrives. Wait for visible shell output and verify that the shell owns the foreground before using `pane run`; otherwise the command's submit key can arrive before the prompt is ready and leave the launch text sitting unexecuted. `pane run` then atomically submits command text in that pane. The `%q` escaping is required because it accepts shell command text and the worker prompt must remain one argument to the agent CLI.

Pass an explicit target pane and `right` or `down` so a multi-worker fleet can build a usable layout instead of repeatedly narrowing the main pane. The helper prints only the created pane ID; every launch must capture it and immediately record the append-only tuple `(handle, pane_id, task, lifecycle state)`. Do not overwrite that mapping until retirement completes.

Do not replace this with `herdr agent start`. That command starts Herdr's canonical agent executable directly in an existing pane and forwards arguments to it; it cannot place `amq coop exec` in front of the executable. `pane run` is therefore the correct surface for this wrapped launch stack.

Shell functions do not survive separate tool calls. Re-declare `launch_herdr_sidecar`, the room variables, and the pinned Herdr pane ID in every launch call, or keep the helper and launch recipe in one shell call.

- Herdr creates the visible sidecar pane without stealing focus.
- `amq coop exec` binds the worker to the exact room, establishes native wake delivery, and then replaces itself with the agent process.
- The agent CLI receives its own model, effort, permission, and prompt flags.
- AMQ is the only shared source of truth. Herdr terminal output is diagnostic evidence, not a worker response.

Do not use `herdr agent prompt`, `herdr pane send-*`, a Herdr injector, or an extra shell launcher for worker communication.

## Prepare a portable main

The main can be Claude or Pi. Preserve an existing AMQ binding when the main already has one; otherwise use a deterministic room and the current harness name as its handle.

**Hard room invariant:** if `AM_ROOT` is non-empty, it is authoritative for the lifetime of that main session. Never replace it with `.agent-mail/use-agent-$TOPIC`, another session's printed path, or a custom room. Pi's `amq-notify` watches only its exact bound room; it does not discover sibling rooms created later. Setting `AM_ROOT` only on an `amq` command also does not retarget the already-running notifier. A worker launched into any other room can send successfully while the main receives nothing automatically.

Main-side notification differs by harness:

- **Pi main:** the installed `amq-notify` extension watches its exact `AM_ROOT` mailbox and injects replies automatically.
- **Claude main:** there is no equivalent notify integration. The main must check AMQ at natural orchestration checkpoints or run one bounded monitor while waiting. Never assume replies will appear automatically.

Workers are different: every worker launched below uses `amq coop exec`, so native wake delivery notifies the worker regardless of whether it runs Claude or Pi.

Set `CURRENT_HARNESS` to the harness actually running this skill:

```bash
TOPIC="<short-kebab-topic>"
CURRENT_HARNESS="<claude|pi>"
INHERITED_AM_ROOT="${AM_ROOT:-}"
MAIN_HANDLE="${AM_ME:-$CURRENT_HARNESS}"
ROOM_ROOT="${INHERITED_AM_ROOT:-$PWD/.agent-mail/use-agent-$TOPIC}"
if [[ -n "$INHERITED_AM_ROOT" && "$ROOM_ROOT" != "$INHERITED_AM_ROOT" ]]; then
  printf 'error: refusing to replace inherited AM_ROOT=%s with ROOM_ROOT=%s\n' \
    "$INHERITED_AM_ROOT" "$ROOM_ROOT" >&2
  exit 1
fi
# Prevent an accidental same-shell reassignment after the guard.
readonly MAIN_HANDLE ROOM_ROOT
# Before running this block, set every count from the runnable frontier.
# Zero omits a model; N has no fixed skill-level maximum. No defaults are
# provided because the skill must not bias fleet composition.
: "${FABLE51_XHIGH_REPLICAS:?set FABLE51_XHIGH_REPLICAS from the workload plan}"
: "${FABLE51_HIGH_REPLICAS:?set FABLE51_HIGH_REPLICAS from the workload plan}"
: "${GPT56_REPLICAS:?set GPT56_REPLICAS from the workload plan}"
: "${GROK45_REPLICAS:?set GROK45_REPLICAS from the workload plan}"
: "${GROK46_REPLICAS:?set GROK46_REPLICAS from the workload plan}"

for replica_count in \
  "$FABLE51_XHIGH_REPLICAS" "$FABLE51_HIGH_REPLICAS" "$GPT56_REPLICAS" \
  "$GROK45_REPLICAS" "$GROK46_REPLICAS"; do
  if [[ ! "$replica_count" =~ ^[0-9]+$ ]]; then
    printf 'error: every replica count must be a non-negative integer\n' >&2
    exit 1
  fi
done
unset replica_count

replica_handles() {
  local prefix="$1" count="$2" index
  for ((index = 1; index <= count; index++)); do
    printf '%s-%d\n' "$prefix" "$index"
  done
}

WORKER_HANDLES="$(
  {
    replica_handles claude-fable51-xhigh "$FABLE51_XHIGH_REPLICAS"
    replica_handles claude-fable51-high "$FABLE51_HIGH_REPLICAS"
    replica_handles pi-gpt56 "$GPT56_REPLICAS"
    replica_handles pi-grok45 "$GROK45_REPLICAS"
    replica_handles pi-grok46 "$GROK46_REPLICAS"
  } | paste -sd, -
)"
if [[ -z "$WORKER_HANDLES" ]]; then
  printf 'error: plan at least one worker before initializing AMQ\n' >&2
  exit 1
fi

# Provisioning a mailbox does not launch a worker. --force repairs an
# incomplete room without deleting queued mailbox files.
amq init --root "$ROOM_ROOT" \
  --agents "$MAIN_HANDLE,$WORKER_HANDLES" --force
AM_ROOT="$ROOM_ROOT" AM_ME="$MAIN_HANDLE" amq doctor --ops

printf 'ROOM_ROOT=%s\nMAIN_HANDLE=%s\nWORKER_HANDLES=%s\n' \
  "$ROOM_ROOT" "$MAIN_HANDLE" "$WORKER_HANDLES"
```

Shell state from one tool call may not survive the next. Re-declare `TOPIC`, `MAIN_HANDLE`, `ROOM_ROOT`, and both helper functions in every later launch or main-side AMQ call. When the current process exposes `AM_ROOT`, always derive `ROOM_ROOT` from it again and run `require_preserved_main_amq_binding`; never use a topic-derived or copied literal instead. Printed literal room values are acceptable only for a main whose `AM_ROOT` is unset. Do not assume an `export` in an earlier tool call persisted.

Use the pinned AMQ 0.46.0 unless a newer version has passed the real Herdr lifecycle smoke test. `amq init --root ... --force` refreshes the room's configured handle list and creates missing mailboxes without consuming queued messages. Every live process needs a unique handle, including replicas of the same model and a worker using the same harness as the main. Choose any unused numbered handle; never launch the whole configured pool merely because it exists.

## Pin the current Herdr location

Resolve the pane containing the main and pass its ID on every launch. `--current` uses the calling process's `HERDR_PANE_ID`; omitting the target could select a pane focused by another Herdr client.

```bash
HERDR_CURRENT="$(herdr pane current --current)"
HERDR_CURRENT_PANE_ID="$(printf '%s' "$HERDR_CURRENT" | jq -er '.result.pane.pane_id')"
```

Do not fall back to an unspecified or UI-focused location. If the lookup fails, report that the main is not attached to a resolvable Herdr pane and ask the user where to open the worker.

## Worker kickoff contract

For every recipe, choose one unused numbered `WORKER_HANDLE`, then build the same bounded prompt:

```bash
build_worker_prompt() {
  printf '%s' "You are the disposable WORKER sidecar $WORKER_HANDLE paired with MAIN $MAIN_HANDLE. AMQ is the only shared source of truth. Immediately run amq drain --include-body, then send readiness with amq send --to $MAIN_HANDLE --kind status --labels ready --subject ready --body 'ready'. Accept one bounded primary contract and at most one immediate follow-up on the same artifact: a failing test from your patch, review feedback on that patch, or a clarification about your assigned artifact. Do not accept a new module, different investigation, widened ownership, or unrelated third task; report with kind status and labels blocked,rotate instead. For every AMQ notice within that boundary, run amq drain --include-body, carry out the request exactly within its ownership and constraints, and report with amq send --to $MAIN_HANDLE. Send retirement-safe completion only after all assigned work and validation finish, using kind status and labels done,retire. If one immediate answer would unblock the same task, use labels blocked,awaiting-input; if fresh context is better, use blocked,rotate. Include changed paths and validation for action work. For multiline reports, feed stdin or a heredoc to amq send with --body -; for a saved file use --body @path. The --body-file option does not exist. Never use amq reply. Do not self-close the pane: MAIN records and verifies your result before retirement. Do not poll or sleep while waiting: finish your turn and let amq wake notify you."
}

build_readonly_worker_prompt() {
  printf '%s' "$(build_worker_prompt) This profile is strictly read-only. Never edit, create, delete, rename, or format files; never change git state, packages, processes, services, or external systems. Bash is available only because AMQ is the transport: beyond amq commands, use it only for non-mutating inspection and validation. Report findings and proposed changes; MAIN or a writing worker applies them."
}
```

`done,retire` means artifact writes are complete and no further worker-owned state needs to be consumed; it is a retirement request, not an immediate kill signal. `blocked,awaiting-input` preserves the worker for one answer. `blocked,rotate` asks the main to record the partial result and replace the worker.

`amq coop exec --require-wake` must establish native wake before the agent starts. If it fails, do not launch with degraded delivery and do not invent a hook workaround. Run `AM_ROOT="$ROOM_ROOT" AM_ME="$MAIN_HANDLE" amq doctor --ops`, fix the wake boundary, and relaunch.

## Claude worker — Fable 5.1, xhigh oracle

Use the pinned Claude Code model ID `claude-fable-5-1`. This is a read-only oracle profile.

```bash
WORKER_HANDLE="claude-fable51-xhigh-1" # choose any configured unused claude-fable51-xhigh-1..N
WORKER_PROMPT="$(build_readonly_worker_prompt)"
WORKER_PANE_ID="$(launch_herdr_sidecar "$HERDR_CURRENT_PANE_ID" right \
  amq coop exec --root "$ROOM_ROOT" --me "$WORKER_HANDLE" --require-wake claude -- \
  --name "use-agent-$TOPIC-$WORKER_HANDLE" \
  --model claude-fable-5-1 \
  --effort xhigh \
  --tools "Bash,Read,Grep,Glob" \
  --dangerously-skip-permissions \
  "$WORKER_PROMPT")"
printf 'WORKER_HANDLE=%s\nWORKER_PANE_ID=%s\n' "$WORKER_HANDLE" "$WORKER_PANE_ID"
```

## Claude worker — Fable 5.1, high adversarial reviewer

Use the same pinned model at `high`; do not substitute the `xhigh` oracle profile automatically.

```bash
WORKER_HANDLE="claude-fable51-high-1" # choose any configured unused claude-fable51-high-1..N
WORKER_PROMPT="$(build_readonly_worker_prompt)"
WORKER_PANE_ID="$(launch_herdr_sidecar "$HERDR_CURRENT_PANE_ID" right \
  amq coop exec --root "$ROOM_ROOT" --me "$WORKER_HANDLE" --require-wake claude -- \
  --name "use-agent-$TOPIC-$WORKER_HANDLE" \
  --model claude-fable-5-1 \
  --effort high \
  --tools "Bash,Read,Grep,Glob" \
  --dangerously-skip-permissions \
  "$WORKER_PROMPT")"
printf 'WORKER_HANDLE=%s\nWORKER_PANE_ID=%s\n' "$WORKER_HANDLE" "$WORKER_PANE_ID"
```

Claude's unrestricted flag is `--dangerously-skip-permissions`; do not copy another harness's permission flag into this recipe.

## Pi worker — GPT-5.6-sol, high

Use Pi's direct ChatGPT-backed catalog entry `openai-codex/gpt-5.6-sol`. The upstream model supports a wider effort ladder, but this writing profile deliberately pins `high`. Pi's tools execute with the local Pi process's permissions; `--approve` trusts project-local Pi resources.

```bash
WORKER_HANDLE="pi-gpt56-1" # choose any configured unused pi-gpt56-1..N
WORKER_PROMPT="$(build_worker_prompt)"
WORKER_PANE_ID="$(launch_herdr_sidecar "$HERDR_CURRENT_PANE_ID" right \
  amq coop exec --root "$ROOM_ROOT" --me "$WORKER_HANDLE" --require-wake pi -- \
  --name "use-agent-$TOPIC-$WORKER_HANDLE" \
  --model openai-codex/gpt-5.6-sol \
  --thinking high \
  --approve \
  "$WORKER_PROMPT")"
printf 'WORKER_HANDLE=%s\nWORKER_PANE_ID=%s\n' "$WORKER_HANDLE" "$WORKER_PANE_ID"
```

## Pi worker — Grok 4.5, high

Use the direct xAI catalog entry `xai/grok-4.5` at its highest supported effort. This profile is read-only: the allowlist removes edit/write, while Bash remains available only for AMQ and non-mutating checks. Pi's tools execute with the local Pi process's permissions; `--approve` trusts project-local Pi resources.

```bash
WORKER_HANDLE="pi-grok45-1" # choose any configured unused pi-grok45-1..N
WORKER_PROMPT="$(build_readonly_worker_prompt)"
WORKER_PANE_ID="$(launch_herdr_sidecar "$HERDR_CURRENT_PANE_ID" right \
  amq coop exec --root "$ROOM_ROOT" --me "$WORKER_HANDLE" --require-wake pi -- \
  --name "use-agent-$TOPIC-$WORKER_HANDLE" \
  --model xai/grok-4.5 \
  --thinking high \
  --tools read,bash,grep,find,ls \
  --approve \
  "$WORKER_PROMPT")"
printf 'WORKER_HANDLE=%s\nWORKER_PANE_ID=%s\n' "$WORKER_HANDLE" "$WORKER_PANE_ID"
```

## Pi worker — Grok 4.6, high

Use the direct xAI catalog entry `xai/grok-4.6` at `high`, not its optional `xhigh`, for the standard fast adversarial profile. This profile is read-only: the allowlist removes edit/write, while Bash remains available only for AMQ and non-mutating checks. Pi's tools execute with the local Pi process's permissions; `--approve` trusts project-local Pi resources.

```bash
WORKER_HANDLE="pi-grok46-1" # choose any configured unused pi-grok46-1..N
WORKER_PROMPT="$(build_readonly_worker_prompt)"
WORKER_PANE_ID="$(launch_herdr_sidecar "$HERDR_CURRENT_PANE_ID" right \
  amq coop exec --root "$ROOM_ROOT" --me "$WORKER_HANDLE" --require-wake pi -- \
  --name "use-agent-$TOPIC-$WORKER_HANDLE" \
  --model xai/grok-4.6 \
  --thinking high \
  --tools read,bash,grep,find,ls \
  --approve \
  "$WORKER_PROMPT")"
printf 'WORKER_HANDLE=%s\nWORKER_PANE_ID=%s\n' "$WORKER_HANDLE" "$WORKER_PANE_ID"
```

To launch replicas, rerun only the needed recipe with another unused handle and choose an explicit split target/direction that keeps panes usable. Each launch is a new bounded context; do not reuse a live handle or lose its recorded pane ID.

## Dispatch work

Wait for the worker's separate `ready` status, then send a concrete contract. Before every main-side `init`, launch, `send`, `drain`, `monitor`, `doctor`, or retirement command, run `require_preserved_main_amq_binding "$ROOM_ROOT"`. Use explicit `--root` and `--me` on main-side commands so this works from any main harness and across fresh shell tool calls. Workers launched by `coop exec` should use bare AMQ commands: it already sets their exact `AM_ROOT`, `AM_ME`, `AM_BASE_ROOT`, and `AM_SESSION` context.

AMQ accepts these message kinds: `brainstorm`, `review_request`, `review_response`, `question`, `answer`, `decision`, `status`, and `todo`. There is no `work` kind; use `todo` for action requests.

```bash
require_preserved_main_amq_binding "$ROOM_ROOT" || exit 1
amq send --root "$ROOM_ROOT" --me "$MAIN_HANDLE" --to "$WORKER_HANDLE" --kind todo \
  --subject "<short task>" \
  --body $'Task ID: <lane-id>\nRole: <oracle|architect|implementer|debugger|scout|tester|adversarial reviewer>\nGoal: <one bounded outcome>\nDependencies: <already-settled prerequisites>\nDecisions: <current canonical decisions>\nContext: <evidence and relevant artifact paths>\nOwnership: <exact files/modules it may change, or read-only>\nConstraints: <what must not change>\nSuccess: <acceptance criteria>\nValidation: <commands/checks>\nLifetime: one primary contract plus at most one immediate same-artifact follow-up\nReport: <findings, changed paths, validation, remaining risks, done/retire or blocked status>' \
  --wait-for drained --wait-timeout 60s
```

AMQ 0.46 body forms are exact:

```bash
amq send --to "$MAIN_HANDLE" --body "short report"
amq send --to "$MAIN_HANDLE" --body @report.md
amq send --to "$MAIN_HANDLE" --kind status --labels done,retire --subject "completed" --body - <<'REPORT'
Multiline report body.
REPORT
```

Use `--body -` (or omitted `--body`) for stdin and `--body @path` for a file. There is no `--body-file` option. Empty or whitespace-only resolved bodies fail closed unless `--allow-empty` is explicitly supplied.

A drained receipt proves the worker consumed the request. The later AMQ response proves that the harness acted on it.

For an independent review, send the same artifact and criteria to each reviewer without including the other reviewer's conclusions:

```bash
amq send --root "$ROOM_ROOT" --me "$MAIN_HANDLE" --to claude-fable51-high-1 --kind review_request \
  --subject "independent adversarial review" --body "<artifact and review criteria>" \
  --wait-for drained --wait-timeout 60s &
FABLE51_SEND_PID=$!
amq send --root "$ROOM_ROOT" --me "$MAIN_HANDLE" --to pi-grok46-1 --kind review_request \
  --subject "independent adversarial review" --body "<same artifact and criteria>" \
  --wait-for drained --wait-timeout 60s &
GROK46_SEND_PID=$!
wait "$FABLE51_SEND_PID"
wait "$GROK46_SEND_PID"
```

For concurrent action work, assign disjoint file ownership and designate one integration owner for shared interfaces. Never let two workers edit the same files concurrently. The main compares reports, resolves disagreement against repository evidence, and decides what to accept.

Use `amq send`, never `amq reply`; the main is not necessarily a registered coop participant.

## Retire and rotate workers

Do not leave completed workers running for future unrelated tasks. After a `done,retire` report:

1. Record the AMQ result and update the worker tuple to `reported`.
2. Verify the required artifacts, writes, and validation evidence. `done` is not itself permission to discard unrecorded state.
3. If no one immediate same-artifact follow-up is needed, close only the recorded pane created for that worker.
4. Confirm through `amq doctor --ops --json` that no wake lock remains for that handle. Only a clean check makes the handle reusable.
5. Mark the tuple `retired`; brief a fresh worker from the compact canonical handoff when more work exists.

For `blocked,awaiting-input`, keep the worker only when one answer is expected immediately and will continue the same task. For `blocked,rotate`, a long external wait, a widened task, or a context-heavy next step, record the partial result and retire it.

Use this lifecycle helper with the literal handle and pane ID printed at launch:

```bash
retire_worker() {
  local worker_handle="$1" worker_pane_id="$2"

  require_preserved_main_amq_binding "${ROOM_ROOT:-}" || return

  # Closed pane IDs are not reused. If the worker already exited, continue to
  # wake cleanup verification; otherwise close only its recorded pane.
  if herdr pane get "$worker_pane_id" >/dev/null 2>&1; then
    herdr pane close "$worker_pane_id" >/dev/null
  fi

  local ops_json
  if ! ops_json="$(AM_ROOT="$ROOM_ROOT" AM_ME="$MAIN_HANDLE" amq doctor --ops --json)"; then
    printf 'could not verify AMQ wake cleanup for worker handle %s\n' \
      "$worker_handle" >&2
    return 1
  fi
  if printf '%s' "$ops_json" | jq -e --arg handle "$worker_handle" \
    '(.ops.wake_locks // []) | any(.agent == $handle)' >/dev/null; then
    printf 'worker handle %s still has an AMQ wake claim; choose an unused pool handle\n' \
      "$worker_handle" >&2
    return 1
  fi
}

retire_worker "$WORKER_HANDLE" "$WORKER_PANE_ID"
```

The AMQ wake started by `coop exec` shares the worker pane's terminal lifecycle. Closing the recorded Herdr pane terminates the agent and its wake; the wake removes its lock during shutdown. Confirm that boundary with one post-close `doctor --ops --json` check. If a lock remains, do not poll, delete lock files, or reuse the handle: use another unused pool handle and run one bounded diagnostic later at a natural checkpoint.

Pane closure is lifecycle control, not worker communication. Never ask the worker to self-kill, never close the main pane, and never close an unrecorded pane. If the main crashes, recover by inspecting Herdr panes plus `amq doctor --ops`; workers do not invent self-timeouts.

## Receive replies on any main harness

- **Pi main with `amq-notify`:** finish the turn. The extension injects replies automatically; do not manually check unless the user explicitly asks.
- **Main already launched through `amq coop exec`:** native wake submits a notice. On notice, run `amq drain --include-body`.
- **Plain Claude main:** replies are not injected automatically. Check AMQ periodically at natural orchestration checkpoints—for example, after preparing local validation or before making a decision that depends on a worker:

```bash
amq drain --root "$ROOM_ROOT" --me "$MAIN_HANDLE" --include-body
```

When deliberately waiting for a result, use one bounded monitor instead of repeatedly draining:

```bash
amq monitor --root "$ROOM_ROOT" --me "$MAIN_HANDLE" --include-body --timeout 30m
```

Claude mains must continue checking until every expected worker reports `done,retire`, `blocked,awaiting-input`, or `blocked,rotate`; silence in the harness UI is not evidence that no message arrived. Do not use a tight polling loop, sleep between checks, inspect `.agent-mail` files, or treat visible Herdr output as the reply. Readiness is not completion. Record and verify each final report, then follow the retirement policy instead of keeping workers alive by default.
