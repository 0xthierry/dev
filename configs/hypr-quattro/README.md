# Quattro: stock desktop, optional workspaces and shortcuts

Normal `./setup.sh omarchy` **preserves the current desktop**. It validates an
initialized Quattro installation, then leaves `~/.config/hypr` and Omarchy's
monitor/workspace state untouched. It neither installs these shortcuts nor
selects monitors, scaling, workspace IDs, input, appearance, or dictation.
Existing personal Lua files remain authoritative. No compositor reload or app
launch is part of this installer.

The protective guard still requires the fixed packaged
`/usr/share/omarchy/default/hypr/bootstrap.lua`, a real (not symlinked)
`~/.config` and `~/.config/hypr`, a real `hyprland.lua`, and exactly one stock
`require("default.hypr.omarchy")` import. Missing, legacy, unknown and symlinked
layouts are refused, not initialized or replaced. Dry-run on an empty HOME
prints the requirement and writes nothing. Populated stock per-monitor state
is expected and **must not be quarantined** for normal setup or shortcuts.

## Optional: nine global workspaces with the Quattro bar

On the DP-1 / HDMI-A-2 desktop running Omarchy 4.5.0, you can opt in to the old global numbering **without changing either display's scale, mode or position**. DP-1 owns 1–4 and 6–9 (default 1); HDMI-A-2 owns 5 (default and persistent). `Super+number` selects the same global workspace from either monitor. The move and silent-move number shortcuts use the same IDs; `0` still targets 10. Moving a workspace by direction does not renumber it.

Both bars show 1–9 even when empty, using Quattro's occupancy styling, active layout glyph, click and wheel controls. Any existing extra workspace (e.g. 14) remains accessible by its actual number until it disappears. Enabling this option does **not** merge or renumber existing workspaces, move their windows, or discard saved per-monitor state. Use Super+5 to visit the pinned secondary workspace.

From the repository root in an unlocked, running Omarchy session:

```bash
scripts/quattro-global-workspaces --dry-run
scripts/quattro-global-workspaces --apply
```

The installer links only `global-workspaces.lua` and the `devsetup.global-workspaces` user plugin. It backs up the Lua entrypoint before inserting one guarded import, reloads Hyprland, then asks the shell to replace just the workspace widget in its existing position. It never restarts the shell. Unknown link destinations, an unrecognized layout, or the historical full overlay are refused. A repeated run does not add imports, backups or widgets. Neither ordinary setup nor the optional shortcuts command enables this feature.

To opt out, use `omarchy plugin disable devsetup.global-workspaces` (the shell restores its stock widget). Remove **only** the `hypr.dev-global-workspaces` import from the user entrypoint, not any later personal edits. Stock workspace reconciliation resumes on reload and may reassign workspaces to per-monitor blocks; do this when ready for that change. The inactive plugin/module links can remain.

## Optional shortcuts: review before enabling

`shortcuts.lua` loads only `bindings.lua`. It does not load `desktop.lua` or
`workspaces.lua`. Review each difference and its conflicting stock binding
before choosing this option:

- Universal cut moves from Super+X to release-triggered Super+Alt+X; Super+X
  is free. Copy/paste stays stock, including terminal and shell-panel handling.
- Super+Shift+A/C launch or focus native ChatGPT/Claude, **without focusing
  workspace 5**. Stock workspace rules and the current app location decide
  placement. The command is not an installation of either app.
- Personal Github, Gmail, Bitwarden and Steam gaming enter/exit bindings replace
  the corresponding stock chords. Review installed app/helper availability.
- The retired Obsidian and Grok launcher chords remain unbound. This preserves
  the existing retirement edits; enabling shortcuts does not resurrect them.
- Physical grave (`code:49`): Super captures a region, Shift a window, Ctrl a
  display; Alt records a region and Ctrl+Alt records a display. Only conflicting
  stock Quake-console grave chords are removed. PRINT, OCR and other stock
  capture shortcuts stay available. Current `omarchy capture` commands are used.
- Dictation is entirely stock: no backend selection, F9/Super+Ctrl+X replacement,
  suppression hooks, or runtime setup. Upstream migration-generated personal
  bindings are left intact.

After reviewing `bindings.lua`, from the repository root, an explicit command
can install this option (do **not** run it merely to perform ordinary setup):

```bash
# Preview first. This writes nothing.
bash -c 'REPO_ROOT="$PWD"; source install/configs.sh; DRY_RUN=1 apply_hypr_quattro_shortcuts'
# Only after reviewing the preview and accepting these shortcut changes:
bash -c 'REPO_ROOT="$PWD"; source install/configs.sh; apply_hypr_quattro_shortcuts'
```

This symlinks this directory as `~/.config/hypr/dev-setup` and backs up the real
entrypoint before inserting exactly this line immediately after stock defaults:

```lua
if package.searchpath("hypr.dev-setup.shortcuts", package.path) then require("hypr.dev-setup.shortcuts") end
```

User Lua modules and stock toggles still load afterwards. Unknown existing
`dev-setup` directories/links, duplicated or reordered shortcut imports, and an
enabled historical full-overlay import are refused for manual review. A missing
optional module leaves a usable stock entry; errors inside an existing module
are not hidden. Hyprland may auto-reload when its entrypoint changes: only enable
this intentionally in an authorized session, not during offline testing. Review
and remove just this import to opt out; do not overwrite later personal edits by
blindly restoring a backup. Normal setup never removes or repairs existing hooks.

## Historical migration reference — not a desktop preset

`dev-setup.lua`, `desktop.lua`, `workspaces.lua`, and `workspace-state.py` retain
historical migration work and its tests. **Neither normal setup nor the optional
shortcuts installer loads the historical entrypoint.** Do not add
`hypr.dev-setup.dev-setup` to the current desktop. That old composition selects
DP-1 scale 2, HDMI-A-2 global workspace 5, input/appearance overrides and global
workspace reconciliation; those are not the current stock desktop contract.
No old monitor/workspace assignment is a reason to replace today's settings.
The stopped-session state helper is historical, not a prerequisite or a setup
step. Existing enabled historical imports require independent review; setup
will not rewrite user config to remove them automatically.

## Ghostty

On Omarchy, setup aligns an absent or recognized stock/repository-managed
Ghostty config with `configs/ghostty/omarchy.conf` and preserves a backup where
needed. An independent real config is left **unchanged and active**, with a
review message; backing it up and silently replacing it is not preservation.
Unknown symlinks are refused. Review/merge desired defaults manually through the
repo rather than deleting a real user config to make setup accept it. macOS
retains its separate repository config path.

## Offline verification

```bash
bash tests/quattro-config-deploy.test.sh  # bubblewrap, real packaged fixtures
python3 tests/hypr-quattro.test.py        # lua/luac, isolated compositor API recorder
python3 tests/hypr-quattro-workspaces.test.py  # historical workspace behavior only
bash tests/global-workspaces-deploy.test.sh    # opt-in installation, preserved user state and IPC readback
bash tests/global-workspaces-lua.test.sh       # global rules and shortcut/event dispatch
python3 tests/global-workspaces-widget.test.py # offscreen Quickshell bar interactions
```

Deployment tests run against read-only host/package trees and temporary HOME/XDG
state with no network. They prove normal setup preserves current Lua files and
populated workspace state, separate shortcut installation is idempotent and does
not load display/workspace policy, and independent Ghostty settings survive.
Historical workspace checks do not establish that the historical layout should
be deployed. Actual key delivery, app launches, and live shell behavior remain
unverified here: no live desktop or apps are touched by these checks.
