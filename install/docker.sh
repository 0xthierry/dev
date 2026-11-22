#!/usr/bin/env bash
# Install Docker via pacman
set -euo pipefail
# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# This never connects to Docker: even `docker info` can socket-activate it.
configure_omarchy_docker_standby() {
  [[ "${SETUP_HOST:-}" == "omarchy" ]] || return 0

  # Disable without --now: a running engine and its workloads belong to the user.
  # Do not mask: Arch's rootful docker.service requires docker.socket (-H fd://).
  run_cmd sudo systemctl disable docker.service docker.socket

  local state=""
  if (( ${DRY_RUN:-0} )); then
    log_item "Docker standby: stop docker.socket only if docker.service is inactive or failed"
    return 0
  fi
  state="$(systemctl show docker.service --property=ActiveState --value)" || return
  case "$state" in
    inactive|failed)
      # Do not propagate a stop through Requires= if an explicit start races
      # this check. Never stop the engine, containerd, or live-restored containers.
      run_cmd sudo systemctl stop --job-mode=ignore-dependencies docker.socket
      ;;
    *) log_item "Docker: preserving $state engine and its socket until explicit shutdown" ;;
  esac
  log_item "Docker: manual startup only (sudo systemctl start docker.service)"
}

install_docker() {
  log_section "Docker"

  if ! command -v pacman &> /dev/null; then
    log_item "Skipping: not on Arch Linux"
    return 0
  fi

  if check_installed docker; then
    log_item "Docker: already installed"
  else
    log_item "Installing docker..."
    run_cmd sudo pacman -S --needed --noconfirm docker
  fi

  if [[ "${SETUP_HOST:-}" == "omarchy" ]]; then
    configure_omarchy_docker_policy
  elif systemctl is-enabled --quiet docker 2>/dev/null \
    && systemctl is-active --quiet docker 2>/dev/null; then
    log_item "Docker service: already enabled and running"
  else
    log_item "Enabling docker service..."
    run_cmd sudo systemctl enable --now docker
  fi

  if groups "$USER" | grep -q '\bdocker\b'; then
    log_item "User $USER: already in docker group"
  else
    log_item "Adding $USER to docker group..."
    run_cmd sudo usermod -aG docker "$USER"
    log_item "NOTE: Log out and back in for group changes to take effect"
  fi
}

# Targeted deployment, without full setup or a daemon restart:
#   bash install/docker.sh omarchy --policy-only --dry-run
#   bash install/docker.sh omarchy --policy-only
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  if [[ "${1:-}" != "omarchy" ]]; then
    printf 'Usage: %s omarchy [--policy-only] [--dry-run]\n' "$0" >&2
    exit 2
  fi
  SETUP_HOST=omarchy
  REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  policy_only=0
  shift
  for option in "$@"; do
    case "$option" in
      --policy-only) policy_only=1 ;;
      --dry-run) DRY_RUN=1 ;;
      *) printf 'Unknown option: %s\n' "$option" >&2; exit 2 ;;
    esac
  done
  # shellcheck source=install/hosts/omarchy.sh
  source "$REPO_ROOT/install/hosts/omarchy.sh"
  if (( policy_only )); then
    configure_omarchy_docker_policy
  else
    install_docker
  fi
fi
