#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_TMP_DIR=""
ORIGINAL_HOME="$HOME"
ORIGINAL_PATH="$PATH"

# shellcheck disable=SC1091
source "$REPO_ROOT/install/ai-cli.sh"

cleanup() {
  HOME="$ORIGINAL_HOME"
  PATH="$ORIGINAL_PATH"
  if [[ -n "$TEST_TMP_DIR" ]]; then
    rm -rf "$TEST_TMP_DIR"
  fi
}

assert_file_contains() {
  local name="$1"
  local path="$2"
  local expected="$3"

  if grep -Fq -- "$expected" "$path"; then
    printf 'ok: %s\n' "$name"
    return 0
  fi

  printf 'not ok: %s\n' "$name" >&2
  return 1
}

assert_file_excludes() {
  local name="$1"
  local path="$2"
  local unexpected="$3"

  if ! grep -Fq -- "$unexpected" "$path"; then
    printf 'ok: %s\n' "$name"
    return 0
  fi

  printf 'not ok: %s\n' "$name" >&2
  return 1
}

main() {
  TEST_TMP_DIR="$(mktemp -d)"
  trap cleanup EXIT

  HOME="$TEST_TMP_DIR/home"
  PATH="$HOME/.local/bin:$TEST_TMP_DIR/fake-bin:/usr/bin:/bin"
  export HOME PATH
  mkdir -p "$HOME/.local/bin" "$TEST_TMP_DIR/fake-bin"

  cat > "$HOME/.zshrc" <<'EOF'
# keep before
# >>> grok installer >>>
export PATH="$HOME/.grok/bin:$PATH"
# <<< grok installer <<<
# keep after
EOF
  DRY_RUN=0 remove_grok_shell_block "$HOME/.zshrc"
  assert_file_contains "preserves shell content around the Grok block" "$HOME/.zshrc" "# keep after"
  assert_file_excludes "removes installer-managed Grok shell config" "$HOME/.zshrc" "grok installer"

  DRY_RUN=1 install_grok_cli_binary "1.0.13" > "$TEST_TMP_DIR/grok-install.log"
  assert_file_contains "uses the official Grok installer" "$TEST_TMP_DIR/grok-install.log" "https://x.ai/cli/install.sh"
  assert_file_contains "pins the Grok CLI version" "$TEST_TMP_DIR/grok-install.log" "1.0.13"
  assert_file_contains "installs Grok in the shared user bin directory" "$TEST_TMP_DIR/grok-install.log" "GROK_BIN_DIR=$HOME/.local/bin"
  assert_file_contains "prevents the installer from editing shell files" "$TEST_TMP_DIR/grok-install.log" "PATH=$HOME/.local/bin:"

  # shellcheck disable=SC1091
  source "$REPO_ROOT/install/env.sh"
  printf '%s\n' "${SHARED_ENV_VARS[@]}" > "$TEST_TMP_DIR/env.log"
  assert_file_contains "disables Grok product telemetry" "$TEST_TMP_DIR/env.log" "GROK_TELEMETRY_ENABLED=false"
  assert_file_contains "disables Grok trace uploads" "$TEST_TMP_DIR/env.log" "GROK_TELEMETRY_TRACE_UPLOAD=false"
  assert_file_contains "disables Grok Mixpanel analytics" "$TEST_TMP_DIR/env.log" "GROK_TELEMETRY_MIXPANEL_ENABLED=false"
  assert_file_contains "disables Grok external telemetry" "$TEST_TMP_DIR/env.log" "GROK_EXTERNAL_OTEL=0"
  assert_file_contains "disables Grok feedback uploads" "$TEST_TMP_DIR/env.log" "GROK_FEEDBACK_ENABLED=false"
  assert_file_contains "disables Grok session relay sync" "$TEST_TMP_DIR/env.log" "GROK_RELAY_SYNC_ENABLED=false"

  export BREW_TEST_LOG="$TEST_TMP_DIR/brew.log"
  cat > "$TEST_TMP_DIR/fake-bin/uname" <<'EOF'
#!/usr/bin/env bash
printf 'Darwin\n'
EOF
  cat > "$TEST_TMP_DIR/fake-bin/brew" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$BREW_TEST_LOG"
exit 0
EOF
  chmod +x "$TEST_TMP_DIR/fake-bin/uname" "$TEST_TMP_DIR/fake-bin/brew"

  migrate_cursor_cli_from_homebrew
  assert_file_contains "migrates Cursor CLI away from Homebrew" "$BREW_TEST_LOG" "uninstall --cask cursor-cli"
}

main "$@"
