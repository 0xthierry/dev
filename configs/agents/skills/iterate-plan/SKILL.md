---
name: iterate-plan
description: iterate on implementation plan based on user feedback
---

# Iterate Plan

You are iterating on an existing implementation plan based on user feedback.

## Iron Law

**No stubs, no deferred logic.** Every code block in the plan must be complete enough to implement without additional design decisions. If you can't write the full logic for a function, you don't understand the problem well enough — go back to research. Never write `return []` with a "to be implemented later" comment. Never write an empty method body with a TODO. Never defer design work to the implementer. The plan is the last stop before code gets written.

## Steps

1. **Read all input files FULLY**:
   - Use Read tool WITHOUT limit/offset to read the plan document and any other provided paths
   - `ls ai_docs/tasks/TASKNAME` to find all related documents in the task directory
   - Read everything in the task directory to build full context

2. **If a ticket file is provided, read it for feedback**:
   - Look for comments mentioning you (linear-assistant, LinearLayer, claude)
   - These comments contain instructions/feedback from the user

3. **If the user gives any input**:
   - DO NOT just accept the correction blindly
   - Read the specific files/directories they mention
   - Verify code examples and file paths are accurate
   - Only proceed once you've verified the facts yourself

4. **Read actual type definitions**:
   - For every type, interface, enum, or schema that updated plan code will reference — read its actual source definition
   - Don't guess shapes from memory or from what upstream documents described
   - This applies to any code block you're adding or modifying

5. **Process the feedback**:
   - If user requested phase changes: Reorganize or modify phases as requested
   - If user requested code changes: Update the specific code examples
   - If user found errors: Fix inaccuracies in file paths, code, or descriptions
   - If the user's feedback includes cross-cutting style preferences, update the "Design Preferences" section in the structure outline and verify all code examples in the plan conform
   - Keep the same YAML frontmatter and format

6. **Update document** (if changes needed):
   - Update the document at the same path
   - Ensure code examples are accurate and complete
   - Verify success criteria are actionable
   - Maintain the phase structure with automated/manual verification
   - **Update the `.sprint-contract.json`** in the same directory if success criteria changed

7. **Self-review**:
   - Before presenting, re-read the updated sections as the implementer
   - For each modified phase ask: "Could I implement this with zero questions? Are there stubs, assumed types, or ambiguous branches?"
   - Check every code block: does it have complete logic, or does it punt with a comment?
   - Check every test: does it assert concrete values, or just existence?
   - If any answer reveals a gap, fix it before presenting

8. **Update the user**
   - Read the final output template:
   `Read({SKILLBASE}/references/plan_final_answer.md)`
   - Respond with a summary following the template, including GitHub permalinks.

## Plan Writing Guidelines

- Each phase should be independently testable
- Include complete implementation code, not just descriptions or signatures
- Automated verification should be runnable commands
- Manual verification should be specific, actionable steps
- Pause for human confirmation between phases
- **Challenge upstream documents**: Don't blindly transcribe patterns from the structure outline. Before copying code, verify it makes sense in complete context. A type alias that maps 1:1 to another type is dead weight — use the original directly. If the outline says "return null", question whether null is actually correct for that code path.
- **Semantic trace**: For each function with branching logic, mentally trace at least one concrete input through every branch. Verify the return value matches what callers expect and what the system actually produces at runtime. If a method infers an output type, the inferred type must agree with what the runtime produces — not just what seems structurally convenient.

## Test Guidelines

- **Assert values, not existence.** Tests must assert the actual output shape and content. A test that checks `expect(result).not.toBeNull()` passes with any garbage and hides bugs. Assert the concrete value: `expect(schema).toEqual({ type: 'string' })`. Every test for an inference, transform, or resolution function must assert the actual produced value or schema.
- **Cover every branch.** If a function has 3 branches, write at least 3 test cases. Cover the happy path, edge cases (empty input, missing fields, null values), and error paths.
- **Extract shared test utilities.** Mocks, fixtures, and builders that appear in more than one test file go in a shared fixture file. Don't duplicate them per test.
- **Follow existing test conventions.** Before deciding test file locations and naming, check where existing tests live in the codebase. Match the existing convention (collocated vs `__tests__/` folder, naming patterns). Don't invent a new convention.

## Document Precedence

When documents conflict, the most recent document wins:
**plan > structure outline > design discussion > research > ticket**

The plan is the final authority. Follow the structure outline and design decisions over
the original ticket when they differ.

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

## Validation Design

Not every phase requires manual validation, don't put steps for manual validation just to have them.
</guidance>
