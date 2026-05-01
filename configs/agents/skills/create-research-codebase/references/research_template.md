---
type: research
task: "[task-slug-or-ticket-id]"
topic: "[research topic]"
date: "[ISO-8601 timestamp with timezone]"
repository: "[repository name or owner/name]"
branch: "[current branch]"
git_commit: "[current commit SHA]"
working_tree: "[clean|dirty]"
research_questions: "[path/to/YYYY-MM-DD-research-questions.md]"
source_documents:
  - "[path/to/source-document.md]"
status: complete
---

# Research: [Research Topic]

## Research Goal

[One concise paragraph describing the current-state codebase behavior this research documents. Do not describe desired changes or proposed implementation.]

## Questions Answered

1. [Question copied from the research-questions document]
2. [Question copied from the research-questions document]

## Research Method

- Main-session role: read the research-questions document, designed the research agenda, synthesized findings, spot-checked key claims, and wrote this document.
- Research agents used:

| Agent | Area | Purpose |
| --- | --- | --- |
| codebase-locator | [area] | [files/boundaries located] |
| codebase-analyzer | [area] | [behavior/contracts traced] |
| codebase-pattern-finder | [area] | [patterns/tests identified] |

[If subagents were unavailable, replace the table with the blocker and the direct-research fallback used.]

## Executive Summary

[2-4 bullets summarizing the most important current-state findings with file references. Keep this factual and free of recommendations.]

- [Finding with `path/to/file.ext:line`]
- [Finding with `path/to/file.ext:line`]

## Evidence Map

| Area | Primary Evidence | Tests / Fixtures | Notes |
| --- | --- | --- | --- |
| [Component/flow] | [`path/to/file.ext:10`](link) | [`path/to/test.ext:20`](link) | [short factual note] |

## Detailed Findings

### [Component or Area]

#### Current behavior

[Describe what the code does today. Include line references for concrete claims.]

#### Data, contracts, and boundaries

[Describe relevant types, schemas, request/response shapes, config keys, external boundaries, ownership, and lifecycle behavior. Include line references.]

#### Control flow

[Trace important flow across files/components. Use a short ordered list when that is clearer.]

1. [`path/to/entry.ext:10`](link) receives/starts [event/request/action].
2. [`path/to/worker.ext:42`](link) calls [function/service] with [shape].
3. [`path/to/store.ext:80`](link) persists/returns [state/output].

#### Testing patterns

[Describe current tests, fixtures, helpers, mocks, and assertion style. If no tests were found, name the searches/locations checked.]

### [Second Component or Area]

...

## Question-by-Question Answers

### 1. [Question]

[Direct answer with the evidence needed to support it.]

### 2. [Question]

[Direct answer with the evidence needed to support it.]

## Code References

- [`path/to/file.ext:10-35`](link) - [what this block defines or does]
- [`path/to/test.ext:50-90`](link) - [what this test covers]

## External References

[Only include if external documentation or web research was explicitly used. Otherwise write "None.".]

- [Source title](https://example.com) - [what fact it supports]

## Open Questions

[Current-state codebase questions that could not be answered from available evidence. Do not include future-planning questions. If none, write "None.".]

- [Question] — [evidence searched / blocker]

## Research Notes

- [Any assumptions, excluded sources, ambiguous evidence, or validation caveats relevant to interpreting this research.]
