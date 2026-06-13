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

## 2026-05-23 13:01 — verification_blocker

Summary: Local cleanup/validation hit machine-environment blockers

Impact: The requested package removal could not be completed noninteractively because pacman removal requires sudo password entry; the prescribed shellcheck validation also could not run because the installed shellcheck binary is missing a shared library.

Attempted:
Ran a noninteractive pacman removal command and shellcheck setup.sh install/*.sh install/hosts/*.sh after repo edits.

Blocker:
sudo requires a password in the agent session; shellcheck exits with a missing libHSregex-tdfa shared-library error.

Suggested fix:
Document privileged cleanup commands for the human to run, and repair/reinstall shellcheck on this host so setup validation works.

## 2026-06-13 15:20 — environment_gap

Summary: shellcheck binary is broken, blocking pre-commit validation

Impact: `git commit` failed because the configured pre-commit hook runs shellcheck, but `/usr/bin/shellcheck` cannot load a missing Haskell shared library. I had to run non-shellcheck checks manually and commit with `--no-verify`.

Attempted:
Ran `shellcheck setup.sh install/*.sh install/hosts/*.sh`; then attempted normal `git commit`, which failed with the same shared-library error.

Blocker:
`shellcheck: error while loading shared libraries: libHSregex-tdfa-1.3.2.5-3MyqFr9qg202qBHzsOweGn-ghc9.6.6.so: cannot open shared object file`

Suggested fix:
Repair/reinstall shellcheck or its runtime dependencies in the environment, or make the setup hook report a clearer dependency-repair hint.

