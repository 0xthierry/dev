---
name: implement-plan
description: "Use when implementing an ai_docs/tasks/* plan phase-by-phase with implementation subagents, parallel review/validation, sprint-contract checks, human checkpoints, and commits."
effort: high
disable_model_invocation: true
disable-model-invocation: true
---

# Implement Plan

## Goal

Orchestrate phased implementation of an approved `ai_docs/tasks/.../*-plan.md` file.

Good execution keeps each phase bounded, uses an implementation subagent for code changes, uses validation commands plus read-only `explorer` review subagents for empirical verification, fixes only evidence-backed failures, pauses for human review at the right checkpoints, and commits clean phase-sized changes without unrelated work.

## When to Use

Use this skill when the user asks to implement, execute, continue, resume, or run phases from a plan file under `ai_docs/tasks/`.

Use a different skill when the user wants to create or revise the plan (`create-plan`), structure outline (`create-structure-outline`), design discussion (`create-design-discussion`), or research artifacts.

## Success Criteria

Before final response:

- Every requested phase has completed the implementer → validation/review → fix loop.
- Phase-specific `.sprint-contract.json` criteria and relevant regression checks have been run when present.
- No phase is treated as passing unless automated criteria pass and read-only quality review has no blocking issues/concerns.
- Human-required manual verification has been surfaced and confirmed before committing/proceeding, unless the user explicitly authorized batching or skipping the pause.
- Each committed phase contains only that phase's code, tests, plan/checkbox updates, and directly related generated files.
- Any failed phase stops after the retry budget and reports all evaluator evidence instead of silently continuing.
- Final response follows `references/implement_plan_final_answer.md`.

## Operating Rules

- Start multi-step work with a brief user-visible preamble before tool calls.
- If no plan path is provided, ask for it. Do not guess among multiple plan files.
- Read the plan fully before launching agents. Read `.sprint-contract.json` if present.
- Check `git status --short` before starting and before each commit. Do not include unrelated user changes in phase commits.
- The orchestrator coordinates; it does not bypass the implementer/validation/review loop for normal code changes.
- Keep subagent prompts short and outcome-first. The agents read the plan and contract themselves.
- Do not proceed to the next phase or commit unless the user has approved the phase checkpoint, except when the user explicitly requested consecutive phases without intermediate pauses.
- Do not create AI attribution in commits, code comments, or generated artifacts.

## Phase Selection Rules

- If the user names a phase or range, implement only that scope.
- If resuming without a named phase, read plan checkboxes and start with the first incomplete phase.
- Treat a checked phase as complete unless current evidence suggests mismatch or the user asks to re-evaluate it.
- If `.sprint-contract.json` and plan text disagree on automated criteria, the contract is primary for evaluator automation; record the mismatch if it affects execution.
- If the plan has a material open question or missing automated criteria for the target phase, stop and ask whether to revise the plan first.

## Retry Budget

Each phase gets:

- one initial implementation attempt;
- up to three targeted fix attempts after evaluator failures.

After the third fix attempt, run the evaluator one final time. If it still fails, escalate to the human with all evaluator reports and what was attempted. Do not silently retry beyond the budget.

## Workflow

### 1. Pre-flight

1. Resolve the plan path and working directory.
2. Read the full plan and `.sprint-contract.json` if present.
3. Identify phases, phase checkboxes, manual verification requirements, and requested phase scope.
4. Run `git status --short` and note pre-existing changes.
5. If unrelated dirty files could be swept into commits, ask how to proceed before launching implementation.

### 2. Implement the current phase

Launch `implementer-agent` with a short prompt:

```text
Implement Phase [N] of [plan path].
Working directory: [cwd]
Scope: Phase [N] only.
Do not commit. Stop and report if the plan cannot be followed without a design decision.
```

If this is a targeted fix after evaluator failure:

```text
Fix Phase [N] evaluator failures for [plan path].
Working directory: [cwd]
Scope: fix only the failures below; do not redo passing work and do not commit.
Evaluator report:
[paste full evaluator report]
```

### 3. Validate and review the phase

Run the phase-specific `.sprint-contract.json` criteria and relevant regression commands in the parent session when practical. Preserve exact command output for failures.

Then launch read-only `explorer` review subagents in parallel for the phase diff:

```text
Review Phase [N] of [plan path] after implementation.
Working directory: [cwd]
Scope: read-only review of the current diff for Phase [N]. Do not edit files.
Lens: [correctness/regressions | tests/validation | contracts/state/security as relevant].
Return blocking findings with path:line evidence, concrete scenario, and suggested fix. If none, return No findings.
```

A clean pass requires automated success plus no blocking quality issues/concerns from the review subagents or parent spot-checks.

### 4. Handle validation/review result

- **Clean PASS:** report the checkpoint to the human.
- **PASS with non-blocking nits only:** report the nits and ask whether to address them now.
- **Blocking review finding or failed command:** send the exact evidence to the implementer for targeted fixes within the retry budget.
- **Blocked/unclear:** stop and ask the human with the concrete blocker and evidence.

### 5. Report checkpoint to human

Use this shape after a clean evaluator pass:

```markdown
## Phase [N]: PASS after [attempt count] implementation attempt(s)

**Validation verdict:** PASS ([passed]/[total] criteria)

**Regression suite:** [concise result]
**Phase criteria:** [concise result]
**Quality review:** [clean, or nits only]

**Manual verification required:**
- [manual step, or "None"]

Ready to commit Phase [N] and proceed to Phase [N+1], or tell me what to adjust.
```

If manual verification is required, wait for explicit confirmation that it passed before committing or proceeding. If no manual verification is required, still wait for approval unless the user explicitly requested automatic consecutive phase execution.

### 6. Commit the phase

After human approval:

1. Run `git status --short`.
2. Stage only files belonging to the approved phase.
3. Mark the phase complete in the plan if the plan uses phase checkboxes and the evaluator/human checkpoint has passed.
4. Create a conventional commit for the phase, e.g. `feat(scope): implement phase 1 [short title]`.
5. Confirm the commit hash and continue only within the user's requested scope.

Do not commit unrelated changes. If unrelated files are dirty, leave them unstaged and mention them.

### 7. Escalate when needed

If a phase still fails after the retry budget, report:

- all validation/review reports or links/summaries with exact failures;
- what the implementer attempted each round;
- current git status;
- options: revise plan, continue with a new approach, skip/relax a criterion, or stop.

Then wait for the human.

### 8. Complete final handoff

When all requested phases are implemented, evaluated, approved, and committed:

1. Read `references/implement_plan_final_answer.md`.
2. Respond with implementation status, commits, validation evidence, remaining risks/open questions, and next `describe-pr` prompt.

## Multiple-Phase Requests

If the user explicitly asks to run multiple phases consecutively:

- still run implementer and evaluator per phase;
- stop immediately on escalation or manual verification that must happen before later phases are safe;
- if manual verification can safely be batched, report all deferred manual checks before the final commit/proceed decision;
- commit per phase unless the user explicitly asks for a single final commit.

## Common Mistakes

- Letting the implementer self-certify without independent validation/review.
- Treating passing tests as enough when read-only quality review found a blocking issue.
- Retrying indefinitely instead of escalating with evidence.
- Committing before human confirmation.
- Sweeping unrelated dirty files into a phase commit.
- Implementing the next phase while manual verification for the current phase is still pending.
- Editing code directly in the orchestrator and bypassing the phase loop.
