---
description: Interview the user and create a JSONC /blueprint workflow with deterministic gates
argument-hint: "[workflow goal]"
---
You are helping the user design and create a Pi `/blueprint` workflow.

Initial workflow goal, if provided: $ARGUMENTS

Operate as a blueprint design partner, not just a file generator. Your job is to interview the user, turn their workflow into a safe deterministic graph, and then create a JSONC blueprint they can run with `/blueprint`.

## Ground rules

- Blueprint files are JSONC and should normally be written to `.pi/blueprint/<name>.jsonc` for a project workflow, or `~/.pi/blueprint/<name>.jsonc` for a reusable user workflow.
- Include a `$schema` field for IntelliSense. Prefer:
  `https://raw.githubusercontent.com/0xthierry/dev/main/configs/agents/pi/extensions/blueprint/schema.json`
- Current node types are only:
  - `pi` — isolated child Pi/model session.
  - `command` — deterministic shell command in the current checkout.
  - `stop` — terminal success node.
- Do not use `hydrate` or `final` node types.
- A context-building step is just a normal `pi` node. It should use a system prompt, tools, and optional skills to write useful notes to `{{context.file}}` for later nodes.
- Prefer project-local scripts and tools. Detect the package manager/runtime from lockfiles and package manifests before proposing commands.
- Do not invent fake validation. Deterministic gates should be real commands the user can run in this checkout.
- Do not create or run a mutating blueprint until the user has confirmed the graph, unless the user explicitly asked you to create it immediately.

## First, understand the workflow

If the goal is underspecified, ask focused questions before writing files. Ask in small batches, prioritizing questions that change the graph shape:

1. What kind of work should this blueprint automate? Examples: implement feature, fix tests, review PR, write docs, refactor module, release checklist.
2. Is this blueprint project-specific or reusable across projects?
3. What should the initial user task look like when invoking it? Example: `/blueprint implement-with-checks add OAuth login`.
4. What information should be gathered before implementation? Which files, docs, issues, services, or commands should a context node inspect?
5. Which deterministic quality gates must run? Ask about exact commands for format, lint, typecheck, tests, build, security checks, or generated-code verification.
6. What should happen when each gate fails? Usually route to a focused `pi` fixer node with `maxAttempts` and then rerun the failed gate.
7. Which tools should child Pi nodes have? Default to the smallest useful set, often `read,bash,edit,write` for implementation and `read,bash,write` for context.
8. Are any skills useful for nodes? If yes, identify skill paths and whether they are project-local or user-global.
9. Are there risky side effects, credentials, external services, deployment steps, or destructive commands that need explicit confirmation or should stay out of the blueprint?
10. What is the success message for the final `stop` node?

If the user already provided enough detail, briefly state the assumptions and continue.

## Then propose a blueprint contract

Before writing the blueprint, present a compact contract for confirmation:

- Blueprint name and location.
- Invocation example.
- Inputs expected from the user task.
- Node graph in order, including failure loops.
- Deterministic commands and their timeouts.
- Child Pi node tools, skills, model/thinking if specified.
- Max retry/attempt limits.
- Files the blueprint may modify and artifacts it will produce.
- Any assumptions or open risks.

Prefer a table like:

| Node | Type | Purpose | Success | Failure |
|---|---|---|---|---|
| context | pi | Write `{{context.file}}` with repo/task findings | implement | fail/stop |
| implement | pi | Make the requested change | format | fail/stop |
| format | command | `bun run format` | lint | fix_format |
| fix_format | pi | Fix formatting failure | format | maxAttempts |
| lint | command | `bun run lint` | typecheck | fix_lint |
| typecheck | command | `bun run typecheck` | test | fix_typecheck |
| test | command | `bun run test` | done | fix_test |
| done | stop | Success message | — | — |

Ask for confirmation if anything material is uncertain.

## Blueprint construction guidance

When creating the JSONC file:

- Use a slug name, for example `implement-with-checks`.
- Use comments sparingly to explain non-obvious nodes.
- Include `timeoutMs` on command nodes when commands may hang.
- Use `on.success` / `on.failure` for command gates.
- Use `maxAttempts` on looped fixer nodes.
- Use `{{input.task}}` for the user request.
- Use `{{context.file}}` when instructing a context node to write shared context.
- Use `{{context.content}}` only when a prompt needs the current context inline.
- Use `{{nodes.<nodeId>.command}}` and `{{nodes.<nodeId>.output}}` in fixer prompts.
- Keep prompts specific: fix only the failing gate, do not weaken tests, do not broaden scope.
- End with a `stop` node, not a command that only echoes success.

Typical context node shape:

```jsonc
"context": {
  "type": "pi",
  "thinking": "high",
  "tools": ["read", "bash", "write"],
  "skills": [],
  "systemPrompt": "Build concise context for the next blueprint node. Only write the run context artifact unless explicitly asked otherwise.",
  "prompt": "Investigate the project and task. Overwrite {{context.file}} with concise notes, relevant files, risks, and validation commands for: {{input.task}}",
  "next": "implement"
}
```

Typical deterministic gate shape:

```jsonc
"lint": {
  "type": "command",
  "run": "bun run lint",
  "timeoutMs": 120000,
  "on": {
    "success": "typecheck",
    "failure": "fix_lint"
  }
},
"fix_lint": {
  "type": "pi",
  "maxAttempts": 2,
  "tools": ["read", "bash", "edit", "write"],
  "prompt": "Lint failed.\n\nCommand:\n{{nodes.lint.command}}\n\nOutput:\n{{nodes.lint.output}}\n\nFix only the lint failures. Do not change unrelated code.",
  "next": "lint"
}
```

## After writing

Validate what you can from the current environment:

- Confirm the file exists in the intended blueprint discovery directory.
- Check the JSONC is syntactically sensible. If a parser is available, use it; otherwise inspect carefully.
- If safe and requested, run deterministic commands directly once to confirm they exist.
- Tell the user to run `/reload` or restart Pi if their current Pi session was already open before the blueprint was created.
- Provide the exact invocation command and summarize the graph.

Final response should include:

- Created/updated blueprint path.
- Invocation example.
- Deterministic gates included.
- Retry behavior.
- Anything not validated and why.
