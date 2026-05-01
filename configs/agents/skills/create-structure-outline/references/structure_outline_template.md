---
task: "[task-slug-or-ticket-id]"
type: structure-outline
repo: "[repository name or owner/name]"
branch: "[current branch]"
sha: "[current commit SHA]"
date: "[ISO-8601 timestamp with timezone]"
status: "[ready-for-plan|needs-design-input|blocked]"
source_design: "[path/to/YYYY-MM-DD-design-discussion.md]"
source_research: "[path/to/YYYY-MM-DD-research.md]"
source_documents:
  - "[path/to/ticket-or-spec.md]"
related_grills:
  - "[path/to/grill.md]"
---

# Structure Outline: [Task / Change Name]

## Outline Goal

[One concise paragraph describing the implementation shape this outline creates and the user/system outcome it supports.]

## Source Context

| Source | Role in this outline | Notes |
| --- | --- | --- |
| `[design-discussion.md]` | Desired behavior, decisions, preferences | [brief note] |
| `[research.md]` | Current architecture, patterns, tests | [brief note] |
| `[ticket-or-spec.md]` | Original request | [brief note or "None"] |
| `[grill.md]` | Prior resolved preferences/decisions | [brief note or "None"] |

## Current State

[Current product/system behavior and codebase architecture relevant to phase sequencing. Include file references for technical facts.]

- [current behavior or architecture fact]
- [`path/to/file.ext:10`](link) - [technical fact]

## Desired End State

[Observable behavior or system state after all phases are complete.]

- [desired outcome]
- [desired outcome]

## What We're Not Doing

[Out-of-scope work carried forward from design discussion or added to prevent phase creep.]

- [non-goal]
- [non-goal]

## Design Preferences Carried Forward

[Cross-cutting user preferences from the design discussion. If none were stated, write "None stated — follow existing codebase conventions."]

- [preference]

## Patterns to Follow

### [Pattern Name]

**Use in phases:** [phase numbers]

**Evidence:** [`path/to/file.ext:10-30`](link)

```[language]
[short existing-code pattern or signature]
```

**Testing pattern:** [`path/to/test.ext:40-70`](link)

```[language]
[short existing-test pattern]
```

### [Second Pattern Name]

...

## Design Decisions Carried Forward

| Decision ID | Decision | Source | Phase impact |
| --- | --- | --- | --- |
| D1 | [decision summary] | [`design-discussion.md`](path) | [phase(s) affected] |
| D2 | [decision summary] | [`design-discussion.md`](path) | [phase(s) affected] |

## Coverage Map

| Requirement / Desired Outcome / Decision | Covered by phase(s) | Validation signal |
| --- | --- | --- |
| [outcome or decision] | Phase [N] | [test/check/manual validation] |
| [outcome or decision] | Phase [N, M] | [test/check/manual validation] |

## Phase Strategy

[2-4 bullets explaining why the phases are ordered this way, what risk is reduced early, and how the sequence stays vertical/testable.]

- [ordering rationale]
- [risk-reduction rationale]

---

## Phase 1: [Phase Title]

### Objective

[What this phase accomplishes and what user/system behavior becomes testable.]

### Why this phase is first/next

[Ordering rationale: dependency, risk, vertical slice, migration safety, external integration, etc.]

### Expected File Changes

- **`path/to/file.ext`**: [outline-level change]
- **`path/to/other.ext`**: [outline-level change]

### Interface / Contract Shape

[Optional. Include signatures, schema shape, endpoint shape, event shape, or short diffs only when they clarify the structure. Do not include full implementation bodies. If not needed, write "No new public contract in this phase.".]

```[language]
[signature or contract shape only]
```

### Tests and Validation

**Automated:**

- [test file or command category and expected signal]
- [typecheck/lint/build/smoke check if known]

**Manual:** [specific manual check, or "None expected." ]

### Dependencies and Risks

- **Dependencies:** [dependencies, or "None."]
- **Risks:** [risk and mitigation, or "None identified."]

### Plan-Prep Notes

[Files/types/contracts the `create-plan` phase must read or verify before writing full code.]

- [type/schema/function/test fixture to inspect]

---

## Phase 2: [Phase Title]

### Objective

...

### Why this phase is first/next

...

### Expected File Changes

- **`path/to/file.ext`**: [outline-level change]

### Interface / Contract Shape

...

### Tests and Validation

**Automated:**

- [test/check]

**Manual:** [manual check or "None expected."]

### Dependencies and Risks

- **Dependencies:** [dependencies, or "None."]
- **Risks:** [risk and mitigation, or "None identified."]

### Plan-Prep Notes

- [plan-prep note]

---

## Cross-Phase Validation Strategy

[Checks that should run after multiple phases or in the final detailed plan: regression suite, typecheck, lint, build, e2e, migration smoke, external integration smoke, etc.]

- [validation command/check if known]
- [validation command/check if known]

## Open Questions

[Only questions that materially affect plan writing or phase structure. If none, write "None.".]

- [question] — [owner/evidence needed/phase impact]

## Handoff to Create Plan

[Concise instructions for the plan writer.]

- [decision/preference/pattern that must be preserved]
- [file/type/schema/test fixture that must be read before writing full code]
- [validation requirement to turn into concrete success criteria]

## Outline Notes

[Any assumptions, document conflicts resolved, phase tradeoffs, agent research notes, or superseded prior outline details that matter for future readers.]
