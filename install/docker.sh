#!/usr/bin/env bash
# Install Docker via pacman
set -e
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

install_docker() {
  log_section "Docker"

  if ! command -v pacman &> /dev/null; then
    log_item "Skipping: not on Arch Linux"
    return 0
  fi

  if check_installed docker; then
    log_item "Docker: already installed"
  else
    log_item "Installing docker..."
    sudo pacman -S --needed --noconfirm docker
  fi

  log_item "Enabling docker service..."
  sudo systemctl enable --now docker

  if groups "$USER" | grep -q '\bdocker\b'; then
    log_item "User $USER: already in docker group"
  else
    log_item "Adding $USER to docker group..."
    sudo usermod -aG docker "$USER"
    log_item "NOTE: Log out and back in for group changes to take effect"
  fi
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  install_docker
fi
