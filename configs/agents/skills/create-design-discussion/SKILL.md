---
name: create-design-discussion
description: "Use when turning completed codebase research and a change request into a design-discussion document with options, tradeoffs, recommendations, resolved decisions, and design preferences before outlining implementation."
effort: max
disable_model_invocation: true
---

# Create Design Discussion

## Goal

Produce a decision-quality `ai_docs/tasks/.../*-design-discussion.md` artifact that bridges objective codebase research to implementation planning.

Good output makes the desired end state explicit, separates product behavior from technical architecture, surfaces the few design decisions that matter, recommends evidence-backed choices, records resolved decisions and user preferences, and gives `create-structure-outline` enough context to phase the work without re-litigating design.

## When to Use

Use this skill when the user asks to begin design, discuss tradeoffs, choose an approach, or create a design discussion for a task that has a change request and preferably a completed `*-research.md` document.

Use a different skill when the user wants:

- neutral current-state questions: `create-research-questions`
- objective codebase research only: `create-research-codebase`
- a phased implementation outline: `create-structure-outline`
- a detailed implementation plan: `create-plan`
- code changes: `implement-plan`

## Success Criteria

Before final response:

- A design discussion file exists at `ai_docs/tasks/TASKNAME/YYYY-MM-DD-design-discussion.md`.
- The document cites the research document and any task/ticket/grill inputs used.
- Current State describes user/product behavior without code identifiers; Current Architecture describes technical facts with file references.
- Patterns to Follow include concrete existing code/test examples or explain why no pattern was found.
- Design Preferences captures cross-cutting user preferences, or explicitly says none were stated.
- Each material design question has options, tradeoffs, an evidence-backed recommendation, and a status (`proposed`, `resolved`, `needs-user`, or `blocked`).
- Resolved decisions include the decision, rationale, evidence/patterns, consequences, and validation/testing implications.
- Open questions are limited to decisions that materially affect the structure outline or plan.
- No code is changed and no implementation plan is written.
- The final response follows `references/design_discussion_final_answer.md`.

## Operating Rules

- Start multi-step work with a brief user-visible preamble before tool calls.
- Read mentioned files fully before using agents or drafting decisions. If an `ai_docs/tasks/TASKNAME` directory is provided, list it and read relevant task documents.
- Treat `*-research.md` as the primary source of codebase truth. If research is missing and design depends on codebase facts, ask whether to run research first unless the user explicitly requested a lightweight design pass.
- Source code and tests outrank research summaries when they conflict; recent design documents outrank older task/ticket intent for desired behavior.
- User preferences are valid design input and do not need codebase verification. User claims about current code behavior do need verification before being recorded as facts.
- Use agents for targeted follow-up research, not to redo the full research phase when a complete research document exists.
- Ask a narrow clarification only when a missing decision would materially change the design. Otherwise make a recommendation, mark the decision status accurately, and proceed.
- Treat user feedback during this phase as instructions to update the design discussion, not to start implementation.

## Available Research Agents

Keep agent use focused and evidence-seeking. The main session owns the design synthesis and final recommendations.

- **codebase-locator**: find additional files, tests, schemas, routes, configs, or task/grill documents when the research leaves boundaries unclear.
- **codebase-analyzer**: verify a narrow behavior, contract, data shape, error path, or lifecycle fact before using it in a tradeoff.
- **codebase-pattern-finder**: find comparable existing implementations and tests that can support Patterns to Follow and validation implications.
- **web-search-researcher**: use only when an external SDK/API/product constraint is part of the design decision. Require source links.

Use concise outcome-first prompts, for example:

```text
Verify the current-state evidence for [decision area]. Return factual findings only: file:line references, contracts/data shapes, tests or fixtures, existing patterns, and open evidence gaps. Do not recommend an implementation.
```

## Retrieval Budget

Use the minimum evidence needed for sound design decisions.

1. Read the provided task directory inputs: latest research, research questions, ticket/spec, prior design discussion, structure outline if present, and related grill documents.
2. Extract the change request, current-state facts, current tests, patterns, constraints, and research open questions.
3. Use 1-4 targeted agent passes only when a decision lacks evidence, a codebase claim conflicts, a comparable pattern is needed, or a user correction mentions files not yet verified.
4. Read direct source/test files only to spot-check important claims, resolve conflicts, or quote a pattern snippet.
5. Stop researching when every material design decision can be marked resolved/proposed/needs-user/blocked with evidence and rationale.

Do not keep searching to make the document feel exhaustive. Design quality comes from choosing and explaining the right decisions, not from repeating the entire research document.

## Workflow

### 1. Resolve inputs and task directory

- If invoked without a request, task directory, or research document, ask for one.
- If given `ai_docs/tasks/TASKNAME`, list the directory and identify the latest relevant `*-research.md`, `*-research-questions.md`, ticket/spec, prior design discussion, and structure/plan documents if any.
- Check `ai_docs/grills/` for related grill documents when the task name, ticket ID, or user request suggests one. Carry forward resolved decisions and design preferences.
- Use today's local date for `YYYY-MM-DD-design-discussion.md` and write into the task directory.

### 2. Read and normalize context

Read all selected inputs fully. Build a compact working model:

- original change request and desired user outcome;
- current user/product behavior;
- current architecture and code/test evidence;
- constraints from research, tickets, existing docs, external systems, security/privacy, and operations;
- existing patterns and testing conventions;
- prior/resolved decisions and user preferences;
- research open questions that affect design.

If documents conflict, separate fact types: for current code, source/tests > latest research > older research/docs; for desired behavior, latest user/design feedback > ticket/spec. Record material conflicts in Design Notes.

### 3. Fill evidence gaps only where needed

Use targeted agents or direct source reads when:

- an option depends on an unverified codebase fact;
- the research names a pattern but lacks enough detail to show it;
- tests/fixtures are needed to judge validation implications;
- user feedback asserts current behavior or points to additional files;
- external API behavior materially changes the design.

Do not launch broad research agents just because agents are available.

### 4. Frame the design decisions

Identify the small set of decisions that would materially affect implementation shape, user behavior, data/contracts, migration/compatibility, testing, operations, or risk.

For each decision, document:

- the question being decided;
- context/evidence from research or source;
- 2-4 realistic options;
- tradeoffs that matter for this codebase;
- recommendation and rationale;
- status: `proposed`, `resolved`, `needs-user`, or `blocked`;
- validation/testing implications for later phases.

Prefer one clear recommendation over a neutral list when evidence is sufficient. Mark open decisions narrowly instead of blocking the whole document.

### 5. Capture design preferences separately

Design preferences are cross-cutting constraints the user wants applied uniformly to new code, such as classes vs functions, naming, module boundaries, error handling style, dependency injection style, logging, or test style.

Record explicit preferences from the user and preferences implied by discussion. If none were stated, write:

```text
None stated — follow existing codebase conventions.
```

Do not confuse preferences with codebase patterns. Patterns are evidence from existing code; preferences are user-directed constraints for this task.

### 6. Write or update the design discussion

Read `references/design_discussion_template.md` before writing. Populate every section with real values; do not leave placeholders.

If updating an existing design discussion after feedback:

- update frontmatter `last_updated`, `last_updated_by`, and `last_updated_note`;
- preserve prior decisions unless intentionally superseded;
- add a short note where a decision changed and why;
- verify codebase facts behind the feedback before recording them as current-state truth.

Use GitHub permalinks for code references when repository/commit information is available; otherwise use stable `path:line` references.

## Validation

After writing, verify as much as practical:

- the output file exists at the reported path;
- frontmatter parses as YAML;
- no template placeholders remain;
- the document names source research/task inputs;
- every design question has options, tradeoffs, recommendation, and status;
- Design Preferences is populated;
- codebase claims have file references or are clearly attributed to research;
- no implementation steps, phase plan, or code changes were introduced.

If a check cannot run, report the exact blocker and next best check.

## Output

Read `references/design_discussion_final_answer.md` before responding. Keep the final response concise and include:

- design discussion path;
- source research/task inputs used;
- resolved/proposed/open decision counts;
- key patterns to follow;
- design preferences captured;
- validation performed;
- next prompt for `create-structure-outline`.

When a design document needs to show Markdown that itself contains fenced code blocks, use four backticks for the outer fence so inner triple-backtick examples do not close it early.

## Document Precedence

When documents conflict:

```text
design discussion > research > ticket/spec
```

Within design discussions, newer user-verified updates supersede older decisions. The next phases should treat the latest design discussion as the design authority until the structure outline supersedes it.

## Common Mistakes

- Repeating research findings without turning them into decisions.
- Writing an implementation plan too early.
- Treating user preferences as optional suggestions and failing to carry them forward.
- Recording user claims about current code without verification.
- Presenting options with no recommendation when evidence is sufficient.
- Asking broad open-ended questions instead of narrow decisions.
- Letting agent research sprawl beyond the evidence needed for design.
- Mixing Current State product behavior with Current Architecture code facts.
