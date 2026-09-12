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
| [advisor](../../../agents/advisor.md) | `cliproxyapi/gpt-6-astra`, `xhigh` | Read-only decision advice through selected lenses |
| [worker](../../../agents/worker.md) | `cliproxyapi/gpt-5.6-sol`, `medium` | Bounded implementation and verification |

Both select and read definitions through the shared [engineering-principles skill](../../../skills/engineering-principles/SKILL.md). The skill includes progressive TypeScript and testing/Bun references. The built-in fallback remains minimal for standalone installations without these files.

A trusted project may add `.pi/agents/**/*.md`:

```markdown
---
name: worker
description: Implements bounded production changes.
provider: cliproxyapi
model: gpt-5.6-sol
effort: low
---

Project-specific worker instructions.
```

`provider` and `model` are optional but atomic: specify both or neither. These frontmatter values are agent file defaults. When a named agent's defaults match the assignment, callers should omit `execution` instead of restating them as invocation overrides. Project definitions and repository configuration are ignored when Pi does not trust the project. Discovery rejects duplicates within one source, applies deterministic project-over-global-over-built-in precedence across sources, and renders a name-sorted parent catalog without absolute paths or runtime state.

## Execution resolution

Provider, model, and effort are assignment settings. Model and effort resolve independently:

1. tool invocation;
2. trusted `pi-subagent.json`;
3. agent Markdown frontmatter;
4. current parent execution.

Provider and model must always be supplied together and the provider is never guessed from a model name. The selected Pi model must support the exact requested effort. General task recommendations use `low`, `medium`, and `high`; they do not override named profiles such as the advisor's `xhigh` default. The runtime retains Pi's broader effort support for agent files, explicit requests, and repository settings. Pi's model registry validates provider/model existence and authentication at the boundary, then credentials are immediately discarded. Children confirm their effective model and effort through RPC before accepting work. Follow-up execution changes perform model/thinking updates and state verification before prompting.

Example spawn override:

```json
{
  "task_name": "routine-review",
  "subagent_type": "advisor",
  "prompt": "Review this bounded patch for correctness and report exact evidence.",
  "execution": {
    "provider": "xai",
    "model": "grok-4.5",
    "effort": "medium"
  }
}
```

This routine-review example intentionally overrides the advisor's Astra `xhigh`
file default with Grok at medium effort. For advisor decision work, omit
`execution` so the file default applies.

## Model routing evidence

The `agent_spawn` description contains a stable, advisory provider/model selection
policy; `agent_followup` refers to the same policy. It directs callers to choose a
named agent whose file defaults fit the assignment and omit `execution` in that
case. Callers should set `execution` only when the user or concrete assignment
requests an override. This does **not** change execution defaults, install providers,
bypass repository locks, or promise authentication on another machine. An omitted
execution override still follows normal resolution.

### Recommended use

Choose a fitting named agent first and omit `execution` unless an override is needed. The table below guides tasks without a fitting named profile and deliberate overrides. It does not replace the model or effort declared by a matching profile: advisor decision work keeps `xhigh`, not the generic planning recommendation of `high`.

| Exact provider / model | Recommended work | Rationale and limitation |
|---|---|---|
| `cliproxyapi/gpt-6-astra` | Default for planning and design decisions; code review only when the user explicitly requests Astra | High effort |
| `cliproxyapi/gpt-5.6-luna` or `xai/grok-4.5` | Defaults for read-only codebase reconnaissance | Medium for locating files/symbols, tracing call paths, mapping dependencies, finding patterns, and explaining components; require paths and evidence |
| `cliproxyapi/gpt-5.6-sol` | Default for implementation and debugging | Low for small patches, medium for bounded multi-file changes, high for complex implementation/debugging |
| `xai/grok-4.5` | Default for routine code review, including ordinary correctness and security checks | Medium; provide an artifact and a specific question; require evidence |

Use `cliproxyapi/gpt-5.6-sol` instead of the reconnaissance profile for debugging
or edits. Use `cliproxyapi/gpt-6-astra` with high effort for planning and design
decisions. Use `xai/grok-4.5` for routine code review, and Astra for code review
only when the user explicitly requests it. These are the user's routing
preferences, not benchmark claims.
An Astra parent should delegate implementation and debugging to Sol with
non-overlapping ownership. Honor user choices and repository locks. Prefer a named
agent with matching file defaults and omit `execution`; when an override is needed,
supply provider and model together while effort remains independently overridable.
Inspect the returned effective settings.

**Effort is workflow policy, not a benchmark-proven optimum.** The general task
recommendations use low, medium, and high. Named profiles can declare other supported
levels. Neither the table nor its examples override matching agent defaults,
repository precedence, or accepted schema values.

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
- [OpenAI's latest-model guide](https://developers.openai.com/api/docs/guides/latest-model)
  describes stronger software-engineering results and fewer output tokens for
  Astra in several evaluations. Its prompting advice supports explicit delegation
  and proportionate verification. It does not prescribe a universal low-effort
  migration: it advises preserving effective effort except when moving from its
  non-reasoning/lightest settings.
- [Codex's model catalog](https://github.com/openai/codex/blob/main/codex-rs/models-manager/models.json)
  describes Luna as a fast, affordable agentic coding model, with medium as its
  default effort; Astra's default is low. Assigning Luna to read-only reconnaissance
  is this repository's workflow policy.
- The user-provided Terminal-Bench 4.0 chart shows the lowest-cost Astra point at
  approximately 50% accuracy and $5, above Sol's best plotted point at approximately
  38% and $8. Individual effort labels, error bars, and cost aggregation are absent
  from the screenshot. This supports revisiting the execution default, but is not
  a locally reproduced Pi benchmark or proof of subscription savings.

Benchmark details and pricing belong here, not in the model-facing tool prompt.
Both parent and nested tools receive the same model-selection guidance.

### Directly checked public evidence (2026-09-05)

- **[Artificial Analysis: Astra, September 3](https://artificialanalysis.ai/articles/benchmarking-gpt-6-astra):**
  Astra in Codex scored **67** on the Coding Agent Index. In the reported
  highest-effort comparison it scored **2 points above Sol at approximately the
  same API task cost**, using roughly
  **one-third as many tokens**. This supports using Astra for difficult implementation,
  not treating it as an expensive review-only model. On the separate Intelligence
  Index **v4.1.1**, both scored 61 and Astra cost **75% more per task**; cost advantage
  depended on the workload. AA-Omniscience hallucination rates fell from 92% to 51%
  on that particular evaluation, not a general code-verification accuracy measure.
- **[Artificial Analysis: Index v4.2, September 4](https://artificialanalysis.ai/articles/artificial-analysis-intelligence-index-v4-2):**
  The updated index puts Astra **4 points above Sol**; GDP.pdf all-pass rates are
  **33.2% versus 28.2%**, and AA-Briefcase improves roughly **85 Elo**. This strengthens
  the case for complex synthesis/planning, but these are not dedicated debugging
  or patch-review benchmarks. The index changes tasks, weighting, and grading;
  do not describe the earlier 61-point tie as the current index result.

These are independently published evaluations that were read, **not benchmarks run
locally**. Do not compare different index versions, Terminal-Bench versions, harnesses,
reasoning levels, or historical prices as if they were one controlled experiment.
No same-task, same-harness Pi comparison of these models was performed. We have no measured
subscription-allowance conversion or universal latency ordering. Track completed-task
quality, wall time, retries, allowance consumption, and cache reuse before tightening
these recommendations.

### Official specifications and API price references

USD per million tokens, standard short-context requests, checked 2026-09-05:

| Official model documentation | Input | Cached input | Output |
|---|---:|---:|---:|
| [GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol.md) | $4 | $0.40 | $20 |
| [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra.md) | $10 | $1 | $50 |
| [Grok 4.5](https://docs.x.ai/developers/models/grok-4.5) | $2 | $0.30 | $6 |

OpenAI applies higher full-request rates above 272K input tokens; xAI documents a
higher-context pricing tier above 200K. Cache writes, tools, fast/priority modes,
and other service tiers may have additional/different prices. Sol's quoted rates
are promotional, documented through at least November 21, 2026. Headline token
prices alone do not determine cost per successful task.

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
        "model": "gpt-5.6-sol",
        "effort": "low"
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
