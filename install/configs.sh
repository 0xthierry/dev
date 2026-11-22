#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
# shellcheck source=install/herdr.sh
source "$(dirname "${BASH_SOURCE[0]}")/herdr.sh"
# shellcheck source=install/browser-diagnostics.sh
source "$(dirname "${BASH_SOURCE[0]}")/browser-diagnostics.sh"
# shellcheck source=install/cua-driver.sh
source "$(dirname "${BASH_SOURCE[0]}")/cua-driver.sh"
# shellcheck source=install/psvr2.sh
source "$(dirname "${BASH_SOURCE[0]}")/psvr2.sh"
# shellcheck source=install/bs-manager.sh
source "$(dirname "${BASH_SOURCE[0]}")/bs-manager.sh"
# shellcheck source=install/creative-mcp.sh
source "$(dirname "${BASH_SOURCE[0]}")/creative-mcp.sh"
# shellcheck source=install/mcp.sh
source "$(dirname "${BASH_SOURCE[0]}")/mcp.sh"
# shellcheck source=install/claude-desktop-patch.sh
source "$(dirname "${BASH_SOURCE[0]}")/claude-desktop-patch.sh"

apply_nvim() {
  ensure_dir "$HOME/.config"
  safe_link_path "$REPO_ROOT/configs/nvim" "$HOME/.config/nvim" "nvim config"
}

# Layer the personal baseline after package defaults, but before local config
# and stock toggles. Never replace the directory or follow an entrypoint link.
apply_hypr_quattro() (
  local dir="$HOME/.config/hypr" src="$REPO_ROOT/configs/hypr-quattro"
  local entry="$dir/hyprland.lua" overlay="$dir/dev-setup" tmp=''
  local hook='if package.searchpath("hypr.dev-setup.dev-setup", package.path) then require("hypr.dev-setup.dev-setup") end'
  if [[ -L $HOME/.config || -L $dir || -L $entry || ! -f $entry || ! -f $src/dev-setup.lua ]]; then
    printf 'error: Quattro requires a real, initialized ~/.config/hypr/hyprland.lua and a complete overlay; refusing to deploy.\n' >&2
    return 1
  fi
  # A first stock login assigns per-monitor blocks. The shell bar reads those
  # from disk even after Lua's global-workspace overlay is loaded. Never erase
  # the mapping during setup; move it aside from a logged-out TTY as documented.
  local state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/omarchy" mapping
  for mapping in "$state_dir/monitor-workspaces" "$state_dir/monitor-workspaces-merged"; do
    if [[ -L $mapping || -s $mapping ]]; then
      printf 'error: stock workspace state found at %s; see configs/hypr-quattro/README.md before applying the global workspace layout.\n' "$mapping" >&2
      return 1
    fi
  done
  local anchor='require("default.hypr.omarchy")' matches
  if [[ $(grep -Fxc -- "$anchor" "$entry" || :) != 1 ]]; then
    printf 'error: cannot identify a unique stock defaults import in %s; review manually.\n' "$entry" >&2
    return 1
  fi
  matches=$(grep -Fxc -- "$hook" "$entry" || :)
  if [[ $matches != 0 ]] && { [[ $matches != 1 ]] || ! awk -v a="$anchor" -v h="$hook" 'previous == a && $0 == h {found=1} {previous=$0} END {exit !found}' "$entry"; }; then
    printf 'error: existing dev-setup import is duplicated or out of order in %s; review manually.\n' "$entry" >&2
    return 1
  fi
  if [[ -e $overlay || -L $overlay ]]; then
    if [[ ! -L $overlay || ! $overlay -ef $src ]]; then
      printf 'error: refusing to replace unrelated Quattro overlay: %s\n' "$overlay" >&2
      return 1
    fi
  else
    run_cmd ln -s -- "$src" "$overlay" || return 1
  fi
  if [[ $matches == 0 ]]; then
    if (( ${DRY_RUN:-0} )); then
      log_item "Would back up $entry and load the optional dev-setup module just after stock defaults"
      return 0
    fi
    # Same-filesystem rename: Hyprland must not observe a partial write.
    tmp=$(mktemp "$dir/.dev-setup.XXXXXXXX") || return 1
    trap 'rm -f -- "$tmp"' EXIT
    cp -p -- "$entry" "$tmp" && awk -v a="$anchor" -v h="$hook" '{print; if ($0 == a) print h}' "$entry" > "$tmp" &&
      cp -p -- "$entry" "$(next_backup_path "$entry")" && mv -T -- "$tmp" "$entry" || return 1
  fi
)

apply_hypr() {
  if [[ -f /usr/share/omarchy/default/hypr/bootstrap.lua ]]; then
    apply_hypr_quattro
    return $?
  elif [[ -e /usr/share/omarchy || -e $HOME/.config/hypr/hyprland.lua ]]; then
    printf 'error: mixed/unknown Omarchy layout; refusing to replace Hyprland config.\n' >&2
    return 1
  fi
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
  local desktop_src="$REPO_ROOT/configs/brave/brave-browser.desktop"
  local desktop_dst="$HOME/.local/share/applications/brave-browser.desktop"
  local command_name=""
  local command_dst=""

  ensure_dir "$HOME/.local/bin"
  for command_name in brave-wrapper brave brave-browser brave-browser-stable; do
    command_dst="$HOME/.local/bin/$command_name"
    safe_link_path "$wrapper_src" "$command_dst" "Brave command $command_name"
    if (( ! ${DRY_RUN:-0} )) \
      && [[ "$(resolve_symlink_target "$command_dst")" != "$(canonicalize_path "$wrapper_src")" ]]; then
      printf 'error: Brave command did not converge to the managed wrapper: %s\n' "$command_dst" >&2
      return 1
    fi
  done

  ensure_dir "$HOME/.local/share/applications"
  safe_link_path "$desktop_src" "$desktop_dst" "Brave desktop entry"
  if (( ! ${DRY_RUN:-0} )) \
    && [[ "$(resolve_symlink_target "$desktop_dst")" != "$(canonicalize_path "$desktop_src")" ]]; then
    printf 'error: Brave desktop entry did not converge to the managed source: %s\n' "$desktop_dst" >&2
    return 1
  fi

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
