# Quattro desktop overlay

Target: pristine Omarchy **v4.5.0** (`ac2690cd7be4f47e4a255f5e2e78d904d436b068`),
not the live legacy desktop. The installer must symlink this directory at
`~/.config/hypr/dev-setup` and load **only** `dev-setup.lua`, immediately after
`require("default.hypr.omarchy")`, **before** personal Lua modules and toggles.
This keeps local personal overrides authoritative and stock toggles last:

```lua
if package.searchpath("hypr.dev-setup.dev-setup", package.path) then require("hypr.dev-setup.dev-setup") end
```

This directory does not replace `~/.config/hypr`. Legacy 3.x deployment and its
repo-owned tree have been removed. Real setup requires the fixed packaged
`/usr/share/omarchy/default/hypr/bootstrap.lua`, a real (not symlinked) config
directory/entrypoint, and exactly one stock defaults import. It refuses missing,
legacy, unknown, or symlinked layouts instead of initializing/clobbering them.
Dry-run from an empty HOME only prints the requirement and plan; it writes nothing.
Do not source legacy `.conf` files alongside this overlay or reload the live
compositor to test it.

## Personal behavior retained

- DP-1 3840×2160 @ 60 Hz, scale 2, position 1632×477; HDMI-A-2 1920×1080 @
  60 Hz, scale 1, position 3552×477.
- Global workspaces 1–9: 5 persistent/default on HDMI-A-2; the others on DP-1,
  with 1 default. Numeric focus/move and bar clicks retain global identities.
- US International / pc105 / Caps Compose, mouse -0.4. Stock repeat delay 250,
  repeat rate 40, numlock, touchpad behavior and scroll rules are inherited.
- Border 1, opaque windows and direct scanout. Border dragging, blur/shadows,
  group indicators, animations and theme colors remain package-owned. The old
  `omarchy-looknfeel.conf` was a compatibility copy, not personal preferences.
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
  The removed legacy tree's F9 / Super+Ctrl+X unbinds do not survive; macOS Handy
  remains unchanged.
- Native ChatGPT and Claude focus workspace 5 before launch; Github, Gmail,
  Bitwarden, and Steam gaming enter/exit shortcuts override stock
  conflicts. Same-behavior stock app launchers remain inherited, including
  newer terminal/cwd and Docker TUI handling. Stock extra shortcuts remain available.
- Physical grave `code:49`: Super region screenshot, Shift window, Ctrl display,
  Alt region recording, Ctrl+Alt display recording. Only stock Quake console
  grave conflicts are removed; stock PRINT screenshot, recording, color picker
  and OCR shortcuts remain usable. Uses the current screenrecording CLI,
  not retired `omarchy-cmd-screenrecord` or its obsolete `output` argument.
- Once-per-session Xwayland keyboard alignment retained; **no Waybar watchdog**.
  No personal environment overrides existed; current package/theme env wins.
- All stock scroll rules retained, including foot 2.0. No obsolete agent-bar
  popup rules copied.

## Provenance audit and remaining confirmations

Compared the repo history through `a097d80`, real v3 defaults at
`~/.local/share/omarchy` (`v3.8.4-5-gf4378f0d`), historical upstream changes,
and tagged v4.5.0. A value living in a preference file is not proof of preference.

| Decision | Evidence |
| --- | --- |
| Keep monitor layout/global workspace 5 | Explicit monitor/workspace edits `136daa3`, `86dc241`, `5ffb92d`, `fa87708`; latest layout is retained unchanged. |
| Keep US intl/pc105 and Xwayland alignment | `d08aa0c` explicitly describes physical US keyboard/dead-key intent and adds matching `setxkbmap`. |
| Keep sensitivity -0.4 | Initial repo import `42b0619` differs from upstream's commented `0.35` / default 0; no upstream source for -0.4 found. |
| Keep border 1, opacity 1, direct scanout | Deliberate border transition `1ebe6af`; opacity fix and documented scanout intent `2d9f08b`. |
| Drop repeat delay 600 | It was stock in upstream before `8a7c7729` changed it to 250; repo never independently selected 600. |
| Drop foot 1.5 override | Repo `6ad19d1` copied upstream `7debca9f`'s addition of foot; v4 intentionally changes it to 2.0 with a precise-scroll explanation. |
| Drop resize/blur/shadow/groupbar/animation overrides | Imported compatibility copy in `0db4a04`, explicitly labelled copied defaults; no subsequent personal edits. |
| Drop legacy idle/lock services | Repo `6ad19d1`'s entire final hypridle config matches real v3 stock byte-for-byte (upstream `4831c883`); not a custom 150/152-second requirement. Quattro shell owns idle/lock. |
| Keep copy/paste intent, not helper | `a808998` explains GUI/terminal-aware behavior; real v4 clipboard satisfies it, including shell panels. All callers of the removed helper were in the removed tree. |
| Keep cut at Super+Alt+X / Super+X free | `e2e185f` explicitly states both choices. |
| Keep physical grave capture | `3403a38` fixes intl dead-key matching; `1274809` maintains capture commands. |
| Drop direct lazydocker override | It was the v3 stock binding in `config/hypr/bindings.conf`, not a personal choice; retain v4's `omarchy-launch-docker-tui` wrapper. |
| Restore unrelated PRINT shortcuts | Initial `42b0619` unbind comment only claimed avoiding conflicts with grave, which uses a different chord; no explicit freed-PRINT workflow found. No new OCR unbind is warranted. |

**Confirmation items, not silently erased personal intent:**

- Caps Compose was a v3 default, but `d08aa0c` explicitly carries it into the
  Xwayland alignment command. Retained for consistent keyboard behavior; confirm
  whether Quattro's new Shift+Caps Compose / ordinary Caps Lock is preferred.
- Sensitivity -0.4 is a nonstock imported value rather than a separately explained
  commit. Retained conservatively; confirm if stock 0 should replace it.

**Decided:** use Quattro's stock interactive screen-sharing picker. Do not carry
forward the Sober observer's automatic selection from `1d5fb75`. A fresh install
needs no overlay. If the bridge preserved the old picker, follow the one-time
[cutover checklist](../../docs/omarchy-quattro-cutover.md#after-conversion-prefer-stock-over-carried-forward-files).
Legacy fingerprint disabling is also stock, not a confirmation blocker: repo
`f42be4d` follows upstream `bd8b12b2` (disable fingerprint unless configured).
The retired lock config is not ported; Quattro owns authentication defaults.

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

From the root of the reviewed Quattro checkout in that stopped-session console:

```bash
state="${XDG_STATE_HOME:-$HOME/.local/state}/omarchy"
# Choose a NEW explicit snapshot name. Parent must already exist, same filesystem.
python3 configs/hypr-quattro/workspace-state.py \
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
- The stock portal picker decision is recorded above; routine deployment never
  overwrites existing portal configuration or launches legacy idle/lock services.
  Stock v3 idle timings/fingerprint defaults were not personal deltas to port.
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
bash tests/quattro-config-deploy.test.sh  # requires bubblewrap
python3 tests/hypr-quattro.test.py         # requires bubblewrap, lua/luac
python3 tests/hypr-quattro-workspaces.test.py  # requires Qt 6 qmltestrunner
# Or another pristine v4.5.0 source checkout:
python3 tests/hypr-quattro.test.py --upstream /path/to/omarchy
```

The runner uses a temporary HOME/XDG tree, a strict environment allowlist and
no live session sockets. Deployment tests mount real tagged upstream defaults
at the fixed package path inside Bubblewrap (read-only host root, writable test
HOME only); there is no production test-path bypass. The Python runner checks
the exact v4.5.0 commit before loading its real default modules. It checks every Lua file with `luac -p`, executes real
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
