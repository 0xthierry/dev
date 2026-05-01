---
task: "[task-slug-or-ticket-id]"
type: plan
repo: "[repository name or owner/name]"
branch: "[current branch]"
sha: "[current commit SHA]"
date: "[ISO-8601 timestamp with timezone]"
status: "ready-for-implementation"
source_outline: "[path/to/YYYY-MM-DD-structure-outline.md]"
source_design: "[path/to/YYYY-MM-DD-design-discussion.md]"
source_research: "[path/to/YYYY-MM-DD-research.md]"
sprint_contract: "[path/to/.sprint-contract.json]"
source_documents:
  - "[path/to/ticket-or-spec.md]"
related_grills:
  - "[path/to/grill.md]"
---

# Implementation Plan: [Task / Change Name]

## Plan Goal

[One concise paragraph describing what this plan will implement and the observable outcome after all phases complete.]

## Source Context

| Source | Role in this plan | Notes |
| --- | --- | --- |
| `[structure-outline.md]` | Phase order and implementation shape | [brief note] |
| `[design-discussion.md]` | Decisions and preferences | [brief note] |
| `[research.md]` | Current codebase evidence and testing patterns | [brief note] |
| `[ticket-or-spec.md]` | Original request | [brief note or "None"] |

## Current State and Key Evidence

[Current behavior, architecture, and constraints that matter for implementation. Include file references/permalinks.]

- [`path/to/file.ext:10`](link) - [technical fact]
- [`path/to/test.ext:25`](link) - [test pattern]

## Desired End State

[Specific end state after all phases. State how it will be verified.]

- [desired outcome and verification signal]
- [desired outcome and verification signal]

## What We're Not Doing

[Explicit non-goals from the outline/design, plus any scope boundaries needed for implementers.]

- [non-goal]
- [non-goal]

## Design Preferences Applied

[Cross-cutting preferences from the design discussion/outline. If none were stated, write "None stated — follow existing codebase conventions."]

- [preference and where it affects new code]

## Decisions and Requirement Coverage

| Requirement / Decision | Implemented in phase(s) | Verification |
| --- | --- | --- |
| [desired outcome or D1 decision] | Phase [N] | [test/check] |
| [desired outcome or D2 decision] | Phase [N, M] | [test/check] |

## Evidence and Definitions Read

[List actual files/types/schemas/tests/commands read before writing code-level instructions.]

| Evidence | Why it was read |
| --- | --- |
| [`path/to/type.ext:10-40`](link) | [type/schema used in planned code] |
| [`path/to/test.ext:50-90`](link) | [test convention/fixture used] |
| [`package.json`](link) | [validation command source] |

## Implementation Approach

[High-level approach in 3-6 bullets. Explain sequencing, risk reduction, compatibility, and validation strategy.]

- [approach]
- [approach]

## Security, Privacy, and Operational Considerations

[Include only considerations relevant to the change. If none, write "No new security, privacy, or operational considerations beyond existing code paths were identified.".]

- [consideration and phase impact]

---

## Phase 1: [Descriptive Phase Name]

- [ ] Phase 1 complete

### Objective

[What this phase implements and what becomes verifiable.]

### Dependencies

- [dependency, or "None."]

### Implementation Steps

#### 1.1 [Component/File Group]

**File:** `path/to/file.ext`

**Current evidence:** [`path/to/file.ext:10-40`](link)

**Change:** [Specific change and where to apply it.]

```diff
[focused diff or complete changed block with real logic]
```

**Notes:** [Important implementation constraints, compatibility notes, or why this follows a pattern.]

#### 1.2 [Another Component/File Group]

**File:** `path/to/other.ext`

**Current evidence:** [`path/to/other.ext:20-80`](link)

**Change:** [Specific change and where to apply it.]

```[language]
[complete changed function/class/schema/test block with no stubs]
```

### Tests

#### 1.T1 [Test Name]

**File:** `path/to/test.ext`

**Current evidence/pattern:** [`path/to/existing-test.ext:30-70`](link)

**Test code:**

```[language]
[complete test or focused diff with concrete value assertions]
```

**Assertions covered:**

- [happy path concrete value]
- [edge/error path concrete value]

### Failure and Edge Behavior

[Describe expected behavior for important failure/edge cases and where tests or checks cover them.]

- [failure/edge behavior]

### Success Criteria

#### Automated Verification

- [ ] [Command/check and expected result, e.g. `bun test path/to/test.ext` exits 0]
- [ ] [Command/check and expected result]

#### Manual Verification

[Only include when materially useful. If none, write "None required.".]

- [ ] [specific manual step and expected result]

### Human Checkpoint

[If manual verification exists: "Pause after automated verification and wait for human confirmation of the manual checks before Phase 2." Otherwise: "No manual checkpoint required for this phase.".]

---

## Phase 2: [Descriptive Phase Name]

- [ ] Phase 2 complete

### Objective

...

### Dependencies

- [dependency, or "None."]

### Implementation Steps

#### 2.1 [Component/File Group]

**File:** `path/to/file.ext`

**Current evidence:** [`path/to/file.ext:10-40`](link)

**Change:** [Specific change and where to apply it.]

```[language]
[complete changed block with no stubs]
```

### Tests

#### 2.T1 [Test Name]

**File:** `path/to/test.ext`

**Test code:**

```[language]
[complete test or focused diff with concrete value assertions]
```

### Failure and Edge Behavior

- [failure/edge behavior]

### Success Criteria

#### Automated Verification

- [ ] [Command/check and expected result]

#### Manual Verification

None required.

### Human Checkpoint

No manual checkpoint required for this phase.

---

## Cross-Phase Regression Verification

[Commands/checks that should run after every phase or after final phase. These must also appear in `.sprint-contract.json` under `regression.commands`.]

- [ ] [`command` exits 0]
- [ ] [`command` exits 0]

## Sprint Contract

Write the following machine-readable criteria to `.sprint-contract.json` in this task directory. The evaluator uses this file as the primary automated source of truth.

```json
{
  "phases": {
    "1": {
      "name": "[Phase 1 name]",
      "criteria": [
        { "type": "command", "cmd": "[phase-specific test command]", "expect": "exit 0" },
        { "type": "file_exists", "path": "[path/to/new/file.ext]" },
        { "type": "grep", "file": "[path/to/file.ext]", "pattern": "[expected symbol or content]" }
      ]
    },
    "2": {
      "name": "[Phase 2 name]",
      "criteria": [
        { "type": "command", "cmd": "[phase-specific test command]", "expect": "exit 0" }
      ]
    }
  },
  "regression": {
    "commands": ["[full test suite command]", "[typecheck command]", "[lint command]"]
  }
}
```

Supported criterion types are `command`, `curl`, `file_exists`, and `grep`.

## Open Questions

[Only include if plan readiness is blocked or partially blocked. If none, write "None.".]

- [question] — [owner/evidence needed/phase impact]

## Plan Notes

[Any assumptions, document conflicts resolved, intentional divergence from the outline, validation caveats, or generated-file/dependency notes.]
