# Omarchy Reference Guide

## Overview

Omarchy is an opinionated Arch Linux distribution created by DHH (David Heinemeier Hansson). It provides a complete developer-focused desktop environment with Hyprland.

**Version**: v3.3.3 (January 2026)
**Repository**: https://github.com/basecamp/omarchy
**Website**: https://omarchy.org

---

## DO NOT INSTALL (Already Provided by Omarchy)

When configuring the `omarchy` host, **skip these** - they're already installed:

### Desktop Environment
- Hyprland, Waybar, Hyprlock, Hypridle, Mako
- Walker (launcher)
- Ghostty, Alacritty, Kitty (terminals)

### CLI Tools
- eza, fzf, zoxide, ripgrep, fd, bat, delta, btop, lazygit, lazydocker

### Applications
- Neovim (with LazyVim), Chromium
- LibreOffice, VLC, Nautilus
- Zoom, Signal, LocalSend
- Obsidian, Typora

### System
- XDG portals (already configured)
- PipeWire audio
- NetworkManager

---

## What to ADD for omarchy host

Only install things omarchy doesn't provide:
- **Gaming**: Steam, Gamescope, GameMode, MangoHud (via pacman)
- **Virtualization**: QEMU, libvirt, virt-manager, Firecracker (via pacman)
- **GPU/ROCm**: rocm-hip-sdk, ollama-rocm (via pacman)
- **Apps**: Slack, Spotify (with Spicetify), OBS Studio
- **Dev runtimes**: via mise (node, python, go, etc.)

---

## Core Components

| Category | Component |
|----------|-----------|
| Window Manager | Hyprland |
| Terminal | Ghostty (default), Alacritty, Kitty |
| Editor | Neovim (LazyVim) |
| Browser | Customized Chromium |
| Launcher | Walker |
| Status Bar | Waybar |
| Notifications | Mako |
| Lock Screen | Hyprlock |
| Idle Manager | Hypridle |

## CLI Tools Included

| Tool | Purpose |
|------|---------|
| fzf | Fuzzy finder |
| zoxide | Smart cd |
| ripgrep | Fast grep |
| fd | Fast find |
| bat | Better cat |
| eza | Better ls |
| delta | Better git diff |
| btop | System monitor |
| lazygit | Git TUI |

## Directory Structure

```
~/.local/share/omarchy/          # System files (DO NOT EDIT)
├── bin/
├── default/bash/
│   ├── rc, aliases, functions
│   ├── prompt, init, envs
├── config/
├── themes/
└── migrations/

~/.config/                       # User configuration
├── hypr/
│   ├── hyprland.conf
│   ├── bindings.conf
│   ├── monitors.conf
│   └── input.conf
├── waybar/
│   ├── config.jsonc
│   └── style.css
├── ghostty/config
├── walker/config.toml
└── omarchy/
    ├── current/theme/
    └── themes/
```

## Key Bindings

### Essential

| Hotkey | Function |
|--------|----------|
| `Super + Space` | Application launcher |
| `Super + Alt + Space` | Omarchy control menu |
| `Super + K` | Show all keybindings |
| `Super + Return` | Terminal |
| `Super + W` | Close window |
| `Super + F` | Full screen |

### Workspaces

| Hotkey | Function |
|--------|----------|
| `Super + 1/2/3/4` | Jump to workspace |
| `Super + Tab` | Next workspace |
| `Super + Shift + 1/2/3/4` | Move window to workspace |

### Applications

| Hotkey | Application |
|--------|-------------|
| `Super + Shift + B` | Browser |
| `Super + Shift + F` | File manager |
| `Super + Shift + N` | Neovim |
| `Super + Shift + O` | Obsidian |
| `Super + Shift + M` | Spotify |
| `Super + Shift + /` | 1Password |

### System

| Hotkey | Function |
|--------|----------|
| `Super + Escape` | Power menu |
| `Super + Ctrl + L` | Lock |
| `Super + Ctrl + A` | Audio controls |
| `Super + Ctrl + B` | Bluetooth |
| `Super + Ctrl + W` | WiFi |

## Shell Configuration

Omarchy uses Bash by default. Configuration chain:

```bash
~/.bashrc
└── sources ~/.local/share/omarchy/default/bash/rc
```

### Key Aliases

```bash
alias ls='eza -lh --group-directories-first --icons=auto'
alias ff="fzf --preview 'bat --style=numbers --color=always {}'"
alias g='git'
alias d='docker'
n() { nvim "${1:-.}" }
```

### Switching to Zsh

In Ghostty config (`~/.config/ghostty/config`):
```conf
command = /usr/bin/zsh
```

Source omarchy aliases in `.zshrc`:
```bash
source ~/.local/share/omarchy/default/bash/aliases
eval "$(zoxide init zsh)"
```

Note: This project uses **oh-my-zsh with robbyrussell theme** instead of starship for the prompt.

## Theme System

### Built-in Themes

Tokyo Night, Catppuccin, Nord, Kanagawa, Gruvbox, Dracula, Rose Pine, Everforest, One Dark, Monokai, Solarized

### Theme Files Structure

```
themes/<theme-name>/
├── colors.toml
├── backgrounds/
├── ghostty.conf
├── hyprland.conf
├── hyprlock.conf
├── waybar.css
├── neovim.lua
└── walker.css
```

### Theme Commands

| Hotkey | Function |
|--------|----------|
| `Super + Ctrl + Shift + Space` | Theme picker |
| `Super + Ctrl + Space` | Next background |

## Package Management

### Pacman

```bash
# Via menu
Super + Alt + Space > Install > Package

# Manual
sudo pacman -S <package>
```

### AUR

```bash
# Via menu
Super + Alt + Space > Install > AUR

# Uses yay
yay -S <package>
```

## Updates

```bash
# Via menu
Super + Alt + Space > Update > Omarchy
```

Updates:
1. Pull latest omarchy code
2. Run migrations
3. Update system packages
4. Update AUR packages

## Nix Home Manager Coexistence

### Protect Omarchy-managed directories

```nix
home.file.".config/omarchy".enable = false;
home.file.".config/hypr".enable = false;
```

### Ensure Nix in PATH

```bash
export PATH="$HOME/.nix-profile/bin:$PATH"
```

### Source Omarchy bash layer

```bash
if [ -f "$HOME/.local/share/omarchy/default/bash/rc" ]; then
    . "$HOME/.local/share/omarchy/default/bash/rc"
fi
```

## Patterns to Replicate in Nix

### Theme System

- Central `colors.toml` generates configs for all apps
- Symlinks connect active theme to app configs
- Single source of truth for colors

### Config Layering

- System defaults in managed directory
- User overrides in `~/.config/`
- Never modify system files

### Shell Configuration

- Modular sourcing (aliases, functions, envs)
- Tool initialization (starship, zoxide, fzf)
- zoxide integration for cd

### Keybinding Organization

- Separate `bindings.conf` from main config
- Super key as primary modifier
- Shift for apps, Ctrl for system

## Nix Equivalent Mapping

| Omarchy | Nix Home Manager |
|---------|------------------|
| `~/.local/share/omarchy/` | Nix store managed |
| `~/.config/` overrides | `home.file` |
| Theme system | colorscheme module |
| Shell aliases | `programs.zsh.shellAliases` |
| Keybindings | `wayland.windowManager.hyprland.settings` |
| Package installs | `home.packages` |

## Resources

- [GitHub](https://github.com/basecamp/omarchy)
- [Manual](https://learn.omacom.io/2/the-omarchy-manual)
- [DHH Blog Post](https://world.hey.com/dhh/get-in-losers-we-re-moving-to-linux-5e1b93cd)
