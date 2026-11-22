# Ghostty ownership

Omarchy uses `omarchy.conf`: package-owned `/usr/share/omarchy/config/ghostty/config`
first, then `personal.conf` through the linked `~/.config/ghostty/dev-setup/`
directory. `after-stock.conf` defers personal settings by one include level:
Ghostty processes nested includes breadth-first, so this places personal settings
after stock's generated-theme include. Package
updates and generated colors stay authoritative except for the deliberate
clipboard policy and split-navigation bindings. Stock Shift+Enter CSI-u is not
the ESC+CR binding removed in d452806, so it remains enabled.

macOS continues to use `config`, preserving its existing terminal preferences.
It is not a copy to update whenever Omarchy changes defaults.

The Linux layer no longer pins the old Caskaydia font, opacity, cursor colors,
padding, scroll tuning or backend. Those resolve from package defaults, the
active theme and Ghostty itself. Caskaydia was an older upstream font default;
fixed cursor colors/opacity arrived with a whole-config import (ed6bb3a), not a
separate preference change. Clipboard policy has explicit commits (a808998,
f10a7f5), and personal h/j/k/l split navigation predates that import.

## Safe cutover

Setup requires installed Omarchy Ghostty defaults and a real config directory.
It migrates the former repo-managed shared config symlink and backs it up.
Materialized `config` files and `dev-setup` directories are backed up as `.bak`, `.bak.1`,
etc., never discarded. Review these backups for additional local preferences
before launching a terminal, and promote desired changes into `personal.conf`.
Unrelated symlinks are refused rather than redirected. Repeated setup is a no-op
for already-correct links. Setup does not restart Ghostty or change live windows.
