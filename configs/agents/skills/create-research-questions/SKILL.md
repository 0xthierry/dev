---
name: create-research-questions
description: "Use when turning a task, ticket, spec, or change request into a research-questions document for objective current-state codebase research."
disable_model_invocation: true
---

# Create Research Questions

## Goal

Produce a compact `ai_docs/tasks/.../*-research-questions.md` artifact that lets the next agent research the existing codebase thoroughly and objectively.

Good output translates a desired change into neutral questions about what exists today: current flows, contracts, data shapes, integration points, constraints, comparable patterns, and tests. It does not design, recommend, or ask how to implement the requested change.

## When to Use

Use this skill when the user asks to create research questions from a task, ticket, Linear issue, spec, design idea, bug report, or existing `ai_docs/tasks/...` directory.

Use a different skill when the user wants:

- codebase answers now: `create-research-codebase`
- design decisions or tradeoffs: `create-design-discussion`
- a phased outline: `create-structure-outline`
- a detailed implementation plan: `create-plan`
- implementation: `implement-plan`

## Success Criteria

Before final response:

- A research questions file exists at `ai_docs/tasks/TASKNAME/YYYY-MM-DD-research-questions.md`.
- The document contains 2-8 high-leverage questions, usually 4-6.
- Every question is answerable by inspecting the current codebase or explicitly requested external docs.
- Questions are phrased as current-state exploration, not implementation planning.
- The set covers the likely end-to-end flow plus relevant contracts, state/data, patterns, edge cases, and testing conventions.
- If codebase discovery was needed, specialized research agents were used and the document records what they clarified.
- The final response follows `references/research_questions_final_answer.md`.

## Operating Rules

- Start with a short user-visible update before tool calls for multi-step work.
- Read directly mentioned files fully before drafting questions. If a task directory or ticket ID is mentioned, inspect that task directory and read the relevant task/spec/ticket files.
- Use the task request as context, but do not leak the proposed implementation into the question wording.
- Do not conduct full codebase research. Use only enough discovery to identify the right current systems and names for good questions.
- When codebase discovery is needed, use specialized research agents instead of loading broad source context into the main session.
- Ask a narrow clarification only when the task/topic or destination directory cannot be inferred. Otherwise make a reasonable assumption, proceed, and state it.
- If the user gives feedback, treat it as an instruction to update the questions document, not to start research/design/implementation.

## Available Research Agents

Use these agents for light discovery so the main session can stay focused on question design:

- **codebase-locator**: finds relevant files and boundaries. Use when the target subsystem, source files, tests, config, schemas, or routes are unclear.
- **codebase-analyzer**: answers a narrow current-state fact needed to phrase a useful question. Use sparingly; this phase should not become full research.
- **codebase-pattern-finder**: finds names of comparable existing flows/features so questions can ask about real patterns instead of vague analogies.
- **web-search-researcher**: researches external docs only when the task explicitly depends on an external SDK/API and the research questions need to name that boundary.

Agent use is part of discovery when codebase context is unclear. Keep prompts short and ask for concise file/path oriented findings, not full explanations.

## Retrieval Budget

Use the smallest evidence set that can produce useful questions:

1. Read provided task/spec/ticket files and any existing files in the referenced task directory.
2. If component names are unclear, use **codebase-locator** for a light discovery pass before reading source files in the main session.
3. If a question would otherwise be vague, use **codebase-analyzer** or **codebase-pattern-finder** for one narrow discovery pass.
4. Stop discovery once you can name the existing area, adjacent flows, or likely code boundaries well enough to write 2-8 questions.

Expand only when a missing fact would materially change the question set, such as the target subsystem, framework boundary, data entity, external provider, or task directory.

## Question Design

Prefer questions that make the next research agent map current reality:

- **End-to-end flow:** "How does [existing flow] work today from [entry point] through [state/output], and which components participate?"
- **Boundaries and contracts:** "What contract exists between [component A] and [component B], including data shape, errors, and ownership?"
- **State and data:** "Where is [entity/config/event/table] defined, persisted, validated, transformed, and consumed today?"
- **Patterns to follow:** "What existing [similar feature/flow] patterns are present, and how are they structured?"
- **Testing:** "How is [area] tested today, including test locations, fixtures, helpers, and coverage style?"
- **Operational constraints:** "What current configuration, external services, jobs, permissions, or failure paths affect [area]?"

When the requested capability is new, ask about adjacent current systems and extension points rather than the future capability itself.

## Wording Rules

Questions should sound like codebase documentation prompts.

Avoid implementation-planning phrasing:

- "How should we..."
- "How would we..."
- "What changes are needed..."
- "Where should we add..."
- "How can we implement..."
- "What is missing..."

Prefer current-state phrasing:

- "How does ... work today?"
- "Where is ... defined and used?"
- "What existing patterns handle ...?"
- "What current tests cover ...?"
- "What contracts or constraints exist around ...?"

Examples:

```markdown
Bad: How should we add invoice export to the billing page?
Good: How does the current billing-page action flow work today from UI interaction through backend request handling?

Bad: What changes are needed in the User model for account status?
Good: Where is account status represented today, and which services, validations, serializers, and tests consume it?
```

## Workflow

1. Gather context:
   - Read all mentioned files fully.
   - If `ai_docs/tasks/TASKNAME` or `ENG-XXXX` is mentioned, locate the matching task directory and read relevant task documents.
   - If no task directory exists, create a concise slug from the task request.

2. Extract the research target:
   - Summarize privately what the user wants to change.
   - Identify existing nouns and boundaries likely to exist in the codebase: UI surfaces, endpoints, jobs, tables, schemas, services, providers, config, tests.
   - Note unknowns that should become research questions rather than assumptions.

3. Use agent-assisted light discovery when names or boundaries are unclear:
   - Prefer **codebase-locator** to find relevant files, tests, and directories.
   - Use **codebase-pattern-finder** when comparable patterns need real codebase names.
   - Use **codebase-analyzer** only for a narrow fact that materially improves the question set.
   - Keep the main session from reading large source files unless needed to verify a discovery result.

4. Draft 2-8 questions:
   - Start with one broad end-to-end current-state question when applicable.
   - Add targeted questions for contracts, data/state, comparable patterns, operational constraints, and tests.
   - Combine overlapping questions; split only when separate agents would need to inspect different areas.

5. Quality pass:
   - Remove solution wording and future-tense implementation prompts.
   - Check that each question can be answered with evidence from current code/docs.
   - Check that the set would let `create-research-codebase` produce useful findings for later design and planning.
   - Ensure at least one question asks for current testing patterns unless the task is purely documentation.

6. Write the document:
   - Read `references/research_questions_template.md`.
   - Write `ai_docs/tasks/TASKNAME/YYYY-MM-DD-research-questions.md`.
   - Use today's local date for `YYYY-MM-DD`.

7. Final response:
   - Read `references/research_questions_final_answer.md`.
   - Summarize the document path, question count, the questions, and the next prompt to run `create-research-codebase`.

## Output Path Rules

- With ticket/task ID: `ai_docs/tasks/ENG-1478-parent-child-tracking/YYYY-MM-DD-research-questions.md`
- Without ticket: `ai_docs/tasks/authentication-flow/YYYY-MM-DD-research-questions.md`

If several matching task directories exist, choose the closest exact ID/name match. If no safe choice exists, ask the user which directory to use.

## Validation

After writing the document, verify:

- The file exists at the reported path.
- Frontmatter, if present, parses as YAML.
- The document has 2-8 numbered questions.
- No question uses banned implementation-planning phrasing such as "should we", "would we", "changes are needed", "where should", or "implement".
- Source/task files that informed the questions are listed or named in the document.
- If research agents were used, their discovery role is listed in the document.

If a validation step cannot run, report the exact blocker and the next best check.

## Common Mistakes

- Writing disguised implementation tasks instead of current-state questions.
- Copying ticket acceptance criteria directly into questions.
- Asking only about one layer, such as UI, and missing data/contracts/tests.
- Doing full research in this phase and making the next phase redundant.
- Omitting the testing-pattern question, which weakens later planning.
- Asking so many narrow questions that the research phase becomes fragmented.
