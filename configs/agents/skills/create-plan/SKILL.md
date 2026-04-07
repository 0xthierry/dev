---
name: create-plan
description: convert structure outline into a detailed implementation plan
effort: max
---

# Create Plan

You are in the final Plan Writing phase. Convert the structure outline into a complete, detailed implementation plan.

## Iron Law

**No stubs, no deferred logic.** Every code block in the plan must be complete enough to implement without additional design decisions. If you can't write the full logic for a function, you don't understand the problem well enough — go back to research. Never write `return []` with a "to be implemented later" comment. Never write an empty method body with a TODO. Never defer design work to the implementer. The plan is the last stop before code gets written.

## Steps

1. **Read all input files FULLY**:
   - Use Read tool WITHOUT limit/offset to read all provided file paths
   - `ls ai_docs/tasks/TASKNAME` to find all related documents in the task directory
   - Read everything in the task directory to build full context

2. **Read relevant code files**:
   - Read any source files mentioned in the research, design, or structure documents
   - Build context for writing specific code examples

3. **Read actual type definitions**:
   - For every type, interface, enum, or schema that your plan code will reference — read its actual source definition
   - Don't guess shapes from memory or from what upstream documents described
   - If a function returns a `Graph`, read the `Graph` type. If code checks a file variable, read that type definition. If a test mocks a service, read the real interface
   - This step runs throughout plan writing — whenever you're about to use a type you haven't read, stop and read it first

4. **Read the plan template**:

`Read({SKILLBASE}/references/plan_template.md)`

5. **Write the implementation plan**:
   - Write to `ai_docs/tasks/ENG-XXXX-description/YYYY-MM-DD-plan.md`
   - Convert each phase from the structure outline into detailed implementation steps
   - Include complete implementation code for each change (not signatures, not stubs)
   - Include tests with concrete value assertions (see Test Guidelines below)
   - Add both automated and manual success criteria

6. **Self-review**:
   - Before presenting, re-read the plan as the implementer
   - For each phase ask: "Could I implement this with zero questions? Are there stubs, assumed types, or ambiguous branches?"
   - Check every code block: does it have complete logic, or does it punt with a comment?
   - Check every test: does it assert concrete values, or just existence?
   - If any answer reveals a gap, fix it before presenting

7. **Generate the sprint contract**:
   - Write to `ai_docs/tasks/ENG-XXXX-description/.sprint-contract.json`
   - Machine-readable version of success criteria for the evaluator agent
   - Every automated criterion from each phase must be in the contract
   - Include regression commands (full test suite, typecheck, lint)
   - See the plan template for the contract JSON format

## Plan Writing Guidelines

- Each phase should be independently testable
- Include complete implementation code, not just descriptions or signatures
- Automated verification should be runnable commands
- Manual verification should be specific, actionable steps
- Pause for human confirmation between phases
- If the research documented testing patterns for the components being changed, include test code in the plan (new test files or additions to existing test files). Follow the existing test patterns found in the research.
- **Design preference cross-check**: Before writing code for each new module, check the "Design Preferences" section in the structure outline and design discussion. If the user stated a preference (e.g., class-based over functions), the generated code must follow it for every new module — not just modules where the pattern is technically required. This is the last chance to catch mismatches before implementation.
- **Challenge upstream documents**: Don't blindly transcribe patterns from the structure outline. Before copying code, verify it makes sense in complete context. A type alias that maps 1:1 to another type is dead weight — use the original directly. A parameter that could use an existing type shouldn't get a wrapper. If the outline says "return null", question whether null is actually correct for that code path.
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

## Output

1. **Read the final output template**:

`Read({SKILLBASE}/references/plan_final_answer.md)`

2. Respond with a summary following the template, including GitHub permalinks

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
