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
    if (( ${DRY_RUN:-0} )); then
      log_item "$app: update if installed in user scope; otherwise install from Flathub"
      run_cmd flatpak update --user --noninteractive --assumeyes "$app" || return $?
      run_cmd flatpak install --user --noninteractive --assumeyes flathub "$app" || return $?
    elif flatpak info --user "$app" >/dev/null 2>&1; then
      # Keep dependency/extension updates enabled: a current app can still have
      # an outdated runtime. Never update unrelated apps or the system scope.
      log_item "$app: checking for updates"
      run_cmd flatpak update --user --noninteractive --assumeyes "$app" || return $?
    else
      run_cmd flatpak install --user --noninteractive --assumeyes flathub "$app" || return $?
    fi
  done
}

refresh_flatpak_launchers() {
  local environment data_dirs installations path entry service original_dirs
  log_section "Flatpak Launcher Integration"
  if (( ${DRY_RUN:-0} )); then
    log_item "Would add Flatpak export directories to the user-session XDG_DATA_DIRS"
    log_item "Future logins use Flatpak's vendor profile and user environment generator"
    log_item "Would refresh active legacy launchers; Quattro watches entries without a shell restart"
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
  original_dirs="$data_dirs"
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

  # Persistence belongs to Flatpak's /etc/profile.d/flatpak.sh and
  # /usr/lib/systemd/user-environment-generators/60-flatpak. Do not snapshot
  # this manager's temporary/custom paths into a permanent environment.d file.
  run_cmd systemctl --user set-environment "XDG_DATA_DIRS=$data_dirs" || return $?
  if check_installed omarchy-shell; then
    # Quickshell watches desktop entries. Restarting it is neither necessary
    # for normal discovery nor sufficient to change its compositor-owned env.
    if [[ "$data_dirs" != "$original_dirs" ]]; then
      log_item "Flatpak paths added: log out and back in if apps are missing from the Quattro launcher"
    else
      log_item "Quattro watches desktop entries; existing sessions with these paths discover apps automatically"
    fi
    return 0
  fi
  for service in elephant.service app-walker@autostart.service; do
    if systemctl --user is-active --quiet "$service"; then
      run_cmd systemctl --user restart "$service" || return $?
    fi
  done
}
