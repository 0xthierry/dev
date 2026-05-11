---
name: create-research-codebase
description: "Use when answering a research-questions document or user research query by producing objective, evidence-backed current-state codebase research."
effort: high
disable_model_invocation: true
disable-model-invocation: true
---

# Create Research Codebase

## Goal

Produce a self-contained `ai_docs/tasks/.../*-research.md` document that answers current-state research questions with concrete codebase evidence.

Good research describes what exists today: flows, contracts, data shapes, dependencies, state, configuration, tests, and operational constraints. It gives later design and planning phases enough facts to make decisions without mixing in recommendations, proposed changes, or implementation planning.

## When to Use

Use this skill when the user provides:

- a `*-research-questions.md` file from `create-research-questions`;
- an `ai_docs/tasks/...` directory that contains research questions;
- a direct request to research how part of the current codebase works.

Use a different skill when the user wants design tradeoffs (`create-design-discussion`), a phased outline (`create-structure-outline`), a detailed implementation plan (`create-plan`), or code changes (`implement-plan`).

## Success Criteria

Before final response:

- A research document exists at `ai_docs/tasks/TASKNAME/YYYY-MM-DD-research.md`.
- Every research question is answered with current codebase evidence, or is listed under open questions with the exact missing evidence.
- Important claims about behavior, ownership, data shape, tests, configuration, or integrations include file paths and line references.
- Testing patterns are documented for each researched component area, or the absence of discoverable tests is stated with the search performed.
- The document contains no implementation recommendations, design decisions, critique, or future work disguised as research.
- Metadata records date/time, branch, commit, repository, source research-questions file, and working-tree state.
- The research document names the research agents used and the area each one covered.
- The final response follows `references/research_final_answer.md`.

## Operating Rules

- Start multi-step work with a brief user-visible preamble before tool calls.
- Treat a `*-research-questions.md` file as the primary input. Read it fully before searching the codebase.
- If a task directory is provided, inspect the directory and prefer the latest `*-research-questions.md`. If multiple plausible question files conflict, ask which one to use.
- Do not read desired-state ticket/spec files unless needed to identify the task directory or source label. If read, do not use them as evidence for current codebase behavior.
- Source code and tests are primary evidence. Existing docs are secondary evidence and should be labeled as documentation, not runtime fact.
- Do not recommend changes, explain what should be built, assign blame, critique design, or perform root-cause analysis unless the user explicitly asks for that separate mode.
- Use web research only when the user explicitly asks for external documentation or when a current external API contract is required to explain code already present. Cite links when used.
- Ask for clarification only when the research target or output location cannot be safely inferred. Otherwise make a reasonable assumption, continue, and record it.
- Use focused `explorer` subagents for codebase exploration. The main session owns input reading, agenda design, synthesis, spot-checking, document writing, and validation; it should not absorb broad source context that a research agent can inspect and summarize.

## Available Research Agents

Use focused subagents to reduce main-session context and improve coverage:

- **explorer / file-map prompt**: find relevant source files, configs, routes, schemas, migrations, tests, fixtures, and docs. Use first when relevant files or boundaries are not already clear.
- **explorer / behavior-trace prompt**: trace how a known component, flow, function, class, endpoint, job, or data path works. Use for current behavior, data/control flow, contracts, errors, and lifecycle details.
- **explorer / pattern prompt**: find comparable existing implementations and testing patterns. Use when later design/planning will need examples to follow, or when the research questions ask about patterns.
- **web-search**: research external documentation only when explicitly requested or needed to explain a current external API/SDK integration in the codebase. Require source links in its findings.

Agent use is part of the research workflow, not optional decoration.

## Retrieval Budget

Use the minimum evidence that can answer the questions correctly. Do not under-research core claims, but do not keep searching for decorative completeness.

1. Start from the research-questions document: extract the research goal, boundaries, source materials, and numbered questions.
2. Group related questions into 2-5 research areas so searches follow code boundaries rather than question numbering.
3. For each area, inspect the smallest useful evidence set:
   - entry points and callers;
   - core functions/classes/modules;
   - types, schemas, models, migrations, or config definitions;
   - integration boundaries and error/failure paths;
   - tests, fixtures, mocks, and helpers.
4. Expand search only when:
   - a question cannot be answered from the current evidence;
   - a referenced type, function, schema, config key, or external boundary is not defined yet;
   - tests or fixtures are needed to understand expected behavior;
   - evidence conflicts and the source of truth must be resolved;
   - a claim would otherwise be unsupported.
5. Stop when every question has either a cited answer or an explicit open question/blocker.

## Workflow

### 1. Resolve input and output

- If invoked without a query or path, ask for the research question, research-questions file, or task directory.
- If given `ai_docs/tasks/TASKNAME`, list the directory and locate the latest relevant `*-research-questions.md`.
- If given a direct topic without an existing task directory, create or reuse an appropriate `ai_docs/tasks/TASKNAME/` directory.
- Use today's local date for `YYYY-MM-DD-research.md` and place it in the same task directory as the questions when possible.

### 2. Read the research input

Read the research-questions document fully. Extract:

- research goal;
- source materials listed in the document;
- boundaries and notes for the research agent;
- numbered questions;
- any explicit external-documentation requirement.

Read directly mentioned code/docs fully when they are current-state evidence. Avoid using ticket/spec desired behavior as current-state evidence.

### 3. Build agenda and launch research agents

Create a short internal agenda that maps each question to research areas. Prefer area-based grouping such as UI flow, API boundary, persistence/state, background jobs, external provider, or tests.

Launch research agents for codebase exploration. For a narrow single-area query, use at least one focused locator/analyzer/pattern agent. For broader research, launch 2-6 focused agents for different areas. Combine related questions that touch the same code boundary; do not launch one agent per question by default. Use foreground/awaited agents only: wait for all research agents to complete before synthesis.

Use concise, outcome-first prompts:

```text
Research the current-state behavior for [area]. Return factual findings only: file:line evidence, data/control flow, contracts, tests/fixtures, configuration or external boundaries, and open questions. Do not recommend changes or discuss implementation plans.
```

Choose subagent prompts by need:

- Start with an **explorer file-map** prompt when files or boundaries are unknown.
- Use an **explorer behavior-trace** prompt for known flows/components that need behavior tracing.
- Use an **explorer pattern** prompt for comparable implementations, conventions, and testing patterns.
- Use **web-search** only for explicitly requested external docs or current external API/SDK contracts.

### 4. Gather evidence

Compile all agent results before writing. For each area:

- use agent findings as the first evidence map;
- spot-check important, surprising, or cross-cutting claims by reading the referenced source directly;
- locate source files and tests with targeted search when agent results expose gaps;
- read enough surrounding code to understand behavior, not just symbol names;
- trace important data/control flow across boundaries;
- read actual type/schema/config definitions before describing shapes;
- record line references as you go;
- note absent tests only after searching likely test locations and naming the search.

Prefer permalinks when repository and commit are available. Otherwise use stable `path:line` references.

### 5. Synthesize without designing

Write findings in the language of current behavior:

- "`X` calls `Y` with `{a, b}` and handles `Z` errors..."
- "The current tests cover..."
- "No tests were found under... after searching..."
- "The code does not show..." only when supported by a named search.

Avoid design/planning language:

- "should", "would", "we need to", "recommended", "future enhancement", "missing feature", "bad", "problem", "fix", "refactor", "implement".

It is acceptable to use "open question" for evidence gaps that matter to codebase understanding.

### 6. Write the research document

Read `references/research_template.md` before writing. Populate every section with real values; do not leave placeholders.

Include:

- metadata and source inputs;
- research goal and questions answered;
- research method, including agents used and areas covered;
- concise summary;
- detailed findings grouped by component/area;
- testing patterns for each area;
- question-by-question answers;
- code references with line numbers/permalinks where possible;
- external references only if used;
- open questions limited to current-state understanding.

### 7. Handle follow-up research

If the user asks a follow-up after a research document already exists:

- append a new `## Follow-up Research: YYYY-MM-DD HH:MM TZ` section;
- update frontmatter `last_updated`, `last_updated_by`, and `last_updated_note`;
- answer the follow-up with the same evidence standards;
- preserve earlier findings unless new evidence supersedes them, in which case state the supersession clearly.

## Validation

After writing or updating the document, verify as much as practical:

- the output file exists at the reported path;
- frontmatter parses as YAML;
- no template placeholders remain;
- each numbered research question appears in the question-by-question answers;
- key findings include file references with line numbers;
- the document does not contain recommendation/planning language except inside quoted user input or explicit boundary notes;
- research agents used are named;
- source documents and searches used for absent-test claims are named.

If a check cannot run, report the exact blocker and the next best check.

## Output

Read `references/research_final_answer.md` before responding. Keep the final response concise and include:

- research document path;
- number of questions answered;
- 2-3 sentence summary;
- key code references;
- open questions or "none";
- validation performed;
- next prompt for `create-design-discussion`.

When a research document needs to show Markdown that itself contains fenced code blocks, use four backticks for the outer fence so inner triple-backtick examples do not close it early.

## Common Mistakes

- Answering the ticket instead of the research questions.
- Mixing recommendations into the research document.
- Citing docs while ignoring source code that defines runtime behavior.
- Describing data shapes without reading the actual type/schema/model definition.
- Reporting "no tests" without searching likely test locations.
- Launching too many narrow research threads instead of grouping by code boundary.
- Writing broad architecture prose without concrete `path:line` evidence.
