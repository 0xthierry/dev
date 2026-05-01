---
name: iterate-structure-outline
description: iterate on structure outline based on user feedback. if given a path to a document in ai_docs/tasks/*/*-structure-outline.md, use this skill. Don't use if you already used create-structure-outline
effort: max
disable_model_invocation: true
---

# Iterate Structure Outline

You are iterating on an existing structure outline document based on user feedback.

## Input

- `docPath`: Path to the existing structure outline document (e.g., `ai_docs/tasks/ENG-XXXX-description/YYYY-MM-DD-structure-outline.md`)
- Optionally, a ticket file path containing comments with feedback

## Initial Check

If the user calls this with no instructions or feedback, ask them for their feedback:

```
I'm ready to iterate on the structure outline. What feedback or changes would you like me to incorporate? For example:
- Phase reorganization
- Scope changes (add/remove items)
- Answers to open questions
- Additional context or requirements
```

Then wait for the user's feedback before proceeding.

## Steps

1. **Read all input documents FULLY**:
   - Use Read tool WITHOUT limit/offset to read the research document
   - Understand the current state of the codebase from research findings
   - Review all design decisions and patterns to follow

2. **Check for related task content**:
   - If a path in `ai_docs/tasks/TASKNAME` is mentioned, use `ls ai_docs/tasks/TASKNAME`
   - Read all relevant files in the task directory
   - Read relevant files mentioned in the task files

3. **If the user gives any input**:
   - DO NOT just accept the correction blindly
   - Spawn research tasks to verify the information if needed
   - Read the specific files/directories they mention
   - Only proceed once you've verified the facts yourself

4. **Spawn sub-agents for follow-up research** (if needed):

   **For deeper investigation:**
   - **codebase-locator**: Find additional files if needed
   - **codebase-analyzer**: Deep-dive on specific implementations
   - **codebase-pattern-finder**: Find more examples of patterns
   - **web-search-researcher**: Research external best practices

   Do not run agents in the background - FOREGROUND AGENTS ONLY.


5. **Process the feedback**:
   - If user requested phase changes: Reorganize phases as requested
   - If user requested scope changes: Update "What we're not doing" and phase contents
   - If user answered open questions: Remove from open questions and incorporate into plan
   - If the user's feedback includes cross-cutting style preferences (e.g. "I prefer classes", "group related helpers together"), update the "Design Preferences" section — add it if it doesn't exist — and verify all phases conform to the updated preferences
   - Keep the same YAML frontmatter and format

6. **Update document** (if changes needed):
   - Update the document at the same `docPath`
   - Reorganize phases as needed
   - Update file changes within phases
   - Update validation approaches
   - Remove answered questions from "Open Questions"

7. **Update the user**
   - Read the final output template:
   `Read({SKILLBASE}/references/structure_outline_final_answer.md)`
   - Respond with a summary following the template, including GitHub permalinks.

## Document Precedence

When documents conflict, the most recent document wins:
**structure outline > design discussion > research > ticket**

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

## Phase changes should be concise but clear

The goal of this document is to be concise and human readable.
Be tasteful and thoughtful about how and where you include code snippets, and prefer highlighting signature changes rather than entire code blocks, unless the user explicitly asks for them. The structure outline is our "c header files", the plan will include the function definitions.


## Phase Validation Design

Not every phase requires manual validation, don't put steps for manual validation just to have them.

There's a good chance that if a phase cannot be manually checked, its either too small
or not vertical enough. The goal of manual validation is to avoid getting to the end of a 1000+ line
code change and then having to figure out which part went wrong.

Automated testing is always better than manual testing - be thoughtful based on your knowledge
of the codebase and testing patterns, and be clear about which tests are manual versus automated.
</guidance>
