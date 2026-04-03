#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SHARED_ENV_VARS=(
  "EDITOR=nvim"
  "VISUAL=nvim"
  "PAGER=less -R"
  "OPENCODE_ENABLE_EXA=true"
)

write_env_file() {
  local target="$HOME/.config/dev-setup/env.sh"
  local tmp=""
  local entry=""

  log_section "Environment"
  ensure_dir "$(dirname "$target")"

  tmp="$(mktemp)"
  {
    for entry in "${SHARED_ENV_VARS[@]}"; do
      printf 'export %s\n' "$entry"
    done

    for entry in "${HOST_ENV_VARS[@]}"; do
      printf 'export %s\n' "$entry"
    done
  } > "$tmp"

  write_if_changed "$tmp" "$target"
  log_item "Environment file: $target"
}
