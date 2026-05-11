# Pi Subagent

Claude/Codex-style subagents for Pi.

This extension registers one `Agent` tool that delegates focused work to child `pi` sessions. It is intentionally small: foreground execution, single-agent or independent parallel tasks, fresh context by default, optional forked context, and no background scheduler, memory store, pool, dashboard, or mux panes.

The Agent tool renders live progress in Pi's tool row. Single-agent runs show the child assistant stream and tool activity as it arrives. Parallel runs show one batch with each agent's queued/running/succeeded/failed status, recent child tool calls, and final output/usage when available.

## Agent definitions

Two built-in agents are always available:

- `explorer` — fast, read-only codebase reconnaissance for specific, well-scoped questions.
- `worker` — bounded implementation agent for production changes, fixes, refactors, and validation.

Configured agents are Markdown files under Pi's normal agent config directory and override built-ins with the same name:

```text
~/.pi/agent/agents/*.md
```

The extension uses `getAgentDir()/agents`, so `PI_CODING_AGENT_DIR` is respected. Files are discovered recursively and must include frontmatter:

```markdown
---
name: codebase-locator
description: Finds files relevant to a feature or task.
effort: medium
---

Agent system prompt goes here.
```

Optional `effort` frontmatter sets the child Pi thinking level for that agent. Supported values are `off`, `minimal`, `low`, `medium`, `high`, and `xhigh`. Agents without `effort` inherit the parent session's current thinking level.

The child `pi` process loads Pi context files and skills through normal Pi discovery. A stable child-boundary prompt is prepended before the agent body so child sessions know the parent owns orchestration and that they must not run more subagents.

## Tool usage

Single task:

```json
{
  "subagent_type": "codebase-locator",
  "description": "Find auth files",
  "prompt": "Find the files that implement login and session validation."
}
```

Parallel independent tasks:

```json
{
  "tasks": [
    { "subagent_type": "codebase-locator", "prompt": "Find auth files." },
    { "subagent_type": "codebase-pattern-finder", "prompt": "Find comparable auth tests." }
  ]
}
```

Prompt children with a compact contract: goal, context/evidence, success criteria, hard constraints, validation, expected output, and stop rules. Use parallel tasks only for independent work; do not hand off urgent blocking work when the parent session's next step depends on it.

Context modes:

- `fresh` (default): starts an isolated child session with `--no-session`.
- `fork`: forks the current saved parent session. This requires the parent session to have a session file.

## Child process controls

The extension prevents recursive `Agent` registration in child subagents with `PI_SUBAGENT_DEPTH`.

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
