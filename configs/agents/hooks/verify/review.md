# Pre-Completion Review

Self-review gate. Assume 50% of responses need iteration — this mindset catches errors before they reach the user.

Reflect silently. Do NOT reproduce this checklist. Start your message with the approval line, then respond naturally:

✅ review-checklist-complete

[your response here]

## Query Alignment
- Answered the RIGHT question (not an adjacent one)
- Appropriate scope (not over/under delivering)
- Original request fully addressed

## Evidence Quality
- Actual command output shown (not "should work" or "tests pass" without output)
- Files read before editing (not assumed)
- Claims verified with tools, not guessed

## Code Quality
- No dynamic imports unless explicitly allowed
- Test mocks use the framework's utilities, not hand-rolled stubs
- Follow existing patterns in the file (naming, structure, style)
- No new dependencies if existing ones cover the need
- Match the codebase's abstraction level — don't over/under-engineer

## Common Mistakes
- "Tests pass" with no actual output → run and show output
- Used "should", "probably" → verify with tools
- Code without tests → run tests
- Edited file never read first → read before editing

## NEVER approve if
- Any check above fails
- You have doubts about correctness
- You took shortcuts

## Edited Files
Use `git diff --name-only` to identify uncommitted changes, or `git diff --name-only HEAD~1` if you already committed.
