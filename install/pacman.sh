#!/usr/bin/env bash
# Install Arch/pacman packages (GPU, AUR apps)
set -e
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# GPU packages (official repos)
GPU_PACKAGES=(
  rocm-hip-sdk
  rocm-opencl-sdk
  vulkan-radeon
)

# Desktop apps (AUR)
AUR_PACKAGES=(
  ollama-rocm
  slack-desktop
  spotify
  obsidian
  signal-desktop
  obs-studio
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

install_aur_packages() {
  log_section "AUR Packages"

  local aur_helper
  aur_helper=$(get_aur_helper)

  if [ -z "$aur_helper" ]; then
    log_item "No AUR helper found (paru/yay)"
    log_item "Install manually: ${AUR_PACKAGES[*]}"
    return 1
  fi

  log_item "Using $aur_helper for: ${AUR_PACKAGES[*]}"
  "$aur_helper" -S --needed --noconfirm "${AUR_PACKAGES[@]}"
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  install_gpu_packages
  install_aur_packages
fi
