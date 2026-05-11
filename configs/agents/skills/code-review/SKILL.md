---
name: code-review
description: "Use when asked to review a code diff, PR, branch, staged changes, or recently implemented work for correctness, regressions, security, tests, and maintainability."
effort: high
disable_model_invocation: true
disable-model-invocation: true
---

# Code Review

## Goal

Produce an evidence-backed review of the requested change by running focused read-only subagents in parallel, then synthesizing the findings into a concise verdict.

Good review finds real defects with concrete `path:line` evidence and scenarios. It does not rewrite the code, bikeshed style, or bury the user under speculative concerns.

## When to Use

Use this skill when the user asks for a code review, PR review, diff review, staged-change review, implementation review, or "look for bugs" pass.

Use a different workflow when the user asks to implement fixes immediately. In that case, review first, synthesize accepted findings, then use a writer/worker only for the fixes the user authorized.

## Success Criteria

Before final response:

- The review scope is explicit: diff range, branch/PR, staged changes, plan implementation, or named files.
- Parallel `explorer` subagents inspected distinct review lenses unless the scope is too small to justify all five.
- Each reported finding has severity, location, concrete scenario, evidence, and suggested fix.
- Findings are deduplicated and spot-checked by the parent before presentation.
- False positives, style-only comments, and unsupported speculation are omitted.
- If no actionable findings exist, the final answer says so and names the evidence reviewed.

## Operating Rules

- Parent session owns orchestration, synthesis, and final judgment. Do not pass this skill to children.
- Children are read-only reviewers. Their prompts must say: do not edit, stage, commit, or revert files.
- Prefer fresh-context `explorer` agents so reviewers do not inherit parent assumptions.
- Give each subagent the same review scope and a different lens. Do not duplicate lenses.
- Reviewers must inspect source directly, not rely only on the diff summary.
- Security findings must include a concrete attack/data-exposure scenario. Async/state findings must include a concrete state or timing scenario.
- Do not claim a finding until the parent has checked that the cited file/line and scenario are plausible.

## Workflow

### 1. Resolve review scope

Identify the target:

- staged diff: `git diff --staged`;
- unstaged/current worktree diff: `git diff` plus `git status --short`;
- branch/PR diff: compare against the requested base;
- plan implementation: read the plan and inspect the implementation diff;
- named files: read those files and their relevant callers/tests.

If the review target is ambiguous, ask one narrow question before launching reviewers.

### 2. Launch parallel review agents

Run up to five fresh-context `explorer` subagents in parallel. For very small diffs, use the most relevant two or three lenses.

Recommended lenses:

1. **Correctness and regressions** — changed behavior, edge cases, failure paths, and user-visible regressions.
2. **Cross-file contracts** — consumers of changed types, exports, constants, routes, config keys, schemas, and feature flags.
3. **Security and trust boundaries** — auth, SSRF, injection, secrets, logs, path traversal, permissions, replay, and fail-open behavior.
4. **State, lifecycle, and async** — races, stale cache, cancellation, cleanup, resource leaks, retries, and concurrent operations.
5. **Tests, validation, and simplicity** — missing meaningful tests, invalid validation claims, over-complexity, dead code, and maintainability risks.

Example agent tool shape:

```json
{
  "tasks": [
    {
      "subagent_type": "explorer",
      "description": "Correctness review",
      "prompt": "Review [scope] for correctness/regression bugs only. Read the diff, changed files, relevant callers, and tests. Do not edit files. Return findings only in the required format with path:line evidence, concrete scenario, and fix; otherwise return 'No findings.'"
    },
    {
      "subagent_type": "explorer",
      "description": "Cross-file contract review",
      "prompt": "Review [scope] for cross-file contract mismatches: changed exports, types, constants, routes, config, schemas, and consumers. Use search for old and new names. Do not edit files. Return findings only with path:line evidence; otherwise return 'No findings.'"
    }
  ],
  "context": "fresh"
}
```

Adapt prompts to the repository and include exact diff commands, PR numbers, plan paths, or file paths.

### 3. Synthesize findings

For each subagent result:

- discard unsupported claims, style-only comments, and duplicates;
- spot-check file paths, line references, and scenarios;
- combine overlapping findings under the clearest location;
- rank by severity and user impact.

Severity guide:

- **P1**: likely breakage, data loss, auth/security bypass, production-visible regression, or invalid validation path.
- **P2**: credible bug/risk with narrower impact, missing important test, latent race, or contract drift.
- **P3**: maintainability or clarity concern worth considering but not blocking.

### 4. Final response

Use this shape:

```markdown
## Review Verdict
[Pass / Findings / Blocked] — [one-sentence summary]

## Findings
1. **[P1/P2/P3] [Title]** — `path:line`
   - Scenario: [concrete failure]
   - Evidence: [what was inspected]
   - Suggested fix: [specific action]

## Checked
- Scope: [diff/PR/files]
- Review lenses: [lenses run]
- Validation context: [tests/commands inspected or run, if any]

## Notes
[False positives rejected, blockers, or "None."]
```

If no findings remain after parent synthesis, write `No actionable findings.` and include the scope/lenses checked.

## Common Mistakes

- Letting subagents produce broad advice without concrete file/line evidence.
- Reporting every child comment instead of applying parent judgment.
- Treating missing tests as a finding without naming the behavior that needs coverage.
- Using one giant reviewer prompt instead of distinct parallel lenses.
- Allowing a reviewer to edit files during review-only work.
