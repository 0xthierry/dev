#!/usr/bin/env bash
set -e

# Change to script directory (repo root) for reliable paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

HOST=${1:-$(hostname)}

# Validate HOST against known configurations
VALID_HOSTS="omarchy dev macbook"
if ! echo "$VALID_HOSTS" | grep -qw "$HOST"; then
  echo "Error: Unknown host '$HOST'"
  echo "Valid hosts: $VALID_HOSTS"
  exit 1
fi

echo "=== Bootstrapping Home Manager for $HOST ==="

# 1. Arch-specific packages via pacman (omarchy only)
if command -v pacman &> /dev/null && [ "$HOST" = "omarchy" ]; then
  echo "Installing GPU packages via pacman..."
  sudo pacman -S --needed --noconfirm \
    rocm-hip-sdk \
    rocm-opencl-sdk \
    vulkan-radeon

  # Desktop apps via AUR (NixGL issues with Nix GUI apps on Arch)
  echo "Installing desktop apps via AUR..."
  if command -v paru &> /dev/null; then
    paru -S --needed --noconfirm ollama-rocm slack-desktop spotify obsidian signal-desktop obs-studio
  elif command -v yay &> /dev/null; then
    yay -S --needed --noconfirm ollama-rocm slack-desktop spotify obsidian signal-desktop obs-studio
  else
    echo "Note: Install desktop apps manually from AUR (slack, spotify, obsidian, signal, obs-studio)"
  fi
fi

# 2. Install Nix (if not present)
if ! command -v nix &> /dev/null; then
  echo "Installing Nix..."
  curl -L https://nixos.org/nix/install | sh -s -- --daemon

  # Source nix for current session
  if [ -e '/nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh' ]; then
    . '/nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh'
  fi
fi

# 3. Enable flakes
echo "Enabling Nix flakes..."
mkdir -p ~/.config/nix
if ! grep -q "experimental-features" ~/.config/nix/nix.conf 2>/dev/null; then
  echo "experimental-features = nix-command flakes" >> ~/.config/nix/nix.conf
fi

# Restart nix-daemon to pick up config (systemd)
if command -v systemctl &> /dev/null; then
  sudo systemctl restart nix-daemon.service 2>/dev/null || true
fi

# 4. Apply Home Manager config (using pinned flake inputs)
echo "Applying Home Manager configuration for $HOST..."
nix run .#home-manager -- switch --flake ".#$HOST"

# 5. Install mise runtimes
if command -v mise &> /dev/null; then
  echo "Installing language runtimes via mise..."
  mise install
fi

# 6. Install claude hook dependencies (omarchy only)
if [ "$HOST" = "omarchy" ] && [ -d "$SCRIPT_DIR/configs/claude/hooks" ]; then
  echo "Installing claude hook dependencies..."
  cd "$SCRIPT_DIR/configs/claude/hooks" && bun install
  cd "$SCRIPT_DIR"
fi

echo ""
echo "=== Bootstrap complete! ==="
echo "Restart your shell or run: exec zsh"
