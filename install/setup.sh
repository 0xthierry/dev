#!/usr/bin/env bash

load_host_module() {
  local repo_root="$1"
  local host="$2"

  # shellcheck source=install/hosts/common.sh
  source "$repo_root/install/hosts/common.sh"
  # shellcheck disable=SC1090
  source "$repo_root/install/hosts/${host}.sh"
}

run_setup() {
  local repo_root="$1"
  local host="$2"
  local dry_run="$3"
  local skip_git_repo_sync="${4:-0}"

  export REPO_ROOT="$repo_root"
  export SETUP_HOST="$host"
  export DRY_RUN="$dry_run"
  export SKIP_GIT_REPO_SYNC="$skip_git_repo_sync"

  load_host_module "$repo_root" "$host"

  log_section "Setup"
  log_item "Host: $host"

  if (( dry_run )); then
    log_item "Mode: dry-run"
  fi

  setup_host_prereqs
  setup_host_packages
  setup_shared_machine_state
  setup_host_machine_state
  setup_post_host_state
}
