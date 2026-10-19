# Persistent Subagents

Persistent Pi-native subagents backed by resident `pi --mode rpc` child processes.

```bash
pi install ./configs/agents/pi/extensions/subagent
```

## Breaking tool catalog

This runtime is not compatible with the retired foreground `agent` / `Agent` tool, `tasks[]` requests, or one-shot JSON runner. It registers this stable tool catalog:

1. `agent_spawn` — start or queue a persistent child assignment and return after prompt acceptance.
2. `agent_send` — steer running work or queue durable mailbox communication; it does not start a turn.
3. `agent_followup` — serialize retained-session work, optionally changing execution at the next assignment boundary.
4. `agent_wait` — wait for exact current assignments with `all` or `any` semantics.
5. `agent_interrupt` — abort current work while preserving a resumable session.
6. `agent_list` — inspect bounded tree state and effective execution provenance.
7. `agent_close` — permanently terminate a child and release resident capacity.

All seven main tools are registered once in that order. Children receive those tools plus `agent_reply`, registered after `agent_send`, through authenticated session-scoped IPC. They share the root scheduler, filesystem, and working directory. The parent entrypoint suppresses itself in child launches so an explicit child runtime owns the proxy catalog.

## Delegation workflow

Delegate independent work when it saves time or improves quality. Decide what you
will do locally before spawning, keep immediate blockers local, and prefer bounded
implementation over exploration when a worker can make the change directly.
Agents share a filesystem: give them non-overlapping write scopes and require them
to preserve others' changes. Continue useful local work, review returned evidence
and patches, and run proportionate validation plus required project checks.
Reuse retained context for related tasks; start fresh for unrelated work and close
agents no longer needed. The parent owns integration and the final answer.

The stable shared instructions live in `lib/agents/orchestration-guidance.ts`;
model selection lives in `lib/tools/model-guidance.ts`. Parent and child runtimes
consume these sources without per-turn model catalogs or volatile prompt content.

## Two-way communication

A child can send a question, blocker, or useful update to its direct parent:

```json
{ "message": "Does this change need to preserve compatibility?" }
```

Call `agent_reply` with that payload. It is available only to spawned agents.
The runtime derives the sender and direct parent from the authenticated caller;
there is no `target` parameter. Messages must be nonblank and at most 16 KiB
of UTF-8 text. For a subagent parent, the attributed envelope must also fit its
mailbox limit; an oversized envelope fails explicitly rather than truncating the
message.

- An active main receives a steering message at its next model-call boundary.
- An idle main receives the message and starts a turn automatically. This can
  consume model tokens without another user prompt.
- An active subagent parent receives steering; an inactive subagent parent gets
  durable queued mail, without starting another assignment.

Replies are attributed `subagent-message` context, not user instructions or final
answers. Delivery confirms acceptance or queueing, not that the parent has read
or answered the message. It does not finish the child's assignment or wait for a
response. If the parent is executing `agent_wait`, a reply does not interrupt
that tool; it reaches the model after the tool returns.

The parent answers with `agent_send` while the child is running, or
`agent_followup` after it finishes. A child should continue independent work after
sending. If it cannot proceed, it should end its turn with the blocker so its
parent can respond and resume it. Avoid polling and repeated acknowledgments.
Automatic final-answer delivery is unchanged and does not wake an idle main.
The existing mailbox bounds queued messages for inactive subagent parents. Root
replies enter Pi's steering queue; this extension does not impose a pending-root
queue limit or a conversation-wide reply budget.

## Agents

A built-in `worker` fallback is always available. The repo-managed global `worker.md` overrides that fallback after installation, and other global Markdown definitions such as `advisor.md` are read from Pi's agent directory.

| Repo-managed agent | File default | Responsibility |
| --- | --- | --- |
| [advisor](../../../agents/advisor.md) | No execution pins | Read-only decision advice through selected lenses |
| [worker](../../../agents/worker.md) | No execution pins | Bounded implementation and verification |

Both select and read definitions through the shared [engineering-principles skill](../../../skills/engineering-principles/SKILL.md). The skill includes progressive TypeScript and testing/Bun references. The built-in fallback remains minimal for standalone installations without these files.

A trusted project may add `.pi/agents/**/*.md`:

```markdown
---
name: worker
description: Implements bounded production changes.
---

Project-specific worker instructions.
```

`provider` and `model` are optional but atomic: specify both or neither. External project profiles can still provide execution defaults, but this repo's shared profiles omit them so the parent can select settings per task. Project definitions and repository configuration are ignored when Pi does not trust the project. Discovery rejects duplicates within one source, applies deterministic project-over-global-over-built-in precedence across sources, and renders a name-sorted parent catalog without absolute paths or runtime state.

## Execution resolution

Provider, model, and effort are assignment settings. Model and effort resolve independently:

1. tool invocation;
2. trusted `pi-subagent.json`;
3. agent Markdown frontmatter;
4. current parent execution.

Provider and model must always be supplied together and the provider is never guessed from a model name. After model precedence resolves, the runtime applies model-specific effort policy: `cliproxyapi/gpt-5.6-terra` always resolves to `medium`, regardless of invocation, repository, agent, or inherited parent effort. This invariant supersedes repository effort locks for Terra while model locks continue to apply, and returned execution provenance reports the effort source as `policy`. Every other selected Pi model must support the exact normally resolved effort. Task-dependent guidance covers `low` through `xhigh`; repo-managed roles do not impose a fixed effort. The runtime retains Pi's broader effort support for other agent files, explicit requests, and repository settings. Pi's model registry validates provider/model existence and authentication at the boundary, then credentials are immediately discarded. Children confirm their effective model and effort through RPC before accepting work. Follow-up execution changes perform model/thinking updates and state verification before prompting.

Example spawn override:

```json
{
  "task_name": "routine-review",
  "subagent_type": "advisor",
  "prompt": "Review this bounded patch for correctness and report exact evidence.",
  "execution": {
    "provider": "cliproxyapi",
    "model": "gpt-6-astra",
    "effort": "medium"
  }
}
```

This bounded-review example selects Astra at `medium` effort. A narrow, obvious
patch may warrant `low`; a review involving subtle concurrency or data-loss risks
may warrant `high` or `xhigh`. Base the selection on the actual review question.

## Model routing evidence

The `agent_spawn` description contains stable guidance for choosing a model and
reasoning effort per assignment; `agent_followup` refers to the same guidance.
Repo-managed agent profiles define roles and instructions, not model or effort
pins. The parent chooses execution settings based on the actual task. This is
prompt-guided selection, not an automatic runtime difficulty classifier.
Omitted settings inherit repository configuration, external agent defaults, then
the parent. Repository locks and model-specific runtime policies still apply.

### Recommended use

Choose a named agent for its role, then select model and effort independently.
Prefer `cliproxyapi/gpt-6.1-sol` for read-only reconnaissance and
`cliproxyapi/gpt-6-astra` for implementation, debugging, planning, design, and review.
These model preferences do not prescribe an effort level.

| Effort | Task characteristics |
|---|---|
| `low` | Narrow lookup, straightforward explanation, or small change with direct verification |
| `medium` | Several connected files, moderate branching, or bounded comparison of alternatives |
| `high` | Ambiguous behavior, complex cross-component reasoning, difficult debugging, or consequential decisions |
| `xhigh` | Exceptionally difficult or high-risk work with unresolved interacting constraints |

Use the lowest adequate effort. A difficult read-only analysis may need `high`;
a small implementation may need only `low`. Do not choose effort from the agent
name or access mode alone. Give a brief task-specific reason for `high` or `xhigh`.
Pass the chosen effort in `agent_spawn.execution`; use `agent_followup.execution`
to adjust it for a later task when new evidence changes the difficulty assessment.
Supply provider and model together when choosing a model. Check the returned
effective settings, rather than assuming the request won over repository locks
or runtime policy. The existing Terra `medium` runtime invariant is unchanged.

The shared Markdown profiles and generated Codex agent TOMLs omit execution pins.
Removing pins permits inheritance; it does not itself implement adaptive reasoning
in Claude or Codex. Pi's parent applies the task-selection guidance above.
**Effort is a task-dependent judgment, not a benchmark-proven optimum.**

The repo-managed `configs/agents/pi/cliproxyapi-models.json` maps the full pinned
Pi Codex catalog, including the models recommended here. Deploy catalog changes
through the agent installer; catalog presence alone does not prove upstream
availability. See `configs/cliproxyapi/README.md` for the complete mapping.

### Prompt design and current routing basis

- [Codex subagent tool definitions](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/multi_agents_spec.rs)
  motivate decision-oriented instructions: delegate independent bounded work,
  continue useful local work, and explain each tool's practical behavior.
  Pi's own lifecycle semantics remain authoritative; Codex's defaults and tool
  behavior are not copied blindly.
- The repo-managed `cliproxyapi` catalog maps GPT-6 Luna, GPT-6.1 Sol, GPT-6 Astra,
  and GPT-5.6 Terra to the local Codex account pool. Catalog presence proves
  configuration, not live entitlement, quota, or comparative quality.
- Prefer Astra for implementation and judgment-heavy work, and Sol for
  reconnaissance, while choosing effort separately for each assignment. These are
  workflow preferences, not benchmark claims; no same-task, same-harness Pi
  comparison establishing an optimal effort for these routes has been run locally.

Keep volatile benchmark and price claims out of the model-facing tool prompt. Track
completed-task quality, wall time, retries, allowance consumption, and cache reuse
before tightening these recommendations. Both parent and nested tools receive the
same stable model-selection guidance.

## Trusted repository configuration

`pi-subagent.json` supports the nested shape below. For compatibility, agent entries may also put `provider`, `model`, and `effort` directly on the agent object. Unknown trusted fields are ignored rather than disabling the extension.

```json
{
  "runtime": {
    "maxActiveAgents": 8,
    "maxResidentAgents": 16,
    "maxDepth": 3
  },
  "agents": {
    "worker": {
      "execution": {
        "provider": "cliproxyapi",
        "model": "gpt-6-astra",
        "effort": "high"
      },
      "allowInvocationOverride": {
        "model": true,
        "effort": false
      }
    }
  }
}
```

A differing locked invocation fails explicitly; repeating the configured value succeeds while retaining repository provenance. Incomplete provider/model pairs still fail explicitly; unrelated fields are ignored and the legacy flat execution fields remain accepted for compatibility.

## Limits and lifecycle

Defaults are eight active child turns, sixteen resident Pi processes, and depth one, so subagents cannot spawn nested subagents unless trusted repository configuration explicitly raises `runtime.maxDepth`. Settled residents are a warm LRU cache: when runnable work reaches the resident cap, the supervisor unloads the least-recently-used idle process while preserving its session instead of queueing the new assignment. Trusted local configuration may raise those budgets without extension-imposed hard ceilings. Agent lifetime count, task-name length, assignment size, and wait target count likewise have no separate policy caps; task names must remain path-safe, and the encoded transport frame is the practical assignment boundary. Mailbox messages remain capped at 16 KiB because they are retained model-visible communication. Waits default to 30 seconds and have a one-hour maximum.

Full artifacts are capped at 2 MiB. Outbound RPC commands and IPC records are capped at 2 MiB, while inbound child RPC records are capped at 16 MiB; the representable raw assignment size varies with JSON escaping. Artifact read requests may ask for up to 32 KiB, but the model-visible page is adaptively reduced to at most 3 KiB of source bytes so encoded tool output is never truncated after its cursor advances. Root and nested callers may retrieve only direct-child completion or failure artifacts; durable mailbox handoff artifacts are not readable through tools.

Child completion automatically reaches its direct parent in Codex-compatible `FINAL_ANSWER` form (`Task name`, `Sender`, `Payload`). Root notifications are hidden custom context messages rather than synthetic user messages; they do not start a new root turn while idle. Nested notifications use the same envelope through the authenticated mailbox.

Sockets and child processes start lazily. Each child receives one ephemeral capability through its private launch environment. Control paths, capabilities, credentials, and raw environments never enter prompts, results, journals, logs, or artifacts. Full completion output is stored behind an opaque artifact reference; model-visible previews and aggregates are bounded.

On session shutdown, the boundary rejects new work, stops IPC, interrupts and terminates residents, flushes journal/artifact work, and leaves recoverable sessions unloaded. Restart replays only the active parent branch and lazily reloads a child on follow-up. Closing an agent is terminal; interrupting it preserves resumability.

## Validation

From the repository root:

```bash
bun run test:pi-extensions subagent
bun run lint:pi-extensions
bun run typecheck:pi-extensions
bun run test:pi-extensions:e2e subagent
git diff --check
```

The E2E suite loads the extension explicitly with the deterministic faux provider, including a normal isolated child-extension discovery scenario that checks parent-boundary suppression and catalog collisions. It also installs the shipped advisor and worker definitions into isolated Pi agent directories and verifies that their complete instructions reach the child model. Those propagation checks explicitly override execution to the no-cost test model; discovery tests separately verify the shipped model/effort defaults. The deterministic provider proves runtime wiring, not whether a live model follows the prose. The directory also carries standalone `@0xthierry/pi-subagent` package metadata.
