---
name: iterate-design-discussion
description: iterate on design discussion based on user feedback - do not use this if you already used create-design-discussion
effort: max
disable_model_invocation: true
---

# Iterate Design Discussion

You are iterating on an existing design discussion document based on user feedback.

## Initial Check

If the user calls this with no instructions or feedback, ask them for their feedback:

```
I'm ready to iterate on the design discussion. What feedback or changes would you like me to incorporate?
```

Then wait for the user's feedback before proceeding.

## Steps

1. **Find and read the task directory**:
   - You should know the task directory, if not ask the user
   - Read ALL files in the task directory (design discussion, ticket, research, etc.)
   - **IMPORTANT**: Use the Read tool WITHOUT limit/offset to read entire files

2. **If the user gives any input**:
   - DO NOT just accept the correction blindly
   - Read the specific files/directories they mention
   - [MAYBE] spawn sub-agents for research (2b)
   - Only proceed once you've verified the facts yourself

2b. [OPTIONAL] **Spawn sub-agents for research**:

   **For deeper investigation:**
   - **codebase-locator**: Find more specific files (e.g., "find all files that handle [specific component]")
   - **codebase-analyzer**: Understand implementation details (e.g., "analyze how [system] works")
   - **codebase-pattern-finder**: Find similar features we can model after

   Each agent knows how to:
   - Find the right files and code patterns
   - Identify conventions and patterns to follow
   - Look for integration points and dependencies
   - Return specific file:line references
   - Find tests and examples

   Do not run agents in the background - FOREGROUND AGENTS ONLY.

<important if="the user asks you to find how things work or add detail about existing functionality">
  prefer to use an inital pass with one or more subagents before reading files yourself
  <else if="the user gives straightforward feedback that doesn't require loading more codebase context">
      skip subagents if you already have the context
  </else>
</important>

4. **Update document** (if changes needed):
   - Update the design discussion document at its original path
   - Update current state / desired end state / current architecture if appropriate
   - Move answered questions to "Resolved Design Questions" section
   - Update patterns with new code examples if discovered
   - Add any new design questions that emerged
   - If the user's feedback includes cross-cutting style preferences (e.g. "I prefer classes", "use dependency injection everywhere"), capture them in the "Design Preferences" section — add the section if it doesn't exist yet

5. **Update the user**
   - Read the final output template:
   `Read({SKILLBASE}/references/design_discussion_final_answer.md)`
   - Respond with a summary following the template

## Document Precedence

When documents conflict, the most recent document wins:
**design discussion > research > ticket**

The design discussion captures decisions made AFTER reading the ticket and research.
If the ticket says one thing but the design discussion resolved it differently, follow the design discussion.

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
