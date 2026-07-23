---
name: describe-pr
description: "Use when generating PR descriptions in CI or other noninteractive runs."
---

# Generate PR Description

You are tasked with generating a comprehensive pull request description using the repository's standard template with rich linking and deviation analysis.

## Steps to follow:

1. **Read the PR description template:**

   `Read({SKILLBASE}/references/pr_description_template.md)`

2. **Identify the PR to describe:**
   - Check if the current branch has an associated PR: `gh pr view --json url,number,title,state,headRefName 2>/dev/null`
   - If no PR exists for the current branch, list open PRs: `gh pr list --limit 10 --json number,title,headRefName,author`
   - Select or ask about the target PR

3. **Gather PR metadata:**
   - Get PR info: `gh pr view {number} --json url,number,title,state,baseRefName,headRefName,commits,files`
   - Get repo info: `gh repo view --json owner,name`
   - Store the PR URL for diff link generation

4. **Discover task directory and ticket:**
   - Get branch name from PR: extract `headRefName` from step 2
   - Extract task slug (strip prefix before `/`, e.g., `feat/plt-1665-task-context-recovery` -> `plt-1665-task-context-recovery`)
   - Extract ticket ID (e.g., `PLT-1665` from the slug)
   - Check for task directory: `ls issues/ | grep -i "{ticket-id}"` (local-only artifacts from the /issue → /implement pipeline)
   - [if applicable] Get Linear ticket URL: `linear issue url {TICKET_ID} 2>/dev/null`
       - if linear tools not found or ticket not found, skip this step that's fine
   - If task directory exists, set `TASK_DIR`

5. **Gather comprehensive PR information:**
   - Get full PR diff: `gh pr diff {number}`
   - Read through the entire diff carefully
   - For context, read any files referenced but not shown in the diff
   - Understand the purpose and impact of each change
   - Identify user-facing changes vs internal implementation details

7. **Analyze for plan deviations (if plan file exists):**
   - Check if the task directory has a plan file: `ls {TASK_DIR}/*plan*.md 2>/dev/null`
   - **Recorded ledgers first — do not dispatch an agent when they exist.** Repos with a pipeline record deviations as first-class artifacts; read them and derive the section directly:
     - `{TASK_DIR}/execution-state.md` → `## Deviations` and `## Escalations`
     - the plan's `Derivations` section
     - any review logs / feature-review verdicts in the task directory
   - Only if a plan exists but **no** recorded deviation/derivation ledger does, use the Task tool with `subagent_type=implementation-reviewer`:
     ```
     Analyze deviations between the plan at {TASK_DIR}/{plan-file}
     and the current implementation. Compare against the base branch.
     ```
   - Include the derived (or agent) output in the "Deviations from the plan" section

8. **Determine output path:**
   - If task directory exists: `{TASK_DIR}/pr-description.md`
   - If no task directory: `issues/pr-{number}/description.md` (issues/ is local-only/ignored; the PR body itself is delivered via `gh pr edit`)

9. **Generate the description:**
   Fill out each section from the template:
   - **Header links**: Include Linear ticket link if available
   - **What problems**: Based on ticket/plan context and code changes
   - **What user-facing changes**: Bulleted list with diff permalinks from step 5
   - **How I implemented it**: Journey through the PR with file/line permalinks
   - **Deviations from plan**: Include agent output from step 7 (or "No plan file found")
   - **How to verify it**: Include worktree setup commands with actual branch name
   - **Changelog entry**: Concise one-line summary

10. **Save the description:**
    - Write the completed description to the path from step 8
    - Show the generated description

11. **Update the PR:**
    - Update PR: `gh pr edit {number} --body-file {output-path}`
    - Confirm the update was successful

12. **Update the user:**
    - Read the final output template:
    `Read({SKILLBASE}/references/describe_pr_final_answer.md)`
    - Respond with a summary following the template, including the PR URL and key details.

## Important notes:
- Always read the template from `{SKILLBASE}/references/pr_description_template.md`
- Prefer recorded deviation ledgers (execution-state, plan Derivations, review logs) for deviation analysis; dispatch the `implementation-reviewer` agent only when a plan exists with no ledgers
- Focus on the "why" as much as the "what"
- Include breaking changes or migration notes prominently

Remember, you must respond to the user according to the output template at `{SKILLBASE}/references/describe_pr_final_answer.md`
