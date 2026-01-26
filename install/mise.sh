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

  # Activate mise shims in current shell for subsequent steps
  log_item "Activating mise shims..."
  eval "$(mise activate bash)"
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  install_runtimes
fi
