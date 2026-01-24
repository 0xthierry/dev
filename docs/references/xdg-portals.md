# XDG Desktop Portals on Arch Linux + Hyprland

## Note: Omarchy Already Provides

If using omarchy, XDG portals are **already configured**. Only use this doc if:
- Troubleshooting portal issues
- Understanding how portals work
- Setting up a non-omarchy Arch system

---

## The Problem

Home Manager's `xdg.portal` module is designed for NixOS. On non-NixOS (Arch), systemd cannot find Nix-provided `.service` files, causing portals to fail.

**Solution**: Install portals via **pacman**, configure via **home-manager** or manual files.

## Installation (pacman)

```bash
# Core portal packages
sudo pacman -S xdg-desktop-portal xdg-desktop-portal-hyprland xdg-desktop-portal-gtk

# Required dependencies
sudo pacman -S qt6-wayland pipewire wireplumber
```

## Portal Responsibilities

| Portal | Provides |
|--------|----------|
| **xdg-desktop-portal-hyprland** | ScreenCast, Screenshot, GlobalShortcuts |
| **xdg-desktop-portal-gtk** | FileChooser, Settings, Notifications |

XDPH does NOT provide FileChooser - you need GTK portal for file dialogs.

## Configuration File

Create `~/.config/xdg-desktop-portal/portals.conf`:

```ini
[preferred]
default=hyprland;gtk
org.freedesktop.impl.portal.FileChooser=gtk
org.freedesktop.impl.portal.Settings=gtk
```

Or via Home Manager:

```nix
xdg.configFile."xdg-desktop-portal/portals.conf".text = ''
  [preferred]
  default=hyprland;gtk
  org.freedesktop.impl.portal.FileChooser=gtk
  org.freedesktop.impl.portal.Settings=gtk
'';
```

## Hyprland Configuration

Add to `hyprland.conf`:

```
# Environment variables
env = XDG_CURRENT_DESKTOP,Hyprland
env = XDG_SESSION_TYPE,wayland
env = XDG_SESSION_DESKTOP,Hyprland

# Critical: propagate to systemd/dbus
exec-once = dbus-update-activation-environment --systemd WAYLAND_DISPLAY XDG_CURRENT_DESKTOP
exec-once = systemctl --user import-environment WAYLAND_DISPLAY XDG_CURRENT_DESKTOP
```

## Troubleshooting

### Check Portal Status

```bash
systemctl --user status xdg-desktop-portal
systemctl --user status xdg-desktop-portal-hyprland
systemctl --user status xdg-desktop-portal-gtk
```

### View Logs

```bash
journalctl --user -u xdg-desktop-portal -f
journalctl --user -u xdg-desktop-portal-hyprland -f
```

### Check Environment

```bash
systemctl --user show-environment | grep -E "WAYLAND|XDG"
```

### Nuclear Option (restart script)

Create `~/.config/hypr/scripts/portal-restart.sh`:

```bash
#!/usr/bin/env bash
sleep 1
killall -e xdg-desktop-portal-hyprland
killall -e xdg-desktop-portal-wlr
killall xdg-desktop-portal
/usr/lib/xdg-desktop-portal-hyprland &
sleep 2
/usr/lib/xdg-desktop-portal &
```

Add to hyprland.conf: `exec-once = ~/.config/hypr/scripts/portal-restart.sh`

## Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| Portal "inactive (dead)" | Missing env vars | Add `dbus-update-activation-environment` |
| Qt picker wrong theme | Missing QT env | Import `QT_QPA_PLATFORMTHEME` |
| Crash on start | Missing qt6-wayland | `pacman -S qt6-wayland` |
| slurp opens instead of Qt | XDPW running | Remove or prioritize XDPH |
| Screen share black | Wrong portal | Verify XDPH is active |

## Firefox File Picker

To use portal file picker in Firefox, set in `about:config`:

```
widget.use-xdg-desktop-portal.file-picker = 1
```

## Do NOT Use

- `xdg.portal.extraPortals` in Home Manager (broken on non-NixOS)
- `dbus-run-session Hyprland` (breaks systemd session bus)

## Complete Working Setup

1. Install via pacman (portals, qt6-wayland, pipewire)
2. Create `~/.config/xdg-desktop-portal/portals.conf`
3. Add environment variables to hyprland.conf
4. Add `dbus-update-activation-environment` exec-once
5. Verify with `systemctl --user status xdg-desktop-portal-hyprland`
