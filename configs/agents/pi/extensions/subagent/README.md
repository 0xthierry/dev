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

All seven tools are registered once in that order. Children receive the same catalog through authenticated session-scoped IPC and share the root scheduler, filesystem, and working directory. The parent entrypoint suppresses itself in child launches so an explicit child runtime owns the proxy catalog.

## Agents

Built-in `scout` and `worker` definitions are always available. Global Markdown definitions are read from Pi's agent directory. A trusted project may add `.pi/agents/**/*.md`:

```markdown
---
name: worker
description: Implements bounded production changes.
provider: openai-codex
model: gpt-5.4
effort: high
---

Project-specific worker instructions.
```

`provider` and `model` are optional but atomic: specify both or neither. Project definitions and repository configuration are ignored when Pi does not trust the project. Discovery rejects duplicates within one source, applies deterministic project-over-global-over-built-in precedence across sources, and renders a name-sorted parent catalog without absolute paths or runtime state.

## Execution resolution

Provider, model, and effort are assignment settings. Model and effort resolve independently:

1. tool invocation;
2. trusted `pi-subagent.json`;
3. agent Markdown frontmatter;
4. current parent execution.

Provider and model must always be supplied together and the provider is never guessed from a model name. Supported effort names are `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`; the selected Pi model must support the exact requested effort. Pi's model registry validates provider/model existence and authentication at the boundary, then credentials are immediately discarded. Children confirm their effective model and effort through RPC before accepting work. Follow-up execution changes perform model/thinking updates and state verification before prompting.

Example spawn override:

```json
{
  "task_name": "auth-review",
  "subagent_type": "scout",
  "prompt": "Review authentication boundaries and report exact evidence.",
  "execution": {
    "provider": "openai-codex",
    "model": "gpt-5.4",
    "effort": "high"
  }
}
```

## Model routing evidence

The `agent_spawn` description contains a stable, advisory provider/model selection
policy; `agent_followup` refers to the same policy. This does **not** change execution
defaults, install providers, bypass repository locks, or promise authentication on
another machine. An omitted execution override still follows normal resolution.

### Recommended use

| Exact provider / model | Recommended work | Rationale and limitation |
|---|---|---|
| `cliproxyapi` / `gpt-5.6-sol` | Baseline for well-specified implementation, tests, refactors, routine debugging, straightforward plans | Established coding capability and lower API token prices; a pragmatic baseline, not a proven subscription-cost winner |
| `cliproxyapi` / `gpt-6-astra` | Complex implementation, difficult debugging, constrained architecture/planning, demanding verification | Better measured coding efficiency and stronger complex analytical results; not restricted to review and not automatically necessary for every plan |
| `xai` / `grok-4.6` | Substantive implementation, terminal/tool-heavy tasks, research, independent cross-provider review | Strong independent agentic results and better aggregate results than 4.5 at unchanged uncached API prices |
| `xai` / `grok-4.5` | Availability fallback, retained-session continuation, or measured cache-heavy advantage | Cheaper cached input, but no evidence that it is universally faster or cheaper per completed task; prefer 4.6 for new Grok assignments |

**Effort is a practical policy, not a benchmark finding:** start at low for narrow
reconnaissance, medium for bounded work, and high for complex work or demanding
verification. Reserve xhigh/max for justified escalation. Public headline comparisons
do not establish the optimal effort for these specific roles in Pi. A model review
still requires evidence, tests, and parent verification; confidence is not proof.

The repository's pool models support low/medium/high/xhigh/max. Pi 0.85.0's inspected
Grok catalog supports low/medium/high for 4.5 and additionally xhigh for 4.6. Follow
Pi's exact supported levels even if upstream documentation later adds more options.

### Directly checked public evidence (2026-09-05)

- **[Artificial Analysis: Astra, September 3](https://artificialanalysis.ai/articles/benchmarking-gpt-6-astra):**
  Astra in Codex scored **67** on the Coding Agent Index. At max effort it scored
  **2 points above Sol max at approximately the same API task cost**, using roughly
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
- **[Artificial Analysis: Grok 4.6, August 12](https://artificialanalysis.ai/articles/grok-4-6-benchmarks-and-analysis):**
  Grok 4.6 scored **61**, five points above 4.5, on that dated Intelligence Index;
  **88.4%** on Terminal-Bench **v2.1**; **1753 Elo** on GDPval-AA v2; and cost
  **$0.84 per Intelligence Index task**. Its comparison used Sol's older $5/$30
  pricing, not today's $4/$20. These dated results support Grok as a real agentic
  alternative, not an exact current ranking against Astra in Pi.

These are independently published evaluations that were read, **not benchmarks run
locally**. Do not compare different index versions, Terminal-Bench versions, harnesses,
reasoning levels, or historical prices as if they were one controlled experiment.
No same-task, same-harness Pi comparison of all four was performed. We have no measured
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
| [Grok 4.6](https://docs.x.ai/developers/models/grok-4.6) | $2 | $0.50 | $6 |

OpenAI applies higher full-request rates above 272K input tokens; xAI documents a
higher-context pricing tier above 200K. Cache writes, tools, fast/priority modes,
and other service tiers may have additional/different prices. Sol's quoted rates
are promotional, documented through at least November 21, 2026. Headline token
prices alone do not determine cost per successful task.

**Subscription routing is separate from API pricing.** `cliproxyapi` is this repo's
local Codex subscription pool; `openai-codex` is a direct subscription alternative,
not another pool. Prefer `xai` with configured Grok subscription OAuth rather than
an OpenRouter route. Pi supports both OAuth and API-key auth for xAI, so the provider
ID alone does not prove subscription billing. `openai`, `openrouter`, and API-key
routes are not automatic subscription fallbacks. Authentication and entitlements
must be available on the machine that spawns the child. Zero/missing cost metadata
for a subscription route means unrepresented cost, not free or unlimited usage.

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
        "provider": "openai-codex",
        "model": "gpt-5.4",
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

The E2E suite loads the extension explicitly with the deterministic faux provider, including a normal isolated child-extension discovery scenario that checks parent-boundary suppression and catalog collisions. The directory also carries standalone `@0xthierry/pi-subagent` package metadata.
