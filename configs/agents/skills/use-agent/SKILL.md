---
name: use-agent
description: Use only when the user explicitly asks or allows the current Claude or Pi main to orchestrate other agent harnesses over Herdr and AMQ. Routes GPT-6 Astra at high as the most powerful planner, hard-task debugger, and orchestration profile; GPT-5.6-sol executes, while Fable 5.1 and Grok provide independent review and reconnaissance. Otherwise, never invoke it.
---

# Use Agent

Launch Claude or Pi workers as visible Herdr sidecars and coordinate through AMQ. Only use this skill when the user explicitly asks or allows another agent. MAIN owns the user relationship, dispatch, synthesis, verification, and final acceptance. Workers advise or act within a bounded contract.

## Model routing

Use only this curated mapping. Roles and capability priority are workflow policy, not benchmark claims or automatic fallback rules.

| Profile | Harness / pinned model | Effort | Role and ownership |
| --- | --- | --- | --- |
| **GPT-6 Astra orchestrator** | Pi / `openai-codex/gpt-6-astra` | `high` | **Most powerful profile.** Leads demanding planning, architecture, hard tasks, deep debugging, decomposition, synthesis, and adjudication. Prefer orchestration over execution. Read-only as a sidecar. |
| **Fable 5.1 second opinion** | Claude / `claude-fable-5-1` | `xhigh` | Read-only second-opinion partner to Astra. Supplies independent evidence, counterarguments, and alternatives. **Not an oracle or final adjudicator**, and never an escalation above Astra. |
| **Fable 5.1 adversary** | Claude / `claude-fable-5-1` | `high` | Read-only demanding plan, implementation, debugging-hypothesis, security, and correctness review; one explicit lens per task. |
| **GPT-5.6-sol implementer** | Pi / `openai-codex/gpt-5.6-sol` | `high` | Writing workhorse for demanding multi-file features, refactors, reproductions, fix application, integration, and test/fix loops. Exact file ownership required. |
| **Grok 4.5 scout** | Pi / `xai/grok-4.5` | `high` | Fast, always read-only reconnaissance: locate files/symbols, trace call paths, inventory dependencies/config, find patterns, and perform bounded verification. |
| **Grok 4.6 adversary** | Pi / `xai/grok-4.6` | `high` | Fast read-only adversarial reviewer and independent debugger. Pair with Fable `high` when provider-diverse artifact review is useful. |

When Astra is MAIN, keep demanding planning and synthesis local and delegate bounded execution to GPT-5.6-sol. Do not launch a duplicate Astra by default. With another model as MAIN, Astra returns actionable plans, debugging hypotheses, discriminating checks, decisions, or worker contracts; it does not launch its own fleet or take over MAIN's user relationship.

Astra leads demanding reasoning; Fable is its independent second-opinion partner when another perspective adds value. Fable `high` plus Grok 4.6 `high` remain the default **artifact-review** adversarial pair. Ask independent reviewers before showing either the other's conclusions. Grok 4.5 and 4.6 add within-family diversity, not provider diversity.

Honor explicit user model/effort requests. The helper pins the profiles above and does not accept arbitrary model/effort overrides. If the user requests something outside the roster, explain that limitation rather than silently changing the request. If a model is unavailable, report the category without credentials and ask before substituting. Higher effort does not make Fable the lead or an oracle.

Effort controls are provider-specific, not comparable token budgets. Astra's curated setting is `high`; verify other levels before requesting them. Fable supports `low`, `medium`, `high`, `xhigh`, `max`; this skill uses `high`/`xhigh`. GPT-5.6-sol through Pi supports `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, but the writing profile pins `high`. Grok 4.5 supports `low`/`medium`/`high`, never `xhigh`; Grok 4.6 also supports `xhigh`, but the review profile pins `high`. Do not silently promote effort or rely on defaults.

## Plan before launching

Identify the active MAIN model from runtime/system metadata. Build the task graph and critical path before choosing workers. Keep urgent local blockers local; parallelize independent work with disjoint ownership, not speculative tasks or duplicate uncertainty.

For each lane, record:

- One bounded outcome and already-settled dependencies.
- Difficulty/risk and role: planner, orchestration advisor, second opinion, architect, implementer, debugger, scout, tester, or adversarial reviewer.
- Exact files/modules it may change, or read-only scope.
- Why that model adds value, success criteria, and validation commands.
- One primary contract and at most one immediate same-artifact follow-up.

Typical fleets (never launch one of every model by habit):

- **Codebase question:** one Grok 4.5 scout, or N scouts with distinct questions.
- **Demanding plan/architecture:** Astra `high` defines dependencies, ownership, risks, and validation gates; Fable `xhigh` supplies an independent second opinion when useful. Astra synthesizes against evidence; MAIN accepts and dispatches.
- **Medium/complex implementation:** N GPT-5.6-sol workers on disjoint modules.
- **Wide feature:** Grok scouts map the codebase, Astra plans, GPT-5.6-sol implements, then Fable `high`/Grok 4.6 `high` review settled artifacts.
- **Difficult bug:** Astra leads root-cause reasoning and discriminating checks; scouts or GPT-5.6-sol gather evidence/reproductions, then GPT-5.6-sol applies and tests the accepted fix. Add independent Fable/Grok hypotheses when useful.
- **High-risk design/disagreement:** Astra leads adjudication against evidence, paired with Fable `xhigh` for a second opinion when warranted—not a Fable oracle.

Scale any selected profile from one to N only as justified by the runnable frontier, resources, and provider capacity. Never launch reviewers before their artifact exists or allow concurrent writers to own the same files. Designate one integration owner for shared interfaces.

## Use the bundled helper

**Do not reconstruct launch functions or write temporary launcher scripts.** Use [scripts/sidecar.sh](scripts/sidecar.sh), which is deployed with this skill through the existing skill-directory symlink installer. Resolve its absolute path relative to the **loaded SKILL.md**, not the current project directory. It works from any project without changing directories.

```bash
# Replace with the absolute directory containing the SKILL.md you loaded.
HELPER="<absolute-skill-directory>/scripts/sidecar.sh"
bash "$HELPER" --help
```

Set `HELPER` again in each tool call; shell variables do not survive separate calls. Examples use `--harness pi`; Claude MAIN must use `--harness claude`.

The helper implements room guards, explicit roster setup, model/effort selection, kickoff prompts, safe pane launch, and retirement checks. It **does not** decide the fleet, track your task ledger, consume replies, dispatch work, or verify completion for you.

### Preconditions and invariants

- MAIN must actually be inside Herdr (`HERDR_ENV=1`). If not, stop; never control some other focused client.
- This repo pins Herdr **0.8.2** and AMQ **0.77.1**. Verify installed versions with `herdr --version` and `amq --version`. Changing either pin requires a real sidecar launch/close smoke test, not just mocked tests.
- Claude requires Code **2.1.255+**; confirm entitlement via `/model` before launching. The helper verifies exact Pi provider/model catalog availability before creating a pane. Catalog presence does not prove credits, entitlement, or provider capacity; a launch rejection still means unavailable.
- `herdr --skill` and AMQ's pinned-tag skill are upgrade references only, not competing active skills. For syntax, use `herdr pane` plus nested `-h` and `amq <command> -h`. Never run bare `herdr`, which starts/attaches the TUI.
- **If `AM_ROOT` is non-empty it is authoritative.** The helper preserves it and rejects a different `--root`. It preserves inherited `AM_ME`; otherwise the harness name is MAIN's handle. Do not override those environment variables to evade guards.
- Without `AM_ROOT`, the default room is `$PWD/.agent-mail/use-agent-<topic>`; use the same working directory/topic every call, or supply the same explicit absolute `--root` each time.
- Changing a command's environment cannot retarget an already-running Pi notifier. It watches only its exact bound room, not sibling rooms. Never substitute another session's printed room.

### 1. Provision exactly the planned handles

```bash
bash "$HELPER" init --topic auth-fix --harness pi \
  --workers pi-gpt6-astra-1,claude-fable51-xhigh-1,pi-gpt56-1
```

This provisions mailboxes only, not processes. It uses `amq init --force` to repair room configuration without deleting queued messages, then runs `amq doctor --ops`. If updating an existing room, include all still-needed worker handles; do not drop live workers from the roster.

| Handle pattern (N is a positive integer) | Profile |
| --- | --- |
| `pi-gpt6-astra-N` | Astra `high`, read-only planner/orchestration advisor |
| `claude-fable51-xhigh-N` | Fable `xhigh`, read-only second opinion |
| `claude-fable51-high-N` | Fable `high`, read-only adversary |
| `pi-gpt56-N` | GPT-5.6-sol `high`, writer |
| `pi-grok45-N` | Grok 4.5 `high`, read-only scout |
| `pi-grok46-N` | Grok 4.6 `high`, read-only adversary |

Handles are reservations, not capacity. Keep one live process per handle. MAIN is provisioned alongside workers and cannot collide with a worker handle. The helper does not maintain a durable handle/pane ledger: MAIN must verify a handle is configured and unused before launching, and must not concurrently launch the same handle.

### 2. Launch only the runnable frontier

```bash
bash "$HELPER" launch --topic auth-fix --harness pi \
  --handle pi-gpt6-astra-1
```

Default split is right of MAIN's pane, resolved with `herdr pane current --current`, never the UI-focused client. For a wider fleet, choose a known explicit split target and direction:

```bash
bash "$HELPER" launch --topic auth-fix --harness pi \
  --handle claude-fable51-xhigh-1 --target "<known-pane-id>" --direction down
```

Capture the returned room, main handle, worker handle, and pane ID. Immediately record the append-only tuple **(handle, pane_id, task_id, task_message_id, result_message_id, lifecycle state)**. A successful launch is not readiness or completion; wait for the separate AMQ `ready` message before dispatch.

The helper creates a visible no-focus pane, applies `use-agent-<topic>-<handle>` as both pane name and presentation metadata, waits for shell output, verifies shell foreground ownership, and submits a Bash-escaped command with `pane run`. On launch failure it attempts to close only the pane it just created. Inspect reported failures before reusing a handle; do not assume wake cleanup succeeded.

The launch composition remains `amq coop exec ... <agent-cli> -- <flags> <prompt>`. Do not replace it with `herdr agent start`, which cannot prepend the AMQ wrapper. Pi workers explicitly receive `AMQ_NOTIFY_ROLE=worker` and `--wake-inject-mode none`, preventing inherited MAIN-role rebinding and terminal input injection. Claude must not receive that zero-input setting because it lacks the repo's Pi API mailbox consumer. `--require-wake` must succeed; never invent a degraded-delivery fallback. Explicit harness names require `--named=false` to avoid duplicate naming paths.

Read-only profiles remove edit/write from the core tool allowlist and receive a strict non-mutating contract. This is **not a sandbox**: Bash and installed harness resources still run with local permissions. Pi uses `--approve` for project-resource trust; Claude uses `--dangerously-skip-permissions`. Never transfer permission flags between harnesses. AMQ is the only shared source of truth; pane output is diagnostic evidence, not a worker response. Never use `herdr agent prompt`, `pane send-*`, or an injector for worker communication.

## Dispatch and communicate

The helper supplies the standard readiness/reply/retirement prompt, including read-only and Astra/Fable role constraints. MAIN must still send a self-contained task after `ready`.

For main-side AMQ calls, re-derive the binding on every tool call:

```bash
# Use the same actual harness, topic, and (if unbound) room chosen at init.
MAIN_HANDLE="${AM_ME:-pi}"
ROOM_ROOT="${AM_ROOT:-$PWD/.agent-mail/use-agent-auth-fix}"
```

Do not overwrite inherited `AM_ROOT`/`AM_ME`. If init used an explicit unbound `--root`, use that exact room instead of the default above. Workers use bare AMQ commands because `coop exec` binds their room/handle/session.

Apply one short single-line title before sending the matching AMQ subject:

```bash
WORKER_HANDLE="pi-gpt6-astra-1"
WORKER_PANE_ID="<recorded-pane-id>"
TASK_TITLE="Plan auth fix"
herdr agent rename "$WORKER_PANE_ID" "$WORKER_HANDLE"
herdr pane rename "$WORKER_PANE_ID" "$TASK_TITLE · $WORKER_HANDLE"
herdr pane report-metadata "$WORKER_PANE_ID" --source user:use-agent-task \
  --title "$TASK_TITLE" --token "summary=$TASK_TITLE"
```

Send one bounded contract. Include objective, already-settled dependencies, canonical decisions, evidence paths, exact ownership/read-only scope, constraints, success criteria, validation commands, and one-primary-plus-one-same-artifact-follow-up lifetime. Require findings, changed paths, validation, remaining risks, and retirement/blocked status in the report.

```bash
amq send --root "$ROOM_ROOT" --me "$MAIN_HANDLE" --to "$WORKER_HANDLE" --strict \
  --thread "task/<lane-id>" --kind todo --labels task,role:planner \
  --subject "$TASK_TITLE" \
  --context '{"task_id":"<lane-id>","role":"planner","paths":["<scope>"],"ownership":"read-only","constraints":"<limits>","validation":"<checks>","lifetime":"one-primary-plus-one-same-artifact-follow-up"}' \
  --body "<self-contained contract>" --wait-for drained --wait-timeout 60s --json
```

Record the returned message `id` in the ledger. `drained` proves consumption, not completion. AMQ kinds are `brainstorm`, `review_request`, `review_response`, `question`, `answer`, `decision`, `status`, `todo`; there is no `work` kind. Send independent reviewers the same artifact/criteria, each in its own bounded lane, without the other reviewer's answer. MAIN compares results against repository evidence.

Always answer received messages using reply lineage, including follow-ups:

```bash
amq reply --id "<received-message-id>" --strict --body "short answer"
amq reply --id "<received-message-id>" --strict --body @report.md
amq reply --id "<received-message-id>" --strict --kind status \
  --labels done,retire --subject completed --body - <<'REPORT'
Multiline findings and validation.
REPORT
```

Main-side replies also need the preserved `--root "$ROOM_ROOT" --me "$MAIN_HANDLE"` when not already bound. `reply` preserves thread/refs and derives recipients; `send --strict` is only for readiness or a genuinely new conversation. Body forms are `--body -`/omitted for stdin and `--body @path` for a file. `--body-file` does not exist. Empty bodies fail closed unless explicitly allowed.

A full injected AMQ notice includes From, ID, Context, and Body: handle it directly without draining again. For a terminal wake that only says to check AMQ, drain once. When delivery times out, inspect durable trace rather than guessing from the pane:

```bash
amq trace "<task-message-id>" --root "$ROOM_ROOT" --json
AM_ROOT="$ROOM_ROOT" AM_ME="$WORKER_HANDLE" amq doctor --root "$ROOM_ROOT" --ops --json
```

A trace notification marked accepted/written proves only dispatch/write, not TUI consumption.

## Retire and rotate

A worker gets one primary contract and at most one immediate same-artifact follow-up: a failing test from its patch, review feedback on that patch, or a clarification. A new module/investigation, widened ownership, or unrelated third task needs a fresh worker.

- `done,retire`: writes/validation are finished; a retirement request, not an immediate kill signal.
- `blocked,awaiting-input`: keep it only for one immediate answer that continues the same task.
- `blocked,rotate`: record partial findings and retire for a compact fresh-context handoff.

Before retirement, record the result message ID, verify reply lineage with `amq trace`, mark `reported`, and verify artifacts/validation. If no immediate same-artifact follow-up is needed:

```bash
bash "$HELPER" retire --topic auth-fix --harness pi \
  --handle pi-gpt6-astra-1 --pane "<recorded-worker-pane-id>"
```

**Pass only the exact handle/pane tuple recorded at launch.** The helper rejects MAIN's current pane but cannot prove an arbitrary pane belongs to that handle. It closes the specified worker pane and performs one `amq doctor --ops --json` wake-lock check. Only successful cleanup verification permits marking `retired` and reusing the handle. Never close an unrecorded pane, ask a worker to self-kill, or assume a failed check means cleanup succeeded. If the pane is already gone or lookup fails, the helper fails closed rather than guessing it was retired; inspect Herdr and run one bound AMQ doctor check before recording cleanup manually.

If a wake lock remains, do not poll, delete lock files, blindly restart, or reuse the handle. Choose another unused handle and inspect once:

```bash
AM_ROOT="$ROOM_ROOT" AM_ME="$WORKER_HANDLE" \
  amq wake check --root "$ROOM_ROOT" --me "$WORKER_HANDLE" --json
```

Automation may act only when `restart_capability` is `agent_safe`, following `next_action`; `operator_only` belongs to the terminal owner/supervisor. Long waits also warrant recording partial work and retirement. Replacement handoffs contain only objective, decisions, artifact paths/ownership, completed work, unresolved uncertainty, and exact next action—not full transcripts. If MAIN crashes, recover via Herdr panes plus AMQ doctor; workers must not invent self-timeouts.

For stale owner/state or ambiguous launch readiness, keep background manifest checks enabled and inspect:

```bash
herdr server agent-manifests --json
herdr agent explain "<recorded-worker-pane-id>" --verbose
```

`herdr server update-agent-manifests --json` is an explicit repair only for a diagnosed stale compatible manifest.

## Receive replies

- **Pi MAIN with `amq-notify`:** finish the turn; replies arrive automatically in the exact bound room. Do not manually check unless the user explicitly asks.
- **MAIN launched through `amq coop exec`:** consume full injected notices directly; if wake only asks you to check, drain once.
- **Plain Claude MAIN:** no equivalent notifier. Check at natural orchestration checkpoints, or use one bounded monitor when deliberately waiting:

```bash
amq drain --root "$ROOM_ROOT" --me "$MAIN_HANDLE" --strict --include-body
# Alternative when intentionally waiting; not an additional polling step:
amq monitor --root "$ROOM_ROOT" --me "$MAIN_HANDLE" --strict --include-body --timeout 30m
```

Claude MAIN must continue checking at checkpoints until every expected worker reports done/blocked. No tight polling, sleeps, `.agent-mail` filesystem probes, or pane-output-as-reply substitutes. Readiness is not completion. Record, verify, and retire workers rather than keeping them idle for unrelated work.

## Helper maintenance

From the repository root:

```bash
bash -n configs/agents/skills/use-agent/scripts/sidecar.sh
shellcheck configs/agents/skills/use-agent/scripts/sidecar.sh
python3 -B -m unittest discover -s configs/agents/skills/use-agent/scripts -p 'test_*.py'
```

Tests mock Herdr, AMQ, and model CLIs; they do not launch sessions or prove live provider entitlement/native wake delivery. Keep model profiles and kickoff contracts in the helper, not duplicated shell recipes in this document.
