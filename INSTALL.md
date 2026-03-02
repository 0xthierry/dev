# Fresh Install Guide

## Prerequisites

This guide assumes a fresh Omarchy install, which provides:
- `yay` (AUR helper), `git`, `zsh`, `neovim`, `docker`
- 1Password (GUI + CLI), Ghostty, Chromium, and other desktop apps
- Base development tools (`base-devel`, `mise`, `starship`, etc.)

## Step 1: Set up 1Password + SSH

1. Open 1Password from the app launcher and sign in
2. Enable the SSH agent: **Settings → Developer → SSH Agent → Enable**
3. Add to `~/.ssh/config` (create if needed):
   ```
   Host *
     IdentityAgent ~/.1password/agent.sock
   ```
4. Verify: `ssh -T git@github.com` should authenticate

## Step 2: Clone this repo

```bash
git clone git@github.com:0xthierry/dev.git ~/dev
```

The repo **must** be at `~/dev` — the flake hardcodes this path.

## Step 3: Run bootstrap

```bash
cd ~/dev
./bootstrap.sh omarchy
```

This will:
1. Install GPU packages (ROCm), desktop apps, gaming stack, system tools via pacman
2. Install AUR packages (ollama-rocm, slack, chrome, cursor, etc.)
3. Install and configure Docker
4. Install Nix with flakes enabled
5. Apply Home Manager configuration (CLI tools, shell, git, symlinks)
6. Set zsh as default shell
7. Install language runtimes via mise (node, python, go, bun, rust, zig, aws)
8. Install AI coding CLIs (codex, gemini)
9. Install Claude hooks dependencies (bun install)

## Step 4: Restart shell

```bash
exec zsh
```

## Step 5: Verify

```bash
home-manager --version    # Home Manager installed
mise current              # Runtimes installed
nvim --version            # Neovim working
ls -la ~/.config/nvim     # Symlink to ~/dev/configs/nvim
ls -la ~/.claude          # Symlink to ~/dev/configs/claude
ls -la ~/.config/zellij   # Symlink to ~/dev/configs/zellij
ls -la ~/.config/hypr     # Symlink to ~/dev/configs/hypr
```

## Troubleshooting

**AUR helper not found:** Omarchy ships `yay`. If missing, install manually:
```bash
sudo pacman -S --needed git base-devel
git clone https://aur.archlinux.org/yay.git /tmp/yay && cd /tmp/yay && makepkg -si
```

**Nix daemon not running:** `sudo systemctl restart nix-daemon.service`

**Home Manager switch fails:** Check `nix flake check` in the repo for syntax errors.

**Locale warnings:** Ensure `en_US.UTF-8` is generated: `sudo locale-gen`
