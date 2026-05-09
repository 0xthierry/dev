# Pi Blueprint

Stripe-style local blueprint runner for Pi.

The extension registers `/blueprint`, which discovers blueprint definitions, hydrates task context, and runs a graph that can mix deterministic command nodes with isolated child `pi` sessions.

Blueprint isolation means isolated Pi sessions and LLM context, not filesystem isolation. Nodes run in the current checkout (`ctx.cwd`). Running a blueprint safely is the user's responsibility.

## Discovery

Blueprints are discovered from user and project directories:

- `~/.pi/agent/blueprints/`
- `~/.pi/blueprint/`
- `~/.pi/blueprints/`
- nearest `.pi/blueprint/`
- nearest `.pi/blueprints/`

Each blueprint can be either a top-level JSON file or a directory containing `blueprint.json`.

## Usage

```text
/blueprint
/blueprint implement-with-checks add a statusline branch indicator
/blueprint project/implement-with-checks fix failing extension tests
```

With no arguments, `/blueprint` lists discovered blueprints. With a name and task, it executes the selected blueprint.

## Blueprint format

```json
{
  "name": "implement-with-checks",
  "description": "Implement a task, run lint, and repair failures twice.",
  "start": "hydrate",
  "nodes": {
    "hydrate": {
      "type": "hydrate",
      "next": "implement"
    },
    "implement": {
      "type": "pi",
      "thinking": "high",
      "tools": ["read", "bash", "edit", "write"],
      "systemPrompt": "You are implementing a local task inside the current checkout.",
      "prompt": "Use the hydrated context and implement: {{input.task}}",
      "next": "lint"
    },
    "lint": {
      "type": "command",
      "run": "bun run lint:pi-extensions",
      "on": {
        "success": "done",
        "failure": "fix_lint"
      }
    },
    "fix_lint": {
      "type": "pi",
      "maxAttempts": 2,
      "tools": ["read", "bash", "edit", "write"],
      "prompt": "Lint failed.\n\nCommand:\n{{nodes.lint.command}}\n\nOutput:\n{{nodes.lint.output}}\n\nFix only those failures.",
      "next": "lint"
    },
    "done": {
      "type": "final",
      "message": "Blueprint completed."
    }
  }
}
```

## Node types

- `hydrate` — writes `context.md` for the run with task, checkout, git status, and package scripts.
- `command` — runs a deterministic shell command in the current checkout.
- `pi` — starts an isolated child `pi --mode json -p` session with node-specific prompt, tools, model, and thinking settings.
- `final` — terminates the graph successfully.

`maxAttempts` bounds how many times a node may execute in graph loops. `on.success` and `on.failure` route by node result; `next` is the default success route.

Run artifacts are stored under `~/.pi/agent/blueprint-runs/<repo>/<run-id>/` by default.
