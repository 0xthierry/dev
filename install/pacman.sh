#!/usr/bin/env bash
# Install Arch/pacman packages (GPU, desktop apps, gaming, system tools)
set -euo pipefail
# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/packages/common.sh"

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
  install_pacman_packages "${GPU_PACKAGES[@]}"
}

install_desktop_packages() {
  log_section "Desktop Packages (pacman)"
  install_pacman_packages "${DESKTOP_PACKAGES[@]}"
}

install_gaming_packages() {
  log_section "Gaming Packages (pacman)"
  install_pacman_packages "${GAMING_PACKAGES[@]}"
}

install_system_packages() {
  log_section "System Packages (pacman)"
  install_pacman_packages "${SYSTEM_PACKAGES[@]}"
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
  run_cmd "$aur_helper" -S --needed --noconfirm "${AUR_PACKAGES[@]}"
}

install_pacman_packages() {
  local -a packages=("$@")

  if [[ ${#packages[@]} -eq 0 ]]; then
    return 0
  fi

  if ! (( ${DRY_RUN:-0} )) && ! command -v pacman &> /dev/null; then
    log_item "Skipping: pacman not available"
    return 0
  fi

  log_item "Installing: ${packages[*]}"
  run_cmd sudo pacman -S --needed --noconfirm "${packages[@]}"
}

install_common_pacman_packages() {
  log_section "Shared CLI Packages (pacman)"
  install_pacman_packages "${COMMON_PACMAN_PACKAGES[@]}" "${COMMON_PACMAN_LINUX_PACKAGES[@]}"
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  install_gpu_packages
  install_desktop_packages
  install_gaming_packages
  install_system_packages
  install_aur_packages
fi
