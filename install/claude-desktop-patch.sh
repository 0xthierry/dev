#!/usr/bin/env bash
# macOS-only vendor version pin. Snapshot-patch deployment is blocked by AMFI.
set -euo pipefail

# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

apply_claude_desktop_pinned() {
  local repo_root="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
  log_section "Pinned Claude Desktop (snapshot patch deployment blocked)"
  if [[ "$(uname -s)" != Darwin ]]; then
    printf 'error: Claude Desktop snapshot patch supports macOS only\n' >&2
    return 1
  fi
  run_cmd python3 "$repo_root/scripts/claude_desktop_snapshot_install.py" pin
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  apply_claude_desktop_pinned
fi
