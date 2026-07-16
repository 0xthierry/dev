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

assert_exists() {
  local name="$1"
  local path="$2"

  if [[ -e "$path" || -L "$path" ]]; then
    printf 'ok: %s\n' "$name"
    return 0
  fi

  printf 'not ok: %s\n' "$name" >&2
  return 1
}

assert_absent() {
  local name="$1"
  local path="$2"

  if [[ ! -e "$path" && ! -L "$path" ]]; then
    printf 'ok: %s\n' "$name"
    return 0
  fi

  printf 'not ok: %s\n' "$name" >&2
  return 1
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
  export NPM_TEST_LOG="$TEST_TMP_DIR/npm.log"

  mkdir -p \
    "$HOME/.grok/bin" \
    "$HOME/.grok/downloads" \
    "$HOME/.grok/completions/zsh" \
    "$HOME/.grok/sessions" \
    "$HOME/.local/bin" \
    "$TEST_TMP_DIR/fake-bin"

  touch \
    "$HOME/.grok/bin/grok" \
    "$HOME/.grok/bin/agent" \
    "$HOME/.grok/downloads/grok-linux-x64" \
    "$HOME/.grok/completions/zsh/_grok" \
    "$HOME/.grok/auth.json" \
    "$HOME/.grok/config.toml" \
    "$HOME/.grok/sessions/kept.json"

  cat > "$TEST_TMP_DIR/cursor-agent" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  chmod +x "$TEST_TMP_DIR/cursor-agent"

  ln -s "$HOME/.grok/bin/grok" "$HOME/.local/bin/grok"
  ln -s "$HOME/.grok/bin/agent" "$HOME/.local/bin/agent"
  ln -s "$TEST_TMP_DIR/cursor-agent" "$HOME/.local/bin/cursor-agent"

  cat > "$HOME/.zshrc" <<'EOF'
# before Grok
# >>> grok installer >>>
export PATH="$HOME/.grok/bin:$PATH"
fpath=(~/.grok/completions/zsh $fpath)
# <<< grok installer <<<
# after Grok
EOF

  cat > "$TEST_TMP_DIR/fake-bin/npm" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$NPM_TEST_LOG"
exit 0
EOF
  chmod +x "$TEST_TMP_DIR/fake-bin/npm"

  DRY_RUN=0 uninstall_grok_cli

  assert_absent "removes Grok bin directory" "$HOME/.grok/bin"
  assert_absent "removes Grok download directory" "$HOME/.grok/downloads"
  assert_absent "removes Grok completion directory" "$HOME/.grok/completions"
  assert_absent "removes Grok command symlink" "$HOME/.local/bin/grok"

  assert_exists "preserves Grok authentication" "$HOME/.grok/auth.json"
  assert_exists "preserves Grok configuration" "$HOME/.grok/config.toml"
  assert_exists "preserves Grok sessions" "$HOME/.grok/sessions/kept.json"

  assert_file_contains "preserves shell content before installer block" "$HOME/.zshrc" "# before Grok"
  assert_file_contains "preserves shell content after installer block" "$HOME/.zshrc" "# after Grok"
  assert_file_excludes "removes Grok shell installer block" "$HOME/.zshrc" "grok installer"
  assert_file_excludes "removes Grok PATH entry" "$HOME/.zshrc" '.grok/bin'

  assert_file_contains "uninstalls official Grok npm package" "$NPM_TEST_LOG" "uninstall -g @xai-official/grok"

  if [[ -L "$HOME/.local/bin/agent" ]] && [[ "$(readlink "$HOME/.local/bin/agent")" == "$HOME/.local/bin/cursor-agent" ]]; then
    printf 'ok: restores Cursor agent alias\n'
  else
    printf 'not ok: restores Cursor agent alias\n' >&2
    return 1
  fi

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
