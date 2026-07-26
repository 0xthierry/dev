#!/usr/bin/env bash

# shellcheck disable=SC2034
HOST_ENV_VARS=(
  "OLLAMA_HOST=0.0.0.0:11434"
)

# shellcheck disable=SC2034
HOST_CONFIG_TARGETS=(
  nvim
  hypr
  voxtype
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
  figma-linux
  linear-desktop-bin
  slack-desktop
  spotify
)

VOXTYPE_PARAKEET_MODEL="parakeet-tdt-0.6b-v3"
VOXTYPE_PGP_KEYS=(
  E79F5BAF8CD51A806AA27DBB7DA2709247D75BC6
  9CCF7915B750CAE8B095ED1AA3FC9F33FD209279
)

setup_host_prereqs() {
  log_section "Host Prerequisites"
  log_item "Preparing omarchy host prerequisites"
}

import_voxtype_pgp_keys() {
  local key=""

  if (( ! ${DRY_RUN:-0} )) && ! check_installed gpg; then
    log_item "gpg not available, skipping Voxtype PGP key import"
    return 0
  fi

  for key in "${VOXTYPE_PGP_KEYS[@]}"; do
    if (( ${DRY_RUN:-0} )); then
      dry_run_cmd gpg --keyserver hkps://keys.openpgp.org --recv-keys "$key"
      continue
    fi

    if gpg --list-keys "$key" >/dev/null 2>&1; then
      log_item "Voxtype PGP key present: ${key: -16}"
      continue
    fi

    log_item "Importing Voxtype PGP key: ${key: -16}"
    gpg --keyserver hkps://keys.openpgp.org --recv-keys "$key" || \
      gpg --keyserver hkps://keyserver.ubuntu.com --recv-keys "$key"
  done
}

install_voxtype_package() {
  local build_parent="$HOME/.cache/dev-setup/aur"
  local build_dir="$build_parent/voxtype-bin"
  local quoted_build_dir=""

  log_section "Voxtype Package"

  if check_installed voxtype; then
    log_item "voxtype: installed"
    return 0
  fi

  if (( ! ${DRY_RUN:-0} )) && ! check_installed git; then
    log_item "git not available, skipping voxtype-bin AUR checkout"
    return 0
  fi

  if (( ! ${DRY_RUN:-0} )) && ! check_installed makepkg; then
    log_item "makepkg not available, skipping voxtype-bin AUR build"
    return 0
  fi

  # Do not use yay/paru here: Omarchy has a repo package with the same name,
  # and its mirror can advertise stale package files. Building from the AUR
  # checkout guarantees pacman installs the locally built package with -U.
  ensure_dir "$build_parent"

  if [[ -d "$build_dir/.git" ]]; then
    log_item "Updating AUR checkout: voxtype-bin"
    run_cmd git -C "$build_dir" pull --ff-only
  elif [[ -e "$build_dir" ]]; then
    log_item "WARNING: $build_dir exists but is not a git checkout; skipping voxtype-bin"
    return 0
  else
    log_item "Cloning AUR checkout: voxtype-bin"
    run_cmd git clone https://aur.archlinux.org/voxtype-bin.git "$build_dir"
  fi

  import_voxtype_pgp_keys

  log_item "Building/installing AUR voxtype-bin"
  printf -v quoted_build_dir '%q' "$build_dir"
  run_cmd bash -lc "cd $quoted_build_dir && makepkg -si --noconfirm"
}

setup_host_packages() {
  log_section "Host Packages"
  log_item "Installing shared CLI package set for omarchy"
  setup_shared_cli_packages
  install_voxtype_package
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

  run_cmd sudo sysctl -w "${sysctl_name}=1"
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
    run_cmd sudo sysctl --system
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
    run_cmd sudo sed -i -E \
      '/[[:space:]]btrfs[[:space:]]/s|(^|,)relatime|\1noatime|g' \
      /etc/fstab
    run_cmd sudo mount -o remount /
    run_cmd sudo mount -o remount /home
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

  log_item "Setting console keymap to us-acentos"
  run_cmd sudo localectl set-keymap us-acentos

  log_item "Setting X11 fallback keymap to us / pc105 / intl"
  run_cmd sudo localectl set-x11-keymap us pc105 intl terminate:ctrl_alt_bksp

  if check_installed setxkbmap && [[ -n "${DISPLAY:-}" ]]; then
    log_item "Setting current Xwayland keymap to us / pc105 / intl"
    run_cmd setxkbmap -layout us -model pc105 -variant intl -option compose:caps
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

voxtype_parakeet_model_installed() {
  local model_dir="$HOME/.local/share/voxtype/models/$VOXTYPE_PARAKEET_MODEL"

  [[ -f "$model_dir/encoder-model.onnx" ]] && \
    [[ -f "$model_dir/encoder-model.onnx.data" ]] && \
    [[ -f "$model_dir/decoder_joint-model.onnx" ]] && \
    [[ -f "$model_dir/vocab.txt" ]] && \
    [[ -f "$model_dir/config.json" ]]
}

configure_voxtype() {
  log_section "Voxtype Dictation"

  if (( ! ${DRY_RUN:-0} )) && ! check_installed voxtype; then
    log_item "voxtype not available after package installation; skipping runtime setup"
    return 0
  fi

  log_item "Selecting ONNX AVX-512 Voxtype binary for Parakeet"
  run_cmd sudo voxtype setup variant --to voxtype-onnx-avx512

  if (( ${DRY_RUN:-0} )) || ! voxtype_parakeet_model_installed; then
    log_item "Downloading/selecting Parakeet model: $VOXTYPE_PARAKEET_MODEL"
    run_cmd voxtype setup --download --model "$VOXTYPE_PARAKEET_MODEL" --quiet --no-post-install

    # `voxtype setup --download --model` also edits config.toml. This repo owns
    # the config, so restore the canonical file before installing the service.
    apply_voxtype
  else
    log_item "Parakeet model installed: $VOXTYPE_PARAKEET_MODEL"
  fi

  log_item "Installing/enabling Voxtype user service"
  run_cmd voxtype setup systemd

  if check_installed systemctl || (( ${DRY_RUN:-0} )); then
    log_item "Restarting Voxtype user service"
    run_cmd systemctl --user restart voxtype.service
  fi

  if check_installed omarchy-restart-waybar || (( ${DRY_RUN:-0} )); then
    log_item "Restarting Waybar for Voxtype indicator"
    run_cmd omarchy-restart-waybar
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
  apply_host_configs
  configure_voxtype
  reload_hyprland_if_running
}

setup_post_host_state() {
  log_section "Post Host State"
  run_post_setup_tasks
}
