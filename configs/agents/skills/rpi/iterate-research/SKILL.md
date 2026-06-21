---
name: iterate-research
description: iterate on research document based on user feedback. This skill requires a path to a document and feedback from the human - dont use if you already used create-research
disable_model_invocation: true
disable-model-invocation: true

---

# Iterate Research

You are iterating on an existing research document based on user feedback.

## Initial Setup:

When this command is invoked, check the task artifact directory from your system prompt for documents like `*research*.md` (NOT `*research-questions*.md` - `research-questions` documents are EXCLUDED) with `ls -La` (the directory may be a symlink - do NOT use regular `ls` or grep/glob tools). If you find a research document, read it and proceed. 

If you see several research documents, ask the user which one to proceed with before reading any of them. 

If you do not know what the artifact task directory is from your system prompt, respond with:
```
I'm ready to iterate on researching the codebase. Please provide your research question or area of interest, and I'll analyze it thoroughly by exploring relevant components and connections.
```

**IMPORTANT**: You may NEVER read `ticket.md` files or other files from the artifact directory which do not match the `*research*.md` pattern above unless such a file is explicitly asked for by the user.

## Steps

1. **Read the existing document FULLY**:
   - Use Read tool WITHOUT limit/offset to read the entire document at `docPath`
   - Understand what research was previously conducted
   - Don't read any other files in the task artifact directory, focus on the research document and the provided feedback.
   - **DO NOT read ticket files** - research must stay objective about the current codebase.
   - **If a document path was not provided:**
         - List the contents of the task's artifact directory from your propmt. Run `ls -La .tasks/<task slug>` to find all related documents in the task directory. Do not use glob or grep, or use `ls -l` or `ls` without `-L` as the directory may be a symlink.


2. **Process the feedback**:
   - If user requested additional research: Spawn sub-agents to investigate
   - If user requested corrections: Update the document at the same path
   - Keep the same YAML frontmatter and format

3. **Conduct additional research** (if needed):
   - Spawn parallel sub-agent tasks for comprehensive research
   - Use the right agent for each type of research:

   **For codebase research:**
   - **codebase-locator**: Find WHERE files and components live
     - Finds relevant source files, configs, and tests
     - Returns file paths organized by purpose
   - **codebase-analyzer**: Understand HOW specific code works (without critiquing it)
     - Traces data flow and key functions
     - Returns detailed explanations with file:line references
   - **codebase-pattern-finder**: Find examples of existing patterns (without evaluating them)
     - Identifies conventions and patterns
     - Returns code examples with locations

   **For web research (only if user explicitly asks):**
   - **web-search-researcher**: For external documentation and resources
     - If used, instruct agents to return LINKS with their findings
     - Include those links in the updated document

   **Agent usage tips:**
   - Start with locator agents to find what exists
   - Then use analyzer agents on the most promising findings
   - Run multiple agents in parallel when searching for different things
   - Each agent knows its job - just tell it what you're looking for
   - Don't write detailed prompts about HOW to search - the agents already know
   - Keep the main agent focused on synthesis, not deep file reading

4. **Update document** (if changes needed):
   - Update the document at the same `docPath`
   - Add new findings to relevant sections

5. **Update the user**
   - Read the final output template:
   `Read({SKILLBASE}/references/research_final_answer.md)`
   - Respond following the template exactly, include artifact paths if you have them.

## Research Guidelines

Your job is to DOCUMENT AND EXPLAIN THE CODEBASE AS IT EXISTS TODAY:
- DO NOT suggest improvements or changes unless explicitly asked
- DO NOT perform root cause analysis unless explicitly asked
- DO NOT propose future enhancements unless explicitly asked
- DO NOT critique the implementation or identify problems
- DO NOT recommend refactoring, optimization, or architectural changes
- ONLY describe what exists, where it exists, how it works, and how components interact

Document structure should include:
- Summary answering the research question
- Detailed findings by component/area with file:line references
- Code references with descriptions
- Architecture documentation (patterns, conventions, design)
- Open questions for areas needing further investigation

<guidance>
## Artifact Paths

When you write or edit documents in `.tasks/`, include the generated local file path in your final response. If the tool output includes additional artifact metadata, you may include it as well.

## Markdown Formatting

When writing markdown files that contain code blocks showing other markdown (like README examples or SKILL.md templates), use 4 backticks (````) for the outer fence so inner 3-backtick code blocks don't prematurely close it:

````markdown
# Example README
## Installation
```bash
npm install example
```
````
## Important notes:
- Use parallel Task agents to maximize efficiency and minimize context usage
- Focus on finding concrete file paths and line numbers for developer reference
- Research documents should be self-contained with all necessary context
- Each sub-agent prompt should be specific and focused on read-only documentation operations
- Document cross-component connections and how systems interact
- Link to GitHub when possible for permanent references
- Stay focused on synthesis, not deep file reading
- Have sub-agents document examples and usage patterns as they exist
- **REMEMBER**: Document and Ask about what IS and WHY, not what SHOULD BE
- **NO RECOMMENDATIONS OR IMPLEMENTATION SUGGESTIONS**: Only describe the current state of the codebase
- **File reading**: Always read mentioned files FULLY (no limit/offset) before spawning sub-tasks
- **Critical ordering**: Follow the numbered steps exactly
  - ALWAYS read mentioned files first before spawning sub-tasks (step 1)
  - ALWAYS wait for all sub-agents to complete before synthesizing (step 4)
  - ALWAYS gather metadata before writing the document (step 5 before step 6)
  - NEVER write the research document with placeholder values
- **Path handling**: Task-specific research goes in .tasks/
  - Use `.tasks/ENG-XXXX-description/NN-research-DESCRIPTION.md` for task research
</guidance>


Remember, you must respond to the user according to the output template at `{SKILLBASE}/references/research_final_answer.md`

<important if="there are open questions in the research document">
You should include the following text after the section in the final answer template that says 'If you'd like, you can review the research document for completeness.':

```
There are N open questions that you should review, you can
- ask me to go find the answers for them
- provide the answers yourself
- tell me they are irrelevant and I'll remove them
```
</important>
