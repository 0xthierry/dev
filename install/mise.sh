#!/usr/bin/env bash
# Install mise language runtimes
set -e
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

install_runtimes() {
  log_section "Mise Runtimes"

  if ! command -v mise &> /dev/null; then
    log_item "Mise not installed, skipping runtimes"
    return 0
  fi

  log_item "Installing language runtimes..."
  mise install
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  install_runtimes
fi
