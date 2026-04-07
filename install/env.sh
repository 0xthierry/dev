#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SHARED_ENV_VARS=(
  "EDITOR=nvim"
  "VISUAL=nvim"
  "PAGER=less -R"
  "OPENCODE_ENABLE_EXA=true"
  "NODE_OPTIONS=--localstorage-file=\$HOME/.node-localstorage"
)

write_env_file() {
  local target="$HOME/.config/dev-setup/env.sh"
  local tmp=""
  local entry=""
  local key=""
  local value=""

  log_section "Environment"
  ensure_dir "$(dirname "$target")"

  tmp="$(mktemp)"
  {
    for entry in "${SHARED_ENV_VARS[@]}"; do
      key="${entry%%=*}"
      value="${entry#*=}"
      printf 'export %s="%s"\n' "$key" "$value"
    done

    for entry in "${HOST_ENV_VARS[@]}"; do
      key="${entry%%=*}"
      value="${entry#*=}"
      printf 'export %s="%s"\n' "$key" "$value"
    done
  } > "$tmp"

  write_if_changed "$tmp" "$target"
  log_item "Environment file: $target"
}
