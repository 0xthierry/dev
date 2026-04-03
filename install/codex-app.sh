#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

CODEX_APP_URL="https://persistent.oaistatic.com/codex-app-prod/Codex.dmg"
CODEX_APP_PATH="/Applications/Codex.app"

install_codex_app_macos() {
  local dmg_path=""
  local mount_dir=""
  local source_app_path=""

  log_section "Codex.app"

  if [[ -d "$CODEX_APP_PATH" ]]; then
    log_item "Codex.app: installed"
    return 0
  fi

  if (( ${DRY_RUN:-0} )); then
    log_item "Installing Codex.app..."
    dry_run_cmd curl -L "$CODEX_APP_URL" -o /tmp/codex-app.dmg
    dry_run_cmd hdiutil attach -nobrowse -mountpoint /tmp/codex-app-mount /tmp/codex-app.dmg
    dry_run_cmd sudo ditto /tmp/codex-app-mount/Codex.app "$CODEX_APP_PATH"
    dry_run_cmd hdiutil detach /tmp/codex-app-mount
    dry_run_cmd rm -f /tmp/codex-app.dmg
    dry_run_cmd rmdir /tmp/codex-app-mount
    return 0
  fi

  # shellcheck disable=SC2329
  cleanup_codex_app_install() {
    if [[ -n "$mount_dir" ]] && mount | grep -Fq "on $mount_dir "; then
      hdiutil detach "$mount_dir" >/dev/null 2>&1 || true
    fi

    if [[ -n "$dmg_path" ]]; then
      rm -f "$dmg_path"
    fi

    if [[ -n "$mount_dir" ]]; then
      rmdir "$mount_dir" >/dev/null 2>&1 || true
    fi
  }

  trap cleanup_codex_app_install RETURN

  log_item "Installing Codex.app..."
  dmg_path="$(mktemp /tmp/codex-app.XXXXXX.dmg)"
  mount_dir="$(mktemp -d /tmp/codex-app-mount.XXXXXX)"

  run_cmd curl -L "$CODEX_APP_URL" -o "$dmg_path"
  run_cmd hdiutil attach -nobrowse -mountpoint "$mount_dir" "$dmg_path"

  source_app_path="$mount_dir/Codex.app"
  if [[ ! -d "$source_app_path" ]]; then
    printf 'error: Codex.app not found in mounted DMG: %s\n' "$source_app_path" >&2
    return 1
  fi

  run_cmd sudo ditto "$source_app_path" "$CODEX_APP_PATH"
  log_item "Codex.app: installed"
}
