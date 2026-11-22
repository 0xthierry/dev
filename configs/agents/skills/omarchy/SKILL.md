---
name: omarchy
description: >-
  Required for end-user Omarchy Linux desktop customization: Hyprland, monitors,
  bindings, window rules, terminals, themes, Omarchy shell/bar/launcher/plugins,
  idle/lock, screenshots, and privileged system setup.
  Excludes upstream Omarchy source development.
---

# Repo-owned Omarchy customization

This skill is maintained in the machine-setup repository at
`configs/agents/skills/omarchy/`, not in an installed upstream skill. All harness
links use that copy. Preserve local authentication guidance when reviewing updates.

## Verify the supported runtime

Use read-only `omarchy version`, command discovery (`omarchy commands --json`),
and the active Hyprland config before choosing syntax. A staged package or a stale
`OMARCHY_PATH` does not prove the running desktop has cut over.

- **Supported target: stable 4.5.0 / Quattro.** Packaged source is
  `/usr/share/omarchy`, with `/usr/bin/omarchy-*` wrappers, Lua Hyprland
  configuration and the Quickshell desktop shell. `/etc/omarchy.conf` can select
  a development source root; packaged `default/bash/env-bootstrap` resolves it.
  If the running desktop differs, stop rather than apply incompatible syntax.
- **Migration staging:** edit only the explicitly authorized staging checkout,
  use isolated HOME/stubs, and never reload or restart the live desktop as validation.

## Ownership and safety

Everything reproducible goes through this machine-setup repository. Never edit
live symlink targets or deployed configs directly. Never edit packaged
`/usr/share/omarchy`, generated
`~/.local/state/omarchy/current/theme`, or system package wrappers for customization.
Read source freely; put customizations in repo-owned deployment sources.

Do not assume an update, config refresh, terminal restart, shell restart or reboot
is authorized. Refresh/reset commands need explicit confirmation. Quattro's shell
also owns the lock screen: never restart it casually to refresh a menu. Respect
upstream's lock-state guard when an explicitly authorized restart is necessary.
Do not run privilege prompts during read-only or staging tasks.

For authorized privileged operations, read [Graphical authentication with
pkexec](privileged-commands.md): try bounded `sudo -n` first, explain the precise operation
before graphical authorization, never handle the password or bypass a denial,
and validate the result. It does not authorize broader changes.

## Stable 4.5.0 contracts

| Surface | User configuration / generated state |
| --- | --- |
| Hyprland | `~/.config/hypr/hyprland.lua`, `bindings.lua`, `monitors.lua`, `input.lua`, `looknfeel.lua` |
| Shell, bar, notifications, idle/lock | `~/.config/omarchy/shell.json` |
| Launcher/menu extensions | `~/.config/omarchy/extensions/omarchy-menu.jsonc` |
| User plugins | `~/.config/omarchy/plugins/` |
| Theme overlays | `~/.config/omarchy/themes/<name>/` |
| Generated active theme | `~/.local/state/omarchy/current/theme/` (read-only) |
| Terminals | `~/.config/{ghostty,alacritty,foot,kitty}/` |

Read the installed version's relevant guide under
`$OMARCHY_PATH/default/agents/skills/omarchy/` (`hyprland.md`, `plugins.md`,
`theming.md`, `hooks.md`, `capture.md`) and implementation before proposing syntax.
Use the pristine target checkout instead during migration staging. These guides
are technical references, not permission to bypass repository ownership.

Hyprland bindings use `o.bind`/`o.rebind`; inspect existing bindings and explain
which action a replacement displaces. Never paste legacy `bind =` or monitor
syntax into `.lua` files. Check version-matched defaults/docs for window rules,
not a moving wiki's potentially different API. For authorized live deployment,
validate reload and `hyprctl configerrors`; report it unverified during staging.

`shell.json`, user plugins and menu extensions hot-reload. Launcher desktop
entries are watched; no Walker restart is appropriate on Quattro. Flatpak export
paths must survive the next graphical login. A first install in a session that
lacks those paths may need logout/login; updating the systemd manager alone does
not alter Quickshell's inherited environment. Do not claim live discoverability
without checking the actual launcher.

Theme overlays can override stock themes by name. Use `omarchy theme set <name>`
after authorized edits. Terminal configs are generated from `colors.toml`; don't
patch their generated copies. Query `omarchy-theme-color mode` for upstream's
`mode`, `theme_type`, `light.mode`, background-luminance, then dark precedence.
Presence of `light.mode` alone is not the light/dark contract.

## Discovery and verification

Prefer `omarchy <group> <action>` and check `--help` before use. Common read-only
commands: `omarchy version`, `omarchy commands --json`, `omarchy theme current`,
`omarchy font current`, `hyprctl monitors`. Use `omarchy debug --no-sudo --print`
for diagnostics. Commands that upload logs require authorization.

Preserve macOS and non-Omarchy behavior in shared integrations. Report
syntax/config tests separately from real compositor, launcher, terminal and theme
switching observations. Never call staged success a successful desktop migration.
