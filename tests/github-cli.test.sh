#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ORIGINAL_HOME="$HOME"
ORIGINAL_PATH="$PATH"
TEST_TMP_DIR=""

# shellcheck disable=SC1091
source "$REPO_ROOT/install/github-cli.sh"

cleanup() {
  HOME="$ORIGINAL_HOME"
  PATH="$ORIGINAL_PATH"
  if [[ -n "$TEST_TMP_DIR" ]]; then
    rm -rf "$TEST_TMP_DIR"
  fi
}

assert_equal() {
  local name="$1"
  local expected="$2"
  local actual="$3"

  if [[ "$actual" == "$expected" ]]; then
    printf 'ok: %s\n' "$name"
    return 0
  fi

  printf 'not ok: %s (expected %s, got %s)\n' "$name" "$expected" "$actual" >&2
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

main() {
  local fixture_root=""
  local archive=""
  local curl_calls=""

  TEST_TMP_DIR="$(mktemp -d)"
  trap cleanup EXIT

  assert_equal "pins GitHub CLI 2.100.0" "2.100.0" "$GITHUB_CLI_VERSION"
  assert_equal "maps Linux x86_64 releases" "linux_amd64" "$(github_cli_platform Linux x86_64)"
  assert_equal "maps Linux ARM64 releases" "linux_arm64" "$(github_cli_platform Linux aarch64)"
  assert_equal "maps macOS ARM64 releases" "macOS_arm64" "$(github_cli_platform Darwin arm64)"

  HOME="$TEST_TMP_DIR/home"
  PATH="$TEST_TMP_DIR/fake-bin:$ORIGINAL_PATH"
  export HOME PATH
  mkdir -p "$HOME/.local/bin" "$TEST_TMP_DIR/fake-bin"

  fixture_root="$TEST_TMP_DIR/fixture/gh_${GITHUB_CLI_VERSION}_linux_amd64"
  mkdir -p "$fixture_root/bin"
  cat > "$fixture_root/bin/gh" <<EOF
#!/usr/bin/env bash
printf 'gh version ${GITHUB_CLI_VERSION} (fixture)\\n'
EOF
  chmod +x "$fixture_root/bin/gh"

  archive="$TEST_TMP_DIR/gh_${GITHUB_CLI_VERSION}_linux_amd64.tar.gz"
  tar -czf "$archive" -C "$TEST_TMP_DIR/fixture" "gh_${GITHUB_CLI_VERSION}_linux_amd64"
  export GITHUB_CLI_TEST_ARCHIVE="$archive"
  export GITHUB_CLI_TEST_CURL_LOG="$TEST_TMP_DIR/curl.log"

  cat > "$TEST_TMP_DIR/fake-bin/curl" <<'EOF'
#!/usr/bin/env bash
output=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "--output" ]]; then
    output="$2"
    shift 2
    continue
  fi
  shift
done
printf 'curl\n' >> "$GITHUB_CLI_TEST_CURL_LOG"
cp "$GITHUB_CLI_TEST_ARCHIVE" "$output"
EOF
  chmod +x "$TEST_TMP_DIR/fake-bin/curl"

  github_cli_platform() { printf 'linux_amd64\n'; }
  GITHUB_CLI_TEST_CHECKSUM="$(sha256sum "$archive" | awk '{print $1}')"
  github_cli_checksum() { printf '%s\n' "$GITHUB_CLI_TEST_CHECKSUM"; }

  cat > "$HOME/.local/bin/gh" <<'EOF'
#!/usr/bin/env bash
printf 'gh version 2.97.0 (fixture)\n'
EOF
  chmod +x "$HOME/.local/bin/gh"

  DRY_RUN=0 install_github_cli
  assert_equal "installs the pinned binary" "$GITHUB_CLI_VERSION" "$(installed_github_cli_version "$HOME/.local/bin/gh")"
  assert_equal "records the managed platform and version" "$GITHUB_CLI_VERSION linux_amd64" "$(cat "$HOME/.local/share/dev-setup/github-cli/version")"
  assert_equal "preserves an unmanaged existing binary" "2.97.0" "$(installed_github_cli_version "$HOME/.local/bin/gh.bak")"

  DRY_RUN=0 install_github_cli
  curl_calls="$(wc -l < "$GITHUB_CLI_TEST_CURL_LOG" | tr -d ' ')"
  assert_equal "a repeated install does not download again" "1" "$curl_calls"
  if [[ ! -e "$HOME/.local/bin/gh.bak.1" ]]; then
    printf 'ok: a repeated install does not create another backup\n'
  else
    printf 'not ok: a repeated install does not create another backup\n' >&2
    return 1
  fi

  rm -rf "$HOME"
  DRY_RUN=1 install_github_cli > "$TEST_TMP_DIR/dry-run.log"
  assert_file_contains "dry-run shows the pinned release URL" "$TEST_TMP_DIR/dry-run.log" "/v${GITHUB_CLI_VERSION}/gh_${GITHUB_CLI_VERSION}_linux_amd64.tar.gz"
  if [[ ! -e "$HOME/.local/bin/gh" ]]; then
    printf 'ok: dry-run does not install the binary\n'
  else
    printf 'not ok: dry-run does not install the binary\n' >&2
    return 1
  fi
}

main "$@"
