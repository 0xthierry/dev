# Nix Home Manager Project Documentation

Reference documentation for implementing a reproducible dev environment using Nix Home Manager on Arch Linux.

## Reference Documents

### Core Setup
| Document | Description |
|----------|-------------|
| [Nix Flakes + Home Manager](./references/nix-flakes-home-manager.md) | Flake structure, multi-machine setup, commands |
| [Nix + Pacman](./references/nix-pacman-coexistence.md) | Hybrid package management on Arch |
| [Symlink Strategies](./references/home-manager-symlinks.md) | mkOutOfStoreSymlink, config management |

### Shell & Tools
| Document | Description |
|----------|-------------|
| [Zsh Configuration](./references/home-manager-zsh.md) | Oh-my-zsh, robbyrussell, plugins, aliases |
| [Git Configuration](./references/home-manager-git.md) | User settings, aliases, delta integration |
| [CLI Tools](./references/home-manager-cli-tools.md) | eza, fzf, bat, ripgrep, zoxide, lazygit |
| [Mise Integration](./references/mise-integration.md) | Runtime version management (node, python, go, etc.) |

### Desktop Environment (omarchy)
| Document | Description |
|----------|-------------|
| [Hyprland Setup](./references/home-manager-hyprland.md) | Waybar, hyprlock, hypridle |
| [XDG Portals](./references/xdg-portals.md) | Portal setup for screen share, file dialogs |
| [Desktop Apps](./references/desktop-apps.md) | Obsidian, Signal, Slack, Spotify, OBS |
| [Gaming](./references/gaming.md) | Steam, Gamescope, MangoHud, GameMode |
| [Virtualization](./references/virtualization.md) | QEMU, libvirt, virt-manager, Firecracker |

### Reference
| Document | Description |
|----------|-------------|
| [Omarchy Reference](./references/omarchy-reference.md) | Patterns to replicate from omarchy |

## Finding More Information

### Official Documentation

| Resource | URL | Use For |
|----------|-----|---------|
| **Home Manager Manual** | https://nix-community.github.io/home-manager/ | Official reference, all options |
| **Home Manager Options Search** | https://home-manager-options.extranix.com/ | Search specific options by name |
| **MyNixOS Options** | https://mynixos.com/home-manager/options | Alternative options browser |
| **NixOS & Flakes Book** | https://nixos-and-flakes.thiscute.world/ | Practical tutorials and examples |
| **NixOS Wiki** | https://wiki.nixos.org/ | Community knowledge base |
| **Nix Packages Search** | https://search.nixos.org/packages | Find package names |

### Searching for Home Manager Options

```bash
# Search options in browser
# https://home-manager-options.extranix.com/?query=programs.git

# Or use nix to search locally
nix-env -qaP '.*home-manager.*'
```

### Common Search Patterns

| Looking For | Search Query |
|-------------|--------------|
| Git options | `programs.git` |
| Zsh options | `programs.zsh` |
| Any program | `programs.<name>` |
| Services | `services.<name>` |
| XDG settings | `xdg.` |
| Hyprland | `wayland.windowManager.hyprland` |

### Community Resources

| Resource | URL |
|----------|-----|
| **NixOS Discourse** | https://discourse.nixos.org/ |
| **r/NixOS** | https://reddit.com/r/NixOS |
| **Nix Community GitHub** | https://github.com/nix-community |
| **Home Manager Issues** | https://github.com/nix-community/home-manager/issues |

### Example Configurations

Search GitHub for real-world configs:

```
# GitHub search queries
"home-manager" "hyprland" filename:home.nix
"programs.zsh" "oh-my-zsh" filename:flake.nix
"mkOutOfStoreSymlink" filename:home.nix
```

Notable public configs:
- [Misterio77/nix-config](https://github.com/Misterio77/nix-config)
- [jnsgruk/nixos-config](https://github.com/jnsgruk/nixos-config)
- [Evertras/simple-homemanager](https://github.com/Evertras/simple-homemanager)

### Arch Linux + Nix Specific

| Resource | URL |
|----------|-----|
| **Arch Wiki - Nix** | https://wiki.archlinux.org/title/Nix |
| **NixGL (GPU wrappers)** | https://github.com/nix-community/nixGL |
| **Chaotic-AUR for Nix** | https://github.com/chaotic-cx/nyx |

## Project Context

These docs support the implementation plan in `ai_docs/brainstorm/2026-01-24-nix-home-manager-design.md`.

### Target Machines

| Machine | OS | Purpose |
|---------|-----|---------|
| **omarchy** | Arch Linux | Desktop with Hyprland, full dev setup |
| **dev** | Arch Linux | VM for remote development, minimal |
| **macbook** | macOS | Future stub |

### Key Decisions

| Config | Approach | Reason |
|--------|----------|--------|
| nvim | Symlink | lazy.nvim manages plugins |
| claude | Symlink | Complex hooks needing bun install |
| zellij | Symlink | Custom keybindings in KDL |
| hypr | Symlink | Complex omarchy defaults |
| zsh | Home Manager | Plugins, aliases easy in Nix |
| git | Home Manager | Simple config |
| CLI tools | Nix | home.packages |
| Runtimes | mise | Per-project versions |
| GPU/ROCm | pacman | Kernel coupling |

## Usage During Development

1. **Starting a module**: Check relevant reference doc for options
2. **Unknown option**: Search at home-manager-options.extranix.com
3. **Debugging**: Check [Nix + Pacman](./references/nix-pacman-coexistence.md) for pitfalls
4. **Real examples**: Search GitHub for `filename:home.nix` patterns
5. **Omarchy patterns**: See [Omarchy Reference](./references/omarchy-reference.md)
