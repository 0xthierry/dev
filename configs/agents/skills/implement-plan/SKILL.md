---
name: implement-plan
description: phased implementation of a structured plan you must use this skill when asked to implement a plan file in ai_docs/tasks/*
---

# Phased Implementation Orchestrator

You are responsible for orchestrating the phased implementation of technical plans from `ai_docs/tasks/`. Each phase follows a generate → evaluate → fix loop with a max of 3 retries before escalating to the human.

## Workflow

For each phase in the implementation plan:

### 1. Launch Implementer Agent
Use the Task tool with `subagent_type=implementer-agent` to implement the current phase.

```
Implement Phase [N] of the plan at ai_docs/tasks/ENG-XXXX-description/YYYY-MM-DD-plan.md
Focus only on Phase [N] and stop after completing it.
```

Keep the prompt short — the implementer reads the plan itself.

### 2. Launch Evaluator Agent
After the implementer finishes, launch the evaluator to verify the work:

```
Evaluate Phase [N] of the plan at ai_docs/tasks/ENG-XXXX-description/YYYY-MM-DD-plan.md
Run the full regression suite AND all phase-specific success criteria.
Working directory: [cwd]
```

Use the Task tool with `subagent_type=evaluator-agent`.

### 3. Handle Evaluation Result

**If PASS** (all criteria met):
- Proceed to step 4 (report to human)

**If FAIL** (any criterion failed):
- Send the evaluator's feedback to the implementer:

```
Fix Phase [N] failures. Evaluator report:
[paste evaluator's structured feedback]

Focus only on fixing the failures — do not redo work that passed.
Plan: ai_docs/tasks/ENG-XXXX-description/YYYY-MM-DD-plan.md
```

- Re-run the evaluator after fixes
- **Max 3 rounds.** If still failing after 3 attempts, escalate to the human with the full failure report and ask for guidance.

### 4. Report to Human

```
## Phase [N]: [PASS after N attempts / ESCALATED]

**Evaluator verdict:** [PASS/FAIL] ([X]/[Y] criteria)

**Regression suite:**
- [results from evaluator]

**Phase criteria:**
- [results from evaluator]

**Manual verification required:**
- [manual steps from plan, if any]

Ready to proceed to Phase [N+1], or let me know if any issues need addressing.
```

### 5. Wait for Human Confirmation
Wait for the human to:
- Confirm manual checks passed (if any)
- Report any issues found
- Give permission to continue

### 6. Commit the changes
- Create a new commit for the phase's changes
- Do not include any claude attribution

### 7. Repeat for Next Phase

## Special Instructions

### Resuming Work
If resuming a partially completed plan:
- Check the plan file for existing checkmarks (- [x])
- Resume from the first unchecked phase
- Trust completed work unless something seems off

### Handling Evaluator Escalation
When the evaluator fails 3 rounds:
- Present ALL three evaluator reports to the human
- Explain what the implementer tried each round
- Ask whether to continue trying, modify the plan, or skip the criterion
- Do NOT silently retry beyond 3 rounds

### Multiple Phases
If instructed to implement multiple phases consecutively:
- Still run implementer + evaluator for each phase
- Only pause for human verification after the final phase
- If any phase escalates, stop and report

### Waiting for Input
Unless expressly asked, don't commit or proceed to the next phase until the human has reviewed and approved.

## TODO per phase:

- [ ] launch implementer
- [ ] launch evaluator
- [ ] if fail: retry loop (max 3)
- [ ] report to human
- [ ] wait for confirmation
- [ ] commit changes
- [ ] next phase

## After Final Phase Completion

When ALL phases are complete and verified:

1. Commit the final changes
2. Read the final output template:

`Read({SKILLBASE}/references/implement_plan_final_answer.md)`

3. Respond with a summary following the template

## Getting Started

When invoked:
1. Ask for the plan path if not provided
2. Read the plan to understand the phases
3. Begin with Phase 1 (or first unchecked phase if resuming)
4. Follow the workflow above

Your role is orchestration. The implementer writes code, the evaluator verifies it, you coordinate and communicate with the human.
