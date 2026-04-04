#!/usr/bin/env bash

source "$REPO_ROOT/install/pacman.sh"
source "$REPO_ROOT/install/brew.sh"
source "$REPO_ROOT/install/codex-app.sh"
source "$REPO_ROOT/install/zed.sh"
source "$REPO_ROOT/install/configs.sh"
source "$REPO_ROOT/install/env.sh"
source "$REPO_ROOT/install/shell.sh"
source "$REPO_ROOT/install/git.sh"
source "$REPO_ROOT/install/ssh.sh"
source "$REPO_ROOT/install/mise.sh"
source "$REPO_ROOT/install/ai-cli.sh"
source "$REPO_ROOT/install/docker.sh"
source "$REPO_ROOT/install/tools.sh"
source "$REPO_ROOT/install/hooks.sh"

HOST_ENV_VARS=()
# shellcheck disable=SC2034
HOST_SSH_CONFIG_LINES=()
HOST_WORK_DIRS=()
HOST_CONFIG_TARGETS=()
# shellcheck disable=SC2034
HOST_PACMAN_PACKAGES=()
# shellcheck disable=SC2034
HOST_AUR_PACKAGES=()
# shellcheck disable=SC2034
HOST_BREW_CASKS=()

array_values() {
  local var_name="$1"
  eval "printf '%s\n' \"\${${var_name}[@]-}\""
}

setup_shared_cli_packages() {
  local -a host_brew_casks=()
  local -a host_pacman_packages=()
  local -a host_aur_packages=()

  while IFS= read -r value; do
    [[ -n "$value" ]] && host_brew_casks+=("$value")
  done < <(array_values HOST_BREW_CASKS)

  while IFS= read -r value; do
    [[ -n "$value" ]] && host_pacman_packages+=("$value")
  done < <(array_values HOST_PACMAN_PACKAGES)

  while IFS= read -r value; do
    [[ -n "$value" ]] && host_aur_packages+=("$value")
  done < <(array_values HOST_AUR_PACKAGES)

  if [[ "$SETUP_HOST" == "macbook" ]]; then
    install_homebrew
    install_common_brew_formulae
    install_brew_casks "${host_brew_casks[@]}"
    return 0
  fi

  install_common_pacman_packages
  install_pacman_packages "${host_pacman_packages[@]}"
  install_aur_packages "${host_aur_packages[@]}"
}

apply_shared_machine_state() {
  apply_tool_configs
  write_env_file
  apply_shell_setup
  write_git_files
  write_ssh_config
  install_runtimes
  install_ai_clis

  if [[ "$SETUP_HOST" != "macbook" ]]; then
    install_docker
  fi
}

create_host_work_dirs() {
  local dir_path=""

  if [[ ${#HOST_WORK_DIRS[@]} -eq 0 ]]; then
    return 0
  fi

  for dir_path in "${HOST_WORK_DIRS[@]}"; do
    ensure_dir "$dir_path"
    log_item "Work directory: $dir_path"
  done
}

apply_host_configs() {
  local target=""

  for target in "${HOST_CONFIG_TARGETS[@]}"; do
    case "$target" in
      nvim)
        apply_nvim
        ;;
      zellij)
        apply_zellij
        ;;
      hypr)
        apply_hypr
        ;;
      agents)
        apply_agents
        ;;
      *)
        log_item "Unknown config target: $target"
        ;;
    esac
  done
}

run_post_setup_tasks() {
  "$REPO_ROOT/scripts/clone-repos.sh"
  install_hooks "$REPO_ROOT"
  install_agent_review_tools "$REPO_ROOT"
}

setup_host_prereqs() { :; }
setup_host_packages() { :; }
setup_shared_machine_state() { :; }
setup_host_machine_state() { :; }
setup_post_host_state() { :; }
