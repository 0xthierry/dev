#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=install/cliproxyapi.sh
source "$REPO_ROOT/install/cliproxyapi.sh"
TEST_TMP="$(mktemp -d)"
trap 'rm -rf "$TEST_TMP"' EXIT
export HOME="$TEST_TMP/home with spaces"
CLIPROXYAPI_REPO_ROOT="$TEST_TMP/repo"
mkdir -p "$CLIPROXYAPI_REPO_ROOT/configs/cliproxyapi" "$CLIPROXYAPI_REPO_ROOT/scripts"
printf 'host: "127.0.0.1"\napi-keys: ["{{API_KEY}}"]\nauth-dir: "~/.local/share/cliproxyapi/auth"\n' > "$CLIPROXYAPI_REPO_ROOT/configs/cliproxyapi/config.yaml"
printf '#!/bin/sh\n' > "$CLIPROXYAPI_REPO_ROOT/scripts/cliproxy"

# No real network, binary execution, or service actions are permitted.
curl() {
  printf 'download\n' >> "$TEST_TMP/downloads"
  local output=""
  while (( $# )); do
    if [[ "$1" == --output ]]; then output="$2"; shift; fi
    shift
  done
  cp "$TEST_TMP/release.tar.gz" "$output"
}
systemctl() { echo 'unexpected systemctl' >&2; return 99; }
launchctl() { echo 'unexpected launchctl' >&2; return 99; }
uname() {
  case "$1" in
    -s) echo "${TEST_OS:-Linux}" ;;
    -m) echo "${TEST_ARCH:-x86_64}" ;;
  esac
}
for TEST_OS in Linux Darwin; do
  for TEST_ARCH in x86_64 aarch64; do
    DRY_RUN=1 install_cliproxyapi >> "$TEST_TMP/dry-run.log"
  done
done
[[ ! -e "$HOME" && ! -e "$TEST_TMP/downloads" ]]
echo 'ok: all four dry-run targets cause no writes or downloads'

python3 - "$TEST_TMP" <<'PY'
import hashlib, io, pathlib, sys, tarfile
root = pathlib.Path(sys.argv[1])
with tarfile.open(root / "release.tar.gz", "w:gz") as archive:
    data = b"#!/bin/sh\nexit 0\n"
    member = tarfile.TarInfo("cli-proxy-api")
    member.size = len(data)
    archive.addfile(member, io.BytesIO(data))
(root / "sha256").write_text(hashlib.sha256((root / "release.tar.gz").read_bytes()).hexdigest())
PY
# Check all production pins exist before substituting the fixture's digest.
for platform in linux_amd64 linux_aarch64 darwin_amd64 darwin_aarch64; do
  [[ "$(cliproxyapi_checksum "$platform")" =~ ^[0-9a-f]{64}$ ]]
done
cliproxyapi_checksum() { printf '%s\n' "$(< "$TEST_TMP/sha256")"; }
TEST_OS=Linux TEST_ARCH=x86_64 DRY_RUN=0 install_cliproxyapi > "$TEST_TMP/install.log" 2>&1
cp "$HOME/.config/cliproxyapi/api-key" "$TEST_TMP/original-key"
TEST_OS=Linux TEST_ARCH=x86_64 DRY_RUN=0 install_cliproxyapi >> "$TEST_TMP/install.log" 2>&1
[[ "$(wc -l < "$TEST_TMP/downloads")" -eq 1 ]]
[[ -L "$HOME/.local/bin/cliproxy" ]]
python3 - "$HOME" "$TEST_TMP" <<'PY'
import pathlib, re, stat, sys
home, tmp = map(pathlib.Path, sys.argv[1:])
config_dir = home / ".config/cliproxyapi"
key = (config_dir / "api-key").read_text().strip()
assert re.fullmatch("[0-9a-f]{64}", key)
assert key not in (tmp / "install.log").read_text()
for path in (config_dir / "api-key", config_dir / "config.yaml"):
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
assert stat.S_IMODE((home / ".local/share/cliproxyapi/auth").stat().st_mode) == 0o700
assert (config_dir / "api-key").read_bytes() == (tmp / "original-key").read_bytes()
assert key in (config_dir / "config.yaml").read_text()
assert "~/.local/share/cliproxyapi/auth" in (config_dir / "config.yaml").read_text()
assert not list(home.rglob("*.bak*"))
unit = (home / ".config/systemd/user/cliproxyapi.service").read_text()
assert f'"{home}/.local/bin/cli-proxy-api" -config "{config_dir}/config.yaml"' in unit
assert [line for line in unit.splitlines() if line.startswith("WorkingDirectory=")] == ["WorkingDirectory=%h/.local/share/cliproxyapi"]
assert not (home / ".config/systemd/user/default.target.wants").exists()
PY
if command -v systemd-analyze >/dev/null 2>&1; then
  # Parse the actual generated unit without loading or starting a service.
  # WorkingDirectory does not accept the quoting used for ExecStart arguments.
  systemd-analyze --user verify "$HOME/.config/systemd/user/cliproxyapi.service"
  echo 'ok: generated Linux service passes systemd-analyze --user verify'
else
  echo 'skip: systemd-analyze unavailable; Linux service verified structurally only'
fi
echo 'ok: install is private, idempotent, secret-free, and does not enable service'

printf 'user-owned config\n' > "$HOME/.config/cliproxyapi/config.yaml"
configure_cliproxyapi linux >> "$TEST_TMP/install.log"
grep -qx 'user-owned config' "$HOME/.config/cliproxyapi/config.yaml.bak"
configure_cliproxyapi darwin >> "$TEST_TMP/install.log"
python3 - "$HOME" <<'PY'
import pathlib, plistlib, sys
home = pathlib.Path(sys.argv[1])
with (home / "Library/LaunchAgents/dev.cliproxyapi.plist").open("rb") as stream:
    service = plistlib.load(stream)
assert service["Label"] == "dev.cliproxyapi"
assert service["Disabled"] is True
assert service["ProgramArguments"] == [str(home / ".local/bin/cli-proxy-api"), "-config", str(home / ".config/cliproxyapi/config.yaml")]
assert service["EnvironmentVariables"]["HOME"] == str(home)
PY
echo 'ok: unowned config backed up and launchagent rendered with absolute paths'

# A mismatch must never replace an installed binary, even in an if condition
# where Bash disables errexit inside the function.
cp "$HOME/.local/bin/cli-proxy-api" "$TEST_TMP/original-binary"
if install_cliproxyapi_binary linux_aarch64 invalid > "$TEST_TMP/mismatch.log" 2>&1; then
  echo 'not ok: checksum mismatch accepted' >&2; exit 1
fi
cmp "$TEST_TMP/original-binary" "$HOME/.local/bin/cli-proxy-api"
grep -q 'SHA256 mismatch' "$TEST_TMP/mismatch.log"
[[ "$(< "$HOME/.local/share/cliproxyapi/version")" == '7.2.151 linux_amd64' ]]
echo 'ok: checksum rejection preserves existing binary and marker'

printf 'invalid\n' > "$HOME/.config/cliproxyapi/api-key"
if configure_cliproxyapi linux > "$TEST_TMP/invalid.log" 2>&1; then
  echo 'not ok: invalid persisted key accepted' >&2; exit 1
fi
grep -qx invalid "$HOME/.config/cliproxyapi/api-key"
echo 'ok: invalid persisted key rejected without regeneration'
