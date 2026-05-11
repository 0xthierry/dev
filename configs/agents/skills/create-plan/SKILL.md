---
name: create-plan
description: "Use when converting a structure outline into a complete implementation plan and .sprint-contract.json for phased implementation/evaluation."
effort: max
disable_model_invocation: true
disable-model-invocation: true
---

# Create Plan

## Goal

Produce the final pre-implementation artifacts:

- `ai_docs/tasks/TASKNAME/YYYY-MM-DD-plan.md`
- `ai_docs/tasks/TASKNAME/.sprint-contract.json`

Good output lets an implementer complete each phase without making new design decisions and lets an evaluator verify the work from machine-readable criteria. The plan should be concrete enough to code from, traceable to the structure outline/design/research, and strict about tests, failure behavior, and validation.

## When to Use

Use this skill when the user asks to write the implementation plan, continue after `create-structure-outline`, or convert a structure outline into detailed implementation instructions.

Use a different skill when the user wants:

- neutral current-state questions: `create-research-questions`
- objective codebase research: `create-research-codebase`
- design tradeoffs: `create-design-discussion`
- phased outline only: `create-structure-outline`
- code changes: `implement-plan`

## Success Criteria

Before final response:

- A plan file exists at `ai_docs/tasks/TASKNAME/YYYY-MM-DD-plan.md`.
- A sprint contract exists at `ai_docs/tasks/TASKNAME/.sprint-contract.json`.
- The plan cites the source outline, design discussion, research, and task inputs used.
- Every phase from the structure outline is represented, or a documented reason explains any merge/split.
- Every desired outcome, resolved design decision, and design preference is mapped to concrete implementation steps.
- Every referenced type, interface, schema, config key, API shape, fixture, or test helper in plan code has been read from its actual source.
- Code blocks intended for implementation contain complete logic for the changed region; no stubs, TODOs, guessed types, or deferred branches remain.
- Tests assert concrete values and cover meaningful branches, edge cases, and failure behavior.
- Every phase has automated success criteria and evaluator-compatible sprint-contract criteria.
- Manual verification appears only when automation cannot provide the needed evidence.
- Regression commands are included in the sprint contract.
- The final response follows `references/plan_final_answer.md`.

## Iron Laws

- **No stubs, no deferred logic.** Never write placeholder bodies, TODO comments, fake providers, `return []` as future work, or "implement later" branches.
- **No guessed shapes.** Read the actual source definition before referencing a type, schema, enum, config key, external response shape, fixture, or mock interface.
- **No hidden design work for implementers.** If the implementer would need to choose among options, resolve the decision now or return to design/outline.
- **No unverifiable success claims.** Each important behavior needs an automated check, a gated smoke/contract check, or a clearly stated manual validation reason.
- **No source edits.** This skill writes planning artifacts only; implementation belongs to `implement-plan`.

## Operating Rules

- Start multi-step work with a brief user-visible preamble before tool calls.
- Read mentioned files fully before using agents or writing the plan. If an `ai_docs/tasks/TASKNAME` directory is provided, list it and read relevant task documents.
- Treat the latest structure outline as the primary source for phase order and implementation shape.
- Treat the latest design discussion as the primary source for design decisions and design preferences.
- Treat research and source/tests as the primary source for current code behavior, patterns, types, and validation conventions.
- If a material open question affects code, tests, data, compatibility, or external behavior, ask a narrow question or return to the appropriate earlier phase. Do not bury it in the plan.
- User feedback during this phase updates the plan; it does not authorize implementation.

## Available Research Agents

Use subagents for targeted evidence gathering, then read the actual files yourself before writing final code blocks.

- **explorer / file-map prompt**: find source files, tests, fixtures, schemas, config, package scripts, migrations, routes, or command definitions.
- **explorer / narrow-fact prompt**: trace a current behavior, data flow, type contract, lifecycle, failure path, or integration boundary.
- **explorer / pattern prompt**: find comparable implementation and test examples to copy structurally in the plan.
- **web-search**: use only for external SDK/API/platform behavior that the plan must encode. Require source links.

Use concise prompts, for example:

```text
Find the actual source definitions, test helpers, and command entrypoints needed to write complete plan code for [phase/area]. Return file:line evidence only; do not propose implementation choices.
```

## Retrieval Budget

Use the minimum evidence that can produce a correct, code-ready plan.

1. Read the task directory inputs: latest structure outline, design discussion, research, research questions, ticket/spec, related grill notes, and existing plan/contract if updating.
2. Extract phases, decisions, preferences, desired outcomes, file groups, validation strategy, and plan-prep notes.
3. Read source/test/type/config files named by the outline or needed by code blocks. Use agents only to find missing definitions, commands, fixtures, or comparable patterns.
4. Expand evidence only when a code block would otherwise use an unknown type, branch, dependency, error shape, command, or test fixture.
5. Stop when each phase can be implemented with zero design questions and every automated criterion can be represented in `.sprint-contract.json`.

Do not keep researching to make the plan encyclopedic. The plan should be complete where implementation depends on precision and concise where source references are enough.

## Plan Writing Rules

### Code blocks

- Include full logic for the changed function/method/schema/test block, not just signatures.
- Use diffs or focused code blocks when they improve implementability; do not paste entire files unless necessary.
- If a block contains branching logic, mentally trace at least one concrete input through every branch before finalizing it.
- If a value is transformed or inferred, the planned output must match runtime behavior, not just static shape.
- Do not introduce wrappers, aliases, abstractions, or new modules unless the outline/design requires them or they remove real duplication/testability friction.

### Tests

- Assert values, not mere existence.
- Cover happy path, edge cases, and error/failure paths that matter for the changed behavior.
- Place tests according to existing conventions found in source/research.
- Reuse or extend existing fixtures/helpers where appropriate; create shared fixtures only when multiple tests need them.
- Include gated live smoke/contract checks for real external integrations when practical, using explicit enable flags and redacted output.

### Validation

- Prefer targeted tests for each phase plus regression commands across the whole project.
- Include typecheck/lint/build commands when the stack supports them.
- Manual validation should be specific and evidence-oriented, not generic "click around" instructions.
- If a validation command cannot be known from the repo, document the command-discovery blocker and next best check.

### Sprint contract

Write `.sprint-contract.json` in the same task directory as the plan. It is the evaluator's primary automated source of truth.

Supported criterion types:

- `command`: `{ "type": "command", "cmd": "bun test path", "expect": "exit 0" }`
- `curl`: `{ "type": "curl", "url": "http://localhost:3000/health", "method": "GET", "expect_status": 200 }`
- `file_exists`: `{ "type": "file_exists", "path": "src/file.ts" }`
- `grep`: `{ "type": "grep", "file": "src/file.ts", "pattern": "export function name" }`

Every automated criterion in the plan must appear in the contract. Regression commands belong under `regression.commands`.

## Workflow

### 1. Resolve inputs and task directory

- If invoked without a task directory or structure outline, ask for the smallest missing input.
- If given `ai_docs/tasks/TASKNAME`, list the directory and identify the latest relevant `*-structure-outline.md`, `*-design-discussion.md`, `*-research.md`, ticket/spec, existing plan, and `.sprint-contract.json` if present.
- Use today's local date for `YYYY-MM-DD-plan.md` and write into the task directory.

### 2. Read and verify planning context

Read selected inputs fully. Extract:

- phase list and coverage map from the structure outline;
- design decisions and design preferences;
- current architecture and patterns;
- desired outcomes and non-goals;
- validation commands and testing conventions;
- plan-prep files/types/schemas/tests to inspect;
- open questions that could block implementation.

If documents conflict, apply precedence:

```text
plan feedback > structure outline > design discussion > research > ticket/spec
```

For current code facts, source/tests outrank summaries. For desired behavior, the latest user/design/outline feedback outranks the original ticket.

### 3. Read implementation evidence

For each phase, read the actual source files needed to write complete steps and code blocks:

- files to modify and nearby callers;
- type/interface/schema/model definitions;
- config keys, environment variables, routes, jobs, migrations, and generated data contracts;
- test files, fixtures, mocks, factories, and assertion style;
- package scripts, Makefile targets, or other validation commands.

Use agents to locate missing evidence, then read the referenced files directly before writing code-level instructions.

### 4. Write the plan

Read `references/plan_template.md` before writing. Populate every section with real values; do not leave placeholders.

For each phase:

- include a phase-level completion checkbox for resumability;
- state objective, dependencies, implementation steps, failure behavior, tests, and success criteria;
- include concrete file-by-file code instructions;
- include complete test additions/updates with concrete assertions;
- include automated verification commands and expected outcomes;
- include manual verification only when needed;
- include a human checkpoint if manual verification is required.

### 5. Write the sprint contract

Create or replace `.sprint-contract.json` with valid JSON matching the plan's automated criteria. Include:

- every phase by number and name;
- every automated phase criterion;
- regression commands for the full suite/typecheck/lint/build where available.

Do not include secrets or environment values. External live checks must be gated by environment-driven commands that redact output.

### 6. Self-review before final response

Review as the implementer and evaluator:

- Could each phase be implemented without asking a design question?
- Did every code block use read/verified types and complete branch logic?
- Do tests assert concrete values and meaningful failures?
- Does every automated plan criterion exist in `.sprint-contract.json`?
- Are design preferences reflected in every new module/file?
- Are open questions either resolved or clearly blocking plan readiness?

Fix gaps before responding.

## Validation

After writing, verify as much as practical:

- plan file exists at the reported path;
- sprint contract exists at the reported path;
- plan frontmatter parses as YAML;
- sprint contract parses as JSON;
- no template placeholders remain;
- no stub/TODO/deferred-logic phrases remain in implementation code blocks;
- phase count in plan, final response, and sprint contract match;
- every phase has automated criteria and a contract entry;
- regression commands are present or the blocker is recorded;
- next step points to `implement-plan`, not a missing setup skill.

If a check cannot run, report the exact blocker and next best check.

## Output

Read `references/plan_final_answer.md` before responding. Keep the final response concise and include:

- plan path and sprint contract path;
- source outline/design/research inputs used;
- phase count and phase summary;
- key implementation details;
- validation performed;
- open questions or "None";
- next prompt for `implement-plan`.

When a plan needs to show Markdown that itself contains fenced code blocks, use four backticks for the outer fence so inner triple-backtick examples do not close it early.

## Document Precedence

When documents conflict:

```text
plan > structure outline > design discussion > research > ticket/spec
```

The plan is the implementation authority until code reality forces a mismatch. If the plan intentionally diverges from the outline, record the reason and evidence.

## Common Mistakes

- Writing elegant prose but leaving implementers to choose exact types or branches.
- Copying outline signatures without reading real definitions.
- Including tests that only assert existence or truthiness.
- Forgetting to put automated criteria in `.sprint-contract.json`.
- Adding manual validation for things automation can prove.
- Ignoring design preferences in newly planned modules.
- Inventing validation commands instead of reading package scripts or build files.
- Pointing to any missing setup skill instead of `implement-plan`.
