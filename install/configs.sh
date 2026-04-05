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

apply_aerospace() {
  ensure_dir "$HOME/.config/aerospace"
  safe_link_path "$REPO_ROOT/configs/aerospace/aerospace.toml" "$HOME/.config/aerospace/aerospace.toml" "aerospace config"
}

apply_sketchybar() {
  ensure_dir "$HOME/.config/sketchybar"
  safe_link_path "$REPO_ROOT/configs/sketchybar/sketchybarrc" "$HOME/.config/sketchybar/sketchybarrc" "sketchybar config"
  safe_link_path "$REPO_ROOT/configs/sketchybar/plugins" "$HOME/.config/sketchybar/plugins" "sketchybar plugins"
}

apply_borders() {
  ensure_dir "$HOME/.config/borders"
  safe_link_path "$REPO_ROOT/configs/borders/bordersrc" "$HOME/.config/borders/bordersrc" "borders config"
}

apply_agents() {
  if (( ${DRY_RUN:-0} )); then
    "$REPO_ROOT/configs/agents/install.sh" --dry-run --yes
    return 0
  fi

  "$REPO_ROOT/configs/agents/install.sh" --yes
}
