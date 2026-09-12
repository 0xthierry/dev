#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_TMP="$(mktemp -d)"
trap 'rm -rf "$TEST_TMP"' EXIT
export HOME="$TEST_TMP/home with spaces"
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin"
mkdir -p "$HOME"

# The macbook setup must invoke apply_moshi. This guards the host declaration
# that previously let setup finish without installing or starting Moshi.
# shellcheck source=install/hosts/macbook.sh
source "$REPO_ROOT/install/hosts/macbook.sh"
if [[ " ${HOST_CONFIG_TARGETS[*]} " != *" moshi "* ]]; then
  echo 'not ok: macbook setup does not include the moshi target' >&2
  exit 1
fi
echo 'ok: macbook setup includes the moshi target'

# Verify the macOS service reconciliation stops the legacy Homebrew service,
# writes a LaunchAgent for the pinned binary, and reloads it on a repeated run.
# shellcheck source=/dev/null
source "$REPO_ROOT/install/lib.sh"
# shellcheck source=/dev/null
source "$REPO_ROOT/install/moshi.sh"

fake_moshi="$TEST_TMP/moshi-hook"
cat > "$fake_moshi" <<EOF
#!/bin/bash
if [[ "\${1:-}" == probe && "\${2:-}" == --json ]]; then
  printf '%s\n' '{"installed":true,"running":true,"gateway":true,"version":"test"}'
  exit 0
fi
printf '%s\n' "\$*" >> "$TEST_TMP/moshi-hook.log"
EOF
chmod +x "$fake_moshi"

# shellcheck disable=SC2034 # Read by functions sourced above.
MOSHI_HOOK_BIN="$fake_moshi"
# shellcheck disable=SC2034 # Read by functions sourced above.
DRY_RUN=0
uname() {
  [[ "$1" == -s ]] && printf 'Darwin\n'
}
check_installed() {
  [[ "$1" == brew || "$1" == tailscale ]]
}
brew() {
  printf '%s\n' "$*" >> "$TEST_TMP/brew.log"
  if [[ "$*" == "services list" ]]; then
    printf 'moshi-hook started\n'
  fi
}
launchctl() {
  printf '%s\n' "$*" >> "$TEST_TMP/launchctl.log"
  case "$1" in
    print) [[ -f "$TEST_TMP/loaded" ]] ;;
    bootstrap) touch "$TEST_TMP/loaded" ;;
    enable|kickstart) return 0 ;;
    *) return 99 ;;
  esac
}
tailscale() {
  printf '%s\n' "$*" >> "$TEST_TMP/tailscale.log"
  if [[ "$*" == "debug prefs" ]]; then
    printf '{"ShieldsUp":false}\n'
  fi
}

configure_moshi_tailscale_incoming
configure_moshi_tailscale_incoming
configure_moshi_hook_service
configure_moshi_hook_service

plist="$HOME/Library/LaunchAgents/app.getmoshi.moshi-hook.plist"
python3 - "$plist" "$fake_moshi" "$HOME" <<'PY'
import pathlib
import plistlib
import sys

plist_path, binary, home = sys.argv[1:]
with pathlib.Path(plist_path).open("rb") as stream:
    service = plistlib.load(stream)
assert service["Label"] == "app.getmoshi.moshi-hook"
assert service["ProgramArguments"] == [binary, "serve"]
assert service["RunAtLoad"] is True
assert service["KeepAlive"] is True
assert service["EnvironmentVariables"]["HOME"] == home
assert service["EnvironmentVariables"]["PATH"].startswith(home + "/.local/bin:")
PY
[[ "$(grep -c '^set --shields-up=false$' "$TEST_TMP/tailscale.log")" -eq 2 ]]
[[ "$(grep -c '^services stop moshi-hook$' "$TEST_TMP/brew.log")" -eq 2 ]]
[[ "$(grep -c '^enable gui/.*/app.getmoshi.moshi-hook$' "$TEST_TMP/launchctl.log")" -eq 2 ]]
[[ "$(grep -c '^bootstrap gui/.* .*app.getmoshi.moshi-hook.plist$' "$TEST_TMP/launchctl.log")" -eq 1 ]]
[[ "$(grep -c '^kickstart -k gui/.*/app.getmoshi.moshi-hook$' "$TEST_TMP/launchctl.log")" -eq 1 ]]
echo 'ok: Moshi setup enables inbound Tailscale connections idempotently'
echo 'ok: macOS setup installs and reconciles the pinned Moshi LaunchAgent'
