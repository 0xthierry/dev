#!/usr/bin/env bash
# Install and configure Nix with flakes
set -e
source "$(dirname "$0")/lib.sh"

install_nix() {
  log_section "Nix Setup"

  if ! check_installed nix; then
    log_item "Installing Nix..."
    curl -L https://nixos.org/nix/install | sh -s -- --daemon

    if [ -e '/nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh' ]; then
      . '/nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh'
    fi
  else
    log_item "Nix: installed"
  fi

  # Enable flakes
  log_item "Enabling flakes..."
  mkdir -p ~/.config/nix
  if ! grep -q "experimental-features" ~/.config/nix/nix.conf 2>/dev/null; then
    echo "experimental-features = nix-command flakes" >> ~/.config/nix/nix.conf
  fi

  # Restart daemon if systemd available
  if command -v systemctl &> /dev/null; then
    sudo systemctl restart nix-daemon.service 2>/dev/null || true
  fi
}

apply_home_manager() {
  local host="$1"
  local repo_path="$2"

  log_section "Home Manager"
  log_item "Applying configuration for $host..."
  nix run "$repo_path#home-manager" -- switch --flake "$repo_path#$host"

  # Update PATH to include newly installed binaries
  export PATH="$HOME/.nix-profile/bin:$PATH"

  # Source home-manager session vars if available
  if [ -e "$HOME/.nix-profile/etc/profile.d/hm-session-vars.sh" ]; then
    . "$HOME/.nix-profile/etc/profile.d/hm-session-vars.sh"
  fi
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  install_nix
fi
