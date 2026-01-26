#!/usr/bin/env bash
# Install Claude hooks dependencies
set -e
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

install_hooks() {
  local repo_path="$1"
  local hooks_dir="$repo_path/configs/claude/hooks"

  log_section "Claude Hooks"

  if [ ! -d "$hooks_dir" ]; then
    log_item "Hooks directory not found: $hooks_dir"
    return 0
  fi

  if ! command -v bun &> /dev/null; then
    log_item "Bun not installed, skipping hooks"
    return 1
  fi

  log_item "Installing dependencies..."
  (cd "$hooks_dir" && bun install)
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  REPO_PATH="$(dirname "$SCRIPT_DIR")"
  install_hooks "$REPO_PATH"
fi
