#!/usr/bin/env bash
# Install the mandatory REA runtime prerequisites, not optional analysis engines.
# Node is installed alongside the shared runtime; never change mise's global selection.
set -euo pipefail
# shellcheck source=install/pacman.sh
source "$(dirname "${BASH_SOURCE[0]}")/pacman.sh"

REA_NODE_VERSION="26.12.0"

install_rea_prereqs() {
  local host="${1:-}" mise_bin="mise"
  case "$host" in
    dev|omarchy|macbook) ;;
    *) printf 'error: REA prerequisites require dev, omarchy, or macbook\n' >&2; return 1 ;;
  esac
  log_section "REA Prerequisites"
  if (( ! ${DRY_RUN:-0} )); then
    if [[ "$host" == macbook && "$(uname -s)" != Darwin ]] ||
       [[ "$host" != macbook && "$(uname -s)" != Linux ]]; then
      printf 'error: REA host does not match this operating system\n' >&2
      return 1
    fi
    if ! mise_bin="$(resolve_mise_bin)"; then
      printf 'error: mise is required; run ./setup.sh %s to install the declared package first\n' "$host" >&2
      return 1
    fi
  fi
  if [[ "$host" != macbook ]]; then
    if (( ${DRY_RUN:-0} )) || ! pacman -Q "${REA_PACMAN_PACKAGES[@]}" >/dev/null 2>&1; then
      install_pacman_packages "${REA_PACMAN_PACKAGES[@]}" || return
    fi
    if (( ! ${DRY_RUN:-0} )) && ! ps -p "$$" -o pid= -o lstart= >/dev/null; then
      printf 'error: REA requires a procps-compatible ps on PATH\n' >&2
      return 1
    fi
  fi
  run_cmd "$mise_bin" install "node@$REA_NODE_VERSION" || return
  log_item "REA Node $REA_NODE_VERSION installed without changing the global Node selection"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  DRY_RUN=0
  if [[ $# -eq 2 && "$2" == --dry-run ]]; then DRY_RUN=1
  elif [[ $# -ne 1 ]]; then
    printf 'Usage: bash install/rea-prereqs.sh <dev|macbook|omarchy> [--dry-run]\n' >&2
    exit 1
  fi
  install_rea_prereqs "$1"
fi
