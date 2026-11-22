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

# Shared early host/apply guard. This is not an upgrade or a fresh OS installer.
# Keep the package path fixed: environment overrides must not bypass this gate.
require_omarchy_quattro_layout() {
  if (( ${DRY_RUN:-0} )); then
    log_item "Hyprland deployment requires initialized stock Quattro; would validate package defaults and real user Lua config"
    return 0
  fi
  local dir="$HOME/.config/hypr" entry="$HOME/.config/hypr/hyprland.lua"
  if [[ ! -f /usr/share/omarchy/default/hypr/bootstrap.lua || -L $HOME/.config || -L $dir || -L $entry || ! -f $entry ]] ||
    [[ $(grep -Fxc -- 'require("default.hypr.omarchy")' "$entry" 2>/dev/null || :) != 1 ]]; then
    printf 'error: requires initialized stock Quattro with packaged defaults and a real ~/.config/hypr/hyprland.lua; refusing to deploy.\n' >&2
    return 1
  fi
}

# Ordinary setup validates Quattro, but the desktop belongs to stock and the user.
# Do not rewrite even one Lua file or move per-monitor workspace state.
apply_hypr_quattro() {
  require_omarchy_quattro_layout || return 1
  log_item "Preserving current Quattro desktop, monitors, workspaces and personal config; shortcuts are a separate reviewed opt-in"
}

# Explicit opt-in only; never called by apply_hypr or the host config target.
# Load shortcuts after defaults, before the user's modules and stock toggles.
apply_hypr_quattro_shortcuts() (
  local dir="$HOME/.config/hypr" src="$REPO_ROOT/configs/hypr-quattro"
  local entry="$dir/hyprland.lua" overlay="$dir/dev-setup" tmp=''
  local hook='if package.searchpath("hypr.dev-setup.shortcuts", package.path) then require("hypr.dev-setup.shortcuts") end'
  require_omarchy_quattro_layout || return 1
  if (( ${DRY_RUN:-0} )); then
    log_item "Would link $src at $overlay and back up/load reviewed personal shortcuts only; preserve desktop, monitor/workspace state and stock dictation"
    return 0
  fi
  if [[ ! -f $src/shortcuts.lua || ! -f $src/bindings.lua ]]; then
    printf 'error: incomplete Quattro shortcuts; refusing to deploy.\n' >&2
    return 1
  fi
  # Never silently upgrade a previously enabled full desktop overlay.
  if grep -Fq 'hypr.dev-setup.dev-setup' "$entry"; then
    printf 'error: historical full desktop overlay is enabled; review it manually before selecting shortcuts only.\n' >&2
    return 1
  fi
  local anchor='require("default.hypr.omarchy")' matches
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
    # Same-filesystem rename: Hyprland must not observe a partial write.
    tmp=$(mktemp "$dir/.dev-setup.XXXXXXXX") || return 1
    trap 'rm -f -- "$tmp"' EXIT
    cp -p -- "$entry" "$tmp" && awk -v a="$anchor" -v h="$hook" '{print; if ($0 == a) print h}' "$entry" > "$tmp" &&
      cp -p -- "$entry" "$(next_backup_path "$entry")" && mv -T -- "$tmp" "$entry" || return 1
  fi
)

apply_hypr() {
  apply_hypr_quattro
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
  local dir="$HOME/.config/ghostty" src="$REPO_ROOT/configs/ghostty"
  if [[ "${SETUP_HOST:-}" == macbook ]]; then
    ensure_dir "$dir"
    safe_link_path "$src/config" "$dir/config" "ghostty config"
    return
  fi
  if [[ "${SETUP_HOST:-}" != omarchy ]]; then
    printf 'error: Ghostty deployment requires SETUP_HOST=omarchy or macbook.\n' >&2
    return 1
  fi
  if { (( ! ${DRY_RUN:-0} )) && [[ ! -r /usr/share/omarchy/config/ghostty/config ]]; } ||
     [[ -L "$HOME/.config" || -L "$dir" ]]; then
    printf 'error: Omarchy Ghostty requires packaged defaults and a real user config directory.\n' >&2
    return 1
  fi
  # Unknown links may contain user work. Only migrate our former shared link.
  if [[ -L "$dir/config" && ! "$dir/config" -ef "$src/config" && ! "$dir/config" -ef "$src/omarchy.conf" ]] ||
     [[ -L "$dir/dev-setup" && ! "$dir/dev-setup" -ef "$src" ]]; then
    printf 'error: refusing unrelated Ghostty symlink; review it before setup.\n' >&2
    return 1
  fi
  # An independent materialized config is user-owned, not a migration source.
  # Only identical stock defaults / our own materialized wrapper may converge.
  if [[ -e "$dir/config" && ! -L "$dir/config" ]] &&
     { [[ ! -f "$dir/config" ]] ||
       { ! cmp -s "$dir/config" /usr/share/omarchy/config/ghostty/config &&
         ! cmp -s "$dir/config" "$src/omarchy.conf"; }; }; then
    log_item "Preserving independent Ghostty config at $dir/config; review configs/ghostty/omarchy.conf before opting into repository defaults"
    return 0
  fi
  ensure_dir "$dir"
  if [[ -L "$dir/config" && "$dir/config" -ef "$src/config" ]]; then
    run_cmd mv -- "$dir/config" "$(next_backup_path "$dir/config")"
  fi
  # Back up recognized stock/repository files before linking the managed wrapper.
  safe_link_path "$src" "$dir/dev-setup" "Ghostty personal overrides"
  safe_link_path "$src/omarchy.conf" "$dir/config" "Omarchy Ghostty config"
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
