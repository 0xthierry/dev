#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

install_zed_linux() {
  local install_script='curl -f https://zed.dev/install.sh | sh'

  log_section "Zed"

  if command -v zed >/dev/null 2>&1; then
    log_item "Zed: installed"
    return 0
  fi

  log_item "Installing Zed..."
  run_cmd /bin/bash -lc "$install_script"
}
