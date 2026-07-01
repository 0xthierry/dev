#!/usr/bin/env bash
# Install Google Workspace CLI from official upstream package sources.
set -euo pipefail

# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
# shellcheck source=install/ai-cli.sh
source "$(dirname "${BASH_SOURCE[0]}")/ai-cli.sh"

GOOGLE_WORKSPACE_CLI_VERSION="0.22.5"

install_google_workspace_cli() {
  if [[ "${SETUP_HOST:-}" == "macbook" ]]; then
    return 0
  fi

  log_section "Google Workspace CLI"
  install_npm_global_cli "Google Workspace CLI" "@googleworkspace/cli" "$GOOGLE_WORKSPACE_CLI_VERSION"
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  install_google_workspace_cli
fi
