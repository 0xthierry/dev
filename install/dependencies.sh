#!/usr/bin/env bash
# Install repository-level JavaScript dependencies
set -euo pipefail
# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

install_repo_dependencies() {
  local repo_path="$1"

  log_section "Repository Dependencies"

  if [[ ! -f "$repo_path/package.json" ]]; then
    log_item "Root package.json not found: $repo_path/package.json"
    return 0
  fi

  if (( ${DRY_RUN:-0} )); then
    dry_run_cmd /bin/bash -lc "cd $(printf '%q' "$repo_path") && bun install --frozen-lockfile"
    return 0
  fi

  if ! command -v bun &> /dev/null; then
    log_item "Bun not installed, skipping repository dependencies"
    return 0
  fi

  log_item "Installing root package.json dependencies..."
  (cd "$repo_path" && bun install --frozen-lockfile)
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  REPO_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
  install_repo_dependencies "$REPO_PATH"
fi
