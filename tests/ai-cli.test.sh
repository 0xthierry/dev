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

  mkdir -p "$HOME/.grok/downloads"
  printf '#!/usr/bin/env bash\n' > "$HOME/.grok/downloads/grok-linux-x86_64"
  chmod +x "$HOME/.grok/downloads/grok-linux-x86_64"
  ln -s "$HOME/.grok/downloads/grok-linux-x86_64" "$HOME/.local/bin/grok"

  cat > "$HOME/.zshrc" <<'EOF'
# keep before
# >>> grok installer >>>
export PATH="$HOME/.grok/bin:$PATH"
# <<< grok installer <<<
# keep after
EOF

  export PI_TEST_LOG="$TEST_TMP_DIR/pi-args.log"
  cat > "$TEST_TMP_DIR/fake-bin/pi" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$PI_TEST_LOG"
EOF
  chmod +x "$TEST_TMP_DIR/fake-bin/pi"

  DRY_RUN=1 install_grok_pi_launcher > "$TEST_TMP_DIR/grok-dry-run.log"
  assert_file_contains "dry-run plans the Grok Pi launcher link" "$TEST_TMP_DIR/grok-dry-run.log" "ln -s $REPO_ROOT/scripts/grok $HOME/.local/bin/grok"
  if [[ "$(readlink "$HOME/.local/bin/grok")" == "$HOME/.grok/downloads/grok-linux-x86_64" ]]; then
    printf 'ok: Grok Pi launcher dry-run preserves the installed command\n'
  else
    printf 'not ok: Grok Pi launcher dry-run preserves the installed command\n' >&2
    return 1
  fi

  DRY_RUN=0 install_grok_pi_launcher
  assert_file_contains "preserves shell content around the Grok block" "$HOME/.zshrc" "# keep after"
  assert_file_excludes "removes installer-managed Grok shell config" "$HOME/.zshrc" "grok installer"

  if [[ "$(readlink "$HOME/.local/bin/grok")" == "$REPO_ROOT/scripts/grok" ]]; then
    printf 'ok: installs the repo-managed Grok Pi launcher\n'
  else
    printf 'not ok: installs the repo-managed Grok Pi launcher\n' >&2
    return 1
  fi

  if [[ -L "$HOME/.local/bin/grok.bak" ]] \
    && [[ "$(readlink "$HOME/.local/bin/grok.bak")" == "$HOME/.grok/downloads/grok-linux-x86_64" ]]; then
    printf 'ok: preserves the replaced standalone Grok command\n'
  else
    printf 'not ok: preserves the replaced standalone Grok command\n' >&2
    return 1
  fi

  "$HOME/.local/bin/grok" "review this"
  printf '%s\n' --model xai/grok-4.6 --thinking high "review this" > "$TEST_TMP_DIR/expected-pi-args.log"
  if cmp -s "$PI_TEST_LOG" "$TEST_TMP_DIR/expected-pi-args.log"; then
    printf 'ok: Grok command launches Pi with Grok 4.6 and high thinking\n'
  else
    printf 'not ok: Grok command launches Pi with Grok 4.6 and high thinking\n' >&2
    return 1
  fi

  DRY_RUN=0 install_grok_pi_launcher >/dev/null
  if [[ ! -e "$HOME/.local/bin/grok.bak.1" && ! -L "$HOME/.local/bin/grok.bak.1" ]]; then
    printf 'ok: Grok Pi launcher installation is idempotent\n'
  else
    printf 'not ok: Grok Pi launcher installation is idempotent\n' >&2
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
