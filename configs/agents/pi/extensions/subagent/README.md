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
