#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

apply_tool_configs() {
  log_section "Tool Configuration"

  ensure_dir "$HOME/.config/ripgrep"
  safe_link_path "$REPO_ROOT/configs/cli/ripgrep/config" "$HOME/.config/ripgrep/config" "ripgrep config"

  ensure_dir "$HOME/.config/fd"
  safe_link_path "$REPO_ROOT/configs/cli/fd/ignore" "$HOME/.config/fd/ignore" "fd ignore"

  ensure_dir "$HOME/.config/bat"
  safe_link_path "$REPO_ROOT/configs/cli/bat/config" "$HOME/.config/bat/config" "bat config"

  ensure_dir "$HOME/.config/delta"
  safe_link_path "$REPO_ROOT/configs/cli/delta/config" "$HOME/.config/delta/config" "delta config"

  ensure_dir "$HOME/.config/dev-setup"
  safe_link_path "$REPO_ROOT/configs/cli/fzf/env.sh" "$HOME/.config/dev-setup/fzf.sh" "fzf env"
}
