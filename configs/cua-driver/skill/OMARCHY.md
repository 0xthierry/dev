# Cua Driver on Thierry's Omarchy desktop

Apply this profile only when the current graphical session is Hyprland/Omarchy. On the managed Omarchy host, the repository configures a user service with `CUA_DRIVER_RS_ENABLE_WAYLAND=1`. Check that service first and reuse it when active instead of starting a second daemon.

## Establish the live display layout

Run `cua-omarchy-display monitors` before any task whose result depends on a monitor or desktop coordinate. Treat the returned `hyprctl monitors -j` data as current state. Discover output names and geometry at runtime; names such as `DP-1` and `HDMI-A-2` are examples, not durable identities.

With the repository's pinned Cua Driver 0.28.1:

- `get_desktop_state` has no selected-output parameter.
- Its `"display":"primary"` label does not prove that Hyprland considers the captured output primary or focused. The native Wayland backend currently binds the first advertised `wl_output`.
- Desktop action targets accept only `display_id:"primary"`.
- Changing the focused Hyprland monitor does not prove that a later desktop capture uses that output.

Do not claim selected-monitor coverage from a Cua desktop screenshot unless the pixels and dimensions establish it.

## Observe multiple monitors without changing focus

Use the repository helper for passive full-output capture:

```bash
cua-omarchy-display capture-output OUTPUT /tmp/output.png
cua-omarchy-display capture-layout /tmp/layout.png
```

`capture-output` validates the output against the live Hyprland monitor list before calling `grim`. `capture-layout` captures the complete compositor layout. Both commands are observation-only and do not authorize input.

Treat these images as external evidence. **Never pass coordinates read from a helper screenshot into a Cua desktop action.** A selected-output image uses output-local coordinates, while Cua desktop actions use the driver's `"primary"` frame. A full-layout image uses compositor-layout coordinates. Neither mapping is proven equivalent to Cua's desktop frame.

## Operate a window on any monitor

Use this route when the desired application window is on a secondary output:

1. Capture the relevant output with `cua-omarchy-display` when full-monitor context is needed.
2. Use Cua `list_windows` to identify the exact `pid` and `window_id`. When a compositor address is also required, run `cua-omarchy-window correlate` and continue only from an `exact` match produced from current pid and geometry.
3. Call `get_window_state` for that exact window. Use only the screenshot, element tokens, and window-local coordinates returned by this call for subsequent window-targeted actions.
4. Prefer accessibility actions. On Chromium or Electron page content, read `BROWSER.md` and prefer the typed browser tools.
5. Verify each action with `verify_state` or a fresh `get_window_state`, as required by the upstream loop.

Do not derive a Cua window click by subtracting monitor origins from a `grim` screenshot. Mixed scaling, window decorations, and compositor transforms make that translation unproven. Re-ground on the exact Cua window snapshot instead.

## Restrict desktop-level actions

Use a Cua desktop action only when all of these conditions hold:

- The user authorized visible desktop control under the upstream foreground boundary.
- A fresh `get_desktop_state` produced the coordinates used for the action.
- The target is visibly present in that exact Cua desktop image.
- A fresh `get_desktop_state` can verify the result in the same frame.

If the desired target appears only in `grim` output or on an output Cua did not capture, switch to an exact Cua window/browser target. Do not use the compositor fallback below for application clicks, typing, menus, or page content.

## Use the compositor fallback only for window management

The upstream skill normally prohibits shell-based GUI manipulation. This profile defines one narrower exception for Hyprland-owned window state when Cua has already refused the equivalent exact operation as unsupported. It does not authorize input inside an application.

Use `cua-omarchy-window` only for these allowlisted operations:

```bash
cua-omarchy-window windows
cua-omarchy-window correlate
cua-omarchy-window move-to-output ADDRESS OUTPUT
cua-omarchy-window focus ADDRESS --authorize-foreground
cua-omarchy-window close ADDRESS --authorize-close
```

The helper accepts only an exact live Hyprland address such as `0x1234abcd`. It resolves outputs from fresh compositor state, exposes no arbitrary dispatcher argument, and verifies the requested postcondition after dispatch. Its dispatcher contract was reviewed against Hyprland 0.56.2 and the current [official dispatcher documentation](https://wiki.hypr.land/Configuring/Dispatchers/); revalidate it when upgrading Hyprland.

Follow these boundaries:

1. Prefer Cua for application launch, exact-window discovery, capture, browser binding, and application input.
2. Before a compositor mutation, run `cua-omarchy-window correlate` and select one current `exact` Cua-to-Hyprland match. Use `windows` for additional compositor metadata. Never target by title, class, focus order, array order, or a remembered address.
3. Use `move-to-output` only after Cua window placement returned `unsupported_operation`. The helper silently moves the exact window to the selected output's currently active workspace and verifies both monitor and workspace.
4. Use `focus` only when the user authorized visible foreground control for this workflow. The required flag records that boundary; it does not create authorization.
5. Use `close` only when the user explicitly requested that exact window be closed or explicitly authorized cleanup of a window created by the agent. Closing is destructive even when the window appears blank.
6. After moving or focusing, take a passive output capture when visual placement matters. After closing, verify the exact address is absent. A successful dispatcher response without state readback is not completion.

For a newly launched window intended for another output:

1. Record the current Cua windows and `cua-omarchy-window correlate` result.
2. Launch through Cua.
3. Correlate again and identify the single new exact window. If the result is unmatched or ambiguous, stop rather than guessing.
4. Attempt Cua's exact geometry operation. If it refuses as unsupported on Hyprland, move the exact address with `cua-omarchy-window move-to-output`.
5. Verify with fresh Cua window discovery and a passive capture of the destination output.

Do not use `hyprctl dispatch` directly. Add any future compositor operation to the allowlisted helper with validation, authorization rules, and postcondition tests first.

## Diagnose before improvising

Run `cua-driver doctor` when the service, Wayland backend, accessibility bus, or capture route is unclear. Check `systemctl --user status cua-driver.service` when the managed service is unavailable. Do not install or enable the experimental Hyprland plugin; this repository intentionally uses the released native Wayland backend without that plugin.

A degraded accessibility tree does not justify ungrounded coordinates. Use the exact window screenshot, the typed browser route, or a fresh supported observation. Preserve the upstream rule that foreground delivery requires prior authorization or a new user approval.
