#!/usr/bin/env bash

# shellcheck disable=SC2034
HOST_ENV_VARS=(
  "TZ=America/Sao_Paulo"
  "LANG=en_US.UTF-8"
  "LC_ALL=en_US.UTF-8"
)

# shellcheck disable=SC2034
HOST_SSH_INCLUDE_LINES=(
  "Include ~/dev/configs/linux/ssh.conf"
)

HOST_WORK_DIRS=(
  "$HOME/Work/Sideprojects"
  "$HOME/Work/Meistrari"
)

# shellcheck disable=SC2034
HOST_CONFIG_TARGETS=(
  nvim
  ghostty
  herdr
  agents
)

# shellcheck disable=SC2034
HOST_BREW_CASKS=(
  bambu-studio
  bitwarden
  brave-browser
  chatgpt
  claude
  conductor
  cursor
  dbeaver-community
  devin-desktop
  discord
  figma
  ghostty
  grok-bot
  handy
  linear
  obs
  obsidian
  orbstack
  rectangle
  slack
  signal
  spotify
  steam
  t3-code
  tailscale-app
  telegram
  zed
)


apply_macos_defaults() {
  log_section "macOS Defaults"

  log_item "Disabling native window tiling (using Rectangle instead)"
  run_cmd defaults write com.apple.WindowManager EnableTilingByEdgeDrag -bool false
  run_cmd defaults write com.apple.WindowManager EnableTopTilingByEdgeDrag -bool false
  run_cmd defaults write com.apple.WindowManager EnableTilingOptionAccelerator -bool false
  run_cmd defaults write com.apple.WindowManager EnableTiledWindowMargins -bool false

  log_item "Enabling Rectangle launch at login"
  run_cmd defaults write com.knollsoft.Rectangle launchOnLogin -bool true

  log_item "Setting default browser to Brave (may prompt for confirmation)"
  run_cmd open -a "Brave Browser" --args --make-default-browser
}

setup_host_prereqs() {
  log_section "Host Prerequisites"
  log_item "Preparing macbook host prerequisites"
}

setup_host_packages() {
  log_section "Host Packages"
  log_item "Installing shared CLI package set for macbook"
  setup_shared_cli_packages
  upgrade_brew_casks_to_latest chatgpt claude grok-bot
}

setup_shared_machine_state() {
  log_section "Shared Machine State"
  apply_shared_machine_state
}


setup_host_machine_state() {
  log_section "Host Machine State"
  apply_macos_defaults
  apply_host_configs
  create_host_work_dirs
}

setup_post_host_state() {
  log_section "Post Host State"
  run_post_setup_tasks
}
