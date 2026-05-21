# Agent Feedback

Durable feedback from Pi agents about workflow friction, verification blockers, and project improvements.

Entries are written by the `agent_feedback` Pi tool. They should describe repeated/systemic issues or concrete validation blockers, not one-off coding mistakes.
## 2026-05-21 11:47 — environment_gap

Summary: pre-commit shellcheck is broken because a required shared library is missing

Impact: The commit hook could not run its shellcheck validation, forcing a --no-verify commit after other available tests/lint/typecheck had passed.

Attempted:
Ran git commit normally; the hook failed before commit with shellcheck shared library load error.

Blocker:
shellcheck failed to load libHSregex-tdfa-1.3.2.5-3MyqFr9qg202qBHzsOweGn-ghc9.6.6.so.

Suggested fix:
Repair or reinstall shellcheck in the development environment, or make the hook detect unavailable shellcheck and print setup instructions.

