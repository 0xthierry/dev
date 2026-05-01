---
name: handoff
description: Use when context is running low, session ending, user mentions "handoff", "continue later", "save progress", or explicitly requests context transfer. Use when work is in progress and needs session continuation.
disable_model_invocation: true
---

# Handoff

Create context transfer documents for seamless session continuation.

## Overview

A handoff is a briefing for another engineer (or future you) with zero context. Your job: give them everything to be productive in minutes, not hours.

**Core principle:** Write for someone who will skim, can't infer from repo, and will trust your status assessment.

## When to Use

Use handoff when ANY of these apply:
- Context window approaching limits
- User says "handoff", "save progress", "continue later"
- Session ending with work in progress
- Completing a logical checkpoint in multi-session work
- User explicitly requests a handoff

## When NOT to Use

Skip handoff when:
- Task is complete with no follow-up needed
- User explicitly declines
- Work is trivial and context unnecessary

## Steps

**Step 1: Review Session + Git State**
[WHY: Next session has ZERO context. You must capture what happened, not just what exists.]

Scan the **current conversation** for:
- Plan files mentioned or read
- Source files modified or analyzed
- Key decisions made with the user
- Blockers or issues encountered

Capture git state:
```bash
git log --oneline -10    # What was committed
git status --short       # What's uncommitted
git diff --stat          # Size of uncommitted changes
```

**Step 2: Identify What Was Accomplished**
[WHY: The next engineer needs to know what works, what's broken, what's untested - not activities.]

Extract from conversation:
- Original goal/task
- What concrete progress was made
- Files created, modified, deleted
- What's currently working vs broken vs unverified
- Decisions made and WHY
- What remains to be done

**Step 3: Write Handoff Document**
[WHY: A structured format prevents omitting critical information under time pressure.]

Create file at `ai_docs/handoffs/YYYY-MM-DD-<description>.md`

**Step 4: Verify Completeness**
[WHY: Skimming your own work misses gaps. Explicit checks catch omissions.]

Run through verification checklist (see below).

**Step 5: Confirm with User**
[WHY: User may have context you missed or corrections to make.]

## Output Format

ALWAYS use this exact structure:

```markdown
# Handoff: <Task Title>

## Context
<What is this project/feature? 2-3 sentences. What problem are we solving?>

## Related Documents
- Plan: <path or "None">
- Research: <paths or "None">
- Brainstorm: <paths or "None">

## Git Summary
Branch: <current branch>
```
<git log --oneline -5 output>
```
Uncommitted: <yes/no + brief description>

## Goal + Acceptance Criteria
<What does "done" look like? Key constraints?>

## Status Snapshot
| Component | Status | Notes |
|-----------|--------|-------|
| <component 1> | WORKING | <verification method> |
| <component 2> | BROKEN | <error/symptom> |
| <component 3> | UNVERIFIED | <what needs checking> |

## Progress
- [x] <Completed item with specifics>
- [x] <Completed item with specifics>
- [ ] <Remaining item>
- [ ] <Remaining item>

## Key Decisions + Rationale
- <Decision>: <WHY we chose this approach>
- <Rejected alternative>: <WHY we didn't use it>

## Files Changed
- `<file_path>` - <what was done and why>
- `<file_path>` - <what was done and why>

## Current State (Honest Assessment)
<What works? What's broken? What's partially done?>

<Include actual error messages, test failures, or issues.>

## Risks + Unknowns
- <What you're least sure about>
- <What could go wrong>
- <Questions needing answers>

Use confidence levels:
- CERTAIN: "X is broken because Y" (test proves it)
- LIKELY: "Probably Z, hypothesis is H"
- UNKNOWN: "Could be A, B, or C - needs investigation"

## Next Steps (Ordered)
1. <First action - concrete command or task>
2. <Second action>
3. <Third action>

## How to Resume
```bash
# 1. Verify location and branch
pwd && git branch --show-current

# 2. Check recent work
git log --oneline -5

# 3. Verify clean state
git status

# 4. Run tests to confirm baseline
<project-specific test command>
```

Then:
1. Read: <specific file paths to read first>
2. First task: <concrete action to start with>
```

## Quick Reference

| Field | Purpose | Never Omit |
|-------|---------|------------|
| Status Snapshot | What works/broken/unverified | State of each component |
| Key Decisions + Rationale | Why choices were made | Prevents re-investigation |
| Current State | Honest assessment | Error messages, failures |
| Risks + Unknowns | What's uncertain | Confidence levels |
| How to Resume | Exact commands | Verification steps |

## Verification Checklist

Before presenting, verify ALL checks pass:

| Check | Question |
|-------|----------|
| **Context** | Would someone with zero context understand the project? |
| **Git State** | Is branch, recent commits, uncommitted work captured? |
| **Status Snapshot** | Is pass/fail/unverified status explicit for each component? |
| **Rationale** | Are decisions explained with WHY, including rejected alternatives? |
| **Current State** | Are problems, errors, failures EXPLICITLY stated (not hidden)? |
| **Risks** | Are unknowns and uncertainties documented? |
| **Actionable** | Can someone run "How to Resume" commands and be productive in 5 minutes? |
| **Honest** | Would you be comfortable if someone verified every claim? |

**If ANY check fails:** Revise before presenting.

## Examples

<good-example>
**Context:** Session implemented OAuth login. Two tests passing, one failing.

```markdown
# Handoff: Add OAuth Login

## Status Snapshot
| Component | Status | Notes |
|-----------|--------|-------|
| Google OAuth flow | WORKING | Tested manually, tokens refresh |
| Session persistence | WORKING | `npm test auth.test.ts` passes |
| Error handling | BROKEN | 401 redirect loops, see error below |

## Current State (Honest Assessment)
Login flow works for happy path. BUT: when token expires, redirect loop:
```
Error: Maximum redirect depth reached (10)
at handleAuthError (src/auth/handler.ts:47)
```
Root cause unknown - possibly missing refresh token logic.

## Key Decisions + Rationale
- Chose passport.js: mature, well-documented, team familiar with it
- Rejected Auth0: adds external dependency, overkill for our scale
- Session in Redis: needed for horizontal scaling, not just convenience
```

**Why good:** Explicit status per component, actual error message included, rationale explains WHY and rejected alternatives.
</good-example>

<bad-example>
```markdown
# Handoff: OAuth Work

## Progress
- Worked on OAuth
- Made good progress
- Some tests passing

## Next Steps
- Fix the bug
- Finish up
```

**Why bad:** Vague status ("good progress"), hides problems ("some tests"), no error details, no rationale, next steps not actionable.
</bad-example>

<good-example>
**Context:** Session ending mid-task, incomplete work.

```markdown
# Handoff: Refactor Payment Processing

## Status Snapshot
| Component | Status | Notes |
|-----------|--------|-------|
| Stripe integration | UNVERIFIED | Code written, not tested |
| Webhook handling | BROKEN | Signature validation failing |
| Legacy code removal | INCOMPLETE | 3 of 7 files migrated |

## Risks + Unknowns
- Stripe test mode may behave differently than production
- Unsure if webhook secret is correct in .env.local
- Legacy payment_v1.ts still imported somewhere (grep shows 2 refs)

## How to Resume
```bash
git status  # Should show 4 modified files
npm test -- --grep "payment"  # Currently 2 passing, 1 failing
```
Then: Fix webhook signature by checking STRIPE_WEBHOOK_SECRET in .env
```

**Why good:** Honest about incomplete/unverified state, specific risks identified, concrete verification commands.
</good-example>

<bad-example>
```markdown
## Status
Everything is mostly working, just needs some cleanup.

## Next Steps
1. Test things
2. Clean up code
```

**Why bad:** "Mostly working" hides problems, "test things" is not actionable, no risks mentioned.
</bad-example>

## Common Rationalizations

| Rationalization | Why It's WRONG | Required Action |
|-----------------|----------------|-----------------|
| "They can infer from the repo" | Code shows WHAT, not WHY. They'll repeat your dead ends. | **Document rationale and rejected alternatives** |
| "It's mostly working" | Vague status hides problems, successor builds on broken base | **Explicit WORKING/BROKEN/UNVERIFIED per component** |
| "2 of 3 tests pass (67%)" | Percentages obscure which component is broken | **Use component-level status, not percentages** |
| "I'll just summarize the highlights" | Summaries lose critical details like error messages | **Include actual errors, test output, specifics** |
| "The bug is obvious" | Obvious to you NOW. Not to fresh context. | **Document exact symptom, error, reproduction** |
| "Don't want to look bad" | Hiding failures wastes successor's time, erodes trust | **Be brutally honest about problems** |
| "They'll read it carefully" | Successors skim under pressure. | **Front-load critical info, use Status Snapshot table** |
| "I'll remember the context" | You won't. Fresh context = fresh mind. | **Write for complete amnesia** |
| "The error is in the test output" | Successor must run tests to find it | **Front-load errors in handoff, not buried in repo** |
| "Everyone knows what X means" | Shared vocabulary assumption fails with fresh context | **Name files, components, bugs explicitly** |

## Red Flags - STOP and Revise

- Writing "good progress" or "mostly working" without specifics
- Using percentages ("67% tests pass") instead of component status
- No error messages or test output when things are broken
- Status section without explicit WORKING/BROKEN/UNVERIFIED
- "Next steps" that require reading the conversation to understand
- First action can't be copy-pasted and run immediately
- Missing "How to Resume" commands
- Hiding or minimizing failures
- No rationale for key decisions
- Vague component names ("the feature", "the bug")

**All of these mean: Your handoff will cause wasted hours. Revise it.**

## Successor Test

Before submitting, verify a stranger could:
- [ ] Copy first command from "Next Steps" and run it immediately
- [ ] Understand WORKING/BROKEN/UNVERIFIED without reading any code
- [ ] Find every file mentioned without using `find` or `grep`
- [ ] Explain the top 2 risks to someone else

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Listing files from filesystem instead of session | Only include what was relevant to THIS session |
| "Everything works" when it doesn't | Be explicit about WORKING vs BROKEN vs UNVERIFIED |
| Generic next steps ("finish the feature") | First step must be a concrete command |
| Missing rationale for decisions | Always explain WHY, not just WHAT |
| Too long (>600 words) | Cut to essential information |
| No error messages or test output | Include actual output the next engineer needs |
| No git summary | Always include branch + `git log --oneline -5` |
| Skipping "How to Resume" | Include exact verification commands |
| Assuming shared vocabulary | Define "the bug", "the feature" explicitly |
| Writing for yourself, not a stranger | Write for someone who will skim with zero context |
