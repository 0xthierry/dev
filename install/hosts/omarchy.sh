#!/usr/bin/env bash

# shellcheck disable=SC2034
HOST_ENV_VARS=(
  "OLLAMA_HOST=0.0.0.0:11434"
)

# shellcheck disable=SC2034
HOST_CONFIG_TARGETS=(
  nvim
  hypr
  ai-desktop
  ghostty
  herdr
  agents
  moshi
  cameractrls
  brave
)

# shellcheck disable=SC2034
HOST_PACMAN_PACKAGES=(
  bitwarden
  cameractrls
  ccache
  containerd
  dbeaver
  discord
  edk2-ovmf
  fuse2
  ghostty
  gnome-keyring
  hicolor-icon-theme
  libnotify
  libsecret
  libxkbfile
  libxss
  obsidian
  pacman-contrib
  qemu-system-x86
  socat
  steam
  sysstat
  tailscale
  telegram-desktop
  virtiofsd
  wtype
  xdg-utils
  xorg-setxkbmap
  zram-generator
)

# shellcheck disable=SC2034
HOST_AUR_PACKAGES=(
  bambustudio-bin
  brave-bin
  chatgpt-desktop
  figma-linux
  handy-bin
  linear-desktop-bin
  slack-desktop
  spotify
)

setup_host_prereqs() {
  log_section "Host Prerequisites"
  log_item "Preparing omarchy host prerequisites"
}

setup_host_packages() {
  log_section "Host Packages"
  log_item "Installing shared CLI package set for omarchy"
  setup_shared_cli_packages
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
    log_item "Docker daemon: jq or dockerd unavailable; skipping policy merge"
    return 0
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

  install_omarchy_root_config \
    "$REPO_ROOT/configs/omarchy/zram-generator.conf" \
    "/etc/systemd/zram-generator.conf.d/90-dev-setup.conf" \
    "zram"
  install_omarchy_root_config \
    "$REPO_ROOT/configs/omarchy/oomd.conf" \
    "/etc/systemd/oomd.conf.d/90-dev-setup.conf" \
    "systemd-oomd"
  install_omarchy_root_config \
    "$REPO_ROOT/configs/omarchy/user-oomd.conf" \
    "/etc/systemd/system/user@.service.d/90-dev-setup-oomd.conf" \
    "User-session OOM policy"
  install_omarchy_root_config \
    "$REPO_ROOT/configs/omarchy/system-docker-slice.conf" \
    "/etc/systemd/system/system-docker.slice.d/90-dev-setup-memory.conf" \
    "Docker container memory budget"
  install_omarchy_root_config \
    "$REPO_ROOT/configs/omarchy/sysstat-collect.timer.conf" \
    "/etc/systemd/system/sysstat-collect.timer.d/90-dev-setup-interval.conf" \
    "sysstat collection interval"
  configure_omarchy_sysstat_activities
  install_omarchy_root_config \
    "$REPO_ROOT/configs/omarchy/journald.conf" \
    "/etc/systemd/journald.conf.d/90-dev-setup.conf" \
    "Journal size cap"
  install_omarchy_root_config \
    "$REPO_ROOT/configs/omarchy/sysctl-vm.conf" \
    "/etc/sysctl.d/90-dev-setup-vm.conf" \
    "Virtual memory tuning"
  configure_omarchy_docker_daemon

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

  log_item "NOTE: Reboot to activate the Docker daemon policy"
  log_item "NOTE: Docker cgroup-parent applies only to newly created containers"
  log_item "NOTE: Recreate each Compose stack to migrate its containers into system-docker.slice"
}

configure_omarchy_build_jobs() {
  local conf="/etc/makepkg.conf"
  local jobs=""

  log_section "Build Parallelism"

  if [[ ! -f "$conf" ]]; then
    log_item "makepkg.conf not found, skipping build tuning"
    return 0
  fi

  jobs="$(nproc)"

  # Unset MAKEFLAGS means make defaults to -j1, so every AUR package builds on a
  # single core. Arch ships the line commented out.
  if grep -qE "^MAKEFLAGS=\"-j${jobs}\"$" "$conf"; then
    log_item "MAKEFLAGS: already -j${jobs}"
  else
    log_item "MAKEFLAGS: building with -j${jobs}"
    run_cmd sudo sed -i -E \
      "s|^#?MAKEFLAGS=.*|MAKEFLAGS=\"-j${jobs}\"|" \
      "$conf"
  fi

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
  local luks_device=""

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
  log_section "Default Browser"

  if ! check_installed xdg-settings; then
    log_item "xdg-settings not available, skipping"
    return 0
  fi

  log_item "Setting default browser to Brave"
  run_cmd xdg-settings set default-web-browser brave-browser.desktop
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

reload_hyprland_if_running() {
  if ! check_installed hyprctl || [[ -z "${HYPRLAND_INSTANCE_SIGNATURE:-}" ]]; then
    return 0
  fi

  log_section "Hyprland"
  log_item "Reloading Hyprland configuration"
  run_cmd hyprctl reload
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
    if check_installed omarchy || (( ${DRY_RUN:-0} )); then
      run_cmd omarchy restart walker
    fi
  else
    log_item "ChatGPT and Claude launchers: already deduplicated"
  fi
}

start_handy_hidden() {
  if (( ${DRY_RUN:-0} )); then
    dry_run_cmd uwsm-app -- handy --start-hidden
    return 0
  fi

  nohup uwsm-app -- handy --start-hidden >/dev/null 2>&1 &
}

configure_handy() {
  log_section "Handy Dictation"

  if (( ! ${DRY_RUN:-0} )) && ! check_installed handy; then
    log_item "handy not available after package installation; skipping runtime setup"
    return 0
  fi

  # Keep the old package and user data, but stop its background service now that
  # Handy owns the dictation shortcuts.
  if (( ${DRY_RUN:-0} )) || {
    check_installed systemctl && systemctl --user cat voxtype.service >/dev/null 2>&1
  }; then
    log_item "Disabling legacy Voxtype user service"
    run_cmd systemctl --user disable --now voxtype.service
  fi

  if (( ${DRY_RUN:-0} )); then
    log_item "Starting Handy hidden with Hyprland"
    start_handy_hidden
  elif [[ -z "${HYPRLAND_INSTANCE_SIGNATURE:-}" ]]; then
    log_item "Handy will start hidden at the next Hyprland login"
  elif pgrep -x handy >/dev/null 2>&1; then
    log_item "Handy: running"
  else
    log_item "Starting Handy hidden; complete onboarding on first launch"
    start_handy_hidden
  fi
}

setup_host_machine_state() {
  log_section "Host Machine State"
  configure_keyboard
  configure_legacy_tiocsti
  configure_omarchy_resource_resilience
  configure_omarchy_build_jobs
  configure_omarchy_storage_maintenance
  set_default_browser_brave
  configure_secret_service
  apply_host_configs
  cleanup_ai_launcher_duplicates
  configure_handy
  reload_hyprland_if_running
}

setup_post_host_state() {
  log_section "Post Host State"
  run_post_setup_tasks
}
