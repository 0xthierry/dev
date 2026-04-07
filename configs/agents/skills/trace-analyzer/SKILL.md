---
name: trace-analyzer
description: Analyze past Claude Code session transcripts to identify failure patterns, doom loops, and harness improvement opportunities. Use after a session went wrong, or periodically to improve your setup.
effort: high
---

# Trace Analyzer

Analyze past Claude Code session transcripts to find patterns, failures, and improvement opportunities.

## When to Use

- After a session that went poorly (doom loops, wrong approach, wasted tokens)
- Periodically to review recent sessions and improve the harness
- When the user says "analyze traces", "review sessions", "what went wrong"

## Process

### Step 1: Find Transcripts

```bash
ls -lt ~/.claude/projects/*/transcripts/*.jsonl 2>/dev/null | head -20
```

If no transcripts found, check:
```bash
ls -lt ~/.claude/projects/*/*.jsonl 2>/dev/null | head -20
```

Ask the user which session(s) to analyze, or analyze the most recent ones.

### Step 2: Parse Transcript

Read the JSONL transcript. Each line is a JSON event. Focus on:

- `tool_use` events — what tools were called, with what inputs
- `tool_result` events — success/failure, error messages
- `assistant` messages — what the agent said and decided
- Repeated patterns in tool calls (same file edited multiple times = potential doom loop)

### Step 3: Identify Patterns

Look for these anti-patterns:

**Doom Loops**
- Same file edited 5+ times in sequence
- Same command retried 3+ times with the same or similar input
- Agent cycling between two approaches without converging

**Premature Completion**
- Agent declared "done" but tests were failing
- Agent skipped verification steps
- Agent said "should work" without running the code

**Context Waste**
- Reading files that were never referenced again
- Spawning sub-agents whose results were ignored
- Long tangential explorations that didn't contribute to the solution

**Wrong Approach**
- Agent started implementing before understanding the codebase
- Agent followed a pattern that didn't match the project's conventions
- Agent made assumptions that were contradicted by code it read later

**Guard Violations**
- Edits to files outside the task scope
- Destructive commands that had to be undone
- Commits without running tests first

### Step 4: Generate Report

Write a report to `ai_docs/traces/YYYY-MM-DD-analysis.md`:

```markdown
---
date: YYYY-MM-DD
sessions_analyzed: [count]
---

# Session Trace Analysis

## Summary
[1-2 sentence overview of findings]

## Anti-Patterns Found

### [Pattern Name]
- **Frequency**: [how many times across sessions]
- **Example**: [specific transcript excerpt]
- **Impact**: [tokens wasted, time lost, wrong output]
- **Recommended fix**: [specific harness change — hook, skill update, CLAUDE.md rule]

### [Another Pattern]
...

## Harness Improvement Recommendations

1. [Specific, actionable recommendation with implementation details]
2. [Another recommendation]
...

## Session Quality Scores

| Session | Date | Duration | Tool Calls | Doom Loops | Premature Exits | Score |
|---------|------|----------|------------|------------|-----------------|-------|
| [id] | [date] | [turns] | [count] | [count] | [count] | [1-10] |

## Metrics

- Total tool calls analyzed: [count]
- Failure rate: [%]
- Average edits per file: [count]
- Most edited files: [list]
```

### Step 5: Present Findings

Summarize the top 3 actionable improvements and ask the user if they want to implement any of them.
