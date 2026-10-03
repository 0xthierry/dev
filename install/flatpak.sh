#!/usr/bin/env bash

# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

install_flatpak_apps() {
  local app=""

  (( $# > 0 )) || return 0
  log_section "Flatpak Apps"

  if (( ! ${DRY_RUN:-0} )) && ! check_installed flatpak; then
    printf 'error: flatpak is required; install the host packages first\n' >&2
    return 1
  fi

  # Keep app installs and the remote in the same, unprivileged user scope.
  # Existing remotes, app data, and permissions are never replaced.
  run_cmd flatpak remote-add --user --if-not-exists flathub \
    https://flathub.org/repo/flathub.flatpakrepo || return $?

  for app in "$@"; do
    if (( ! ${DRY_RUN:-0} )) && flatpak info --user "$app" >/dev/null 2>&1; then
      log_item "$app: already installed"
      continue
    fi
    run_cmd flatpak install --user --noninteractive --assumeyes flathub "$app" || return $?
  done
}
