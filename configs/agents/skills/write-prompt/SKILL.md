---
name: write-prompt
description: Turn a rough intent — "implement Stripe webhooks here", "design module Y" — into a prompt you can hand to an implementing agent, or use to draft a plan first. Use BEFORE building anything non-trivial, when the request is one sentence and the real requirements, constraints, and external-system facts are still unstated. Do NOT use for localized, well-specified changes (a fix, a rename, a log line).
disable_model_invocation: true
disable-model-invocation: true
---

# Write Prompt

Interview the user about this change until you both understand it, then write the prompt. The interview pulls out two things that never surface on their own: what the user already has in their head and didn't say, and what you already know about this kind of task but won't apply unless forced to. Both are there.

## Interview

Walk the decision tree for this specific change, one question at a time. For each question, propose your own recommended answer and say why, then let the user confirm or correct it. Wait for the answer before the next question — each answer changes which questions still matter.

Generate the questions yourself from the task in front of you. Do not work from a fixed list; a task-specific tree you derive beats a stored one. What to cover depends on the kind of change — classify it first, then load the matching reference for the axes, the assertions, and the test seams:

- **integration** — wiring this codebase to an external or separate system. Load `references/integration.md`.
- **module-design** — defining a new internal unit's public surface. Load `references/module-design.md`.

Two rules on where answers come from:

- If a question can be answered by reading the codebase, read it instead of asking. The user shouldn't answer what the code already states.
- If a question turns on how a specific external system behaves — its signature scheme, its retry rules, whether some endpoint or replay API exists — get the real answer from its docs (fetch them if you have web access) rather than recalling the typical shape. The typical shape is your default, and it is often wrong for the specific system.

Tag every resolved point by where it came from: **told** (the user said it), **verified** (you read the code or the docs — keep the file:line or URL), or **assumed** (neither). Before writing, put the **assumed** points back to the user plainly — "I'm assuming X, Y, Z; correct any" — and flag any whose answer would change the design. A confident-looking prompt built on unconfirmed guesses is worse than a sparse one; it hides the guesses.

## Before writing: apply the floor

The mode reference has an **Assert** section — requirements that never come up in an interview even when you ask well, so they are asserted, not waited for. Re-read it after the interview and carry each item into the prompt as an acceptance criterion tied to a test seam, or an explicit, justified N/A. Do not let these depend on whether they happened to come up.

## Write the prompt

Load `references/output.md` and follow its structure. The prompt is the deliverable; do not implement here.

## Don't

- Don't present an assumed value as settled.
- Don't pad. Five verified constraints and three honest open questions beat a long prompt of confident defaults.
- Don't build or read from a fixed question tree — generate the questions the task needs.
- Don't put file paths or code snippets where prose decisions belong (see `references/output.md` for the one exception).
