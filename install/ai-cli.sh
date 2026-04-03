#!/usr/bin/env bash
# Install AI coding CLIs not provided by the base host packages
set -euo pipefail
# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

install_ai_clis() {
  log_section "AI Coding CLIs"

  # Claude Code (Anthropic)
  install_if_missing "Claude Code CLI" "claude" \
    "npm install -g @anthropic-ai/claude-code"

  # Codex (OpenAI)
  install_if_missing "Codex CLI" "codex" \
    "npm install -g @openai/codex"

  # Gemini CLI (Google)
  install_if_missing "Gemini CLI" "gemini" \
    "npm install -g @google/gemini-cli"
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  install_ai_clis
fi
