#!/usr/bin/env bash
# Install AI coding CLIs not provided by the base host packages
set -euo pipefail
# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

AMQ_SOURCE_URL="https://github.com/avivsinai/agent-message-queue.git"
AMQ_VERSION="v0.46.0"
AMQ_COMMIT="b2645f5b4d379d897239cef3e10c0f4a3a26f01e"

# True when an already-installed binary reports the pinned version. Each vendor
# prints a different shape ("plannotator 0.24.2", "2.1.219 (Claude Code)",
# "0.9.3"), so match the first semver-looking token and compare with any
# leading "v" stripped from both sides.
installed_binary_is_pinned() {
  local bin_name="$1"
  local expected="$2"
  local bin_path=""
  local actual=""

  bin_path="$(command -v "$bin_name" 2>/dev/null)" || return 1
  [[ -x "$bin_path" ]] || return 1

  actual="$(timeout 15 "$bin_path" --version 2>/dev/null \
    | head -1 \
    | grep -oE '[0-9]+\.[0-9]+\.[0-9]+[^[:space:]]*' \
    | head -1)"
  [[ -n "$actual" ]] || return 1

  [[ "${actual#v}" == "${expected#v}" ]]
}

# Version recorded in the globally installed package, or empty if absent.
# Reading package.json directly avoids `npm ls`, which is orders of magnitude
# slower than the `npm root -g` lookup it needs anyway.
npm_global_installed_version() {
  local package_name="$1"
  local global_root=""
  local manifest=""

  global_root="$(npm root -g 2>/dev/null)" || return 0
  manifest="$global_root/$package_name/package.json"
  [[ -f "$manifest" ]] || return 0

  sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$manifest" | head -1
}

install_npm_global_cli() {
  local name="$1"
  local package_name="$2"
  local version="$3"
  local npm_bin=""
  local mise_bin=""
  local installed=""
  local -a install_cmd=()

  if npm_bin="$(command -v npm 2>/dev/null)"; then
    install_cmd=("$npm_bin" install -g "${package_name}@${version}")
  elif mise_bin="$(resolve_mise_bin 2>/dev/null)"; then
    install_cmd=("$mise_bin" exec node -- npm install -g "${package_name}@${version}")
  else
    printf 'error: npm is unavailable and mise is not installed; cannot install %s\n' "$name" >&2
    return 1
  fi

  installed="$(npm_global_installed_version "$package_name")"
  if [[ -n "$installed" && "$installed" == "$version" ]]; then
    log_item "$name: already at $version"
    return 0
  fi

  if [[ -n "$installed" ]]; then
    log_item "Installing $name @ $version (replacing $installed)..."
  else
    log_item "Installing $name @ $version..."
  fi
  run_cmd "${install_cmd[@]}"
}

install_claude_code_binary() {
  local version="$1"
  if installed_binary_is_pinned "claude" "$version"; then
    log_item "Claude Code CLI: already at $version"
    return 0
  fi

  log_item "Installing Claude Code CLI @ $version..."
  # shellcheck disable=SC2016  # $0 is intentionally expanded by the inner bash, not the outer one
  run_cmd bash -c 'curl -fsSL https://claude.ai/install.sh | bash -s -- "$0"' "$version"
}

install_plannotator_binary() {
  local version="$1"
  if installed_binary_is_pinned "plannotator" "$version"; then
    log_item "Plannotator: already at $version"
    return 0
  fi

  log_item "Installing Plannotator @ $version..."
  # Install only the pinned binary; repo-owned agent config supplies hooks and skills.
  # shellcheck disable=SC2016  # $0 is intentionally expanded by the inner bash, not the outer one
  run_cmd bash -c 'curl -fsSL https://plannotator.ai/install.sh | bash -s -- --version "$0" --minimal' "$version"
}

install_agent_slack_binary() {
  local version="$1"
  if installed_binary_is_pinned "agent-slack" "$version"; then
    log_item "Agent Slack: already at $version"
    return 0
  fi

  log_item "Installing Agent Slack @ $version..."
  run_cmd env "AGENT_SLACK_VERSION=$version" \
    bash -c 'curl -fsSL https://raw.githubusercontent.com/stablyai/agent-slack/main/install.sh | sh'
}

install_notion_cli_binary() {
  local version="$1"
  local install_dir="$HOME/.local/bin"

  ensure_dir "$install_dir"
  if installed_binary_is_pinned "ntn" "$version"; then
    log_item "Notion CLI: already at $version"
    return 0
  fi

  log_item "Installing Notion CLI @ $version to $install_dir..."
  run_cmd env "NTN_VERSION=$version" "NTN_INSTALL_DIR=$install_dir" \
    bash -c 'curl -fsSL https://ntn.dev | bash'
}

install_factory_cli_binary() {
  log_item "Installing/updating Factory CLI (droid)..."
  run_cmd bash -c 'curl -fsSL https://app.factory.ai/cli | sh'
}

resolve_cursor_agent_bin() {
  if [[ "$(uname -s)" == "Darwin" ]]; then
    if [[ -x /opt/homebrew/bin/cursor-agent ]]; then
      printf '%s\n' /opt/homebrew/bin/cursor-agent
      return 0
    fi

    if [[ -x /usr/local/bin/cursor-agent ]]; then
      printf '%s\n' /usr/local/bin/cursor-agent
      return 0
    fi
  fi

  if command -v cursor-agent >/dev/null 2>&1; then
    command -v cursor-agent
    return 0
  fi

  return 1
}

restore_cursor_agent_alias() {
  local cursor_agent_bin=""

  cursor_agent_bin="$(resolve_cursor_agent_bin 2>/dev/null)" || return 0
  ensure_dir "$HOME/.local/bin"
  run_cmd ln -sf "$cursor_agent_bin" "$HOME/.local/bin/agent"
}

resolve_brew_bin_for_ai_cli() {
  if command -v brew >/dev/null 2>&1; then
    command -v brew
    return 0
  fi

  if [[ -x /opt/homebrew/bin/brew ]]; then
    printf '%s\n' /opt/homebrew/bin/brew
    return 0
  fi

  if [[ -x /usr/local/bin/brew ]]; then
    printf '%s\n' /usr/local/bin/brew
    return 0
  fi

  return 1
}

migrate_cursor_cli_from_homebrew() {
  local brew_bin=""

  if [[ "$(uname -s)" != "Darwin" ]]; then
    return 0
  fi

  if ! brew_bin="$(resolve_brew_bin_for_ai_cli 2>/dev/null)"; then
    return 0
  fi

  if ! "$brew_bin" list --cask --versions cursor-cli >/dev/null 2>&1; then
    return 0
  fi

  log_item "Migrating Cursor Agent CLI from Homebrew to the official installer..."
  run_cmd "$brew_bin" uninstall --cask cursor-cli
}

install_cursor_agent_cli_binary() {
  migrate_cursor_cli_from_homebrew
  log_item "Installing/updating Cursor Agent CLI..."
  run_cmd bash -c 'curl https://cursor.com/install -fsS | bash'
  restore_cursor_agent_alias
}

remove_grok_shell_block() {
  local shell_file="$1"

  if [[ ! -f "$shell_file" ]] || ! grep -q '# >>> grok installer >>>' "$shell_file"; then
    return 0
  fi

  log_item "Removing Grok installer shell configuration: $shell_file"
  # shellcheck disable=SC2016 # $1/$tmp are intentionally expanded by the inner bash.
  run_cmd bash -c '
    file="$1"
    tmp="${file}.dev-setup-grok.$$"
    trap '\''rm -f "$tmp"'\'' EXIT
    awk '\''
      /# >>> grok installer >>>/ { skip=1; next }
      /# <<< grok installer <<</ { skip=0; next }
      !skip { print }
    '\'' "$file" > "$tmp"
    cat "$tmp" > "$file"
  ' _ "$shell_file"
}

install_grok_cli_binary() {
  local version="$1"
  local install_dir="$HOME/.local/bin"
  local shell_file=""

  for shell_file in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.config/fish/config.fish"; do
    remove_grok_shell_block "$shell_file"
  done

  if installed_binary_is_pinned "grok" "$version"; then
    log_item "Grok CLI: already at $version"
    return 0
  fi

  ensure_dir "$install_dir"
  log_item "Installing Grok CLI @ $version..."
  # Install into the shared user bin directory and expose it to the installer so
  # it does not modify shell startup files managed by this repository.
  # shellcheck disable=SC2016 # $0 is intentionally expanded by the inner bash.
  run_cmd env "GROK_BIN_DIR=$install_dir" "PATH=$install_dir:$PATH" \
    bash -c 'curl -fsSL https://x.ai/cli/install.sh | bash -s -- "$0"' "$version"
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

install_amq_from_source() {
  local source_dir="$HOME/.local/share/dev-setup/sources/agent-message-queue"
  local install_dir="$HOME/.local/bin"
  local go_bin=""
  local mise_bin=""
  local resolved_commit=""
  local -a go_cmd=()

  # The pinned version is baked in via -ldflags, so a matching binary is proof
  # the pinned commit was already built. Skipping avoids a git fetch and a full
  # Go build on every run.
  if installed_binary_is_pinned "amq" "$AMQ_VERSION"; then
    log_item "AMQ: already at $AMQ_VERSION"
    return 0
  fi

  ensure_dir "$install_dir"
  ensure_dir "$(dirname "$source_dir")"

  if go_bin="$(command -v go 2>/dev/null)"; then
    go_cmd=("$go_bin")
  elif mise_bin="$(resolve_mise_bin 2>/dev/null)"; then
    go_cmd=("$mise_bin" exec go -- go)
  else
    printf 'error: go is unavailable and mise is not installed; cannot build AMQ\n' >&2
    return 1
  fi

  log_item "Installing AMQ from source @ $AMQ_VERSION ($AMQ_COMMIT)..."

  if [[ ! -d "$source_dir/.git" ]]; then
    run_cmd git clone "$AMQ_SOURCE_URL" "$source_dir"
  fi

  run_cmd git -C "$source_dir" fetch --tags --force origin

  if (( ! ${DRY_RUN:-0} )); then
    resolved_commit="$(git -C "$source_dir" rev-parse "$AMQ_VERSION^{commit}")"
    if [[ "$resolved_commit" != "$AMQ_COMMIT" ]]; then
      printf 'error: AMQ tag %s resolved to %s, expected pinned commit %s\n' "$AMQ_VERSION" "$resolved_commit" "$AMQ_COMMIT" >&2
      return 1
    fi
  fi

  run_cmd git -C "$source_dir" checkout --detach "$AMQ_COMMIT"
  run_cmd git -C "$source_dir" reset --hard "$AMQ_COMMIT"

  if (( ${DRY_RUN:-0} )); then
    # shellcheck disable=SC2016 # $1/$@ are intentionally expanded by the inner bash.
    dry_run_cmd bash -c 'cd "$1" && shift && AMQ_NO_UPDATE_CHECK=1 "$@"' _ "$source_dir" "${go_cmd[@]}" build -trimpath -ldflags "-s -w -X main.version=$AMQ_VERSION" -o "$install_dir/amq" ./cmd/amq
  else
    (
      cd "$source_dir"
      run_cmd env AMQ_NO_UPDATE_CHECK=1 "${go_cmd[@]}" build -trimpath -ldflags "-s -w -X main.version=$AMQ_VERSION" -o "$install_dir/amq" ./cmd/amq
    )
  fi
}

install_ai_clis() {
  log_section "AI Coding CLIs"

  # Claude Code (Anthropic) — standalone binary, not npm
  install_claude_code_binary "2.1.260"

  # Codex (OpenAI)
  install_npm_global_cli "Codex CLI" "@openai/codex" "0.153.2"

  # Gemini CLI (Google)
  install_npm_global_cli "Gemini CLI" "@google/gemini-cli" "0.56.0"

  # Pi Coding Agent is installed through mise's npm backend in install/mise.sh.
  # This keeps one Pi version active even when a project pins a different Node version.

  # Plannotator — plan and code review UI; hooks and skills are deployed from this repo
  install_plannotator_binary "v0.24.2"

  # Agent Slack (Stably) — standalone binary
  install_agent_slack_binary "0.9.3"

  # Agent Browser — npm package (crates.io lags behind)
  install_agent_browser_binary "0.33.0"

  # Agent Message Queue — local file-based inter-agent bus, built from a pinned source tag+commit
  install_amq_from_source

  # Linear CLI (schpet) — agent-friendly Linear.app CLI
  install_npm_global_cli "Linear CLI" "@schpet/linear-cli" "2.3.0"

  # Notion CLI (makenotion) — `ntn` binary, pairs with notion-cli skill
  install_notion_cli_binary "v0.20.0"

  # Factory CLI — `droid` binary
  install_factory_cli_binary

  # Grok CLI (xAI) — install first because its installer also creates a generic
  # `agent` alias; Cursor is installed afterwards and owns that alias.
  install_grok_cli_binary "1.0.13"

  # Cursor Agent CLI — `cursor-agent` binary
  install_cursor_agent_cli_binary

  # Railway CLI — deploy/manage Railway projects
  install_npm_global_cli "Railway CLI" "@railway/cli" "5.28.0"
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  install_ai_clis
fi
