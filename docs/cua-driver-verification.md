# Cua Driver verification

This runbook separates installed-client discovery from live desktop acceptance.
Do not treat an unsupported-action refusal as a completed application task.

## Scope and allowed effects

- Omarchy: Claude Code, Pi, Codex and Antigravity CLI. MacBook: Pi only.
- Normal setup may install the pinned runtime and reconcile its own services and
  client registrations. Do not restart the compositor, change browser profiles,
  grant permissions, install the experimental Hyprland plugin or enable recording.
- Discovery checks run `scripts/check-cua-mcp.py`: a stdio proxy, MCP initialization,
  tool listing and a read-only guide call. They do not see private windows or send
  input. The script closes only the proxy, never the daemon.
- For live native acceptance, use a disposable fixture window containing no user
  data. Identify its exact PID/window, observe before action, perform a background
  semantic action, and verify the fixture's own resulting state. Stop on permission
  refusal, unknown delivery or a request for foreground escalation. Do not retry
  through a different backend without inspecting the outcome.
- If the task needs a screenshot, capture only the identified fixture window into
  a private temporary evidence directory. Never capture an authentication dialog.
- Close only the fixture owned by the check, retain failures for inspection, and
  confirm the daemon and unrelated desktop remain unchanged. Do not publish
  private screenshots, window titles, profile data, signed URLs or tokens.

## Automated gates

```sh
bash tests/cua-driver.test.sh
python3 -B tests/cua-driver-macos.test.py
python3 tests/cua-driver-mcp.test.py
python3 tests/cua-native-check.test.py
~/.local/share/mcp-services/venv/bin/python tests/mcp-clients.test.py
python3 tests/mcp-runtime.test.py
bash tests/cua-omarchy-display.test.sh
bash tests/cua-omarchy-window.test.sh
python3 tests/browser-automation.test.py
bun run test:pi-extensions browser-use
bun run typecheck:pi-extensions
```

The Mac packaging tests use isolated fixtures. They prove packaging and scope,
not actual macOS code-signing enforcement,
TCC grants or foreground/background behavior.

## On the installed host

```sh
cua-driver --version
cua-driver status
python3 scripts/check-cua-mcp.py
# Omarchy only:
systemctl --user is-active cua-driver.service cua-driver-x11.service
```

Verify each intended client's registration references the managed proxy, each
excluded client has no *new* registration, and rerunning the renderer retains
user tool restrictions and disabled state. Do not remove preexisting user
registrations from excluded clients merely to make an assertion pass.

## Current Omarchy evidence (2026-11-23)

- Signed 0.59.4 release installed; both managed systemd endpoints run that exact executable with telemetry and update checks disabled. Offline reinstall and service reconciliation were idempotent.
- Persistent MCP initialization, 65-tool discovery and `get_guide` passed. Four client configs gained only `cua-driver`; Claude Desktop was unchanged. Pi discovered one matching skill without collisions.
- One disposable GTK/Wayland fixture was launched. Exact-window AT-SPI observation passed. Foreground identity changed before the action, so the checker stopped **without sending input**. Its non-focus flags did not establish a background-launch guarantee; causation was not independently established. The fixture process exited and its window was independently verified absent. **Background input is not qualified.**
- macOS packaging/scope/rollback fixtures passed; no native Mac execution, TCC grant, or GUI acceptance was performed. No personal-browser profile was attached on either host.

## Disposable native check

```sh
# Opens one disposable GTK window; no personal data or screenshots.
# A compositor may focus a newly opened window despite GTK non-focus flags.
# The checker detects foreground changes and stops before sending input.
# Run only when that visible launch is acceptable; the report path must be new.
python3 scripts/check-cua-native.py --run --report /private/path/new-report.json
```

It sends at most one background semantic write, validates the fixture's own
state, checks sampled foreground identity, and closes only its fixture. It does
not establish that no transient focus change occurred between samples. A
blocked/refused result is not success; do not retry with foreground input without
explicit authorization.

## Acceptance matrix

Report each cell as passed, refused/unsupported, blocked, or not exercised:

| Cell | Required evidence |
|---|---|
| Native MCP communication | Exact version, expected tools and successful read-only guide call |
| Native observation | Correct disposable fixture PID/window and fresh tree/screenshot |
| Semantic background input | Fixture-owned state changed as requested; foreground remained unchanged |
| Raw pointer/keyboard | Correct fixture, quotes/accents/Enter, current screenshot coordinates; explicit foreground authority if needed |
| Multiple outputs/scales | Correct current output/window identity; no coordinates translated from another backend |
| Browser | Owner-approved exact browser/profile, native binding, tabs/input/uploads/downloads and fresh postconditions |
| Refusal/reconnect | No duplicate action, no permission bypass, stale tokens discarded |
| Mac Pi-only | Pi discovers Cua; no new other-client registrations/skill links; required owner grants and signed app identity verified on Mac |

A native fixture pass does not qualify Brave, a real signed-in profile, a Qt
canvas app, another backend, or the Tripo artifact workflow. Those retain verified
alternatives until their own acceptance checks pass. Mac GUI checks require the
actual MacBook and its owner; Linux simulation cannot supply that evidence.

## Reviewer checklist

A separate read-only reviewer checks the exact runtime/client configuration,
fixture output, absence of unintended client registrations, cleanup and final
service state. Document any partial result or unavailable host instead of replacing
it with a mocked pass. Preserve the current desktop and do not enable broad
permissions to satisfy a test.
