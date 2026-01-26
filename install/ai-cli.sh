#!/usr/bin/env bash
# Install AI coding CLIs (Claude, Codex, Gemini, OpenCode)
set -e
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

install_ai_clis() {
  log_section "AI Coding CLIs"

  # Claude (Anthropic)
  install_if_missing "Claude CLI" "claude" \
    "curl -fsSL https://claude.ai/install.sh | bash"

  # Codex (OpenAI)
  install_if_missing "Codex CLI" "codex" \
    "npm install -g @openai/codex"

  # Gemini CLI (Google)
  install_if_missing "Gemini CLI" "gemini" \
    "npm install -g @google/gemini-cli"

  # OpenCode
  install_if_missing "OpenCode" "opencode" \
    "curl -fsSL https://raw.githubusercontent.com/opencode-ai/opencode/refs/heads/main/install | bash"
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  install_ai_clis
fi
