---
type: research-questions
task: [task-slug-or-ticket-id]
date: [YYYY-MM-DD]
source_documents:
  - [path/to/source-or-ticket.md]
status: ready-for-research
---

# Research Questions: [Topic]

## Research Goal

Create objective, current-state codebase research for [brief topic]. These questions are intended for the `create-research-codebase` skill.

## Source Materials

- `[path/to/source-or-ticket.md]` - [brief description]
- `[path/to/related-doc.md]` - [brief description]

## Boundaries

- These questions ask how the codebase works today.
- They intentionally do not propose implementation choices, target architecture, or future changes.
- If the requested capability is new, research should focus on adjacent existing flows, contracts, extension points, and testing patterns.

## Questions

1. How does [existing flow or adjacent flow] work end to end today, from [entry point] through [state/output], and which components participate?
2. Where is [entity/config/event/schema/table] defined, validated, persisted, transformed, and consumed today?
3. What contracts exist between [component A] and [component B], including data shapes, ownership, errors, and lifecycle expectations?
4. What existing [similar feature/flow] patterns are present in the codebase, and how are they structured?
5. How is [area/component/flow] tested today, including test locations, fixtures, helpers, and coverage style?
6. What current configuration, external services, jobs, permissions, or failure paths affect [area]?

## Notes for Research Agent

- Stay factual and describe current codebase behavior only.
- Include file paths and line references for every finding.
- Document testing patterns for each researched area.
- Record open questions only when the current codebase evidence is insufficient.
