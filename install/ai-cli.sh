#!/usr/bin/env bash
# Install AI coding CLIs not provided by the base host packages
set -euo pipefail
# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

install_npm_global_cli() {
  local name="$1"
  local cmd="$2"
  local package_name="$3"
  local npm_bin=""
  local mise_bin=""
  local -a install_cmd=()

  if check_installed "$cmd"; then
    log_item "$name: installed"
    return 0
  fi

  if npm_bin="$(command -v npm 2>/dev/null)"; then
    install_cmd=("$npm_bin" install -g "$package_name")
  elif mise_bin="$(resolve_mise_bin 2>/dev/null)"; then
    install_cmd=("$mise_bin" exec node -- npm install -g "$package_name")
  else
    printf 'error: npm is unavailable and mise is not installed; cannot install %s\n' "$name" >&2
    return 1
  fi

  log_item "Installing $name..."
  run_cmd "${install_cmd[@]}"
}

install_claude_code_binary() {
  if check_installed claude; then
    log_item "Claude Code CLI: installed"
    return 0
  fi

  log_item "Installing Claude Code CLI..."
  run_cmd bash -c 'curl -fsSL https://claude.ai/install.sh | bash'
}

install_agent_slack_binary() {
  if check_installed agent-slack; then
    log_item "Agent Slack: installed"
    return 0
  fi

  log_item "Installing Agent Slack..."
  run_cmd bash -c 'curl -fsSL https://raw.githubusercontent.com/stablyai/agent-slack/main/install.sh | sh'
}

install_agent_browser_binary() {
  local npm_bin=""
  local mise_bin=""
  local -a install_cmd=()

  if npm_bin="$(command -v npm 2>/dev/null)"; then
    install_cmd=("$npm_bin" install -g agent-browser@latest)
  elif mise_bin="$(resolve_mise_bin 2>/dev/null)"; then
    install_cmd=("$mise_bin" exec node -- npm install -g agent-browser@latest)
  else
    printf 'error: npm is unavailable and mise is not installed; cannot install agent-browser\n' >&2
    return 1
  fi

  log_item "Installing/upgrading Agent Browser..."
  run_cmd "${install_cmd[@]}"

  log_item "Running Agent Browser setup..."
  run_cmd agent-browser install
}

install_ai_clis() {
  log_section "AI Coding CLIs"

  # Claude Code (Anthropic) — standalone binary, not npm
  install_claude_code_binary

  # Codex (OpenAI)
  install_npm_global_cli "Codex CLI" "codex" "@openai/codex"

  # Gemini CLI (Google)
  install_npm_global_cli "Gemini CLI" "gemini" "@google/gemini-cli"

  # Agent Slack (Stably) — standalone binary
  install_agent_slack_binary

  # Agent Browser — npm package (crates.io lags behind)
  install_agent_browser_binary
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  install_ai_clis
fi
