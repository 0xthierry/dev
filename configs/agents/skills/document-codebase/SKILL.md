---
name: document-codebase
description: "Use when asked to document, map, explain, or research how a current codebase feature, module, flow, API, integration, or test area works."
effort: high
disable_model_invocation: true
disable-model-invocation: true
---

# Document Codebase

## Goal

Produce current-state codebase documentation with concrete source evidence while keeping broad exploration out of the main context.

Good documentation explains what exists today: relevant files, entry points, data/control flow, contracts, state, configuration, tests, operational boundaries, and open evidence gaps. It does not design future changes unless the user explicitly asks for recommendations.

## When to Use

Use this skill when the user asks to document or explain a codebase area, map files for a feature, understand how a flow works, produce current-state research, or create handoff context for later planning.

Use `create-research-codebase` instead when the user specifically wants the `ai_docs/tasks/.../*-research.md` artifact from a research-questions document.

## Success Criteria

Before final response or document handoff:

- The documentation scope is explicit: feature, module, flow, API, integration, tests, or files.
- Parallel `explorer` subagents covered distinct documentation slices when the scope is broad enough.
- Important claims include `path:line` evidence or are clearly labeled as open questions.
- The parent spot-checked key or surprising claims before synthesis.
- Tests/fixtures and validation commands are documented when relevant, or the search for them is named.
- The output is factual and current-state only unless the user asked for advice.

## Operating Rules

- Parent session owns orchestration, synthesis, and final writing. Do not pass this skill to children.
- Use fresh-context `explorer` subagents for independent documentation slices.
- Children are read-only documentarians. Their prompts must say: do not edit, stage, commit, or revert files.
- Use `web-search` only when external API/docs behavior is required to understand the codebase area or the user explicitly asks for external evidence.
- Do not launch one subagent per tiny question. Group work by code boundary so each child can return a useful slice.
- Stop exploration when the requested documentation can be supported with evidence; do not keep searching for decorative completeness.

## Workflow

### 1. Resolve scope and output

Identify:

- topic/feature/flow to document;
- desired output shape: final answer, Markdown file, `ai_docs/tasks` artifact, or handoff context;
- boundaries and non-goals;
- whether external sources are required.

Ask a narrow clarification only when the topic or output location is unsafe to infer.

### 2. Build a documentation agenda

For a narrow target, one or two `explorer` agents may be enough. For broader areas, launch three to five parallel agents with distinct slices:

1. **File map and entry points** — source files, routes, commands, UI surfaces, jobs, configs, docs, and tests.
2. **Control/data flow** — how requests/events/data move through functions, classes, services, stores, queues, or processes.
3. **Contracts and state** — types, schemas, API shapes, persistence, cache keys, env/config, ownership, lifecycle, and error boundaries.
4. **Patterns and tests** — comparable implementations, fixtures, mocks, assertion style, validation commands, and coverage gaps.
5. **External/operational boundaries** — provider docs, SDK behavior, credentials, deployment/runtime constraints, permissions, failure modes, and observability.

Example agent tool shape:

```json
{
  "tasks": [
    {
      "subagent_type": "explorer",
      "description": "File map",
      "prompt": "Document the file map and entry points for [scope]. Return grouped repository-relative paths with line references for imports/routes/exports where relevant. Do not edit files. Include tests/docs/config if found and name searches that found nothing."
    },
    {
      "subagent_type": "explorer",
      "description": "Control flow",
      "prompt": "Trace the current control/data flow for [scope]. Read entry points, callers/callees, data transformations, errors, and state changes. Return factual findings with path:line evidence only. Do not recommend changes or edit files."
    }
  ],
  "context": "fresh"
}
```

Add a `web-search` task only when external facts are required:

```json
{
  "subagent_type": "web-search",
  "description": "External API contract",
  "prompt": "Research the current official documentation for [provider/API behavior] needed to interpret [codebase integration]. Return source links, version/date context, conflicts, and confidence."
}
```

### 3. Gather and spot-check evidence

After subagents return:

- read key files directly when a claim is central, surprising, cross-cutting, or likely to be reused later;
- resolve conflicts between subagent findings by reading the source of truth;
- use targeted search only for material gaps;
- record absent tests/config only after naming the search locations or commands.

### 4. Synthesize documentation

Choose the smallest useful output for the user request.

For a final-answer map:

```markdown
## Scope
[what was documented]

## Summary
[3-6 factual bullets]

## File Map
- `path:line` — [role]

## How It Works
1. `path:line` starts [flow]
2. `path:line` transforms/persists/calls [thing]

## Contracts, State, and Config
- `path:line` — [type/schema/env/state]

## Tests and Validation
- `path:line` — [coverage/pattern]
- Commands: [known commands or "not found"]

## Open Questions
[Evidence gaps only, or "None."]
```

For a file artifact, add frontmatter with topic, date, repository, branch, commit, working-tree state, source prompts/files, and agents used.

## Validation

Before final response:

- confirm the requested output exists if a file was requested;
- verify frontmatter parses when writing a document;
- ensure no placeholders remain;
- ensure key claims include `path:line` evidence;
- ensure agent roles/areas are named when subagents were used;
- report any command that could not run and why.

## Common Mistakes

- Producing recommendations when the user asked for documentation.
- Reading huge code areas in the parent instead of delegating slices.
- Trusting subagent findings without spot-checking central claims.
- Reporting "no tests" without naming where tests were searched.
- Creating too many agents for a narrow question.
- Omitting contracts/config because the visible entry point seemed simple.
