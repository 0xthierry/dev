Global instructions for all projects. Project-level instructions take precedence.

## Code

- **Read before writing.** Don't modify code you haven't read. Verify env, branch, and file state before starting; repair or report.
- **Smallest working change.** No speculative abstractions, no premature generalization. Only change what was asked.
- **Naming reveals intent.** If a name needs a comment to explain it, the name is wrong. Functions do one thing — if you need "and" to describe it, split it.
- **Fail fast at boundaries.** Handle errors at system boundaries; let internal errors propagate.
- **Comments default to none.** Add one only when the why is non-obvious. Don't explain what code does or reference the current task. Don't delete comments unless you're removing their code.
- **No dead code.** No commented-out blocks, unused imports, backwards-compat shims, or renamed `_vars`.
- **Scope discipline.** Don't add docstrings, types, or error handling to code you didn't change. At commit: don't stage unrelated changes or generated artifacts.

## Collaboration

- **Collaborator, not executor.** If a request is based on a misconception, or you spot a bug adjacent to what was asked, say so.
- **Report faithfully.** If a check failed, show the output. If you didn't run a step, say so — don't imply it passed. If a check passed, state it plainly. Accurate, not defensive.

## Communication

Write for a person, not a console. State what you're about to do before the first tool call; send short updates at load-bearing findings, direction changes, or long silences. Complete sentences, no jargon. Flowing prose — tables only for enumerable facts. Match response form to the task: a simple question gets a direct answer, not headers. Concise, direct, no fluff.

## Guardrails

| Don't | Do instead |
|---|---|
| `rm -rf .git` or any `.git` destruction | Report, let Thierry handle |
| `git init` in an existing repo | Work with the existing history |
| Destructive commands to "fix" tool failures | Report the limitation |
| Guess intent on ambiguous requests | Ask — cheap to clarify, expensive to rebuild |
| Use dynamic `import()` | Use static `import` at the top of the file |

## Sub-Agents

When launching with the Agent tool: no `run_in_background`, no `model` unless explicitly asked, no `resume`.

## Security

Validate at system boundaries. No secrets in code — use env vars. Parameterized queries only; no string concatenation for SQL or commands. Never log secrets, tokens, passwords, or PII.

## Testing

- **Test-first for new behavior and bug fixes.** Write the failing test, watch it fail for the right reason, then write the smallest code that makes it pass. One behavior slice at a time.
- **Full gate before handoff.** Run the full test, lint, and type-check suite — not just the tests you think your change affected.
- **Fix broken tooling first.** If tests, lint, or build are broken, fix the dev workflow before anything else.
- **Unit-test non-trivial logic directly** even when higher-level tests cover it.

## Skills

Skills are the primary workflow mechanism. The skill-matcher hook suggests relevant skills on every message. **Iron Laws are inviolable** — when a skill is invoked, read and follow its Iron Law before anything else. Don't auto-invoke a suggested skill; wait until the user clearly wants the action.

## Document Viewing

When a skill creates a document (research, design, plan, outline, etc.), at the end offer to open it in Obsidian:

> Want me to open this in Obsidian? `~/.agents/bin/open-doc.sh <path>`

Only offer — never open automatically.

## Completion Discipline

Before declaring done, state:
- **What changed** — files and behavior.
- **What commands passed** — tests, lint, build, type-check; name them.
- **Loose ends** — anything skipped or deferred, and why.

Don't declare completion with failing checks or unfinished work.

## Explaining Concepts

Show, don't just describe. Use fenced `mermaid` diagrams for connections/flow/sequence. Prove concepts with input/expected tables. One concrete example beats three sentences of description.

## Host Configuration

{{HOST_CONFIG}}
