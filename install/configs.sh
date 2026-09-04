#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
# shellcheck source=install/herdr.sh
source "$(dirname "${BASH_SOURCE[0]}")/herdr.sh"

apply_nvim() {
  ensure_dir "$HOME/.config"
  safe_link_path "$REPO_ROOT/configs/nvim" "$HOME/.config/nvim" "nvim config"
}

apply_hypr() {
  ensure_dir "$HOME/.config"
  safe_link_path "$REPO_ROOT/configs/hypr" "$HOME/.config/hypr" "hypr config"
}

apply_ai_desktop_linux() {
  ensure_dir "$HOME/.config"
  safe_link_path \
    "$REPO_ROOT/configs/ai-desktop/chatgpt-flags.conf" \
    "$HOME/.config/chatgpt-flags.conf" \
    "ChatGPT Linux flags"

  ensure_dir "$HOME/.local/bin"
  safe_link_path \
    "$REPO_ROOT/configs/ai-desktop/claude-desktop" \
    "$HOME/.local/bin/claude-desktop" \
    "Claude Desktop Linux wrapper"
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
  else
    "$REPO_ROOT/configs/agents/install.sh" --yes
  fi

  # Herdr writes additive hooks into the freshly rendered agent configs. Moshi
  # runs later and composes with these hooks without making either integration stale.
  configure_herdr_agent_integrations
}

apply_brave_linux() {
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

apply_brave_macos() {
  local label="com.thierry.brave-cdp"
  local launch_agent_src="$REPO_ROOT/configs/brave/${label}.plist"
  local launch_agent_dst="$HOME/Library/LaunchAgents/${label}.plist"
  local launch_domain=""
  local backup_path=""
  local changed=0

  launch_domain="gui/$(id -u)"

  if [[ -x /usr/bin/plutil ]]; then
    /usr/bin/plutil -lint "$launch_agent_src" >/dev/null
  elif (( ! ${DRY_RUN:-0} )); then
    printf 'error: plutil is required to install the Brave launch agent\n' >&2
    return 1
  fi

  ensure_dir "$HOME/Library/LaunchAgents"

  if [[ -f "$launch_agent_dst" ]] && cmp -s "$launch_agent_src" "$launch_agent_dst"; then
    log_item "Brave CDP launch agent: already up to date"
  else
    if [[ -e "$launch_agent_dst" || -L "$launch_agent_dst" ]]; then
      backup_path="$(next_backup_path "$launch_agent_dst")"
      run_cmd mv "$launch_agent_dst" "$backup_path"
      log_item "Brave CDP launch agent: backed up to $backup_path"
    fi

    run_cmd cp "$launch_agent_src" "$launch_agent_dst"
    log_item "Brave CDP launch agent: installed"
    changed=1
  fi

  if (( ${DRY_RUN:-0} )); then
    dry_run_cmd launchctl bootstrap "$launch_domain" "$launch_agent_dst"
    return 0
  fi

  if ! launchctl print "$launch_domain" >/dev/null 2>&1; then
    log_item "Brave CDP launch agent: will load at next GUI login"
    return 0
  fi

  if launchctl print "$launch_domain/$label" >/dev/null 2>&1; then
    if (( changed )); then
      log_item "Brave CDP launch agent: updated; changes apply at next GUI login"
    else
      log_item "Brave CDP launch agent: already loaded"
    fi
    return 0
  fi

  run_cmd launchctl bootstrap "$launch_domain" "$launch_agent_dst"
  log_item "Brave CDP launch agent: loaded"
}

apply_brave() {
  if [[ "${SETUP_HOST:-}" == "macbook" ]]; then
    apply_brave_macos
    return 0
  fi

  apply_brave_linux
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
