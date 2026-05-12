#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

apply_pnpm_security_defaults() {
  if ! check_installed pnpm; then
    log_item "pnpm config: pnpm not installed, skipping"
    return 0
  fi

  log_item "pnpm config: frozen lockfile + 24h minimum release age"
  run_cmd pnpm config set -g frozen-lockfile true
  run_cmd pnpm config set -g minimum-release-age 1440
}

apply_bun_config() {
  safe_link_path "$REPO_ROOT/configs/cli/bun/bunfig.toml" "$HOME/.bunfig.toml" "bun config"
}

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

  apply_pnpm_security_defaults
  apply_bun_config
}
