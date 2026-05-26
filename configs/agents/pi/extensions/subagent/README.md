# Pi Subagent

Claude/Codex-style subagents for Pi.

This extension registers one `agent` tool that delegates focused work to child `pi` sessions. It is intentionally small: foreground execution, single-agent or independent parallel tasks, saved fresh context by default, optional forked context, resumable child sessions, and no background scheduler, memory store, pool, dashboard, or mux panes.

The agent tool renders live progress in Pi's tool row. Single-agent runs show the child assistant stream and tool activity as it arrives. Parallel runs show one batch with each agent's queued/running/succeeded/failed status, recent child tool calls, and final output/usage when available.

## Agent definitions

Two built-in agents are always available:

- `explorer` — fast, read-only codebase reconnaissance for specific, well-scoped questions. Uses `medium` effort.
- `worker` — bounded implementation agent for production changes, fixes, refactors, and validation. Uses `xhigh` effort.

Configured agents are Markdown files under project-local `.pi/agents` directories or Pi's normal agent config directory and override built-ins with the same name:

```text
.pi/agents/*.md
~/.pi/agent/agents/*.md
```

Project-local `.pi/agents` directories are discovered from the current working directory up to the git root and take precedence over global agents. The global directory uses `getAgentDir()/agents`, so `PI_CODING_AGENT_DIR` is respected. Files are discovered recursively and must include frontmatter:

```markdown
---
name: custom-reviewer
description: Reviews a focused code change.
effort: medium
---

Agent system prompt goes here.
```

Optional `effort` frontmatter sets the default child Pi thinking level for that agent. Supported values are `off`, `minimal`, `low`, `medium`, `high`, and `xhigh`. Agents without `effort` inherit the parent session's current thinking level. Built-in agents have pinned effort values listed above. A tool call can pass `effort` to override both the agent definition and parent thinking level for that run.

The child `pi` process loads Pi context files and skills through normal Pi discovery. A stable child-boundary prompt is prepended before the agent body so child sessions know the parent owns orchestration and that they must not run more subagents.

## Tool usage

Single task:

```json
{
  "subagent_type": "explorer",
  "description": "Find auth files",
  "effort": "low",
  "prompt": "Find the files that implement login and session validation."
}
```

Resume a previous child session using the `agent_id` returned by an earlier agent result:

```json
{
  "agent_id": "019e1882-8bc8-767c-a1e6-d7c9ebd3a574",
  "effort": "medium",
  "prompt": "Continue that review and now inspect authorization logic."
}
```

Parallel independent tasks:

```json
{
  "effort": "medium",
  "tasks": [
    { "subagent_type": "explorer", "effort": "low", "prompt": "Find auth files." },
    { "subagent_type": "web-search", "prompt": "Find current official docs for the auth provider." }
  ]
}
```

Prompt children with a compact contract: goal, context/evidence, success criteria, hard constraints, validation, expected output, and stop rules. Use parallel tasks only for independent work; do not hand off urgent blocking work when the parent session's next step depends on it. In parallel mode, top-level `effort` is the default for tasks that omit `effort`; a task-level value overrides it.

Context modes:

- `fresh` (default): starts an isolated saved child session.
- `fork`: forks the current saved parent session into a saved child session. This requires the parent session to have a session file.
- resume by `agent_id`: continues an existing saved child session with Pi's `--session` support.

Child sessions are saved under Pi's agent directory in a separate namespace that mirrors Pi's normal per-project session layout:

```text
~/.pi/agent/agent-sessions/--home-thierry-dev--/<timestamp>_<child-session-id>.jsonl
```

Child runs also receive an output artifact path and are instructed to write a detailed handoff report there. The final files live outside the parent conversation under the child session id:

```text
~/.pi/agent/agent-sessions-artifacts/<project-key>/<child-session-id>/artifacts/<timestamp>_<agent>_input.md
~/.pi/agent/agent-sessions-artifacts/<project-key>/<child-session-id>/artifacts/<timestamp>_<agent>_output.md
~/.pi/agent/agent-sessions-artifacts/<project-key>/<child-session-id>/artifacts/<timestamp>_<agent>.jsonl
~/.pi/agent/agent-sessions-artifacts/<project-key>/<child-session-id>/artifacts/<timestamp>_<agent>_meta.json
```

The child-authored `_output.md` file is the detailed result. If a child fails to write it, the extension falls back to the final assistant output. The parent tool result keeps only a compact preview plus artifact paths, including in `details.results`, so large child reports remain inspectable without being re-injected into parent context. `PI_CODING_AGENT_DIR` is respected, so custom Pi agent directories keep child sessions and artifacts beside the rest of that Pi state.

## Child process controls

The extension prevents recursive `agent` registration in child subagents with `PI_SUBAGENT_DEPTH`. Child Pi processes also load a tiny runtime context filter that removes inherited parent `agent` tool calls/results from forked or resumed child model context without modifying the saved parent session.

For tests or special launches, these environment variables tune child invocation:

- `PI_SUBAGENT_CHILD_NO_EXTENSIONS=1` adds `--no-extensions` for child sessions.
- `PI_SUBAGENT_CHILD_EXTENSIONS=/path/a:/path/b` adds explicit `-e` child extensions.
- `PI_SUBAGENT_CHILD_UNSET_ENV=NAME_ONE,NAME_TWO` removes parent-only env vars before spawning children.

## Validation

From the repository root:

```bash
bun run test:pi-extensions subagent
bun run test:pi-extensions:e2e subagent
bun run lint:pi-extensions
bun run typecheck:pi-extensions
```
