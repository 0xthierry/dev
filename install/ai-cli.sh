#!/usr/bin/env bash
# Install AI coding CLIs not provided by the base host packages
set -euo pipefail
# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

AMQ_SOURCE_URL="https://github.com/avivsinai/agent-message-queue.git"
AMQ_VERSION="v0.43.1"
AMQ_COMMIT="fb365f533e67521c87ae263cc276eb10eb85e983"

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

install_plannotator_binary() {
  local version="$1"
  log_item "Installing Plannotator @ $version..."
  # Install only the pinned binary; repo-owned agent config supplies hooks and skills.
  # shellcheck disable=SC2016  # $0 is intentionally expanded by the inner bash, not the outer one
  run_cmd bash -c 'curl -fsSL https://plannotator.ai/install.sh | bash -s -- --version "$0" --minimal' "$version"
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

grok_owned_symlink() {
  local path="$1"
  local resolved_target=""

  [[ -L "$path" ]] || return 1
  resolved_target="$(resolve_symlink_target "$path")"
  [[ "$resolved_target" == "$HOME/.grok/"* ]]
}

remove_grok_owned_symlink() {
  local path="$1"

  if ! grok_owned_symlink "$path"; then
    return 0
  fi

  log_item "Removing Grok CLI symlink: $path"
  run_cmd rm -f "$path"
}

remove_grok_shell_block() {
  local shell_file="$1"

  if [[ ! -f "$shell_file" ]] || ! grep -q '# >>> grok installer >>>' "$shell_file"; then
    return 0
  fi

  log_item "Removing Grok CLI shell configuration: $shell_file"
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

uninstall_grok_npm_package() {
  local npm_bin=""
  local mise_bin=""
  local -a npm_cmd=()

  if npm_bin="$(command -v npm 2>/dev/null)"; then
    npm_cmd=("$npm_bin")
  elif mise_bin="$(resolve_mise_bin 2>/dev/null)"; then
    npm_cmd=("$mise_bin" exec node -- npm)
  else
    return 0
  fi

  if (( ${DRY_RUN:-0} )); then
    dry_run_cmd "${npm_cmd[@]}" uninstall -g @xai-official/grok
    return 0
  fi

  if "${npm_cmd[@]}" list -g --depth=0 @xai-official/grok >/dev/null 2>&1; then
    log_item "Uninstalling Grok CLI npm package..."
    run_cmd "${npm_cmd[@]}" uninstall -g @xai-official/grok
  fi
}

uninstall_grok_cli() {
  local artifact=""
  local shell_file=""

  log_item "Ensuring Grok CLI is uninstalled..."

  for artifact in "$HOME/.local/bin/grok" "$HOME/.local/bin/agent" /usr/local/bin/grok /usr/local/bin/agent; do
    remove_grok_owned_symlink "$artifact"
  done

  for artifact in "$HOME/.grok/bin" "$HOME/.grok/downloads" "$HOME/.grok/completions"; do
    if [[ -e "$artifact" || -L "$artifact" ]]; then
      log_item "Removing Grok CLI artifact: $artifact"
      run_cmd rm -rf "$artifact"
    fi
  done

  for shell_file in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.config/fish/config.fish"; do
    remove_grok_shell_block "$shell_file"
  done

  uninstall_grok_npm_package

  # Preserve ~/.grok user state (auth, config, sessions), and return the generic
  # `agent` alias to Cursor when Cursor is already present.
  restore_cursor_agent_alias
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
  install_claude_code_binary "2.1.211"

  # Codex (OpenAI)
  install_npm_global_cli "Codex CLI" "@openai/codex" "0.144.5"

  # Gemini CLI (Google)
  install_npm_global_cli "Gemini CLI" "@google/gemini-cli" "0.50.0"

  # Pi Coding Agent (Earendil Works) — minimal terminal coding harness
  install_pi_coding_agent_cli "0.80.8"

  # Plannotator — plan and code review UI; hooks and skills are deployed from this repo
  install_plannotator_binary "v0.23.1"

  # Agent Slack (Stably) — standalone binary
  install_agent_slack_binary "0.9.3"

  # Agent Browser — npm package (crates.io lags behind)
  install_agent_browser_binary "0.32.1"

  # Agent Message Queue — local file-based inter-agent bus, built from a pinned source tag+commit
  install_amq_from_source

  # Linear CLI (schpet) — agent-friendly Linear.app CLI
  install_npm_global_cli "Linear CLI" "@schpet/linear-cli" "2.0.0"

  # Notion CLI (makenotion) — `ntn` binary, pairs with notion-cli skill
  install_notion_cli_binary "v0.19.0"

  # Factory CLI — `droid` binary
  install_factory_cli_binary

  # Grok CLI is no longer part of this setup. Remove installer-managed artifacts
  # on every host while preserving authentication, config, and session data.
  uninstall_grok_cli

  # Cursor Agent CLI — `cursor-agent` binary; installed after Grok cleanup so
  # Cursor owns the generic `agent` alias.
  install_cursor_agent_cli_binary

  # Railway CLI — deploy/manage Railway projects
  install_npm_global_cli "Railway CLI" "@railway/cli" "5.26.2"
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  install_ai_clis
fi
