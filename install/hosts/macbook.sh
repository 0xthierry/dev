#!/usr/bin/env bash

# shellcheck disable=SC2034
HOST_ENV_VARS=(
  "TZ=America/Sao_Paulo"
  "LANG=en_US.UTF-8"
  "LC_ALL=en_US.UTF-8"
)

# shellcheck disable=SC2034
HOST_WORK_DIRS=(
  "$HOME/Work/Sideprojects"
  "$HOME/Work/Meistrari"
)

# shellcheck disable=SC2034
HOST_CONFIG_TARGETS=(
  nvim
  zellij
  agents
)

# shellcheck disable=SC2034
HOST_BREW_CASKS=(
  brave-browser
  ghostty
)

setup_host_prereqs() {
  log_section "Host Prerequisites"
  log_item "Preparing macbook host prerequisites"
}

setup_host_packages() {
  log_section "Host Packages"
  log_item "Installing shared CLI package set for macbook"
  setup_shared_cli_packages
}

setup_shared_machine_state() {
  log_section "Shared Machine State"
  apply_shared_machine_state
}

setup_host_machine_state() {
  log_section "Host Machine State"
  apply_host_configs
  create_host_work_dirs
}

setup_post_host_state() {
  log_section "Post Host State"
  run_post_setup_tasks
}
