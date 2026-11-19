#!/usr/bin/env bash
# Shared Claude Code inline images plugin from the repo-owned local marketplace.
set -euo pipefail
# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

CLAUDE_INLINE_IMAGES_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

configure_claude_inline_images() {
  log_section "Claude Code inline images plugin"
  local marketplace="$CLAUDE_INLINE_IMAGES_REPO_ROOT/configs/agents/claude/plugins"
  local plugin="inline-images@thierry-local" plugins
  if (( ${DRY_RUN:-0} )); then
    dry_run_cmd claude plugin marketplace add "$marketplace"
    dry_run_cmd claude plugin install --scope user "$plugin"
    log_item "Would enable $plugin at user scope only if disabled"
    return 0
  fi
  if ! command -v claude >/dev/null 2>&1; then
    printf 'error: install Claude Code before configuring the inline images plugin\n' >&2
    return 1
  fi
  # Re-adding the same source restores its user-settings declaration safely.
  claude plugin marketplace add "$marketplace" || return $?
  claude plugin install --scope user "$plugin" || return $?
  plugins="$(claude plugin list --json)" || return $?
  # Claude returns an error when enable is called on an enabled plugin.
  if jq -e --arg id "$plugin" 'any(.[]; .id == $id and .scope == "user" and .enabled == false)' <<< "$plugins" >/dev/null; then
    claude plugin enable --scope user "$plugin" || return $?
  fi
}
