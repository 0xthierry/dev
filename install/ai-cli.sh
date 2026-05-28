#!/usr/bin/env bash
# Install AI coding CLIs not provided by the base host packages
set -euo pipefail
# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

install_npm_global_cli() {
  local name="$1"
  local package_name="$2"
  local version="$3"
  local npm_bin=""
  local mise_bin=""
  local -a install_cmd=()

  if npm_bin="$(command -v npm 2>/dev/null)"; then
    install_cmd=("$npm_bin" install -g "${package_name}@${version}")
  elif mise_bin="$(resolve_mise_bin 2>/dev/null)"; then
    install_cmd=("$mise_bin" exec node -- npm install -g "${package_name}@${version}")
  else
    printf 'error: npm is unavailable and mise is not installed; cannot install %s\n' "$name" >&2
    return 1
  fi

  log_item "Installing $name @ $version..."
  run_cmd "${install_cmd[@]}"
}

npm_global_bin_points_to_package() {
  local npm_bin="$1"
  local bin_name="$2"
  local package_name="$3"
  local global_root=""
  local prefix=""
  local bin_path=""
  local package_dir=""
  local resolved_bin_path=""
  local resolved_package_dir=""

  global_root="$("$npm_bin" root -g 2>/dev/null || true)"
  prefix="$("$npm_bin" prefix -g 2>/dev/null || true)"

  if [[ -z "$global_root" || -z "$prefix" ]]; then
    return 1
  fi

  bin_path="$prefix/bin/$bin_name"
  package_dir="$global_root/$package_name"

  if [[ ! -L "$bin_path" || ! -d "$package_dir" ]]; then
    return 1
  fi

  resolved_bin_path="$(resolve_symlink_target "$bin_path")"
  resolved_package_dir="$(canonicalize_path "$package_dir")"

  [[ "$resolved_bin_path" == "$resolved_package_dir"/* ]]
}

install_pi_coding_agent_cli() {
  local version="$1"
  local package_name="@earendil-works/pi-coding-agent"
  local legacy_package_name="@mariozechner/pi-coding-agent"
  local npm_bin=""
  local mise_bin=""
  local force_reason=""
  local -a install_cmd=()

  if npm_bin="$(command -v npm 2>/dev/null)"; then
    if npm_global_bin_points_to_package "$npm_bin" "pi" "$legacy_package_name"; then
      # The package moved scopes but keeps the same `pi` bin; claim the bin without removing the legacy package.
      install_cmd=("$npm_bin" install -g --force "${package_name}@${version}")
      force_reason=" (claiming pi bin from legacy $legacy_package_name)"
    else
      install_cmd=("$npm_bin" install -g "${package_name}@${version}")
    fi
  elif mise_bin="$(resolve_mise_bin 2>/dev/null)"; then
    install_cmd=("$mise_bin" exec node -- npm install -g "${package_name}@${version}")
  else
    printf 'error: npm is unavailable and mise is not installed; cannot install Pi Coding Agent\n' >&2
    return 1
  fi

  log_item "Installing Pi Coding Agent @ $version$force_reason..."
  run_cmd "${install_cmd[@]}"
}

install_claude_code_binary() {
  local version="$1"
  log_item "Installing Claude Code CLI @ $version..."
  # shellcheck disable=SC2016  # $0 is intentionally expanded by the inner bash, not the outer one
  run_cmd bash -c 'curl -fsSL https://claude.ai/install.sh | bash -s -- "$0"' "$version"
}

install_agent_slack_binary() {
  local version="$1"
  log_item "Installing Agent Slack @ $version..."
  run_cmd env "AGENT_SLACK_VERSION=$version" \
    bash -c 'curl -fsSL https://raw.githubusercontent.com/stablyai/agent-slack/main/install.sh | sh'
}

install_notion_cli_binary() {
  local version="$1"
  local install_dir="$HOME/.local/bin"

  ensure_dir "$install_dir"
  log_item "Installing Notion CLI @ $version to $install_dir..."
  run_cmd env "NTN_VERSION=$version" "NTN_INSTALL_DIR=$install_dir" \
    bash -c 'curl -fsSL https://ntn.dev | bash'
}

install_agent_browser_binary() {
  local version="$1"
  local npm_bin=""
  local mise_bin=""
  local -a install_cmd=()

  if npm_bin="$(command -v npm 2>/dev/null)"; then
    install_cmd=("$npm_bin" install -g "agent-browser@${version}")
  elif mise_bin="$(resolve_mise_bin 2>/dev/null)"; then
    install_cmd=("$mise_bin" exec node -- npm install -g "agent-browser@${version}")
  else
    printf 'error: npm is unavailable and mise is not installed; cannot install agent-browser\n' >&2
    return 1
  fi

  log_item "Installing Agent Browser @ $version..."
  run_cmd "${install_cmd[@]}"

  log_item "Running Agent Browser setup..."
  run_cmd agent-browser install
}

install_ai_clis() {
  log_section "AI Coding CLIs"

  # Claude Code (Anthropic) — standalone binary, not npm
  install_claude_code_binary "2.1.153"

  # Codex (OpenAI)
  install_npm_global_cli "Codex CLI" "@openai/codex" "0.133.0"

  # Gemini CLI (Google)
  install_npm_global_cli "Gemini CLI" "@google/gemini-cli" "0.40.1"

  # Pi Coding Agent (Earendil Works) — minimal terminal coding harness
  install_pi_coding_agent_cli "0.75.5"

  # Agent Slack (Stably) — standalone binary
  install_agent_slack_binary "0.9.1"

  # Agent Browser — npm package (crates.io lags behind)
  install_agent_browser_binary "0.26.0"

  # Linear CLI (schpet) — agent-friendly Linear.app CLI
  install_npm_global_cli "Linear CLI" "@schpet/linear-cli" "2.0.0"

  # Notion CLI (makenotion) — `ntn` binary, pairs with notion-cli skill
  install_notion_cli_binary "v0.12.0"

  # Railway CLI — deploy/manage Railway projects
  install_npm_global_cli "Railway CLI" "@railway/cli" "4.58.0"
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  install_ai_clis
fi
