#!/usr/bin/env bash
# Install AI coding CLIs not provided by pacman/Omarchy
# Claude Code and OpenCode are Omarchy defaults (pacman)
set -e
# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

install_ai_clis() {
  log_section "AI Coding CLIs"

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
