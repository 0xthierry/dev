#!/usr/bin/env bash
# Install agents hooks dependencies
set -euo pipefail
# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

install_hooks() {
  local repo_path="$1"
  local hooks_dir="$repo_path/configs/agents/hooks"

  log_section "Agent Hooks"

  if [ ! -d "$hooks_dir" ]; then
    log_item "Hooks directory not found: $hooks_dir"
    return 0
  fi

  if ! (( ${DRY_RUN:-0} )) && ! command -v bun &> /dev/null; then
    log_item "Bun not installed, skipping hooks"
    return 0
  fi

  log_item "Installing dependencies..."
  if (( ${DRY_RUN:-0} )); then
    dry_run_cmd /bin/bash -lc "cd $(printf '%q' "$hooks_dir") && bun install"
  else
    (cd "$hooks_dir" && bun install)
  fi
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  REPO_PATH="$(dirname "$SCRIPT_DIR")"
  install_hooks "$REPO_PATH"
fi
