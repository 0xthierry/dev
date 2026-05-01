---
task: "[task-slug-or-ticket-id]"
type: design-discussion
repo: "[repository name or owner/name]"
branch: "[current branch]"
sha: "[current commit SHA]"
date: "[ISO-8601 timestamp with timezone]"
status: "[draft|ready-for-outline|needs-user-input|blocked]"
source_research: "[path/to/YYYY-MM-DD-research.md]"
source_documents:
  - "[path/to/ticket-or-spec.md]"
related_grills:
  - "[path/to/grill.md]"
---

# Design Discussion: [Task / Change Name]

## Design Goal

[One concise paragraph describing the user-visible outcome this design is trying to enable and why it matters. This is desired behavior, not implementation detail.]

## Source Context

| Source | Role in this design | Notes |
| --- | --- | --- |
| `[research.md]` | Current codebase evidence | [brief note] |
| `[ticket.md]` | Requested outcome | [brief note] |
| `[grill.md]` | Prior resolved preferences/decisions | [brief note or "None"] |

## Summary of Change Request

[Summarize the requested change in 2-4 bullets. Include ticket/spec intent and any user refinements.]

- [requested outcome]
- [constraint or acceptance detail]

## Current State

[User/product-facing behavior today. Avoid file paths, function names, database columns, or other code identifiers in this section.]

- [what users can/cannot do today]
- [current workflow, UX gap, operational pain, or behavior]

## Desired End State

[What should be true after the work is implemented, in user/product terms.]

- [desired behavior]
- [user story or observable result]
- [operational or support outcome]

## What We're Not Doing

[What this design intentionally does not cover.]

- [out of scope]
- [deferred or explicitly excluded behavior]

## Current Architecture

[Technical facts from research/source evidence. Include file references or permalinks.]

- [`path/to/file.ext:10`](link) - [current technical behavior]
- [`path/to/test.ext:25`](link) - [current test pattern or coverage]

## Constraints and Known Facts

[Decision-relevant constraints from current code, product requirements, privacy/security, external systems, runtime/deployment, compatibility, or testing.]

- [constraint/fact with evidence]
- [constraint/fact with evidence]

## Design Preferences

[Cross-cutting user preferences that apply uniformly to new code in this task: code organization, classes vs functions, naming, module cohesion, error handling, logging, dependency injection, testing style, etc. If none were stated, write "None stated — follow existing codebase conventions."]

- [preference]

## Patterns to Follow

### [Pattern Name]

**Use for:** [where this pattern applies in the proposed design]

**Evidence:** [`path/to/file.ext:10-30`](link)

```[language]
[succinct code example from existing code]
```

**Testing pattern:** [`path/to/test.ext:40-70`](link)

```[language]
[succinct test example or fixture pattern]
```

### [Second Pattern Name]

...

## Testing and Validation Implications

[Briefly describe how existing tests/patterns should influence later structure-outline and plan validation. Do not write the full implementation plan here.]

- [unit/integration/e2e pattern to carry forward]
- [manual or smoke validation implication, if materially relevant]

## Design Decision Inventory

| ID | Decision | Status | Recommendation | Material because |
| --- | --- | --- | --- | --- |
| D1 | [short decision name] | [proposed/resolved/needs-user/blocked] | [recommended option] | [why it affects implementation/user behavior] |
| D2 | [short decision name] | [status] | [recommendation] | [why it matters] |

## Design Questions

### D1: [Decision Title]

**Decision needed:** [the specific question]

**Context/evidence:** [research/source facts that constrain the decision, with references]

| Option | Description | Pros | Cons / risks | When to choose |
| --- | --- | --- | --- | --- |
| A | [option] | [pros] | [cons] | [conditions] |
| B | [option] | [pros] | [cons] | [conditions] |

**Recommendation:** [recommended option and rationale]

**Status:** [proposed/resolved/needs-user/blocked]

**Validation implications:** [tests/checks the later plan should include]

### D2: [Decision Title]

...

## Resolved Design Decisions

### D1: [Decision Title]

**Decision:** [chosen option]

**Rationale:** [why this choice wins, grounded in evidence and preferences]

**Evidence/patterns:**

- [`path/to/file.ext:10`](link) - [supporting fact]
- [pattern/preference carried forward]

**Consequences for planning:** [what structure-outline/plan must preserve]

**Validation implications:** [what future tests/checks must prove]

## Open Questions

[Only include questions that materially affect the structure outline or implementation plan. If none, write "None.".]

- [question] — [owner/blocker/evidence needed]

## Handoff to Structure Outline

[Concise notes the next phase should carry forward.]

- [decision/preference/pattern that must be preserved]
- [validation approach to include]
- [risk or unresolved decision to account for]

## Design Notes

[Any assumptions, conflicts resolved between documents, evidence gaps, agent research notes, or superseded decisions that matter for future readers.]
