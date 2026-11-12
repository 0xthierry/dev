# Claude native snapshot proxy — manual macOS TRIAL

This is an **experimental, opt-in trial**, not a normal setup installation. It
replaces only the executable in Desktop's checksum-keyed Code engine slot with a
native Go proxy. `/Applications/Claude.app` is not patched. The existing shared
`~/.local/bin/claude` symlink continues to point to that slot, so both Desktop and
CLI use the proxy. The intact vendor engine bundle is copied with `ditto` to:

```
~/.local/share/dev-setup/claude-snapshot-proxy/original/claude.app
```

**The managed engine container's vendor signature is INVALID while the proxy is
installed.** This does not re-sign that container or weaken macOS protections.
The copied real engine stays vendor signed. Desktop may reject or replace the
modified slot; the trial does not claim otherwise. Normal setup's existing
installer cannot accept the proxy and must fail closed. **Restore before running
normal setup, changing versions, or updating Desktop.**

## Requirements and commands

Only macOS, Desktop **4.23118.1**, and engine **2.1.321** are supported. Pins come
from `configs/claude-desktop-patch/{release,manifest}.json`. The exact Desktop
version/identifier, vendor signatures, original engine hash, `.verified` marker,
and shared CLI symlink must match. Local Go **1.27.3** is required; build uses
`GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off`, no dependency downloads. No package is
installed by this script.

From the repository:

```sh
python3 scripts/claude_snapshot_proxy_trial.py status
# Quit Desktop and ALL Claude engine/CLI sessions yourself, then:
python3 scripts/claude_snapshot_proxy_trial.py install
python3 scripts/claude_snapshot_proxy_trial.py status
# After testing, quit Desktop/engine sessions again:
python3 scripts/claude_snapshot_proxy_trial.py restore
python3 scripts/claude_snapshot_proxy_trial.py status
```

Install and restore refuse active Desktop/engine processes, including a process
named `claude`; only the exact executable
`/Applications/Claude.app/Contents/Helpers/chrome-native-host` is excluded.
Enumeration uses `ps` executable names (`comm`), never process arguments. They never
kill processes. Do not start Desktop or a CLI during installation/rollback: the
process checks are repeated before replacement but cannot prevent an unrelated
launcher from racing the final check. Status is read-only and reports active PIDs.

The state directory is private (0700). A manifest records source hashes, proxy
hash, original engine hash, and exact paths **before** the atomic executable swap.
Only `proxy.go` is compiled explicitly; unexpected additional production `.go`
files are rejected, so the recorded source hashes cover the trial build inputs.
The original mode and metadata are retained using `copy2`. Interrupted operations
can be rerun: original bytes and the manifest's known proxy bytes are recognized;
unknown executable bytes are never overwritten. This covers process interruption,
not guaranteed recovery from power loss: copied bundle contents are not explicitly
flushed before publishing the backup. Source changes refuse reinstall
of an old trial but do not prevent rollback. Restore verifies the original hash
and full bundle signature, including when already restored. Backups, manifest,
proxy artifact, and logs remain intact; no user data is deleted. Do not delete or
edit the state to bypass a refusal. A Desktop updater or other external mutation
requires inspection rather than blind rollback.

## Manual Code tab acceptance test

A successful build or fixture test is **not** proof that Desktop accepts this
modified managed engine. The live test requires the user's explicit permission,
closed Desktop/engine processes, and rollback availability.

1. Record `status` showing `original`. Install; record `status` showing `proxy`.
2. Open unmodified Claude Desktop and its **Code** tab. Start a fresh local Code
   session in a disposable project and ask: **“Reply exactly: SNAPSHOT-PROXY-OK.
   Do not use tools.”** Confirm the session initializes and replies normally.
   Restart/resume the session afterward if needed. Do not change credentials or
   provider configuration as part of this test.
3. Inspect `~/.local/share/dev-setup/claude-snapshot-proxy/events.jsonl`. Correlate
   the session's proxy/child PIDs and timestamp with the forwarded initialization
   event; `snapshot_after` should be `false`. A CLI-only test is insufficient to
   prove the Desktop Code path. Capture the status output and relevant metadata
   records as evidence, not conversation content.
4. Check the ordinary shared CLI still works (`claude --version`). Exercise
   cancellation/exit and note any difference from the vendor behavior.
5. Quit Desktop and engines. Run `restore`; record `status` showing `original`.
   Reopen Code and verify normal behavior. Keep evidence and backup files.

Audit records have a fixed metadata whitelist: event name, time, proxy PID,
parent PID, optional child PID, and optional snapshot-before/after booleans.
**Ordinary prompts, protocol frames, tokens, environment variables, working
directories, and argument contents are not logged.** Audit failure is not proof
that the proxy was unused; the proxy emits a metadata-audit warning. Logs are
local evidence, not a telemetry service. They are not automatically rotated.

## Limits and verification

The proxy changes SDK initialization's `systemPromptSnapshot` Boolean; it does
not rewrite ordinary prompt content. Non-SDK CLI use executes the copied engine
directly; the existing shell wrapper supplies the CLI snapshot default, not this
non-SDK path. The proxy itself terminates its direct child on malformed protocol
input and escalates SIGINT/SIGTERM after two seconds. It does not guarantee cleanup
of all descendants or after parent SIGKILL. This is not an authenticated guarantee of provider-side prompt state,
nor a supported Desktop deployment mechanism. Engine updates, automatic repair,
macOS execution policy, process launch races, and signature enforcement remain
live-test limitations. No machine installation is performed by the tests.

```sh
python3 tests/claude-snapshot-proxy-trial.test.py
(cd configs/claude-snapshot-proxy && GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off go test ./...)
```

Installer tests exercise real isolated filesystem mutations and interrupted
recovery; macOS signing, process enumeration, `ditto`, and Go compilation are
external-boundary fixtures, not evidence that a live Desktop accepts the trial.
