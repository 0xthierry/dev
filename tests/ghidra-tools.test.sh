#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ORIGINAL_PATH="$PATH"
TEST_TMP_DIR=""

# shellcheck disable=SC1091
source "$REPO_ROOT/install/ghidra-tools.sh"

cleanup() {
  if [[ -n "$TEST_TMP_DIR" ]]; then
    rm -rf "$TEST_TMP_DIR"
  fi
}

assert_success() {
  local name="$1"
  shift

  if "$@"; then
    printf 'ok: %s\n' "$name"
    return 0
  fi

  printf 'not ok: %s\n' "$name" >&2
  return 1
}

assert_failure() {
  local name="$1"
  shift

  if "$@"; then
    printf 'not ok: %s\n' "$name" >&2
    return 1
  fi

  printf 'ok: %s\n' "$name"
}

write_fake_command() {
  local dir="$1"
  local name="$2"
  local output="$3"

  cat > "$dir/$name" <<EOF
#!/usr/bin/env bash
printf '%s\n' '$output'
EOF
  chmod +x "$dir/$name"
}

with_fake_path() {
  local dir="$1"
  shift

  PATH="$dir:$ORIGINAL_PATH" "$@"
}

main() {
  TEST_TMP_DIR="$(mktemp -d)"
  trap cleanup EXIT

  write_fake_command "$TEST_TMP_DIR" ghidra "ghidra 0.1.10"
  write_fake_command "$TEST_TMP_DIR" ilspy "ilspy 0.1.10"

  assert_success "detects installed ghidra binary" with_fake_path "$TEST_TMP_DIR" is_ghidra_cli_installed
  assert_success "detects installed ilspy binary" with_fake_path "$TEST_TMP_DIR" is_ilspy_cli_installed

  write_fake_command "$TEST_TMP_DIR" ghidra "other 0.1.10"
  write_fake_command "$TEST_TMP_DIR" ilspy "other 0.1.10"

  assert_failure "rejects unrelated ghidra command" with_fake_path "$TEST_TMP_DIR" is_ghidra_cli_installed
  assert_failure "rejects unrelated ilspy command" with_fake_path "$TEST_TMP_DIR" is_ilspy_cli_installed

  write_fake_command "$TEST_TMP_DIR" ghidra "ghidra 0.1.9"
  write_fake_command "$TEST_TMP_DIR" ilspy "ilspy 0.1.9"

  assert_failure "rejects unpinned ghidra version" with_fake_path "$TEST_TMP_DIR" is_ghidra_cli_installed
  assert_failure "rejects unpinned ilspy version" with_fake_path "$TEST_TMP_DIR" is_ilspy_cli_installed
}

main "$@"
