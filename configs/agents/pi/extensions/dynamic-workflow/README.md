# Pi Dynamic Workflow

Deterministic, model-written workflow orchestration for Pi.

This extension registers one `workflow` tool. The tool executes a plain JavaScript workflow script in a small VM sandbox. Workflow scripts can mark phases, log progress, call child Pi agents, fan work out with `parallel()`, and run item pipelines with `pipeline()`.

Use it for explicit fan-out/fan-in tasks: repository audits, multi-perspective review, independent research/checks, and synthesis work. Do not use it for quick reads, edits, or ordinary single-agent work.

## Script shape

```js
export const meta = {
  name: "inspect_project",
  description: "Inspect a repository and summarize the main modules",
  phases: [{ title: "Scan" }, { title: "Analyze" }],
}

phase("Scan")
const inventory = await agent("Inspect the repository structure.", { label: "repo inventory" })

phase("Analyze")
const summary = await agent("Summarize the modules from this inventory:\n" + inventory, {
  label: "module summary",
})

return { inventory, summary }
```

## Globals

- `agent(prompt, opts)` — run one focused child Pi agent.
- `parallel(thunks)` — run `() => agent(...)` thunks concurrently and preserve input order.
- `pipeline(items, ...stages)` — run sequential stages per item while items fan out.
- `phase(title)` — set the current phase for progress display.
- `log(message)` — append a workflow log line.
- `args` — optional JSON value from the tool call.
- `cwd`, `process.cwd()` — parent working directory.
- `budget` — `{ total, spent(), remaining() }` token-ish budget tracker.

If `agent()` receives `opts.schema`, the child Pi session gets a temporary `structured_output` tool and must finish by calling it.

## Runtime model

Child agents are real child `pi --mode json -p` sessions, not in-memory callbacks. Their sessions and artifacts are saved under Pi's agent directory:

```text
~/.pi/agent/workflow-runs/<project>/<workflow>/<run-id>/
```

The parent tool result keeps a compact preview and artifact paths so large child outputs stay inspectable without flooding parent context.

## Child process controls

- `PI_DYNAMIC_WORKFLOW_CHILD_NO_EXTENSIONS=1` adds `--no-extensions` to child Pi invocations.
- `PI_DYNAMIC_WORKFLOW_CHILD_EXTENSIONS=/path/a:/path/b` adds explicit child extensions.
- `PI_DYNAMIC_WORKFLOW_CHILD_UNSET_ENV=NAME_ONE,NAME_TWO` removes parent-only env vars before spawning children.

`PI_DYNAMIC_WORKFLOW_DEPTH` prevents recursive registration in child processes.

## Validation

```bash
bun run test:pi-extensions dynamic-workflow
bun run test:pi-extensions:e2e dynamic-workflow
bun run lint:pi-extensions
bun run typecheck:pi-extensions
```
