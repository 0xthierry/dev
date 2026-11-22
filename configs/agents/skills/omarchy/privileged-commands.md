# Privileged commands: graphical authentication with pkexec

A password-required `sudo` failure is not necessarily a blocker on an active
Omarchy desktop. `pkexec` can request authorization through the desktop's polkit
agent. The user enters their password in that trusted dialog, never in chat.
This does not authorize privileged work during read-only or staging tasks.

## Bounded operations

1. Stay within the authorized task. Try ordinary unprivileged commands first,
   then `sudo -n /absolute/program args` when root is necessary. Graphical
   authentication is only a fallback for required interactive authentication,
   never an escape from a denial, sandbox restriction, or tool policy.
2. Check without prompting: `command -v pkexec` and
   `ps -eo comm | grep -E 'polkit|hyprpolkit'`. A polkit authentication agent is
   required; `polkitd` alone is not proof. A headless/SSH session may not have
   access to the desktop agent even when its process exists.
3. Tell the user the exact operation, affected files, and risks before opening
   the dialog. Tell them to enter the password there, not in chat.
4. Run one bounded command, for example
   `pkexec --disable-internal-agent /usr/bin/btrfs device stats /`.
   Allow approximately 120–180 seconds for a short operation and approval.
   `--disable-internal-agent` prevents a textual password fallback. Polkit policy
   decides whether authentication is required; do not promise a fresh dialog.
5. Verify the actual result and relevant configuration/live state. Approval is
   not proof of success.

## Multi-step changes

Prefer a specific executable. If multiple root-only steps are necessary, prepare
one small, single-purpose script in a private, user-owned directory, never a
predictable shared `/tmp` path. Persistent changes must remain reproducible from
this repository.

- Review the entire script and run `bash -n` and ShellCheck when available.
- Use `set -Eeuo pipefail`, a known system `PATH`, absolute paths and explicit
  preconditions. Back up configurations, refuse unexpected files, and make retry
  and recovery safe.
- Explain the script before authentication: the dialog may name only the
  interpreter, not the operation.
- Never modify the script while approval or execution is pending. Execute only
  the reviewed file with
  `pkexec --disable-internal-agent /usr/bin/bash /absolute/path/to/reviewed-script`,
  not an interactive root shell.
- `pkexec` sanitizes the environment and normally changes to the target user's
  home. Do not depend on the caller's `HOME`, cwd, shell functions, mise shims or
  relative paths. Never forward the entire environment or weaken polkit policy.

## Cancellation and failures

- Never request, record, pipe (`sudo -S`), or automate typing a password; never
  inspect or capture the authentication dialog.
- Never add passwordless sudo or permissive polkit rules for convenience.
- Stop after cancellation, without repeated prompts. pkexec normally returns
  126 for dismissal and 127 for authorization/error failure, but the launched
  command can also return those values: inspect output and actual state.
- After timeout, check whether the operation is still running and whether it
  changed anything before retrying. Timeout proves neither rollback nor failure
  to start. Do not interrupt long critical operations with a short timeout.
- If graphical authentication is unavailable or denied, report the blocker and
  provide the exact narrow sudo command for the user's own terminal.
- Keep diagnostics at `omarchy debug --no-sudo --print`; do not elevate the entire
  collection. Root operations require their own task justification.

Reference: `man pkexec` (authentication agent, environment and exit status).
