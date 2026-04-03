#!/usr/bin/env bash

# shellcheck disable=SC2034
HOST_ENV_VARS=(
  "OLLAMA_HOST=http://172.16.0.1:11434"
  "TZ=America/Sao_Paulo"
  "LANG=en_US.UTF-8"
  "LC_ALL=en_US.UTF-8"
)

# shellcheck disable=SC2034
HOST_SSH_CONFIG_LINES=(
  "Host github.com"
  "  HostName github.com"
  "  User git"
  "  IdentityFile ~/.ssh/id_ed25519_github_vm"
  "  IdentitiesOnly yes"
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

setup_host_prereqs() {
  log_section "Host Prerequisites"
  log_item "Preparing dev host prerequisites"
}

setup_host_packages() {
  log_section "Host Packages"
  log_item "Installing shared CLI package set for dev"
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
