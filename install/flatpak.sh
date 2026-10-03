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

refresh_flatpak_launchers() {
  local environment data_dirs installations path entry service
  log_section "Flatpak Launcher Integration"
  if (( ${DRY_RUN:-0} )); then
    log_item "Would add Flatpak export directories to the user-session XDG_DATA_DIRS"
    log_item "Would restart active Elephant and Walker services (no logout needed)"
    return 0
  fi

  # A first Flatpak install cannot update the environment of an existing
  # graphical session. Preserve the manager's paths, including custom entries.
  if ! environment=$(systemctl --user show-environment 2>/dev/null); then
    log_item "No user service manager available; log out and back in to expose Flatpak apps"
    return 0
  fi
  data_dirs="${XDG_DATA_DIRS:-/usr/local/share:/usr/share}"
  while IFS= read -r entry; do
    if [[ "$entry" == XDG_DATA_DIRS=* ]]; then
      data_dirs="${entry#XDG_DATA_DIRS=}"
      break
    fi
  done <<< "$environment"
  data_dirs="${data_dirs:-/usr/local/share:/usr/share}"
  installations=$(flatpak --installations) || return $?
  while IFS= read -r path; do
    [[ -n "$path" ]] || continue
    path="${path%/}/exports/share"
    case ":$data_dirs:" in
      *":$path:"*|*":$path/:"*) ;;
      *) data_dirs="$data_dirs:$path" ;;
    esac
  done <<< "${XDG_DATA_HOME:-$HOME/.local/share}/flatpak
$installations"

  run_cmd systemctl --user set-environment "XDG_DATA_DIRS=$data_dirs" || return $?
  for service in elephant.service app-walker@autostart.service; do
    if systemctl --user is-active --quiet "$service"; then
      run_cmd systemctl --user restart "$service" || return $?
    fi
  done
}
