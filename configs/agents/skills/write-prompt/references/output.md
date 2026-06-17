# Output: the prompt

Address it to a fresh implementing agent that has none of this conversation. State at the very top whether it should draft a plan in the codebase first or implement directly — ask the user if they didn't say.

## Structure

1. **Goal** — one or two sentences: what to build and why.
2. **Constraints** — the resolved points, each keeping its told / verified / assumed tag so the implementer sees what's solid and what's provisional.
3. **External-system facts** — integration only: the verified specifics with their citations (signature scheme, delivery and retry semantics, which APIs exist and which do not).
4. **Decisions** — the architecture the constraints force, one line of rationale each, sized to the stated load and topology, not the maximal version.
5. **Non-goals** — what to leave out because nothing in the request justifies it yet (speculative abstractions, resilience the scale doesn't need). Half the value is here.
6. **Public surface** — module-design only: signatures, what's exported vs internal, how callers call it. Not the implementation.
7. **Test seams** — where the acceptance criteria get verified, naming the existing seam to use (or the new one to add, at the highest point possible).
8. **Acceptance criteria** — the asserted floor items as checkable statements, each tied to its seam.
9. **Open assumptions** — the assumed points restated, so the implementer confirms them rather than inheriting them as settled.

## Prose, not code

Write decisions and constraints as prose. Do not paste file paths or code snippets where a decision belongs — both go stale fast, and a snippet invites the implementer to copy a shape instead of reasoning about the current one.

One exception: inline a snippet only when it encodes a decision more precisely than prose can — a schema, a state machine, a type shape, an interface signature — and note briefly that it is there as the decision, not as code to copy.

## Length

Short and load-bearing. Every line is either a resolved constraint, a forced decision, a thing to not do, a seam, a checkable criterion, or an open question. No narration, no restating the obvious, no confident filler standing in for an unresolved unknown — an unknown is an open assumption, not a decision.
