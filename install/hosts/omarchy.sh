#!/usr/bin/env bash

# shellcheck source=install/flatpak.sh
source "$REPO_ROOT/install/flatpak.sh"

# shellcheck disable=SC2034
HOST_ENV_VARS=(
  "OLLAMA_HOST=0.0.0.0:11434"
  "CUA_DRIVER_RS_ENABLE_WAYLAND=1"
)

# shellcheck disable=SC2034
HOST_CONFIG_TARGETS=(
  nvim
  hypr
  ai-desktop
  ghostty
  herdr
  agents
  cua-driver
  moshi
  cameractrls
  brave
  browser-diagnostics
  creative-mcp
  bs-manager
  psvr2
)

# shellcheck disable=SC2034
HOST_PACMAN_PACKAGES=(
  amdsmi
  bitwarden
  blender
  cameractrls
  ccache
  containerd
  dbeaver
  discord
  edk2-ovmf
  flatpak
  fuse2
  ghostty
  gnome-keyring
  grim
  hicolor-icon-theme
  libnotify
  libpulse
  libsecret
  libusb
  libxkbfile
  libxss
  pacman-contrib
  python
  python-cattrs
  python-gobject
  qemu-system-x86
  steam
  sysstat
  tailscale
  telegram-desktop
  usbutils
  virtiofsd
  xdg-utils
  xorg-setxkbmap
  zram-generator
)

# shellcheck disable=SC2034
HOST_AUR_PACKAGES=(
  bambustudio-bin
  brave-bin
  bs-manager-bin
  chatgpt-desktop
  figma-linux
  linear-desktop-bin
  slack-desktop
  spotify
  steamvr-linux-fixes-layer-bin
)

HOST_FLATPAK_APPS=(
  org.vinegarhq.Sober
  org.vinegarhq.Vinegar
)

setup_host_prereqs() {
  # Fail before package installs or shared machine changes on unsupported hosts.
  require_omarchy_quattro_layout || return $?
  log_section "Host Prerequisites"
  log_item "Preparing omarchy host prerequisites"
}

setup_host_packages() {
  log_section "Host Packages"
  log_item "Installing shared CLI package set for omarchy"
  setup_shared_cli_packages
  install_flatpak_apps "${HOST_FLATPAK_APPS[@]}"
  refresh_flatpak_launchers
  install_zed_linux
  install_ai_desktop_apps_linux
  log_item "Skipping unsupported Omarchy apps: ChatGPT desktop, Codex.app, Conductor, Rectangle"
}

setup_shared_machine_state() {
  log_section "Shared Machine State"
  apply_shared_machine_state
}

configure_legacy_tiocsti() {
  local sysctl_name="dev.tty.legacy_tiocsti"
  local sysctl_proc="/proc/sys/dev/tty/legacy_tiocsti"
  local sysctl_conf="/etc/sysctl.d/99-dev-setup-legacy-tiocsti.conf"
  local desired_line="${sysctl_name} = 1"

  log_section "Legacy TIOCSTI"

  if [[ ! -e "$sysctl_proc" ]] && (( ! ${DRY_RUN:-0} )); then
    log_item "${sysctl_name}: unsupported by this kernel, skipping"
    return 0
  fi

  log_item "Enabling ${sysctl_name} for AMQ terminal wake injection"

  if (( ${DRY_RUN:-0} )); then
    dry_run_cmd sudo install -Dm644 /dev/stdin "$sysctl_conf" <<< "$desired_line"
    dry_run_cmd sudo sysctl -w "${sysctl_name}=1"
    return 0
  fi

  if [[ -f "$sysctl_conf" ]] && grep -Fxq "$desired_line" "$sysctl_conf"; then
    log_item "Sysctl config: already configured"
  else
    printf '%s\n' "$desired_line" | sudo install -Dm644 /dev/stdin "$sysctl_conf"
    log_item "Sysctl config: $sysctl_conf"
  fi

  if [[ "$(cat "$sysctl_proc" 2>/dev/null)" == "1" ]]; then
    log_item "${sysctl_name}: already active"
  else
    run_cmd sudo sysctl -w "${sysctl_name}=1"
  fi
}

# Set by install_omarchy_root_config whenever a file actually changed, so the
# reload/restart steps can be skipped on a run where nothing moved.
OMARCHY_ROOT_CONFIG_CHANGED=0

install_omarchy_root_config() {
  local source_path="$1"
  local target_path="$2"
  local label="$3"

  if [[ -f "$target_path" ]] && cmp -s "$source_path" "$target_path"; then
    log_item "$label: already configured"
    return 0
  fi

  log_item "$label: installing $target_path"
  run_cmd sudo install -Dm644 "$source_path" "$target_path"
  OMARCHY_ROOT_CONFIG_CHANGED=1
}

# Enable only the units that are not already enabled, so a converged machine
# does no work.
enable_omarchy_units() {
  local unit=""
  local pending=()

  for unit in "$@"; do
    if systemctl is-enabled --quiet "$unit" 2>/dev/null \
      && systemctl is-active --quiet "$unit" 2>/dev/null; then
      continue
    fi
    pending+=("$unit")
  done

  if (( ${#pending[@]} == 0 )); then
    log_item "Units: all $# already enabled and active"
    return 0
  fi

  log_item "Units: enabling ${pending[*]}"
  run_cmd sudo systemctl enable --now "${pending[@]}"
}

configure_omarchy_docker_policy() {
  [[ "${SETUP_HOST:-}" == "omarchy" ]] || return 0

  log_section "Docker Policy"
  local source_path="$REPO_ROOT/configs/omarchy/system-docker-slice.conf"
  local target_path="/etc/systemd/system/system-docker.slice.d/90-dev-setup-memory.conf"
  local socket_target="/etc/systemd/system/docker.socket.d/90-dev-setup-standby.conf"
  local socket_policy=$'[Unit]\n# Close the API listener when the manually started engine is stopped.\nPartOf=docker.service'
  local changed=0
  if [[ ! -f "$target_path" ]] || ! cmp -s "$source_path" "$target_path"; then
    run_cmd sudo install -Dm644 "$source_path" "$target_path"
    changed=1
  fi
  if [[ ! -f "$socket_target" ]] || ! cmp -s <(printf '%s\n' "$socket_policy") "$socket_target"; then
    run_cmd sudo install -Dm644 /dev/stdin "$socket_target" <<< "$socket_policy"
    changed=1
  fi
  if (( changed )); then
    run_cmd sudo systemctl daemon-reload
  fi
  configure_omarchy_docker_daemon
  configure_omarchy_docker_startup || return
  log_item "NOTE: Docker reads daemon changes on startup; a running engine is not restarted"
  log_item "NOTE: Recreate containers explicitly to migrate them into system-docker.slice"
}

configure_omarchy_docker_daemon() {
  local fragment="$REPO_ROOT/configs/omarchy/docker-daemon-fragment.json"
  local target="/etc/docker/daemon.json"
  local merged=""
  local existing=""

  if (( ${DRY_RUN:-0} )); then
    log_item "Docker daemon: merge $fragment into $target (preserving existing settings)"
    dry_run_cmd dockerd --validate --config-file "$target"
    return 0
  fi

  if ! check_installed jq || ! check_installed dockerd; then
    log_item "ERROR: Docker daemon policy requires jq and dockerd; install the Omarchy packages first"
    return 1
  fi

  merged="$(mktemp)"
  existing="$(mktemp)"

  if [[ -f "$target" ]]; then
    if ! jq -e 'type == "object"' "$target" > /dev/null; then
      rm -f "$merged" "$existing"
      log_item "ERROR: $target is not a valid JSON object; refusing to replace it"
      return 1
    fi
    cp "$target" "$existing"
  else
    printf '{}\n' > "$existing"
  fi

  if ! jq -s '.[0] * .[1]' "$existing" "$fragment" > "$merged"; then
    rm -f "$merged" "$existing"
    return 1
  fi
  rm -f "$existing"

  if ! dockerd --validate --config-file "$merged"; then
    rm -f "$merged"
    log_item "ERROR: merged Docker daemon configuration failed validation"
    return 1
  fi

  if [[ -f "$target" ]] && cmp -s "$merged" "$target"; then
    rm -f "$merged"
    log_item "Docker daemon: already configured"
    return 0
  fi

  sudo install -Dm644 "$merged" "$target"
  rm -f "$merged"
  log_item "Docker daemon: configured 300GB default-builder GC target and container slice"
}

report_containerd_ttrpc_version() {
  local containerd_bin=""
  local ttrpc_version=""

  if ! check_installed containerd || ! check_installed go; then
    return 0
  fi

  containerd_bin="$(command -v containerd)"
  ttrpc_version="$(
    go version -m "$containerd_bin" 2> /dev/null |
      awk '$1 == "dep" && $2 == "github.com/containerd/ttrpc" { print $3; exit }'
  )" || true

  if [[ -z "$ttrpc_version" ]]; then
    return 0
  fi

  if [[ "$ttrpc_version" == "v1.2.8" ]]; then
    log_item "containerd embeds ttrpc $ttrpc_version; the deadline-collapse fix is not released yet"
  else
    log_item "containerd embeds ttrpc $ttrpc_version"
  fi
}

configure_omarchy_resource_resilience() {
  log_section "Resource Resilience"

  # shellcheck source=install/omarchy-perf-profile.sh
  source "$REPO_ROOT/install/omarchy-perf-profile.sh"
  retire_overridden_vm_dropins || return
  install_omarchy_root_config \
    "$REPO_ROOT/configs/omarchy/oomd.conf" \
    "/etc/systemd/oomd.conf.d/90-dev-setup.conf" \
    "systemd-oomd"
  install_omarchy_root_config \
    "$REPO_ROOT/configs/omarchy/user-oomd.conf" \
    "/etc/systemd/system/user@.service.d/90-dev-setup-oomd.conf" \
    "User-session OOM policy"
  configure_omarchy_docker_policy
  install_omarchy_root_config \
    "$REPO_ROOT/configs/omarchy/sysstat-collect.timer.conf" \
    "/etc/systemd/system/sysstat-collect.timer.d/90-dev-setup-interval.conf" \
    "sysstat collection interval"
  configure_omarchy_sysstat_activities
  install_omarchy_root_config \
    "$REPO_ROOT/configs/omarchy/journald.conf" \
    "/etc/systemd/journald.conf.d/90-dev-setup.conf" \
    "Journal size cap"

  enable_omarchy_units \
    systemd-oomd.service \
    sysstat.service \
    sysstat-collect.timer \
    sysstat-rotate.timer \
    sysstat-summary.timer

  # Reconfiguring a zram device that already carries active swap fails with
  # EBUSY, so only recover a device that failed to come up. A size change on an
  # already-running device needs the reboot noted below.
  if ! systemctl is-active --quiet systemd-zram-setup@zram0.service; then
    log_item "zram: device inactive, bringing it up"
    run_cmd sudo systemctl reset-failed systemd-zram-setup@zram0.service
    run_cmd sudo systemctl restart systemd-zram-setup@zram0.service
  else
    log_item "zram: already active"
  fi

  if (( OMARCHY_ROOT_CONFIG_CHANGED )); then
    log_item "Reloading systemd and applying changed resource configuration"
    run_cmd sudo systemctl daemon-reload
    # --system reapplies every drop-in on the machine and echoes each one; -q
    # keeps the run readable without changing what is applied.
    run_cmd sudo sysctl -q --system
    # These daemons read their configuration only at startup, so they restart
    # only on the run that actually changed a file.
    run_cmd sudo systemctl restart systemd-oomd.service
    run_cmd sudo systemctl restart systemd-journald.service
    run_cmd sudo systemctl restart sysstat-collect.timer
  else
    log_item "Resource configuration unchanged, skipping reloads"
  fi

  report_containerd_ttrpc_version

}

configure_omarchy_build_jobs() {
  local conf="/etc/makepkg.conf"

  log_section "Build Parallelism"

  if [[ ! -f "$conf" ]]; then
    log_item "makepkg.conf not found, skipping build tuning"
    return 0
  fi

  # shellcheck source=install/omarchy-perf-profile.sh
  source "$REPO_ROOT/install/omarchy-perf-profile.sh"
  configure_interactive_makepkg || return

  # ccache returns a cached object when a translation unit hashes to something
  # already built, which dominates rebuild time for large AUR packages.
  if ! check_installed ccache; then
    log_item "ccache: not installed, leaving BUILDENV unchanged"
  elif grep -qE '^BUILDENV=\(.*[^!]ccache' "$conf"; then
    log_item "ccache: already enabled in BUILDENV"
  else
    log_item "ccache: enabling in BUILDENV"
    run_cmd sudo sed -i -E \
      's|^(BUILDENV=\(.*)!ccache(.*\))$|\1ccache\2|' \
      "$conf"
  fi
}

configure_omarchy_sysstat_activities() {
  local conf="/etc/conf.d/sysstat"

  if [[ ! -f "$conf" ]]; then
    log_item "sysstat: $conf not found, skipping activity set"
    return 0
  fi

  # shellcheck source=install/omarchy-perf-profile.sh
  source "$REPO_ROOT/install/omarchy-perf-profile.sh"
  configure_sysstat_retention || return

  # sadc's default activity set excludes per-device disk statistics, so `sar -d`
  # reports "Requested activities not available" -- the one subsystem worth
  # recording on an encrypted CoW filesystem. sa1 sources this file on every
  # invocation, and sadc -F resets the current day's file when the set changes.
  if grep -qE '^SADC_OPTIONS="-S DISK"$' "$conf"; then
    log_item "sysstat: disk activity collection already enabled"
    return 0
  fi

  log_item "sysstat: enabling disk activity collection (sar -d)"
  run_cmd sudo sed -i -E \
    's|^SADC_OPTIONS=.*|SADC_OPTIONS="-S DISK"|' \
    "$conf"
}

configure_omarchy_storage_maintenance() {
  log_section "Storage Maintenance"

  # An SSD only learns a block is free when the filesystem says so. Without
  # TRIM its garbage collector keeps relocating data nothing owns, which costs
  # write bandwidth and endurance.
  enable_omarchy_units fstrim.timer

  if check_installed paccache; then
    enable_omarchy_units paccache.timer
  else
    log_item "paccache: pacman-contrib not installed, skipping cache trimming"
  fi

  # atime turns every read into a metadata write, and on this stack that write
  # is copy-on-write, duplicated (DUP metadata), compressed and encrypted.
  if grep -qE '^[^#].*[[:space:]]btrfs[[:space:]].*relatime' /etc/fstab; then
    log_item "fstab: switching btrfs mounts from relatime to noatime"
    # Delimiter must not be '|' -- an alternation in the pattern would split the
    # s/// expression. Word boundaries keep this off other options.
    run_cmd sudo sed -i -E \
      '/[[:space:]]btrfs[[:space:]]/s/\brelatime\b/noatime/g' \
      /etc/fstab

    # systemd caches fstab into generated mount units; without this the remounts
    # below warn that it is still using the old version.
    run_cmd sudo systemctl daemon-reload

    # Remount every btrfs mount rather than a hardcoded pair, otherwise
    # subvolumes like /var/log keep relatime until the next reboot.
    local target=""
    while read -r target; do
      [[ -n "$target" ]] || continue
      run_cmd sudo mount -o remount "$target"
    done < <(findmnt -rno TARGET -t btrfs 2>/dev/null)
  else
    log_item "fstab: btrfs mounts already noatime"
  fi

  configure_omarchy_luks_performance
}

configure_omarchy_luks_performance() {
  local mapper="root"
  local backing=""

  if ! check_installed cryptsetup; then
    log_item "LUKS: cryptsetup unavailable, skipping"
    return 0
  fi

  if [[ ! -e "/dev/mapper/$mapper" ]]; then
    log_item "LUKS: /dev/mapper/$mapper not present, skipping"
    return 0
  fi

  # dm-crypt hands every request to a worker thread before encrypting it. That
  # was free when a seek cost 10ms; on PCIe 5.0 NVMe the handoff costs more than
  # the AES it defers. allow-discards additionally lets TRIM reach the SSD --
  # it leaks which blocks are in use to someone holding the disk, but never
  # plaintext.
  #
  # --persistent stores these in the LUKS2 header, so they survive reboot with
  # no bootloader change. LUKS1 headers cannot hold them.
  if (( ${DRY_RUN:-0} )); then
    log_item "LUKS: apply discard and workqueue-bypass flags to $mapper"
    dry_run_cmd sudo cryptsetup refresh --allow-discards \
      --perf-no_read_workqueue --perf-no_write_workqueue --persistent "$mapper"
    return 0
  fi

  # Second line of the raw dependency list is the device backing the mapping.
  backing="$(lsblk -nrso NAME "/dev/mapper/$mapper" 2>/dev/null | sed -n '2p')"
  if [[ -z "$backing" ]]; then
    log_item "LUKS: could not resolve backing device, skipping"
    return 0
  fi

  if ! sudo cryptsetup luksDump "/dev/$backing" 2>/dev/null | grep -qE '^Version:[[:space:]]*2'; then
    log_item "LUKS: /dev/$backing is not LUKS2, skipping persistent flags"
    return 0
  fi

  # The live dm target lists its active feature flags, so a converged machine
  # skips the refresh entirely.
  local table=""
  table="$(sudo dmsetup table "$mapper" 2>/dev/null)"
  if [[ "$table" == *allow_discards* ]] \
    && [[ "$table" == *no_read_workqueue* ]] \
    && [[ "$table" == *no_write_workqueue* ]]; then
    log_item "LUKS: discard and workqueue-bypass flags already active"
    return 0
  fi

  log_item "LUKS: applying discard and workqueue-bypass flags to $mapper"
  run_cmd sudo cryptsetup refresh \
    --allow-discards \
    --perf-no_read_workqueue \
    --perf-no_write_workqueue \
    --persistent \
    "$mapper"
}

set_default_browser_brave() {
  local desktop=brave-browser.desktop mime
  local -a cmd
  log_section "Default Browser"

  # Quattro's desktop-specific HTTP(S) handler is a dispatcher, not a browser.
  # Use its native preference, and keep its generic backing associations explicit.
  if [[ $(omarchy default browser 2>/dev/null) != brave ]]; then
    run_cmd omarchy default browser brave || return 1
  fi
  for mime in x-scheme-handler/http x-scheme-handler/https text/html application/xhtml+xml; do
    case $mime in
      x-scheme-handler/*) cmd=(env XDG_CURRENT_DESKTOP= xdg-mime) ;;
      *) cmd=(xdg-mime) ;;
    esac
    if [[ $("${cmd[@]}" query default "$mime" 2>/dev/null) != "$desktop" ]]; then
      run_cmd "${cmd[@]}" default "$desktop" "$mime" || return 1
      if (( ! ${DRY_RUN:-0} )) && [[ $("${cmd[@]}" query default "$mime") != "$desktop" ]]; then
        printf 'error: %s did not resolve to %s\n' "$mime" "$desktop" >&2; return 1
      fi
    fi
  done
  if (( ! ${DRY_RUN:-0} )) && [[ $(omarchy default browser) != brave ]]; then
    printf 'error: Omarchy did not resolve the default browser to Brave\n' >&2; return 1
  fi
}

configure_keyboard() {
  log_section "Keyboard"

  if ! check_installed localectl; then
    log_item "localectl not available, skipping"
    return 0
  fi

  # localectl rewrites vconsole.conf and the X11 keymap unconditionally, so
  # compare against the current values first.
  if [[ "$(localectl status 2>/dev/null | awk -F': ' '/VC Keymap/{print $2}')" == "us-acentos" ]]; then
    log_item "Console keymap: already us-acentos"
  else
    log_item "Setting console keymap to us-acentos"
    run_cmd sudo localectl set-keymap us-acentos
  fi

  if [[ "$(localectl status 2>/dev/null | awk -F': ' '/X11 Variant/{print $2}')" == "intl" ]] \
    && [[ "$(localectl status 2>/dev/null | awk -F': ' '/X11 Layout/{print $2}')" == "us" ]]; then
    log_item "X11 keymap: already us / pc105 / intl"
  else
    log_item "Setting X11 fallback keymap to us / pc105 / intl"
    run_cmd sudo localectl set-x11-keymap us pc105 intl terminate:ctrl_alt_bksp
  fi

  if check_installed setxkbmap && [[ -n "${DISPLAY:-}" ]]; then
    if [[ "$(setxkbmap -query 2>/dev/null | awk '/^layout:/{print $2}')" == "us" ]] \
      && [[ "$(setxkbmap -query 2>/dev/null | awk '/^variant:/{print $2}')" == "intl" ]]; then
      log_item "Xwayland keymap: already us / pc105 / intl"
    else
      log_item "Setting current Xwayland keymap to us / pc105 / intl"
      run_cmd setxkbmap -layout us -model pc105 -variant intl -option compose:caps
    fi
  fi
}

configure_secret_service() {
  log_section "Secret Service"

  if (( ! ${DRY_RUN:-0} )) && ! check_installed gnome-keyring-daemon; then
    log_item "GNOME Keyring is unavailable; desktop app sign-ins will not persist"
    return 0
  fi

  log_item "Enabling GNOME Keyring for desktop app credentials"
  run_cmd systemctl --user enable --now gnome-keyring-daemon.socket
}

cleanup_ai_launcher_duplicates() {
  local changed=0
  local chatgpt_webapp="$HOME/.local/share/applications/ChatGPT.desktop"
  local chatgpt_webapp_icon="$HOME/.local/share/applications/icons/ChatGPT.png"
  local claude_webapp="$HOME/.local/share/applications/Claude.desktop"
  local claude_webapp_icon="$HOME/.local/share/applications/icons/Claude.png"
  local claude_duplicate="$HOME/.local/share/applications/claude-desktop.desktop"
  local claude_wrapper="$HOME/.local/bin/claude-desktop"

  log_section "AI Desktop Entries"

  if [[ -f "$chatgpt_webapp" ]] \
    && grep -Fqx 'Exec=omarchy-launch-webapp https://chatgpt.com/' "$chatgpt_webapp"; then
    log_item "Removing obsolete ChatGPT web-app launcher"
    run_cmd rm -f "$chatgpt_webapp" "$chatgpt_webapp_icon"
    changed=1
  fi

  if [[ -f "$claude_webapp" ]] \
    && grep -Fqx 'Exec=omarchy-launch-webapp https://claude.ai' "$claude_webapp"; then
    log_item "Removing obsolete Claude web-app launcher"
    run_cmd rm -f "$claude_webapp" "$claude_webapp_icon"
    changed=1
  fi

  if [[ -f "$claude_duplicate" ]] \
    && grep -Fqx "Exec=$HOME/.local/bin/claude-desktop %U" "$claude_duplicate"; then
    log_item "Removing duplicate Claude desktop entry"
    run_cmd rm -f "$claude_duplicate"
    changed=1
  fi

  if [[ -x /usr/bin/claude-desktop && -f "$claude_wrapper" ]] \
    && grep -Fq 'exec "/usr/lib/claude-desktop/claude-desktop"' "$claude_wrapper"; then
    log_item "Removing obsolete Claude compatibility wrapper"
    run_cmd rm -f "$claude_wrapper"
    changed=1
  fi

  if (( changed )); then
    if check_installed update-desktop-database || (( ${DRY_RUN:-0} )); then
      run_cmd update-desktop-database "$HOME/.local/share/applications"
    fi
    # Quattro watches desktop entries; no launcher or shell restart is needed.
  else
    log_item "ChatGPT and Claude launchers: already deduplicated"
  fi
}

cua_driver_service_needs_restart() {
  local service_name="${1:-cua-driver.service}"
  local wayland_enabled="${2:-1}"
  local main_pid=""
  local running_executable=""
  local desired_executable=""
  local proc_root="${CUA_DRIVER_PROC_ROOT:-/proc}"

  main_pid="$(systemctl --user show "$service_name" --property MainPID --value 2>/dev/null || true)"
  [[ "$main_pid" =~ ^[1-9][0-9]*$ ]] || return 0
  desired_executable="$(readlink -f "$HOME/.local/bin/cua-driver" 2>/dev/null || true)"
  running_executable="$(readlink -f "$proc_root/$main_pid/exe" 2>/dev/null || true)"
  [[ -n "$desired_executable" && "$running_executable" == "$desired_executable" ]] || return 0
  local setting
  for setting in "CUA_DRIVER_RS_ENABLE_WAYLAND=$wayland_enabled" \
    CUA_DRIVER_RS_TELEMETRY_ENABLED=false CUA_DRIVER_RS_UPDATE_CHECK=false; do
    tr '\0' '\n' < "$proc_root/$main_pid/environ" 2>/dev/null \
      | grep -Fxq "$setting" || return 0
  done
  return 1
}

configure_cua_driver_backend() {
  local service_name="$1"
  local wayland_enabled="$2"
  local source_path="$REPO_ROOT/configs/cua-driver/$service_name"
  local target_path="$HOME/.config/systemd/user/$service_name"

  log_section "Cua Driver"

  if [[ ! -f "$source_path" ]]; then
    printf 'error: Cua Driver service definition is missing: %s\n' "$source_path" >&2
    return 1
  fi

  ensure_dir "$(dirname "$target_path")" || return
  safe_link_path "$source_path" "$target_path" "Cua Driver user service" || return

  if (( ! ${DRY_RUN:-0} )); then
    if [[ ! -x "$HOME/.local/bin/cua-driver" ]]; then
      printf 'error: Cua Driver binary is unavailable after installation\n' >&2
      return 1
    fi
    if [[ ! -L "$target_path" ]] \
      || [[ "$(resolve_symlink_target "$target_path")" != "$(canonicalize_path "$source_path")" ]]; then
      printf 'error: refusing to enable an unmanaged Cua Driver service: %s\n' "$target_path" >&2
      return 1
    fi
    if ! check_installed systemctl; then
      printf 'error: systemctl is required to enable the Cua Driver user service\n' >&2
      return 1
    fi
  fi

  run_cmd systemctl --user daemon-reload || return
  if (( ${DRY_RUN:-0} )); then
    run_cmd systemctl --user enable "$service_name" || return
    run_cmd systemctl --user start "$service_name" || return
  else
    if ! systemctl --user is-enabled --quiet "$service_name" 2>/dev/null; then
      run_cmd systemctl --user enable "$service_name" || return
    fi
    if ! systemctl --user is-active --quiet "$service_name" 2>/dev/null; then
      run_cmd systemctl --user start "$service_name" || return
      log_item "Cua Driver service: started"
    elif cua_driver_service_needs_restart "$service_name" "$wayland_enabled"; then
      run_cmd systemctl --user restart "$service_name" || return
      log_item "Cua Driver service: restarted to load the current runtime and managed backend/privacy settings"
    else
      log_item "Cua Driver service: already running the current runtime"
    fi
  fi
  log_item "Cua Driver: $service_name configured (native Wayland=$wayland_enabled)"
}

configure_cua_driver_service() {
  configure_cua_driver_backend cua-driver.service 1 || return
  configure_cua_driver_backend cua-driver-x11.service 0 || return
  log_item "Cua Driver: separate Wayland and X11 endpoints; no compositor plugin installed"
}

configure_g325_audio() {
  local src="$REPO_ROOT/configs/omarchy/g325-audio" lib="$HOME/.local/lib/g325-audio"
  local units="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
  ensure_dir "$lib" && ensure_dir "$units" || return
  safe_link_path "$src/recover.py" "$lib/recover.py" 'G325 audio recovery' || return
  safe_link_path "$src/g325-audio.service" "$units/g325-audio.service" 'G325 audio service' || return
  if (( ! ${DRY_RUN:-0} )) && ! [[ "$lib/recover.py" -ef "$src/recover.py" && "$units/g325-audio.service" -ef "$src/g325-audio.service" ]]; then
    log_item 'Refusing to start an unmanaged G325 audio service'
    return 1
  fi
  run_cmd systemctl --user daemon-reload || return
  run_cmd systemctl --user enable g325-audio.service || return
  if (( ${DRY_RUN:-0} )) || systemctl --user is-active --quiet graphical-session.target; then
    run_cmd systemctl --user start g325-audio.service || return
  fi
}

configure_quadcast_input() {
  local dir="${XDG_CONFIG_HOME:-$HOME/.config}/wireplumber/wireplumber.conf.d"
  ensure_dir "$dir"
  safe_link_path "$REPO_ROOT/configs/omarchy/quadcast-input.conf" "$dir/90-quadcast-input.conf" 'QuadCast microphone profile'
}

setup_host_machine_state() {
  log_section "Host Machine State"
  configure_quadcast_input
  configure_g325_audio || return
  configure_keyboard
  configure_legacy_tiocsti
  configure_omarchy_resource_resilience
  configure_omarchy_build_jobs
  configure_omarchy_storage_maintenance
  set_default_browser_brave
  configure_secret_service
  apply_host_configs
  configure_cua_driver_service
  cleanup_ai_launcher_duplicates
}

setup_post_host_state() {
  log_section "Post Host State"
  run_post_setup_tasks
}
