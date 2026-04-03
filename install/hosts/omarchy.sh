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

setup_host_machine_state() {
  log_section "Host Machine State"
  apply_host_configs
}

setup_post_host_state() {
  log_section "Post Host State"
  run_post_setup_tasks
}
