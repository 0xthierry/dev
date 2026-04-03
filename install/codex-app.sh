#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

CODEX_APP_URL="https://persistent.oaistatic.com/codex-app-prod/Codex.dmg"
CODEX_APP_PATH="/Applications/Codex.app"
CODEX_APP_DMG_PATH=""
CODEX_APP_MOUNT_DIR=""

cleanup_codex_app_install() {
  trap - RETURN

  if [[ -n "$CODEX_APP_MOUNT_DIR" ]] && mount | grep -Fq "on $CODEX_APP_MOUNT_DIR "; then
    hdiutil detach "$CODEX_APP_MOUNT_DIR" >/dev/null 2>&1 || true
  fi

  if [[ -n "$CODEX_APP_DMG_PATH" ]]; then
    rm -f "$CODEX_APP_DMG_PATH"
  fi

  if [[ -n "$CODEX_APP_MOUNT_DIR" ]]; then
    rmdir "$CODEX_APP_MOUNT_DIR" >/dev/null 2>&1 || true
  fi

  CODEX_APP_DMG_PATH=""
  CODEX_APP_MOUNT_DIR=""
}

install_codex_app_macos() {
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

  log_item "Installing Codex.app..."
  CODEX_APP_DMG_PATH="$(mktemp /tmp/codex-app.XXXXXX.dmg)"
  CODEX_APP_MOUNT_DIR="$(mktemp -d /tmp/codex-app-mount.XXXXXX)"
  trap cleanup_codex_app_install RETURN

  run_cmd curl -L "$CODEX_APP_URL" -o "$CODEX_APP_DMG_PATH"
  run_cmd hdiutil attach -nobrowse -mountpoint "$CODEX_APP_MOUNT_DIR" "$CODEX_APP_DMG_PATH"

  source_app_path="$CODEX_APP_MOUNT_DIR/Codex.app"
  if [[ ! -d "$source_app_path" ]]; then
    printf 'error: Codex.app not found in mounted DMG: %s\n' "$source_app_path" >&2
    return 1
  fi

  run_cmd sudo ditto "$source_app_path" "$CODEX_APP_PATH"
  log_item "Codex.app: installed"
}
