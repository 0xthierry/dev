#!/usr/bin/env bash
# Install Docker via pacman
set -euo pipefail
# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

configure_omarchy_docker_startup() {
  [[ "${SETUP_HOST:-}" == "omarchy" ]] || return 0

  if (( ${DRY_RUN:-0} )); then
    dry_run_cmd sudo systemctl enable docker.service
    log_item "Docker: start docker.service only if inactive or failed"
    return 0
  fi

  # Enable only the service: the packaged unit requires docker.socket.
  local enabled state
  enabled="$(systemctl show docker.service --property=UnitFileState --value)" || return
  if [[ "$enabled" != enabled ]]; then
    run_cmd sudo systemctl enable docker.service || return
  fi

  state="$(systemctl show docker.service --property=ActiveState --value)" || return
  case "$state" in
    inactive|failed)
      # Do not replace a conflicting job if a shutdown races this check.
      run_cmd sudo systemctl start --job-mode=fail docker.service ;;
    *) log_item "Docker: preserving $state engine" ;;
  esac
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

# Apply daemon/resource policy and boot startup without running full setup.
# An inactive or failed engine is started; a running engine is not restarted:
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
