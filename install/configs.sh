#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

apply_nvim() {
  ensure_dir "$HOME/.config"
  safe_link_path "$REPO_ROOT/configs/nvim" "$HOME/.config/nvim" "nvim config"
}

apply_zellij() {
  ensure_dir "$HOME/.config"
  safe_link_path "$REPO_ROOT/configs/zellij" "$HOME/.config/zellij" "zellij config"
}

apply_hypr() {
  ensure_dir "$HOME/.config"
  safe_link_path "$REPO_ROOT/configs/hypr" "$HOME/.config/hypr" "hypr config"
}

apply_agents() {
  if (( ${DRY_RUN:-0} )); then
    "$REPO_ROOT/configs/agents/install.sh" --dry-run --yes
    return 0
  fi

  "$REPO_ROOT/configs/agents/install.sh" --yes
}
