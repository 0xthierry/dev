#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

apply_nvim() {
  ensure_dir "$HOME/.config"
  safe_link_path "$REPO_ROOT/configs/nvim" "$HOME/.config/nvim" "nvim config"
}

apply_hypr() {
  ensure_dir "$HOME/.config"
  safe_link_path "$REPO_ROOT/configs/hypr" "$HOME/.config/hypr" "hypr config"
}

apply_voxtype() {
  local config_src="$REPO_ROOT/configs/voxtype/config.toml"
  local config_dst="$HOME/.config/voxtype/config.toml"
  local backup_path=""

  if [[ "${SETUP_HOST:-}" == "macbook" ]]; then
    config_src="$REPO_ROOT/configs/voxtype/macos.toml"
    config_dst="$HOME/Library/Application Support/voxtype/config.toml"
  fi

  ensure_dir "$(dirname "$config_dst")"

  if [[ -f "$config_dst" ]] && cmp -s "$config_src" "$config_dst"; then
    log_item "voxtype config: already up to date"
    return 0
  fi

  if [[ -e "$config_dst" || -L "$config_dst" ]]; then
    backup_path="$(next_backup_path "$config_dst")"
    run_cmd mv "$config_dst" "$backup_path"
    log_item "voxtype config: backed up to $backup_path"
  fi

  run_cmd cp "$config_src" "$config_dst"
  log_item "voxtype config: installed"
}

apply_ghostty() {
  ensure_dir "$HOME/.config/ghostty"
  safe_link_path "$REPO_ROOT/configs/ghostty/config" "$HOME/.config/ghostty/config" "ghostty config"
}

apply_herdr() {
  ensure_dir "$HOME/.config/herdr"
  safe_link_path "$REPO_ROOT/configs/herdr/config.toml" "$HOME/.config/herdr/config.toml" "herdr config"
}

apply_raycast() {
  ensure_dir "$HOME/.config/raycast"
  safe_link_path "$REPO_ROOT/configs/raycast/script-commands" "$HOME/.config/raycast/script-commands" "raycast script commands"
}

apply_agents() {
  if (( ${DRY_RUN:-0} )); then
    "$REPO_ROOT/configs/agents/install.sh" --dry-run --yes
    return 0
  fi

  "$REPO_ROOT/configs/agents/install.sh" --yes
}

apply_brave() {
  local wrapper_src="$REPO_ROOT/configs/brave/brave-wrapper"
  local wrapper_dst="$HOME/.local/bin/brave-wrapper"
  local desktop_src="$REPO_ROOT/configs/brave/brave-browser.desktop"
  local desktop_dst="$HOME/.local/share/applications/brave-browser.desktop"

  ensure_dir "$HOME/.local/bin"
  safe_link_path "$wrapper_src" "$wrapper_dst" "brave wrapper"

  ensure_dir "$HOME/.local/share/applications"
  safe_link_path "$desktop_src" "$desktop_dst" "brave desktop entry"

  if check_installed update-desktop-database; then
    run_cmd update-desktop-database "$HOME/.local/share/applications"
  fi
}

apply_cameractrls() {
  local preset_src="$REPO_ROOT/configs/cameractrls/usb-046d_Logitech_BRIO_B7068CAF-video-index0.ini"
  local preset_dst="$HOME/.config/hu.irl.cameractrls/usb-046d_Logitech_BRIO_B7068CAF-video-index0.ini"
  local service_src="$REPO_ROOT/configs/cameractrls/cameractrlsd.service"
  local service_dst="$HOME/.config/systemd/user/cameractrlsd.service"

  ensure_dir "$HOME/.config/hu.irl.cameractrls"
  safe_link_path "$preset_src" "$preset_dst" "cameractrls BRIO preset"

  ensure_dir "$HOME/.config/systemd/user"
  safe_link_path "$service_src" "$service_dst" "cameractrlsd service unit"

  if check_installed systemctl; then
    run_cmd systemctl --user daemon-reload
    run_cmd systemctl --user enable --now cameractrlsd.service
  fi
}
