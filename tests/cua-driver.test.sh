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
  mkdir -p "$fixture_dir/runtime/wayland-helper/winrects@cua" "$fixture_dir/skills/cua-driver-rs-v0.28.1-skills"
  cat > "$fixture_dir/runtime/cua-driver" <<'SCRIPT'
#!/usr/bin/env bash
if [[ "${1:-}" == "--version" ]]; then
  echo 'cua-driver 0.28.1'
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
  printf 'ignored SDK payload\n' > "$fixture_dir/runtime/libcua_driver_sdk.so"

  cat > "$fixture_dir/skills/cua-driver-rs-v0.28.1-skills/SKILL.md" <<'SKILL'
---
name: cua-driver
version: 0.28.1 # x-release-please-version
---
# Cua Driver
SKILL
  printf '# README\n' > "$fixture_dir/skills/cua-driver-rs-v0.28.1-skills/README.md"
  printf '# Linux\n' > "$fixture_dir/skills/cua-driver-rs-v0.28.1-skills/LINUX.md"
  printf '# Browser\n' > "$fixture_dir/skills/cua-driver-rs-v0.28.1-skills/BROWSER.md"
  printf '# Recording\n' > "$fixture_dir/skills/cua-driver-rs-v0.28.1-skills/RECORDING.md"
  printf '# Embedding\n' > "$fixture_dir/skills/cua-driver-rs-v0.28.1-skills/EMBEDDING.md"
  printf '# macOS\n' > "$fixture_dir/skills/cua-driver-rs-v0.28.1-skills/MACOS.md"
  printf '# Windows\n' > "$fixture_dir/skills/cua-driver-rs-v0.28.1-skills/WINDOWS.md"

  tar -czf "$fixture_dir/runtime.tar.gz" -C "$fixture_dir/runtime" .
  tar -czf "$fixture_dir/skills.tar.gz" -C "$fixture_dir/skills" cua-driver-rs-v0.28.1-skills
  sha256sum "$fixture_dir/runtime.tar.gz" | awk '{print $1}' > "$fixture_dir/runtime.sha256"
  sha256sum "$fixture_dir/skills.tar.gz" | awk '{print $1}' > "$fixture_dir/skills.sha256"
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
  *-binary.tar.gz) cp "$CUA_TEST_RUNTIME_ARCHIVE" "$output" ;;
  *-skills.tar.gz) cp "$CUA_TEST_SKILLS_ARCHIVE" "$output" ;;
  *) printf 'unexpected URL: %s\n' "$url" >&2; exit 1 ;;
esac
CURL
  chmod +x "$bin_dir/curl"
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

printf 'test: offline install, Linux-only skill, links, backup, and idempotency\n'
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
  export CUA_TEST_SKILLS_ARCHIVE="$fixture_dir/skills.tar.gz"
  # shellcheck source=install/cua-driver.sh
  source "$INSTALLER"
  cua_driver_platform() { printf '%s\n' 'linux-x86_64 x86_64-unknown-linux-gnu'; }
  cua_driver_binary_checksum() { cat "$fixture_dir/runtime.sha256"; }
  cua_driver_skills_checksum() { cat "$fixture_dir/skills.sha256"; }

  apply_cua_driver >/dev/null
  release="$HOME/.cua-driver/packages/releases/0.28.1-x86_64-unknown-linux-gnu"
  skill="$HOME/.cua-driver/skills/cua-driver"
  assert_eq 'cua-driver 0.28.1' "$("$HOME/.local/bin/cua-driver" --version)" 'installed binary version'
  [[ -x "$release/cua-cursor-theme" ]] || fail 'cursor theme executable missing'
  assert_file "$release/wayland-helper/install.sh"
  assert_not_exists "$release/libcua_driver_sdk.so"
  assert_file "$skill/SKILL.md"
  assert_file "$skill/README.md"
  assert_file "$skill/LINUX.md"
  assert_file "$skill/BROWSER.md"
  assert_file "$skill/RECORDING.md"
  assert_file "$skill/EMBEDDING.md"
  assert_not_exists "$skill/MACOS.md"
  assert_not_exists "$skill/WINDOWS.md"
  assert_file "$HOME/.local/bin/cua-driver.bak"
  assert_file "$HOME/.agents/skills/cua-driver.bak/old.txt"
  assert_link_target "$HOME/.cua-driver/packages/current" "$release"
  assert_not_exists "$HOME/.cua-driver/packages/current.bak"
  assert_link_target "$HOME/.local/bin/cua-driver" "$HOME/.cua-driver/packages/current/cua-driver"
  for surface in .agents .claude .codex .pi/agent; do
    assert_link_target "$HOME/$surface/skills/cua-driver" "$skill"
  done
  assert_eq '2' "$(wc -l < "$case_root/curl.log" | tr -d ' ')" 'initial download count'

  apply_cua_driver >/dev/null
  assert_eq '2' "$(wc -l < "$case_root/curl.log" | tr -d ' ')" 'idempotent download count'
  assert_eq '1' "$(find "$HOME/.local/bin" -maxdepth 1 -name 'cua-driver.bak*' | wc -l | tr -d ' ')" 'binary backup count after rerun'
  assert_eq '1' "$(find "$HOME/.agents/skills" -maxdepth 1 -name 'cua-driver.bak*' | wc -l | tr -d ' ')" 'skill backup count after rerun'

  rm "$HOME/.agents/skills/cua-driver"
  ln -s "$HOME/unrelated-skill" "$HOME/.agents/skills/cua-driver"
  if apply_cua_driver > "$case_root/unrelated-link-output" 2>&1; then
    fail 'unrelated agent skill symlink was replaced'
  fi
  assert_link_target "$HOME/.agents/skills/cua-driver" "$HOME/unrelated-skill"
  grep -q 'refusing to replace an unrelated' "$case_root/unrelated-link-output" || fail 'unrelated symlink refusal was not reported'
  assert_eq '2' "$(wc -l < "$case_root/curl.log" | tr -d ' ')" 'download count after unrelated link refusal'
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
  grep -q 'cua-driver-rs-0.28.1-linux-x86_64-binary.tar.gz' "$case_root/output" || fail 'dry-run omitted binary download'
  grep -q 'cua-driver-rs-v0.28.1-skills.tar.gz' "$case_root/output" || fail 'dry-run omitted skill download'
  assert_not_exists "$case_root/curl.log"
  assert_eq '' "$(find "$HOME" -mindepth 1 -print -quit)" 'dry-run HOME contents'
)

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
  export CUA_TEST_SKILLS_ARCHIVE="$fixture_dir/skills.tar.gz"
  # shellcheck source=install/cua-driver.sh
  source "$INSTALLER"
  cua_driver_platform() { printf '%s\n' 'linux-x86_64 x86_64-unknown-linux-gnu'; }
  cua_driver_binary_checksum() { printf '%064d\n' 0; }
  cua_driver_skills_checksum() { cat "$fixture_dir/skills.sha256"; }
  if apply_cua_driver > "$case_root/output" 2>&1; then
    fail 'wrong checksum was accepted'
  fi
  grep -q 'SHA256 mismatch' "$case_root/output" || fail 'wrong checksum error was not reported'
  assert_not_exists "$HOME/.cua-driver/packages/releases/0.28.1-x86_64-unknown-linux-gnu"
  assert_eq '1' "$(wc -l < "$case_root/curl.log" | tr -d ' ')" 'downloads before checksum failure'
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
  if cua_driver_extract_archive "$case_root/traversal.tar.gz" "$case_root/traversal-out" runtime >/dev/null 2>&1; then
    fail 'path traversal archive was accepted'
  fi
  if cua_driver_extract_archive "$case_root/symlink.tar.gz" "$case_root/symlink-out" runtime >/dev/null 2>&1; then
    fail 'symlink archive was accepted'
  fi
  assert_not_exists "$case_root/escape"
)

printf 'test: non-Linux apply explicitly refuses without writes or network\n'
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
  cua_driver_platform() {
    printf 'error: Cua Driver installation is supported on Linux only (detected Darwin)\n' >&2
    return 1
  }
  if apply_cua_driver > "$case_root/output" 2>&1; then
    fail 'non-Linux apply succeeded'
  fi
  grep -q 'Linux only' "$case_root/output" || fail 'non-Linux refusal was not explicit'
  assert_not_exists "$case_root/curl.log"
  assert_eq '' "$(find "$HOME" -mindepth 1 -print -quit)" 'non-Linux HOME contents'
)

printf 'test: host selection and Omarchy service boundary\n'
for host in dev omarchy; do
  (
    # shellcheck disable=SC1090
    source "$REPO_ROOT/install/hosts/$host.sh"
    [[ " ${HOST_CONFIG_TARGETS[*]} " == *" cua-driver "* ]]
  ) || fail "$host does not select Cua Driver"
done
(
  # shellcheck source=install/hosts/macbook.sh
  source "$REPO_ROOT/install/hosts/macbook.sh"
  [[ " ${HOST_CONFIG_TARGETS[*]} " != *" cua-driver "* ]]
) || fail 'macbook unexpectedly selects Cua Driver'
(
  # shellcheck source=install/hosts/omarchy.sh
  source "$REPO_ROOT/install/hosts/omarchy.sh"
  [[ " ${HOST_ENV_VARS[*]} " == *" CUA_DRIVER_RS_ENABLE_WAYLAND=1 "* ]]
) || fail 'Omarchy does not enable the Cua Driver native Wayland backend'
service="$REPO_ROOT/configs/cua-driver/cua-driver.service"
assert_file "$service"
grep -Fxq 'Environment=CUA_DRIVER_RS_ENABLE_WAYLAND=1' "$service" || fail 'service does not enable native Wayland'
grep -Fxq 'ExecStart=%h/.local/bin/cua-driver serve' "$service" || fail 'service does not start the managed driver'

printf 'test: Omarchy service starts once and restarts only for stale runtime state\n'
service_root="$TEST_ROOT/service"
mkdir -p "$service_root/home/.local/bin" "$service_root/bin"
printf '#!/usr/bin/env bash\nexit 0\n' > "$service_root/home/.local/bin/cua-driver"
chmod +x "$service_root/home/.local/bin/cua-driver"
cat > "$service_root/bin/systemctl" <<'SCRIPT'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$SYSTEMCTL_LOG"
case "$*" in
  '--user is-enabled --quiet cua-driver.service') [[ "${SYSTEMCTL_ENABLED:-1}" == 1 ]] ;;
  '--user is-active --quiet cua-driver.service') [[ "${SYSTEMCTL_ACTIVE:-1}" == 1 ]] ;;
  '--user show cua-driver.service --property MainPID --value') printf '%s\n' "${SYSTEMCTL_MAIN_PID:-123}" ;;
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

  cua_driver_service_needs_restart() { return 0; }
  configure_cua_driver_service >/dev/null
  grep -Fxq -- '--user restart cua-driver.service' "$SYSTEMCTL_LOG" \
    || fail 'active stale Cua Driver service was not restarted'

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

  : > "$SYSTEMCTL_LOG"
  export SYSTEMCTL_ACTIVE=0
  export SYSTEMCTL_ENABLED=0
  configure_cua_driver_service >/dev/null
  grep -Fxq -- '--user enable cua-driver.service' "$SYSTEMCTL_LOG" \
    || fail 'disabled Cua Driver service was not enabled'
  grep -Fxq -- '--user start cua-driver.service' "$SYSTEMCTL_LOG" \
    || fail 'inactive Cua Driver service was not started'

  : > "$SYSTEMCTL_LOG"
  export SYSTEMCTL_ACTIVE=1
  export SYSTEMCTL_ENABLED=0
  cua_driver_service_needs_restart() { return 0; }
  configure_cua_driver_service >/dev/null
  grep -Fxq -- '--user enable cua-driver.service' "$SYSTEMCTL_LOG" \
    || fail 'active disabled Cua Driver service was not enabled'
  grep -Fxq -- '--user restart cua-driver.service' "$SYSTEMCTL_LOG" \
    || fail 'active disabled stale Cua Driver service was not restarted'
)

printf 'PASS: cua-driver installer tests\n'
