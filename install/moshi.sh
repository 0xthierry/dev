#!/usr/bin/env bash
# Install and configure Moshi host integration without storing phone-specific secrets.
set -euo pipefail
# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

resolve_moshi_hook_bin() {
  if command -v moshi-hook >/dev/null 2>&1; then
    command -v moshi-hook
    return 0
  fi

  if [[ -x "$HOME/.local/bin/moshi-hook" ]]; then
    printf '%s\n' "$HOME/.local/bin/moshi-hook"
    return 0
  fi

  if [[ -x /opt/homebrew/bin/moshi-hook ]]; then
    printf '%s\n' /opt/homebrew/bin/moshi-hook
    return 0
  fi

  if [[ -x /usr/local/bin/moshi-hook ]]; then
    printf '%s\n' /usr/local/bin/moshi-hook
    return 0
  fi

  return 1
}

install_moshi_hook_binary() {
  local moshi_hook_bin=""

  if moshi_hook_bin="$(resolve_moshi_hook_bin 2>/dev/null)"; then
    log_item "moshi-hook: installed ($moshi_hook_bin)"
    return 0
  fi

  log_item "Installing moshi-hook..."

  if [[ "$(uname -s)" == "Darwin" ]]; then
    if ! check_installed brew; then
      log_item "Homebrew not available, skipping moshi-hook install"
      return 0
    fi

    run_cmd brew tap rjyo/moshi
    run_cmd brew trust rjyo/moshi
    run_cmd brew install moshi-hook
    return 0
  fi

  run_cmd bash -c 'curl -fsSL https://getmoshi.app/install.sh | sh'
}

resolve_herdr_bin() {
  local mise_bin=""
  local herdr_bin=""

  if mise_bin="$(resolve_mise_bin 2>/dev/null)" && herdr_bin="$($mise_bin which herdr 2>/dev/null)" && [[ -x "$herdr_bin" ]]; then
    printf '%s\n' "$herdr_bin"
    return 0
  fi

  if command -v herdr >/dev/null 2>&1; then
    command -v herdr
    return 0
  fi

  return 1
}

link_or_replace_path() {
  local source_path="$1"
  local target_path="$2"
  local label="$3"
  local resolved_source_path=""
  local resolved_target_path=""
  local backup_path=""

  resolved_source_path="$(canonicalize_path "$source_path")"

  if [[ -L "$target_path" ]]; then
    resolved_target_path="$(resolve_symlink_target "$target_path")"
    if [[ "$resolved_target_path" == "$resolved_source_path" ]]; then
      log_item "$label: already linked"
      return 0
    fi

    run_cmd rm -f -- "$target_path"
  elif [[ -e "$target_path" ]]; then
    backup_path="$(next_backup_path "$target_path")"
    run_cmd mv "$target_path" "$backup_path"
    log_item "$label: backed up to $backup_path"
  fi

  ensure_dir "$(dirname "$target_path")"
  run_cmd ln -s "$source_path" "$target_path"
  log_item "$label: linked"
}

expose_herdr_for_moshi_probe() {
  local herdr_bin=""

  if ! herdr_bin="$(resolve_herdr_bin 2>/dev/null)"; then
    log_item "herdr: not installed yet, skipping Moshi probe symlink"
    return 0
  fi

  # Moshi's non-interactive SSH probe checks ~/.local/bin before shell startup files.
  # Link the real mise-installed Herdr binary there so Herdr session detection works.
  link_or_replace_path "$herdr_bin" "$HOME/.local/bin/herdr" "herdr Moshi probe binary"
}

configure_mosh_firewall() {
  if [[ "$(uname -s)" == "Darwin" ]]; then
    return 0
  fi

  if ! check_installed ufw; then
    log_item "ufw not available, skipping mosh firewall rule"
    return 0
  fi

  log_item "Allowing mosh UDP range on tailscale0"
  run_cmd sudo ufw allow in on tailscale0 proto udp to any port 60000:61000 comment 'mosh over Tailscale'
}

configure_moshi_hook_service() {
  local moshi_hook_bin=""

  if ! moshi_hook_bin="$(resolve_moshi_hook_bin 2>/dev/null)"; then
    log_item "moshi-hook not available, skipping service setup"
    return 0
  fi

  if [[ "$(uname -s)" == "Darwin" ]]; then
    if check_installed brew; then
      run_cmd brew services start moshi-hook
    else
      log_item "Homebrew not available, skipping moshi-hook service setup"
    fi
    return 0
  fi

  if ! check_installed systemctl; then
    log_item "systemctl not available, skipping moshi-hook service setup"
    return 0
  fi

  run_cmd "$moshi_hook_bin" service install
}

apply_moshi() {
  log_section "Moshi"
  install_moshi_hook_binary
  expose_herdr_for_moshi_probe
  configure_mosh_firewall
  configure_moshi_hook_service

  log_item "Pairing remains manual: moshi-hook pair --token <token-from-Moshi>"
  log_item "Easy Pair remains manual: moshi-hook host setup --host <tailscale-ip> --name <name> --user $USER"
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  apply_moshi
fi
