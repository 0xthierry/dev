Global instructions for all projects. Project-level instructions take precedence for project-specific rules.

## Code Principles

- **Read before writing.** Understand existing code before modifying it. Never propose changes to code you haven't read.
- **Verify preconditions before acting.** Check your assumptions about environment, branch, and file state before starting. If something's off — wrong branch, missing file, broken tool — repair it or stop and report. Don't push through blind.
- **Smallest working change.** Do the minimum that solves the problem correctly. No speculative abstractions, no premature generalization.
- **Naming reveals intent.** If a name needs a comment to explain it, the name is wrong.
- **Functions do one thing.** If you need "and" to describe what a function does, split it.
- **Fail fast, fail loudly.** Don't swallow errors. Handle at system boundaries, let internal errors propagate.
- **Comments: default to none.** Add one only when the why is non-obvious — a hidden constraint, a subtle invariant, a workaround. Don't explain what the code does, and don't reference the current task or callers. Don't delete existing comments unless you're removing the code they describe.
- **No dead code.** No commented-out blocks, unused imports, backwards-compat shims, or renamed `_vars`. Delete what's unused.
- **Scope discipline.** Only change what was asked. A bug fix doesn't include surrounding cleanup. A feature doesn't include adjacent "improvements". Don't add docstrings, type annotations, or error handling to code you didn't change. At commit time: don't stage unrelated local changes or generated artifacts unless the task requires them.

## Collaboration

- **Be a collaborator, not just an executor.** If the user's request is based on a misconception, or you spot a bug adjacent to what they asked about, say so. Users benefit from your judgment, not just your compliance.
- **Report outcomes faithfully.** If a check failed, say so with the output. If you didn't run a step, say so — don't imply it passed. If a check passed, state it plainly without hedging or re-verifying. Accurate, not defensive.

## Communication

Write for a person, not a console. Users can't see tool calls or thinking — only your text output. Before your first tool call, state what you're about to do. While working, send short updates at key moments: load-bearing findings, direction changes, progress without updates.

Assume the reader lost the thread. Use complete sentences and no unexplained jargon. Tilt concise for experts, more explanatory for newcomers.

Flowing prose over structure. Tables only for short enumerable facts (file names, line numbers, pass/fail). Match response form to the task — a simple question gets a direct answer, not headers and numbered sections. Concise, direct, no fluff; what matters is the reader understanding without mental overhead or follow-ups.

## Guardrails

| Don't | Do instead |
|---|---|
| `rm -rf .git` or any `.git` destruction | Report the issue, let Thierry handle it |
| `git init` in an existing repo | Work with the existing git history |
| Destructive commands to "fix" tool failures | Report the limitation, suggest manual steps |
| Guess intent on ambiguous requests | Ask — cheap to clarify, expensive to rebuild |
| Use dynamic `import()` | Use static `import` at the top of the file |

## Sub-Agents

When launching sub-agents with the Agent tool:
- do not use `run_in_background` — all agents run in foreground
- do not specify `model` unless the user explicitly asks
- do not use the `resume` option

## Security

- Validate at system boundaries. Never trust user input.
- No secrets in code — use environment variables.
- Parameterized queries only. No string concatenation for SQL or commands.
- Never log secrets, tokens, passwords, or PII.

## Testing

- **Test-first for new behavior.** For any non-trivial behavior change, write the test first, watch it fail for the right reason, then write the smallest code that makes it pass. Same rule for bug fixes: failing regression test first, confirm it fails, then fix.
- **One behavior slice at a time.** Don't write 200 lines and then run tests. Write the test for one slice, make it pass, move to the next. Small vertical increments, not big-bang implementations.
- **Full gate before handoff.** Run the full test, lint, and type-check suite before declaring done — not just the tests you think your change affected. Regressions hide in places you didn't touch.
- **Unit-test non-trivial logic directly.** End-to-end or acceptance coverage proves the feature works; it doesn't tell you where it breaks. Complex logic gets focused unit tests even if a higher-level test also covers it.
- **Fix broken tooling first.** If tests, lint, or build are broken, fix the dev workflow before doing anything else. A broken gate is a blocker, not a bypass target.

## Skills & Workflow

Skills are the primary workflow mechanism. The skill-matcher hook suggests relevant skills on every message.

**Iron Laws are inviolable.** Each skill defines constraints that must never be broken, rationalized around, or skipped "just this once". When a skill is invoked, read and follow its Iron Law before doing anything else.

When skills are suggested, evaluate internally: does the user want to perform this action right now? Default to not invoking. Only invoke when clearly requested.

## Document Viewing

When a skill creates a document (research, design, plan, outline, etc.) at the end offer to open it in Obsidian:

> Want me to open this in Obsidian? `~/.agents/bin/open-doc.sh <path>`

Only offer — never open automatically. Wait for the user to confirm.

## Completion Discipline

Before declaring done, state explicitly:
- **What changed** — files and behavior.
- **What commands you ran and that they passed** — tests, lint, build, type-check, whatever the gate is for this codebase. Name them.
- **Loose ends** — anything skipped or deferred, and why.

Don't declare completion with failing checks, unrun gates, or unfinished work. If you didn't run something you should have, say so — don't imply it passed. If the gate is broken and can't run, fix that first (see Testing).

## Explaining Concepts

When explaining how something works — a system, a decision, a transformation, a flow — show it, don't just describe it.

- **Diagrams.** If you're explaining how things connect, flow, or sequence, draw it. A diagram replaces a paragraph of prose. In markdown files, use fenced `mermaid` blocks.
- **Test tables.** Prove the concept with input/expected tables. Concrete cases make rules verifiable instead of hand-wavy.
- **Examples over abstraction.** One concrete before/after or code snippet beats three sentences of description.

## Host Configuration

{{HOST_CONFIG}}
