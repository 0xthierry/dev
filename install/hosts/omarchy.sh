#!/usr/bin/env bash

# shellcheck disable=SC2034
HOST_ENV_VARS=(
  "OLLAMA_HOST=0.0.0.0:11434"
)

# shellcheck disable=SC2034
HOST_CONFIG_TARGETS=(
  nvim
  zellij
  hypr
  ghostty
  agents
)

# shellcheck disable=SC2034
HOST_PACMAN_PACKAGES=(
  bitwarden
  dbeaver
  discord
  ghostty
  obsidian
  steam
  tailscale
  telegram-desktop
)

# shellcheck disable=SC2034
HOST_AUR_PACKAGES=(
  bambustudio-bin
  brave-bin
  figma-linux
  linear-desktop-bin
  slack-desktop
  spotify
)

setup_host_prereqs() {
  log_section "Host Prerequisites"
  log_item "Preparing omarchy host prerequisites"
}

setup_host_packages() {
  log_section "Host Packages"
  log_item "Installing shared CLI package set for omarchy"
  setup_shared_cli_packages
  install_zed_linux
  log_item "Skipping unsupported Omarchy apps: ChatGPT, Claude desktop, Codex.app, Rectangle"
}

setup_shared_machine_state() {
  log_section "Shared Machine State"
  apply_shared_machine_state
}

set_default_browser_brave() {
  log_section "Default Browser"

  if ! check_installed xdg-settings; then
    log_item "xdg-settings not available, skipping"
    return 0
  fi

  log_item "Setting default browser to Brave"
  run_cmd xdg-settings set default-web-browser brave-browser.desktop
}

setup_host_machine_state() {
  log_section "Host Machine State"
  set_default_browser_brave
  apply_host_configs
}

setup_post_host_state() {
  log_section "Post Host State"
  run_post_setup_tasks
}
