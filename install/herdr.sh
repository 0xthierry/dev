#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

resolve_herdr_bin() {
  local mise_bin=""
  local candidate=""

  # Prefer the concrete mise install. Moshi invokes this path from a remote,
  # non-interactive SSH probe where a shim may not have normal shell context.
  if command -v mise >/dev/null 2>&1; then
    mise_bin="$(command -v mise)"
  elif [[ -x "$HOME/.local/bin/mise" ]]; then
    mise_bin="$HOME/.local/bin/mise"
  fi
  if [[ -n "$mise_bin" ]]; then
    candidate="$("$mise_bin" which herdr 2>/dev/null || true)"
    if [[ -n "$candidate" && -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  fi

  if command -v herdr >/dev/null 2>&1; then
    command -v herdr
    return 0
  fi

  return 1
}

configure_herdr_agent_integrations() {
  local herdr_bin=""
  local status_output=""
  local configured_targets=""
  local target_command=""
  local target=""
  local command_name=""
  local -a existing_targets=()
  local -a target_commands=(
    claude:claude
    codex:codex
    opencode:opencode
    cursor:cursor-agent
    grok:grok
    antigravity-cli:antigravity
    kimi:kimi
    qwen:qwen
    omp:omp
    hermes:hermes
  )

  if (( ${DRY_RUN:-0} )); then
    herdr_bin="herdr"
  elif ! herdr_bin="$(resolve_herdr_bin 2>/dev/null)"; then
    log_item "Herdr not available, skipping agent integrations"
    return 0
  fi

  if (( ${DRY_RUN:-0} )); then
    status_output="$("$herdr_bin" integration status 2>/dev/null || true)"
  elif ! status_output="$("$herdr_bin" integration status 2>/dev/null)"; then
    printf 'error: could not inspect Herdr agent integration status\n' >&2
    return 1
  fi
  if (( ! ${DRY_RUN:-0} )) && ! grep -q '^pi: current ' <<< "$status_output"; then
    log_item "Herdr Pi integration is not current; refresh configs/agents/pi/extensions/herdr-agent-state.ts from the pinned Herdr release"
  fi

  # Refresh every existing non-Pi integration, including temporarily absent
  # agent binaries. Pi is a repository-owned generated extension.
  configured_targets="$(
    awk -F: '$0 !~ /: not installed / && $1 != "pi" { print $1 }' <<< "$status_output" \
      | paste -sd' ' -
  )"
  IFS=' ' read -r -a existing_targets <<< "$configured_targets"
  for target in "${existing_targets[@]}"; do
    run_cmd "$herdr_bin" integration install "$target"
  done

  # Add integrations for installed agents that do not have one yet.
  for target_command in "${target_commands[@]}"; do
    target="${target_command%%:*}"
    command_name="${target_command#*:}"
    if check_installed "$command_name" && [[ " $configured_targets " != *" $target "* ]]; then
      run_cmd "$herdr_bin" integration install "$target"
    fi
  done
}
