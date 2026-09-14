#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
HELPER="$REPO_ROOT/configs/cua-driver/cua-omarchy-display"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

assert_file_content() {
  local path="$1"
  local expected="$2"
  [[ -f "$path" ]] || fail "expected file: $path"
  [[ "$(cat "$path")" == "$expected" ]] || fail "unexpected content in: $path"
}

mkdir -p "$TEST_ROOT/bin" "$TEST_ROOT/output dir"

cat > "$TEST_ROOT/bin/hyprctl" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
[[ "$*" == "monitors -j" ]] || exit 91
cat <<'JSON'
[{"name":"DP-1","width":3840,"height":2160},{"name":"HDMI-A-2","width":1920,"height":1080}]
JSON
SCRIPT

cat > "$TEST_ROOT/bin/grim" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
{
  printf '%s' 'call'
  printf ' <%s>' "$@"
  printf '\n'
} >> "$GRIM_LOG"
destination="${!#}"
printf '%s' 'fake png' > "$destination"
SCRIPT

chmod +x "$TEST_ROOT/bin/hyprctl" "$TEST_ROOT/bin/grim"
export PATH="$TEST_ROOT/bin:$PATH"
export GRIM_LOG="$TEST_ROOT/grim.log"

printf 'test: monitor listing returns Hyprland JSON\n'
monitors="$($HELPER monitors)"
jq -e 'length == 2 and .[0].name == "DP-1" and .[1].name == "HDMI-A-2"' \
  >/dev/null <<< "$monitors" || fail 'monitor listing did not preserve Hyprland JSON'

printf 'test: selected-output capture validates and preserves spaced path\n'
selected_path="$TEST_ROOT/output dir/secondary monitor.png"
selected_result="$($HELPER capture-output HDMI-A-2 "$selected_path")"
assert_file_content "$selected_path" 'fake png'
[[ "$selected_result" == "captured output HDMI-A-2 to $selected_path" ]] \
  || fail 'selected-output result was unexpected'
grep -Fq 'call <-o> <HDMI-A-2> <-t> <png>' "$GRIM_LOG" \
  || fail 'selected-output capture did not pass the exact output to grim'
[[ "$(stat -c '%a' "$selected_path")" == '600' ]] \
  || fail 'selected-output capture was not private'

printf 'test: full-layout capture\n'
layout_path="$TEST_ROOT/output dir/all monitors.png"
layout_result="$($HELPER capture-layout "$layout_path")"
assert_file_content "$layout_path" 'fake png'
[[ "$layout_result" == "captured Hyprland layout to $layout_path" ]] \
  || fail 'layout result was unexpected'
grep -Fq 'call <-t> <png>' "$GRIM_LOG" \
  || fail 'layout capture did not invoke grim without an output selector'
[[ "$(stat -c '%a' "$layout_path")" == '600' ]] \
  || fail 'layout capture was not private'

printf 'test: invalid output fails before grim\n'
calls_before="$(wc -l < "$GRIM_LOG")"
if "$HELPER" capture-output NOT-A-MONITOR "$TEST_ROOT/invalid.png" >"$TEST_ROOT/invalid.out" 2>&1; then
  fail 'unknown output was accepted'
fi
grep -Fq 'unknown Hyprland output: NOT-A-MONITOR' "$TEST_ROOT/invalid.out" \
  || fail 'unknown output error was not specific'
[[ "$(wc -l < "$GRIM_LOG")" == "$calls_before" ]] \
  || fail 'grim ran for an unknown output'
[[ ! -e "$TEST_ROOT/invalid.png" ]] || fail 'invalid output created a capture'

printf 'test: argument and destination errors fail closed\n'
for invocation in \
  '' \
  'capture-output HDMI-A-2' \
  'capture-layout'; do
  # Word splitting is intentional: these fixtures contain no spaces.
  # shellcheck disable=SC2086
  if "$HELPER" $invocation >"$TEST_ROOT/args.out" 2>&1; then
    fail "invalid invocation succeeded: $invocation"
  fi
done
if "$HELPER" capture-layout "$TEST_ROOT/output dir" >"$TEST_ROOT/directory.out" 2>&1; then
  fail 'directory capture destination was accepted'
fi
grep -Fq 'capture destination is a directory' "$TEST_ROOT/directory.out" \
  || fail 'directory destination error was not specific'
if "$HELPER" capture-layout "$TEST_ROOT/missing/path.png" >"$TEST_ROOT/missing.out" 2>&1; then
  fail 'missing destination directory was accepted'
fi
grep -Fq 'capture destination directory does not exist' "$TEST_ROOT/missing.out" \
  || fail 'missing destination directory error was not specific'

printf 'PASS: cua-omarchy-display helper tests\n'
