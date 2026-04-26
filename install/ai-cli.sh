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
  install_claude_code_binary "2.1.119"

  # Codex (OpenAI)
  install_npm_global_cli "Codex CLI" "@openai/codex" "0.125.0"

  # Gemini CLI (Google)
  install_npm_global_cli "Gemini CLI" "@google/gemini-cli" "0.39.1"

  # Pi Coding Agent (badlogic) — minimal terminal coding harness
  install_npm_global_cli "Pi Coding Agent" "@mariozechner/pi-coding-agent" "0.70.2"

  # Agent Slack (Stably) — standalone binary
  install_agent_slack_binary "0.8.5"

  # Agent Browser — npm package (crates.io lags behind)
  install_agent_browser_binary "0.26.0"
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  install_ai_clis
fi
