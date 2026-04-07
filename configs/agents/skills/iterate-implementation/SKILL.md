---
name: iterate-implementation
description: iterate on implementation based on user feedback
effort: max
---

# Iterate Implementation

An implementation plan was implemented and a user has follow-on feedback - it might be a bug, it might be further changes or tweaks, it might be a follow-on feature to implement in the same branch

## Steps

1. **Read all input files FULLY**:
   - Use Read tool WITHOUT limit/offset to read the plan document and any other provided paths
   - `ls ai_docs/tasks/TASKNAME` to find all related documents in the task directory
   - Read the YYYY-MM-DD-plan.md to understand the work that was prescribed

2. **Understand the current state**
   - check the current git diff
   - find the commit that marks the end of implementation
   - read and understand and commits since then - the content of what changed
   - understand what phases of the plan were already implemented - the user might be giving you feedback in the middle of a plan implementation

3. **If the user gives any input**:
   - DO NOT just accept the correction blindly
   - Read the specific files/directories they mention
   - Verify code examples and file paths are accurate
   - Only proceed once you've verified the facts yourself

4. **Clarify the feedback**:
   - If user reported a bug: check the database, ask for relevant logs, do whatever is needed to understand what still needs to be done
   - If user requested code changes: Update the specific code examples
   - If there are multiple approaches to fix, ask the user for any clarification
   - If more logs are needed, add logging and ask the user to reproduce issue and share the updated logs

5. **Apply the Fix**:
   - if the fix is clear or the user has accepted one of your proposed solutions, make the changes
   - make the changes
   - run testing and linting

6. **Update the user**
   - Respond with a summary following the template, including GitHub permalinks, and next steps for verification


<guidance>
## Markdown Formatting

When writing markdown files that contain code blocks showing other markdown (like README examples or SKILL.md templates), use 4 backticks (````) for the outer fence so inner 3-backtick code blocks don't prematurely close it:

````markdown
# Example README
## Installation
```bash
npm install example
```
````

</guidance>

## When Iteration is Complete

If the iteration resolves all issues and no further changes are needed:

1. Read the final output template:

`Read({SKILLBASE}/references/iterate_implementation_final_answer.md)`

2. Respond with a summary following the template
