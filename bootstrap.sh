#!/usr/bin/env bash
set -e

# Change to script directory (repo root) for reliable paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Source shared library
source "$SCRIPT_DIR/install/lib.sh"

# Determine host
HOST=${1:-$(hostname)}
VALID_HOSTS="omarchy dev macbook"

if ! echo "$VALID_HOSTS" | grep -qw "$HOST"; then
  echo "Error: Unknown host '$HOST'"
  echo "Valid hosts: $VALID_HOSTS"
  exit 1
fi

echo "=== Bootstrapping Home Manager for $HOST ==="

# Source install scripts
source "$SCRIPT_DIR/install/nix.sh"
source "$SCRIPT_DIR/install/pacman.sh"
source "$SCRIPT_DIR/install/ai-cli.sh"
source "$SCRIPT_DIR/install/mise.sh"
source "$SCRIPT_DIR/install/hooks.sh"

# 1. Arch-specific packages (omarchy only)
if command -v pacman &> /dev/null && [ "$HOST" = "omarchy" ]; then
  install_gpu_packages
  install_aur_packages
fi

# 2. Install and configure Nix
install_nix

# 3. Apply Home Manager configuration
apply_home_manager "$HOST" "$SCRIPT_DIR"

# 4. Set zsh as default shell
log_section "Shell Configuration"
set_default_shell zsh

# 5. Install mise runtimes
install_runtimes

# 6. AI coding CLIs
install_ai_clis

# 7. Claude hooks dependencies
install_hooks "$SCRIPT_DIR"

echo ""
echo "=== Bootstrap complete! ==="
echo "Restart your shell or run: exec zsh"
