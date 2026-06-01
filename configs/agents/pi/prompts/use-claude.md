---
description: Use Claude as an adversarial collaborator before composing the final result
argument-hint: "[task, draft, or question]"
---
Use Claude Code as an adversarial collaborator for this Pi session, then synthesize the result yourself.

User-provided focus, if any: $ARGUMENTS

## Intent

This is not "ask Claude to review this prompt" and not "let Claude answer instead of Pi". Treat Claude as a second model playing a cooperative adversary: it should challenge assumptions, expose weak premises, identify missing evidence, suggest sharper framing, and help produce a better final answer/result for the user.

## Protocol

1. Determine the artifact to improve:
   - If the user supplied a task/draft/question in the focus line above, use that.
   - If the current session already has a draft answer, plan, diff, or decision under discussion, use that.
   - If there is no concrete artifact or task, ask the user what to send to Claude before running anything.
2. Build a concise packet for Claude containing:
   - the user's actual goal;
   - relevant constraints and assumptions;
   - Pi's current draft/plan/answer, if one exists;
   - any known evidence, files, command output, or uncertainties;
   - what kind of final result the user needs.
3. Run Claude Code non-interactively from the current working directory with **these flags exactly**:

```bash
claude -p --dangerously-skip-permissions --effort xhigh <<'CLAUDE_ADVERSARIAL_REVIEW'
You are an adversarial collaborator helping another LLM produce a better result for the user.

Do not be a generic reviewer. Do not merely summarize. Your job is to challenge the current direction while remaining cooperative.

Stress-test:
- hidden assumptions and unjustified premises;
- missing constraints, edge cases, and counterexamples;
- places where the answer may be overconfident, vague, or unsupported;
- alternative framings or simpler approaches;
- what evidence would change the conclusion;
- what the other model should ask the user before proceeding, if anything is materially ambiguous.

If the packet includes code, plans, commands, or file paths, inspect what you need, but do not modify files unless the packet explicitly asks for implementation help. Prefer critique and synthesis guidance over edits.

Return concise structured output:
1. Strongest challenges
2. Missing assumptions/evidence
3. Recommended changes to the final answer/result
4. If relevant, exact wording or structure to use

Packet:
<replace this line with the packet prepared by Pi>
CLAUDE_ADVERSARIAL_REVIEW
```

4. Read Claude's output skeptically. Do not copy it wholesale. Reconcile disagreements, verify factual or code claims when needed, and decide what survives scrutiny.
5. Produce the final response to the user as Pi, incorporating Claude's useful challenges. Mention Claude only if useful; otherwise just provide the improved result.

## Rules

- Keep the user's goal primary; Claude is an input, not the decision-maker.
- Do not let the adversarial pass become performative negativity. Convert challenges into concrete improvements.
- If Claude identifies a blocker or ambiguity that materially changes the answer, pause and ask the user rather than pretending certainty.
- If Claude CLI is unavailable, fails, or lacks auth, say so and continue with a single-model adversarial self-check instead.
