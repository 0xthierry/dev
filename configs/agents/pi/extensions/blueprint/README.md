# Pi Blueprint

Stripe-style local blueprint runner for Pi.

The extension registers `/blueprint`, discovers JSONC blueprint definitions, writes a run `context.md`, and runs a graph that mixes deterministic command nodes with isolated child `pi` sessions.

Blueprint isolation means isolated Pi sessions and LLM context, not filesystem isolation. Nodes run in the current checkout (`ctx.cwd`). Running a blueprint safely is the user's responsibility.

## Discovery

Blueprints are discovered from user and project directories:

- `~/.pi/agent/blueprints/`
- `~/.pi/blueprint/`
- `~/.pi/blueprints/`
- nearest `.pi/blueprint/`
- nearest `.pi/blueprints/`

Each blueprint should be a `.jsonc` file. A blueprint directory may contain `blueprint.jsonc`. The loader still accepts `.json` and `blueprint.json` for existing blueprints, but new definitions should use JSONC.

## JSON schema

Use the bundled schema for editor IntelliSense:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/0xthierry/dev/main/configs/agents/pi/extensions/blueprint/schema.json",
  "name": "implement-with-checks",
  "nodes": {}
}
```

The same schema is tracked in this extension at [`schema.json`](./schema.json). If you want offline IntelliSense, point `$schema` at a local checkout or installed extension path.

## Usage

```text
/blueprint
/blueprint implement-with-checks add a statusline branch indicator
/blueprint project/implement-with-checks fix failing extension tests
```

With no arguments, `/blueprint` lists discovered blueprints. With a name and task, it executes the selected blueprint. The first argument autocompletes discovered blueprint IDs and unique short names.

When a blueprint starts, Pi shows one live workflow card in the transcript and updates that card while the run is active, then replaces it with the finalized persisted card. The card shows the blueprint name, task, run id, per-node state, command routes, child Pi assistant/tool activity for running `pi` nodes, and artifact path.

## Blueprint format

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/0xthierry/dev/main/configs/agents/pi/extensions/blueprint/schema.json",
  "name": "implement-with-checks",
  "description": "Implement a task, run format/lint/typecheck/tests, and repair failures twice.",
  "start": "context",
  "nodes": {
    // A context-building step is just a normal pi node. It can use tools,
    // skills, and a system prompt to write the run's context.md file.
    "context": {
      "type": "pi",
      "thinking": "high",
      "tools": ["read", "bash", "edit", "write"],
      "skills": ["./skills/research/SKILL.md"],
      "systemPrompt": "Build concise implementation context for the next blueprint step.",
      "prompt": "Read the task and project. Write useful findings to {{context.file}} for the next node. Task: {{input.task}}",
      "next": "implement"
    },
    "implement": {
      "type": "pi",
      "thinking": "high",
      "tools": ["read", "bash", "edit", "write"],
      "systemPrompt": "You are implementing a local task inside the current checkout.",
      "prompt": "Use {{context.file}} and implement: {{input.task}}",
      "next": "format"
    },
    "format": {
      "type": "command",
      "run": "bun run format",
      "on": {
        "success": "lint",
        "failure": "fix_format"
      }
    },
    "fix_format": {
      "type": "pi",
      "maxAttempts": 2,
      "tools": ["read", "bash", "edit", "write"],
      "prompt": "Format failed.\n\nCommand:\n{{nodes.format.command}}\n\nOutput:\n{{nodes.format.output}}\n\nFix only those failures.",
      "next": "format"
    },
    "lint": {
      "type": "command",
      "run": "bun run lint",
      "on": {
        "success": "typecheck",
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
    "typecheck": {
      "type": "command",
      "run": "bun run typecheck",
      "on": {
        "success": "test",
        "failure": "fix_typecheck"
      }
    },
    "fix_typecheck": {
      "type": "pi",
      "maxAttempts": 2,
      "tools": ["read", "bash", "edit", "write"],
      "prompt": "Typecheck failed.\n\nCommand:\n{{nodes.typecheck.command}}\n\nOutput:\n{{nodes.typecheck.output}}\n\nFix only those failures.",
      "next": "typecheck"
    },
    "test": {
      "type": "command",
      "run": "bun run test",
      "on": {
        "success": "done",
        "failure": "fix_test"
      }
    },
    "fix_test": {
      "type": "pi",
      "maxAttempts": 2,
      "tools": ["read", "bash", "edit", "write"],
      "prompt": "Tests failed.\n\nCommand:\n{{nodes.test.command}}\n\nOutput:\n{{nodes.test.output}}\n\nFix the implementation. Do not weaken tests.",
      "next": "format"
    },
    "done": {
      "type": "stop",
      "message": "Blueprint completed."
    }
  }
}
```

## Node types

- `pi` — starts an isolated child `pi --mode json -p` session with node-specific prompt, tools, skills, model, and thinking settings. Pi nodes can read or write `{{context.file}}`; the runner refreshes `{{context.content}}` after each node.
- `command` — runs a deterministic shell command in the current checkout.
- `stop` — terminates the graph successfully.

`maxAttempts` bounds how many times a node may execute in graph loops. `on.success` and `on.failure` route by node result; `next` is the default success route.

Run artifacts are stored under `~/.pi/agent/blueprint-runs/<repo>/<run-id>/` by default.
