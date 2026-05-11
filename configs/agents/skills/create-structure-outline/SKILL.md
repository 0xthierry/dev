---
name: create-structure-outline
description: "Use when converting a design-discussion document and codebase research into a concise, vertical, testable structure outline before writing the detailed implementation plan."
effort: max
disable_model_invocation: true
disable-model-invocation: true
---

# Create Structure Outline

## Goal

Produce a concise `ai_docs/tasks/.../*-structure-outline.md` artifact that turns resolved design direction into a phased implementation shape.

Good output is a bridge between design and plan: it preserves decisions and design preferences, maps requirements to phases, names the files/systems/tests likely to change, sequences the work as independently testable vertical slices, and leaves enough specificity for `create-plan` to write complete code without redoing design.

## When to Use

Use this skill when the user asks for a structure outline, phased outline, implementation outline, or next step after `create-design-discussion`.

Use a different skill when the user wants:

- neutral current-state questions: `create-research-questions`
- objective codebase research: `create-research-codebase`
- design tradeoffs or unresolved decisions: `create-design-discussion`
- a detailed implementation plan with complete code: `create-plan`
- code changes: `implement-plan`

## Success Criteria

Before final response:

- A structure outline exists at `ai_docs/tasks/TASKNAME/YYYY-MM-DD-structure-outline.md`.
- The document cites the design discussion, research, and task inputs used.
- Current state, desired end state, non-goals, design preferences, patterns, and decisions are carried forward accurately.
- Every material desired outcome or resolved design decision is mapped to at least one phase.
- Phases are ordered vertically: each phase delivers a coherent, testable slice instead of isolated horizontal scaffolding unless a horizontal setup phase is unavoidable and justified.
- Each phase names expected file groups, contract/signature changes, tests, validation approach, dependencies, and risks at outline level.
- Validation is phase-specific and realistic; manual validation appears only when it adds evidence that automation cannot.
- Open questions are limited to items that materially affect phase structure or plan writing.
- The outline does not include full implementation code, sprint-contract JSON, or actual source changes.
- The final response follows `references/structure_outline_final_answer.md`.

## Operating Rules

- Start multi-step work with a brief user-visible preamble before tool calls.
- Read mentioned files fully before using agents or writing the outline. If an `ai_docs/tasks/TASKNAME` directory is provided, list it and read relevant task documents.
- Treat the latest design discussion as the primary input for desired behavior, design preferences, and resolved decisions.
- Treat research and source/tests as the primary input for current architecture, patterns, and validation conventions.
- If the design discussion has material unresolved or blocked decisions, ask a narrow question or return a `needs-design-input` outline rather than inventing a phase structure.
- User feedback during this phase updates the outline; it does not authorize implementation.
- Keep the outline human-readable. Prefer signatures, diffs, tables, and short bullets over full code blocks.

## Available Research Agents

Use subagents for targeted follow-up evidence when the design/research docs do not provide enough information to sequence phases confidently.

- **explorer / file-map prompt**: find additional files, tests, schemas, routes, configs, or build/test command locations.
- **explorer / narrow-fact prompt**: verify a specific current contract, data flow, lifecycle, error path, or dependency that affects phase boundaries.
- **explorer / pattern prompt**: find comparable implementation/testing patterns to shape phase file groups and validation.
- **web-search**: use only for external SDK/API/platform constraints that materially affect phase order or validation. Require source links.

Use concise prompts, for example:

```text
Find the current files, tests, and contracts that would define phase boundaries for [area]. Return factual file:line evidence, existing test patterns, and risks to sequencing. Do not propose implementation details.
```

## Retrieval Budget

Use the minimum evidence needed to produce a reliable phase outline.

1. Read the latest design discussion, latest research, research questions, ticket/spec, and related grill notes in the task directory.
2. Extract decisions, preferences, desired outcomes, non-goals, current architecture, patterns, tests, and open questions.
3. Use 1-3 targeted agent passes only when phase boundaries, file ownership, tests, or external constraints are unclear.
4. Read direct source/test files only to resolve conflicts, verify a signature/contract, or avoid naming the wrong file in a phase.
5. Stop when each desired outcome and resolved decision has a phase home, validation approach, and plan-prep evidence.

Do not expand into detailed code design. That belongs in `create-plan`.

## Phase Design Rules

- Prefer 2-5 phases for most tasks. Use more only when each phase has distinct user-visible behavior, risk, or validation.
- Make phases vertical where possible: wire a minimal path end to end, then broaden behavior, edge cases, integrations, or UX.
- Avoid dead scaffolding phases. If setup-only work is unavoidable, explain why it cannot be made user-visible or behavior-testable yet.
- Keep phase boundaries aligned to risk and validation: data migrations, public contracts, external integrations, UI workflows, and async jobs often need explicit validation points.
- Each phase should leave the repository in a coherent state that can pass relevant tests.
- Carry design preferences into every new file/module named in the outline.
- Include test changes in the same phase as the behavior they prove.
- Do not include full function bodies. Use signatures or short diffs only when they clarify structure for the plan writer.

## Workflow

### 1. Resolve inputs and task directory

- If invoked without a task directory, design discussion, or research document, ask for the smallest missing input.
- If given `ai_docs/tasks/TASKNAME`, list the directory and identify the latest relevant `*-design-discussion.md`, `*-research.md`, `*-research-questions.md`, ticket/spec, existing outline, and plan if present.
- Check `ai_docs/grills/` for related grill documents when the task name, ticket ID, or design discussion references one.
- Use today's local date for `YYYY-MM-DD-structure-outline.md` and write into the task directory.

### 2. Normalize planning context

Read selected inputs fully and extract:

- desired end state and acceptance-level outcomes;
- current architecture and current testing conventions;
- design preferences and resolved decisions;
- patterns to follow;
- non-goals and compatibility/security/privacy/operational constraints;
- open decisions that affect phase sequencing;
- code files, type definitions, schemas, tests, and commands the plan writer must inspect.

If documents conflict, apply precedence:

```text
structure outline feedback > design discussion > research > ticket/spec
```

For current code facts, source/tests outrank summaries. For desired behavior, the latest user/design feedback outranks the original ticket.

### 3. Fill phase-boundary evidence gaps

Use targeted agents or direct source reads when:

- a phase would name files or tests not supported by evidence;
- a decision needs a clearer implementation boundary;
- validation commands or test locations are unknown;
- a dependency or migration risk affects ordering;
- user feedback asserts current code behavior.

Do not redo full research. The outline should consume research, not duplicate it.

### 4. Build the coverage map

Create a compact Coverage Map before writing phases:

- desired outcome → phase(s);
- resolved design decision → phase(s);
- design preference → affected new modules/files;
- existing pattern/test convention → phase(s);
- risks/open questions → owner or phase impact.

If a desired outcome has no phase, add or adjust a phase. If a phase does not serve a desired outcome, validation need, or risk reduction, remove or merge it.

### 5. Write phases at outline detail

For each phase, include:

- objective and user/system behavior unlocked;
- why the phase is ordered here;
- expected file changes grouped by component;
- interface/contract/signature shape when useful;
- test changes and existing test pattern to follow;
- automated validation approach, with likely commands if known;
- manual validation only when materially useful;
- dependencies, risks, and what the plan writer must verify.

### 6. Write or update the document

Read `references/structure_outline_template.md` before writing. Populate every section with real values; do not leave placeholders.

If updating an existing outline after feedback:

- update frontmatter `last_updated`, `last_updated_by`, and `last_updated_note`;
- preserve decisions and phase structure unless intentionally superseded;
- verify codebase facts behind the feedback before recording them as current-state truth;
- note any phase changes in Design/Outline Notes.

Use GitHub permalinks for code references when repository/commit information is available; otherwise use stable `path:line` references.

## Validation

After writing, verify as much as practical:

- the output file exists at the reported path;
- frontmatter parses as YAML;
- no template placeholders remain;
- the document names source design/research/task inputs;
- phase count matches the final response;
- every phase has file changes, test/validation guidance, dependencies or "none", and plan-prep notes;
- every resolved design decision and desired outcome appears in the coverage map;
- Design Preferences is populated and reflected in phase file/module choices;
- the outline contains no full implementation code, sprint contract, or source-code edits.

If a check cannot run, report the exact blocker and next best check.

## Output

Read `references/structure_outline_final_answer.md` before responding. Keep the final response concise and include:

- structure outline path;
- source design/research inputs used;
- phase count and phase summary;
- design preferences carried forward;
- open questions or "None";
- validation performed;
- next prompt for `create-plan`.

When a structure outline needs to show Markdown that itself contains fenced code blocks, use four backticks for the outer fence so inner triple-backtick examples do not close it early.

## Document Precedence

When documents conflict:

```text
structure outline > design discussion > research > ticket/spec
```

The structure outline is authoritative for phase order and implementation shape until the detailed plan supersedes it. It should not silently reverse design decisions; if a phase structure changes a design decision, record the reason and evidence.

## Common Mistakes

- Creating horizontal phases like "database", "backend", "frontend" when a vertical slice is possible.
- Repeating the design discussion without turning it into phase structure.
- Writing plan-level code bodies too early.
- Omitting tests from phases until the end.
- Dropping design preferences when naming new modules.
- Adding manual validation steps just to have manual validation.
- Leaving a desired outcome or resolved decision unmapped to any phase.
- Treating open design questions as implementation details for the plan writer to solve.
