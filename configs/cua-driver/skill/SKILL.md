---
name: cua-driver
description: Use Cua Driver for native GUI and qualified browser work on Omarchy (Claude Code, Pi, Codex, Antigravity) or managed macOS (Pi only). Select the exact window or tab, act without stealing focus, and verify the application outcome.
version: 0.59.4
---

# Cua Driver

Cua is the primary computer-use controller on Omarchy for Claude Code, Pi, Codex and Antigravity; on the MacBook it is primary **only for Pi**. Preserve Claude Code's and Codex's built-in Computer Use on macOS: do not replace, disable or reconfigure it through Cua setup. An explicit tool choice takes precedence. A registered tool is not evidence that a particular app, browser/profile, background action or download works. Use the qualified route for the **whole requested outcome**. Use domain APIs for their own operations (for example Studio MCP or Roblox Open Cloud); do not repeat a timed-out mutation through the UI.

Read [OMARCHY.md](OMARCHY.md) on Omarchy or [MACOS.md](MACOS.md) on macOS. For browser work also read [BROWSER.md](BROWSER.md). Inspect the registered tool schema or `cua-driver describe TOOL` for the installed contract; unknown parameters are rejected.

## Bind one target and keep its state together

1. Use the configured `cua-driver` MCP server attached to the managed daemon, not a new runtime. Keep one persistent MCP connection and one session throughout observation, input and readback. Repeat the same `session` on calls accepting it. Sessions share a physical desktop: use one controller per target and coordinate with other actors. A session name is not an authorization or isolation boundary.
2. Use `list_windows` restricted by `pid` when known. Select one exact `(pid, window_id)`; titles and array order do not establish identity. If a launch was requested, use `launch_app` with a known `launch_path` and rediscover the window; a single-instance app may hand off to another process. Never launch another app/profile to make a check pass.
3. Request `get_window_state` for that pair. The default tree is lean `tree_markdown`. Request `tree_format:"elements"` for structured rows with explicit tokens or `"both"` for both formats. Limit unrelated content. Check that an image actually came back before using pixels.
4. Prefer a typed operation for the postcondition (`set_window_frame`, `invoke_menu`, typed page tools), then a semantic action on a current **`element_token` only**. Never send an integer element index or a separate snapshot ID in place of a token. For window pixels use only the exact unscaled screenshot from that window's latest state in this same MCP connection/session. Keep its `window_id`; never translate from desktop coordinates, a crop, an accessibility frame, another output or a different endpoint.
5. Perform one action and read the exact target again. Use `verify_state` for a supported postcondition, otherwise use fresh app state. A screenshot without proven surface identity cannot ground input. After a new snapshot, expiry or reconnect, discard old tokens/frames and rebind before acting. One-shot CLI invocations are useful for independent checks (`cua-driver status`, `cua-driver doctor`), not this stateful sequence.

## Stop and recovery conditions

- Begin with background delivery. For `background_unavailable` or a proven no-op, consider only the same exact action in foreground and only with authorization for the visible focus/workspace/cursor change. Stop on `foreground_unavailable`; do not substitute a shell input shim. For `surface_identity_unproven`, discard the frame and rediscover. `unsupported_operation` is not authority for an unreviewed workaround.
- For `partial`, `suspected_noop`, `unverifiable`, timeout or disconnect, inspect the **application-owned result** before any retry or handover. `effect:"confirmed"` proves only the reported effect. Unknown delivery is not failure to submit: do not duplicate a message, payment, upload or command.
- Record only when the owner requests recording. Check recording state first: there is one recorder per runtime; never stop another task's recording. Do not enable perception, broaden permission mode, approve a manifest, attach a personal profile or manipulate system authorization prompts as setup. Leave passwords, approvals and permission changes to the owner. Keep evidence private and limited to the target. Explicit intent is required for destructive actions, submissions and persistent changes, including closing potentially unsaved windows.
- Report the exact target, postcondition, fresh evidence and any unresolved limitation. If identity, authorization or verification fails, say which and stop.
