#!/usr/bin/env bash
# Install the skill-driven diagnostics client; never launch or reconfigure Brave.
set -euo pipefail
# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

apply_browser_diagnostics() {
  local runtime="$REPO_ROOT/configs/browser-diagnostics"
  local command=""
  local source_path=""
  local target_path=""

  log_section "Browser Diagnostics"

  if [[ ! -f "$runtime/package.json" || ! -f "$runtime/bun.lock" ]]; then
    printf 'error: browser diagnostics package or frozen lockfile is missing: %s\n' "$runtime" >&2
    return 1
  fi

  for command in chrome-devtools-cli browser-diagnostics; do
    source_path="$runtime/bin/$command"
    target_path="$HOME/.local/bin/$command"
    if [[ ! -x "$source_path" ]]; then
      printf 'error: browser diagnostics entrypoint is missing or not executable: %s\n' "$source_path" >&2
      return 1
    fi
    if [[ -L "$target_path" ]] && [[ "$(resolve_symlink_target "$target_path")" != "$(canonicalize_path "$source_path")" ]]; then
      printf 'error: refusing to replace an unrelated diagnostics symlink: %s\n' "$target_path" >&2
      return 1
    fi
  done

  if (( ${DRY_RUN:-0} )); then
    dry_run_cmd /bin/bash -c "cd $(printf '%q' "$runtime") && bun install --frozen-lockfile --ignore-scripts"
  else
    if ! check_installed bun || ! check_installed node; then
      printf 'error: Bun and Node are required; run the host setup to install the declared mise runtimes\n' >&2
      return 1
    fi
    (cd "$runtime" && bun install --frozen-lockfile --ignore-scripts) || return $?
  fi

  ensure_dir "$HOME/.local/bin"
  for command in chrome-devtools-cli browser-diagnostics; do
    safe_link_path "$runtime/bin/$command" "$HOME/.local/bin/$command" "$command"
  done
  log_item "Diagnostics attach on demand to the existing local Brave CDP endpoint (127.0.0.1:9222)"
  log_item "No browser or background diagnostics process was started"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
  DRY_RUN=0
  if [[ $# -eq 1 && "$1" == "--dry-run" ]]; then
    DRY_RUN=1
  elif [[ $# -ne 0 ]]; then
    printf 'Usage: bash install/browser-diagnostics.sh [--dry-run]\n' >&2
    exit 1
  fi
  apply_browser_diagnostics
fi
