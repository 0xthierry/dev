#!/usr/bin/env bash
# Install Arch/pacman packages (GPU, desktop apps, gaming, system tools)
set -e
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# GPU packages (official repos)
GPU_PACKAGES=(
  rocm-hip-sdk
  rocm-opencl-sdk
  vulkan-radeon
)

# AUR packages (not shipped by Omarchy)
AUR_PACKAGES=(
  ollama-rocm
  slack-desktop
  beekeeper-studio-bin
  cursor-bin
  google-chrome
  kavita-bin
  proton-ge-custom-bin
)

# Desktop apps from official repos (not shipped by Omarchy)
DESKTOP_PACKAGES=(
  bitwarden
  dbeaver
)

# Gaming stack
GAMING_PACKAGES=(
  steam
  lutris
  gamescope
  gamemode
  lib32-gamemode
  protontricks
  mangohud
  lib32-mangohud
)

# System tools
SYSTEM_PACKAGES=(
  tailscale
  ngrok
  valkey
  tmux
  docker-buildx
  docker-compose
  cups
  cups-browsed
  cups-filters
  cups-pdf
  ufw
  ufw-docker
)

install_gpu_packages() {
  log_section "GPU Packages (pacman)"

  if ! command -v pacman &> /dev/null; then
    log_item "Skipping: not on Arch Linux"
    return 0
  fi

  log_item "Installing: ${GPU_PACKAGES[*]}"
  sudo pacman -S --needed --noconfirm "${GPU_PACKAGES[@]}"
}

install_desktop_packages() {
  log_section "Desktop Packages (pacman)"

  if ! command -v pacman &> /dev/null; then
    log_item "Skipping: not on Arch Linux"
    return 0
  fi

  log_item "Installing: ${DESKTOP_PACKAGES[*]}"
  sudo pacman -S --needed --noconfirm "${DESKTOP_PACKAGES[@]}"
}

install_gaming_packages() {
  log_section "Gaming Packages (pacman)"

  if ! command -v pacman &> /dev/null; then
    log_item "Skipping: not on Arch Linux"
    return 0
  fi

  log_item "Installing: ${GAMING_PACKAGES[*]}"
  sudo pacman -S --needed --noconfirm "${GAMING_PACKAGES[@]}"
}

install_system_packages() {
  log_section "System Packages (pacman)"

  if ! command -v pacman &> /dev/null; then
    log_item "Skipping: not on Arch Linux"
    return 0
  fi

  log_item "Installing: ${SYSTEM_PACKAGES[*]}"
  sudo pacman -S --needed --noconfirm "${SYSTEM_PACKAGES[@]}"
}

install_aur_packages() {
  log_section "AUR Packages"

  local aur_helper
  aur_helper=$(get_aur_helper)

  if [ -z "$aur_helper" ]; then
    log_item "WARNING: No AUR helper found (paru/yay)"
    log_item "Install manually: ${AUR_PACKAGES[*]}"
    return 0
  fi

  log_item "Using $aur_helper for: ${AUR_PACKAGES[*]}"
  "$aur_helper" -S --needed --noconfirm "${AUR_PACKAGES[@]}"
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  install_gpu_packages
  install_desktop_packages
  install_gaming_packages
  install_system_packages
  install_aur_packages
fi
