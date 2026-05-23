#!/usr/bin/env bash

# shellcheck disable=SC2034
HOST_ENV_VARS=(
  "OLLAMA_HOST=0.0.0.0:11434"
)

# shellcheck disable=SC2034
HOST_CONFIG_TARGETS=(
  nvim
  hypr
  ghostty
  agents
  cameractrls
  brave
)

# shellcheck disable=SC2034
HOST_PACMAN_PACKAGES=(
  bitwarden
  cameractrls
  dbeaver
  discord
  ghostty
  obsidian
  steam
  tailscale
  telegram-desktop
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

setup_host_prereqs() {
  log_section "Host Prerequisites"
  log_item "Preparing omarchy host prerequisites"
}

setup_host_packages() {
  log_section "Host Packages"
  log_item "Installing shared CLI package set for omarchy"
  setup_shared_cli_packages
  install_zed_linux
  log_item "Skipping unsupported Omarchy apps: ChatGPT, Claude desktop, Codex.app, Rectangle"
}

setup_shared_machine_state() {
  log_section "Shared Machine State"
  apply_shared_machine_state
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

setup_host_machine_state() {
  log_section "Host Machine State"
  configure_keyboard
  set_default_browser_brave
  apply_host_configs
  reload_hyprland_if_running
}

setup_post_host_state() {
  log_section "Post Host State"
  run_post_setup_tasks
}
