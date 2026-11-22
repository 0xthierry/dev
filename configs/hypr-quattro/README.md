# Quattro desktop overlay

Target: pristine Omarchy **v4.5.0** (`ac2690cd7be4f47e4a255f5e2e78d904d436b068`),
not the live legacy desktop. The installer must symlink this directory at
`~/.config/hypr/dev-setup` and load **only** `dev-setup.lua`, immediately after
`require("default.hypr.omarchy")`, **before** personal Lua modules and toggles.
This keeps personal overrides authoritative and allows stock no-animations to
disable blur/shadow for software-rendered sessions:

```lua
if package.searchpath("hypr.dev-setup.dev-setup", package.path) then require("hypr.dev-setup.dev-setup") end
```

This directory does not replace `~/.config/hypr`. Do not source legacy `.conf`
files alongside this overlay. Do not reload the live compositor to test it.

## Personal behavior retained

- DP-1 3840×2160 @ 60 Hz, scale 2, position 1632×477; HDMI-A-2 1920×1080 @
  60 Hz, scale 1, position 3552×477.
- Global workspaces 1–9: 5 persistent/default on HDMI-A-2; the others on DP-1,
  with 1 default. Numeric focus/move and bar clicks retain global identities.
- US International / pc105 / Caps Compose, 600 ms repeat delay, mouse -0.4.
  Stock already supplies repeat rate 40, numlock and touchpad scroll factor 0.4.
- Border 1, no border dragging, opaque windows, direct scanout, legacy blur and
  shadow settings, group indicator height 0 and windows/special animations.
  Other current defaults and theme colors remain package-owned. Legacy
  `omarchy-looknfeel.conf` was a compatibility copy, not a reason to freeze
  every Quattro default.
- GUI copy/paste use Ctrl, terminals use Ctrl+Shift; cut is Super+Alt+X and
  Super+X is free. Stock v4.5 clipboard now implements the intended behavior
  with down/up events and a 50 ms release timer, including focused shell panels.
  Therefore C/V use stock press bindings rather than the old shell release
  wrapper. Cut stays release-triggered. The legacy WezTerm class gets the
  stock terminal tag. No `wtype` injection or activewindow-only helper copied.
- Dictation is entirely stock on Quattro: this overlay neither selects a
  backend nor changes dictation shortcuts. Stock Alt+Space / Right Alt and
  migration-generated personal F9 / Super+Ctrl+X bindings remain upstream-owned.
  There are no repo-owned dictation hooks, suppression submaps or runtime setup.
  Legacy 3.x alone unbinds F9 / Super+Ctrl+X; macOS Handy remains unchanged.
- Native ChatGPT and Claude focus workspace 5 before launch; Github, Gmail,
  Bitwarden, lazydocker, and Steam gaming enter/exit shortcuts override stock
  conflicts. Same-behavior stock app launchers remain inherited, including
  newer terminal/cwd handling. Stock extra shortcuts remain available.
- Physical grave `code:49`: Super region screenshot, Shift window, Ctrl display,
  Alt region recording, Ctrl+Alt display recording. PRINT and stock Quake
  console grave conflicts are removed. Uses the current screenrecording CLI,
  not retired `omarchy-cmd-screenrecord` or its obsolete `output` argument.
- Once-per-session Xwayland keyboard alignment retained; **no Waybar watchdog**.
  No personal environment overrides existed; current package/theme env wins.
- Stock scroll rules retained, except foot restored from Quattro 2.0 to personal
  1.5. No obsolete agent-bar popup rules copied.

## Workspace compatibility boundary

Quattro's `default/hypr/monitor-workspaces.lua` normally renumbers workspaces
into blocks per monitor. Merely adding workspace rules is insufficient.
`workspaces.lua` changes the existing exported table in place: event listeners
resolve `reconcile` dynamically, while old keybind closures must be rebound.
Public `focus`, `move_window`, `move_to_monitor`, and `workspace_id` use global
identities. The stock shell bar's `o.workspaces.focus(slot, monitor)` call is
compatible; the monitor hint must not override the global workspace rule.

**Review on upstream upgrades:** this is intentionally coupled to v4.5.0's
exported-table/listener behavior. Tests load those actual upstream listeners.

### Required stopped-session workspace state transition

The required **boot stock first** step writes per-monitor workspace state.
Quarantining it is mandatory, not an optional old-install cleanup. The installer
refuses nonempty or symlinked `monitor-workspaces` / `monitor-workspaces-merged`.
Never move them while Hyprland is running: its in-memory tables can write the
stock state back. Save work, log out completely, and use a **local text console**.
Do not merely open a terminal, switch VT with the compositor still running, or
restart the bar. Keep the config snapshot and its matching state snapshot paired.

From that stopped-session console, using the staged checkout's explicit path:

```bash
state="${XDG_STATE_HOME:-$HOME/.local/state}/omarchy"
# Choose a NEW explicit snapshot name. Parent must already exist, same filesystem.
python3 /home/thierry/omarchy-migration-20261122/setup/configs/hypr-quattro/workspace-state.py \
  save "$state/dev-setup-stock-before-overlay-20261122"
# Now run the separately reviewed overlay installer; log in only after it succeeds.
```

The helper checks that your Hyprland process has exited, records both members
(including absence) in a manifest, and moves them without overwriting. It refuses
symlinked files/ancestors, parent traversal, wrong-owner state/snapshot directories
or files, non-private snapshot permissions, group/other-writable source directories,
unowned snapshot-manifest collisions, differing files, cross-filesystem moves,
and failed process probes. Empty `XDG_STATE_HOME` uses the normal HOME fallback.
It is **never automatically called by setup**.
A rerun can complete an interrupted transfer only with the matching manifest and
hashes; simultaneous source/destination names must refer to the same inode, not
merely equal bytes. Keep both locations if a failure occurs; never delete one to
make a retry pass. No live state has been moved during development/testing.

**Why removal from the active state directory is sufficient:** the actual stock
`Workspaces.qml` falls back to block 0 on DP-1's active 1 and HDMI-A-2's active 5.
Both bars show IDs 1–5 plus existing 6–9; numeric labels equal global IDs, except
the active workspace displays its layout glyph. A click on 5 on DP-1 emits
`o.workspaces.focus(5, "DP-1")`; our override deliberately ignores the monitor hint
and focuses global 5 on its rule-owned HDMI-A-2. No QML patch is necessary. The
Lua listeners do not recreate block assignments after the override; the upstream
session-start listener does create an **empty merged file**, which is harmless.
The bar retains stock first-five-plus-existing presentation, not old Waybar UI.

**Rollback, still logged out:** first save the overlay's current pair to a NEW
snapshot (for example `dev-setup-overlay-before-stock-20261122`), then restore the
stock config snapshot and run the helper with `restore` and the original
`dev-setup-stock-before-overlay-20261122` directory. Restore refuses conflicting
current state; do not overwrite it. Returning to the overlay later requires
saving the then-current stock pair separately before restoring the matching
overlay pair/config. Do not restore a stock state pair alongside overlay config,
or mix one config's `monitor-workspaces` with another's `-merged`. Original files,
absence and permissions survive the same-filesystem moves.

The offline tests execute the actual upstream QML function bodies, block getter
and displayed-label expression in Qt's JS engine with populated stock state and
after quarantine. They reproduce the misleading stock-block labels, then verify
both fallback bars and monitor-hinted click expressions. They do not render the
real Quickshell UI; that remains target/rehearsal validation.

## Integration obligations / non-Lua gaps

- Quattro's packaged dictation dependency and selected backend are distinct.
  Stock ships Superwhisper as the default selection. Its first-run script and
  migration `1793667581.sh` set up the runtime only when the selected backend is
  `superwhisper`. Migration `1791479273.sh` may preserve an existing backend when
  no selection file exists. This repo neither overrides that decision nor writes
  an opt-out marker; inspect the actual selected backend during bridge rehearsal.
  Preserve upstream migrations and any generated personal bindings unchanged.
- Legacy `xdph.conf` selects `/home/thierry/.local/bin/sober-observer-picker`,
  whereas Quattro selects `hyprland-preview-share-picker`. Portal picker
  configuration is outside Lua; decide explicitly whether the custom picker is
  still needed and available before deployment. This overlay does not change it.
- Legacy hypridle uses a 150-second screensaver and 152-second subsequent lock
  timer (the screensaver resets idle), plus lock-before-sleep/wake handling;
  hyprlock disables fingerprint authentication. Quattro owns idle/lock in the
  shell. These settings need separate shell-level review, not autostarting
  retired hypridle/hyprlock alongside Quattro. Not claimed as ported here.
- Hyprsunset's identity/daytime default matches stock; no override required.
- Native AI apps, Bitwarden, Steam launch helpers, and setxkbmap must
  remain installed. Lua validity does not establish those executables' runtime
  availability or correctness.

## Physical-key IPC inspection

Hyprland v0.56.2 Lua `code:49` bindings legitimately report legacy `key=""` and
`keycode=0`: `src/config/lua/bindings/LuaBindingsToplevel.cpp:99–106,125–128`
stores physical codes in `sMkKeys`, not the legacy fields.
`src/managers/KeybindManager.cpp:671–692` matches that array against event
keycodes. The numeric workspace `code:10`–`code:19` bindings use the same path.
Do not replace physical codes with layout-dependent keysyms based on those IPC
fields. Physical keyboard/QMP event delivery is the behavioral validation; parser
success and binding descriptions alone do not establish it.

Sources: [Lua parser](https://github.com/hyprwm/Hyprland/blob/v0.56.2/src/config/lua/bindings/LuaBindingsToplevel.cpp#L99),
[event matching](https://github.com/hyprwm/Hyprland/blob/v0.56.2/src/managers/KeybindManager.cpp#L671).

## Offline verification

```bash
python3 tests/hypr-quattro.test.py
python3 tests/hypr-quattro-workspaces.test.py  # requires Qt 6 qmltestrunner
# Or another pristine v4.5.0 source checkout:
python3 tests/hypr-quattro.test.py --upstream /path/to/omarchy
```

The runner uses a temporary HOME/XDG tree, a strict environment allowlist and
no live session sockets. It checks every Lua file with `luac -p`, executes real
upstream helpers/clipboard/tiling/workspace callbacks against a compositor API
recorder, and runs installed Hyprland's **`--verify-config` only** with the real
helpers/look defaults and overlay. It verifies emitted focus/move/input/submap
commands, registration conflicts, session/reload/hotplug behavior, display rules,
and configuration application. It does not synthesize real input or run app
launchers.

Validated with local Hyprland 0.56.2: the parser also reads back actual emitted
config globals before and after personal overrides and stock no-animations,
proving the new precedence. State tests cover populated pairs, repeat operations,
interrupted link/move resumption, collision refusal, stopped-session guards and
rollback with separate stock/overlay snapshots. A full pristine
stock config in `--verify-config` hits upstream `startup-cursor.lua:79` passing
nil `HYPRLAND_INSTANCE_SIGNATURE` to `hl.env`, then SIGSEGV. The isolated parser
check avoids unrelated startup listeners; it is **not** proof of an entire
Quattro session. Fresh-session shell bar rendering, stock dictation input,
clipboard delivery, screenshot/recording UI, hotplug, direct scanout and display
layout still require the authorized rehearsal/target environment, never the
live legacy desktop.
