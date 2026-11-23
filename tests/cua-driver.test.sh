#!/usr/bin/env bash
# Each isolated case intentionally overrides HOME, PATH, and fixture variables.
# shellcheck disable=SC2030,SC2031
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
INSTALLER="$REPO_ROOT/install/cua-driver.sh"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

assert_eq() {
  local expected="$1" actual="$2" label="$3"
  [[ "$actual" == "$expected" ]] || fail "$label (expected '$expected', got '$actual')"
}

assert_file() {
  [[ -f "$1" ]] || fail "expected file: $1"
}

assert_not_exists() {
  [[ ! -e "$1" && ! -L "$1" ]] || fail "expected path to be absent: $1"
}

assert_link_target() {
  local link="$1" expected="$2"
  [[ -L "$link" ]] || fail "expected symlink: $link"
  assert_eq "$expected" "$(readlink "$link")" "symlink target for $link"
}

make_fixtures() {
  local fixture_dir="$1"
  mkdir -p "$fixture_dir/runtime/wayland-helper/winrects@cua"
  cat > "$fixture_dir/runtime/cua-driver" <<'SCRIPT'
#!/usr/bin/env bash
if [[ "${1:-}" == "--version" ]]; then
  echo 'cua-driver 0.59.4'
fi
SCRIPT
  cat > "$fixture_dir/runtime/cua-cursor-theme" <<'SCRIPT'
#!/usr/bin/env bash
exit 0
SCRIPT
  chmod +x "$fixture_dir/runtime/cua-driver" "$fixture_dir/runtime/cua-cursor-theme"
  printf '#!/usr/bin/env bash\n' > "$fixture_dir/runtime/wayland-helper/install.sh"
  printf '{}\n' > "$fixture_dir/runtime/wayland-helper/winrects@cua/metadata.json"
  printf '// helper\n' > "$fixture_dir/runtime/wayland-helper/winrects@cua/extension.js"
  printf '# Wayland helper\n' > "$fixture_dir/runtime/wayland-helper/README.md"
  chmod +x "$fixture_dir/runtime/wayland-helper/install.sh"
  python3 "$REPO_ROOT/configs/cua-driver/linux-runtime-digest.py" "$fixture_dir/runtime" > "$fixture_dir/runtime.digest"
  printf 'ignored SDK payload\n' > "$fixture_dir/runtime/libcua_driver_sdk.so"

  tar -czf "$fixture_dir/runtime.tar.gz" -C "$fixture_dir/runtime" .
  sha256sum "$fixture_dir/runtime.tar.gz" | awk '{print $1}' > "$fixture_dir/runtime.sha256"
}

make_fake_curl() {
  local bin_dir="$1"
  mkdir -p "$bin_dir"
  cat > "$bin_dir/curl" <<'CURL'
#!/usr/bin/env bash
set -euo pipefail
output=""
url=""
while (( $# )); do
  case "$1" in
    --output) output="$2"; shift 2 ;;
    http://*|https://*) url="$1"; shift ;;
    *) shift ;;
  esac
done
printf '%s\n' "$url" >> "$CUA_TEST_CURL_LOG"
case "$url" in
  *.tar.gz) cp "$CUA_TEST_RUNTIME_ARCHIVE" "$output" ;;
  *.sigstore.json) printf 'fixture signature\n' > "$output" ;;
  *) printf 'unexpected URL: %s\n' "$url" >&2; exit 1 ;;
esac
CURL
  cat > "$bin_dir/cosign" <<'COSIGN'
#!/usr/bin/env bash
set -eu
[[ "$1" == verify-blob && "$2" == --bundle && -f "$3" && "$4" == --certificate-identity &&
   "$5" == 'https://github.com/trycua/cua/.github/workflows/cd-rust-cua-driver.yml@refs/tags/cua-driver-rs-v0.59.4' &&
   "$6" == --certificate-oidc-issuer && "$7" == 'https://token.actions.githubusercontent.com' && -f "$8" &&
   "${CUA_TEST_BAD_SIGNATURE:-0}" != 1 ]]
COSIGN
  chmod +x "$bin_dir/curl" "$bin_dir/cosign"
}

printf 'test: platform and architecture mapping\n'
(
  # shellcheck source=install/cua-driver.sh
  source "$INSTALLER"
  assert_eq 'linux-x86_64 x86_64-unknown-linux-gnu' "$(cua_driver_platform Linux x86_64)" 'x86_64 mapping'
  assert_eq 'linux-x86_64 x86_64-unknown-linux-gnu' "$(cua_driver_platform Linux amd64)" 'amd64 mapping'
  assert_eq 'linux-arm64 aarch64-unknown-linux-gnu' "$(cua_driver_platform Linux aarch64)" 'aarch64 mapping'
  assert_eq 'linux-arm64 aarch64-unknown-linux-gnu' "$(cua_driver_platform Linux arm64)" 'arm64 mapping'
  if cua_driver_platform Linux riscv64 >/dev/null 2>&1; then
    fail 'unsupported architecture was accepted'
  fi
)

printf 'test: offline Linux install, host skills, release provenance, backup, and idempotency\n'
case_root="$TEST_ROOT/install"
fixture_dir="$case_root/fixtures"
make_fixtures "$fixture_dir"
make_fake_curl "$case_root/bin"
mkdir -p \
  "$case_root/home/.local/bin" \
  "$case_root/home/.agents/skills/cua-driver" \
  "$case_root/home/.cua-driver/packages/releases/0.27.0-x86_64-unknown-linux-gnu"
printf 'unmanaged\n' > "$case_root/home/.local/bin/cua-driver"
printf 'unmanaged skill\n' > "$case_root/home/.agents/skills/cua-driver/old.txt"
ln -s \
  "$case_root/home/.cua-driver/packages/releases/0.27.0-x86_64-unknown-linux-gnu" \
  "$case_root/home/.cua-driver/packages/current"
(
  export HOME="$case_root/home"
  export PATH="$case_root/bin:$PATH"
  export CUA_TEST_CURL_LOG="$case_root/curl.log"
  export CUA_TEST_RUNTIME_ARCHIVE="$fixture_dir/runtime.tar.gz"
  export SETUP_HOST=omarchy
  # shellcheck source=install/cua-driver.sh
  source "$INSTALLER"
  cua_driver_platform() { printf '%s\n' 'linux-x86_64 x86_64-unknown-linux-gnu'; }
  cua_driver_binary_checksum() { cat "$fixture_dir/runtime.sha256"; }
  cua_driver_linux_digest() { cat "$fixture_dir/runtime.digest"; }

  apply_cua_driver >/dev/null
  release="$HOME/.cua-driver/packages/releases/0.59.4-x86_64-unknown-linux-gnu"
  skill="$HOME/.cua-driver/skills/cua-driver"
  assert_eq 'cua-driver 0.59.4' "$("$HOME/.local/bin/cua-driver" --version)" 'installed binary version'
  [[ -x "$release/cua-cursor-theme" ]] || fail 'cursor theme executable missing'
  assert_file "$release/wayland-helper/install.sh"
  assert_not_exists "$release/libcua_driver_sdk.so"
  assert_file "$skill/SKILL.md"
  assert_file "$skill/BROWSER.md"
  assert_file "$skill/OMARCHY.md"
  for skill_file in SKILL.md BROWSER.md OMARCHY.md MACOS.md; do
    cmp -s "$skill/$skill_file" "$REPO_ROOT/configs/cua-driver/skill/$skill_file" \
      || fail "installed Cua Driver $skill_file differs from repository source"
  done
  assert_not_exists "$skill/upstream"
  assert_file "$skill/MACOS.md"
  assert_not_exists "$skill/WINDOWS.md"
  assert_file "$HOME/.local/bin/cua-driver.bak"
  assert_file "$HOME/.cua-driver/backups/skills/.agents.bak/old.txt"
  assert_not_exists "$HOME/.agents/skills/cua-driver.bak"
  assert_link_target "$HOME/.local/bin/cua-driver-mcp" "$REPO_ROOT/configs/cua-driver/cua-driver-mcp"
  assert_link_target "$HOME/.cua-driver/packages/current" "$release"
  assert_not_exists "$HOME/.cua-driver/packages/current.bak"
  assert_link_target "$HOME/.local/bin/cua-driver" "$HOME/.cua-driver/packages/current/cua-driver"
  assert_link_target "$HOME/.local/bin/cua-omarchy-display" "$REPO_ROOT/configs/cua-driver/cua-omarchy-display"
  assert_link_target "$HOME/.local/bin/cua-omarchy-window" "$REPO_ROOT/configs/cua-driver/cua-omarchy-window"
  for surface in .agents .claude .codex .pi/agent .gemini/antigravity-cli; do
    assert_link_target "$HOME/$surface/skills/cua-driver" "$skill"
  done
  assert_eq '2' "$(wc -l < "$case_root/curl.log" | tr -d ' ')" 'initial archive+signature download count'

  apply_cua_driver >/dev/null
  assert_eq '2' "$(wc -l < "$case_root/curl.log" | tr -d ' ')" 'idempotent download count'
  assert_eq '1' "$(find "$HOME/.local/bin" -maxdepth 1 -name 'cua-driver.bak*' | wc -l | tr -d ' ')" 'binary backup count after rerun'
  assert_not_exists "$HOME/.cua-driver/backups/skills/.agents.bak.1"

  mkdir -p "$skill/upstream"
  printf '# stale cross-platform content\n' > "$skill/upstream/MACOS.md"
  apply_cua_driver >/dev/null
  assert_not_exists "$skill/upstream"
  assert_eq '2' "$(wc -l < "$case_root/curl.log" | tr -d ' ')" 'download count after cross-platform skill cleanup'

  printf '\nlocal drift\n' >> "$skill/OMARCHY.md"
  apply_cua_driver >/dev/null
  assert_eq '2' "$(wc -l < "$case_root/curl.log" | tr -d ' ')" 'download count after local skill drift'
  cmp -s "$skill/OMARCHY.md" "$REPO_ROOT/configs/cua-driver/skill/OMARCHY.md" \
    || fail 'local skill drift was not repaired from repository source'

  # No preexisting binary may run during readiness, even if it prints the expected --version.
  # shellcheck disable=SC2016 # $HOME belongs to the fixture executable.
  printf '#!/bin/sh\ntouch "$HOME/impostor-ran"\necho "cua-driver 0.59.4"\n' > "$release/cua-driver"
  DRY_RUN=1 apply_cua_driver > "$case_root/impostor-dry-run"
  assert_not_exists "$HOME/impostor-ran"
  grep -q 'Would download' "$case_root/impostor-dry-run" || fail 'dry-run trusted a same-version impostor'

  rm "$HOME/.agents/skills/cua-driver"
  ln -s "$HOME/unrelated-skill" "$HOME/.agents/skills/cua-driver"
  if apply_cua_driver > "$case_root/unrelated-link-output" 2>&1; then
    fail 'unrelated agent skill symlink was replaced'
  fi
  assert_link_target "$HOME/.agents/skills/cua-driver" "$HOME/unrelated-skill"
  grep -q 'refusing to replace an unrelated' "$case_root/unrelated-link-output" || fail 'unrelated symlink refusal was not reported'
  assert_eq '2' "$(wc -l < "$case_root/curl.log" | tr -d ' ')" 'foreign skill link preflight before untrusted release replacement'
  assert_not_exists "$release.bak"
  rm "$HOME/.agents/skills/cua-driver"
  ln -s "$skill" "$HOME/.agents/skills/cua-driver"
  apply_cua_driver >/dev/null
  assert_not_exists "$HOME/impostor-ran"
  assert_file "$release.bak/cua-driver"
  assert_eq '4' "$(wc -l < "$case_root/curl.log" | tr -d ' ')" 'invalid preexisting runtime required a verified replacement'
  mv "$release/cua-cursor-theme" "$case_root/cursor"
  ln -s "$case_root/cursor" "$release/cua-cursor-theme"
  DRY_RUN=1 apply_cua_driver > "$case_root/relinked-helper"
  grep -q 'Would download' "$case_root/relinked-helper" || fail 'same-content symlink accepted as a regular runtime member'
)

printf 'test: dry-run performs no writes or network\n'
case_root="$TEST_ROOT/dry-run"
mkdir -p "$case_root/home" "$case_root/bin"
cat > "$case_root/bin/curl" <<'CURL'
#!/usr/bin/env bash
printf 'curl called\n' >> "$CUA_TEST_CURL_LOG"
exit 99
CURL
chmod +x "$case_root/bin/curl"
(
  export HOME="$case_root/home"
  export PATH="$case_root/bin:$PATH"
  export CUA_TEST_CURL_LOG="$case_root/curl.log"
  # shellcheck source=install/cua-driver.sh
  source "$INSTALLER"
  cua_driver_platform() { printf '%s\n' 'linux-x86_64 x86_64-unknown-linux-gnu'; }
  DRY_RUN=1 apply_cua_driver > "$case_root/output"
  grep -q 'cua-driver-rs-0.59.4-linux-x86_64-binary.tar.gz' "$case_root/output" || fail 'dry-run omitted binary download'
  grep -Fq "Would install the repository-owned skill from $REPO_ROOT/configs/cua-driver/skill" \
    "$case_root/output" || fail 'dry-run omitted repository-owned skill install'
  if grep -q -- '-skills.tar.gz' "$case_root/output"; then
    fail 'dry-run still referenced the upstream skill archive'
  fi
  if grep -q 'bin/cua-omarchy-window' "$case_root/output"; then fail 'standalone non-Omarchy run linked helper'; fi
  assert_not_exists "$case_root/curl.log"
  assert_eq '' "$(find "$HOME" -mindepth 1 -print -quit)" 'dry-run HOME contents'
)

printf 'test: standalone dry-run resolves the repository root\n'
case_root="$TEST_ROOT/standalone"
mkdir -p "$case_root/home"
env -u REPO_ROOT HOME="$case_root/home" SETUP_HOST=omarchy \
  bash "$INSTALLER" --dry-run > "$case_root/output"
grep -Fq "Would install the repository-owned skill from $REPO_ROOT/configs/cua-driver/skill" \
  "$case_root/output" || fail 'standalone installer did not resolve the repository skill path'
grep -Fq "$REPO_ROOT/configs/cua-driver/cua-omarchy-window" "$case_root/output" \
  || fail 'standalone installer omitted the Omarchy window helper'
assert_eq '' "$(find "$case_root/home" -mindepth 1 -print -quit)" 'standalone dry-run HOME contents'

printf 'test: wrong checksum fails closed\n'
case_root="$TEST_ROOT/checksum"
fixture_dir="$case_root/fixtures"
make_fixtures "$fixture_dir"
make_fake_curl "$case_root/bin"
mkdir -p "$case_root/home"
(
  export HOME="$case_root/home"
  export PATH="$case_root/bin:$PATH"
  export CUA_TEST_CURL_LOG="$case_root/curl.log"
  export CUA_TEST_RUNTIME_ARCHIVE="$fixture_dir/runtime.tar.gz"
  # shellcheck source=install/cua-driver.sh
  source "$INSTALLER"
  cua_driver_platform() { printf '%s\n' 'linux-x86_64 x86_64-unknown-linux-gnu'; }
  cua_driver_binary_checksum() { printf '%064d\n' 0; }
  if apply_cua_driver > "$case_root/output" 2>&1; then
    fail 'wrong checksum was accepted'
  fi
  grep -q 'SHA256 mismatch' "$case_root/output" || fail 'wrong checksum error was not reported'
  assert_not_exists "$HOME/.cua-driver/packages/releases/0.59.4-x86_64-unknown-linux-gnu"
  assert_eq '1' "$(wc -l < "$case_root/curl.log" | tr -d ' ')" 'downloads before checksum failure'
)

printf 'test: rejected release signature does not publish a new release or command\n'
(
  export HOME="$case_root/home" PATH="$case_root/bin:$PATH"
  export CUA_TEST_CURL_LOG="$case_root/curl.log" CUA_TEST_BAD_SIGNATURE=1
  export CUA_TEST_RUNTIME_ARCHIVE="$fixture_dir/runtime.tar.gz"
  # shellcheck source=install/cua-driver.sh
  source "$INSTALLER"
  cua_driver_binary_checksum() { cat "$fixture_dir/runtime.sha256"; }
  if apply_cua_driver > "$case_root/signature-output" 2>&1; then fail 'invalid release signature was accepted'; fi
  assert_not_exists "$HOME/.cua-driver/packages/current"
  assert_not_exists "$HOME/.local/bin/cua-driver"
  assert_eq '3' "$(wc -l < "$case_root/curl.log" | tr -d ' ')" 'checksum rejection then archive and signature for provenance'
)

printf 'test: repository skill version mismatch fails before writes or network\n'
case_root="$TEST_ROOT/local-skill-version"
mkdir -p "$case_root/home" "$case_root/bin"
cat > "$case_root/bin/curl" <<'CURL'
#!/usr/bin/env bash
printf 'called\n' >> "$CUA_TEST_CURL_LOG"
exit 99
CURL
chmod +x "$case_root/bin/curl"
(
  export HOME="$case_root/home"
  export PATH="$case_root/bin:$PATH"
  export CUA_TEST_CURL_LOG="$case_root/curl.log"
  # shellcheck source=install/cua-driver.sh
  source "$INSTALLER"
  CUA_DRIVER_VERSION=9.9.9
  if apply_cua_driver > "$case_root/output" 2>&1; then
    fail 'mismatched repository skill version was accepted'
  fi
  grep -q 'repository Cua Driver skill is missing or does not match runtime version 9.9.9' "$case_root/output" \
    || fail 'repository skill version mismatch was not reported'
  assert_not_exists "$case_root/curl.log"
  assert_eq '' "$(find "$HOME" -mindepth 1 -print -quit)" 'repository skill mismatch HOME contents'
)

printf 'test: safe extraction rejects traversal and symlink members\n'
case_root="$TEST_ROOT/unsafe"
mkdir -p "$case_root"
python3 - "$case_root" <<'PY'
import io
import pathlib
import tarfile
import sys

root = pathlib.Path(sys.argv[1])
for name, member in (("traversal.tar.gz", "../escape"), ("symlink.tar.gz", "cua-driver")):
    with tarfile.open(root / name, "w:gz") as archive:
        info = tarfile.TarInfo(member)
        if name.startswith("symlink"):
            info.type = tarfile.SYMTYPE
            info.linkname = "/tmp/target"
            archive.addfile(info)
        else:
            payload = b"escape"
            info.size = len(payload)
            archive.addfile(info, io.BytesIO(payload))
PY
(
  # shellcheck source=install/cua-driver.sh
  source "$INSTALLER"
  if cua_driver_extract_runtime_archive "$case_root/traversal.tar.gz" "$case_root/traversal-out" >/dev/null 2>&1; then
    fail 'path traversal archive was accepted'
  fi
  if cua_driver_extract_runtime_archive "$case_root/symlink.tar.gz" "$case_root/symlink-out" >/dev/null 2>&1; then
    fail 'symlink archive was accepted'
  fi
  assert_not_exists "$case_root/escape"
)

printf 'test: unsupported OS fails before writing or contacting release server\n'
case_root="$TEST_ROOT/non-linux"
mkdir -p "$case_root/home" "$case_root/bin"
cat > "$case_root/bin/curl" <<'CURL'
#!/usr/bin/env bash
printf 'called\n' >> "$CUA_TEST_CURL_LOG"
exit 99
CURL
chmod +x "$case_root/bin/curl"
(
  export HOME="$case_root/home"
  export PATH="$case_root/bin:$PATH"
  export CUA_TEST_CURL_LOG="$case_root/curl.log"
  # shellcheck source=install/cua-driver.sh
  source "$INSTALLER"
  uname() { case "$1" in -s) echo FreeBSD ;; -m) echo x86_64 ;; esac; }
  if apply_cua_driver > "$case_root/output" 2>&1; then
    fail 'non-Linux apply succeeded'
  fi
  grep -q 'unsupported Cua Driver platform: FreeBSD x86_64' "$case_root/output" || fail 'unsupported OS refusal was not explicit'
  assert_not_exists "$case_root/curl.log"
  assert_eq '' "$(find "$HOME" -mindepth 1 -print -quit)" 'non-Linux HOME contents'
)

printf 'test: macOS scoped links use the verified signed bundle and expose only Pi\n'
case_root="$TEST_ROOT/mac"
mkdir -p "$case_root/home/.pi/agent/skills/cua-driver" "$case_root/home/.claude/skills/cua-driver"
printf 'displaced\n' > "$case_root/home/.pi/agent/skills/cua-driver/SKILL.md"
printf 'unmanaged\n' > "$case_root/home/.claude/skills/cua-driver/SKILL.md"
(
  export HOME="$case_root/home" SETUP_HOST=macbook
  # shellcheck source=install/cua-driver.sh
  source "$INSTALLER"
  uname() { case "$1" in -s) echo Darwin ;; -m) echo arm64 ;; esac; }
  sw_vers() { echo '13.6'; }
  if apply_cua_driver > "$case_root/old-os" 2>&1; then fail 'macOS 13 was accepted'; fi
  grep -q 'requires macOS 14' "$case_root/old-os" || fail 'unexpected old macOS error'
  sw_vers() { echo '14.7'; }
  # Foreign job/socket: the native preflight veto must precede runtime downloads and any active links.
  cua_driver_macos() { [[ "$1" != preflight ]]; }
  if apply_cua_driver > "$case_root/blocked" 2>&1; then fail 'Mac preflight veto was ignored'; fi
  assert_not_exists "$HOME/.local/bin/cua-driver"
  assert_not_exists "$HOME/.cua-driver"
  assert_eq displaced "$(<"$HOME/.pi/agent/skills/cua-driver/SKILL.md")" 'preflight veto preserves Pi skill'
  # Only substitute the native signed-app/launchd boundary; filesystem and all host routing are real.
  cua_driver_macos() { [[ "$1" == ready || "$1" == service || "$1" == preflight ]]; }
  apply_cua_driver > /dev/null
  assert_link_target "$HOME/.local/bin/cua-driver" '/Applications/CuaDriver.app/Contents/MacOS/cua-driver'
  assert_link_target "$HOME/.local/bin/cua-driver-mcp" "$REPO_ROOT/configs/cua-driver/cua-driver-mcp"
  assert_link_target "$HOME/.pi/agent/skills/cua-driver" "$HOME/.cua-driver/skills/cua-driver"
  assert_file "$HOME/.cua-driver/backups/skills/.pi-agent.bak/SKILL.md"
  assert_eq unmanaged "$(<"$HOME/.claude/skills/cua-driver/SKILL.md")" 'unrelated Mac Claude skill preserved'
  assert_not_exists "$HOME/.pi/agent/skills/cua-driver.bak"
  assert_not_exists "$HOME/.agents"
  assert_not_exists "$HOME/.codex"
  assert_not_exists "$HOME/.gemini"
  assert_not_exists "$HOME/.config/systemd"
  assert_not_exists "$HOME/.local/bin/cua-omarchy-window"
  assert_not_exists "$HOME/.cua-driver/packages/current"
  assert_not_exists "$HOME/.cua-driver/skills/cua-driver/WINDOWS.md"
  apply_cua_driver >/dev/null
  assert_not_exists "$HOME/.cua-driver/backups/skills/.pi-agent.bak.1"
)

printf 'test: host selection and Omarchy service boundary\n'
(
  # shellcheck source=install/hosts/omarchy.sh
  source "$REPO_ROOT/install/hosts/omarchy.sh"
  [[ " ${HOST_CONFIG_TARGETS[*]} " == *" cua-driver "* ]]
) || fail 'omarchy does not select Cua Driver'
(
  # shellcheck source=install/hosts/macbook.sh
  source "$REPO_ROOT/install/hosts/macbook.sh"
  [[ " ${HOST_CONFIG_TARGETS[*]} " == *" cua-driver "* ]]
) || fail 'macbook does not select Cua Driver for Pi'
(
  # shellcheck source=install/hosts/omarchy.sh
  source "$REPO_ROOT/install/hosts/omarchy.sh"
  [[ " ${HOST_ENV_VARS[*]} " == *" CUA_DRIVER_RS_ENABLE_WAYLAND=1 "* ]] \
    && [[ " ${HOST_PACMAN_PACKAGES[*]} " == *" grim "* ]]
) || fail 'Omarchy does not enable native Wayland capture with the required grim package'
service="$REPO_ROOT/configs/cua-driver/cua-driver.service"
assert_file "$service"
grep -Fxq 'Environment=CUA_DRIVER_RS_ENABLE_WAYLAND=1' "$service" || fail 'service does not enable native Wayland'
grep -Fxq 'ExecStart=%h/.local/bin/cua-driver serve' "$service" || fail 'service does not start the managed driver'
x11_service="$REPO_ROOT/configs/cua-driver/cua-driver-x11.service"
assert_file "$x11_service"
grep -Fxq 'Environment=CUA_DRIVER_RS_ENABLE_WAYLAND=0' "$x11_service" || fail 'X11 service must disable the native Wayland route'
grep -Fxq 'ExecStart=%h/.local/bin/cua-driver serve --socket %t/cua-driver-x11/driver.sock' "$x11_service" || fail 'X11 service must have its own endpoint'
grep -Fxq 'RuntimeDirectoryMode=0700' "$x11_service" || fail 'X11 runtime directory must be private'
for unit in "$service" "$x11_service"; do
  grep -Fxq 'Environment=CUA_DRIVER_RS_TELEMETRY_ENABLED=false' "$unit" || fail 'daemon telemetry not disabled'
  grep -Fxq 'Environment=CUA_DRIVER_RS_UPDATE_CHECK=false' "$unit" || fail 'daemon update checks not disabled'
done

printf 'test: Omarchy service starts once and restarts only for stale runtime state\n'
service_root="$TEST_ROOT/service"
mkdir -p "$service_root/home/.local/bin" "$service_root/bin"
printf '#!/usr/bin/env bash\nexit 0\n' > "$service_root/home/.local/bin/cua-driver"
chmod +x "$service_root/home/.local/bin/cua-driver"
cat > "$service_root/bin/systemctl" <<'SCRIPT'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$SYSTEMCTL_LOG"
[[ "$*" != "${SYSTEMCTL_FAIL:-}" ]] || exit 25
case "$*" in
  '--user is-enabled --quiet cua-driver.service'|'--user is-enabled --quiet cua-driver-x11.service') [[ "${SYSTEMCTL_ENABLED:-1}" == 1 ]] ;;
  '--user is-active --quiet cua-driver.service'|'--user is-active --quiet cua-driver-x11.service') [[ "${SYSTEMCTL_ACTIVE:-1}" == 1 ]] ;;
  '--user show cua-driver.service --property MainPID --value'|'--user show cua-driver-x11.service --property MainPID --value') printf '%s\n' "${SYSTEMCTL_MAIN_PID:-123}" ;;
  *) exit 0 ;;
esac
SCRIPT
chmod +x "$service_root/bin/systemctl"
(
  export HOME="$service_root/home"
  export PATH="$service_root/bin:$PATH"
  export REPO_ROOT
  export DRY_RUN=0
  export SYSTEMCTL_LOG="$service_root/systemctl.log"
  # shellcheck source=install/lib.sh
  source "$REPO_ROOT/install/lib.sh"
  # shellcheck source=install/hosts/omarchy.sh
  source "$REPO_ROOT/install/hosts/omarchy.sh"

  export CUA_DRIVER_PROC_ROOT="$service_root/proc"
  mkdir -p "$CUA_DRIVER_PROC_ROOT/123"
  ln -s "$HOME/.local/bin/cua-driver" "$CUA_DRIVER_PROC_ROOT/123/exe"
  printf 'PATH=/usr/bin\0CUA_DRIVER_RS_ENABLE_WAYLAND=1\0' > "$CUA_DRIVER_PROC_ROOT/123/environ"
  if ! cua_driver_service_needs_restart; then fail 'daemon missing both privacy settings was considered current'; fi
  printf 'CUA_DRIVER_RS_TELEMETRY_ENABLED=false\0CUA_DRIVER_RS_UPDATE_CHECK=false\0' >> "$CUA_DRIVER_PROC_ROOT/123/environ"
  if cua_driver_service_needs_restart; then
    fail 'matching service executable and environment were considered stale'
  fi
  printf '#!/usr/bin/env bash\nexit 0\n' > "$service_root/stale-cua-driver"
  chmod +x "$service_root/stale-cua-driver"
  ln -sfn "$service_root/stale-cua-driver" "$CUA_DRIVER_PROC_ROOT/123/exe"
  if ! cua_driver_service_needs_restart; then
    fail 'stale service executable was considered current'
  fi
  ln -sfn "$HOME/.local/bin/cua-driver" "$CUA_DRIVER_PROC_ROOT/123/exe"
  printf 'PATH=/usr/bin\0' > "$CUA_DRIVER_PROC_ROOT/123/environ"
  if ! cua_driver_service_needs_restart; then
    fail 'service without native Wayland environment was considered current'
  fi

  printf 'PATH=/usr/bin\0CUA_DRIVER_RS_ENABLE_WAYLAND=0\0CUA_DRIVER_RS_TELEMETRY_ENABLED=false\0CUA_DRIVER_RS_UPDATE_CHECK=false\0' > "$CUA_DRIVER_PROC_ROOT/123/environ"
  if cua_driver_service_needs_restart cua-driver-x11.service 0; then
    fail 'matching X11 backend was considered stale'
  fi
  if ! cua_driver_service_needs_restart cua-driver-x11.service 1; then
    fail 'wrong X11 backend setting was considered current'
  fi

  cua_driver_service_needs_restart() { return 0; }
  configure_cua_driver_service >/dev/null
  grep -Fxq -- '--user restart cua-driver.service' "$SYSTEMCTL_LOG" \
    || fail 'active stale Cua Driver service was not restarted'
  grep -Fxq -- '--user restart cua-driver-x11.service' "$SYSTEMCTL_LOG" \
    || fail 'active stale X11 service was not restarted'
  assert_link_target "$HOME/.config/systemd/user/cua-driver-x11.service" "$REPO_ROOT/configs/cua-driver/cua-driver-x11.service"

  : > "$SYSTEMCTL_LOG"
  cua_driver_service_needs_restart() { return 1; }
  configure_cua_driver_service >/dev/null
  if grep -Fq -- '--user restart cua-driver.service' "$SYSTEMCTL_LOG"; then
    fail 'current Cua Driver service was restarted unnecessarily'
  fi
  if grep -Fq -- '--user enable cua-driver.service' "$SYSTEMCTL_LOG"; then
    fail 'current Cua Driver service was enabled unnecessarily'
  fi
  if grep -Fq -- '--user start cua-driver.service' "$SYSTEMCTL_LOG"; then
    fail 'current Cua Driver service was started unnecessarily'
  fi
  if grep -Eq -- '--user (restart|enable|start) cua-driver-x11.service' "$SYSTEMCTL_LOG"; then
    fail 'current X11 service was changed unnecessarily'
  fi

  : > "$SYSTEMCTL_LOG"
  export SYSTEMCTL_ACTIVE=0
  export SYSTEMCTL_ENABLED=0
  configure_cua_driver_service >/dev/null
  grep -Fxq -- '--user enable cua-driver.service' "$SYSTEMCTL_LOG" \
    || fail 'disabled Cua Driver service was not enabled'
  grep -Fxq -- '--user start cua-driver.service' "$SYSTEMCTL_LOG" \
    || fail 'inactive Cua Driver service was not started'
  grep -Fxq -- '--user enable cua-driver-x11.service' "$SYSTEMCTL_LOG" \
    || fail 'disabled X11 service was not enabled'
  grep -Fxq -- '--user start cua-driver-x11.service' "$SYSTEMCTL_LOG" \
    || fail 'inactive X11 service was not started'

  : > "$SYSTEMCTL_LOG"
  export SYSTEMCTL_ACTIVE=1
  export SYSTEMCTL_ENABLED=0
  cua_driver_service_needs_restart() { return 0; }
  configure_cua_driver_service >/dev/null
  grep -Fxq -- '--user enable cua-driver.service' "$SYSTEMCTL_LOG" \
    || fail 'active disabled Cua Driver service was not enabled'
  grep -Fxq -- '--user restart cua-driver.service' "$SYSTEMCTL_LOG" \
    || fail 'active disabled stale Cua Driver service was not restarted'

  export SYSTEMCTL_FAIL='--user restart cua-driver.service'
  if configure_cua_driver_service >/dev/null; then fail 'failed native restart was ignored'; fi
  export SYSTEMCTL_ACTIVE=0 SYSTEMCTL_FAIL='--user start cua-driver-x11.service'
  if configure_cua_driver_service >/dev/null; then fail 'failed X11 start was ignored'; fi
)

printf 'PASS: cua-driver installer tests\n'
