---
task: eng-xxxx-description
type: plan
repo: [current repository]
branch: [current branch name]
sha: [result of git rev-parse HEAD]
---

# [Feature/Task Name] Implementation Plan

## Overview

[Brief description of what we're implementing and why]

## Current State Analysis

[What exists now, what's missing, key constraints discovered]

### Key Discoveries:
- [Important finding with file:line reference]
- [Pattern to follow]
- [Constraint to work within]

## Desired End State

[A specification of the desired end state after this plan is complete, and how to verify it]

## What We're NOT Doing

[Explicitly list out-of-scope items to prevent scope creep]

## Implementation Approach

[High-level strategy and reasoning]

---

## Phase 1: [Descriptive Name]

### Overview
[What this phase accomplishes]

### Changes Required:

#### 1.1 [Component/File Group]

**File**: `path/to/file.ext`
**Changes**: [Summary of changes] - [around line X | add after Y | etc etc]

```diff
// Specific code to add/modify
+ export function [name]() {
     // existing logic...
+    [code changes to make]
+ 
+ }

export interface [name]{ 
   // existing fields (a, b, c, d, e)
+  [new fields to add]
+  [new fields to add]
}
```


#### 1.2 [Another Component/File Group]

**File**: `path/to/file.ext`
**Changes**: [Summary of changes]

...

### Success Criteria:

#### Automated Verification:
- [ ] [Migration applies cleanly: `bun run ...`]
- [ ] [Type checking passes: `bun run typecheck`]
- [ ] [Tests pass: `bun run test`]
- [ ] [other automated verification as appropriate: curl, sql queries, etc]

<optional if="manual validation relevant">
#### Manual Verification:
- [ ] [manual step 1]
- [ ] [manual step 2]

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.
</optional>

---

## Phase 2: [Descriptive Name]

[Same structure as Phase 1...]

---

## Sprint Contract

After writing all phases, generate a `.sprint-contract.json` file in the same directory as the plan. This is a machine-readable version of the success criteria that the evaluator agent uses for automated verification.

Format:

```json
{
  "phases": {
    "1": {
      "name": "[Phase 1 name]",
      "criteria": [
        { "type": "command", "cmd": "[test command]", "expect": "exit 0" },
        { "type": "command", "cmd": "[typecheck command]", "expect": "exit 0" },
        { "type": "curl", "url": "[endpoint]", "method": "GET", "expect_status": 200 },
        { "type": "file_exists", "path": "[path/to/new/file]" },
        { "type": "grep", "file": "[path/to/file]", "pattern": "[expected content]" }
      ]
    },
    "2": {
      "name": "[Phase 2 name]",
      "criteria": [...]
    }
  },
  "regression": {
    "commands": ["[full test suite command]", "[typecheck command]", "[lint command]"]
  }
}
```

Criterion types:
- `command`: Run a shell command, check exit code
- `curl`: HTTP request, check status code (and optionally response body)
- `file_exists`: Verify a file exists at the given path
- `grep`: Verify a pattern exists in a file
