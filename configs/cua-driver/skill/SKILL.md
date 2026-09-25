---
name: cua-driver
description: Drive or inspect native GUI applications with Cua Driver on repository-managed Linux hosts, especially Thierry's Hyprland/Omarchy desktop. Use for Linux computer-use workflows, native windows, desktop screenshots, browser windows, GUI interaction, or continuation of earlier Cua activity.
version: 0.28.3
---

# Cua Driver on Linux

Operate Linux GUI state through `cua-driver`. Select one exact target, observe it before acting, and verify the requested outcome from fresh state afterward. Never turn successful input delivery into a claim that the user's outcome succeeded.

This repository supports Cua on Linux only. Do not load or apply macOS or Windows procedures.

## Load only the applicable reference

- On Hyprland/Omarchy, read `OMARCHY.md` before selecting an input backend or performing any monitor, workspace, compositor, or multi-window operation.
- For Chromium or Electron page content, read `BROWSER.md` before binding or mutating a page.
- For an unfamiliar tool or parameter, run `cua-driver describe TOOL`. Treat the installed schema as authoritative for the pinned runtime.

Do not read an unrelated reference merely because it exists.

## Choose the narrowest route

Name the postcondition, then use the first route that can prove it:

1. **Non-GUI semantic operation.** When the outcome is a file, process, service, or other non-GUI state and the caller has an exact API or command, use it and read the resulting state back.
2. **Typed Cua operation.** Prefer `set_window_frame` for supported exact geometry, `invoke_menu` for a known native menu path, clipboard tools for clipboard state, and typed browser tools for supported page content.
3. **Accessibility action.** Use a current `element_token` from the exact window snapshot.
4. **Window-local pixel action.** Use coordinates from the screenshot returned by that same `get_window_state` call when accessibility is unavailable or contradicted by the pixels.
5. **Foreground delivery.** Retry only after a background action returns an explicit foreground escalation or fresh evidence proves a no-op. Use it only when the user already authorized visible foreground control or after asking.
6. **Desktop action.** Use only from a fresh Cua desktop screenshot and verify in the same frame. On Omarchy, apply the stricter monitor rules in `OMARCHY.md`.

Once the outcome is inside an application's UI, do not substitute `xdotool`, `wmctrl`, raw `hyprctl dispatch`, or another shell input shim. The allowlisted Omarchy helper is an exception only for compositor-owned window state described in `OMARCHY.md`.

## Establish the runtime and exact target

Use the managed daemon when it is running:

```bash
cua-driver status
```

Run `cua-driver doctor` when the display backend, AT-SPI bus, service, or capture route is unclear. On the managed Omarchy host, the default service enables native Wayland capture. `OMARCHY.md` describes the separate managed X11 endpoint for Alacritty input; its window IDs must never be mixed with native Wayland IDs.

For an existing application:

1. Call `list_windows`, optionally restricted by `pid`.
2. Select one explicit `(pid, window_id)`. Do not infer stacking from array order. Higher non-null `z_index` is closer to the front; if every value is null, use titles and fresh geometry only to narrow candidates, and stop if selection remains ambiguous.
3. Call `get_window_state` for that exact pair before acting.

For a requested launch, use `launch_app` with a `launch_path` returned by `list_apps` when available. The returned process may hand the request to an existing single-instance application. Re-list windows and identify the new exact window from fresh state rather than trusting the spawned pid alone. Never launch an application unless the user's request implies it.

## Preserve the snapshot/action/verification invariant

Every action must follow this loop:

```text
fresh exact state → one action → fresh verification
```

For a window action:

1. Call `get_window_state({pid, window_id})`. It normally returns the accessibility projection and screenshot together.
2. Prefer the response's opaque `element_token`. A new snapshot invalidates earlier tokens. If using the integer form, send its matching `snapshot_id`.
3. Perform one action against the same exact window.
4. Use `verify_state` for an expressible postcondition. Otherwise call `get_window_state` again and inspect the new tree and screenshot.

`effect:"confirmed"` proves only the action fact represented by its evidence. `effect:"unverifiable"`, `suspected_noop`, `partial`, and `refused` are not task success. `verify_state.status:"unknown"` is also not success.

## Use accessibility and pixels correctly

An element action addresses a current accessibility token. A pixel action addresses screenshot pixels. Do not convert one into the other from accessibility geometry without checking the exact image.

For pixel actions:

- Use coordinates from the same window screenshot that grounds the action.
- Pass `window_id` with pixel coordinates so conversion remains tied to the captured window.
- Do not crop or resize the image before selecting coordinates.
- Re-snapshot after the action.

A degraded tree is a routing signal, not permission to guess. Chromium, Electron, canvas, and custom-rendered surfaces often expose incomplete AT-SPI state. Use the exact screenshot, typed browser route, or stop when target identity cannot be proven.

## Respect Linux delivery boundaries

On X11, accessibility and some targeted event routes can operate without raising the window. On Wayland, arbitrary raw input generally cannot target an unfocused window. Start with background delivery and trust the structured refusal:

- `background_unavailable`: consider the exact foreground retry only with user authorization.
- `foreground_unavailable`: stop; do not replace it with a shell focus/input command.
- `surface_identity_unproven`: discard the screenshot claim, refresh window discovery, and use a supported full-output or exact-window route.
- `unsupported_operation`: use a documented typed fallback only when this skill or `OMARCHY.md` explicitly defines one.

`delivery_mode:"foreground"` may change focus, workspace, and cursor state. It is a visible takeover boundary, not a default for Chromium, GTK, or any other toolkit.

## Use sessions deliberately

One-shot `cua-driver TOOL 'JSON'` calls are suitable for isolated inspection and management. Use one persistent MCP connection for an ordered multi-call workflow that needs browser target capabilities, recording, or shared lifecycle state.

A public `session` label is lifecycle metadata, not authority. When using one, repeat it on every call that accepts it. Starting or naming a session never grants foreground, desktop, browser-profile, or destructive permission.

## Handle browser windows by surface

- For page content in Chromium or Electron, follow `BROWSER.md` and use the typed page tools when exact binding succeeds.
- For tabs, address bar, menus, permission prompts, downloads UI, file pickers, and other browser chrome, use the native exact-window loop in this file.
- If typed binding is heuristic, ambiguous, or read-only, do not mutate the page.

## Restrict destructive and persistent actions

Do not close a window with unsaved state, delete data, send a message, submit a form, approve a transaction, or change persistent settings without explicit user intent for that outcome. A cleanup action still needs authorization when it can discard state.

Do not enable a Hyprland input plugin, change Cua permission mode, attach to a personal browser profile, start recording, or modify managed service configuration unless the user explicitly requests that change.

## Finish with evidence

Return:

- the exact window, page, or display affected;
- the requested postcondition;
- the fresh observation that proves it;
- any degraded, refused, ambiguous, or unverified part.

If perception and input cannot be bound to the same target coordinate frame, stop and report the limitation instead of translating coordinates heuristically.
