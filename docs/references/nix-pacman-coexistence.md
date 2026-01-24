# Nix and Pacman Coexistence on Arch Linux

## Overview

Use pacman for system-level packages (kernel, drivers, GPU) and Nix/home-manager for user applications and dotfiles.

## Installing Nix on Arch Linux

### Option A: Native Arch Package (Recommended)

```bash
# Install from official repos
sudo pacman -S nix

# Enable the daemon
sudo systemctl enable --now nix-daemon.service

# Add channel and update
nix-channel --add https://nixos.org/channels/nixpkgs-unstable
nix-channel --update
```

Add to PATH in shell config:
```bash
export PATH="$HOME/.nix-profile/bin:$PATH"
```

### Option B: Upstream Installer

```bash
curl -L https://nixos.org/nix/install | sh -s -- --daemon
```

### Enable Flakes

```bash
mkdir -p ~/.config/nix
echo "experimental-features = nix-command flakes" >> ~/.config/nix/nix.conf
sudo systemctl restart nix-daemon.service
```

## When to Use Pacman vs Nix

### Always Use Pacman For:

| Category | Examples | Reason |
|----------|----------|--------|
| Kernel & modules | `linux`, `linux-headers`, `dkms` | Must match running kernel |
| GPU drivers | `mesa`, `vulkan-radeon`, `nvidia` | Kernel module integration |
| ROCm/CUDA | `rocm-hip-sdk`, `cuda` | Tight kernel/driver coupling |
| Boot infrastructure | `grub`, `systemd-boot` | System-critical |
| Display servers | `xorg-server`, `wayland` | Deep system integration |
| System services | `networkmanager`, `pipewire` | Require systemd units |

### Use Nix For:

| Category | Examples | Reason |
|----------|----------|--------|
| CLI tools | `ripgrep`, `fd`, `bat`, `fzf` | Pure user-space |
| Development tools | Language servers, formatters | Isolated environments |
| Editors | `neovim`, `helix` | Complex plugin ecosystems |
| Dotfiles | via home-manager | Declarative configuration |

## ROCm Installation on Arch

ROCm requires tight kernel/driver integration. Always use pacman:

```bash
# Update system first
sudo pacman -Syu

# Install ROCm SDK packages
sudo pacman -S rocm-hip-sdk rocm-opencl-sdk

# For Vulkan support
sudo pacman -S vulkan-radeon lib32-vulkan-radeon

# Add user to required groups
sudo gpasswd -a $USER render
sudo gpasswd -a $USER video

# Environment variables
export ROCM_PATH=/opt/rocm
export HSA_OVERRIDE_GFX_VERSION=10.3.0  # RX 6000 series
# Use 11.0.0 for RX 7000 series
```

### Ollama with ROCm

```bash
# From AUR
paru -S ollama-rocm
```

## Home Manager on Arch Linux

### Installation

```bash
nix-channel --add https://github.com/nix-community/home-manager/archive/master.tar.gz home-manager
nix-channel --update
nix-shell '<home-manager>' -A install
```

### Arch-Specific Configuration

```nix
{ config, pkgs, ... }:

{
  # Critical for non-NixOS systems
  targets.genericLinux.enable = true;

  home.username = "youruser";
  home.homeDirectory = "/home/youruser";
  home.stateVersion = "24.05";

  # Fix locale issues
  home.sessionVariables = {
    LOCALE_ARCHIVE = "/usr/lib/locale/locale-archive";
  };

  # XDG integration
  xdg.enable = true;
  xdg.mime.enable = true;

  programs.home-manager.enable = true;
}
```

## Handling Conflicts

### PATH Priority

```bash
# Nix packages take priority
export PATH="$HOME/.nix-profile/bin:$PATH"

# Or pacman takes priority
export PATH="$PATH:$HOME/.nix-profile/bin"
```

### OpenGL/Vulkan (GUI Apps)

Nix GUI apps cannot find system GPU drivers. Use NixGL:

```bash
# Install NixGL
nix-channel --add https://github.com/nix-community/nixGL/archive/main.tar.gz nixgl
nix-channel --update
nix-env -iA nixgl.auto.nixGLDefault

# Run GPU apps with wrapper
nixGL alacritty
```

## Best Practices

1. **System-level = pacman, user-level = nix**
2. **Never install same package from both**
3. **Use home-manager for declarative user config**
4. **Wrap GPU apps with NixGL on non-NixOS**
5. **Document your package source choices**

## Recommended Architecture

```
/etc/pacman.conf          # System packages
├── base, base-devel
├── linux, linux-headers
├── mesa, vulkan-radeon
├── rocm-hip-sdk
├── pipewire, wireplumber
└── networkmanager

~/.config/home-manager/   # User packages (nix)
├── flake.nix
└── home.nix
    ├── programs.git
    ├── programs.neovim
    ├── programs.zsh
    └── home.packages = [ ripgrep fd bat ... ]
```

## Maintenance Workflow

```bash
# System updates (weekly)
sudo pacman -Syu

# Nix updates (when needed)
nix flake update
home-manager switch

# Garbage collection (monthly)
nix-collect-garbage -d
```

## Common Pitfalls

| Pitfall | Solution |
|---------|----------|
| Installing `mesa` from nix | Use system mesa, wrap with NixGL |
| ROCm/CUDA from nixpkgs | Use pacman |
| Duplicate shells | Pick one; let home-manager manage it |
| Forgetting `targets.genericLinux.enable` | Always set for Arch |
| LOCALE_ARCHIVE errors | Export system locale path |
