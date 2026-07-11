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
  qemu-system-x86
  socat
  steam
  tailscale
  telegram-desktop
  virtiofsd
  wtype
  xdg-utils
  xorg-setxkbmap
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
  set_default_browser_brave
  apply_host_configs
  configure_voxtype
  reload_hyprland_if_running
}

setup_post_host_state() {
  log_section "Post Host State"
  run_post_setup_tasks
}
